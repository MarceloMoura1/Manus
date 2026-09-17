import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "../../../db";
import type { VariantListInput } from "./contracts";

export type VariantRow = RowDataPacket & {
  id: number;
  public_id: string;
  client_id: string;
  product_id: number;
  product_public_id: string;
  product_name: string;
  product_sale_price_cents: number;
  sku: string;
  name: string | null;
  sale_price_cents: number | null;
  combination_hash: string | null;
  active: number;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type VariantAttributeValueRow = RowDataPacket & {
  id: number;
  variant_id: number;
  attribute_type_id: number;
  attribute_value_id: number;
  type_public_id: string;
  type_name: string;
  type_slug: string;
  value_public_id: string;
  value_name: string;
  value_slug: string;
};

export class VariantRepository {
  constructor(private pool?: Pool) {}
  private database(): Pool {
    return (this.pool ??= getPool());
  }
  getPool(): Pool {
    return this.database();
  }

  async list(clientId: string, options: VariantListInput) {
    const limit = Math.max(1, Math.min(100, Math.trunc(options.pageSize)));
    const offset = Math.max(0, (Math.max(1, Math.trunc(options.page)) - 1) * limit);
    const conditions = ["v.client_id = ?"];
    const parameters: Array<string | number> = [clientId];

    if (options.productPublicId) {
      conditions.push("p.public_id = ?");
      parameters.push(options.productPublicId);
    }
    if (options.search) {
      conditions.push("(v.name LIKE ? OR v.sku LIKE ? OR p.name LIKE ?)");
      const raw = `%${options.search}%`;
      parameters.push(raw, raw, raw);
    }
    if (options.active !== undefined) {
      conditions.push("v.active = ?");
      parameters.push(options.active ? 1 : 0);
    }

    const where = conditions.join(" AND ");
    const [countRows] = await this.database().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total
       FROM erp_product_variants v
       INNER JOIN erp_products p ON p.client_id = v.client_id AND p.id = v.product_id
       WHERE ${where}`,
      parameters
    );

    const [rows] = await this.database().execute<VariantRow[]>(
      `SELECT v.*,
              p.public_id AS product_public_id,
              p.name AS product_name,
              p.sale_price_cents AS product_sale_price_cents
       FROM erp_product_variants v
       INNER JOIN erp_products p ON p.client_id = v.client_id AND p.id = v.product_id
       WHERE ${where}
       ORDER BY v.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      parameters
    );

    const variantIds = rows.map((r) => r.id);
    const attributesMap = await this.getAttributesForVariants(clientId, variantIds);

    return {
      items: rows,
      attributesMap,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async find(
    clientId: string,
    publicId: string,
    connection: Pool | PoolConnection = this.database(),
    lock = false
  ): Promise<VariantRow | null> {
    const [rows] = await connection.execute<VariantRow[]>(
      `SELECT v.*,
              p.public_id AS product_public_id,
              p.name AS product_name,
              p.sale_price_cents AS product_sale_price_cents
       FROM erp_product_variants v
       INNER JOIN erp_products p ON p.client_id = v.client_id AND p.id = v.product_id
       WHERE v.client_id = ? AND v.public_id = ?
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, publicId]
    );
    return rows[0] ?? null;
  }

  async findBySku(
    clientId: string,
    sku: string,
    excludePublicId?: string,
    connection: Pool | PoolConnection = this.database()
  ): Promise<VariantRow | null> {
    const conditions = ["v.client_id = ?", "v.sku = ?"];
    const parameters: string[] = [clientId, sku];
    if (excludePublicId) {
      conditions.push("v.public_id <> ?");
      parameters.push(excludePublicId);
    }
    const [rows] = await connection.execute<VariantRow[]>(
      `SELECT v.*,
              p.public_id AS product_public_id,
              p.name AS product_name,
              p.sale_price_cents AS product_sale_price_cents
       FROM erp_product_variants v
       INNER JOIN erp_products p ON p.client_id = v.client_id AND p.id = v.product_id
       WHERE ${conditions.join(" AND ")}
       LIMIT 1`,
      parameters
    );
    return rows[0] ?? null;
  }

  async findByCombination(
    clientId: string,
    productId: number,
    combinationHash: string,
    excludePublicId?: string,
    connection: Pool | PoolConnection = this.database()
  ): Promise<VariantRow | null> {
    const conditions = [
      "v.client_id = ?",
      "v.product_id = ?",
      "v.combination_hash = ?",
    ];
    const parameters: Array<string | number> = [clientId, productId, combinationHash];
    if (excludePublicId) {
      conditions.push("v.public_id <> ?");
      parameters.push(excludePublicId);
    }
    const [rows] = await connection.execute<VariantRow[]>(
      `SELECT v.*,
              p.public_id AS product_public_id,
              p.name AS product_name,
              p.sale_price_cents AS product_sale_price_cents
       FROM erp_product_variants v
       INNER JOIN erp_products p ON p.client_id = v.client_id AND p.id = v.product_id
       WHERE ${conditions.join(" AND ")}
       LIMIT 1`,
      parameters
    );
    return rows[0] ?? null;
  }

  async findByProductId(
    clientId: string,
    productId: number,
    connection: Pool | PoolConnection = this.database()
  ): Promise<{ rows: VariantRow[]; attributesMap: Map<number, VariantAttributeValueRow[]> }> {
    const [rows] = await connection.execute<VariantRow[]>(
      `SELECT v.*,
              p.public_id AS product_public_id,
              p.name AS product_name,
              p.sale_price_cents AS product_sale_price_cents
       FROM erp_product_variants v
       INNER JOIN erp_products p ON p.client_id = v.client_id AND p.id = v.product_id
       WHERE v.client_id = ? AND v.product_id = ?
       ORDER BY v.sku ASC, v.id ASC`,
      [clientId, productId]
    );
    if (rows.length === 0) return { rows: [], attributesMap: new Map() };
    const variantIds = rows.map((r) => r.id);
    const attributesMap = await this.getAttributesForVariants(clientId, variantIds, connection);
    return { rows, attributesMap };
  }

  async getAttributesForVariant(
    clientId: string,
    variantId: number,
    connection: Pool | PoolConnection = this.database()
  ): Promise<VariantAttributeValueRow[]> {
    const [rows] = await connection.execute<VariantAttributeValueRow[]>(
      `SELECT vav.id,
              vav.variant_id,
              vav.attribute_type_id,
              vav.attribute_value_id,
              t.public_id AS type_public_id,
              t.name AS type_name,
              t.slug AS type_slug,
              val.public_id AS value_public_id,
              val.name AS value_name,
              val.slug AS value_slug
       FROM erp_product_variant_attribute_values vav
       INNER JOIN erp_product_attribute_types t ON t.client_id = vav.client_id AND t.id = vav.attribute_type_id
       INNER JOIN erp_product_attribute_values val ON val.client_id = vav.client_id AND val.id = vav.attribute_value_id
       WHERE vav.client_id = ? AND vav.variant_id = ?
       ORDER BY t.name ASC`,
      [clientId, variantId]
    );
    return rows;
  }

  async getAttributesForVariants(
    clientId: string,
    variantIds: number[],
    connection: Pool | PoolConnection = this.database()
  ): Promise<Map<number, VariantAttributeValueRow[]>> {
    const map = new Map<number, VariantAttributeValueRow[]>();
    if (variantIds.length === 0) return map;

    const placeholders = variantIds.map(() => "?").join(", ");
    const [rows] = await connection.execute<VariantAttributeValueRow[]>(
      `SELECT vav.id,
              vav.variant_id,
              vav.attribute_type_id,
              vav.attribute_value_id,
              t.public_id AS type_public_id,
              t.name AS type_name,
              t.slug AS type_slug,
              val.public_id AS value_public_id,
              val.name AS value_name,
              val.slug AS value_slug
       FROM erp_product_variant_attribute_values vav
       INNER JOIN erp_product_attribute_types t ON t.client_id = vav.client_id AND t.id = vav.attribute_type_id
       INNER JOIN erp_product_attribute_values val ON val.client_id = vav.client_id AND val.id = vav.attribute_value_id
       WHERE vav.client_id = ? AND vav.variant_id IN (${placeholders})
       ORDER BY t.name ASC`,
      [clientId, ...variantIds]
    );

    for (const row of rows) {
      const list = map.get(row.variant_id) ?? [];
      list.push(row);
      map.set(row.variant_id, list);
    }
    return map;
  }

  async create(
    clientId: string,
    userId: string,
    publicId: string,
    productId: number,
    data: {
      sku: string;
      name?: string | null;
      salePriceCents?: number | null;
      combinationHash?: string | null;
      active?: boolean;
    },
    attributePairs: Array<{ attributeTypeId: number; attributeValueId: number }>,
    connection?: Pool | PoolConnection
  ): Promise<VariantRow> {
    if (connection) {
      const [insertResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO erp_product_variants
          (public_id, client_id, product_id, sku, name, sale_price_cents, combination_hash, active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          publicId,
          clientId,
          productId,
          data.sku,
          data.name ?? null,
          data.salePriceCents ?? null,
          data.combinationHash ?? null,
          data.active ?? true ? 1 : 0,
          userId,
        ]
      );

      const variantId = insertResult.insertId;

      for (const pair of attributePairs) {
        await connection.execute(
          `INSERT INTO erp_product_variant_attribute_values
            (client_id, variant_id, attribute_type_id, attribute_value_id)
           VALUES (?, ?, ?, ?)`,
          [clientId, variantId, pair.attributeTypeId, pair.attributeValueId]
        );
      }

      const row = await this.find(clientId, publicId, connection);
      if (!row) throw new Error("Variant insert failed to retrieve row");
      return row;
    }

    const conn = await this.database().getConnection();
    try {
      await conn.beginTransaction();

      const [insertResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO erp_product_variants
          (public_id, client_id, product_id, sku, name, sale_price_cents, combination_hash, active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          publicId,
          clientId,
          productId,
          data.sku,
          data.name ?? null,
          data.salePriceCents ?? null,
          data.combinationHash ?? null,
          data.active ?? true ? 1 : 0,
          userId,
        ]
      );

      const variantId = insertResult.insertId;

      for (const pair of attributePairs) {
        await conn.execute(
          `INSERT INTO erp_product_variant_attribute_values
            (client_id, variant_id, attribute_type_id, attribute_value_id)
           VALUES (?, ?, ?, ?)`,
          [clientId, variantId, pair.attributeTypeId, pair.attributeValueId]
        );
      }

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    const row = await this.find(clientId, publicId);
    if (!row) throw new Error("Variant insert failed to retrieve row");
    return row;
  }

  async update(
    clientId: string,
    publicId: string,
    userId: string,
    data: {
      sku?: string;
      name?: string | null;
      salePriceCents?: number | null;
      active?: boolean;
    },
    connection: Pool | PoolConnection = this.database()
  ): Promise<VariantRow | null> {
    const updates: string[] = ["updated_by = ?"];
    const parameters: Array<string | number | null> = [userId];

    if (data.sku !== undefined) {
      updates.push("sku = ?");
      parameters.push(data.sku);
    }
    if (data.name !== undefined) {
      updates.push("name = ?");
      parameters.push(data.name);
    }
    if (data.salePriceCents !== undefined) {
      updates.push("sale_price_cents = ?");
      parameters.push(data.salePriceCents);
    }
    if (data.active !== undefined) {
      updates.push("active = ?");
      parameters.push(data.active ? 1 : 0);
    }

    parameters.push(clientId, publicId);

    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE erp_product_variants SET ${updates.join(", ")} WHERE client_id = ? AND public_id = ?`,
      parameters
    );

    return result.affectedRows > 0 ? this.find(clientId, publicId, connection) : null;
  }

  async setAttributes(
    clientId: string,
    publicId: string,
    userId: string,
    combinationHash: string | null,
    attributePairs: Array<{ attributeTypeId: number; attributeValueId: number }>,
    connection?: Pool | PoolConnection
  ): Promise<VariantRow | null> {
    if (connection) {
      const variant = await this.find(clientId, publicId, connection, true);
      if (!variant) return null;

      await connection.execute(
        `DELETE FROM erp_product_variant_attribute_values WHERE client_id = ? AND variant_id = ?`,
        [clientId, variant.id]
      );

      for (const pair of attributePairs) {
        await connection.execute(
          `INSERT INTO erp_product_variant_attribute_values
            (client_id, variant_id, attribute_type_id, attribute_value_id)
           VALUES (?, ?, ?, ?)`,
          [clientId, variant.id, pair.attributeTypeId, pair.attributeValueId]
        );
      }

      await connection.execute(
        `UPDATE erp_product_variants SET combination_hash = ?, updated_by = ? WHERE client_id = ? AND id = ?`,
        [combinationHash, userId, clientId, variant.id]
      );

      return this.find(clientId, publicId, connection);
    }

    const conn = await this.database().getConnection();
    try {
      await conn.beginTransaction();

      const variant = await this.find(clientId, publicId, conn, true);
      if (!variant) {
        await conn.rollback();
        return null;
      }

      await conn.execute(
        `DELETE FROM erp_product_variant_attribute_values WHERE client_id = ? AND variant_id = ?`,
        [clientId, variant.id]
      );

      for (const pair of attributePairs) {
        await conn.execute(
          `INSERT INTO erp_product_variant_attribute_values
            (client_id, variant_id, attribute_type_id, attribute_value_id)
           VALUES (?, ?, ?, ?)`,
          [clientId, variant.id, pair.attributeTypeId, pair.attributeValueId]
        );
      }

      await conn.execute(
        `UPDATE erp_product_variants SET combination_hash = ?, updated_by = ? WHERE client_id = ? AND id = ?`,
        [combinationHash, userId, clientId, variant.id]
      );

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    return this.find(clientId, publicId);
  }

  async setActive(
    clientId: string,
    publicId: string,
    userId: string,
    active: boolean,
    connection: Pool | PoolConnection = this.database()
  ): Promise<boolean> {
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE erp_product_variants SET active = ?, updated_by = ? WHERE client_id = ? AND public_id = ?`,
      [active ? 1 : 0, userId, clientId, publicId]
    );
    return result.affectedRows > 0;
  }

  async delete(
    clientId: string,
    publicId: string,
    connection: Pool | PoolConnection = this.database()
  ): Promise<boolean> {
    const [result] = await connection.execute<ResultSetHeader>(
      `DELETE FROM erp_product_variants WHERE client_id = ? AND public_id = ?`,
      [clientId, publicId]
    );
    return result.affectedRows > 0;
  }
}
