import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "../../../db";
import type { AttributeTypeListInput, AttributeValueListInput } from "./contracts";

export type AttributeTypeRow = RowDataPacket & {
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

export type AttributeValueRow = RowDataPacket & {
  id: number;
  public_id: string;
  client_id: string;
  attribute_type_id: number;
  type_public_id: string;
  type_name: string;
  type_slug: string;
  name: string;
  slug: string;
  active: number;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export class AttributeRepository {
  constructor(private pool?: Pool) {}
  private database(): Pool {
    return (this.pool ??= getPool());
  }
  getPool(): Pool {
    return this.database();
  }

  // --- Attribute Types ---

  async listTypes(clientId: string, options: AttributeTypeListInput) {
    const limit = Math.max(1, Math.min(100, Math.trunc(options.pageSize)));
    const offset = Math.max(0, (Math.max(1, Math.trunc(options.page)) - 1) * limit);
    const conditions = ["t.client_id = ?"];
    const parameters: Array<string | number> = [clientId];

    if (options.search) {
      conditions.push("(t.name LIKE ? OR t.slug LIKE ?)");
      const raw = `%${options.search}%`;
      parameters.push(raw, raw);
    }
    if (options.active !== undefined) {
      conditions.push("t.active = ?");
      parameters.push(options.active ? 1 : 0);
    }

    const where = conditions.join(" AND ");
    const [countRows] = await this.database().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_product_attribute_types t WHERE ${where}`,
      parameters
    );

    const [rows] = await this.database().execute<AttributeTypeRow[]>(
      `SELECT t.* FROM erp_product_attribute_types t
       WHERE ${where}
       ORDER BY t.name ASC
       LIMIT ${limit} OFFSET ${offset}`,
      parameters
    );

    return {
      items: rows,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async findType(
    clientId: string,
    publicId: string,
    connection: Pool | PoolConnection = this.database(),
    lock = false
  ): Promise<AttributeTypeRow | null> {
    const [rows] = await connection.execute<AttributeTypeRow[]>(
      `SELECT * FROM erp_product_attribute_types WHERE client_id = ? AND public_id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, publicId]
    );
    return rows[0] ?? null;
  }

  async findTypeById(
    clientId: string,
    id: number,
    connection: Pool | PoolConnection = this.database(),
    lock = false
  ): Promise<AttributeTypeRow | null> {
    const [rows] = await connection.execute<AttributeTypeRow[]>(
      `SELECT * FROM erp_product_attribute_types WHERE client_id = ? AND id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, id]
    );
    return rows[0] ?? null;
  }

  async findTypeByName(
    clientId: string,
    name: string,
    excludePublicId?: string
  ): Promise<AttributeTypeRow | null> {
    const conditions = ["client_id = ?", "name = ?"];
    const parameters: string[] = [clientId, name];
    if (excludePublicId) {
      conditions.push("public_id <> ?");
      parameters.push(excludePublicId);
    }
    const [rows] = await this.database().execute<AttributeTypeRow[]>(
      `SELECT * FROM erp_product_attribute_types WHERE ${conditions.join(" AND ")} LIMIT 1`,
      parameters
    );
    return rows[0] ?? null;
  }

  async findTypeBySlug(
    clientId: string,
    slug: string,
    excludePublicId?: string
  ): Promise<AttributeTypeRow | null> {
    const conditions = ["client_id = ?", "slug = ?"];
    const parameters: string[] = [clientId, slug];
    if (excludePublicId) {
      conditions.push("public_id <> ?");
      parameters.push(excludePublicId);
    }
    const [rows] = await this.database().execute<AttributeTypeRow[]>(
      `SELECT * FROM erp_product_attribute_types WHERE ${conditions.join(" AND ")} LIMIT 1`,
      parameters
    );
    return rows[0] ?? null;
  }

  async createType(
    clientId: string,
    userId: string,
    publicId: string,
    data: { name: string; slug: string; active?: boolean }
  ): Promise<AttributeTypeRow> {
    await this.database().execute(
      `INSERT INTO erp_product_attribute_types
        (public_id, client_id, name, slug, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        publicId,
        clientId,
        data.name,
        data.slug,
        data.active ?? true ? 1 : 0,
        userId,
      ]
    );

    const row = await this.findType(clientId, publicId);
    if (!row) throw new Error("AttributeType insert failed to retrieve row");
    return row;
  }

  async updateType(
    clientId: string,
    publicId: string,
    userId: string,
    data: { name?: string; slug?: string; active?: boolean }
  ): Promise<AttributeTypeRow | null> {
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
      `UPDATE erp_product_attribute_types SET ${updates.join(", ")} WHERE client_id = ? AND public_id = ?`,
      parameters
    );

    return result.affectedRows > 0 ? this.findType(clientId, publicId) : null;
  }

  async setTypeActive(
    clientId: string,
    publicId: string,
    userId: string,
    active: boolean
  ): Promise<boolean> {
    const [result] = await this.database().execute<ResultSetHeader>(
      `UPDATE erp_product_attribute_types SET active = ?, updated_by = ? WHERE client_id = ? AND public_id = ?`,
      [active ? 1 : 0, userId, clientId, publicId]
    );
    return result.affectedRows > 0;
  }

  async countValuesForType(clientId: string, typeId: number): Promise<number> {
    const [rows] = await this.database().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_product_attribute_values WHERE client_id = ? AND attribute_type_id = ?`,
      [clientId, typeId]
    );
    return Number(rows[0]?.total ?? 0);
  }

  async countTypeUsages(clientId: string, typeId: number): Promise<number> {
    const [rows] = await this.database().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_product_variant_attribute_values WHERE client_id = ? AND attribute_type_id = ?`,
      [clientId, typeId]
    );
    return Number(rows[0]?.total ?? 0);
  }

  async deleteType(clientId: string, publicId: string): Promise<boolean> {
    const [result] = await this.database().execute<ResultSetHeader>(
      `DELETE FROM erp_product_attribute_types WHERE client_id = ? AND public_id = ?`,
      [clientId, publicId]
    );
    return result.affectedRows > 0;
  }

  // --- Attribute Values ---

  async listValues(clientId: string, options: AttributeValueListInput) {
    const limit = Math.max(1, Math.min(100, Math.trunc(options.pageSize)));
    const offset = Math.max(0, (Math.max(1, Math.trunc(options.page)) - 1) * limit);
    const conditions = ["v.client_id = ?"];
    const parameters: Array<string | number> = [clientId];

    if (options.typePublicId) {
      conditions.push("t.public_id = ?");
      parameters.push(options.typePublicId);
    }
    if (options.search) {
      conditions.push("(v.name LIKE ? OR v.slug LIKE ?)");
      const raw = `%${options.search}%`;
      parameters.push(raw, raw);
    }
    if (options.active !== undefined) {
      conditions.push("v.active = ?");
      parameters.push(options.active ? 1 : 0);
    }

    const where = conditions.join(" AND ");
    const [countRows] = await this.database().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_product_attribute_values v
       INNER JOIN erp_product_attribute_types t ON t.client_id = v.client_id AND t.id = v.attribute_type_id
       WHERE ${where}`,
      parameters
    );

    const [rows] = await this.database().execute<AttributeValueRow[]>(
      `SELECT v.*,
              t.public_id AS type_public_id,
              t.name AS type_name,
              t.slug AS type_slug
       FROM erp_product_attribute_values v
       INNER JOIN erp_product_attribute_types t ON t.client_id = v.client_id AND t.id = v.attribute_type_id
       WHERE ${where}
       ORDER BY v.name ASC
       LIMIT ${limit} OFFSET ${offset}`,
      parameters
    );

    return {
      items: rows,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async findValue(
    clientId: string,
    publicId: string,
    connection: Pool | PoolConnection = this.database(),
    lock = false
  ): Promise<AttributeValueRow | null> {
    const [rows] = await connection.execute<AttributeValueRow[]>(
      `SELECT v.*,
              t.public_id AS type_public_id,
              t.name AS type_name,
              t.slug AS type_slug
       FROM erp_product_attribute_values v
       INNER JOIN erp_product_attribute_types t ON t.client_id = v.client_id AND t.id = v.attribute_type_id
       WHERE v.client_id = ? AND v.public_id = ?
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, publicId]
    );
    return rows[0] ?? null;
  }

  async findValueById(
    clientId: string,
    id: number,
    connection: Pool | PoolConnection = this.database(),
    lock = false
  ): Promise<AttributeValueRow | null> {
    const [rows] = await connection.execute<AttributeValueRow[]>(
      `SELECT v.*,
              t.public_id AS type_public_id,
              t.name AS type_name,
              t.slug AS type_slug
       FROM erp_product_attribute_values v
       INNER JOIN erp_product_attribute_types t ON t.client_id = v.client_id AND t.id = v.attribute_type_id
       WHERE v.client_id = ? AND v.id = ?
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, id]
    );
    return rows[0] ?? null;
  }

  async findValuesByPublicIds(
    clientId: string,
    publicIds: string[]
  ): Promise<AttributeValueRow[]> {
    if (publicIds.length === 0) return [];
    const placeholders = publicIds.map(() => "?").join(", ");
    const [rows] = await this.database().execute<AttributeValueRow[]>(
      `SELECT v.*,
              t.public_id AS type_public_id,
              t.name AS type_name,
              t.slug AS type_slug
       FROM erp_product_attribute_values v
       INNER JOIN erp_product_attribute_types t ON t.client_id = v.client_id AND t.id = v.attribute_type_id
       WHERE v.client_id = ? AND v.public_id IN (${placeholders})`,
      [clientId, ...publicIds]
    );
    return rows;
  }

  async findValueByName(
    clientId: string,
    typeId: number,
    name: string,
    excludePublicId?: string
  ): Promise<AttributeValueRow | null> {
    const conditions = ["v.client_id = ?", "v.attribute_type_id = ?", "v.name = ?"];
    const parameters: Array<string | number> = [clientId, typeId, name];
    if (excludePublicId) {
      conditions.push("v.public_id <> ?");
      parameters.push(excludePublicId);
    }
    const [rows] = await this.database().execute<AttributeValueRow[]>(
      `SELECT v.*,
              t.public_id AS type_public_id,
              t.name AS type_name,
              t.slug AS type_slug
       FROM erp_product_attribute_values v
       INNER JOIN erp_product_attribute_types t ON t.client_id = v.client_id AND t.id = v.attribute_type_id
       WHERE ${conditions.join(" AND ")}
       LIMIT 1`,
      parameters
    );
    return rows[0] ?? null;
  }

  async findValueBySlug(
    clientId: string,
    typeId: number,
    slug: string,
    excludePublicId?: string
  ): Promise<AttributeValueRow | null> {
    const conditions = ["v.client_id = ?", "v.attribute_type_id = ?", "v.slug = ?"];
    const parameters: Array<string | number> = [clientId, typeId, slug];
    if (excludePublicId) {
      conditions.push("v.public_id <> ?");
      parameters.push(excludePublicId);
    }
    const [rows] = await this.database().execute<AttributeValueRow[]>(
      `SELECT v.*,
              t.public_id AS type_public_id,
              t.name AS type_name,
              t.slug AS type_slug
       FROM erp_product_attribute_values v
       INNER JOIN erp_product_attribute_types t ON t.client_id = v.client_id AND t.id = v.attribute_type_id
       WHERE ${conditions.join(" AND ")}
       LIMIT 1`,
      parameters
    );
    return rows[0] ?? null;
  }

  async createValue(
    clientId: string,
    userId: string,
    publicId: string,
    typeId: number,
    data: { name: string; slug: string; active?: boolean }
  ): Promise<AttributeValueRow> {
    await this.database().execute(
      `INSERT INTO erp_product_attribute_values
        (public_id, client_id, attribute_type_id, name, slug, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        publicId,
        clientId,
        typeId,
        data.name,
        data.slug,
        data.active ?? true ? 1 : 0,
        userId,
      ]
    );

    const row = await this.findValue(clientId, publicId);
    if (!row) throw new Error("AttributeValue insert failed to retrieve row");
    return row;
  }

  async updateValue(
    clientId: string,
    publicId: string,
    userId: string,
    data: { name?: string; slug?: string; active?: boolean }
  ): Promise<AttributeValueRow | null> {
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
      `UPDATE erp_product_attribute_values SET ${updates.join(", ")} WHERE client_id = ? AND public_id = ?`,
      parameters
    );

    return result.affectedRows > 0 ? this.findValue(clientId, publicId) : null;
  }

  async setValueActive(
    clientId: string,
    publicId: string,
    userId: string,
    active: boolean
  ): Promise<boolean> {
    const [result] = await this.database().execute<ResultSetHeader>(
      `UPDATE erp_product_attribute_values SET active = ?, updated_by = ? WHERE client_id = ? AND public_id = ?`,
      [active ? 1 : 0, userId, clientId, publicId]
    );
    return result.affectedRows > 0;
  }

  async countValueUsages(clientId: string, valueId: number): Promise<number> {
    const [rows] = await this.database().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_product_variant_attribute_values WHERE client_id = ? AND attribute_value_id = ?`,
      [clientId, valueId]
    );
    return Number(rows[0]?.total ?? 0);
  }

  async deleteValue(clientId: string, publicId: string): Promise<boolean> {
    const [result] = await this.database().execute<ResultSetHeader>(
      `DELETE FROM erp_product_attribute_values WHERE client_id = ? AND public_id = ?`,
      [clientId, publicId]
    );
    return result.affectedRows > 0;
  }
}
