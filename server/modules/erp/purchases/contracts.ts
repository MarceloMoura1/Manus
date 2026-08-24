import { z } from "zod";
import {
  canWriteErp,
  millisQuantity,
  quantityMillis,
  type OperationalRole,
} from "../contracts";
export const purchaseStatuses = [
  "draft",
  "approved",
  "received",
  "cancelled",
] as const;
export type PurchaseStatus = (typeof purchaseStatuses)[number];
export type PurchaseOperation =
  | "created"
  | "updated"
  | "approved"
  | "cancelled"
  | "received";
const quantity = z
  .string()
  .trim()
  .regex(/^\d{1,15}(?:\.\d{1,3})?$/)
  .refine(v => quantityMillis(v) > 0n, "Quantidade deve ser maior que zero.");
const item = z.object({
  productPublicId: z.string().uuid(),
  quantity,
  unitCostCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export const purchaseDraftInput = z
  .object({
    supplierPublicId: z.string().uuid(),
    notes: z
      .string()
      .trim()
      .max(4_000)
      .optional()
      .transform(v => v || null),
    expectedDate: z
      .string()
      .date()
      .optional()
      .transform(v => v || null),
    items: z.array(item).min(1).max(100),
  })
  .superRefine((v, c) => {
    const seen = new Set<string>();
    v.items.forEach((x, i) => {
      if (seen.has(x.productPublicId))
        c.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", i, "productPublicId"],
          message: "Produto duplicado no pedido.",
        });
      seen.add(x.productPublicId);
    });
  });
export const purchaseListInput = z.object({
  search: z.string().trim().max(180).default(""),
  status: z.enum(purchaseStatuses).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  sort: z.enum(["orderNumber", "createdAt", "total"]).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export const cancellationInput = z.object({
  publicId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});
export const receiveInput = z.object({
  publicId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
});
export type PurchaseDraftInput = z.infer<typeof purchaseDraftInput>;
export type PurchaseListInput = z.infer<typeof purchaseListInput>;
export function lineTotalCents(q: string, c: number): number {
  const total = (quantityMillis(q) * BigInt(c) + 500n) / 1_000n;
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Total monetário excede o limite seguro.");
  return Number(total);
}
export function normalizePurchaseDraft(
  v: PurchaseDraftInput
): PurchaseDraftInput {
  return {
    ...v,
    notes: v.notes?.trim() || null,
    items: v.items.map(x => ({
      ...x,
      quantity: millisQuantity(quantityMillis(x.quantity)),
    })),
  };
}
const transitions: Record<PurchaseStatus, readonly PurchaseStatus[]> = {
  draft: ["approved", "cancelled"],
  approved: ["received", "cancelled"],
  received: [],
  cancelled: [],
};
export const canTransitionPurchase = (
  from: PurchaseStatus,
  to: PurchaseStatus
) => transitions[from].includes(to);
export const canWritePurchases = (role: OperationalRole) => canWriteErp(role);
export const purchaseEvent = (
  publicId: string,
  operation: PurchaseOperation,
  occurredAt = new Date().toISOString()
) => ({ publicId, operation, occurredAt });
