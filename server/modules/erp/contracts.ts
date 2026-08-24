import { z } from "zod";

export const erpUnits = ["unit", "kg", "liter", "meter"] as const;
export const stockMovementTypes = ["initial", "manual_in", "manual_out", "adjustment_in", "adjustment_out"] as const;
const optionalText = (max: number) => z.string().trim().max(max).optional().transform(value => value || null);
export const productPublicId = z.string().uuid();

export const productInput = z.object({
  name: z.string().trim().min(2).max(180), sku: z.string().trim().min(1).max(80),
  barcode: optionalText(80), description: optionalText(2_000), category: optionalText(120),
  unit: z.enum(erpUnits), costPriceCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  salePriceCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  minimumStock: z.string().trim().regex(/^\d{1,15}(?:\.\d{1,3})?$/),
});

export const productListInput = z.object({
  search: z.string().trim().max(120).default(""), active: z.boolean().optional(),
  category: z.string().trim().max(120).optional(), stock: z.enum(["all", "low", "empty", "available", "normal"]).default("all"),
  sort: z.enum(["name", "sku", "createdAt", "stock"]).default("name"), direction: z.enum(["asc", "desc"]).default("asc"),
  page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(20),
});

export const stockMovementInput = z.object({
  productPublicId, type: z.enum(stockMovementTypes),
  quantity: z.string().trim().regex(/^\d{1,15}(?:\.\d{1,3})?$/),
  reason: z.string().trim().min(3).max(500), idempotencyKey: z.string().uuid(),
});

export const stockListInput = z.object({
  productPublicId: productPublicId.optional(), type: z.enum([...stockMovementTypes, "purchase_in", "sale_out", "reversal"]).optional(),
  search: z.string().trim().max(120).default(""),
  from: z.string().datetime().optional(), to: z.string().datetime().optional(),
  page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(20),
});

export function normalizeSku(value: string): string { return value.trim().replace(/\s+/g, "-").toUpperCase(); }
export function normalizeBarcode(value: string | null): string | null { const normalized = value?.replace(/[\s.-]/g, "") ?? ""; return normalized || null; }
export function normalizeQuantity(value: string): string { const [whole, fraction = ""] = value.split("."); return `${BigInt(whole)}.${fraction.padEnd(3, "0")}`; }
export function quantityMillis(value: string): bigint { const [whole, fraction] = normalizeQuantity(value).split("."); return BigInt(whole) * 1_000n + BigInt(fraction); }
export function millisQuantity(value: bigint): string { const sign = value < 0n ? "-" : ""; const absolute = value < 0n ? -value : value; return `${sign}${absolute / 1_000n}.${String(absolute % 1_000n).padStart(3, "0")}`; }
export type OperationalRole = "admin" | "manager" | "agent" | "viewer";
export function canWriteErp(role: OperationalRole): boolean { return role === "admin" || role === "manager"; }
