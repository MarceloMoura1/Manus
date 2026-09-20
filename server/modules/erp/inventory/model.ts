export const inventoryItemKinds = [
  "simple",
  "variant",
  "legacy_unallocated",
] as const;

export type InventoryItemKind = (typeof inventoryItemKinds)[number];

export type InventoryBackfillFacts = {
  variantCount: number;
  hasVariantHistory: boolean;
  hasProductLevelHistory: boolean;
};

export type InventoryBackfillClassification = {
  createSimple: boolean;
  createVariantItems: boolean;
  createLegacyUnallocated: boolean;
  historicalTarget: "simple" | "legacy_unallocated";
};

/** Historical product-level facts are never attributed to a variant. */
export function classifyInventoryBackfill(
  facts: InventoryBackfillFacts
): InventoryBackfillClassification {
  const createLegacyUnallocated =
    facts.hasProductLevelHistory &&
    (facts.variantCount > 0 || facts.hasVariantHistory);

  return {
    createSimple: facts.variantCount === 0,
    createVariantItems: facts.variantCount > 0,
    createLegacyUnallocated,
    historicalTarget: createLegacyUnallocated
      ? "legacy_unallocated"
      : "simple",
  };
}

export function effectiveInventoryCost(input: {
  kind: InventoryItemKind;
  productCostCents: number;
  variantCostCents: number | null;
  legacyCostSnapshotCents: number | null;
}): {
  cents: number | null;
  source: "product" | "variant" | "legacy_snapshot" | "unresolved";
} {
  if (input.kind === "simple") {
    return { cents: input.productCostCents, source: "product" };
  }
  if (input.kind === "variant") {
    return input.variantCostCents === null
      ? { cents: input.productCostCents, source: "product" }
      : { cents: input.variantCostCents, source: "variant" };
  }
  return input.legacyCostSnapshotCents === null
    ? { cents: null, source: "unresolved" }
    : {
        cents: input.legacyCostSnapshotCents,
        source: "legacy_snapshot",
      };
}
