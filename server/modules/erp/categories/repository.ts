import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "../../../db";
import type { CategoryListInput } from "./contracts";

export type CategoryRow = RowDataPacket & {
  id: number;
  public_id: string;
  client_id: string;
  parent_id: number | null;
  parent_public_id: string | null;
  parent_name: string | null;
  depth: number;
  name: string;
  slug: string;
  active: number;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export class CategoryRepository {
  constructor(private pool?: Pool) {}
  private database(): Pool {
    return (this.pool ??= getPool());
  }
  getPool(): Pool {
    return this.database();
  }

  async list(clientId: string, options: CategoryListInput) {
    const limit = Math.max(1, Math.min(100, Math.trunc(options.pageSize)));
    const offset = Math.max(0, (Math.max(1, Math.trunc(options.page)) - 1) * limit);
    const conditions = ["c.client_id = ?"];
    const parameters: Array<string | number> = [clientId];

    if (options.search) {
      conditions.push("(c.name LIKE ? OR c.slug LIKE ?)");
      const raw = `%${options.search}%`;
      parameters.push(raw, raw);
    }
    if (options.active !== undefined) {
      conditions.push("c.active = ?");
      parameters.push(options.active ? 1 : 0);
    }
    if (options.parentPublicId !== undefined) {
      if (options.parentPublicId === null) {
        conditions.push("c.parent_id IS NULL");
      } else {
        conditions.push("p.public_id = ?");
        parameters.push(options.parentPublicId);
      }
    }

    const where = conditions.join(" AND ");
    const [countRows] = await this.database().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_product_categories c
       LEFT JOIN erp_product_categories p ON p.client_id = c.client_id AND p.id = c.parent_id
       WHERE ${where}`,
      parameters
    );

    const [rows] = await this.database().execute<CategoryRow[]>(
      `SELECT c.*, p.public_id AS parent_public_id, p.name AS parent_name
       FROM erp_product_categories c
       LEFT JOIN erp_product_categories p ON p.client_id = c.client_id AND p.id = c.parent_id
       WHERE ${where}
       ORDER BY c.depth ASC, c.name ASC
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
  ): Promise<CategoryRow | null> {
    const [rows] = await connection.execute<CategoryRow[]>(
      `SELECT c.*, p.public_id AS parent_public_id, p.name AS parent_name
       FROM erp_product_categories c
       LEFT JOIN erp_product_categories p ON p.client_id = c.client_id AND p.id = c.parent_id
       WHERE c.client_id = ? AND c.public_id = ?
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, publicId]
    );
    return rows[0] ?? null;
  }

  async findById(
    clientId: string,
    id: number,
    connection: Pool | PoolConnection = this.database(),
    lock = false
  ): Promise<CategoryRow | null> {
    const [rows] = await connection.execute<CategoryRow[]>(
      `SELECT c.*, p.public_id AS parent_public_id, p.name AS parent_name
       FROM erp_product_categories c
       LEFT JOIN erp_product_categories p ON p.client_id = c.client_id AND p.id = c.parent_id
       WHERE c.client_id = ? AND c.id = ?
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, id]
    );
    return rows[0] ?? null;
  }

  async findRootByName(
    clientId: string,
    name: string,
    excludePublicId?: string,
    connection: Pool | PoolConnection = this.database()
  ): Promise<CategoryRow | null> {
    const conditions = ["client_id = ?", "parent_id IS NULL", "LOWER(name) = LOWER(?)"];
    const parameters: Array<string | number> = [clientId, name.trim()];
    if (excludePublicId) {
      conditions.push("public_id <> ?");
      parameters.push(excludePublicId);
    }
    const [rows] = await connection.execute<CategoryRow[]>(
      `SELECT * FROM erp_product_categories WHERE ${conditions.join(" AND ")} LIMIT 1`,
      parameters
    );
    return rows[0] ?? null;
  }

  async findSiblingByName(
    clientId: string,
    parentId: number,
    name: string,
    excludePublicId?: string,
    connection: Pool | PoolConnection = this.database()
  ): Promise<CategoryRow | null> {
    const conditions = ["client_id = ?", "parent_id = ?", "LOWER(name) = LOWER(?)"];
    const parameters: Array<string | number> = [clientId, parentId, name.trim()];
    if (excludePublicId) {
      conditions.push("public_id <> ?");
      parameters.push(excludePublicId);
    }
    const [rows] = await connection.execute<CategoryRow[]>(
      `SELECT * FROM erp_product_categories WHERE ${conditions.join(" AND ")} LIMIT 1`,
      parameters
    );
    return rows[0] ?? null;
  }

  async findBySlug(
    clientId: string,
    slug: string,
    excludePublicId?: string,
    connection: Pool | PoolConnection = this.database()
  ): Promise<CategoryRow | null> {
    const conditions = ["client_id = ?", "slug = ?"];
    const parameters: Array<string | number> = [clientId, slug];
    if (excludePublicId) {
      conditions.push("public_id <> ?");
      parameters.push(excludePublicId);
    }
    const [rows] = await connection.execute<CategoryRow[]>(
      `SELECT * FROM erp_product_categories WHERE ${conditions.join(" AND ")} LIMIT 1`,
      parameters
    );
    return rows[0] ?? null;
  }

  async create(
    clientId: string,
    userId: string,
    publicId: string,
    data: { name: string; slug: string; parentId: number | null; depth: number; active: boolean }
  ): Promise<CategoryRow> {
    const [result] = await this.database().execute<ResultSetHeader>(
      `INSERT INTO erp_product_categories
       (public_id, client_id, parent_id, depth, name, slug, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicId,
        clientId,
        data.parentId,
        data.depth,
        data.name,
        data.slug,
        data.active ? 1 : 0,
        userId,
      ]
    );
    const row = await this.findById(clientId, result.insertId);
    if (!row) throw new Error("Category insert failed to retrieve row");
    return row;
  }

  async update(
    clientId: string,
    publicId: string,
    userId: string,
    data: { name?: string; slug?: string; active?: boolean }
  ): Promise<CategoryRow | null> {
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
      `UPDATE erp_product_categories SET ${updates.join(", ")} WHERE client_id = ? AND public_id = ?`,
      parameters
    );

    return result.affectedRows > 0 ? this.find(clientId, publicId) : null;
  }

  async getChildren(
    clientId: string,
    parentId: number,
    connection: Pool | PoolConnection = this.database()
  ): Promise<CategoryRow[]> {
    const [rows] = await connection.execute<CategoryRow[]>(
      `SELECT * FROM erp_product_categories WHERE client_id = ? AND parent_id = ? ORDER BY depth ASC, name ASC`,
      [clientId, parentId]
    );
    return rows;
  }

  async getDescendants(
    clientId: string,
    categoryId: number,
    connection: Pool | PoolConnection = this.database()
  ): Promise<CategoryRow[]> {
    // Busca até 2 níveis de descendência (já que a profundidade máxima do sistema é 2)
    const directChildren = await this.getChildren(clientId, categoryId, connection);
    if (directChildren.length === 0) {
      return [];
    }
    const childIds = directChildren.map(c => c.id);
    const placeholders = childIds.map(() => "?").join(",");
    const [grandchildren] = await connection.execute<CategoryRow[]>(
      `SELECT * FROM erp_product_categories WHERE client_id = ? AND parent_id IN (${placeholders}) ORDER BY depth ASC, name ASC`,
      [clientId, ...childIds]
    );

    return [...directChildren, ...grandchildren];
  }

  async moveSubtree(
    clientId: string,
    userId: string,
    categoryId: number,
    newParentId: number | null,
    newDepth: number,
    deltaDepth: number,
    descendantIds: number[]
  ): Promise<void> {
    const connection = await this.database().getConnection();
    try {
      await connection.beginTransaction();

      // Atualiza a categoria alvo
      await connection.execute(
        `UPDATE erp_product_categories
         SET parent_id = ?, depth = ?, updated_by = ?
         WHERE client_id = ? AND id = ?`,
        [newParentId, newDepth, userId, clientId, categoryId]
      );

      // Atualiza descendentes se existirem
      if (descendantIds.length > 0) {
        const placeholders = descendantIds.map(() => "?").join(",");
        await connection.execute(
          `UPDATE erp_product_categories
           SET depth = depth + ?, updated_by = ?
           WHERE client_id = ? AND id IN (${placeholders})`,
          [deltaDepth, userId, clientId, ...descendantIds]
        );
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async countChildren(clientId: string, id: number): Promise<number> {
    const [rows] = await this.database().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_product_categories WHERE client_id = ? AND parent_id = ?`,
      [clientId, id]
    );
    return Number(rows[0]?.total ?? 0);
  }

  async countProducts(clientId: string, id: number): Promise<number> {
    const [rows] = await this.database().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_products WHERE client_id = ? AND category_id = ?`,
      [clientId, id]
    );
    return Number(rows[0]?.total ?? 0);
  }

  async delete(clientId: string, publicId: string): Promise<boolean> {
    const [result] = await this.database().execute<ResultSetHeader>(
      `DELETE FROM erp_product_categories WHERE client_id = ? AND public_id = ?`,
      [clientId, publicId]
    );
    return result.affectedRows > 0;
  }
}
