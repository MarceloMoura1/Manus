import { z } from "zod";
import type { OperationalRole } from "../contracts";

export const categoryPublicId = z.string().uuid();

export function normalizeCategoryName(name: string): string {
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
  return normalized.slice(0, 120) || "categoria";
}

export const categoryInput = z.object({
  name: z.string().trim().min(2).max(120),
  parentPublicId: categoryPublicId.nullable().optional(),
  active: z.boolean().optional().default(true),
});

export const categoryUpdateInput = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  active: z.boolean().optional(),
});

export const categoryMoveInput = z.object({
  parentPublicId: categoryPublicId.nullable(),
});

export const categoryListInput = z.object({
  search: z.string().trim().max(120).default(""),
  active: z.boolean().optional(),
  parentPublicId: categoryPublicId.nullable().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

export type CategoryInput = z.infer<typeof categoryInput>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateInput>;
export type CategoryMoveInput = z.infer<typeof categoryMoveInput>;
export type CategoryListInput = z.infer<typeof categoryListInput>;

export function canWriteCategories(role: OperationalRole): boolean {
  return role === "admin" || role === "manager";
}
