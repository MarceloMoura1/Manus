import {
  A4,
  QUOTE_GEOMETRY,
  QUOTE_COLUMNS,
  HEADER_BARS,
  HEADER_BAR_SLANT_MM,
  wrapDescription,
  rowHeightMm,
  itemKindLabel,
  formatQuantity,
  paginateQuoteRows,
  totalsTopMm,
  type QuotePage,
} from "./quote-layout";

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
  template?: {
    name?: string | null;
    niche?: "automotive" | "services" | "general" | string | null;
    backgroundBytes?: Buffer | null;
    hasBackground?: boolean;
  } | null;
  quote: {
    number: string;
    issuedOn: string;
    customerName: string;
    customerPhone?: string | null;
    customerAddress?: string | null;
    customerAddressNumber?: string | null;
    commercialStatus: string;
    paymentTerms?: string | null;
    notes?: string | null;
    documentCustomName?: string | null;
    serviceMetadata?: {
      brandModel?: string | null;
      plate?: string | null;
      year?: string | null;
      color?: string | null;
      km?: string | null;
      entryDate?: string | null;
      exitDate?: string | null;
    } | null;
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
  // Convert common Portuguese accented characters to ISO-8859-1 (WinAnsi) code points
  const winAnsi = value
    .replace(/á/g, "\xE1").replace(/Á/g, "\xC1")
    .replace(/é/g, "\xE9").replace(/É/g, "\xC9")
    .replace(/í/g, "\xED").replace(/Í/g, "\xCD")
    .replace(/ó/g, "\xF3").replace(/Ó/g, "\xD3")
    .replace(/ú/g, "\xFA").replace(/Ú/g, "\xDA")
    .replace(/ã/g, "\xE3").replace(/Ã/g, "\xC3")
    .replace(/õ/g, "\xF5").replace(/Õ/g, "\xD5")
    .replace(/â/g, "\xE2").replace(/Â/g, "\xC2")
    .replace(/ê/g, "\xEA").replace(/Ê/g, "\xCA")
    .replace(/ô/g, "\xF4").replace(/Ô/g, "\xD4")
    .replace(/ç/g, "\xE7").replace(/Ç/g, "\xC7")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[^\u0020-\u00FF]/g, "?")
    .replace(/([\\()])/g, "\\$1");
  return winAnsi;
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

function mmToPt(mm: number): number {
  return mm * 2.83465;
}

function yFromTopMm(topMm: number, heightMm: number): number {
  return PAGE_HEIGHT - (topMm + heightMm) * 2.83465;
}

function yBaselineFromTopMm(topMm: number, fontSize: number): number {
  return PAGE_HEIGHT - (topMm * 2.83465) - (fontSize * 0.78);
}

function fillPolygon(points: Array<[number, number]>, color: string): string {
  if (points.length < 3) return "";
  const [first, ...rest] = points;
  const path = [`${first[0].toFixed(2)} ${first[1].toFixed(2)} m`, ...rest.map(p => `${p[0].toFixed(2)} ${p[1].toFixed(2)} l`), "h", "f"].join(" ");
  return `${color} rg ${path}`;
}

function strokeRect(x: number, y: number, width: number, height: number, color = "0.89 0.89 0.91", lineWidth = 0.6): string {
  return `${color} RG ${lineWidth} w ${x} ${y} ${width} ${height} re S`;
}

function textWidth(value: string, size: number): number {
  return value.length * size * 0.52;
}

function rightText(rightX: number, y: number, size: number, value: string, color = "0.10 0.15 0.23"): string {
  const x = rightX - textWidth(value, size);
  return text(Math.round(x), y, size, value, color);
}

function centerText(centerX: number, y: number, size: number, value: string, color = "0.10 0.15 0.23"): string {
  const x = centerX - (textWidth(value, size) / 2);
  return text(Math.round(x), y, size, value, color);
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

function getJpegDimensions(buf: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset < buf.length - 8) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }
    const len = buf.readUInt16BE(offset + 2);
    offset += 2 + len;
  }
  return { width: 1792, height: 2400 };
}

