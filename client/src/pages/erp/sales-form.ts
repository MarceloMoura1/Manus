export type SalesAddress = {
  recipientName: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
};

export type SalesFormItem = {
  productPublicId: string;
  inventoryItemPublicId?: string | null;
  productName?: string;
  variantName?: string | null;
  sku?: string;
  unit?: string;
  imagePath?: string | null;
  availableQuantity?: string | null;
  quantity: string;
  unitPriceCents: number;
  discountCents?: number;
  itemType?: "product" | "service";
};

const SERVICE_UNITS = new Set(["serv", "srv", "servico", "serviço", "svc", "h", "hr", "hora", "horas", "mo", "diaria", "diária"]);

export function isSalesItemService(item: { unit?: string | null; itemType?: string | null }): boolean {
  if (item.itemType === "service") return true;
  return SERVICE_UNITS.has(String(item.unit ?? "").trim().toLowerCase());
}

export type SalesForm = {
  publicId?: string;
  documentType: "quote" | "sale";
  crmClientId: string;
  customerName?: string;
  sellerUserId: string;
  commercialDate: string;
  notes: string;
  paymentTerms: string;
  paymentMethod: string;
  expectedDate: string;
  documentCustomName?: string | null;
  serviceMetadata?: Record<string, any> | null;
  shippingAddress?: SalesAddress | null;
  billingAddress?: SalesAddress | null;
  orderDiscountCents?: number;
  freightCents?: number;
  chargesCents?: number;
  items: SalesFormItem[];
};

type SaleDetailForForm = {
  publicId: string;
  documentType: "quote" | "sale";
  crmClientId: string;
  customerName?: string;
  sellerUserId?: string | null;
  commercialDate?: string | null;
  notes: string | null;
  paymentTerms?: string | null;
  paymentMethod?: string | null;
  expectedDate: string | null;
  documentCustomName?: string | null;
  serviceMetadata?: unknown;
  shippingAddress?: SalesAddress | null;
  billingAddress?: SalesAddress | null;
  discountCents?: number;
  freightCents?: number;
  chargesCents?: number;
  items: SalesFormItem[];
};

export const blankSalesAddress = (): SalesAddress => ({
  recipientName: "",
  postalCode: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
});

export const blankSalesForm = (documentType: "quote" | "sale" = "sale"): SalesForm => ({
  documentType,
  crmClientId: "",
  sellerUserId: "",
  commercialDate: new Date().toISOString().slice(0, 10),
  notes: "",
  paymentTerms: "",
  paymentMethod: "",
  expectedDate: "",
  documentCustomName: "",
  serviceMetadata: null,
  shippingAddress: blankSalesAddress(),
  billingAddress: blankSalesAddress(),
  orderDiscountCents: 0,
  freightCents: 0,
  chargesCents: 0,
  items: [],
});

export function salesCommercialDate(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
}

export const salesItemIdentity = (item: SalesFormItem) =>
  `${item.productPublicId}:${item.inventoryItemPublicId ?? "product-only"}`;

export function hasDuplicateSalesItemIdentity(items: SalesFormItem[]) {
  const identities = items
    .filter(item => item.productPublicId)
    .map(salesItemIdentity);
  return new Set(identities).size !== identities.length;
}

const quantityMillis = (value: string) => {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,15}(?:\.\d{1,3})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0"));
};

export function salesStockIssue(item: SalesFormItem) {
  if (isSalesItemService(item)) return null;
  if (item.availableQuantity === null || item.availableQuantity === undefined) return null;
  const requested = quantityMillis(item.quantity);
  const available = quantityMillis(item.availableQuantity);
  if (requested === null || requested <= 0n || available === null || requested <= available) return null;
  return {
    productName: item.productName || item.sku || "Produto",
    availableQuantity: item.availableQuantity,
    requestedQuantity: item.quantity,
  };
}

export function firstSalesStockIssue(items: SalesFormItem[]) {
  return salesStockIssues(items)[0] ?? null;
}

/**
 * Quotes may be recorded with a shortage, but users must see every affected
 * line before they explicitly continue. A sale remains blocked separately by
 * the server-side stock lock.
 */
export function salesStockIssues(items: SalesFormItem[]) {
  return items.flatMap(item => {
    const issue = salesStockIssue(item);
    return issue ? [issue] : [];
  });
}

