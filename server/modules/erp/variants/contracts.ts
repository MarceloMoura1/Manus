import { createHash } from "node:crypto";
import { z } from "zod";
import type { OperationalRole } from "../contracts";

export const variantPublicId = z.string().uuid();

export function calculateEffectivePrice(
  variantPriceCents: number | null | undefined,
  productPriceCents: number
): number {
  return variantPriceCents ?? productPriceCents;
}

export function computeCombinationHash(
  items: Array<{ attributeTypeId: number; attributeValueId: number }>
): string | null {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => a.attributeTypeId - b.attributeTypeId);
  const canonical = sorted.map(i => `${i.attributeTypeId}:${i.attributeValueId}`).join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

export const variantInput = z.object({
  productPublicId: z.string().uuid(),
  sku: z.string().trim().min(1).max(80),
  barcode: z.string().trim().max(80).nullable().optional(),
  name: z.string().trim().min(1).max(180).nullable().optional(),
  costPriceCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional().default(0),
  salePriceCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  attributeValuePublicIds: z.array(z.string().uuid()).optional().default([]),
  active: z.boolean().optional().default(true),
});

export const variantUpdateInput = z.object({
  sku: z.string().trim().min(1).max(80).optional(),
  barcode: z.string().trim().max(80).nullable().optional(),
  name: z.string().trim().min(1).max(180).nullable().optional(),
  costPriceCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  salePriceCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  active: z.boolean().optional(),
});

export const setVariantAttributesInput = z.object({
  attributeValuePublicIds: z.array(z.string().uuid()),
});

export const variantListInput = z.object({
  productPublicId: z.string().uuid().optional(),
  search: z.string().trim().max(120).default(""),
  active: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

export type VariantInput = z.infer<typeof variantInput>;
export type VariantUpdateInput = z.infer<typeof variantUpdateInput>;
export type SetVariantAttributesInput = z.infer<typeof setVariantAttributesInput>;
export type VariantListInput = z.infer<typeof variantListInput>;

export function canWriteVariants(role: OperationalRole): boolean {
  return role === "admin" || role === "manager";
}
