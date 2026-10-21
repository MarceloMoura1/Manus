import {
  A4,
  QUOTE_PALETTE,
  itemKindLabel,
  formatQuantity,
  paginateQuoteRows,
  wrapDescription,
  type QuotePage,
} from "../../erp/sales/quote-layout";

export type AutomotiveQuoteInput = {
  company: {
    companyName: string;
    primaryEmail?: string | null;
    primaryPhone?: string | null;
    primaryWhatsapp?: string | null;
    address?: string | null;
    logoUrl?: string | null;
  };
  quote: {
    publicId: string;
    orderNumber: string;
    commercialDate: string;
    customerName: string;
    customerPhone?: string | null;
    customerAddress?: string | null;
    customerAddressNumber?: string | null;
    paymentTerms?: string | null;
    notes?: string | null;
    subtotalCents: number;
    discountCents: number;
    freightCents: number;
    chargesCents: number;
    totalCents: number;
    serviceMetadata?: {
      brandModel?: string | null;
      plate?: string | null;
      year?: string | null;
      color?: string | null;
      km?: string | null;
      entryDate?: string | null;
      exitDate?: string | null;
    } | null;
  };
  items: Array<{
    productName?: string | null;
    description?: string | null;
    sku?: string | null;
    quantity: string | number;
    unit?: string | null;
    unitPriceCents: number;
    discountCents?: number;
    lineTotalCents: number;
  }>;
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
 * Compiles the complete semantic vector A4 pages (HTML/CSS) for the automotive quote theme.
 * Pure vector typography, modern automotive racing stripes (red/dark gray), 2-column client/vehicle grid,
 * clear items table with piece/service classification, and official authorization signature block.
 */
export function renderAutomotiveQuotePages(input: AutomotiveQuoteInput): Array<{ pageNumber: number; html: string }> {
  const { company, quote, items } = input;
  const meta = quote.serviceMetadata || {};

  // Paginate items dynamically according to wrapped description heights and safety margins
  const pagesData: QuotePage<typeof items[0]>[] = paginateQuoteRows(items, item => item.productName || item.description || "");
  const totalPages = pagesData.length;

  return pagesData.map((pageData, pageIndex) => {
    const pageNumber = pageIndex + 1;
    const isFirstPage = pageNumber === 1;
    const isLastPage = pageNumber === totalPages;

    const companyName = escapeHtml(company.companyName || "Oficina Automotiva");
    const companyPhone = escapeHtml(company.primaryWhatsapp || company.primaryPhone || "");
    const companyAddress = escapeHtml(company.address || "");
    const customerName = escapeHtml(quote.customerName || "Cliente");
    const customerPhone = escapeHtml(quote.customerPhone || "—");
    const customerAddress = escapeHtml(quote.customerAddress || "—");
    const customerAddressNum = quote.customerAddressNumber ? ` N° ${escapeHtml(quote.customerAddressNumber)}` : "";
    const orderNumber = escapeHtml(quote.orderNumber);
    const issuedDate = formatDate(quote.commercialDate);

    // Header component (Full on Page 1, Compact on subsequent pages)
    const headerHtml = isFirstPage
      ? `
      <!-- CABEÇALHO ESPORTIVO AUTOMOTIVO (LOW GARAGE STYLE) -->
      <header style="position: relative; background: #18181b; color: #ffffff; border-radius: 8px 8px 0 0; overflow: hidden; padding: 14px 18px 12px; margin-bottom: 8px;">
        <!-- Barras esportivas geométricas em vermelho e cinza -->
        <div style="position: absolute; top: 0; right: 28%; width: 14px; height: 100%; background: #dc2626; transform: skewX(-24deg); opacity: 0.95;"></div>
        <div style="position: absolute; top: 0; right: calc(28% + 18px); width: 6px; height: 100%; background: #52525b; transform: skewX(-24deg); opacity: 0.8;"></div>
        <div style="position: absolute; top: 0; right: calc(28% + 28px); width: 22px; height: 100%; background: #dc2626; transform: skewX(-24deg); opacity: 0.35;"></div>

        <div style="position: relative; z-index: 2; display: flex; align-items: center; justify-content: space-between;">
          <!-- Marca / Logo da Oficina -->
          <div style="display: flex; align-items: center; gap: 12px;">
            ${company.logoUrl ? `
              <img src="${escapeHtml(company.logoUrl)}" alt="Logo" style="max-height: 44px; max-width: 140px; object-fit: contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));" />
            ` : `
              <div style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; background: #dc2626; border-radius: 6px; color: #ffffff; font-weight: 900; font-size: 20px; letter-spacing: -1px; box-shadow: 0 2px 6px rgba(220,38,38,0.5);">
                LG
              </div>
            `}
            <div>
              <div style="font-size: 19px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; line-height: 1.1; color: #ffffff;">
                ${companyName}
              </div>
              <div style="font-size: 9.5px; color: #a1a1aa; margin-top: 2px;">
                ${companyAddress ? `<span>${companyAddress}</span>` : ""}
                ${companyPhone ? `<span style="margin-left: 8px; color: #f43f5e; font-weight: 600;">Tel: ${companyPhone}</span>` : ""}
              </div>
            </div>
          </div>

          <!-- Título da Proposta e Número -->
          <div style="text-align: right;">
            <div style="display: inline-block; background: rgba(220, 38, 38, 0.2); border: 1px solid #dc2626; color: #fca5a5; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; padding: 2px 8px; border-radius: 4px; margin-bottom: 3px;">
              Orçamento / Ordem de Serviço
            </div>
            <div style="font-size: 20px; font-weight: 900; color: #ffffff; letter-spacing: 0.04em; text-shadow: 0 1px 3px rgba(0,0,0,0.6);">
              #${orderNumber}
            </div>
            <div style="font-size: 9px; color: #d4d4d8;">
              Emissão: <strong>${issuedDate}</strong>
            </div>
          </div>
        </div>

        <!-- Tarja inferior vermelha fina -->
        <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #dc2626 0%, #ef4444 60%, #18181b 100%);"></div>
      </header>
      `
      : `
      <!-- CABEÇALHO COMPACTO PÁGINA 2+ -->
      <header style="background: #18181b; color: #ffffff; border-radius: 6px; padding: 8px 14px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; border-left: 4px solid #dc2626;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <strong style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #ffffff;">${companyName}</strong>
          <span style="color: #71717a;">•</span>
          <span style="font-size: 11px; color: #e4e4e7;">Cliente: <strong>${customerName}</strong></span>
        </div>
        <div style="font-size: 11px; color: #d4d4d8;">
          Orçamento <strong>#${orderNumber}</strong> · Página <strong>${pageNumber} de ${totalPages}</strong>
        </div>
      </header>
      `;

    // 2-Column Grid: Customer & Vehicle (Page 1 only)
    const clientVehicleBlockHtml = isFirstPage
      ? `
      <!-- DADOS DO CLIENTE & VEÍCULO (GRID 2 COLUNAS) -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
        <!-- Coluna 1: Cliente -->
        <div style="background: #fafafa; border: 1px solid #e4e4e7; border-left: 3px solid #18181b; border-radius: 6px; padding: 8px 12px; font-size: 10px; line-height: 1.45;">
          <div style="font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #71717a; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
            <span>👤 DADOS DO CLIENTE</span>
          </div>
          <div style="font-size: 11px; font-weight: 700; color: #09090b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${customerName}
          </div>
          <div style="color: #27272a; margin-top: 2px;">
            <strong>Telefone:</strong> ${customerPhone}
          </div>
          <div style="color: #3f3f46; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            <strong>Endereço:</strong> ${customerAddress}${customerAddressNum}
          </div>
        </div>

        <!-- Coluna 2: Veículo -->
        <div style="background: #fafafa; border: 1px solid #e4e4e7; border-left: 3px solid #dc2626; border-radius: 6px; padding: 8px 12px; font-size: 10px; line-height: 1.45;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <div style="font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #dc2626;">
              🚗 DADOS DO VEÍCULO / OBJETO
            </div>
            ${meta.plate ? `
              <div style="background: #18181b; color: #ffffff; font-size: 9px; font-weight: 800; padding: 1px 6px; border-radius: 3px; letter-spacing: 0.06em; border: 1px solid #3f3f46;">
                ${escapeHtml(meta.plate)}
              </div>
            ` : ""}
          </div>
          <div style="font-size: 11px; font-weight: 700; color: #09090b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${escapeHtml(meta.brandModel || "Veículo não especificado")}
          </div>
          <div style="color: #27272a; display: flex; gap: 8px; margin-top: 2px;">
            <span><strong>Ano:</strong> ${escapeHtml(meta.year || "—")}</span>
            <span><strong>Cor:</strong> ${escapeHtml(meta.color || "—")}</span>
            <span><strong>KM:</strong> ${escapeHtml(meta.km ? `${meta.km} km` : "—")}</span>
          </div>
          <div style="color: #3f3f46; display: flex; gap: 8px;">
            <span><strong>Entrada:</strong> ${formatDate(meta.entryDate || quote.commercialDate)}</span>
            <span><strong>Saída/Previsão:</strong> ${formatDate(meta.exitDate)}</span>
          </div>
        </div>
      </div>
      `
      : "";

    // Table of Items / Services / Parts
    const tableRowsHtml = pageData.items
      .map((item, idx) => {
        const itemNumber = pageData.startIndex + idx + 1;
        const desc = escapeHtml(item.productName || item.description || "Item");
        const sku = item.sku ? ` <span style="color: #71717a; font-size: 9px;">(${escapeHtml(item.sku)})</span>` : "";
        const qtyFormatted = formatQuantity(item.quantity);
        const unit = escapeHtml(item.unit || "un");
        const kind = itemKindLabel(item.unit);
        const kindBadge = kind === "Serviço"
          ? `<span style="background: #e0f2fe; color: #0369a1; font-weight: 700; font-size: 8.5px; padding: 2px 6px; border-radius: 4px; border: 1px solid #bae6fd;">Serviço</span>`
          : `<span style="background: #f4f4f5; color: #3f3f46; font-weight: 700; font-size: 8.5px; padding: 2px 6px; border-radius: 4px; border: 1px solid #e4e4e7;">Peça</span>`;
        const unitPrice = money(item.unitPriceCents);
        const lineTotal = money(item.lineTotalCents);
        const isZebra = idx % 2 === 1;

        return `
        <tr style="background: ${isZebra ? "#fcfcfd" : "#ffffff"}; border-bottom: 1px solid #f1f5f9; font-size: 10px;">
          <td style="padding: 6px 8px; text-align: center; color: #71717a; font-weight: 700; width: 32px;">${itemNumber}</td>
          <td style="padding: 6px 8px; color: #09090b; font-weight: 500; line-height: 1.35; word-break: break-word;">
            ${desc}${sku}
          </td>
          <td style="padding: 6px 8px; text-align: center; color: #27272a; font-weight: 600; white-space: nowrap; width: 55px;">
            ${qtyFormatted} <span style="font-size: 8.5px; color: #71717a;">${unit}</span>
          </td>
          <td style="padding: 6px 8px; text-align: center; width: 70px;">
            ${kindBadge}
          </td>
          <td style="padding: 6px 8px; text-align: right; color: #27272a; white-space: nowrap; width: 85px;">
            ${unitPrice}
          </td>
          <td style="padding: 6px 8px; text-align: right; color: #09090b; font-weight: 700; white-space: nowrap; width: 95px;">
            ${lineTotal}
          </td>
        </tr>`;
      })
      .join("");

    const tableHtml = `
      <!-- TABELA DE ITENS COM CABEÇALHO ESCURO PROFISSIONAL -->
      <div style="border: 1px solid #e4e4e7; border-radius: 6px; overflow: hidden; margin-bottom: 8px;">
        <table style="width: 100%; border-collapse: collapse; table-layout: fixed;">
          <thead>
            <tr style="background: #18181b; color: #ffffff; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em;">
              <th style="padding: 7px 8px; text-align: center; width: 32px; font-weight: 700;">#</th>
              <th style="padding: 7px 8px; text-align: left; font-weight: 700;">Descrição dos Serviços / Peças</th>
              <th style="padding: 7px 8px; text-align: center; width: 55px; font-weight: 700;">Qtd</th>
              <th style="padding: 7px 8px; text-align: center; width: 70px; font-weight: 700;">Tipo</th>
              <th style="padding: 7px 8px; text-align: right; width: 85px; font-weight: 700;">Unitário</th>
              <th style="padding: 7px 8px; text-align: right; width: 95px; font-weight: 700;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
      </div>
    `;

    // Totals & Authorization Signature Block (Last Page Only)
    const totalsAndAuthHtml = isLastPage
      ? `
      <!-- RODAPÉ FINANCEIRO E AUTORIZAÇÃO / ASSINATURA -->
      <div style="display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 10px; margin-top: auto; padding-top: 6px;">
        <!-- Coluna Esquerda: Condições Comerciais + Autorização de Assinatura -->
        <div style="display: flex; flex-direction: column; justify-content: space-between; gap: 8px;">
          <!-- Condições -->
          <div style="background: #fafafa; border: 1px solid #e4e4e7; border-radius: 6px; padding: 7px 10px; font-size: 9.5px; line-height: 1.4; color: #27272a;">
            <div><strong>Condições de Pagamento:</strong> ${escapeHtml(quote.paymentTerms || "À vista / A combinar")}</div>
            ${quote.notes ? `<div style="margin-top: 3px; color: #52525b;"><strong>Obs:</strong> ${escapeHtml(quote.notes)}</div>` : ""}
          </div>

          <!-- Bloco de Autorização do Cliente -->
          <div style="border: 1px dashed #cbd5e1; border-radius: 6px; padding: 8px 12px; background: #ffffff;">
            <div style="font-size: 8.5px; color: #52525b; line-height: 1.35; margin-bottom: 14px;">
              Autorizo a execução dos serviços e o fornecimento das peças descritas neste orçamento, de acordo com as condições acima estipuladas.
            </div>
            <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 10px;">
              <div style="flex: 1; border-top: 1px solid #18181b; text-align: center; padding-top: 3px; font-size: 9px; font-weight: 700; color: #09090b;">
                Assinatura do Cliente
              </div>
              <div style="width: 90px; border-top: 1px solid #18181b; text-align: center; padding-top: 3px; font-size: 9px; font-weight: 600; color: #52525b;">
                Data: ___/___/_____
              </div>
            </div>
          </div>
        </div>

        <!-- Coluna Direita: Totais Segregados e Tarja Vermelha do Total Geral -->
        <div style="background: #fafafa; border: 1px solid #e4e4e7; border-radius: 6px; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between;">
          <div style="padding: 8px 12px; font-size: 10px; line-height: 1.7;">
            <div style="display: flex; justify-content: space-between; color: #52525b;">
              <span>Total Peças / Materiais:</span>
              <strong style="color: #09090b;">${money(quote.subtotalCents)}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; color: #52525b;">
              <span>Total Mão de Obra:</span>
              <strong style="color: #09090b;">${money(quote.chargesCents || 0)}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; color: #52525b;">
              <span>Serviços Terceiros / Frete:</span>
              <strong style="color: #09090b;">${money(quote.freightCents || 0)}</strong>
            </div>
            ${quote.discountCents > 0 ? `
              <div style="display: flex; justify-content: space-between; color: #16a34a;">
                <span>Desconto Aplicado:</span>
                <strong>-${money(quote.discountCents)}</strong>
              </div>
            ` : ""}
          </div>

          <!-- TARJA VERMELHA DO TOTAL GERAL EM DESTAQUE -->
          <div style="background: #dc2626; color: #ffffff; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #b91c1c;">
            <span style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">TOTAL GERAL</span>
            <span style="font-size: 17px; font-weight: 900; letter-spacing: -0.02em;">${money(quote.totalCents)}</span>
          </div>
        </div>
      </div>
      `
      : "";

    // Footer note
    const footerHtml = `
      <!-- RODAPÉ INFORMATIVO DISCRETO -->
      <footer style="margin-top: 8px; padding-top: 6px; border-top: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; font-size: 8px; color: #a1a1aa;">
        <span>Obrigado pela preferência! • Documento emitido via MegaDesk</span>
        <span>Página ${pageNumber} de ${totalPages}</span>
      </footer>
    `;

    const pageHtml = `
      <div class="a4-sheet native-automotive-sheet" style="position: relative; width: 210mm; min-height: 297mm; height: 297mm; max-height: 297mm; box-sizing: border-box; overflow: hidden; padding: 10mm 10mm 8mm; background: #ffffff; color: #18181b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; justify-content: space-between;">
        <meta charset="UTF-8">
        <div>
          ${headerHtml}
          ${clientVehicleBlockHtml}
          ${tableHtml}
        </div>
        <div>
          ${totalsAndAuthHtml}
          ${footerHtml}
        </div>
      </div>
    `.trim();

    return {
      pageNumber,
      html: pageHtml,
    };
  });
}
