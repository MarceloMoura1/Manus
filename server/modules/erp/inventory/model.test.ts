import { describe, expect, it } from "vitest";
import {
  classifyInventoryBackfill,
  effectiveInventoryCost,
} from "./model";

describe("variant-aware inventory domain freeze", () => {
  it("creates a simple item for a product without variants", () => {
    expect(
      classifyInventoryBackfill({
        variantCount: 0,
        hasVariantHistory: false,
        hasProductLevelHistory: true,
      })
    ).toEqual({
      createSimple: true,
      createVariantItems: false,
      createLegacyUnallocated: false,
      historicalTarget: "simple",
    });
  });

  it("never assigns ambiguous history to a current variant", () => {
    expect(
      classifyInventoryBackfill({
        variantCount: 1,
        hasVariantHistory: true,
        hasProductLevelHistory: true,
      })
    ).toMatchObject({
      createVariantItems: true,
      createLegacyUnallocated: true,
      historicalTarget: "legacy_unallocated",
    });
  });

  it("keeps a simple future item and legacy history after variant deletion", () => {
    expect(
      classifyInventoryBackfill({
        variantCount: 0,
        hasVariantHistory: true,
        hasProductLevelHistory: true,
      })
    ).toEqual({
      createSimple: true,
      createVariantItems: false,
      createLegacyUnallocated: true,
      historicalTarget: "legacy_unallocated",
    });
  });

  it("leaves legacy cost unresolved instead of borrowing variant cost", () => {
    expect(
      effectiveInventoryCost({
        kind: "legacy_unallocated",
        productCostCents: 100,
        variantCostCents: 250,
        legacyCostSnapshotCents: null,
      })
    ).toEqual({ cents: null, source: "unresolved" });
  });
});
