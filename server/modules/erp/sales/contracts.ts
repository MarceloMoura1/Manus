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

export const saleStages = [
  "created",
  "confirmed",
  "separation",
  "shipped",
  "received",
  "completed",
] as const;
export type SaleStage = (typeof saleStages)[number];

export const salePaymentStatuses = ["pending", "partial", "paid"] as const;
export type SalePaymentStatus = (typeof salePaymentStatuses)[number];

export type SaleOperation =
  | "created"
  | "updated"
  | "confirmed"
  | "cancelled"
  | "stage_changed"
  | "shipped"
  | "payment_changed"
  | "address_corrected";

const quantity = z
  .string()
  .trim()
  .regex(/^\d{1,15}(?:\.\d{1,3})?$/)
  .refine(value => quantityMillis(value) > 0n, "Quantidade deve ser maior que zero.");

export const saleAddressSchema = z.object({
  recipientName: z.string().trim().max(180).default(""),
  postalCode: z.string().trim().max(10).default(""),
  street: z.string().trim().max(255).default(""),
  number: z.string().trim().max(30).default(""),
  complement: z.string().trim().max(120).default(""),
  district: z.string().trim().max(120).default(""),
  city: z.string().trim().max(120).default(""),
  state: z.string().trim().max(2).default(""),
});
export type SaleAddress = z.infer<typeof saleAddressSchema>;

const item = z.object({
  productPublicId: z.string().uuid(),
  inventoryItemPublicId: z.string().uuid().nullish(),
  quantity,
  unitPriceCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  discountCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
});

export const saleDraftInput = z
  .object({
    crmClientId: z.string().trim().min(1).max(80),
    notes: z.string().trim().max(4_000).optional().transform(value => value || null),
    expectedDate: z.string().date().optional().transform(value => value || null),
    shippingAddress: saleAddressSchema.nullish().transform(value => value ?? null),
    billingAddress: saleAddressSchema.nullish().transform(value => value ?? null),
    orderDiscountCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
    freightCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
    items: z.array(item).min(1).max(100),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.items.forEach((entry, index) => {
      const identity = `${entry.productPublicId}:${entry.inventoryItemPublicId ?? "product-only"}`;
      if (seen.has(identity)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "inventoryItemPublicId"],
          message: "Item de estoque duplicado no pedido.",
        });
      }
      seen.add(identity);
      const gross = lineTotalCents(entry.quantity, entry.unitPriceCents);
      if (entry.discountCents > gross) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "discountCents"],
          message: "O desconto do item não pode superar seu valor bruto.",
        });
      }
    });
    try {
      calculateSaleTotals(value.items, value.orderDiscountCents, value.freightCents);
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orderDiscountCents"],
        message: error instanceof Error ? error.message : "Totais inválidos.",
      });
    }
  });

