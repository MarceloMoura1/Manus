import { randomUUID } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "../../../db";
import { ErpDomainError } from "../errors";
import { effectiveInventoryCost, type InventoryItemKind } from "./model";

export type InventoryItemRow = RowDataPacket & {
  id: number;
  public_id: string;
  client_id: string;
  product_id: number;
  variant_id: number | null;
  kind: InventoryItemKind;
  active: number;
  minimum_stock: string | null;
  legacy_reason: string | null;
  legacy_cost_snapshot_cents: number | null;
  quantity?: string;
  product_public_id?: string;
  product_name?: string;
  product_sku?: string;
  product_cost_price_cents?: number;
  primary_media_public_id?: string | null;
  variant_public_id?: string | null;
  variant_name?: string | null;
  variant_sku?: string | null;
  variant_cost_price_cents?: number | null;
  variant_active?: number | null;
  attributes_label?: string | null;
};

type Executor = Pool | PoolConnection;

export class InventoryRepository {
  constructor(private pool?: Pool) {}
  private db(): Pool {
    return (this.pool ??= getPool());
  }

  async createSimpleForProduct(
    connection: Executor,
    input: {
      clientId: string;
      productId: number;
      minimumStock: string;
      userId: string;
    }
  ): Promise<InventoryItemRow> {
    await connection.execute(
      `INSERT INTO erp_inventory_items
        (public_id,client_id,product_id,variant_id,kind,active,minimum_stock,created_by)
       VALUES(?,?,?,NULL,'simple',1,?,?)
       ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [randomUUID(), input.clientId, input.productId, input.minimumStock, input.userId]
    );
    const item = await this.findByKind(
      connection,
      input.clientId,
      input.productId,
      "simple"
    );
    if (!item) throw new Error("Simple inventory item was not created");
    await this.ensureBalance(connection, input.clientId, item.id);
    return item;
  }

  async createVariantForProduct(
    connection: Executor,
    input: {
      clientId: string;
      productId: number;
      variantId: number;
      active: boolean;
      userId: string;
    }
  ): Promise<InventoryItemRow> {
    await connection.execute(
      `INSERT INTO erp_inventory_items
        (public_id,client_id,product_id,variant_id,kind,active,minimum_stock,created_by)
       VALUES(?,?,?,?,'variant',?,NULL,?)
       ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),active=VALUES(active)`,
      [
        randomUUID(),
        input.clientId,
        input.productId,
        input.variantId,
        input.active ? 1 : 0,
        input.userId,
      ]
    );
    const [rows] = await connection.execute<InventoryItemRow[]>(
      "SELECT * FROM erp_inventory_items WHERE client_id=? AND variant_id=? AND kind='variant' LIMIT 1",
      [input.clientId, input.variantId]
    );
    const item = rows[0];
    if (!item) throw new Error("Variant inventory item was not created");
    await this.ensureBalance(connection, input.clientId, item.id);
    return item;
  }

  /**
   * A product starts with a simple item. Creating its first variant changes the
   * future stock identity, but must not rewrite any fact already attached to
   * that simple item. An unused zero item can be removed; otherwise it becomes
   * the single legacy bucket for the product and keeps its balance/history.
   */
  async prepareSimpleItemForFirstVariant(
    connection: PoolConnection,
    input: { clientId: string; productId: number }
  ): Promise<"absent" | "removed" | "converted_to_legacy"> {
    const [rows] = await connection.execute<InventoryItemRow[]>(
      `SELECT i.*,COALESCE(b.quantity,'0.000') quantity
       FROM erp_inventory_items i
       LEFT JOIN erp_inventory_item_balances b
         ON b.client_id=i.client_id AND b.inventory_item_id=i.id
       WHERE i.client_id=? AND i.product_id=? AND i.kind='simple'
       LIMIT 1 FOR UPDATE`,
      [input.clientId, input.productId]
    );
    const item = rows[0];
    if (!item) return "absent";

    const [references] = await connection.execute<RowDataPacket[]>(
      `SELECT
         EXISTS(SELECT 1 FROM erp_stock_movements m WHERE m.client_id=? AND m.inventory_item_id=? LIMIT 1) movement_ref,
         EXISTS(SELECT 1 FROM erp_purchase_order_items x WHERE x.inventory_item_id=? LIMIT 1) purchase_ref,
         EXISTS(SELECT 1 FROM erp_purchase_order_receipt_items x WHERE x.inventory_item_id=? LIMIT 1) receipt_ref,
         EXISTS(SELECT 1 FROM erp_sale_order_items x WHERE x.inventory_item_id=? LIMIT 1) sale_ref,
         EXISTS(SELECT 1 FROM erp_sale_order_fulfillment_items x WHERE x.inventory_item_id=? LIMIT 1) fulfillment_ref`,
      [
        input.clientId,
        item.id,
        item.id,
        item.id,
        item.id,
        item.id,
      ]
    );
    const hasReferences = Object.values(references[0] ?? {}).some(
      value => Number(value) === 1
    );
    const hasQuantity = String(item.quantity ?? "0.000") !== "0.000";

    if (!hasReferences && !hasQuantity) {
      await connection.execute(
        "DELETE FROM erp_inventory_item_balances WHERE client_id=? AND inventory_item_id=?",
        [input.clientId, item.id]
      );
      await connection.execute(
        "DELETE FROM erp_inventory_items WHERE client_id=? AND id=? AND kind='simple'",
        [input.clientId, item.id]
      );
      return "removed";
    }

    await connection.execute(
      `UPDATE erp_inventory_items
       SET kind='legacy_unallocated',legacy_reason='variant_created_after_product_activity',legacy_cost_snapshot_cents=NULL
       WHERE client_id=? AND id=? AND kind='simple'`,
      [input.clientId, item.id]
    );
    return "converted_to_legacy";
  }

  async setVariantItemActive(
    connection: Executor,
    clientId: string,
    variantId: number,
    active: boolean
  ): Promise<void> {
    await connection.execute(
      "UPDATE erp_inventory_items SET active=? WHERE client_id=? AND variant_id=? AND kind='variant'",
      [active ? 1 : 0, clientId, variantId]
    );
  }

  async ensureLegacyForProduct(
    connection: Executor,
    input: {
      clientId: string;
      productId: number;
      minimumStock: string | null;
      userId: string;
      reason: string;
    }
  ): Promise<InventoryItemRow> {
    await connection.execute(
      `INSERT INTO erp_inventory_items
        (public_id,client_id,product_id,variant_id,kind,active,minimum_stock,legacy_reason,legacy_cost_snapshot_cents,created_by)
       VALUES(?,?,?,NULL,'legacy_unallocated',1,?,?,NULL,?)
       ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [
        randomUUID(),
        input.clientId,
        input.productId,
        input.minimumStock,
        input.reason,
        input.userId,
      ]
    );
    const item = await this.findByKind(
      connection,
      input.clientId,
      input.productId,
      "legacy_unallocated"
    );
    if (!item) throw new Error("Legacy inventory item was not created");
    await this.ensureBalance(connection, input.clientId, item.id);
    return item;
  }

  async findByKind(
    connection: Executor,
    clientId: string,
    productId: number,
    kind: "simple" | "legacy_unallocated"
  ): Promise<InventoryItemRow | null> {
    const [rows] = await connection.execute<InventoryItemRow[]>(
      "SELECT * FROM erp_inventory_items WHERE client_id=? AND product_id=? AND kind=? LIMIT 1",
      [clientId, productId, kind]
    );
    return rows[0] ?? null;
  }

  async resolveForOperation(
    connection: PoolConnection,
    input: {
      clientId: string;
      productId: number;
      requestedPublicId?: string | null;
      userId: string;
      productMinimumStock: string;
    }
  ): Promise<InventoryItemRow> {
    if (input.requestedPublicId) {
      const [rows] = await connection.execute<InventoryItemRow[]>(
        `SELECT i.*,v.active variant_active
         FROM erp_inventory_items i
         LEFT JOIN erp_product_variants v
           ON v.client_id=i.client_id AND v.product_id=i.product_id AND v.id=i.variant_id
         WHERE i.client_id=? AND i.product_id=? AND i.public_id=? AND i.active=1
           AND (i.kind<>'variant' OR v.active=1)
         LIMIT 1 FOR UPDATE`,
        [input.clientId, input.productId, input.requestedPublicId]
      );
      if (!rows[0]) {
        throw new ErpDomainError(
          "NOT_FOUND",
          "Inventory item ativo não encontrado para este produto e tenant."
        );
      }
      return rows[0];
    }

    const [variantItems] = await connection.execute<InventoryItemRow[]>(
      `SELECT i.* FROM erp_inventory_items i
       INNER JOIN erp_product_variants v
         ON v.client_id=i.client_id AND v.product_id=i.product_id AND v.id=i.variant_id
       WHERE i.client_id=? AND i.product_id=? AND i.kind='variant'
         AND i.active=1 AND v.active=1
       ORDER BY i.id FOR UPDATE`,
      [input.clientId, input.productId]
    );
    if (variantItems.length === 1) return variantItems[0];

    const [variantCountRows] = await connection.execute<RowDataPacket[]>(
      "SELECT COUNT(*) total FROM erp_product_variants WHERE client_id=? AND product_id=?",
      [input.clientId, input.productId]
    );
    if (Number(variantCountRows[0]?.total ?? 0) === 0) {
      const simple = await this.findByKind(
        connection,
        input.clientId,
        input.productId,
        "simple"
      );
      if (simple?.active === 1) return simple;
      throw new ErpDomainError(
        "CONFLICT",
        "Inventory item simples ainda não está preparado para este produto."
      );
    }

    return this.ensureLegacyForProduct(connection, {
      clientId: input.clientId,
      productId: input.productId,
      minimumStock: input.productMinimumStock,
      userId: input.userId,
      reason: "compatibility_product_only_operation",
    });
  }

  async ensureBalance(
    connection: Executor,
    clientId: string,
    inventoryItemId: number
  ): Promise<void> {
    await connection.execute(
      "INSERT IGNORE INTO erp_inventory_item_balances(client_id,inventory_item_id,quantity,version) VALUES(?,?,0,0)",
      [clientId, inventoryItemId]
    );
  }

  async lockBalance(
    connection: PoolConnection,
    clientId: string,
    inventoryItemId: number
  ): Promise<string> {
    await this.ensureBalance(connection, clientId, inventoryItemId);
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT quantity FROM erp_inventory_item_balances WHERE client_id=? AND inventory_item_id=? FOR UPDATE",
      [clientId, inventoryItemId]
    );
    return String(rows[0]?.quantity ?? "0.000");
  }

  async setBalance(
    connection: PoolConnection,
    clientId: string,
    inventoryItemId: number,
    quantity: string
  ): Promise<void> {
    await connection.execute(
      "UPDATE erp_inventory_item_balances SET quantity=?,version=version+1 WHERE client_id=? AND inventory_item_id=?",
      [quantity, clientId, inventoryItemId]
    );
  }

  async listForUi(clientId: string, productPublicId?: string) {
    const params: string[] = [clientId];
    let productFilter = "";
    if (productPublicId) {
      productFilter = " AND p.public_id=?";
      params.push(productPublicId);
    }
    const [rows] = await this.db().execute<InventoryItemRow[]>(
      `SELECT i.*,COALESCE(b.quantity,'0.000') quantity,
        p.public_id product_public_id,p.name product_name,p.sku product_sku,
        p.cost_price_cents product_cost_price_cents,
        pm.media_id primary_media_public_id,
        v.public_id variant_public_id,v.name variant_name,v.sku variant_sku,
        v.cost_price_cents variant_cost_price_cents,
        GROUP_CONCAT(CONCAT(t.name, ': ',av.name) ORDER BY t.name SEPARATOR ' · ') attributes_label
       FROM erp_inventory_items i
       INNER JOIN erp_products p ON p.client_id=i.client_id AND p.id=i.product_id
       LEFT JOIN erp_product_media pm
         ON pm.client_id=p.client_id AND pm.product_id=p.id
        AND pm.id=p.primary_media_id AND pm.state='active'
       LEFT JOIN erp_product_variants v ON v.client_id=i.client_id AND v.id=i.variant_id
       LEFT JOIN erp_inventory_item_balances b ON b.client_id=i.client_id AND b.inventory_item_id=i.id
       LEFT JOIN erp_product_variant_attribute_values vv ON vv.client_id=i.client_id AND vv.variant_id=v.id
       LEFT JOIN erp_product_attribute_types t ON t.client_id=vv.client_id AND t.id=vv.attribute_type_id
       LEFT JOIN erp_product_attribute_values av ON av.client_id=vv.client_id AND av.id=vv.attribute_value_id
       WHERE i.client_id=?${productFilter}
       GROUP BY i.id,p.id,v.id,pm.media_id,b.quantity
       ORDER BY p.name,i.kind,v.sku,i.id`,
      params
    );
    return rows.map(row => {
      const cost = effectiveInventoryCost({
        kind: row.kind,
        productCostCents: Number(row.product_cost_price_cents ?? 0),
        variantCostCents:
          row.variant_cost_price_cents === null ||
          row.variant_cost_price_cents === undefined
            ? null
            : Number(row.variant_cost_price_cents),
        legacyCostSnapshotCents:
          row.legacy_cost_snapshot_cents === null
            ? null
            : Number(row.legacy_cost_snapshot_cents),
      });
      const quantity = String(row.quantity ?? "0.000");
      return {
        publicId: row.public_id,
        kind: row.kind,
        product: {
          publicId: row.product_public_id,
          name: row.product_name,
          sku: row.product_sku,
          canonicalImage:
            row.primary_media_public_id
              ? {
                  mediaId: row.primary_media_public_id,
                  path: `/api/products/${row.product_public_id}/image`,
                  thumbnailPath: `/api/products/${row.product_public_id}/image?variant=thumbnail`,
                }
              : null,
        },
        variant:
          row.kind === "variant"
            ? {
                publicId: row.variant_public_id,
                name: row.variant_name,
                sku: row.variant_sku,
                attributesLabel: row.attributes_label ?? row.variant_name,
              }
            : null,
        label:
          row.kind === "legacy_unallocated"
            ? "Legado não atribuído"
            : row.kind === "simple"
              ? row.product_name
              : row.attributes_label || row.variant_name || row.variant_sku,
        quantity,
        minimumStock: row.minimum_stock,
        active: row.active === 1,
        effectiveCostCents: cost.cents,
        costSource: cost.source,
        valuationCents:
          cost.cents === null ? null : Math.round(Number(quantity) * cost.cents),
      };
    });
  }
}