function letterheadOverlayPage(input: QuotePdfInput, items: QuotePdfItem[], page: number, totalPages: number): string[] {
  const commands: string[] = [];
  const meta = input.quote.serviceMetadata;

  // 1. Order Number: top right box
  commands.push(text(485, 816, 12, input.quote.number, "0.86 0.15 0.15"));

  // 2. Checkbox ORÇAMENTO marcado
  commands.push(text(91, 668, 12, "X", "0.10 0.15 0.23"));

  if (page === 1) {
    // 3. Customer & Vehicle data on dotted lines
    // Linha 1: Nome (top: 76.5mm -> y: 625, x: 108)
    commands.push(text(108, 625, 9, normalizeText(input.quote.customerName, "Cliente", 55)));
    // Linha 1: Fone (top: 76.5mm -> y: 625, x: 414)
    commands.push(text(414, 625, 9, normalizeText(input.quote.customerPhone, "—", 22)));
    // Linha 2: Endereço (top: 83.5mm -> y: 605, x: 128)
    commands.push(text(128, 605, 8, normalizeText(input.quote.customerAddress, "—", 60)));
    // Linha 2: N° (top: 83.5mm -> y: 605, x: 505)
    if (input.quote.customerAddressNumber) {
      commands.push(text(505, 605, 8, normalizeText(input.quote.customerAddressNumber, "", 8)));
    }
    // Linha 3: Marca / Modelo (top: 90.5mm -> y: 585, x: 159)
    commands.push(text(159, 585, 8.5, normalizeText(meta?.brandModel, "—", 35)));
    // Linha 3: Placa (top: 90.5mm -> y: 585, x: 414)
    commands.push(text(414, 585, 9, normalizeText(meta?.plate, "—", 12)));
    // Linha 3: Ano (top: 90.5mm -> y: 585, x: 524)
    commands.push(text(524, 585, 8.5, normalizeText(meta?.year, "—", 6)));
    // Linha 4: Cor (top: 97.5mm -> y: 565, x: 96)
    commands.push(text(96, 565, 8.5, normalizeText(meta?.color, "—", 30)));
    // Linha 4: KM (top: 97.5mm -> y: 565, x: 394)
    commands.push(text(394, 565, 8.5, normalizeText(meta?.km ? `${meta.km} km` : "—", "—", 15)));
    // Linha 5: Data Entrada (top: 104.5mm -> y: 545, x: 150)
    commands.push(text(150, 545, 8.5, normalizeText(meta?.entryDate || input.quote.issuedOn, "—", 15)));
    // Linha 5: Data Saída (top: 104.5mm -> y: 545, x: 434)
    commands.push(text(434, 545, 8.5, normalizeText(meta?.exitDate, "—", 15)));
  } else {
    commands.push(text(108, 625, 9, `Cliente: ${normalizeText(input.quote.customerName, "Cliente", 40)} · Pág ${page}/${totalPages}`));
  }

  // 4. 9-Row Items Table (DESCRIÇÃO DOS SERVIÇOS / PEÇAS)
  // Inicia exatamente abaixo da tarja preta de cabeçalho em top: 136mm (y: 456.5) com cada linha de 10.77mm (30.53 pt)
  const rowStartY = 456.5;
  const rowHeight = 30.53;
  for (let i = 0; i < 9; i++) {
    const item = items[i];
    if (!item) continue;
    const y = rowStartY - i * rowHeight - 16;
    const qtyUnit = item.quantity ? ` (${item.quantity} ${item.unit || "un"})` : "";
    const desc = normalizeText(`${item.description}${qtyUnit}`, "", 65);
    commands.push(text(48, y, 8, desc, "0.12 0.16 0.23"));
    commands.push(text(500, y, 8.5, money(item.lineTotalCents), "0.08 0.12 0.20"));
  }

  // 5. Totais do rodapé
  if (page === totalPages) {
    commands.push(text(495, 168, 8.5, money(input.quote.subtotalCents), "0.08 0.12 0.20"));
    commands.push(text(495, 148, 8.5, money(input.quote.chargesCents), "0.08 0.12 0.20"));
    commands.push(text(495, 129, 8.5, money(input.quote.freightCents), "0.08 0.12 0.20"));
    commands.push(text(488, 100, 10.5, money(input.quote.totalCents), "1 1 1"));

    // Condições Comerciais e Observações
    commands.push(text(48, 168, 7.5, "Condições: " + normalizeText(input.quote.paymentTerms, "A combinar", 65), "0.20 0.25 0.35"));
    if (input.quote.notes) {
      commands.push(text(48, 150, 7.5, "Obs: " + normalizeText(input.quote.notes, "", 65), "0.20 0.25 0.35"));
    }
  }

  return commands;
}

