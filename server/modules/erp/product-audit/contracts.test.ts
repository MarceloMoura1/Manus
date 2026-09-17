import { describe, expect, it } from "vitest";
import {
  buildDiff,
  buildFieldDiff,
  productAuditDetailInput,
  productAuditListInput,
  PRODUCT_AUDIT_ACTIONS,
  VARIANT_AUDIT_ACTIONS,
  PRODUCT_SUPPLIER_AUDIT_ACTIONS,
} from "./contracts";

describe("Product Audit Contracts & Helpers", () => {
  describe("buildFieldDiff", () => {
    it("returns null when before and after are identical", () => {
      expect(buildFieldDiff("value", "value")).toBeNull();
      expect(buildFieldDiff(100, 100)).toBeNull();
      expect(buildFieldDiff(null, null)).toBeNull();
      expect(buildFieldDiff(undefined, undefined)).toBeNull();
    });

    it("returns before and after diff when values differ", () => {
      const diff = buildFieldDiff("Camiseta", "Camiseta Premium");
      expect(diff).toEqual({
        before: "Camiseta",
        after: "Camiseta Premium",
      });
    });

    it("preserves 0 as a distinct value and does not convert to null", () => {
      const diff1 = buildFieldDiff(null, 0);
      expect(diff1).toEqual({ before: null, after: 0 });

      const diff2 = buildFieldDiff(0, null);
      expect(diff2).toEqual({ before: 0, after: null });

      const diff3 = buildFieldDiff(0, 100);
      expect(diff3).toEqual({ before: 0, after: 100 });
    });

    it("treats undefined as null in diffs", () => {
      const diff = buildFieldDiff(undefined, "active");
      expect(diff).toEqual({ before: null, after: "active" });
    });

    it("preserves integer cents for monetary values without floats", () => {
      const diff = buildFieldDiff(19990, 21990);
      expect(diff).toEqual({ before: 19990, after: 21990 });
      expect(Number.isInteger(diff?.before)).toBe(true);
      expect(Number.isInteger(diff?.after)).toBe(true);
    });
  });

  describe("buildDiff", () => {
    it("returns null when no fields changed", () => {
      const before = { name: "Test", price: 1000 };
      const after = { name: "Test", price: 1000 };
      expect(buildDiff(before, after)).toBeNull();
    });

    it("returns only changed fields in structured format", () => {
      const before = { name: "Test", price: 1000, active: true };
      const after = { name: "Test Renamed", price: 1000, active: false };
      const diff = buildDiff(before, after);
      expect(diff).toEqual({
        name: { before: "Test", after: "Test Renamed" },
        active: { before: true, after: false },
      });
      expect(diff).not.toHaveProperty("price");
    });
  });

  describe("Zod Validation Schemas", () => {
    describe("productAuditListInput", () => {
      it("validates valid input with productPublicId and default pagination", () => {
        const id = crypto.randomUUID();
        const parsed = productAuditListInput.parse({
          productPublicId: id,
        });
        expect(parsed.productPublicId).toBe(id);
        expect(parsed.page).toBe(1);
        expect(parsed.pageSize).toBe(20);
      });

      it("accepts optional filters", () => {
        const id = crypto.randomUUID();
        const parsed = productAuditListInput.parse({
          productPublicId: id,
          entityType: "variant",
          action: "variant_created",
          actor: "admin-1",
          from: "2026-01-01T00:00:00.000Z",
          to: "2026-12-31T23:59:59.000Z",
          page: 2,
          pageSize: 50,
        });
        expect(parsed.entityType).toBe("variant");
        expect(parsed.action).toBe("variant_created");
        expect(parsed.actor).toBe("admin-1");
        expect(parsed.page).toBe(2);
        expect(parsed.pageSize).toBe(50);
      });

      it("rejects invalid entityType", () => {
        expect(() =>
          productAuditListInput.parse({
            productPublicId: crypto.randomUUID(),
            entityType: "stock", // stock is NOT permitted in audit table
          })
        ).toThrow();
      });

      it("rejects non-positive page or pageSize", () => {
        expect(() =>
          productAuditListInput.parse({
            productPublicId: crypto.randomUUID(),
            pageSize: 0,
          })
        ).toThrow();

        expect(() =>
          productAuditListInput.parse({
            productPublicId: crypto.randomUUID(),
            page: 0,
          })
        ).toThrow();
      });
    });

    describe("productAuditDetailInput", () => {
      it("validates valid productPublicId and auditPublicId", () => {
        const prodId = crypto.randomUUID();
        const auditId = crypto.randomUUID();
        const parsed = productAuditDetailInput.parse({
          productPublicId: prodId,
          auditPublicId: auditId,
        });
        expect(parsed.productPublicId).toBe(prodId);
        expect(parsed.auditPublicId).toBe(auditId);
      });

      it("rejects empty productPublicId or auditPublicId", () => {
        expect(() =>
          productAuditDetailInput.parse({
            productPublicId: "",
            auditPublicId: "audit-1",
          })
        ).toThrow();

        expect(() =>
          productAuditDetailInput.parse({
            productPublicId: "prod-1",
            auditPublicId: "",
          })
        ).toThrow();
      });
    });
  });

  describe("Audit Action Sets", () => {
    it("has exact expected actions for Product", () => {
      expect(PRODUCT_AUDIT_ACTIONS).toEqual([
        "product_created",
        "product_updated",
        "product_activated",
        "product_deactivated",
        "category_changed",
        "brand_changed",
      ]);
    });

    it("has exact expected actions for Variant", () => {
      expect(VARIANT_AUDIT_ACTIONS).toEqual([
        "variant_created",
        "variant_updated",
        "variant_activated",
        "variant_deactivated",
        "variant_deleted",
        "attribute_combination_changed",
      ]);
    });

    it("has exact expected actions for Product-Supplier", () => {
      expect(PRODUCT_SUPPLIER_AUDIT_ACTIONS).toEqual([
        "supplier_associated",
        "supplier_disassociated",
        "preferred_supplier_changed",
        "supplier_commercial_updated",
        "supplier_association_status",
      ]);
    });
  });
});
