import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "../../../db";
import type { BrandListInput } from "./contracts";

export type BrandRow = RowDataPacket & {
  id: number;
  public_id: string;
  client_id: string;
  name: string;
  slug: string;
  active: number;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export class BrandRepository {
  constructor(private pool?: Pool) {}
  private database(): Pool {
    return (this.pool ??= getPool());
  }
  getPool(): Pool {
    return this.database();
  }

  async list(clientId: string, options: BrandListInput) {
    const limit = Math.max(1, Math.min(100, Math.trunc(options.pageSize)));
    const offset = Math.max(0, (Math.max(1, Math.trunc(options.page)) - 1) * limit);
    const conditions = ["b.client_id = ?"];
    const parameters: Array<string | number> = [clientId];

    if (options.search) {
      conditions.push("(b.name LIKE ? OR b.slug LIKE ?)");
      const raw = `%${options.search}%`;
      parameters.push(raw, raw);
    }
    if (options.active !== undefined) {
      conditions.push("b.active = ?");
      parameters.push(options.active ? 1 : 0);
    }

    const where = conditions.join(" AND ");
    const [countRows] = await this.database().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_product_brands b WHERE ${where}`,
      parameters
    );

    const [rows] = await this.database().execute<BrandRow[]>(
      `SELECT b.* FROM erp_product_brands b
       WHERE ${where}
       ORDER BY b.name ASC
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
  ): Promise<BrandRow | null> {
    const [rows] = await connection.execute<BrandRow[]>(
      `SELECT * FROM erp_product_brands WHERE client_id = ? AND public_id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, publicId]
    );
    return rows[0] ?? null;
  }

  async findById(
    clientId: string,
    id: number,
    connection: Pool | PoolConnection = this.database(),
    lock = false
  ): Promise<BrandRow | null> {
    const [rows] = await connection.execute<BrandRow[]>(
      `SELECT * FROM erp_product_brands WHERE client_id = ? AND id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, id]
    );
    return rows[0] ?? null;
  }

  async findByName(
    clientId: string,
    name: string,
    excludePublicId?: string,
    connection: Pool | PoolConnection = this.database()
  ): Promise<BrandRow | null> {
    const conditions = ["client_id = ?", "LOWER(name) = LOWER(?)"];
    const parameters: Array<string | number> = [clientId, name.trim()];
    if (excludePublicId) {
      conditions.push("public_id <> ?");
      parameters.push(excludePublicId);
    }
    const [rows] = await connection.execute<BrandRow[]>(
      `SELECT * FROM erp_product_brands WHERE ${conditions.join(" AND ")} LIMIT 1`,
      parameters
    );
    return rows[0] ?? null;
  }

  async findBySlug(
    clientId: string,
    slug: string,
    excludePublicId?: string,
    connection: Pool | PoolConnection = this.database()
  ): Promise<BrandRow | null> {
    const conditions = ["client_id = ?", "slug = ?"];
    const parameters: Array<string | number> = [clientId, slug];
    if (excludePublicId) {
      conditions.push("public_id <> ?");
      parameters.push(excludePublicId);
    }
    const [rows] = await connection.execute<BrandRow[]>(
      `SELECT * FROM erp_product_brands WHERE ${conditions.join(" AND ")} LIMIT 1`,
      parameters
    );
    return rows[0] ?? null;
  }

  async create(
    clientId: string,
    userId: string,
    publicId: string,
    data: { name: string; slug: string; active: boolean }
  ): Promise<BrandRow> {
    const [result] = await this.database().execute<ResultSetHeader>(
      `INSERT INTO erp_product_brands
       (public_id, client_id, name, slug, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [publicId, clientId, data.name, data.slug, data.active ? 1 : 0, userId]
    );
    const row = await this.findById(clientId, result.insertId);
    if (!row) throw new Error("Brand insert failed to retrieve row");
    return row;
  }

  async update(
    clientId: string,
    publicId: string,
    userId: string,
    data: { name?: string; slug?: string; active?: boolean }
  ): Promise<BrandRow | null> {
    const updates: string[] = ["updated_by = ?"];
    const parameters: Array<string | number> = [userId];

    if (data.name !== undefined) {
      updates.push("name = ?");
      parameters.push(data.name);
    }
    if (data.slug !== undefined) {
      updates.push("slug = ?");
      parameters.push(data.slug);
    }
    if (data.active !== undefined) {
      updates.push("active = ?");
      parameters.push(data.active ? 1 : 0);
    }

    parameters.push(clientId, publicId);

    const [result] = await this.database().execute<ResultSetHeader>(
      `UPDATE erp_product_brands SET ${updates.join(", ")} WHERE client_id = ? AND public_id = ?`,
      parameters
    );

    return result.affectedRows > 0 ? this.find(clientId, publicId) : null;
  }

  async countProducts(clientId: string, id: number): Promise<number> {
    const [rows] = await this.database().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_products WHERE client_id = ? AND brand_id = ?`,
      [clientId, id]
    );
    return Number(rows[0]?.total ?? 0);
  }

  async delete(clientId: string, publicId: string): Promise<boolean> {
    const [result] = await this.database().execute<ResultSetHeader>(
      `DELETE FROM erp_product_brands WHERE client_id = ? AND public_id = ?`,
      [clientId, publicId]
    );
    return result.affectedRows > 0;
  }
}
