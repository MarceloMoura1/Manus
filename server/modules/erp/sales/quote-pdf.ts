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

/** Produces a self-contained, immutable PDF snapshot without fetching external assets. */
export function renderQuotePdf(input: QuotePdfInput): Buffer {
  assertInput(input);
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
