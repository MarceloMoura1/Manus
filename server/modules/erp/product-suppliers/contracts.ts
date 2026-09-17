import { z } from "zod";
import type { OperationalRole } from "../contracts";

export const productSupplierPublicId = z.string().uuid();

export function normalizeSupplierProductCode(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || null;
}

export const productSupplierInput = z.object({
  productPublicId: z.string().uuid(),
  supplierPublicId: z.string().uuid(),
  supplierProductCode: z
    .string()
    .trim()
    .max(80)
    .nullable()
    .optional()
    .transform(v => v || null),
  costPriceCents: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .optional(),
  isPreferred: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
});

export const productSupplierUpdateInput = z.object({
  supplierProductCode: z
    .string()
    .trim()
    .max(80)
    .nullable()
    .optional()
    .transform(v => v || null),
  costPriceCents: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .optional(),
  isPreferred: z.boolean().optional(),
  active: z.boolean().optional(),
});

export const productSupplierSetPreferredInput = z.object({
  publicId: productSupplierPublicId,
  isPreferred: z.boolean(),
});

export const productSupplierListInput = z.object({
  productPublicId: z.string().uuid().optional(),
  supplierPublicId: z.string().uuid().optional(),
  isPreferred: z.boolean().optional(),
  active: z.boolean().optional(),
  search: z.string().trim().max(120).default(""),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

export type ProductSupplierInput = z.infer<typeof productSupplierInput>;
export type ProductSupplierUpdateInput = z.infer<
  typeof productSupplierUpdateInput
>;
export type ProductSupplierSetPreferredInput = z.infer<
  typeof productSupplierSetPreferredInput
>;
export type ProductSupplierListInput = z.infer<typeof productSupplierListInput>;

export function canWriteProductSuppliers(role: OperationalRole): boolean {
  return role === "admin" || role === "manager";
}
