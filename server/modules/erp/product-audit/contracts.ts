import { z } from "zod";
import type { OperationalRole } from "../contracts";

export const auditEntityTypes = [
  "product",
  "variant",
  "supplier_association",
] as const;
export type AuditEntityType = (typeof auditEntityTypes)[number];

export const productAuditActions = [
  "product_created",
  "product_updated",
  "product_activated",
  "product_deactivated",
  "category_changed",
  "brand_changed",
] as const;
export type ProductAuditAction = (typeof productAuditActions)[number];

export const variantAuditActions = [
  "variant_created",
  "variant_updated",
  "variant_activated",
  "variant_deactivated",
  "variant_deleted",
  "attribute_combination_changed",
] as const;
export type VariantAuditAction = (typeof variantAuditActions)[number];

export const productSupplierAuditActions = [
  "supplier_associated",
  "supplier_disassociated",
  "preferred_supplier_changed",
  "supplier_commercial_updated",
  "supplier_association_status",
] as const;
export type ProductSupplierAuditAction =
  (typeof productSupplierAuditActions)[number];

export const allAuditActions = [
  ...productAuditActions,
  ...variantAuditActions,
  ...productSupplierAuditActions,
] as const;
export type AuditAction = (typeof allAuditActions)[number];

export const PRODUCT_AUDIT_ACTIONS = productAuditActions;
export const VARIANT_AUDIT_ACTIONS = variantAuditActions;
export const PRODUCT_SUPPLIER_AUDIT_ACTIONS = productSupplierAuditActions;

export type ValueDiff<T = unknown> = {
  before: T;
  after: T;
};

export type ChangesDiff = Record<string, ValueDiff>;

export type AuditMetadata = Record<string, unknown>;

export type AuditActor = {
  userId: string;
  nameSnapshot: string;
  role: OperationalRole;
};

export const productAuditListInput = z.object({
  productPublicId: z.string().uuid(),
  entityType: z.enum(auditEntityTypes).optional(),
  action: z.string().trim().max(60).optional(),
  actor: z.string().trim().max(80).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ProductAuditListInput = z.infer<typeof productAuditListInput>;

export const productAuditDetailInput = z.object({
  productPublicId: z.string().uuid(),
  auditPublicId: z.string().uuid(),
});

export type ProductAuditDetailInput = z.infer<typeof productAuditDetailInput>;

export type PublicProductAuditLog = {
  publicId: string;
  productPublicId: string;
  entityType: AuditEntityType;
  entityPublicId: string;
  action: string;
  actor: {
    userId: string;
    name: string;
    role: string;
  };
  summary: string;
  changes: ChangesDiff | null;
  metadata: AuditMetadata | null;
  createdAt: string;
};

export function buildFieldDiff<T>(before: T, after: T): ValueDiff<T> | null {
  const normBefore = (before === undefined ? null : before) as T;
  const normAfter = (after === undefined ? null : after) as T;
  if (normBefore === normAfter) return null;
  // Handle NaN or identical references
  if (
    typeof normBefore === "number" &&
    typeof normAfter === "number" &&
    Number.isNaN(normBefore) &&
    Number.isNaN(normAfter)
  ) {
    return null;
  }
  return { before: normBefore, after: normAfter };
}

export function buildDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): ChangesDiff | null {
  const diff: ChangesDiff = {};
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    const valBefore = before[key];
    const valAfter = after[key];

    if (valBefore !== valAfter) {
      diff[key] = {
        before: valBefore !== undefined ? valBefore : null,
        after: valAfter !== undefined ? valAfter : null,
      };
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
}
