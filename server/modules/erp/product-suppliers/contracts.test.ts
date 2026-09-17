import { describe, expect, it } from "vitest";
import {
  normalizeSupplierProductCode,
  productSupplierInput,
  productSupplierListInput,
  productSupplierSetPreferredInput,
  productSupplierUpdateInput,
} from "./contracts";

describe("ERP Product-Supplier Contracts", () => {
  it("normalizes supplier product code by trimming whitespace", () => {
    expect(normalizeSupplierProductCode("  SKU-SUPP-123  ")).toBe("SKU-SUPP-123");
    expect(normalizeSupplierProductCode("")).toBeNull();
    expect(normalizeSupplierProductCode("   ")).toBeNull();
    expect(normalizeSupplierProductCode(null)).toBeNull();
    expect(normalizeSupplierProductCode(undefined)).toBeNull();
  });

  it("validates valid product supplier input with nulls", () => {
    const parsed = productSupplierInput.safeParse({
      productPublicId: "a2b7b282-1d5d-4f27-a068-18e388d757d7",
      supplierPublicId: "b3c8c393-2e6e-5038-b179-29f499e868e8",
      supplierProductCode: null,
      costPriceCents: null,
      isPreferred: false,
      active: true,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.supplierProductCode).toBeNull();
      expect(parsed.data.costPriceCents).toBeNull();
    }
  });

  it("validates valid cost_price_cents = 0", () => {
    const parsed = productSupplierInput.safeParse({
      productPublicId: "a2b7b282-1d5d-4f27-a068-18e388d757d7",
      supplierPublicId: "b3c8c393-2e6e-5038-b179-29f499e868e8",
      costPriceCents: 0,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.costPriceCents).toBe(0);
    }
  });

  it("validates positive cost_price_cents", () => {
    const parsed = productSupplierInput.safeParse({
      productPublicId: "a2b7b282-1d5d-4f27-a068-18e388d757d7",
      supplierPublicId: "b3c8c393-2e6e-5038-b179-29f499e868e8",
      costPriceCents: 15990,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.costPriceCents).toBe(15990);
    }
  });

  it("rejects negative cost_price_cents", () => {
    const parsed = productSupplierInput.safeParse({
      productPublicId: "a2b7b282-1d5d-4f27-a068-18e388d757d7",
      supplierPublicId: "b3c8c393-2e6e-5038-b179-29f499e868e8",
      costPriceCents: -1,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects non-integer cost_price_cents", () => {
    const parsed = productSupplierInput.safeParse({
      productPublicId: "a2b7b282-1d5d-4f27-a068-18e388d757d7",
      supplierPublicId: "b3c8c393-2e6e-5038-b179-29f499e868e8",
      costPriceCents: 15.99,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects invalid UUIDs for productPublicId or supplierPublicId", () => {
    expect(
      productSupplierInput.safeParse({
        productPublicId: "invalid-uuid",
        supplierPublicId: "b3c8c393-2e6e-5038-b179-29f499e868e8",
      }).success
    ).toBe(false);

    expect(
      productSupplierInput.safeParse({
        productPublicId: "a2b7b282-1d5d-4f27-a068-18e388d757d7",
        supplierPublicId: "invalid-uuid",
      }).success
    ).toBe(false);
  });

  it("validates update input", () => {
    const parsed = productSupplierUpdateInput.safeParse({
      supplierProductCode: "SUPP-999",
      costPriceCents: 4500,
      isPreferred: true,
      active: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("validates setPreferred input", () => {
    const parsed = productSupplierSetPreferredInput.safeParse({
      publicId: "a2b7b282-1d5d-4f27-a068-18e388d757d7",
      isPreferred: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("validates list input", () => {
    const parsed = productSupplierListInput.safeParse({
      productPublicId: "a2b7b282-1d5d-4f27-a068-18e388d757d7",
      activeOnly: true,
    });
    expect(parsed.success).toBe(true);
  });
});
