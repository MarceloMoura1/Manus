import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "../../db";

export type ProductRow = RowDataPacket & {
  id: number; public_id: string; client_id: string; name: string; sku: string; barcode: string | null;
  description: string | null; category: string | null; unit: "unit" | "kg" | "liter" | "meter";
  cost_price_cents: number; sale_price_cents: number; minimum_stock: string; active: number;
  created_by: string; updated_by: string | null; created_at: string; updated_at: string; quantity: string;
};

export type MovementRow = RowDataPacket & {
  id: number; public_id: string; client_id: string; product_id: number; product_public_id: string; product_name: string; sku: string;
  type: string; direction: "in" | "out"; quantity: string; previous_balance: string; resulting_balance: string;
  reason: string; reference_type: string | null; reference_id: string | null; idempotency_key: string;
  payload_hash: string; reversal_of: number | null; created_by: string; created_at: string; reversed?: number; reversal_public_id?: string | null;
};

export type ProductListOptions = { search: string; active?: boolean; category?: string; stock: "all" | "low" | "empty" | "available" | "normal"; sort: "name" | "sku" | "createdAt" | "stock"; direction: "asc" | "desc"; page: number; pageSize: number };

export class ErpRepository {
  constructor(private pool?: Pool) {}
  private database(): Pool { this.pool ??= getPool(); return this.pool; }

  async listProducts(clientId: string, options: ProductListOptions) {
    const limit = Math.max(1, Math.min(100, Math.trunc(options.pageSize)));
    const offset = Math.max(0, (Math.max(1, Math.trunc(options.page)) - 1) * limit);
    const conditions = ["p.client_id = ?"];
    const values: Array<string | number> = [clientId];
    if (options.search) { conditions.push("(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)"); const value = `%${options.search}%`; values.push(value, value, value); }
    if (options.active !== undefined) { conditions.push("p.active = ?"); values.push(options.active ? 1 : 0); }
    if (options.category) { conditions.push("p.category = ?"); values.push(options.category); }
    if (options.stock === "empty") conditions.push("COALESCE(b.quantity, 0) = 0");
    if (options.stock === "low") conditions.push("COALESCE(b.quantity, 0) > 0 AND COALESCE(b.quantity, 0) <= p.minimum_stock");
    if (options.stock === "available") conditions.push("COALESCE(b.quantity, 0) > 0");
    if (options.stock === "normal") conditions.push("COALESCE(b.quantity, 0) > p.minimum_stock");
    const where = conditions.join(" AND ");
    const order = { name: "p.name", sku: "p.sku", createdAt: "p.created_at", stock: "quantity" }[options.sort];
    const [countRows] = await this.database().execute<RowDataPacket[]>(`SELECT COUNT(*) total FROM erp_products p LEFT JOIN erp_stock_balances b ON b.client_id=p.client_id AND b.product_id=p.id WHERE ${where}`, values);
    const [rows] = await this.database().execute<ProductRow[]>(`SELECT p.*, COALESCE(b.quantity, '0.000') quantity FROM erp_products p LEFT JOIN erp_stock_balances b ON b.client_id=p.client_id AND b.product_id=p.id WHERE ${where} ORDER BY ${order} ${options.direction === "desc" ? "DESC" : "ASC"} LIMIT ${limit} OFFSET ${offset}`, values);
    return { items: rows, total: Number(countRows[0]?.total ?? 0) };
  }

  async findProduct(clientId: string, publicId: string, connection: Pool | PoolConnection = this.database(), lock = false): Promise<ProductRow | null> {
    const [rows] = await connection.execute<ProductRow[]>(`SELECT p.*, COALESCE(b.quantity, '0.000') quantity FROM erp_products p LEFT JOIN erp_stock_balances b ON b.client_id=p.client_id AND b.product_id=p.id WHERE p.client_id=? AND p.public_id=? LIMIT 1${lock ? " FOR UPDATE" : ""}`, [clientId, publicId]);
    return rows[0] ?? null;
  }

