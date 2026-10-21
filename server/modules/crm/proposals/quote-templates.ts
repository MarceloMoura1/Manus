import { randomUUID } from "node:crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getPool } from "../../../db";
import { getCompanySettings } from "../../../db-company";
import { addCrmTimeline } from "../../../db-crm";
import { writeCrmClientFileAtomic, readCrmClientFile, removeCrmClientFilePhysical } from "../client-files/files-storage";
import { normalizeContactPhone, formatContactPhone } from "../../../../shared/contact-phone";
import { SaleService } from "../../erp/sales/service";
import { QuotePdfService } from "../../erp/sales/quote-pdf-service";
import { SaleDocumentService } from "../../erp/sales/documents-service";
import type { OperationalRole } from "../../erp/contracts";
import { renderAutomotiveQuotePages } from "./quote-automotive-html";

export type Identity = {
  clientId: string;
  userId: string;
  userName: string | null;
  role: OperationalRole;
};

export type QuoteTemplateItem = {
  publicId: string;
  name: string;
  niche: "automotive" | "services" | "general";
  backgroundImageUrl: string | null;
  layoutConfig: Record<string, unknown> | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateQuoteTemplateInput = {
  name: string;
  niche?: "automotive" | "services" | "general";
  backgroundImageUrl?: string | null;
  fileBase64?: string | null;
  mimeType?: string | null;
  layoutConfig?: Record<string, unknown> | null;
  isDefault?: boolean;
};

export type QuoteServiceMetadata = {
  brandModel?: string | null;
  plate?: string | null;
  year?: string | null;
  color?: string | null;
  km?: string | null;
  entryDate?: string | null;
  exitDate?: string | null;
  additionalNotes?: string | null;
};

function money(cents: number): string {
  const safe = Number.isSafeInteger(cents) ? cents : 0;
  const sign = safe < 0 ? "-" : "";
  const absolute = Math.abs(safe);
  const integer = String(Math.floor(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${integer},${String(absolute % 100).padStart(2, "0")}`;
}

function escapeHtml(str: unknown): string {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T12:00:00` : dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("pt-BR");
  } catch {
    return dateStr;
  }
}

/**
 * Service managing quote templates, HTML live preview, and WhatsApp dispatch.
 * Strict multi-tenant isolation enforced on every method via identity.clientId.
 */
export class QuoteTemplatesService {
  constructor(
    private readonly saleService = new SaleService(),
    private readonly quotePdfService = new QuotePdfService(),
    private readonly documentService = new SaleDocumentService()
  ) {}

  /**
   * List templates filtered strictly by tenant client_id.
   */
  async listTemplates(identity: Identity): Promise<QuoteTemplateItem[]> {
    const pool = getPool();
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT public_id, name, niche, background_image_url, layout_config, is_default, created_at, updated_at
       FROM megadesk_crm_quote_templates
       WHERE client_id = ?
       ORDER BY is_default DESC, created_at DESC`,
      [identity.clientId]
    );

    return rows.map(r => ({
      publicId: String(r.public_id),
      name: String(r.name),
      niche: (r.niche || "automotive") as "automotive" | "services" | "general",
      backgroundImageUrl: r.background_image_url ? String(r.background_image_url) : null,
      layoutConfig: typeof r.layout_config === "string" ? JSON.parse(r.layout_config) : (r.layout_config ?? null),
      isDefault: Boolean(r.is_default),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
  }

  /**
   * Create template scoped strictly to the authenticated tenant.
   */
  async createTemplate(
    identity: Identity,
    input: CreateQuoteTemplateInput
  ): Promise<{ success: true; publicId: string }> {
    const pool = getPool();
    const publicId = randomUUID();
    let backgroundImageUrl = input.backgroundImageUrl?.trim() || null;
    let layoutConfig = input.layoutConfig ? { ...input.layoutConfig } : {};

    if (input.fileBase64) {
      const match = input.fileBase64.match(/^data:([^;]+);base64,/i);
      const detectedMime = match ? match[1].toLowerCase() : null;
      const mime = (input.mimeType || detectedMime || "image/png").toLowerCase();
      const normalizedMime = mime === "image/jpg" ? "image/jpeg" : mime;
      if (!["image/png", "image/jpeg"].includes(normalizedMime)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Formato de imagem inválido. Use apenas PNG ou JPEG.",
        });
      }

      const cleanBase64 = input.fileBase64.replace(/^data:[^,]+;base64,/i, "").trim();
      const bytes = Buffer.from(cleanBase64, "base64");
      if (bytes.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Arquivo de imagem vazio ou corrompido.",
        });
      }
      if (bytes.length > 5 * 1024 * 1024) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Imagem excede o limite máximo permitido de 5MB.",
        });
      }

      // Physical storage partition scoped to tenant
      await writeCrmClientFileAtomic(identity.clientId, publicId, bytes);
      // Clean path to store in MySQL TEXT column (prevents data truncation errors)
      backgroundImageUrl = `/api/crm/proposals/templates/${publicId}/image`;
      layoutConfig = {
        ...layoutConfig,
        mimeType: normalizedMime,
        fileSize: bytes.length,
        uploadedAt: new Date().toISOString(),
      };
    }

    if (input.isDefault) {
      await pool.execute(
        `UPDATE megadesk_crm_quote_templates SET is_default = 0 WHERE client_id = ?`,
        [identity.clientId]
      );
    }

    await pool.execute(
      `INSERT INTO megadesk_crm_quote_templates
       (public_id, client_id, name, niche, background_image_url, layout_config, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        publicId,
        identity.clientId,
        input.name.trim(),
        input.niche || "automotive",
        backgroundImageUrl,
        Object.keys(layoutConfig).length > 0 ? JSON.stringify(layoutConfig) : null,
        input.isDefault ? 1 : 0,
      ]
    );

    return { success: true, publicId };
  }

  /**
   * Delete template safely validating tenant ownership.
   */
  async deleteTemplate(identity: Identity, publicId: string): Promise<{ success: true }> {
    const pool = getPool();
    const [res] = await pool.execute<ResultSetHeader>(
      `DELETE FROM megadesk_crm_quote_templates WHERE client_id = ? AND public_id = ?`,
      [identity.clientId, publicId]
    );

    if (res.affectedRows === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Template não encontrado." });
    }

    // Clean up physical file if it exists
    await Promise.resolve(removeCrmClientFilePhysical(identity.clientId, publicId)).catch(() => undefined);

    return { success: true };
  }

  /**
   * Update metadata (documentCustomName and serviceMetadata) for a quote.
   */
  async updateMetadata(
    identity: Identity,
    input: {
      publicId: string;
      documentCustomName?: string | null;
      serviceMetadata?: Record<string, unknown> | null;
    }
  ): Promise<{ success: true }> {
    const pool = getPool();
    const updates: string[] = [];
    const values: any[] = [];

    if (input.documentCustomName !== undefined) {
      updates.push("document_custom_name = ?");
      values.push(input.documentCustomName?.trim() || null);
    }
    if (input.serviceMetadata !== undefined) {
      updates.push("service_metadata = ?");
      values.push(input.serviceMetadata ? JSON.stringify(input.serviceMetadata) : null);
    }

    if (!updates.length) return { success: true };

    values.push(identity.clientId, input.publicId);
    const [res] = await pool.execute<ResultSetHeader>(
      `UPDATE erp_sale_orders SET ${updates.join(", ")} WHERE client_id = ? AND public_id = ?`,
      values
    );

    if (res.affectedRows === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado." });
    }

    return { success: true };
  }

  /**
   * Compiles live preview HTML for A4 rendering with automatic pagination rule:
   * If > 9 items: Page 1 (items 1 to 9), Page 2 (subsequent items + totals).
   */
  async previewQuoteHtml(
    identity: Identity,
    input: { salePublicId: string; templatePublicId?: string }
  ) {
    const quote = await this.saleService.detail(identity, input.salePublicId);
    if (!quote || quote.documentType !== "quote") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado." });
    }

    const company = await getCompanySettings(identity.clientId);
    const pool = getPool();

    let template: QuoteTemplateItem | null = null;
    if (input.templatePublicId) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT public_id, name, niche, background_image_url, layout_config, is_default, created_at, updated_at
         FROM megadesk_crm_quote_templates
         WHERE client_id = ? AND public_id = ? LIMIT 1`,
        [identity.clientId, input.templatePublicId]
      );
      if (rows[0]) {
        template = {
          publicId: String(rows[0].public_id),
          name: String(rows[0].name),
          niche: (rows[0].niche || "automotive") as any,
          backgroundImageUrl: rows[0].background_image_url ? String(rows[0].background_image_url) : null,
          layoutConfig: typeof rows[0].layout_config === "string" ? JSON.parse(rows[0].layout_config) : (rows[0].layout_config ?? null),
          isDefault: Boolean(rows[0].is_default),
          createdAt: String(rows[0].created_at),
          updatedAt: String(rows[0].updated_at),
        };
      }
    }

    if (!template) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT public_id, name, niche, background_image_url, layout_config, is_default, created_at, updated_at
         FROM megadesk_crm_quote_templates
         WHERE client_id = ?
         ORDER BY is_default DESC, created_at DESC LIMIT 1`,
        [identity.clientId]
      );
      if (rows[0]) {
        template = {
          publicId: String(rows[0].public_id),
          name: String(rows[0].name),
          niche: (rows[0].niche || "automotive") as any,
          backgroundImageUrl: rows[0].background_image_url ? String(rows[0].background_image_url) : null,
          layoutConfig: typeof rows[0].layout_config === "string" ? JSON.parse(rows[0].layout_config) : (rows[0].layout_config ?? null),
          isDefault: Boolean(rows[0].is_default),
          createdAt: String(rows[0].created_at),
          updatedAt: String(rows[0].updated_at),
        };
      }
    }

    const items = quote.items || [];
    const hasPaginationBreak = items.length > 9;
    const page1Items = hasPaginationBreak ? items.slice(0, 9) : items;
    const page2Items = hasPaginationBreak ? items.slice(9) : [];
    const totalPages = hasPaginationBreak ? 2 : 1;

    const serviceMeta = (quote as any).serviceMetadata as QuoteServiceMetadata | null;
    const defaultDocName = `Orçamento - ${quote.customerName} - ${formatDate(quote.commercialDate)}`;
    const documentCustomName = (quote as any).documentCustomName?.trim() || defaultDocName;

    const isAutomotive =
      template?.niche === "automotive" ||
      template?.name?.toLowerCase().includes("garage") ||
      template?.name?.toLowerCase().includes("oficina") ||
      Boolean(serviceMeta?.brandModel || serviceMeta?.plate);

    if (isAutomotive) {
      const automotivePages = renderAutomotiveQuotePages({
        company: {
          companyName: company?.companyName || "Oficina Automotiva",
          primaryEmail: company?.primaryEmail,
          primaryPhone: company?.primaryPhone,
          primaryWhatsapp: company?.primaryWhatsapp,
          address: company?.address,
          logoUrl: (company as any)?.logoUrl || null,
        },
        quote: {
          publicId: quote.publicId,
          orderNumber: quote.orderNumber,
          commercialDate: quote.commercialDate,
          customerName: quote.customerName,
          customerPhone: (quote as any).customerPhone || null,
          customerAddress: (quote as any).customerAddress || null,
          customerAddressNumber: (quote as any).customerAddressNumber || null,
          paymentTerms: quote.paymentTerms,
          notes: quote.notes,
          subtotalCents: quote.subtotalCents,
          discountCents: quote.discountCents,
          freightCents: quote.freightCents,
          chargesCents: quote.chargesCents,
          totalCents: quote.totalCents,
          serviceMetadata: serviceMeta,
        },
        items: items.map(item => ({
          productName: item.productName || (item as any).description,
          description: (item as any).description || item.productName,
          sku: item.sku,
          quantity: item.quantity,
          unit: item.unit,
          unitPriceCents: item.unitPriceCents,
          discountCents: item.discountCents,
          lineTotalCents: item.lineTotalCents,
        })),
      });

      return {
        pages: automotivePages,
        totalPages: automotivePages.length,
        documentCustomName,
        templateName: template?.name || "Automotivo Padrão",
        hasServiceMetadata: Boolean(
          serviceMeta?.brandModel || serviceMeta?.plate || serviceMeta?.year || serviceMeta?.km
        ),
        itemsCount: items.length,
      };
    }

    let bgUrl = template?.backgroundImageUrl || null;
    if (template) {
      try {
        const fileBytes = await readCrmClientFile(identity.clientId, template.publicId);
        const mime = (template.layoutConfig as any)?.mimeType || "image/png";
        bgUrl = `data:${mime};base64,${fileBytes.toString("base64")}`;
      } catch {
        // Fallback to stored backgroundImageUrl if file is not on disk
      }
    }

    const bgCss = bgUrl
      ? `background-image: url('${bgUrl}'); background-size: cover; background-position: center; background-repeat: no-repeat;`
      : `background: #ffffff;`;

    const hasBackground = Boolean(bgUrl);

    // Render Page 1
    const page1Html = this.renderPageHtml({
      pageNumber: 1,
      totalPages,
      company,
      quote,
      items: page1Items,
      startingIndex: 0,
      showServiceMetadata: true,
      serviceMeta,
      showTotals: !hasPaginationBreak,
      bgCss,
      bgUrl,
      hasBackground,
      templateName: template?.name || "Padrão MegaDesk",
    });

    // Render Page 2 if needed
    const page2Html = hasPaginationBreak
      ? this.renderPageHtml({
          pageNumber: 2,
          totalPages,
          company,
          quote,
          items: page2Items,
          startingIndex: 9,
          showServiceMetadata: false,
          serviceMeta: null,
          showTotals: true,
          bgCss,
          bgUrl,
          hasBackground,
          templateName: template?.name || "Padrão MegaDesk",
        })
      : null;

    const pages = [
      { pageNumber: 1, html: page1Html },
      ...(page2Html ? [{ pageNumber: 2, html: page2Html }] : []),
    ];

    return {
      pages,
      totalPages,
      documentCustomName,
      templateName: template?.name || "Padrão MegaDesk",
      hasServiceMetadata: Boolean(
        serviceMeta?.brandModel || serviceMeta?.plate || serviceMeta?.year || serviceMeta?.km
      ),
      itemsCount: items.length,
    };
  }

  private renderPageHtml(params: {
    pageNumber: number;
    totalPages: number;
    company: any;
    quote: any;
    items: any[];
    startingIndex: number;
    showServiceMetadata: boolean;
    serviceMeta: QuoteServiceMetadata | null;
    showTotals: boolean;
    bgCss: string;
    bgUrl?: string | null;
    hasBackground?: boolean;
    templateName: string;
  }): string {
    const {
      pageNumber,
      totalPages,
      company,
      quote,
      items,
      startingIndex,
      showServiceMetadata,
      serviceMeta,
      showTotals,
      bgCss,
      bgUrl,
      hasBackground,
    } = params;

    const companyName = escapeHtml(company?.companyName || "MegaDesk Comercial");
    const companyEmail = escapeHtml(company?.primaryEmail || "");
    const companyPhone = escapeHtml(company?.primaryPhone || company?.primaryWhatsapp || "");
    const companyAddress = escapeHtml(company?.address || "");

    const customerName = escapeHtml(quote.customerName || "Cliente");
    const orderNumber = escapeHtml(quote.orderNumber);
    const issuedOn = formatDate(quote.commercialDate);

    // ─── TEMPLATE TRANSPARENTE: FOLHA TIMBRADA MILIMÉTRICA A4 (LOW GARAGE) ───
    if (hasBackground && bgUrl) {
      return `
    <div class="a4-sheet letterhead-overlay" style="position: relative; width: 210mm; min-height: 297mm; height: 297mm; max-height: 297mm; box-sizing: border-box; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; background-image: url('${escapeHtml(bgUrl)}'); background-size: 100% 100%; background-position: center; background-repeat: no-repeat;">
      <meta charset="UTF-8">

      <!-- NÚMERO DO ORÇAMENTO (topo direito) -->
      <div style="position: absolute; top: 8mm; right: 14mm; width: 48mm; height: 12mm; display: flex; align-items: center; justify-content: flex-end; font-size: 14px; font-weight: 800; color: #dc2626; letter-spacing: 0.05em;">
        ${orderNumber}
      </div>

      <!-- Checkbox ORÇAMENTO marcado -->
      <div style="position: absolute; top: 60.8mm; left: 32mm; font-size: 13px; font-weight: 900; color: #0f172a;">
        X
      </div>

      ${pageNumber === 1 ? `
      <!-- DADOS DO CLIENTE & VEÍCULO (textos puros alinhados sobre as linhas pontilhadas) -->
      <!-- Linha 1: Nome -->
      <div style="position: absolute; top: 76.5mm; left: 38mm; width: 94mm; height: 5mm; display: flex; align-items: center; font-size: 11px; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${customerName}
      </div>
      <!-- Linha 1: Fone -->
      <div style="position: absolute; top: 76.5mm; left: 146mm; width: 50mm; height: 5mm; display: flex; align-items: center; font-size: 11px; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${escapeHtml(quote.customerPhone || "")}
      </div>
      <!-- Linha 2: Endereço -->
      <div style="position: absolute; top: 83.5mm; left: 45mm; width: 126mm; height: 5mm; display: flex; align-items: center; font-size: 10px; font-weight: 500; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${escapeHtml(quote.customerAddress || "")}
      </div>
      <!-- Linha 2: N° -->
      <div style="position: absolute; top: 83.5mm; left: 178mm; width: 18mm; height: 5mm; display: flex; align-items: center; font-size: 10px; font-weight: 500; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${escapeHtml(quote.customerAddressNumber || "")}
      </div>

      <!-- Linha 3: Marca / Modelo -->
      <div style="position: absolute; top: 90.5mm; left: 56mm; width: 75mm; height: 5mm; display: flex; align-items: center; font-size: 10px; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${escapeHtml(serviceMeta?.brandModel || (serviceMeta as any)?.model || "—")}
      </div>
      <!-- Linha 3: Placa -->
      <div style="position: absolute; top: 90.5mm; left: 146mm; width: 32mm; height: 5mm; display: flex; align-items: center; font-size: 10px; font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${escapeHtml(serviceMeta?.plate || "—")}
      </div>
      <!-- Linha 3: Ano -->
      <div style="position: absolute; top: 90.5mm; left: 185mm; width: 14mm; height: 5mm; display: flex; align-items: center; font-size: 10px; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${escapeHtml(serviceMeta?.year || "—")}
      </div>

      <!-- Linha 4: Cor -->
      <div style="position: absolute; top: 97.5mm; left: 34mm; width: 95mm; height: 5mm; display: flex; align-items: center; font-size: 10px; font-weight: 500; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${escapeHtml(serviceMeta?.color || "—")}
      </div>
      <!-- Linha 4: KM -->
      <div style="position: absolute; top: 97.5mm; left: 139mm; width: 45mm; height: 5mm; display: flex; align-items: center; font-size: 10px; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${escapeHtml(serviceMeta?.km ? `${serviceMeta.km} km` : "—")}
      </div>

      <!-- Linha 5: Data Entrada -->
      <div style="position: absolute; top: 104.5mm; left: 53mm; width: 48mm; height: 5mm; display: flex; align-items: center; font-size: 10px; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${formatDate(serviceMeta?.entryDate || quote.commercialDate)}
      </div>
      <!-- Linha 5: Data Saída / Previsão -->
      <div style="position: absolute; top: 104.5mm; left: 153mm; width: 42mm; height: 5mm; display: flex; align-items: center; font-size: 10px; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${formatDate(serviceMeta?.exitDate || null)}
      </div>
      ` : `
      <!-- Cabeçalho compacto página 2 -->
      <div style="position: absolute; top: 76.5mm; left: 38mm; width: 158mm; height: 5mm; display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 600; color: #0f172a;">
        <span>Cliente: <strong>${customerName}</strong></span>
        <span>Orçamento ${orderNumber} · Página ${pageNumber} de ${totalPages}</span>
      </div>
      `}

      <!-- TABELA DE 9 LINHAS (DESCRIÇÃO DOS SERVIÇOS / PEÇAS) -->
      <!-- Inicia exatamente abaixo da tarja preta de cabeçalho em top: 136mm com linhas de 10.77mm -->
      <div style="position: absolute; top: 136mm; left: 14mm; width: 182mm; height: 97mm; box-sizing: border-box; display: flex; flex-direction: column;">
        ${Array.from({ length: 9 }).map((_, idx) => {
          const item = items[idx];
          if (!item) {
            return `<div style="height: 10.77mm; width: 100%; box-sizing: border-box;"></div>`;
          }
          const desc = escapeHtml(item.productName || item.description || "");
          const qtyStr = item.quantity ? ` (${escapeHtml(String(item.quantity))} ${escapeHtml(item.unit || "un")})` : "";
          const valStr = money(item.lineTotalCents || (item.unitPriceCents * (item.quantity || 1)));
          return `
          <div style="height: 10.77mm; width: 100%; box-sizing: border-box; display: flex; align-items: center;">
            <div style="width: 142mm; padding-left: 2mm; padding-right: 2mm; font-size: 10px; font-weight: 500; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1;">
              ${desc}${qtyStr}
            </div>
            <div style="width: 40mm; padding-right: 3mm; text-align: right; font-size: 10.5px; font-weight: 700; color: #0f172a; white-space: nowrap; line-height: 1;">
              ${valStr}
            </div>
          </div>`;
        }).join("")}
      </div>

      ${showTotals ? `
      <!-- TOTAIS DO RODAPÉ (caixas no canto inferior direito) -->
      <!-- Peças / Materiais -->
      <div style="position: absolute; top: 237.5mm; left: 152mm; width: 42mm; height: 6mm; display: flex; align-items: center; justify-content: flex-end; font-size: 11px; font-weight: 700; color: #0f172a;">
        ${money(quote.subtotalCents)}
      </div>
      <!-- Mão de Obra -->
      <div style="position: absolute; top: 244.5mm; left: 152mm; width: 42mm; height: 6mm; display: flex; align-items: center; justify-content: flex-end; font-size: 11px; font-weight: 700; color: #0f172a;">
        ${money(quote.chargesCents || 0)}
      </div>
      <!-- Serviços de Terceiros -->
      <div style="position: absolute; top: 251.5mm; left: 152mm; width: 42mm; height: 6mm; display: flex; align-items: center; justify-content: flex-end; font-size: 11px; font-weight: 700; color: #0f172a;">
        ${money(quote.freightCents || 0)}
      </div>
      <!-- TOTAL (caixa vermelha com texto branco) -->
      <div style="position: absolute; top: 261.5mm; left: 148mm; width: 46mm; height: 8mm; display: flex; align-items: center; justify-content: flex-end; font-size: 13px; font-weight: 800; color: #ffffff;">
        ${money(quote.totalCents)}
      </div>

      <!-- CONDIÇÕES & OBSERVAÇÕES (rodapé esquerdo) -->
      <div style="position: absolute; top: 237mm; left: 16mm; width: 130mm; height: 32mm; font-size: 9.5px; color: #334155; line-height: 1.4; overflow: hidden;">
        <div><strong>Condições:</strong> ${escapeHtml(quote.paymentTerms || "À vista / A combinar")}</div>
        ${quote.notes ? `<div style="margin-top: 3px;"><strong>Obs:</strong> ${escapeHtml(quote.notes)}</div>` : ""}
      </div>
      ` : ""}
    </div>`;
    }

    // ─── FALLBACK: LAYOUT CORPORATIVO PADRÃO (SEM IMAGEM DE FUNDO) ────────────
    // Vehicle/Service drawer badges
    let vehicleBlock = "";
    if (showServiceMetadata && serviceMeta) {
      const parts: string[] = [];
      if (serviceMeta.brandModel) parts.push(`<strong>Veículo/Objeto:</strong> ${escapeHtml(serviceMeta.brandModel)}`);
      if (serviceMeta.plate) parts.push(`<strong>Placa:</strong> ${escapeHtml(serviceMeta.plate)}`);
      if (serviceMeta.year) parts.push(`<strong>Ano:</strong> ${escapeHtml(serviceMeta.year)}`);
      if (serviceMeta.color) parts.push(`<strong>Cor:</strong> ${escapeHtml(serviceMeta.color)}`);
      if (serviceMeta.km) parts.push(`<strong>KM:</strong> ${escapeHtml(serviceMeta.km)}`);
      if (serviceMeta.entryDate) parts.push(`<strong>Entrada:</strong> ${formatDate(serviceMeta.entryDate)}`);
      if (serviceMeta.exitDate) parts.push(`<strong>Saída:</strong> ${formatDate(serviceMeta.exitDate)}`);

      if (parts.length > 0) {
        vehicleBlock = `
        <div style="margin-top: 14px; padding: 10px 14px; background: rgba(241, 245, 249, 0.9); border: 1px solid #cbd5e1; border-radius: 6px; font-size: 11px; line-height: 1.6; color: #1e293b;">
          <div style="font-weight: 700; color: #0f172a; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; display: flex; align-items: center; gap: 4px;">
            <span>🚗 Dados do Veículo / Objeto em Atendimento</span>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 12px;">
            ${parts.map(p => `<span>${p}</span>`).join(" • ")}
          </div>
        </div>`;
      }
    }

    // Items table rows
    const itemRows = items
      .map((item, idx) => {
        const itemNumber = startingIndex + idx + 1;
        const description = escapeHtml(item.productName || "Produto/Serviço");
        const sku = item.sku ? ` <span style="color:#64748b; font-size: 10px;">(${escapeHtml(item.sku)})</span>` : "";
        const qty = escapeHtml(String(item.quantity));
        const unit = escapeHtml(item.unit || "un");
        const unitPrice = money(item.unitPriceCents);
        const lineTotal = money(item.lineTotalCents);

        return `
        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
          <td style="padding: 7px 8px; text-align: center; color: #64748b; font-weight: 600;">${itemNumber}</td>
          <td style="padding: 7px 8px; color: #0f172a; font-weight: 500;">${description}${sku}</td>
          <td style="padding: 7px 8px; text-align: center; color: #334155;">${qty} ${unit}</td>
          <td style="padding: 7px 8px; text-align: right; color: #334155;">${unitPrice}</td>
          <td style="padding: 7px 8px; text-align: right; color: #0f172a; font-weight: 700;">${lineTotal}</td>
        </tr>`;
      })
      .join("");

    // Financial totals and commercial conditions
    let totalsBlock = "";
    if (showTotals) {
      const subtotal = money(quote.subtotalCents);
      const discount = money(quote.discountCents);
      const freight = money(quote.freightCents);
      const charges = money(quote.chargesCents);
      const total = money(quote.totalCents);
      const paymentTerms = escapeHtml(quote.paymentTerms || "A combinar");
      const notes = escapeHtml(quote.notes || "");

      totalsBlock = `
      <div style="margin-top: 14px; display: grid; grid-template-columns: 1fr 240px; gap: 16px;">
        <div style="font-size: 11px; color: #334155; line-height: 1.5;">
          <div style="background: rgba(248, 250, 252, 0.95); border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; margin-bottom: 10px;">
            <strong style="display: block; font-size: 10px; color: #64748b; text-transform: uppercase; margin-bottom: 3px;">Condições Comerciais</strong>
            <span>${paymentTerms}</span>
          </div>
          ${notes ? `
          <div style="background: rgba(248, 250, 252, 0.95); border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px;">
            <strong style="display: block; font-size: 10px; color: #64748b; text-transform: uppercase; margin-bottom: 3px;">Observações</strong>
            <span>${notes}</span>
          </div>` : ""}
        </div>
        <div style="background: rgba(248, 250, 252, 0.95); border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 14px; font-size: 11px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #475569;">
            <span>Subtotal:</span>
            <strong>${subtotal}</strong>
          </div>
          ${quote.discountCents > 0 ? `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #059669;">
            <span>Desconto:</span>
            <strong>-${discount}</strong>
          </div>` : ""}
          ${quote.freightCents > 0 ? `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #475569;">
            <span>Frete:</span>
            <strong>${freight}</strong>
          </div>` : ""}
          ${quote.chargesCents > 0 ? `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #475569;">
            <span>Acréscimos:</span>
            <strong>${charges}</strong>
          </div>` : ""}
          <div style="border-top: 2px solid #0f172a; margin-top: 6px; padding-top: 6px; display: flex; justify-content: space-between; font-size: 14px; color: #0f172a; font-weight: 800;">
            <span>TOTAL:</span>
            <span style="color: #1d4ed8;">${total}</span>
          </div>
        </div>
      </div>
      <div style="margin-top: 28px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; text-align: center; font-size: 10px; color: #64748b;">
        <div>
          <div style="border-top: 1px solid #94a3b8; margin-bottom: 4px;"></div>
          <span>${customerName} (Aceite do Cliente)</span>
        </div>
        <div>
          <div style="border-top: 1px solid #94a3b8; margin-bottom: 4px;"></div>
          <span>${companyName} (Responsável Técnico)</span>
        </div>
      </div>`;
    }

    return `
    <div class="a4-sheet" style="position: relative; width: 210mm; min-height: 297mm; padding: 18mm 16mm; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; ${bgCss}">
      <meta charset="UTF-8">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e3a8a; padding-bottom: 12px;">
        <div>
          <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: #1e3a8a; text-transform: uppercase; letter-spacing: -0.01em;">${companyName}</h1>
          <p style="margin: 2px 0 0; font-size: 11px; color: #475569;">${[companyPhone, companyEmail, companyAddress].filter(Boolean).join(" · ")}</p>
        </div>
        <div style="text-align: right;">
          <div style="display: inline-block; padding: 4px 10px; background: #1e3a8a; color: #ffffff; font-weight: 800; font-size: 12px; border-radius: 4px; letter-spacing: 0.05em;">
            ORÇAMENTO ${orderNumber}
          </div>
          <div style="margin-top: 4px; font-size: 10px; color: #64748b;">
            Emissão: <strong>${issuedOn}</strong> · Página <strong>${pageNumber} de ${totalPages}</strong>
          </div>
        </div>
      </div>

      <!-- Customer details (page 1 only or compact on page 2) -->
      ${pageNumber === 1 ? `
      <div style="margin-top: 12px; display: grid; grid-template-columns: 2fr 1fr; gap: 12px; background: rgba(248, 250, 252, 0.9); padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 11px;">
        <div>
          <span style="font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; display: block;">Cliente</span>
          <strong style="font-size: 13px; color: #0f172a;">${customerName}</strong>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; display: block;">Status</span>
          <span style="display: inline-block; padding: 2px 8px; background: #dbeafe; color: #1e40af; border-radius: 12px; font-weight: 700; font-size: 10px;">${quote.commercialStatus === "approved" ? "Aprovado" : quote.commercialStatus === "negotiation" ? "Em negociação" : "Em elaboração"}</span>
        </div>
      </div>
      ${vehicleBlock}
      ` : `
      <div style="margin-top: 10px; padding: 6px 10px; background: rgba(248, 250, 252, 0.85); border: 1px solid #e2e8f0; border-radius: 4px; font-size: 10px; color: #475569; display: flex; justify-content: space-between;">
        <span>Cliente: <strong>${customerName}</strong></span>
        <span>Continuação dos itens · Orçamento ${orderNumber}</span>
      </div>
      `}

      <!-- Items Table -->
      <div style="margin-top: 14px;">
        <table style="width: 100%; border-collapse: collapse; text-align: left;">
          <thead>
            <tr style="background: #1e3a8a; color: #ffffff; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;">
              <th style="padding: 7px 8px; width: 36px; text-align: center; border-radius: 4px 0 0 0;">Item</th>
              <th style="padding: 7px 8px;">Descrição do Produto / Serviço</th>
              <th style="padding: 7px 8px; width: 70px; text-align: center;">Qtd</th>
              <th style="padding: 7px 8px; width: 90px; text-align: right;">Unitário</th>
              <th style="padding: 7px 8px; width: 95px; text-align: right; border-radius: 0 4px 0 0;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>
      </div>

      <!-- Totals & Footers -->
      ${totalsBlock}

      <!-- Bottom page indicator -->
      <div style="position: absolute; bottom: 8mm; left: 16mm; right: 16mm; border-top: 1px solid #e2e8f0; padding-top: 6px; font-size: 9px; color: #94a3b8; display: flex; justify-content: space-between;">
        <span>Documento gerado pelo MegaDesk ERP & CRM</span>
        <span>Página ${pageNumber} de ${totalPages}</span>
      </div>
    </div>`;
  }

  /**
   * Dispatches the generated quote PDF directly via Evolution API WhatsApp integration,
   * validates phone with shared/contact-phone.ts, records message in conversation chat,
   * and records event in CRM timeline.
   */
  async sendQuoteWhatsApp(
    identity: Identity,
    input: {
      publicId: string;
      phone?: string;
      customMessage?: string;
      idempotencyKey?: string;
    }
  ): Promise<{
    success: true;
    messageId?: string;
    fileName: string;
    recipientPhone: string;
  }> {
    const quote = await this.saleService.detail(identity, input.publicId);
    if (!quote || quote.documentType !== "quote") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado." });
    }

    const pool = getPool();
    let rawPhone = input.phone?.trim() || "";
    if (!rawPhone) {
      // Lookup canonical phone from CRM client (excluding nonexistent columns like mobile_phone)
      const [clientRows] = await pool.execute<RowDataPacket[]>(
        `SELECT phone, whatsapp FROM megadesk_crm_clients
         WHERE client_id = ? AND crm_client_id = ? LIMIT 1`,
        [identity.clientId, quote.crmClientId]
      );
      if (clientRows[0]) {
        rawPhone = clientRows[0].whatsapp || clientRows[0].phone || "";
      }
    }

    const phoneNorm = normalizeContactPhone(rawPhone);
    if (phoneNorm.status !== "valid") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          phoneNorm.status === "invalid"
            ? `Telefone de destino inválido: ${phoneNorm.reason}`
            : "Nenhum telefone válido encontrado no cadastro do cliente. Informe o WhatsApp para envio.",
      });
    }

    const formattedRecipient = formatContactPhone(phoneNorm.value);

    // Verify if PDF physically exists in storage for this quote
    let pdfBytes: Buffer | null = null;
    let fileName = "";

    try {
      const existingDocs = await this.documentService.list(identity, input.publicId);
      const activeQuotePdf = existingDocs.find(
        d => d.documentType === "quote_pdf" && d.state === "active"
      );

      if (activeQuotePdf) {
        const downloaded = await this.documentService.getForDownload(
          identity,
          input.publicId,
          activeQuotePdf.publicId
        );
        if (downloaded.bytes && downloaded.bytes.length > 0) {
          pdfBytes = downloaded.bytes;
          fileName = downloaded.fileName;
        }
      }
    } catch (docErr) {
      console.warn("[QuoteTemplatesService] Verificação de documento existente falhou, gerando JIT:", docErr);
    }

    // SE NÃO EXISTIR FISICAMENTE: gerar imediatamente JIT e persistir
    if (!pdfBytes) {
      const idempotencyKey = input.idempotencyKey || randomUUID();
      if (typeof (this.quotePdfService as any).generateWithBuffer === "function") {
        const generated = await (this.quotePdfService as any).generateWithBuffer(identity, {
          salePublicId: input.publicId,
          idempotencyKey,
        });
        if (generated?.bytes) {
          pdfBytes = generated.bytes;
          fileName = generated.document?.fileName || "";
        }
      }
      if (!pdfBytes) {
        const generated = await this.quotePdfService.generate(identity, {
          salePublicId: input.publicId,
          idempotencyKey,
        });
        fileName = generated.fileName;
        try {
          const downloaded = await this.documentService.getForDownload(
            identity,
            input.publicId,
            generated.publicId
          );
          pdfBytes = downloaded.bytes;
        } catch {
          pdfBytes = await readCrmClientFile(
            identity.clientId,
            (generated as any).filePublicId || generated.publicId
          );
        }
      }
    }

    if (!pdfBytes || pdfBytes.length === 0) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Não foi possível gerar ou carregar o arquivo físico do orçamento para disparo.",
      });
    }

    // Resolve Evolution API client and session
    const [{ evoSendAttachment }, { instanceNameFor }] = await Promise.all([
      import("../../../evolution/client"),
      import("../../../evolution/session-store"),
    ]);

    const instanceName = instanceNameFor(identity.clientId);
    const messageCaption =
      input.customMessage?.trim() ||
      `Olá, ${quote.customerName}! Segue em anexo a proposta comercial *${quote.orderNumber}* no valor de ${money(quote.totalCents)}. Permanecemos à disposição!`;

    let messageId: string | undefined;
    try {
      const response = await evoSendAttachment({
        instanceName,
        number: phoneNorm.value,
        kind: "document",
        dataUrl: pdfBytes.toString("base64"),
        mimeType: "application/pdf",
        fileName,
        caption: messageCaption,
      });
      messageId = response?.key?.id;
    } catch (evoError: any) {
      console.warn("[QuoteTemplatesService] Falha na Evolution API:", evoError?.message);
      // In local dev/mock or when instance is not connected, record error clearly
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Falha ao disparar WhatsApp via Evolution: ${evoError?.message || "Instância desconectada ou indisponível"}`,
      });
    }

    // ─── PERSISTÊNCIA DA MENSAGEM NO CHAT (ATENDIMENTO) ────────────────────────
    try {
      // Localizar ou criar a conversa ativa correspondente ao telefone em megadesk_domain_conversations
      const searchRes = await pool.execute<RowDataPacket[]>(
        `SELECT conversation_id, messages_json FROM megadesk_domain_conversations
         WHERE client_id = ? AND (phone = ? OR phone = ? OR phone LIKE ?)
         ORDER BY CASE WHEN status = 'open' THEN 1 WHEN status = 'bot' THEN 2 ELSE 3 END, updated_at DESC LIMIT 1`,
        [identity.clientId, phoneNorm.value, formattedRecipient, `%${phoneNorm.value.slice(-8)}`]
      );
      const convRows = Array.isArray(searchRes) && Array.isArray(searchRes[0]) ? searchRes[0] : [];

      let conversationId: string;
      let isNewConversation = false;

      if (convRows.length > 0) {
        conversationId = String(convRows[0].conversation_id);
      } else {
        conversationId = `conv-${randomUUID()}`;
        isNewConversation = true;
        const timeLabel = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        await pool.execute(
          `INSERT INTO megadesk_domain_conversations
           (conversation_id, client_id, crm_client_id, customer_name, phone, company, status, last_message, time_label, messages_json, opened_at)
           VALUES (?, ?, ?, ?, ?, '', 'open', ?, ?, '[]', NOW())`,
          [
            conversationId,
            identity.clientId,
            quote.crmClientId,
            quote.customerName || "Cliente",
            phoneNorm.value,
            messageCaption.substring(0, 255),
            timeLabel,
          ]
        );
      }

      const messageRecordId = `msg-${randomUUID()}`;
      const now = new Date();
      const timeLabel = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const pdfUrl = `/api/erp/sales/${quote.publicId}/pdf`;
      const mediaReference = {
        messageId: messageRecordId,
        url: pdfUrl,
        mediaUrl: pdfUrl,
        media_url: pdfUrl,
        mediaData: pdfUrl,
        fileName,
        mimeType: "application/pdf",
        byteSize: pdfBytes.length,
        caption: messageCaption,
        storage: "quote_document",
        publicId: quote.publicId,
      };

      // Inserir o registro em megadesk_domain_conversations_messages
      await pool.execute(
        `INSERT INTO megadesk_domain_conversations_messages
         (message_id, conversation_id, client_id, external_message_id, provider, integration_id,
          direction, message_type, sender_user_id, sender_name_snapshot, media_reference,
          sender, message, timestamp, status)
         VALUES (?, ?, ?, ?, 'evolution', '', 'outbound', 'document', ?, ?, ?, 'operator', ?, ?, 'sent')`,
        [
          messageRecordId,
          conversationId,
          identity.clientId,
          messageId || null,
          identity.userId,
          identity.userName || "Operador",
          JSON.stringify(mediaReference),
          messageCaption,
          now,
        ]
      );

      // Atualizar megadesk_domain_conversations com a mensagem em messages_json e last_message
      const currRes = await pool.execute<RowDataPacket[]>(
        `SELECT messages_json FROM megadesk_domain_conversations WHERE conversation_id = ? AND client_id = ? LIMIT 1`,
        [conversationId, identity.clientId]
      );
      const currConv = Array.isArray(currRes) && Array.isArray(currRes[0]) ? currRes[0] : [];
      let messagesList: any[] = [];
      if (currConv[0]?.messages_json) {
        try { messagesList = JSON.parse(currConv[0].messages_json); } catch { messagesList = []; }
      }
      messagesList.push({
        id: messageRecordId,
        externalMessageId: messageId || null,
        from: "agent",
        direction: "outbound",
        sender: "operator",
        type: "document",
        text: messageCaption,
        fileName,
        mimeType: "application/pdf",
        url: pdfUrl,
        mediaUrl: pdfUrl,
        media_url: pdfUrl,
        mediaData: pdfUrl,
        mediaReference,
        time: timeLabel,
        timestamp: now.toISOString(),
        status: "sent",
      });
      await pool.execute(
        `UPDATE megadesk_domain_conversations
         SET messages_json = ?, last_message = ?, last_message_from = 'operator', updated_at = NOW()
         WHERE conversation_id = ? AND client_id = ?`,
        [JSON.stringify(messagesList), messageCaption.substring(0, 255), conversationId, identity.clientId]
      );

      // Emitir o evento via WebSocket (/api/ws/whatsapp) para atualizar timeline em tempo real
      try {
        const { emitOperationalTenantEvent } = await import("../../whatsapp/socket/whatsapp.socket");
        const eventPayload = {
          conversationId,
          clientId: identity.clientId,
          message: {
            id: messageRecordId,
            externalMessageId: messageId || null,
            text: messageCaption,
            type: "document",
            fileName,
            mimeType: "application/pdf",
            url: pdfUrl,
            mediaUrl: pdfUrl,
            media_url: pdfUrl,
            mediaData: pdfUrl,
            mediaReference,
            timestamp: now.toISOString(),
            time: timeLabel,
            from: "agent",
            sender: "operator",
            direction: "outbound",
            status: "sent",
          },
        };
        emitOperationalTenantEvent(identity.clientId, "conversation:message", eventPayload);
        emitOperationalTenantEvent(identity.clientId, "wa:new_message", eventPayload);
        if (isNewConversation) {
          emitOperationalTenantEvent(identity.clientId, "conversation:new", {
            clientId: identity.clientId,
            conversation: {
              id: conversationId,
              name: quote.customerName,
              phone: phoneNorm.value,
              status: "open",
              lastMessage: messageCaption.substring(0, 255),
            },
          });
        }
      } catch (wsErr) {
        console.warn("[QuoteTemplatesService] Falha ao emitir evento WebSocket de conversa:", wsErr);
      }
    } catch (chatPersistError) {
      console.warn("[QuoteTemplatesService] Falha ao sincronizar mensagem na conversa do Atendimento:", chatPersistError);
    }

    // Register event in CRM timeline
    await addCrmTimeline(
      quote.crmClientId,
      identity.clientId,
      {
        type: "quote_sent_whatsapp",
        description: `Orçamento ${quote.orderNumber} enviado via WhatsApp para ${formattedRecipient} (${fileName}).`,
        author: identity.userName || "Operador CRM",
      }
    );

    return {
      success: true,
      messageId,
      fileName,
      recipientPhone: formattedRecipient,
    };
  }
}

