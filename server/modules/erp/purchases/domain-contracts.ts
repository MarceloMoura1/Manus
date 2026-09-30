import { z } from "zod";
import {
  canWriteErp,
  millisQuantity,
  quantityMillis,
  type OperationalRole,
} from "../contracts";

export const purchaseStatuses = ["draft", "approved", "received", "cancelled"] as const;
export const purchaseRequestStatuses = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "cancelled",
] as const;
export const purchasePriorities = ["low", "normal", "high", "urgent"] as const;
export const quoteStatuses = ["draft", "collecting", "selected", "cancelled"] as const;
export const purchaseDocumentTypes = [
  "proposal",
  "budget",
  "purchase_order",
  "invoice",
  "receipt",
  "payment_proof",
  "other",
] as const;

export type PurchaseStatus = (typeof purchaseStatuses)[number];
export type PurchaseRequestStatus = (typeof purchaseRequestStatuses)[number];
export type PurchaseOperation =
  | "created"
  | "updated"
  | "approval_requested"
  | "approved"
  | "rejected"
  | "cancelled"
  | "quote_created"
  | "proposal_added"
  | "supplier_selected"
  | "received"
  | "balance_closed"
  | "document_linked";

const publicId = z.string().uuid();
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform(value => value || null);
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const quantity = z
  .string()
  .trim()
  .regex(/^\d{1,15}(?:\.\d{1,3})?$/)
  .refine(value => quantityMillis(value) > 0n, "Quantidade deve ser maior que zero.");

const catalogItem = z.object({
  productPublicId: publicId,
  inventoryItemPublicId: publicId.nullish(),
  quantity,
  unitCostCents: money,
  discountCents: money.default(0),
});
const requestItem = z
  .object({
    productPublicId: publicId.optional().nullable(),
    inventoryItemPublicId: publicId.optional().nullable(),
    description: z.string().trim().max(180).optional().nullable(),
    unit: z.string().trim().max(20).optional().nullable(),
    quantity,
    estimatedUnitCostCents: money.default(0),
  })
  .refine(value => Boolean(value.productPublicId || value.description?.trim()), {
    message: "Informe um produto do catálogo ou uma descrição para o item.",
    path: ["description"],
  });
const installments = z
  .array(
    z.object({
      dueDate: z.string().date(),
      amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    })
  )
  .max(60)
  .default([]);

function uniqueCatalogItems(
  items: readonly { productPublicId: string; inventoryItemPublicId?: string | null }[],
  context: z.RefinementCtx
) {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const identity = `${item.productPublicId}:${item.inventoryItemPublicId ?? "product-only"}`;
    if (seen.has(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "inventoryItemPublicId"],
        message: "Inventory item duplicado no pedido.",
      });
    }
    seen.add(identity);
  });
}

const purchaseDraftShape = {
    supplierPublicId: publicId,
    idempotencyKey: publicId.optional(),
    responsibleUserId: z.string().trim().max(80).optional().nullable(),
    notes: optionalText(4_000),
    expectedDate: z.string().date().optional().nullable().transform(value => value || null),
    discountCents: money.default(0),
    freightCents: money.default(0),
    otherExpensesCents: money.default(0),
    paymentTerms: optionalText(500),
    items: z.array(catalogItem).min(1).max(100),
    installments,
};

export const purchaseDraftInput = z
  .object(purchaseDraftShape)
  .superRefine((value, context) => uniqueCatalogItems(value.items, context));

