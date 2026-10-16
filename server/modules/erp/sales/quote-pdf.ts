const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const PAGE_MARGIN = 44;
const ITEMS_PER_PAGE = 13;

export type QuotePdfCompany = {
  name: string | null | undefined;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
};

export type QuotePdfItem = {
  description: string;
  sku: string;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  discountCents: number;
  lineTotalCents: number;
};

export type QuotePdfInput = {
  company: QuotePdfCompany;
  quote: {
    number: string;
    issuedOn: string;
    customerName: string;
    commercialStatus: string;
    paymentTerms?: string | null;
    notes?: string | null;
    items: QuotePdfItem[];
    subtotalCents: number;
    discountCents: number;
    freightCents: number;
    chargesCents: number;
    totalCents: number;
  };
};

function normalizeText(value: unknown, fallback = "—", limit = 160): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.normalize("NFC").slice(0, limit);
}

function pdfText(value: string): string {
  // The built-in PDF Helvetica font supports WinAnsi-like single-byte text. Keep
  // the stream single-byte and replace characters outside that range rather than
  // producing malformed PDF syntax from customer-controlled text.
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[^\u0020-\u00FF]/g, "?")
    .replace(/([\\()])/g, "\\$1");
}

function money(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("QUOTE_PDF_INVALID_MONEY");
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const integer = String(Math.floor(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${integer},${String(absolute % 100).padStart(2, "0")}`;
}

function splitText(value: string, max = 58): string[] {
  const words = normalizeText(value, "", 500).split(" ").filter(Boolean);
  if (!words.length) return ["—"];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > max) {
      if (current) lines.push(current);
      for (let offset = 0; offset < word.length; offset += max) lines.push(word.slice(offset, offset + max));
      current = "";
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > max) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function text(x: number, y: number, size: number, value: string, color = "0.10 0.15 0.23"): string {
  return `BT /F1 ${size} Tf ${color} rg 1 0 0 1 ${x} ${y} Tm (${pdfText(value)}) Tj ET`;
}

function fillRect(x: number, y: number, width: number, height: number, color: string): string {
  return `${color} rg ${x} ${y} ${width} ${height} re f`;
}

function strokeLine(x1: number, y1: number, x2: number, y2: number, color = "0.86 0.89 0.93"): string {
  return `${color} RG 0.6 w ${x1} ${y1} m ${x2} ${y2} l S`;
}

function quoteStatusLabel(value: string): string {
  return ({
    draft: "Em elaboração",
    negotiation: "Em negociação",
    approved: "Aprovado",
    converted: "Convertido em venda",
    lost: "Recusado",
  } as Record<string, string>)[value] ?? "Em elaboração";
}

function assertInput(input: QuotePdfInput): void {
  if (!input.quote.items.length || input.quote.items.length > 500) throw new Error("QUOTE_PDF_INVALID_ITEMS");
  if (!normalizeText(input.quote.number, "")) throw new Error("QUOTE_PDF_INVALID_NUMBER");
  if (!normalizeText(input.quote.customerName, "")) throw new Error("QUOTE_PDF_INVALID_CUSTOMER");
  for (const amount of [input.quote.subtotalCents, input.quote.discountCents, input.quote.freightCents, input.quote.chargesCents, input.quote.totalCents]) {
    if (!Number.isSafeInteger(amount)) throw new Error("QUOTE_PDF_INVALID_MONEY");
  }
  for (const item of input.quote.items) {
    if (!normalizeText(item.description, "")) throw new Error("QUOTE_PDF_INVALID_ITEM");
    for (const amount of [item.unitPriceCents, item.discountCents, item.lineTotalCents]) {
      if (!Number.isSafeInteger(amount)) throw new Error("QUOTE_PDF_INVALID_MONEY");
    }
  }
}

function header(input: QuotePdfInput, page: number, pages: number): string[] {
  const company = input.company;
  const commands = [
    fillRect(0, PAGE_HEIGHT - 104, PAGE_WIDTH, 104, "0.06 0.21 0.40"),
    text(PAGE_MARGIN, PAGE_HEIGHT - 48, 19, normalizeText(company.name, "Empresa", 72), "1 1 1"),
    text(PAGE_MARGIN, PAGE_HEIGHT - 69, 9, "PROPOSTA COMERCIAL", "0.82 0.91 1"),
    text(PAGE_WIDTH - 184, PAGE_HEIGHT - 48, 11, input.quote.number, "1 1 1"),
    text(PAGE_WIDTH - 184, PAGE_HEIGHT - 69, 8, `Emitido em ${normalizeText(input.quote.issuedOn, "—", 20)}`, "0.82 0.91 1"),
    text(PAGE_WIDTH - 184, PAGE_HEIGHT - 84, 8, `Página ${page} de ${pages}`, "0.82 0.91 1"),
    text(PAGE_MARGIN, PAGE_HEIGHT - 132, 8, "CLIENTE", "0.33 0.39 0.48"),
    text(PAGE_MARGIN, PAGE_HEIGHT - 151, 12, normalizeText(input.quote.customerName, "Cliente", 88)),
    text(PAGE_WIDTH - 184, PAGE_HEIGHT - 132, 8, "SITUAÇÃO", "0.33 0.39 0.48"),
    text(PAGE_WIDTH - 184, PAGE_HEIGHT - 151, 10, quoteStatusLabel(input.quote.commercialStatus), "0.13 0.33 0.59"),
    strokeLine(PAGE_MARGIN, PAGE_HEIGHT - 164, PAGE_WIDTH - PAGE_MARGIN, PAGE_HEIGHT - 164),
  ];
  return commands;
}

function itemTable(items: QuotePdfItem[], startAt: number): { commands: string[]; endY: number } {
  let y = startAt;
  const commands = [
    fillRect(PAGE_MARGIN, y - 18, PAGE_WIDTH - PAGE_MARGIN * 2, 18, "0.93 0.96 0.99"),
    text(PAGE_MARGIN + 8, y - 12, 7, "ITEM", "0.18 0.31 0.49"),
    text(PAGE_MARGIN + 44, y - 12, 7, "DESCRIÇÃO", "0.18 0.31 0.49"),
    text(344, y - 12, 7, "QTD.", "0.18 0.31 0.49"),
    text(399, y - 12, 7, "VALOR UNIT.", "0.18 0.31 0.49"),
    text(493, y - 12, 7, "TOTAL", "0.18 0.31 0.49"),
  ];
  y -= 29;
  items.forEach((item, index) => {
    const description = splitText(`${normalizeText(item.description, "Produto", 130)}${item.sku ? ` (${normalizeText(item.sku, "", 36)})` : ""}`, 43);
    const rowHeight = Math.max(22, description.length * 11 + 7);
    commands.push(strokeLine(PAGE_MARGIN, y - rowHeight + 4, PAGE_WIDTH - PAGE_MARGIN, y - rowHeight + 4));
    commands.push(text(PAGE_MARGIN + 8, y - 10, 8, String(index + 1), "0.33 0.39 0.48"));
    description.forEach((line, lineIndex) => commands.push(text(PAGE_MARGIN + 44, y - 10 - lineIndex * 11, 8, line)));
    commands.push(text(344, y - 10, 8, `${normalizeText(item.quantity, "0", 18)} ${normalizeText(item.unit, "un", 12)}`, "0.20 0.25 0.32"));
    commands.push(text(399, y - 10, 8, money(item.unitPriceCents), "0.20 0.25 0.32"));
    commands.push(text(493, y - 10, 8, money(item.lineTotalCents), "0.10 0.15 0.23"));
    y -= rowHeight;
  });
  return { commands, endY: y };
}

function summary(input: QuotePdfInput, y: number): string[] {
  const rows: Array<[string, number]> = [
    ["Subtotal", input.quote.subtotalCents],
    ["Descontos", -Math.abs(input.quote.discountCents)],
    ["Frete", input.quote.freightCents],
    ["Acréscimos", input.quote.chargesCents],
  ];
  const commands = [strokeLine(348, y, PAGE_WIDTH - PAGE_MARGIN, y)];
  let cursor = y - 15;
  rows.forEach(([label, amount]) => {
    commands.push(text(356, cursor, 8, label, "0.33 0.39 0.48"));
    commands.push(text(480, cursor, 8, money(amount)));
    cursor -= 15;
  });
  commands.push(fillRect(348, cursor - 9, PAGE_WIDTH - PAGE_MARGIN - 348, 25, "0.06 0.21 0.40"));
  commands.push(text(356, cursor, 9, "TOTAL", "1 1 1"));
  commands.push(text(469, cursor, 10, money(input.quote.totalCents), "1 1 1"));
  cursor -= 32;
  const terms = normalizeText(input.quote.paymentTerms, "Condições a combinar", 180);
  commands.push(text(PAGE_MARGIN, cursor, 8, "CONDIÇÕES COMERCIAIS", "0.33 0.39 0.48"));
  splitText(terms, 75).forEach((line, index) => commands.push(text(PAGE_MARGIN, cursor - 15 - index * 11, 8, line)));
  const noteY = cursor - 15 - splitText(terms, 75).length * 11 - 13;
  const notes = normalizeText(input.quote.notes, "", 420);
  if (notes) {
    commands.push(text(PAGE_MARGIN, noteY, 8, "OBSERVAÇÕES", "0.33 0.39 0.48"));
    splitText(notes, 75).slice(0, 4).forEach((line, index) => commands.push(text(PAGE_MARGIN, noteY - 15 - index * 11, 8, line)));
  }
  return commands;
}

function footer(input: QuotePdfInput): string[] {
  const contact = [input.company.email, input.company.phone, input.company.whatsapp, input.company.address]
    .map(value => normalizeText(value, "", 90))
    .filter(Boolean)
    .join(" · ");
  return [
    strokeLine(PAGE_MARGIN, 43, PAGE_WIDTH - PAGE_MARGIN, 43),
    text(PAGE_MARGIN, 27, 7, contact || "Documento gerado pelo MegaDesk", "0.40 0.46 0.55"),
  ];
}

function buildPdf(pages: string[]): Buffer {
  const pageReferences = pages.map((_, index) => ({ page: 4 + index * 2, contents: 5 + index * 2 }));
  const objects = new Map<number, Buffer>();
  objects.set(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"));
  objects.set(2, Buffer.from(`<< /Type /Pages /Kids [${pageReferences.map(ref => `${ref.page} 0 R`).join(" ")}] /Count ${pageReferences.length} >>`, "latin1"));
  objects.set(3, Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "latin1"));
  pageReferences.forEach((reference, index) => {
    objects.set(reference.page, Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${reference.contents} 0 R >>`, "latin1"));
    const stream = Buffer.from(pages[index], "latin1");
    objects.set(reference.contents, Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "latin1"),
      stream,
      Buffer.from("\nendstream", "latin1"),
    ]));
  });
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets = [0];
  for (let id = 1; id <= objects.size; id++) {
    offsets[id] = Buffer.concat(chunks).length;
    chunks.push(Buffer.from(`${id} 0 obj\n`, "latin1"), objects.get(id)!, Buffer.from("\nendobj\n", "latin1"));
  }
  const xrefOffset = Buffer.concat(chunks).length;
  chunks.push(Buffer.from(`xref\n0 ${objects.size + 1}\n0000000000 65535 f \n`, "latin1"));
  for (let id = 1; id <= objects.size; id++) chunks.push(Buffer.from(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`, "latin1"));
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.size + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, "latin1"));
  return Buffer.concat(chunks);
}

/** Produces a self-contained, immutable PDF snapshot without fetching external assets. */
export function renderQuotePdf(input: QuotePdfInput): Buffer {
  assertInput(input);
  const groups: QuotePdfItem[][] = [];
  for (let offset = 0; offset < input.quote.items.length; offset += ITEMS_PER_PAGE) groups.push(input.quote.items.slice(offset, offset + ITEMS_PER_PAGE));
  const pages = groups.map((items, index) => {
    const commands = header(input, index + 1, groups.length);
    const table = itemTable(items, PAGE_HEIGHT - 190);
    if (index === groups.length - 1) commands.push(...summary(input, Math.max(175, table.endY - 8)));
    commands.push(...footer(input));
    return commands.join("\n");
  });
  return buildPdf(pages);
}
