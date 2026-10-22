import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "../../../db";
import type {
  ServiceInput,
  ServiceItem,
  ServiceListInput,
  ServiceListResult,
  ServiceUpdateInput,
} from "./contracts";

type ServiceRow = RowDataPacket & {
  id: number;
  client_id: string;
  name: string;
  code: string | null;
  category: string | null;
  price: string | number;
  estimated_cost: string | number;
  estimated_minutes: number | null;
  description: string | null;
  is_active: number | boolean;
  created_at: string | Date;
  updated_at: string | Date;
};

function mapRow(row: ServiceRow): ServiceItem {
  return {
    id: Number(row.id),
    clientId: row.client_id,
    name: row.name,
    code: row.code ?? null,
    category: row.category ?? null,
    price: Number(row.price).toFixed(2),
    estimatedCost: Number(row.estimated_cost ?? 0).toFixed(2),
    estimatedMinutes: row.estimated_minutes !== null ? Number(row.estimated_minutes) : null,
    description: row.description ?? null,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export class ServiceRepository {
  constructor(private pool?: Pool) {}

  private database(): Pool {
    return (this.pool ??= getPool());
  }

  async list(clientId: string, options: ServiceListInput): Promise<ServiceListResult> {
    const limit = Math.max(1, Math.min(100, Math.trunc(options.pageSize)));
    const offset = Math.max(0, (Math.max(1, Math.trunc(options.page)) - 1) * limit);
    const conditions = ["client_id = ?"];
    const parameters: Array<string | number> = [clientId];

    if (options.query) {
      conditions.push("(name LIKE ? OR code LIKE ? OR description LIKE ?)");
      const term = `%${options.query}%`;
      parameters.push(term, term, term);
    }

    if (options.category) {
      conditions.push("category = ?");
      parameters.push(options.category);
    }

    if (options.activeOnly) {
      conditions.push("is_active = 1");
    }

    const where = conditions.join(" AND ");

    const [countRows] = await this.database().execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM megadesk_erp_services WHERE ${where}`,
      parameters
    );
    const total = Number(countRows[0]?.total ?? 0);

    const [rows] = await this.database().execute<ServiceRow[]>(
      `SELECT id, client_id, name, code, category, price, estimated_cost, estimated_minutes, description, is_active, created_at, updated_at
       FROM megadesk_erp_services
       WHERE ${where}
       ORDER BY name ASC
       LIMIT ${limit} OFFSET ${offset}`,
      parameters
    );

    const items = rows.map(mapRow);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      items,
      total,
      page: options.page,
      pageSize: limit,
      totalPages,
    };
  }

  async getById(clientId: string, id: number): Promise<ServiceItem | null> {
    const [rows] = await this.database().execute<ServiceRow[]>(
      `SELECT id, client_id, name, code, category, price, estimated_cost, estimated_minutes, description, is_active, created_at, updated_at
       FROM megadesk_erp_services
       WHERE client_id = ? AND id = ?
       LIMIT 1`,
      [clientId, id]
    );

    if (!rows.length) return null;
    return mapRow(rows[0]);
  }

  async create(clientId: string, input: ServiceInput): Promise<ServiceItem> {
    const [result] = await this.database().execute<ResultSetHeader>(
      `INSERT INTO megadesk_erp_services (
         client_id, name, code, category, price, estimated_cost, estimated_minutes, description, is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clientId,
        input.name,
        input.code ?? null,
        input.category ?? null,
        input.price,
        input.estimatedCost ?? "0.00",
        input.estimatedMinutes ?? null,
        input.description ?? null,
        input.isActive ? 1 : 0,
      ]
    );

    const insertedId = result.insertId;
    const created = await this.getById(clientId, insertedId);
    if (!created) {
      throw new Error("Falha ao recuperar o serviço recém-criado.");
    }
    return created;
  }

  async update(
    clientId: string,
    id: number,
    input: Omit<ServiceUpdateInput, "id">
  ): Promise<ServiceItem | null> {
    const fields: string[] = [];
    const values: Array<string | number | null> = [];

    if (input.name !== undefined) {
      fields.push("name = ?");
      values.push(input.name);
    }
    if (input.code !== undefined) {
      fields.push("code = ?");
      values.push(input.code ?? null);
    }
    if (input.category !== undefined) {
      fields.push("category = ?");
      values.push(input.category ?? null);
    }
    if (input.price !== undefined) {
      fields.push("price = ?");
      values.push(input.price);
    }
    if (input.estimatedCost !== undefined) {
      fields.push("estimated_cost = ?");
      values.push(input.estimatedCost);
    }
    if (input.estimatedMinutes !== undefined) {
      fields.push("estimated_minutes = ?");
      values.push(input.estimatedMinutes ?? null);
    }
    if (input.description !== undefined) {
      fields.push("description = ?");
      values.push(input.description ?? null);
    }
    if (input.isActive !== undefined) {
      fields.push("is_active = ?");
      values.push(input.isActive ? 1 : 0);
    }

    if (fields.length === 0) {
      return this.getById(clientId, id);
    }

    values.push(clientId, id);

    const [result] = await this.database().execute<ResultSetHeader>(
      `UPDATE megadesk_erp_services
       SET ${fields.join(", ")}
       WHERE client_id = ? AND id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return null;
    }

    return this.getById(clientId, id);
  }

  async toggleActive(clientId: string, id: number): Promise<ServiceItem | null> {
    const [result] = await this.database().execute<ResultSetHeader>(
      `UPDATE megadesk_erp_services
       SET is_active = NOT is_active
       WHERE client_id = ? AND id = ?`,
      [clientId, id]
    );

    if (result.affectedRows === 0) {
      return null;
    }

    return this.getById(clientId, id);
  }

  async delete(clientId: string, id: number): Promise<boolean> {
    const [result] = await this.database().execute<ResultSetHeader>(
      `DELETE FROM megadesk_erp_services
       WHERE client_id = ? AND id = ?`,
      [clientId, id]
    );

    return result.affectedRows > 0;
  }

  async listCategories(clientId: string): Promise<string[]> {
    const [rows] = await this.database().execute<RowDataPacket[]>(
      `SELECT DISTINCT category
       FROM megadesk_erp_services
       WHERE client_id = ? AND category IS NOT NULL AND TRIM(category) != ''
       ORDER BY category ASC`,
      [clientId]
    );

    return rows.map(r => String(r.category));
  }
}
