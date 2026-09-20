import { createHash } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { millisQuantity, quantityMillis } from "../contracts";
import { classifyInventoryBackfill, type InventoryItemKind } from "./model";

export type InventoryBackfillCursor = { clientId: string; productId: number };
export type InventoryBackfillOptions = {
  after?: InventoryBackfillCursor;
  limit?: number;
  interruptAfter?: number;
};
export type InventoryBackfillResult = {
  processed: number;
  simpleItems: number;
  variantItems: number;
  legacyItems: number;
  lastCursor: InventoryBackfillCursor | null;
  complete: boolean;
};

export class InventoryBackfillInterrupted extends Error {
  constructor(public readonly cursor: InventoryBackfillCursor) {
    super("Inventory backfill interrupted after a committed checkpoint");
  }
}

type ProductRow = RowDataPacket & {
  id: number;
  client_id: string;
  minimum_stock: string;
};
type VariantRow = RowDataPacket & { id: number; active: number };
type ProductFactsRow = RowDataPacket & {
  has_variant_history: number;
  has_movements: number;
  has_purchases: number;
  has_sales: number;
  has_legacy_item: number;
  allocated_quantity: string;
};

function deterministicUuid(parts: Array<string | number>): string {
  const hex = createHash("sha256")
    .update(`megadesk-inventory-v3:${parts.join(":")}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function ensureItem(
  c: PoolConnection,
  input: {
    clientId: string;
    productId: number;
    variantId: number | null;
    kind: InventoryItemKind;
    active: boolean;
    minimumStock: string | null;
    legacyReason: string | null;
  }
): Promise<number> {
  const publicId = deterministicUuid([
    input.clientId,
    input.productId,
    input.kind,
    input.variantId ?? "none",
  ]);
  await c.execute(
    `INSERT INTO erp_inventory_items
      (public_id,client_id,product_id,variant_id,kind,active,minimum_stock,legacy_reason,legacy_cost_snapshot_cents,created_by)
     VALUES(?,?,?,?,?,?,?,?,NULL,'inventory-backfill-0031')
     ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
    [
      publicId,
      input.clientId,
      input.productId,
      input.variantId,
      input.kind,
      input.active ? 1 : 0,
      input.minimumStock,
      input.legacyReason,
    ]
  );
  const [rows] = input.kind === "variant"
    ? await c.execute<RowDataPacket[]>(
        "SELECT id FROM erp_inventory_items WHERE client_id=? AND product_id=? AND kind='variant' AND variant_id=? LIMIT 1",
        [input.clientId, input.productId, input.variantId]
      )
    : await c.execute<RowDataPacket[]>(
        "SELECT id FROM erp_inventory_items WHERE client_id=? AND product_id=? AND kind=? AND variant_id IS NULL LIMIT 1",
        [input.clientId, input.productId, input.kind]
      );
  if (!rows[0]) throw new Error("Backfill could not resolve inventory item");
  return Number(rows[0].id);
}

async function ensureExpectedBalance(
  c: PoolConnection,
  clientId: string,
  itemId: number,
  expected: string
) {
  await c.execute(
    "INSERT IGNORE INTO erp_inventory_item_balances(client_id,inventory_item_id,quantity,version) VALUES(?,?,?,0)",
    [clientId, itemId, expected]
  );
  const [rows] = await c.execute<RowDataPacket[]>(
    "SELECT quantity FROM erp_inventory_item_balances WHERE client_id=? AND inventory_item_id=? FOR UPDATE",
    [clientId, itemId]
  );
  if (String(rows[0]?.quantity) !== expected) {
    throw new Error(
      "Existing inventory-item balance differs from deterministic backfill result"
    );
  }
}

async function ensureBalance(
  c: PoolConnection,
  clientId: string,
  itemId: number
) {
  await c.execute(
    "INSERT IGNORE INTO erp_inventory_item_balances(client_id,inventory_item_id,quantity,version) VALUES(?,?,0,0)",
    [clientId, itemId]
  );
}