export const saleListInput = z.object({
  search: z.string().trim().max(180).default(""),
  crmClientId: z.string().trim().min(1).max(80).optional(),
  status: z.enum(saleStatuses).optional(),
  stage: z.enum(saleStages).optional(),
  paymentStatus: z.enum(salePaymentStatuses).optional(),
  paymentMethod: z.string().trim().max(80).optional(),
  sellerUserId: z.string().trim().max(80).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  sort: z.enum(["orderNumber", "createdAt", "total"]).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const saleSearchInput = z.object({
  search: z.string().trim().max(180).default(""),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});

export const saleConfirmationInput = z.object({
  publicId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  paymentMethod: z.string().trim().min(2).max(80),
  categoryPublicId: z.string().uuid(),
  financialAccountPublicId: z.string().uuid().nullish(),
  receivedCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  installments: z
    .array(
      z.object({
        dueDate: z.string().date(),
        amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      })
    )
    .min(1)
    .max(120),
});

export const saleTransitionInput = z.object({
  publicId: z.string().uuid(),
  toStage: z.enum(saleStages),
  idempotencyKey: z.string().uuid(),
  reason: z.string().trim().max(500).optional().transform(value => value || null),
});

export const saleAddressCorrectionInput = z.object({
  publicId: z.string().uuid(),
  shippingAddress: saleAddressSchema,
  billingAddress: saleAddressSchema,
  reason: z.string().trim().min(3).max(500),
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
export type SaleConfirmationInput = z.infer<typeof saleConfirmationInput>;
export type SaleTransitionInput = z.infer<typeof saleTransitionInput>;
export type SaleAddressCorrectionInput = z.infer<typeof saleAddressCorrectionInput>;

export function lineTotalCents(quantityValue: string, unitPriceCents: number): number {
  const total = (quantityMillis(quantityValue) * BigInt(unitPriceCents) + 500n) / 1_000n;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Total monetário excede o limite seguro.");
  }
  return Number(total);
}

export function calculateSaleTotals(
  items: ReadonlyArray<{
    quantity: string;
    unitPriceCents: number;
    discountCents?: number;
  }>,
  orderDiscountCents = 0,
  freightCents = 0
) {
  let subtotalCents = 0n;
  let itemDiscountCents = 0n;
  for (const entry of items) {
    const gross = lineTotalCents(entry.quantity, entry.unitPriceCents);
    const discount = entry.discountCents ?? 0;
    if (discount > gross) throw new Error("O desconto do item não pode superar seu valor bruto.");
    subtotalCents += BigInt(gross);
    itemDiscountCents += BigInt(discount);
  }
  const netProductsCents = subtotalCents - itemDiscountCents;
  const orderDiscount = BigInt(orderDiscountCents);
  const freight = BigInt(freightCents);
  if (orderDiscount > netProductsCents) {
    throw new Error("O desconto da venda não pode superar o valor dos produtos.");
  }
  const totalCents = netProductsCents - orderDiscount + freight;
  const safeLimit = BigInt(Number.MAX_SAFE_INTEGER);
  if (
    subtotalCents > safeLimit ||
    itemDiscountCents > safeLimit ||
    netProductsCents > safeLimit ||
    totalCents > safeLimit
  ) {
    throw new Error("Total monetário excede o limite seguro.");
  }
  return {
    subtotalCents: Number(subtotalCents),
    itemDiscountCents: Number(itemDiscountCents),
    orderDiscountCents,
    freightCents,
    totalCents: Number(totalCents),
  };
}

export function normalizeSaleDraft(value: SaleDraftInput): SaleDraftInput {
  return {
    ...value,
    notes: value.notes?.trim() || null,
    items: value.items.map(entry => ({
      ...entry,
      quantity: millisQuantity(quantityMillis(entry.quantity)),
    })),
  };
}

const forwardStage: Partial<Record<SaleStage, SaleStage>> = {
  created: "confirmed",
  confirmed: "separation",
  separation: "shipped",
  shipped: "received",
  received: "completed",
};

const correctionStage: Partial<Record<SaleStage, readonly SaleStage[]>> = {
  separation: ["confirmed"],
  received: ["shipped"],
  completed: ["received"],
};

export function saleTransitionKind(from: SaleStage, to: SaleStage) {
  if (forwardStage[from] === to) return "forward" as const;
  if (correctionStage[from]?.includes(to)) return "correction" as const;
  return "blocked" as const;
}

export const isStockExitTransition = (from: SaleStage, to: SaleStage) =>
  from === "separation" && to === "shipped";

export const canCancelSaleAtStage = (stage: SaleStage) =>
  saleStages.indexOf(stage) < saleStages.indexOf("shipped");

export function legacySaleStage(status: SaleStatus): SaleStage {
  if (status === "draft") return "created";
  if (status === "fulfilled") return "completed";
  return "confirmed";
}

export function derivePaymentStatus(totalCents: number, paidCents: number): SalePaymentStatus {
  if (paidCents <= 0) return "pending";
  if (paidCents >= totalCents) return "paid";
  return "partial";
}

export const canWriteSales = (role: OperationalRole) => canWriteErp(role);

export const saleEvent = (
  publicId: string,
  operation: SaleOperation,
  occurredAt = new Date().toISOString()
) => ({ publicId, operation, occurredAt });
