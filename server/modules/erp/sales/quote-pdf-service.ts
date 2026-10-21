import { getCompanySettings } from "../../../db-company";
import type { OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import { canWriteSales } from "./contracts";
import { SaleDocumentService } from "./documents-service";
import { SaleRepository } from "./repository";
import { renderQuotePdf } from "./quote-pdf";

type Identity = {
  clientId: string;
  userId: string;
  userName: string | null;
  role: OperationalRole;
};

type QuoteRepository = Pick<SaleRepository, "detail">;
type QuoteDocumentStore = Pick<SaleDocumentService, "storeGeneratedQuotePdf">;
type CompanySettingsReader = typeof getCompanySettings;

/**
 * Creates an immutable, tenant-owned PDF snapshot for an existing quote.  It
 * intentionally uses the persisted order details instead of any browser data.
 */
export class QuotePdfService {
  constructor(
    private readonly repository: QuoteRepository = new SaleRepository(),
    private readonly documents: QuoteDocumentStore = new SaleDocumentService(),
    private readonly companySettings: CompanySettingsReader = getCompanySettings
  ) {}

  private assertWrite(identity: Identity): void {
    if (!canWriteSales(identity.role)) {
      throw new ErpDomainError(
        "FORBIDDEN",
        "Seu perfil possui acesso somente leitura aos orçamentos de Vendas."
      );
    }
  }

  async generate(identity: Identity, input: { salePublicId: string; idempotencyKey: string; templatePublicId?: string }) {
    const { document } = await this.generateWithBuffer(identity, input);
    return document;
  }

  async generateWithBuffer(identity: Identity, input: { salePublicId: string; idempotencyKey: string; templatePublicId?: string }) {
    this.assertWrite(identity);

    // `detail` scopes both the quote and all of its snapshots by clientId.
    const quote = await this.repository.detail(identity.clientId, input.salePublicId);
    if (!quote || quote.documentType !== "quote") {
      throw new ErpDomainError("NOT_FOUND", "Orçamento não encontrado.");
    }
    if (quote.archivedAt) {
      throw new ErpDomainError(
        "CONFLICT",
        "Não é possível gerar um novo PDF para um orçamento arquivado."
      );
    }

    const company = await this.companySettings(identity.clientId);

    // Look for active quote template (by input.templatePublicId or default template for tenant)
    let templateData: { name: string; backgroundBytes?: Buffer | null; hasBackground: boolean } | null = null;
    try {
      const { getPool } = await import("../../../db");
      const pool = getPool();
      const [tplRows] = await pool.execute<any[]>(
        `SELECT public_id, name, background_image_url FROM megadesk_crm_quote_templates
         WHERE client_id = ? ${input.templatePublicId ? "AND public_id = ?" : "ORDER BY is_default DESC, created_at DESC"} LIMIT 1`,
        input.templatePublicId ? [identity.clientId, input.templatePublicId] : [identity.clientId]
      );
      if (tplRows && tplRows[0]) {
        const templatePublicId = String(tplRows[0].public_id);
        let backgroundBytes: Buffer | null = null;
        try {
          const { readCrmClientFile } = await import("../../crm/client-files/files-storage");
          backgroundBytes = await readCrmClientFile(identity.clientId, templatePublicId);
        } catch {
          // file not on disk or template has no file
        }
        templateData = {
          name: String(tplRows[0].name),
          backgroundBytes,
          hasBackground: Boolean(backgroundBytes),
        };
      }
    } catch {
      // In mock/test environments without CRM quote templates table, fallback cleanly
    }

    const bytes = renderQuotePdf({
      company: {
        name: company?.companyName ?? null,
        email: company?.primaryEmail ?? null,
        phone: company?.primaryPhone ?? null,
        whatsapp: company?.primaryWhatsapp ?? null,
        address: company?.address ?? null,
      },
      template: templateData,
      quote: {
        number: quote.orderNumber,
        issuedOn: quote.commercialDate,
        customerName: quote.customerName,
        customerPhone: (quote as any).customerPhone ?? null,
        customerAddress: (quote as any).customerAddress ?? null,
        customerAddressNumber: (quote as any).customerAddressNumber ?? null,
        commercialStatus: quote.commercialStatus,
        paymentTerms: quote.paymentTerms,
        notes: quote.notes,
        documentCustomName: (quote as any).documentCustomName ?? null,
        serviceMetadata: (quote as any).serviceMetadata ?? null,
        items: quote.items.map(item => ({
          description: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          unit: item.unit,
          unitPriceCents: item.unitPriceCents,
          discountCents: item.discountCents,
          lineTotalCents: item.lineTotalCents,
        })),
        subtotalCents: quote.subtotalCents,
        discountCents: quote.discountCents,
        freightCents: quote.freightCents,
        chargesCents: quote.chargesCents,
        totalCents: quote.totalCents,
      },
    });

    const rawCustomName = (quote as any).documentCustomName?.trim();
    const sanitizedCustom = rawCustomName
      ? rawCustomName
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\.pdf$/i, "")
          .replace(/[^\w\s\-\.]/gi, "_")
          .replace(/\s+/g, " ")
          .trim()
      : null;
    const fileName = sanitizedCustom
      ? `${sanitizedCustom}.pdf`
      : `orcamento-${quote.orderNumber}.pdf`;

    const document = await this.documents.storeGeneratedQuotePdf(identity, {
      salePublicId: input.salePublicId,
      idempotencyKey: input.idempotencyKey,
      fileName,
      description: `PDF gerado a partir do orçamento ${quote.orderNumber}.`,
      bytes,
    });

    return { document, bytes };
  }
}
