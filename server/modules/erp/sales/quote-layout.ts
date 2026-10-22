/**
 * Shared layout model for the native automotive quote theme.
 *
 * Both the HTML preview (crm/proposals/quote-automotive-html.ts) and the native PDF writer
 * (erp/sales/quote-pdf.ts) consume the same geometry, description wrapping and pagination, so the
 * "Ver Prévia" sheet and the downloaded/WhatsApp PDF break pages at exactly the same rows.
 * Nothing here depends on a raster letterhead: all measures are design constants of the vector sheet.
 */

/** All vertical measures are millimetres from the top edge of an A4 sheet (210 x 297 mm). */
export const A4 = {
  widthMm: 210,
  heightMm: 297,
  padXMm: 10,
  contentWidthMm: 190,
} as const;

export const QUOTE_GEOMETRY = {
  /** Full header with logo, title and number (first page). */
  headerMm: 36,
  /** Compact header repeated from page 2. */
  compactHeaderMm: 18,
  gapMm: 4,
  /** Two-column client / vehicle block (first page only). */
  infoBlockMm: 40,
  tableHeaderMm: 8,
  /** Totals + authorization/signature block (last page only). */
  totalsMm: 62,
  footerMm: 10,
  /** Height of a single-line table row and of every extra wrapped line. */
  rowBaseMm: 8.5,
  rowExtraLineMm: 4,
  /** Safety margin so rounding between HTML and PDF never pushes a row off the sheet. */
  safetyMm: 2,
} as const;

/** Table column widths in mm; they sum to {@link A4.contentWidthMm}. */
export const QUOTE_COLUMNS = {
  itemMm: 10,
  descriptionMm: 78,
  quantityMm: 16,
  kindMm: 22,
  unitMm: 32,
  totalMm: 32,
} as const;

/** Conservative characters-per-line estimate of the description column (shared by HTML and PDF). */
export const QUOTE_DESCRIPTION_CHARS = 40;

export const QUOTE_PALETTE = {
  red: "#dc2626",
  dark: "#18181b",
  darkSoft: "#27272a",
  zebra: "#f4f4f5",
  line: "#e4e4e7",
  muted: "#71717a",
  ink: "#18181b",
} as const;

/** Header body height (mm) without the 2mm red stripe that closes it. */
export const HEADER_BODY_MM = 34;
export const HEADER_STRIPE_MM = 2;
/** Horizontal lean (mm) of the sporty parallelogram bars. */
export const HEADER_BAR_SLANT_MM = 10;
/** Geometric bars: x/width in mm across the 34mm header body. */
export const HEADER_BARS = [
  { xMm: 104, widthMm: 7, color: "#dc2626" },
  { xMm: 113, widthMm: 3, color: "#52525b" },
  { xMm: 118, widthMm: 14, color: "#dc2626" },
] as const;

/** Word-wraps a description; very long words are hard-split so values never collide. */
export function wrapDescription(value: string, max = QUOTE_DESCRIPTION_CHARS): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [""];
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

export function rowHeightMm(lineCount: number): number {
  const lines = Math.max(1, lineCount);
  return QUOTE_GEOMETRY.rowBaseMm + (lines - 1) * QUOTE_GEOMETRY.rowExtraLineMm;
}

const SERVICE_UNITS = new Set(["serv", "srv", "servico", "serviço", "svc", "h", "hr", "hora", "horas", "mo", "diaria", "diária"]);

/** Items carry no explicit kind; hour/service units or SRV skus are labelled "Serviço", everything else "Peça". */
export function itemKindLabel(unit: string | null | undefined, sku?: string | null | undefined): "Serviço" | "Peça" {
  if (sku && (sku.startsWith("SRV-") || sku.startsWith("SRV:"))) return "Serviço";
  return SERVICE_UNITS.has(String(unit ?? "").trim().toLowerCase()) ? "Serviço" : "Peça";
}

export function formatQuantity(quantity: string | number | null | undefined): string {
  const parsed = Number(quantity);
  if (!Number.isFinite(parsed)) return String(quantity ?? "");
  return parsed.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

/** Top (mm) where the first row of a page starts. */
export function rowsStartMm(pageIndex: number): number {
  const g = QUOTE_GEOMETRY;
  return pageIndex === 0
    ? g.headerMm + g.gapMm + g.infoBlockMm + g.gapMm + g.tableHeaderMm
    : g.compactHeaderMm + g.gapMm + g.tableHeaderMm;
}

/** Top (mm) of the footer-anchored totals block. */
export function totalsTopMm(): number {
  const g = QUOTE_GEOMETRY;
  return A4.heightMm - g.footerMm - g.gapMm - g.totalsMm;
}

/** Bottom (mm) available for rows; the last page also reserves the totals/signature block. */
export function rowsEndMm(isLast: boolean): number {
  const g = QUOTE_GEOMETRY;
  return isLast ? totalsTopMm() - g.gapMm : A4.heightMm - g.footerMm - g.gapMm;
}

export function rowsCapacityMm(pageIndex: number, isLast: boolean): number {
  return rowsEndMm(isLast) - rowsStartMm(pageIndex) - QUOTE_GEOMETRY.safetyMm;
}

export type QuotePage<T> = { items: T[]; startIndex: number };

/**
 * Flows items onto pages by real wrapped height.
 * 1. Greedy fill using the "continues on next page" capacity.
 * 2. If the final page cannot also hold the totals + signature block, its trailing rows move to a new
 *    final page, so the closing block is never split or clipped.
 */
export function paginateQuoteRows<T>(items: T[], describe: (item: T) => string): QuotePage<T>[] {
  const heights = items.map(item => rowHeightMm(wrapDescription(describe(item)).length));
  const pages: QuotePage<T>[] = [];
  let cursor = 0;
  while (cursor < items.length) {
    const capacity = rowsCapacityMm(pages.length, false);
    let used = 0;
    const start = cursor;
    while (cursor < items.length && (cursor === start || used + heights[cursor] <= capacity)) {
      used += heights[cursor];
      cursor += 1;
    }
    pages.push({ items: items.slice(start, cursor), startIndex: start });
  }
  if (!pages.length) return [{ items: [], startIndex: 0 }];

  const lastIndex = pages.length - 1;
  const last = pages[lastIndex];
  const lastCapacity = rowsCapacityMm(lastIndex, true);
  let used = 0;
  let keep = 0;
  for (; keep < last.items.length; keep += 1) {
    const height = heights[last.startIndex + keep];
    if (keep > 0 && used + height > lastCapacity) break;
    used += height;
  }
  if (keep < last.items.length) {
    pages[lastIndex] = { items: last.items.slice(0, keep), startIndex: last.startIndex };
    pages.push({ items: last.items.slice(keep), startIndex: last.startIndex + keep });
  }
  return pages;
}