  async createProduct(clientId: string, userId: string, publicId: string, input: { name: string; sku: string; barcode: string | null; description: string | null; category: string | null; unit: string; costPriceCents: number; salePriceCents: number; minimumStock: string }) {
    const connection = await this.database().getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>("INSERT INTO erp_products (public_id,client_id,name,sku,barcode,description,category,unit,cost_price_cents,sale_price_cents,minimum_stock,active,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)", [publicId, clientId, input.name, input.sku, input.barcode, input.description, input.category, input.unit, input.costPriceCents, input.salePriceCents, input.minimumStock, userId]);
      await connection.execute("INSERT INTO erp_stock_balances (client_id,product_id,quantity,version) VALUES (?,?,0,0)", [clientId, result.insertId]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return this.findProduct(clientId, publicId);
  }

  async updateProduct(clientId: string, publicId: string, userId: string, input: { name: string; sku: string; barcode: string | null; description: string | null; category: string | null; unit: string; costPriceCents: number; salePriceCents: number; minimumStock: string }) {
    const [result] = await this.database().execute<ResultSetHeader>("UPDATE erp_products SET name=?,sku=?,barcode=?,description=?,category=?,unit=?,cost_price_cents=?,sale_price_cents=?,minimum_stock=?,updated_by=? WHERE client_id=? AND public_id=?", [input.name, input.sku, input.barcode, input.description, input.category, input.unit, input.costPriceCents, input.salePriceCents, input.minimumStock, userId, clientId, publicId]);
    return result.affectedRows > 0 ? this.findProduct(clientId, publicId) : null;
  }

  async setProductActive(clientId: string, publicId: string, userId: string, active: boolean) {
    const [result] = await this.database().execute<ResultSetHeader>("UPDATE erp_products SET active=?,updated_by=? WHERE client_id=? AND public_id=?", [active ? 1 : 0, userId, clientId, publicId]);
    return result.affectedRows > 0;
  }

  async listMovements(clientId: string, filters: { productPublicId?: string; type?: string; search: string; from?: string; to?: string; page: number; pageSize: number }) {
    const limit = Math.max(1, Math.min(100, Math.trunc(filters.pageSize)));
    const offset = Math.max(0, (Math.max(1, Math.trunc(filters.page)) - 1) * limit);
    const conditions = ["m.client_id=?"]; const values: Array<string | number> = [clientId];
    if (filters.productPublicId) { conditions.push("p.public_id=?"); values.push(filters.productPublicId); }
    if (filters.search) { conditions.push("(p.name LIKE ? OR p.sku LIKE ?)"); const value = `%${filters.search}%`; values.push(value, value); }
    if (filters.type) { conditions.push("m.type=?"); values.push(filters.type); }
    if (filters.from) { conditions.push("m.created_at>=?"); values.push(filters.from); }
    if (filters.to) { conditions.push("m.created_at<=?"); values.push(filters.to); }
    const where = conditions.join(" AND ");
    const [countRows] = await this.database().execute<RowDataPacket[]>(`SELECT COUNT(*) total FROM erp_stock_movements m INNER JOIN erp_products p ON p.id=m.product_id AND p.client_id=m.client_id WHERE ${where}`, values);
    const [rows] = await this.database().execute<MovementRow[]>(`SELECT m.*,p.public_id product_public_id,p.name product_name,p.sku,EXISTS(SELECT 1 FROM erp_stock_movements reversal WHERE reversal.client_id=m.client_id AND reversal.reversal_of=m.id) reversed,(SELECT reversal.public_id FROM erp_stock_movements reversal WHERE reversal.client_id=m.client_id AND reversal.reversal_of=m.id LIMIT 1) reversal_public_id FROM erp_stock_movements m INNER JOIN erp_products p ON p.id=m.product_id AND p.client_id=m.client_id WHERE ${where} ORDER BY m.created_at DESC,m.id DESC LIMIT ${limit} OFFSET ${offset}`, values);
    return { items: rows, total: Number(countRows[0]?.total ?? 0) };
  }

  async summary(clientId: string) {
    const [metrics] = await this.database().execute<RowDataPacket[]>("SELECT SUM(p.active=1) activeProducts,SUM(p.active=0) inactiveProducts,SUM(COALESCE(b.quantity,0)=0) emptyProducts,SUM(COALESCE(b.quantity,0)>0 AND COALESCE(b.quantity,0)<=p.minimum_stock) lowProducts,COALESCE(SUM(COALESCE(b.quantity,0)),0) totalQuantity,COALESCE(SUM(ROUND(COALESCE(b.quantity,0)*p.cost_price_cents)),0) costValueCents,COALESCE(SUM(ROUND(COALESCE(b.quantity,0)*p.sale_price_cents)),0) saleValueCents FROM erp_products p LEFT JOIN erp_stock_balances b ON b.client_id=p.client_id AND b.product_id=p.id WHERE p.client_id=?", [clientId]);
    const critical = await this.listProducts(clientId, { search: "", active: true, stock: "low", sort: "stock", direction: "asc", page: 1, pageSize: 5 });
    const recent = await this.listMovements(clientId, { search: "", page: 1, pageSize: 5 });
    return { metrics: metrics[0], critical: critical.items, recent: recent.items };
  }

  getPool(): Pool { return this.database(); }
}
