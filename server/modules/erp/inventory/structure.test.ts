import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("inventory item additive rollout structure", () => {
  const migration = readFileSync(
    "drizzle/main-migrations/0031_lonely_blockbuster.sql",
    "utf8"
  );
  const backfill = readFileSync(
    "server/modules/erp/inventory/backfill.ts",
    "utf8"
  );
  const repository = readFileSync(
    "server/modules/erp/inventory/repository.ts",
    "utf8"
  );

  it("keeps 0031 additive and transitional references nullable", () => {
    const statements = migration
      .split("--> statement-breakpoint")
      .map(statement => statement.trim());

    expect(migration).toContain("CREATE TABLE `erp_inventory_items`");
    expect(migration).toContain("CREATE TABLE `erp_inventory_item_balances`");
    expect(migration).toContain("ADD `inventory_item_id` bigint;");
    expect(statements).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE|UPDATE|INSERT)\b/i
        ),
      ])
    );
    expect(migration).not.toContain("MODIFY COLUMN `product_id`");
  });

  it("uses typed order identity instead of the legacy one-product rule", () => {
    for (const { table, orderColumn, oldIndex, newIndex } of [
      {
        table: "erp_sale_order_items",
        orderColumn: "sale_order_id",
        oldIndex: "uq_erp_sale_items_order_product",
        newIndex: "uq_erp_sale_items_order_identity",
      },
      {
        table: "erp_purchase_order_items",
        orderColumn: "purchase_order_id",
        oldIndex: "uq_erp_purchase_items_order_product",
        newIndex: "uq_erp_purchase_items_order_identity",
      },
    ]) {
      expect(migration).toContain(
        `ALTER TABLE \`${table}\` DROP INDEX \`${oldIndex}\``
      );
      expect(migration).toContain(`UNIQUE(\`${orderColumn}\`,\`order_item_identity\`)`);
      expect(migration).toContain(newIndex);
      expect(migration).not.toContain(`UNIQUE(\`${orderColumn}\`,\`product_id\`)`);
    }
    expect(migration).toContain("`order_item_identity` varchar(96) GENERATED ALWAYS AS");
    expect(migration).toContain(") END) VIRTUAL");
    expect(migration).toContain("THEN CONCAT('product:', `product_id`)");
    expect(migration).toContain("ELSE CONCAT('inventory:', `inventory_item_id`)");
  });

  it("uses deterministic checkpoints and never infers a historical variant", () => {
    expect(backfill).toContain("InventoryBackfillInterrupted");
    expect(backfill).toContain("inventory-backfill-0031");
    expect(backfill).toContain("expectedHistoricalBalance");
    expect(backfill).toContain("inventory_item_id IS NULL");
    expect(backfill).toContain("has_legacy_item");
    expect(backfill).not.toMatch(/similar|levenshtein|closest|first variant/i);
    expect(backfill).toContain(
      "SELECT id,client_id,minimum_stock FROM erp_products WHERE client_id=? AND id=? LIMIT 1 FOR UPDATE"
    );
    expect(backfill).toContain(
      "SELECT quantity FROM erp_stock_balances WHERE client_id=? AND product_id=? LIMIT 1 FOR UPDATE"
    );
  });

  it("exposes human identity, canonical image and explainable cost", () => {
    expect(repository).toContain("attributesLabel");
    expect(repository).toContain("canonicalImage");
    expect(repository).toContain("costSource");
    expect(repository).toContain("valuationCents");
    expect(repository).toContain("Legado n\u00e3o atribu\u00eddo");
  });
});
