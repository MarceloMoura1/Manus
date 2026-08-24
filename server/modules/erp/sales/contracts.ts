import { z } from "zod";
import {
  canWriteErp,
  millisQuantity,
  quantityMillis,
  type OperationalRole,
} from "../contracts";
export const saleStatuses = [
  "draft",
  "confirmed",
  "fulfilled",
  "cancelled",
] as const;
export type SaleStatus = (typeof saleStatuses)[number];
export type SaleOperation =
  | "created"
  | "updated"
  | "confirmed"
  | "cancelled"
  | "fulfilled";
const quantity = z
  .string()
  .trim()
  .regex(/^\d{1,15}(?:\.\d{1,3})?$/)
  .refine(v => quantityMillis(v) > 0n, "Quantidade deve ser maior que zero.");
const item = z.object({
  productPublicId: z.string().uuid(),
  quantity,
  unitPriceCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export const saleDraftInput = z
  .object({
    crmClientId: z.string().trim().min(1).max(80),
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
export const saleListInput = z.object({
  search: z.string().trim().max(180).default(""),
  status: z.enum(saleStatuses).optional(),
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
export const fulfillInput = z.object({
  publicId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
});
export type SaleDraftInput = z.infer<typeof saleDraftInput>;
export type SaleListInput = z.infer<typeof saleListInput>;
export function lineTotalCents(q: string, c: number): number {
  const total = (quantityMillis(q) * BigInt(c) + 500n) / 1_000n;
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Total monetÃ¡rio excede o limite seguro.");
  return Number(total);
}
export function normalizeSaleDraft(
  v: SaleDraftInput
): SaleDraftInput {
  return {
    ...v,
    notes: v.notes?.trim() || null,
    items: v.items.map(x => ({
      ...x,
      quantity: millisQuantity(quantityMillis(x.quantity)),
    })),
  };
}
const transitions: Record<SaleStatus, readonly SaleStatus[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: [],
};
export const canTransitionSale = (
  from: SaleStatus,
  to: SaleStatus
) => transitions[from].includes(to);
export const canWriteSales = (role: OperationalRole) => canWriteErp(role);
export const saleEvent = (
  publicId: string,
  operation: SaleOperation,
  occurredAt = new Date().toISOString()
) => ({ publicId, operation, occurredAt });
