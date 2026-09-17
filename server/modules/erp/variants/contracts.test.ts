import { describe, expect, it } from "vitest";
import {
  calculateEffectivePrice,
  computeCombinationHash,
  setVariantAttributesInput,
  variantInput,
  variantUpdateInput,
} from "./contracts";

describe("ERP Variants Contracts & Price Helper", () => {
  describe("Effective Price Canonical Rule", () => {
    it("inherits product price when variant price is null", () => {
      expect(calculateEffectivePrice(null, 10000)).toBe(10000);
    });

    it("inherits product price when variant price is undefined", () => {
      expect(calculateEffectivePrice(undefined, 10000)).toBe(10000);
    });

    it("uses variant price when explicitly specified", () => {
      expect(calculateEffectivePrice(12000, 10000)).toBe(12000);
    });

    it("preserves zero price semantics (zero is valid, not converted to null or parent price)", () => {
      expect(calculateEffectivePrice(0, 10000)).toBe(0);
    });
  });

  describe("Deterministic Combination Hash", () => {
    it("produces identical hash regardless of attribute ordering", () => {
      const orderA = [
        { attributeTypeId: 2, attributeValueId: 20 },
        { attributeTypeId: 1, attributeValueId: 10 },
      ];
      const orderB = [
        { attributeTypeId: 1, attributeValueId: 10 },
        { attributeTypeId: 2, attributeValueId: 20 },
      ];

      const hashA = computeCombinationHash(orderA);
      const hashB = computeCombinationHash(orderB);

      expect(hashA).toBeDefined();
      expect(hashA).toBe(hashB);
    });

    it("produces null for empty attributes array", () => {
      expect(computeCombinationHash([])).toBeNull();
    });

    it("produces different hashes for different combinations", () => {
      const combo1 = [
        { attributeTypeId: 1, attributeValueId: 10 },
        { attributeTypeId: 2, attributeValueId: 20 },
      ];
      const combo2 = [
        { attributeTypeId: 1, attributeValueId: 10 },
        { attributeTypeId: 2, attributeValueId: 21 },
      ];

      expect(computeCombinationHash(combo1)).not.toBe(computeCombinationHash(combo2));
    });
  });

  describe("Input Validations", () => {
    const validUuid = "a2b7b282-1d5d-4f27-a068-18e388d757d7";

    it("validates correct variantInput with null salePriceCents", () => {
      const parsed = variantInput.safeParse({
        productPublicId: validUuid,
        sku: "CAM-PRE-M",
        salePriceCents: null,
      });
      expect(parsed.success).toBe(true);
    });

    it("validates variantInput with own salePriceCents", () => {
      const parsed = variantInput.safeParse({
        productPublicId: validUuid,
        sku: "CAM-PRE-M",
        salePriceCents: 5990,
      });
      expect(parsed.success).toBe(true);
    });

    it("validates variantInput with zero price", () => {
      const parsed = variantInput.safeParse({
        productPublicId: validUuid,
        sku: "CAM-PRE-M",
        salePriceCents: 0,
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects negative salePriceCents", () => {
      const parsed = variantInput.safeParse({
        productPublicId: validUuid,
        sku: "CAM-PRE-M",
        salePriceCents: -50,
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects empty SKU", () => {
      const parsed = variantInput.safeParse({
        productPublicId: validUuid,
        sku: "   ",
      });
      expect(parsed.success).toBe(false);
    });

    it("validates setVariantAttributesInput", () => {
      const parsed = setVariantAttributesInput.safeParse({
        attributeValuePublicIds: [validUuid],
      });
      expect(parsed.success).toBe(true);
    });

    it("validates variantUpdateInput", () => {
      expect(variantUpdateInput.safeParse({ sku: "CAM-NEW-SKU" }).success).toBe(true);
      expect(variantUpdateInput.safeParse({ salePriceCents: null }).success).toBe(true);
      expect(variantUpdateInput.safeParse({ active: false }).success).toBe(true);
    });
  });
});