export const purchaseRequestDraftInput = z.object({
  department: optionalText(120),
  priority: z.enum(purchasePriorities).default("normal"),
  reason: z.string().trim().min(3).max(4_000),
  responsibleUserId: z.string().trim().max(80).optional().nullable(),
  items: z.array(requestItem).min(1).max(100),
});
export const purchaseRequestListInput = z.object({
  search: z.string().trim().max(180).default(""),
  status: z.enum(purchaseRequestStatuses).optional(),
  priority: z.enum(purchasePriorities).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export const purchaseListInput = z.object({
  search: z.string().trim().max(180).default(""),
  supplierPublicId: publicId.optional(),
  status: z.enum(purchaseStatuses).optional(),
  view: z.enum(["open", "awaiting_receipt", "partial", "received", "overdue", "cancelled"]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  sort: z.enum(["orderNumber", "createdAt", "total", "expectedDate"]).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export const cancellationInput = z.object({
  publicId,
  reason: z.string().trim().min(3).max(500),
});
export const decisionInput = z.object({
  publicId,
  reason: optionalText(500),
  idempotencyKey: publicId,
});
export const receiveInput = z.object({
  publicId,
  idempotencyKey: publicId,
  notes: optionalText(4_000),
  documentNumber: optionalText(120),
  items: z
    .array(z.object({ orderItemPublicId: publicId, quantity }))
    .min(1)
    .max(100)
    .superRefine((items, context) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item.orderItemPublicId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "orderItemPublicId"],
            message: "Item repetido no recebimento.",
          });
        }
        seen.add(item.orderItemPublicId);
      });
    }),
});
export const closeBalanceInput = z.object({
  publicId,
  reason: z.string().trim().min(3).max(500),
  discountCents: money,
  freightCents: money,
  otherExpensesCents: money,
});
export const quoteCreateInput = z.object({ requestPublicId: publicId });
export const quoteProposalInput = z.object({
  quotePublicId: publicId,
  supplierPublicId: publicId,
  freightCents: money.default(0),
  leadTimeDays: z.number().int().min(0).max(3_650).optional().nullable(),
  paymentTerms: optionalText(500),
  notes: optionalText(4_000),
  supplierFilePublicId: publicId.optional().nullable(),
  items: z
    .array(
      z.object({
        requestItemPublicId: publicId,
        unitCostCents: money,
        discountCents: money.default(0),
      })
    )
    .min(1)
    .max(100),
});
export const quoteSelectionInput = z.object({
  quotePublicId: publicId,
  proposalPublicId: publicId,
});
export const requestToOrderInput = z.object(purchaseDraftShape).omit({ items: true }).extend({
  requestPublicId: publicId,
  items: z.array(catalogItem).min(1).max(100),
}).superRefine((value, context) => uniqueCatalogItems(value.items, context));
export const quoteToOrderInput = z.object({
  quotePublicId: publicId,
  responsibleUserId: z.string().trim().max(80).optional().nullable(),
  notes: optionalText(4_000),
  expectedDate: z.string().date().optional().nullable().transform(value => value || null),
  discountCents: money.default(0),
  otherExpensesCents: money.default(0),
  installments,
});
export const documentLinkInput = z.object({
  entityType: z.enum(["request", "quote", "order"]),
  entityPublicId: publicId,
  supplierFilePublicId: publicId,
  documentType: z.enum(purchaseDocumentTypes),
});
export const supplierMetricsInput = z.object({ supplierPublicId: publicId });

export type PurchaseDraftInput = z.infer<typeof purchaseDraftInput>;
export type PurchaseRequestDraftInput = z.infer<typeof purchaseRequestDraftInput>;
export type PurchaseRequestListInput = z.infer<typeof purchaseRequestListInput>;
export type PurchaseListInput = z.infer<typeof purchaseListInput>;
export type ReceiveInput = z.infer<typeof receiveInput>;
export type QuoteProposalInput = z.infer<typeof quoteProposalInput>;
export type RequestToOrderInput = z.infer<typeof requestToOrderInput>;
export type QuoteToOrderInput = z.infer<typeof quoteToOrderInput>;

export function lineTotalCents(quantityValue: string, unitCostCents: number, discountCents = 0): number {
  const gross = (quantityMillis(quantityValue) * BigInt(unitCostCents) + 500n) / 1_000n;
  const total = gross - BigInt(discountCents);
  if (total < 0n) throw new Error("Desconto do item excede o valor bruto.");
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Total monetário excede o limite seguro.");
  return Number(total);
}

export function sumMoneyCents(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Total monetario excede o limite seguro.");
  }
  return Number(total);
}

export function purchaseTotalCents(
  subtotalCents: number,
  discountCents: number,
  freightCents: number,
  otherExpensesCents: number
): number {
  const total =
    BigInt(subtotalCents) -
    BigInt(discountCents) +
    BigInt(freightCents) +
    BigInt(otherExpensesCents);
  if (total < 0n) throw new Error("Total do pedido nao pode ser negativo.");
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Total monetario excede o limite seguro.");
  }
  return Number(total);
}

export function normalizePurchaseDraft(value: PurchaseDraftInput): PurchaseDraftInput {
  return {
    ...value,
    notes: value.notes?.trim() || null,
    paymentTerms: value.paymentTerms?.trim() || null,
    items: value.items.map(item => ({
      ...item,
      quantity: millisQuantity(quantityMillis(item.quantity)),
    })),
  };
}
const transitions: Record<PurchaseStatus, readonly PurchaseStatus[]> = {
  draft: ["approved", "cancelled"],
  approved: ["cancelled"],
  received: [],
  cancelled: [],
};
export const canTransitionPurchase = (from: PurchaseStatus, to: PurchaseStatus) =>
  transitions[from].includes(to);
export const canWritePurchases = (role: OperationalRole) => canWriteErp(role);
export const purchaseCapabilities = (role: OperationalRole) => ({
  canView: true,
  canCreateRequest: role !== "viewer",
  canEditRequest: role !== "viewer",
  canApprove: role === "admin" || role === "manager",
  canCreateOrder: role === "admin" || role === "manager",
  canEditOrder: role === "admin" || role === "manager",
  canReceive: role === "admin" || role === "manager" || role === "agent",
  canCancel: role === "admin" || role === "manager",
  canViewValues: role !== "agent",
  canViewFinance: role === "admin" || role === "manager" || role === "viewer",
});
export const purchaseEvent = (
  publicIdValue: string,
  operation: PurchaseOperation,
  occurredAt = new Date().toISOString()
) => ({ publicId: publicIdValue, operation, occurredAt });