function buildPdf(pages: string[], backgroundImage?: Buffer | null): Buffer {
  const hasBg = Boolean(backgroundImage && backgroundImage.length > 0);
  const baseObj = hasBg ? 5 : 4;
  const pageReferences = pages.map((_, index) => ({ page: baseObj + index * 2, contents: baseObj + 1 + index * 2 }));
  const objects = new Map<number, Buffer>();
  objects.set(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"));
  objects.set(2, Buffer.from(`<< /Type /Pages /Kids [${pageReferences.map(ref => `${ref.page} 0 R`).join(" ")}] /Count ${pageReferences.length} >>`, "latin1"));
  objects.set(3, Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "latin1"));

  if (hasBg && backgroundImage) {
    const { width, height } = getJpegDimensions(backgroundImage);
    objects.set(4, Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${backgroundImage.length} >>\nstream\n`, "latin1"),
      backgroundImage,
      Buffer.from("\nendstream", "latin1"),
    ]));
  }

  const resourcesStr = hasBg
    ? "<< /Font << /F1 3 0 R >> /XObject << /BgImg 4 0 R >> >>"
    : "<< /Font << /F1 3 0 R >> >>";

  pageReferences.forEach((reference, index) => {
    objects.set(reference.page, Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources ${resourcesStr} /Contents ${reference.contents} 0 R >>`, "latin1"));
    const pageStreamContent = hasBg
      ? `q ${PAGE_WIDTH} 0 0 ${PAGE_HEIGHT} 0 0 cm /BgImg Do Q\n${pages[index]}`
      : pages[index];
    const stream = Buffer.from(pageStreamContent, "latin1");
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

export function isAutomotiveQuote(input: QuotePdfInput): boolean {
  if (input.template?.niche === "automotive") return true;
  if (input.template?.name?.toLowerCase().includes("garage")) return true;
  if (input.template?.name?.toLowerCase().includes("oficina")) return true;
  if (input.template?.name?.toLowerCase().includes("automotivo")) return true;
  if (Boolean(input.quote.serviceMetadata?.brandModel || input.quote.serviceMetadata?.plate || input.quote.serviceMetadata?.year || input.quote.serviceMetadata?.km)) return true;
  return false;
}

function automotiveQuotePages(input: QuotePdfInput): string[] {
  const pagesData = paginateQuoteRows(input.quote.items, item => item.description || "");
  const totalPages = pagesData.length;
  const meta = input.quote.serviceMetadata;

  const padX = mmToPt(10);
  const contentWidth = mmToPt(190);

  return pagesData.map((pageData, pageIndex) => {
    const pageNumber = pageIndex + 1;
    const isFirstPage = pageNumber === 1;
    const isLastPage = pageNumber === totalPages;
    const commands: string[] = [];

    // 1. Header
    if (isFirstPage) {
      // Dark Header Body (top: 10mm, height: 34mm)
      commands.push(fillRect(padX, yFromTopMm(10, 34), contentWidth, mmToPt(34), "0.09 0.09 0.11"));

      // Slanted Geometric Bars
      const yBottom = PAGE_HEIGHT - mmToPt(44);
      const yTop = PAGE_HEIGHT - mmToPt(10);
      const slantPt = mmToPt(HEADER_BAR_SLANT_MM);
      for (const bar of HEADER_BARS) {
        const xLeftBottom = padX + mmToPt(bar.xMm);
        const xRightBottom = xLeftBottom + mmToPt(bar.widthMm);
        const xLeftTop = xLeftBottom + slantPt;
        const xRightTop = xRightBottom + slantPt;
        const barColor = bar.color === "#dc2626" ? "0.86 0.15 0.15" : "0.32 0.32 0.36";
        commands.push(fillPolygon([[xLeftBottom, yBottom], [xRightBottom, yBottom], [xRightTop, yTop], [xLeftTop, yTop]], barColor));
      }

      // Red Stripe at bottom of header (top: 44mm, height: 2mm)
      commands.push(fillRect(padX, yFromTopMm(44, 2), contentWidth, mmToPt(2), "0.86 0.15 0.15"));

      // Monogram Badge
      commands.push(fillRect(padX + mmToPt(4), yFromTopMm(14, 12), mmToPt(12), mmToPt(12), "0.86 0.15 0.15"));
      commands.push(centerText(padX + mmToPt(10), yBaselineFromTopMm(22.5, 11), 11, "LG", "1 1 1"));

      // Company Info
      const companyName = normalizeText(input.company.name, "OFICINA AUTOMOTIVA", 40);
      commands.push(text(padX + mmToPt(19), yBaselineFromTopMm(20, 13), 13, companyName, "1 1 1"));

      const compAddr = normalizeText(input.company.address, "", 55);
      const compPhone = normalizeText(input.company.whatsapp || input.company.phone, "", 22);
      const compLine = [compAddr, compPhone ? `Tel: ${compPhone}` : ""].filter(Boolean).join(" · ");
      if (compLine) {
        commands.push(text(padX + mmToPt(19), yBaselineFromTopMm(27, 7.5), 7.5, compLine, "0.63 0.63 0.67"));
      }

      // Title Badge, Order Number & Emission Date (Right side)
      commands.push(rightText(padX + contentWidth - mmToPt(4), yBaselineFromTopMm(19, 7.5), 7.5, "ORÇAMENTO / ORDEM DE SERVIÇO", "0.98 0.65 0.65"));
      commands.push(rightText(padX + contentWidth - mmToPt(4), yBaselineFromTopMm(28, 14), 14, `#${input.quote.number}`, "1 1 1"));
      commands.push(rightText(padX + contentWidth - mmToPt(4), yBaselineFromTopMm(36, 7.5), 7.5, `Emissão: ${normalizeText(input.quote.issuedOn, "—", 15)}`, "0.83 0.83 0.85"));
    } else {
      // Compact Header for Page 2+ (top: 10mm, height: 16mm)
      commands.push(fillRect(padX, yFromTopMm(10, 16), contentWidth, mmToPt(16), "0.09 0.09 0.11"));
      commands.push(fillRect(padX, yFromTopMm(10, 16), mmToPt(3), mmToPt(16), "0.86 0.15 0.15"));
      const compSummary = `${normalizeText(input.company.name, "Oficina")} · Cliente: ${normalizeText(input.quote.customerName, "Cliente", 35)}`;
      commands.push(text(padX + mmToPt(6), yBaselineFromTopMm(20, 9), 9, compSummary, "1 1 1"));
      commands.push(rightText(padX + contentWidth - mmToPt(4), yBaselineFromTopMm(20, 8.5), 8.5, `Orçamento #${input.quote.number} · Pág ${pageNumber}/${totalPages}`, "0.83 0.83 0.85"));
    }

    // 2. Customer & Vehicle Grid (Page 1 Only)
    if (isFirstPage) {
      const colWidth = mmToPt(93.5);
      const col1X = padX;
      const col2X = padX + mmToPt(96.5);
      const gridTopMm = 48;
      const gridHeightMm = 40;

      // Col 1: Customer
      commands.push(fillRect(col1X, yFromTopMm(gridTopMm, gridHeightMm), colWidth, mmToPt(gridHeightMm), "0.98 0.98 0.98"));
      commands.push(strokeRect(col1X, yFromTopMm(gridTopMm, gridHeightMm), colWidth, mmToPt(gridHeightMm), "0.89 0.89 0.91"));
      commands.push(fillRect(col1X, yFromTopMm(gridTopMm, gridHeightMm), mmToPt(2), mmToPt(gridHeightMm), "0.09 0.09 0.11"));
      commands.push(text(col1X + mmToPt(4), yBaselineFromTopMm(54, 7), 7, "DADOS DO CLIENTE", "0.44 0.44 0.48"));
      commands.push(text(col1X + mmToPt(4), yBaselineFromTopMm(61, 9.5), 9.5, normalizeText(input.quote.customerName, "Cliente", 38), "0.04 0.04 0.04"));
      commands.push(text(col1X + mmToPt(4), yBaselineFromTopMm(68, 7.5), 7.5, `Telefone: ${normalizeText(input.quote.customerPhone, "—", 22)}`, "0.15 0.15 0.16"));
      const addr = normalizeText(input.quote.customerAddress, "—", 36);
      const num = input.quote.customerAddressNumber ? ` N° ${normalizeText(input.quote.customerAddressNumber, "", 8)}` : "";
      commands.push(text(col1X + mmToPt(4), yBaselineFromTopMm(75, 7.5), 7.5, `Endereço: ${addr}${num}`, "0.25 0.25 0.27"));

      // Col 2: Vehicle
      commands.push(fillRect(col2X, yFromTopMm(gridTopMm, gridHeightMm), colWidth, mmToPt(gridHeightMm), "0.98 0.98 0.98"));
      commands.push(strokeRect(col2X, yFromTopMm(gridTopMm, gridHeightMm), colWidth, mmToPt(gridHeightMm), "0.89 0.89 0.91"));
      commands.push(fillRect(col2X, yFromTopMm(gridTopMm, gridHeightMm), mmToPt(2), mmToPt(gridHeightMm), "0.86 0.15 0.15"));
      commands.push(text(col2X + mmToPt(4), yBaselineFromTopMm(54, 7), 7, "DADOS DO VEÍCULO / OBJETO", "0.86 0.15 0.15"));

      if (meta?.plate) {
        commands.push(fillRect(col2X + colWidth - mmToPt(26), yFromTopMm(50, 6), mmToPt(22), mmToPt(6), "0.09 0.09 0.11"));
        commands.push(centerText(col2X + colWidth - mmToPt(15), yBaselineFromTopMm(54.2, 6.8), 6.8, normalizeText(meta.plate, "", 10), "1 1 1"));
      }

      commands.push(text(col2X + mmToPt(4), yBaselineFromTopMm(61, 9.5), 9.5, normalizeText(meta?.brandModel, "Veículo não especificado", 38), "0.04 0.04 0.04"));
      const specs = [
        meta?.year ? `Ano: ${meta.year}` : "",
        meta?.color ? `Cor: ${meta.color}` : "",
        meta?.km ? `${meta.km} km` : "",
      ].filter(Boolean).join(" · ") || "—";
      commands.push(text(col2X + mmToPt(4), yBaselineFromTopMm(68, 7.5), 7.5, specs, "0.15 0.15 0.16"));

      const dates = `Entrada: ${normalizeText(meta?.entryDate || input.quote.issuedOn, "—", 12)} · Saída: ${normalizeText(meta?.exitDate, "—", 12)}`;
      commands.push(text(col2X + mmToPt(4), yBaselineFromTopMm(75, 7.5), 7.5, dates, "0.25 0.25 0.27"));
    }

    // 3. Items Table
    const tableTopMm = isFirstPage ? 92 : 30;
    // Table Header (8mm)
    commands.push(fillRect(padX, yFromTopMm(tableTopMm, 8), contentWidth, mmToPt(8), "0.09 0.09 0.11"));

    const c0 = padX;
    const c1 = c0 + mmToPt(10);
    const c2 = c1 + mmToPt(78);
    const c3 = c2 + mmToPt(16);
    const c4 = c3 + mmToPt(22);
    const c5 = c4 + mmToPt(32);
    const c6 = c5 + mmToPt(32);

    commands.push(centerText(c0 + mmToPt(5), yBaselineFromTopMm(tableTopMm + 5.5, 7), 7, "#", "1 1 1"));
    commands.push(text(c1 + mmToPt(2), yBaselineFromTopMm(tableTopMm + 5.5, 7), 7, "DESCRIÇÃO DOS SERVIÇOS / PEÇAS", "1 1 1"));
    commands.push(centerText(c2 + mmToPt(8), yBaselineFromTopMm(tableTopMm + 5.5, 7), 7, "QTD", "1 1 1"));
    commands.push(centerText(c3 + mmToPt(11), yBaselineFromTopMm(tableTopMm + 5.5, 7), 7, "TIPO", "1 1 1"));
    commands.push(rightText(c4 + mmToPt(30), yBaselineFromTopMm(tableTopMm + 5.5, 7), 7, "UNITÁRIO", "1 1 1"));
    commands.push(rightText(c5 + mmToPt(30), yBaselineFromTopMm(tableTopMm + 5.5, 7), 7, "TOTAL", "1 1 1"));

    let rowCursorMm = tableTopMm + 8;
    pageData.items.forEach((item, idx) => {
      const itemNumber = pageData.startIndex + idx + 1;
      const descLines = wrapDescription(item.description || "Item", 38);
      const rowH = rowHeightMm(descLines.length);

      const rowBg = idx % 2 === 1 ? "0.96 0.96 0.96" : "1 1 1";
      commands.push(fillRect(padX, yFromTopMm(rowCursorMm, rowH), contentWidth, mmToPt(rowH), rowBg));
      commands.push(strokeLine(padX, yFromTopMm(rowCursorMm, rowH), padX + contentWidth, yFromTopMm(rowCursorMm, rowH), "0.91 0.91 0.93"));

      commands.push(centerText(c0 + mmToPt(5), yBaselineFromTopMm(rowCursorMm + 5.5, 7.5), 7.5, String(itemNumber), "0.44 0.44 0.48"));

      descLines.forEach((line, lIdx) => {
        commands.push(text(c1 + mmToPt(2), yBaselineFromTopMm(rowCursorMm + 5.5 + lIdx * 4, 7.5), 7.5, line, "0.04 0.04 0.04"));
      });

      const qtyStr = `${formatQuantity(item.quantity)} ${normalizeText(item.unit, "un", 6)}`;
      commands.push(centerText(c2 + mmToPt(8), yBaselineFromTopMm(rowCursorMm + 5.5, 7.5), 7.5, qtyStr, "0.15 0.15 0.16"));

      const kind = itemKindLabel(item.unit);
      const kindBg = kind === "Serviço" ? "0.88 0.95 1.00" : "0.93 0.93 0.95";
      const kindColor = kind === "Serviço" ? "0.01 0.41 0.63" : "0.25 0.25 0.27";
      commands.push(fillRect(c3 + mmToPt(2), yFromTopMm(rowCursorMm + 1.8, 4.8), mmToPt(18), mmToPt(4.8), kindBg));
      commands.push(centerText(c3 + mmToPt(11), yBaselineFromTopMm(rowCursorMm + 5.2, 6.5), 6.5, kind, kindColor));

      commands.push(rightText(c4 + mmToPt(30), yBaselineFromTopMm(rowCursorMm + 5.5, 7.5), 7.5, money(item.unitPriceCents), "0.15 0.15 0.16"));
      commands.push(rightText(c5 + mmToPt(30), yBaselineFromTopMm(rowCursorMm + 5.5, 7.5), 7.5, money(item.lineTotalCents), "0.04 0.04 0.04"));

      rowCursorMm += rowH;
    });

    // 4. Financial Footer & Signature Block (Last Page Only)
    if (isLastPage) {
      const totalsTop = totalsTopMm();
      const leftColWidth = mmToPt(105);
      const rightColX = padX + mmToPt(108);
      const rightColWidth = mmToPt(82);

      // Conditions Box (top: totalsTop, height: 20mm)
      commands.push(fillRect(padX, yFromTopMm(totalsTop, 20), leftColWidth, mmToPt(20), "0.98 0.98 0.98"));
      commands.push(strokeRect(padX, yFromTopMm(totalsTop, 20), leftColWidth, mmToPt(20), "0.89 0.89 0.91"));
      commands.push(text(padX + mmToPt(3), yBaselineFromTopMm(totalsTop + 6, 7.5), 7.5, `Condições de Pagamento: ${normalizeText(input.quote.paymentTerms, "À vista / A combinar", 45)}`, "0.15 0.15 0.16"));
      if (input.quote.notes) {
        commands.push(text(padX + mmToPt(3), yBaselineFromTopMm(totalsTop + 13, 7), 7, `Obs: ${normalizeText(input.quote.notes, "", 50)}`, "0.32 0.32 0.36"));
      }

      // Authorization Box (top: totalsTop + 23mm, height: 39mm)
      const authTop = totalsTop + 23;
      commands.push(strokeRect(padX, yFromTopMm(authTop, 39), leftColWidth, mmToPt(39), "0.80 0.83 0.88"));
      commands.push(text(padX + mmToPt(3), yBaselineFromTopMm(authTop + 6, 6.8), 6.8, "Autorizo a execução dos serviços e o fornecimento das peças descritas", "0.32 0.32 0.36"));
      commands.push(text(padX + mmToPt(3), yBaselineFromTopMm(authTop + 11, 6.8), 6.8, "neste orçamento, de acordo com as condições acima estipuladas.", "0.32 0.32 0.36"));

      commands.push(strokeLine(padX + mmToPt(5), yFromTopMm(authTop + 30, 0), padX + mmToPt(65), yFromTopMm(authTop + 30, 0), "0.09 0.09 0.11"));
      commands.push(centerText(padX + mmToPt(35), yBaselineFromTopMm(authTop + 34, 7), 7, "Assinatura do Cliente", "0.04 0.04 0.04"));
      commands.push(strokeLine(padX + mmToPt(72), yFromTopMm(authTop + 30, 0), padX + mmToPt(100), yFromTopMm(authTop + 30, 0), "0.09 0.09 0.11"));
      commands.push(centerText(padX + mmToPt(86), yBaselineFromTopMm(authTop + 34, 7), 7, "Data: ___/___/____", "0.32 0.32 0.36"));

      const hasServiceItems = input.quote.items.some(i => itemKindLabel(i.unit) === "Serviço");
      const partsSubtotal = hasServiceItems
        ? input.quote.items
            .filter(i => itemKindLabel(i.unit) !== "Serviço")
            .reduce((sum, i) => sum + i.lineTotalCents, 0)
        : input.quote.subtotalCents;
      const laborSubtotal = hasServiceItems
        ? input.quote.items
            .filter(i => itemKindLabel(i.unit) === "Serviço")
            .reduce((sum, i) => sum + i.lineTotalCents, 0) + (input.quote.chargesCents || 0)
        : input.quote.chargesCents;

      // Right Column: Totals (height: 62mm)
      commands.push(fillRect(rightColX, yFromTopMm(totalsTop, 62), rightColWidth, mmToPt(62), "0.98 0.98 0.98"));
      commands.push(strokeRect(rightColX, yFromTopMm(totalsTop, 62), rightColWidth, mmToPt(62), "0.89 0.89 0.91"));

      commands.push(text(rightColX + mmToPt(4), yBaselineFromTopMm(totalsTop + 8, 7.5), 7.5, "Total Peças / Materiais:", "0.32 0.32 0.36"));
      commands.push(rightText(rightColX + rightColWidth - mmToPt(4), yBaselineFromTopMm(totalsTop + 8, 7.5), 7.5, money(partsSubtotal), "0.04 0.04 0.04"));

      commands.push(text(rightColX + mmToPt(4), yBaselineFromTopMm(totalsTop + 16, 7.5), 7.5, "Total Mão de Obra:", "0.32 0.32 0.36"));
      commands.push(rightText(rightColX + rightColWidth - mmToPt(4), yBaselineFromTopMm(totalsTop + 16, 7.5), 7.5, money(laborSubtotal), "0.04 0.04 0.04"));

      commands.push(text(rightColX + mmToPt(4), yBaselineFromTopMm(totalsTop + 24, 7.5), 7.5, "Serviços Terceiros / Frete:", "0.32 0.32 0.36"));
      commands.push(rightText(rightColX + rightColWidth - mmToPt(4), yBaselineFromTopMm(totalsTop + 24, 7.5), 7.5, money(input.quote.freightCents), "0.04 0.04 0.04"));

      if (input.quote.discountCents > 0) {
        commands.push(text(rightColX + mmToPt(4), yBaselineFromTopMm(totalsTop + 32, 7.5), 7.5, "Desconto Aplicado:", "0.09 0.64 0.29"));
        commands.push(rightText(rightColX + rightColWidth - mmToPt(4), yBaselineFromTopMm(totalsTop + 32, 7.5), 7.5, `-${money(input.quote.discountCents)}`, "0.09 0.64 0.29"));
      }

      // Red TOTAL GERAL Bar
      const redBarTop = totalsTop + 50;
      commands.push(fillRect(rightColX, yFromTopMm(redBarTop, 12), rightColWidth, mmToPt(12), "0.86 0.15 0.15"));
      commands.push(text(rightColX + mmToPt(4), yBaselineFromTopMm(redBarTop + 7.5, 9), 9, "TOTAL GERAL", "1 1 1"));
      commands.push(rightText(rightColX + rightColWidth - mmToPt(4), yBaselineFromTopMm(redBarTop + 8, 13), 13, money(input.quote.totalCents), "1 1 1"));
    }

    // 5. Discreet Footer (Every Page)
    commands.push(strokeLine(padX, yFromTopMm(288, 0), padX + contentWidth, yFromTopMm(288, 0), "0.91 0.91 0.93"));
    commands.push(text(padX, yBaselineFromTopMm(293, 7), 7, "Obrigado pela preferência! • Documento emitido via MegaDesk", "0.63 0.63 0.67"));
    commands.push(rightText(padX + contentWidth, yBaselineFromTopMm(293, 7), 7, `Página ${pageNumber} de ${totalPages}`, "0.63 0.63 0.67"));

    return commands.join("\n");
  });
}

/** Produces a self-contained, immutable PDF snapshot without fetching external assets. */
export function renderQuotePdf(input: QuotePdfInput): Buffer {
  assertInput(input);

  if (isAutomotiveQuote(input)) {
    const pages = automotiveQuotePages(input);
    return buildPdf(pages, null);
  }

  const isLetterhead = Boolean(input.template?.hasBackground && input.template?.backgroundBytes);
  const groups: QuotePdfItem[][] = [];
  if (input.quote.items.length <= 9) {
    groups.push(input.quote.items);
  } else {
    // Pagination rule: if > 9 items, break Page 1 (items 1 to 9) and Page 2 (subsequent items + totals)
    groups.push(input.quote.items.slice(0, 9));
    const remaining = input.quote.items.slice(9);
    const SUBSEQUENT_PAGE_SIZE = 14;
    for (let offset = 0; offset < remaining.length; offset += SUBSEQUENT_PAGE_SIZE) {
      groups.push(remaining.slice(offset, offset + SUBSEQUENT_PAGE_SIZE));
    }
  }

  const pages = groups.map((items, index) => {
    if (isLetterhead) {
      return letterheadOverlayPage(input, items, index + 1, groups.length).join("\n");
    }
    const commands = header(input, index + 1, groups.length);
    const table = itemTable(items, PAGE_HEIGHT - 190);
    commands.push(...table.commands);
    if (index === groups.length - 1) commands.push(...summary(input, Math.max(175, table.endY - 8)));
    commands.push(...footer(input));
    return commands.join("\n");
  });

  return buildPdf(pages, isLetterhead ? input.template?.backgroundBytes : null);
}