async function productFacts(
  c: PoolConnection,
  product: ProductRow,
  productQuantity: string
) {
  const [rows] = await c.execute<ProductFactsRow[]>(
    `SELECT
      EXISTS(SELECT 1 FROM erp_product_audit_logs a WHERE a.client_id=? AND a.product_id=? AND a.entity_type='variant') has_variant_history,
      EXISTS(SELECT 1 FROM erp_stock_movements m WHERE m.client_id=? AND m.product_id=? AND m.inventory_item_id IS NULL) has_movements,
      EXISTS(SELECT 1 FROM erp_purchase_order_items i INNER JOIN erp_purchase_orders o ON o.id=i.purchase_order_id WHERE o.client_id=? AND i.product_id=? AND i.inventory_item_id IS NULL) has_purchases,
      EXISTS(SELECT 1 FROM erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id WHERE o.client_id=? AND i.product_id=? AND i.inventory_item_id IS NULL) has_sales,
      EXISTS(SELECT 1 FROM erp_inventory_items i WHERE i.client_id=? AND i.product_id=? AND i.kind='legacy_unallocated') has_legacy_item,
      COALESCE((SELECT SUM(b.quantity) FROM erp_inventory_items i INNER JOIN erp_inventory_item_balances b ON b.client_id=i.client_id AND b.inventory_item_id=i.id WHERE i.client_id=? AND i.product_id=?), '0.000') allocated_quantity`,
    [
      product.client_id,
      product.id,
      product.client_id,
      product.id,
      product.client_id,
      product.id,
      product.client_id,
      product.id,
      product.client_id,
      product.id,
      product.client_id,
      product.id,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error("Backfill facts query returned no row");
  return { ...row, product_quantity: productQuantity };
}

async function expectedHistoricalBalance(
  c: PoolConnection,
  product: ProductRow,
  historicalItemId: number,
  productQuantity: string
) {
  const [rows] = await c.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(b.quantity),'0.000') other_quantity
     FROM erp_inventory_items i
     INNER JOIN erp_inventory_item_balances b
       ON b.client_id=i.client_id AND b.inventory_item_id=i.id
     WHERE i.client_id=? AND i.product_id=? AND i.id<>?`,
    [product.client_id, product.id, historicalItemId]
  );
  const expected =
    quantityMillis(productQuantity) -
    quantityMillis(String(rows[0]?.other_quantity ?? "0.000"));
  if (expected < 0n) {
    throw new Error("Allocated inventory-item balances exceed the product balance");
  }
  return millisQuantity(expected);
}

async function assignHistoricalReferences(
  c: PoolConnection,
  product: ProductRow,
  itemId: number
) {
  await c.execute(
    `UPDATE erp_stock_movements
     SET inventory_item_id=?,inventory_previous_balance=previous_balance,inventory_resulting_balance=resulting_balance
     WHERE client_id=? AND product_id=? AND inventory_item_id IS NULL`,
    [itemId, product.client_id, product.id]
  );
  await c.execute(
    `UPDATE erp_purchase_order_items i
     INNER JOIN erp_purchase_orders o ON o.id=i.purchase_order_id
     SET i.inventory_item_id=?
     WHERE o.client_id=? AND i.product_id=? AND i.inventory_item_id IS NULL`,
    [itemId, product.client_id, product.id]
  );
  await c.execute(
    `UPDATE erp_sale_order_items i
     INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id
     SET i.inventory_item_id=?
     WHERE o.client_id=? AND i.product_id=? AND i.inventory_item_id IS NULL`,
    [itemId, product.client_id, product.id]
  );
  await c.execute(
    `UPDATE erp_purchase_order_receipt_items ri
     INNER JOIN erp_stock_movements m ON m.id=ri.stock_movement_id
     SET ri.inventory_item_id=m.inventory_item_id
     WHERE m.client_id=? AND m.product_id=? AND ri.inventory_item_id IS NULL`,
    [product.client_id, product.id]
  );
  await c.execute(
    `UPDATE erp_sale_order_fulfillment_items fi
     INNER JOIN erp_stock_movements m ON m.id=fi.stock_movement_id
     SET fi.inventory_item_id=m.inventory_item_id
     WHERE m.client_id=? AND m.product_id=? AND fi.inventory_item_id IS NULL`,
    [product.client_id, product.id]
  );
}

async function processProduct(c: PoolConnection, product: ProductRow) {
  // Serialize with every stock writer before taking the facts snapshot. The
  // product row is the canonical first lock for manual operations, while the
  // balance lock also covers reversals and purchase/sale fulfillment.
  const [lockedProducts] = await c.execute<ProductRow[]>(
    "SELECT id,client_id,minimum_stock FROM erp_products WHERE client_id=? AND id=? LIMIT 1 FOR UPDATE",
    [product.client_id, product.id]
  );
  const lockedProduct = lockedProducts[0];
  if (!lockedProduct) throw new Error("Backfill product disappeared before its checkpoint");
  const [balanceRows] = await c.execute<RowDataPacket[]>(
    "SELECT quantity FROM erp_stock_balances WHERE client_id=? AND product_id=? LIMIT 1 FOR UPDATE",
    [lockedProduct.client_id, lockedProduct.id]
  );
  const productQuantity = String(balanceRows[0]?.quantity ?? "0.000");
  const [variants] = await c.execute<VariantRow[]>(
    "SELECT id,active FROM erp_product_variants WHERE client_id=? AND product_id=? ORDER BY id FOR UPDATE",
    [lockedProduct.client_id, lockedProduct.id]
  );
  const fact = await productFacts(c, lockedProduct, productQuantity);
  const hasUnallocatedQuantity =
    quantityMillis(String(fact.product_quantity)) !==
    quantityMillis(String(fact.allocated_quantity));
  const hasProductLevelHistory =
    Number(fact.has_movements) === 1 ||
    Number(fact.has_purchases) === 1 ||
    Number(fact.has_sales) === 1 ||
    hasUnallocatedQuantity;
  const classification = classifyInventoryBackfill({
    variantCount: variants.length,
    hasVariantHistory: Number(fact.has_variant_history) === 1,
    hasProductLevelHistory,
  });
  const useLegacy =
    classification.createLegacyUnallocated || Number(fact.has_legacy_item) === 1;

  let simpleId: number | null = null;
  let legacyId: number | null = null;
  if (classification.createSimple) {
    simpleId = await ensureItem(c, {
      clientId: product.client_id,
      productId: lockedProduct.id,
      variantId: null,
      kind: "simple",
      active: true,
      minimumStock: lockedProduct.minimum_stock,
      legacyReason: null,
    });
  }
  for (const variant of variants) {
    const itemId = await ensureItem(c, {
      clientId: product.client_id,
      productId: lockedProduct.id,
      variantId: variant.id,
      kind: "variant",
      active: variant.active === 1,
      minimumStock: null,
      legacyReason: null,
    });
    await ensureBalance(c, product.client_id, itemId);
  }
  if (useLegacy) {
    legacyId = await ensureItem(c, {
      clientId: product.client_id,
      productId: lockedProduct.id,
      variantId: null,
      kind: "legacy_unallocated",
      active: true,
      minimumStock: lockedProduct.minimum_stock,
      legacyReason: "historical_product_level_activity",
    });
  }

  const historicalItemId =
    useLegacy
      ? legacyId
      : simpleId;
  if (historicalItemId === null && hasProductLevelHistory) {
    throw new Error("Ambiguous historical facts have no legacy inventory item");
  }
  if (historicalItemId !== null) {
    const expected = await expectedHistoricalBalance(
      c,
      lockedProduct,
      historicalItemId,
      productQuantity
    );
    await ensureExpectedBalance(
      c,
      product.client_id,
      historicalItemId,
      expected
    );
    await assignHistoricalReferences(c, lockedProduct, historicalItemId);
  }
  if (simpleId !== null && simpleId !== historicalItemId) {
    await ensureBalance(c, product.client_id, simpleId);
  }

  return {
    simple: simpleId === null ? 0 : 1,
    variants: variants.length,
    legacy: legacyId === null ? 0 : 1,
  };
}

export async function backfillInventoryItems(
  pool: Pool,
  options: InventoryBackfillOptions = {}
): Promise<InventoryBackfillResult> {
  const limit = Math.max(1, Math.min(1_000, options.limit ?? 100));
  const params: Array<string | number> = [];
  let cursorSql = "";
  if (options.after) {
    cursorSql = "WHERE (client_id>? OR (client_id=? AND id>?))";
    params.push(
      options.after.clientId,
      options.after.clientId,
      options.after.productId
    );
  }
  const [products] = await pool.execute<ProductRow[]>(
    `SELECT id,client_id,minimum_stock FROM erp_products ${cursorSql} ORDER BY client_id,id LIMIT ${limit + 1}`,
    params
  );
  const result: InventoryBackfillResult = {
    processed: 0,
    simpleItems: 0,
    variantItems: 0,
    legacyItems: 0,
    lastCursor: options.after ?? null,
    complete: products.length <= limit,
  };

  for (const product of products.slice(0, limit)) {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const counts = await processProduct(c, product);
      await c.commit();
      result.processed += 1;
      result.simpleItems += counts.simple;
      result.variantItems += counts.variants;
      result.legacyItems += counts.legacy;
      result.lastCursor = {
        clientId: product.client_id,
        productId: product.id,
      };
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
    if (
      options.interruptAfter !== undefined &&
      result.processed >= options.interruptAfter &&
      result.lastCursor
    ) {
      throw new InventoryBackfillInterrupted(result.lastCursor);
    }
  }
  return result;
}
