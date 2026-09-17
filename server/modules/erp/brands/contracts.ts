import { z } from "zod";
import type { OperationalRole } from "../contracts";

export const brandPublicId = z.string().uuid();

export function normalizeBrandName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function normalizeSlug(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 120) || "marca";
}

export const brandInput = z.object({
  name: z.string().trim().min(2).max(120),
  active: z.boolean().optional().default(true),
});

export const brandUpdateInput = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  active: z.boolean().optional(),
});

export const brandListInput = z.object({
  search: z.string().trim().max(120).default(""),
  active: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

export type BrandInput = z.infer<typeof brandInput>;
export type BrandUpdateInput = z.infer<typeof brandUpdateInput>;
export type BrandListInput = z.infer<typeof brandListInput>;

export function canWriteBrands(role: OperationalRole): boolean {
  return role === "admin" || role === "manager";
}
