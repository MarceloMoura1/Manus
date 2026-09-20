import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "../../../db";
import type { ProductSupplierListInput } from "./contracts";

export type ProductSupplierRow = RowDataPacket & {
  id: number;
  public_id: string;
  client_id: string;
  product_id: number;
  product_public_id: string;
  product_name: string;
  product_sku: string;
  supplier_id: number;
  supplier_public_id: string;
  supplier_legal_name: string;
  supplier_trade_name: string | null;
  supplier_product_code: string | null;
  cost_price_cents: number | null;
  is_preferred: number;
  active: number;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  created_by_name?: string | null;
  updated_by_name?: string | null;
};

export class ProductSupplierRepository {
  constructor(private pool?: Pool) {}
  private database(): Pool {
    return (this.pool ??= getPool());
  }
  getPool(): Pool {
    return this.database();
  }

  async list(clientId: string, options: ProductSupplierListInput) {
    const limit = Math.max(1, Math.min(100, Math.trunc(options.pageSize)));
    const offset = Math.max(0, (Math.max(1, Math.trunc(options.page)) - 1) * limit);
    const conditions = ["ps.client_id = ?"];
    const parameters: Array<string | number> = [clientId];

    if (options.productPublicId) {
      conditions.push("p.public_id = ?");
      parameters.push(options.productPublicId);
    }
    if (options.supplierPublicId) {
      conditions.push("s.public_id = ?");
      parameters.push(options.supplierPublicId);
    }
    if (options.isPreferred !== undefined) {
      conditions.push("ps.is_preferred = ?");
      parameters.push(options.isPreferred ? 1 : 0);
    }
    if (options.active !== undefined) {
      conditions.push("ps.active = ?");
      parameters.push(options.active ? 1 : 0);
    }
    if (options.search) {
      conditions.push(
        "(p.name LIKE ? OR p.sku LIKE ? OR s.legal_name LIKE ? OR s.trade_name LIKE ? OR ps.supplier_product_code LIKE ?)"
      );
      const raw = `%${options.search}%`;
      parameters.push(raw, raw, raw, raw, raw);
    }

    const where = conditions.join(" AND ");
    const [countRows] = await this.database().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total
       FROM erp_product_suppliers ps
       INNER JOIN erp_products p ON p.client_id = ps.client_id AND p.id = ps.product_id
       INNER JOIN erp_suppliers s ON s.client_id = ps.client_id AND s.id = ps.supplier_id
       WHERE ${where}`,
      parameters
    );

    const [rows] = await this.database().execute<ProductSupplierRow[]>(
      `SELECT ps.*,
              p.public_id AS product_public_id,
              p.name AS product_name,
              p.sku AS product_sku,
              s.public_id AS supplier_public_id,
              s.legal_name AS supplier_legal_name,
              s.trade_name AS supplier_trade_name,
              COALESCE(u_created.name, u_created.email) AS created_by_name
       FROM erp_product_suppliers ps
       INNER JOIN erp_products p ON p.client_id = ps.client_id AND p.id = ps.product_id
       INNER JOIN erp_suppliers s ON s.client_id = ps.client_id AND s.id = ps.supplier_id
       LEFT JOIN megadesk_domain_client_users u_created ON u_created.client_id = ps.client_id AND u_created.user_id = ps.created_by
       WHERE ${where}
       ORDER BY ps.is_preferred DESC, s.legal_name ASC
       LIMIT ${limit} OFFSET ${offset}`,
      parameters
    );

    return {
      items: rows,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async find(
    clientId: string,
    publicId: string,
    connection: Pool | PoolConnection = this.database(),
    lock = false
  ): Promise<ProductSupplierRow | null> {
    const [rows] = await connection.execute<ProductSupplierRow[]>(
      `SELECT ps.*,
              p.public_id AS product_public_id,
              p.name AS product_name,
              p.sku AS product_sku,
              s.public_id AS supplier_public_id,
              s.legal_name AS supplier_legal_name,
              s.trade_name AS supplier_trade_name,
              COALESCE(u_created.name, u_created.email) AS created_by_name
       FROM erp_product_suppliers ps
       INNER JOIN erp_products p ON p.client_id = ps.client_id AND p.id = ps.product_id
       INNER JOIN erp_suppliers s ON s.client_id = ps.client_id AND s.id = ps.supplier_id
       LEFT JOIN megadesk_domain_client_users u_created ON u_created.client_id = ps.client_id AND u_created.user_id = ps.created_by
       WHERE ps.client_id = ? AND ps.public_id = ?
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, publicId]
    );
    return rows[0] ?? null;
  }

  async findByProductAndSupplier(
    clientId: string,
    productId: number,
    supplierId: number,
    connection: Pool | PoolConnection = this.database(),
    lock = false
  ): Promise<ProductSupplierRow | null> {
    const [rows] = await connection.execute<ProductSupplierRow[]>(
      `SELECT ps.*,
              p.public_id AS product_public_id,
              p.name AS product_name,
              p.sku AS product_sku,
              s.public_id AS supplier_public_id,
              s.legal_name AS supplier_legal_name,
              s.trade_name AS supplier_trade_name
       FROM erp_product_suppliers ps
       INNER JOIN erp_products p ON p.client_id = ps.client_id AND p.id = ps.product_id
       INNER JOIN erp_suppliers s ON s.client_id = ps.client_id AND s.id = ps.supplier_id
       WHERE ps.client_id = ? AND ps.product_id = ? AND ps.supplier_id = ?
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, productId, supplierId]
    );
    return rows[0] ?? null;
  }

  async findPreferredForProduct(
    clientId: string,
    productId: number,
    connection: Pool | PoolConnection = this.database(),
    lock = false
  ): Promise<ProductSupplierRow | null> {
    const [rows] = await connection.execute<ProductSupplierRow[]>(
      `SELECT ps.*,
              p.public_id AS product_public_id,
              p.name AS product_name,
              p.sku AS product_sku,
              s.public_id AS supplier_public_id,
              s.legal_name AS supplier_legal_name,
              s.trade_name AS supplier_trade_name
       FROM erp_product_suppliers ps
       INNER JOIN erp_products p ON p.client_id = ps.client_id AND p.id = ps.product_id
       INNER JOIN erp_suppliers s ON s.client_id = ps.client_id AND s.id = ps.supplier_id
       WHERE ps.client_id = ? AND ps.product_id = ? AND ps.is_preferred = 1
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, productId]
    );
    return rows[0] ?? null;
  }

  async lockProductRow(
    clientId: string,
    productId: number,
    connection: Pool | PoolConnection = this.database()
  ): Promise<void> {
    await connection.execute(
      `SELECT id FROM erp_products WHERE client_id = ? AND id = ? FOR UPDATE`,
      [clientId, productId]
    );
  }

  async clearPreferredForProduct(
    clientId: string,
    productId: number,
    excludeId?: number,
    connection: Pool | PoolConnection = this.database()
  ): Promise<void> {
    const conditions = ["client_id = ?", "product_id = ?"];
    const parameters: Array<string | number> = [clientId, productId];
    if (excludeId) {
      conditions.push("id <> ?");
      parameters.push(excludeId);
    }
    await connection.execute(
      `UPDATE erp_product_suppliers SET is_preferred = 0 WHERE ${conditions.join(" AND ")}`,
      parameters
    );
  }

  async create(
    clientId: string,
    userId: string,
    publicId: string,
    productId: number,
    supplierId: number,
    data: {
      supplierProductCode?: string | null;
      costPriceCents?: number | null;
      isPreferred?: boolean;
      active?: boolean;
    },
    connection: Pool | PoolConnection = this.database()
  ): Promise<ProductSupplierRow> {
    await connection.execute(
      `INSERT INTO erp_product_suppliers
        (public_id, client_id, product_id, supplier_id, supplier_product_code, cost_price_cents, is_preferred, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicId,
        clientId,
        productId,
        supplierId,
        data.supplierProductCode ?? null,
        data.costPriceCents ?? null,
        data.isPreferred ?? false ? 1 : 0,
        data.active ?? true ? 1 : 0,
        userId,
      ]
    );

    const row = await this.find(clientId, publicId, connection);
    if (!row) throw new Error("ProductSupplier insert failed to retrieve row");
    return row;
  }

  async update(
    clientId: string,
    publicId: string,
    userId: string,
    data: {
      supplierProductCode?: string | null;
      costPriceCents?: number | null;
      isPreferred?: boolean;
      active?: boolean;
    },
    connection: Pool | PoolConnection = this.database()
  ): Promise<ProductSupplierRow | null> {
    const updates: string[] = ["updated_by = ?"];
    const parameters: Array<string | number | null> = [userId];

    if (data.supplierProductCode !== undefined) {
      updates.push("supplier_product_code = ?");
      parameters.push(data.supplierProductCode);
    }
    if (data.costPriceCents !== undefined) {
      updates.push("cost_price_cents = ?");
      parameters.push(data.costPriceCents);
    }
    if (data.isPreferred !== undefined) {
      updates.push("is_preferred = ?");
      parameters.push(data.isPreferred ? 1 : 0);
    }
    if (data.active !== undefined) {
      updates.push("active = ?");
      parameters.push(data.active ? 1 : 0);
    }

    parameters.push(clientId, publicId);

    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE erp_product_suppliers SET ${updates.join(", ")} WHERE client_id = ? AND public_id = ?`,
      parameters
    );

    return result.affectedRows > 0 ? this.find(clientId, publicId, connection) : null;
  }

  async setPreferred(
    clientId: string,
    publicId: string,
    userId: string,
    isPreferred: boolean,
    connection?: Pool | PoolConnection
  ): Promise<ProductSupplierRow | null> {
    if (connection) {
      const current = await this.find(clientId, publicId, connection, true);
      if (!current) return null;

      if (isPreferred) {
        await this.lockProductRow(clientId, current.product_id, connection);
        // Clear existing preferred for this product
        await connection.execute(
          `UPDATE erp_product_suppliers
           SET is_preferred = 0, updated_by = ?
           WHERE client_id = ? AND product_id = ? AND id <> ?`,
          [userId, clientId, current.product_id, current.id]
        );

        // Set current to preferred
        await connection.execute(
          `UPDATE erp_product_suppliers
           SET is_preferred = 1, updated_by = ?
           WHERE client_id = ? AND id = ?`,
          [userId, clientId, current.id]
        );
      } else {
        // Unmark current
        await connection.execute(
          `UPDATE erp_product_suppliers
           SET is_preferred = 0, updated_by = ?
           WHERE client_id = ? AND id = ?`,
          [userId, clientId, current.id]
        );
      }

      return this.find(clientId, publicId, connection);
    }

    const conn = await this.database().getConnection();
    try {
      await conn.beginTransaction();

      const current = await this.find(clientId, publicId, conn, true);
      if (!current) {
        await conn.rollback();
        return null;
      }

      if (isPreferred) {
        await this.lockProductRow(clientId, current.product_id, conn);
        // Clear existing preferred for this product
        await conn.execute(
          `UPDATE erp_product_suppliers
           SET is_preferred = 0, updated_by = ?
           WHERE client_id = ? AND product_id = ? AND id <> ?`,
          [userId, clientId, current.product_id, current.id]
        );

        // Set current to preferred
        await conn.execute(
          `UPDATE erp_product_suppliers
           SET is_preferred = 1, updated_by = ?
           WHERE client_id = ? AND id = ?`,
          [userId, clientId, current.id]
        );
      } else {
        // Unmark current
        await conn.execute(
          `UPDATE erp_product_suppliers
           SET is_preferred = 0, updated_by = ?
           WHERE client_id = ? AND id = ?`,
          [userId, clientId, current.id]
        );
      }

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    return this.find(clientId, publicId);
  }

  async delete(
    clientId: string,
    publicId: string,
    connection: Pool | PoolConnection = this.database()
  ): Promise<boolean> {
    const [result] = await connection.execute<ResultSetHeader>(
      `DELETE FROM erp_product_suppliers WHERE client_id = ? AND public_id = ?`,
      [clientId, publicId]
    );
    return result.affectedRows > 0;
  }
}
