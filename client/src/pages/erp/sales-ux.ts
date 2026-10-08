import type { SalesAddress, SalesForm } from "./sales-form";

export const SALES_LOOKUP_MIN_LENGTH = 2;

// MySQL DATE's supported range lets the existing bounded metrics query represent
// an unbounded UI filter without changing its aggregation or SQL contract.
const earliestSalesDate = "1000-01-01";
const latestSalesDate = "9999-12-31";

export function salesMetricPeriod(from: string, to: string, defaultFrom: string, defaultTo: string) {
  const label = from === defaultFrom && to === defaultTo
    ? "Vendas no mês"
    : from && to
      ? `Vendas de ${formatSalesDate(from)} a ${formatSalesDate(to)}`
      : from
        ? `Vendas desde ${formatSalesDate(from)}`
        : to
          ? `Vendas até ${formatSalesDate(to)}`
          : "Vendas em todo o período";
  return { from: from || earliestSalesDate, to: to || latestSalesDate, label };
}

function formatSalesDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function salesCsvCell(value: string | number) {
  const raw = String(value);
  // Spreadsheet-facing CSV mitigation, not a universal guarantee: Excel may
  // discard an apostrophe when saving/reopening CSV, while other applications
  // may interpret a tab differently. Use a format with explicit text-typed cells
  // (for example XLSX) when the spreadsheet/round-trip behavior must be assured.
  // Normalize only for detection; preserve the original exported value after
  // the safety prefix, including its accents, controls and Unicode characters.
  const leading = raw.match(/^[\p{White_Space}\p{Cc}\p{Cf}]*/u)?.[0] ?? "";
  const firstMeaningful = raw.slice(leading.length).normalize("NFKC");
  const formulaLike = /^[=+\-@\u2212]/u.test(firstMeaningful);
  const startsWithControl = /[\p{Cc}\p{Cf}]/u.test(leading);
  const safe = formulaLike || startsWithControl ? `\t'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function salesCsv(rows: Array<Array<string | number>>) {
  return `\uFEFF${rows.map(row => row.map(salesCsvCell).join(";")).join("\r\n")}`;
}

export function saleStockPresentation(input: {
  currentAvailable: string | number | null;
  stockExitRecorded: boolean;
  currentStage: string;
}) {
  const quantity = input.currentAvailable === null ? null : Number(input.currentAvailable);
  const availability = quantity === null || !Number.isFinite(quantity) || quantity < 0
    ? "Saldo atual não verificável"
    : quantity === 0
      ? "Sem saldo disponível"
      : `Saldo disponível: ${quantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}`;
  const movement = input.stockExitRecorded
    ? "Baixa de estoque registrada"
    : ["shipped", "received", "completed"].includes(input.currentStage)
      ? "Movimento histórico de baixa não encontrado"
      : "Baixa de estoque ainda não realizada";
  return { availability, movement };
}

export type SalesPaginationItem = number | "ellipsis-left" | "ellipsis-right";

export function salesPaginationItems(
  currentPage: number,
  totalPages: number
): SalesPaginationItem[] {
  if (totalPages <= 0) return [];
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  if (currentPage <= 4) [2, 3, 4, 5].forEach(page => pages.add(page));
  if (currentPage >= totalPages - 3) {
    [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1].forEach(page => pages.add(page));
  }
  const ordered = [...pages]
    .filter(page => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);
  const result: SalesPaginationItem[] = [];
  ordered.forEach((page, index) => {
    const previous = ordered[index - 1];
    if (previous && page - previous > 1) {
      result.push(previous === 1 ? "ellipsis-left" : "ellipsis-right");
    }
    result.push(page);
  });
  return result;
}

export function canRunSalesLookup(value: string) {
  return value.trim().length >= SALES_LOOKUP_MIN_LENGTH;
}

export function salesAddressesMatch(
  shipping: SalesAddress | null | undefined,
  billing: SalesAddress | null | undefined
) {
  if (!shipping || !billing) return !shipping && !billing;
  return (Object.keys(shipping) as Array<keyof SalesAddress>).every(
    key => shipping[key].trim() === billing[key].trim()
  );
}

export function salesDraftProgress(form: SalesForm) {
  return [
    { key: "customer", label: "Cliente", complete: Boolean(form.crmClientId) },
    { key: "products", label: "Produtos", complete: form.items.length > 0 },
    {
      key: "address",
      label: "Endereço",
      complete: Boolean(
        form.shippingAddress?.recipientName.trim() &&
          form.shippingAddress?.street.trim() &&
          form.shippingAddress?.city.trim() &&
          form.shippingAddress?.state.trim()
      ),
    },
    {
      key: "values",
      label: "Valores",
      complete:
        form.items.length > 0 &&
        form.items.every(
          item => Number(item.quantity) > 0 && item.unitPriceCents >= 0
        ),
    },
  ] as const;
}

export type SalesConfirmationRequirement = {
  key: "customer" | "products" | "address" | "payment" | "category" | "account" | "installments";
  label: string;
  complete: boolean;
  actionLabel?: string;
};

export function salesConfirmationRequirements(input: {
  hasCustomer: boolean;
  hasProducts: boolean;
  hasAddress: boolean;
  paymentMethod: string;
  categoryPublicId: string;
  financialAccountPublicId: string;
  installmentCount: number;
  firstDueDate: string;
}): SalesConfirmationRequirement[] {
  return [
    { key: "customer", label: "Cliente", complete: input.hasCustomer },
    { key: "products", label: "Produtos", complete: input.hasProducts },
    { key: "address", label: "Endereço", complete: input.hasAddress },
    {
      key: "payment",
      label: "Forma de pagamento",
      complete: Boolean(input.paymentMethod),
      actionLabel: "Selecionar forma",
    },
    {
      key: "category",
      label: "Categoria financeira",
      complete: Boolean(input.categoryPublicId),
      actionLabel: "Selecionar categoria",
    },
    {
      key: "account",
      label: "Conta prevista",
      complete: Boolean(input.financialAccountPublicId),
      actionLabel: "Selecionar conta",
    },
    {
      key: "installments",
      label: "Parcelas e vencimento",
      complete: input.installmentCount > 0 && Boolean(input.firstDueDate),
      actionLabel: "Definir parcelas",
    },
  ];
}

export function activeSalesFilterCount(input: {
  search: string;
  stage: string;
  paymentStatus: string;
  paymentMethod: string;
  sellerUserId: string;
  customerId?: string;
  from: string;
  to: string;
  defaultFrom: string;
  defaultTo: string;
}) {
  return [
    Boolean(input.search.trim()),
    input.stage !== "all",
    input.paymentStatus !== "all",
    input.paymentMethod !== "all",
    input.sellerUserId !== "all",
    Boolean(input.customerId),
    input.from !== input.defaultFrom || input.to !== input.defaultTo,
  ].filter(Boolean).length;
}