export function salesFormFromDetail(detail: SaleDetailForForm): SalesForm {
  return {
    publicId: detail.publicId,
    documentType: detail.documentType,
    crmClientId: detail.crmClientId,
    customerName: detail.customerName,
    sellerUserId: detail.sellerUserId ?? "",
    commercialDate: detail.commercialDate ?? new Date().toISOString().slice(0, 10),
    notes: detail.notes ?? "",
    paymentTerms: detail.paymentTerms ?? "",
    paymentMethod: detail.paymentMethod ?? "",
    expectedDate: detail.expectedDate ?? "",
    documentCustomName: (detail as any).documentCustomName ?? "",
    serviceMetadata: typeof detail.serviceMetadata === "object" && detail.serviceMetadata !== null ? (detail.serviceMetadata as Record<string, any>) : null,
    shippingAddress: detail.shippingAddress ?? blankSalesAddress(),
    billingAddress: detail.billingAddress ?? blankSalesAddress(),
    orderDiscountCents: Math.max(
      0,
      (detail.discountCents ?? 0) -
        detail.items.reduce((sum, item) => sum + (item.discountCents ?? 0), 0)
    ),
    freightCents: detail.freightCents ?? 0,
    chargesCents: detail.chargesCents ?? 0,
    items: detail.items.map(item => ({
      ...item,
      inventoryItemPublicId: item.inventoryItemPublicId ?? null,
      discountCents: item.discountCents ?? 0,
    })),
  };
}

export function salesDraftFromForm(form: SalesForm) {
  return {
    documentType: form.documentType,
    crmClientId: form.crmClientId,
    sellerUserId: form.sellerUserId || undefined,
    commercialDate: form.commercialDate || undefined,
    notes: form.notes || undefined,
    paymentTerms: form.paymentTerms || undefined,
    paymentMethod: form.paymentMethod || undefined,
    expectedDate: form.expectedDate || undefined,
    documentCustomName: form.documentCustomName?.trim() || undefined,
    serviceMetadata: form.serviceMetadata ?? undefined,
    shippingAddress: form.shippingAddress ?? undefined,
    billingAddress: form.billingAddress ?? undefined,
    orderDiscountCents: form.orderDiscountCents ?? 0,
    freightCents: form.freightCents ?? 0,
    chargesCents: form.chargesCents ?? 0,
    items: form.items.map(item => ({
      productPublicId: item.productPublicId,
      inventoryItemPublicId: item.inventoryItemPublicId,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      discountCents: item.discountCents ?? 0,
    })),
  };
}

export function selectSalesItemProduct(
  item: SalesFormItem,
  productPublicId: string
): SalesFormItem {
  if (item.productPublicId === productPublicId) return item;
  return { ...item, productPublicId, inventoryItemPublicId: undefined };
}

export function isSalesProductOptionDisabled(
  items: SalesFormItem[],
  itemIndex: number,
  productPublicId: string
) {
  const current = items[itemIndex];
  const candidate =
    current?.productPublicId === productPublicId
      ? current
      : {
          productPublicId,
          inventoryItemPublicId: undefined,
          quantity: current?.quantity ?? "1.000",
          unitPriceCents: current?.unitPriceCents ?? 0,
        };
  const identity = salesItemIdentity(candidate);
  return items.some(
    (item, index) => index !== itemIndex && salesItemIdentity(item) === identity
  );
}

export function calculateSalesFormTotals(form: SalesForm) {
  const partsSubtotalCents = form.items
    .filter(item => !isSalesItemService(item))
    .reduce(
      (sum, item) => sum + Math.round(Number(item.quantity || 0) * item.unitPriceCents),
      0
    );
  const servicesSubtotalCents = form.items
    .filter(item => isSalesItemService(item))
    .reduce(
      (sum, item) => sum + Math.round(Number(item.quantity || 0) * item.unitPriceCents),
      0
    );
  const subtotalCents = partsSubtotalCents + servicesSubtotalCents;
  const itemDiscountCents = form.items.reduce(
    (sum, item) => sum + (item.discountCents ?? 0),
    0
  );
  const discountCents = itemDiscountCents + (form.orderDiscountCents ?? 0);
  const totalCents = subtotalCents - discountCents + (form.freightCents ?? 0);
  const totalWithChargesCents = totalCents + (form.chargesCents ?? 0);
  return {
    subtotalCents,
    partsSubtotalCents,
    servicesSubtotalCents,
    itemDiscountCents,
    discountCents,
    chargesCents: form.chargesCents ?? 0,
    totalCents: totalWithChargesCents,
  };
}

export function splitInstallments(totalCents: number, count: number, firstDueDate: string) {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return [];
  const safeCount = Math.max(1, Math.min(120, Math.trunc(count)));
  const base = Math.floor(totalCents / safeCount);
  const remainder = totalCents - base * safeCount;
  const start = new Date(`${firstDueDate}T12:00:00Z`);
  if (Number.isNaN(start.valueOf())) return [];
  return Array.from({ length: safeCount }, (_, index) => {
    const due = new Date(start);
    due.setUTCMonth(due.getUTCMonth() + index);
    return {
      dueDate: due.toISOString().slice(0, 10),
      amountCents: base + (index < remainder ? 1 : 0),
    };
  });
}
