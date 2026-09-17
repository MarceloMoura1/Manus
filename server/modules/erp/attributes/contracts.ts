import { z } from "zod";
import type { OperationalRole } from "../contracts";

export const attributeTypePublicId = z.string().uuid();
export const attributeValuePublicId = z.string().uuid();

export function normalizeAttributeName(name: string): string {
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
  return normalized.slice(0, 120) || "atributo";
}

export const attributeTypeInput = z.object({
  name: z.string().trim().min(1).max(120),
  active: z.boolean().optional().default(true),
});

export const attributeTypeUpdateInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  active: z.boolean().optional(),
});

export const attributeTypeListInput = z.object({
  search: z.string().trim().max(120).default(""),
  active: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

export const attributeValueInput = z.object({
  typePublicId: attributeTypePublicId,
  name: z.string().trim().min(1).max(120),
  active: z.boolean().optional().default(true),
});

export const attributeValueUpdateInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  active: z.boolean().optional(),
});

export const attributeValueListInput = z.object({
  typePublicId: attributeTypePublicId.optional(),
  search: z.string().trim().max(120).default(""),
  active: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

export type AttributeTypeInput = z.infer<typeof attributeTypeInput>;
export type AttributeTypeUpdateInput = z.infer<typeof attributeTypeUpdateInput>;
export type AttributeTypeListInput = z.infer<typeof attributeTypeListInput>;

export type AttributeValueInput = z.infer<typeof attributeValueInput>;
export type AttributeValueUpdateInput = z.infer<typeof attributeValueUpdateInput>;
export type AttributeValueListInput = z.infer<typeof attributeValueListInput>;

export function canWriteAttributes(role: OperationalRole): boolean {
  return role === "admin" || role === "manager";
}
