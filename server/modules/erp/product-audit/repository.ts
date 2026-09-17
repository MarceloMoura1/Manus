import { randomUUID } from "node:crypto";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { getPool } from "../../../db";
import type {
  AuditEntityType,
  ProductAuditListInput,
} from "./contracts";

export type ProductAuditRow = RowDataPacket & {
  id: number;
  public_id: string;
  client_id: string;
  product_id: number;
  product_public_id?: string;
  entity_type: AuditEntityType;
  entity_public_id: string;
  action: string;
  actor_user_id: string;
  actor_name_snapshot: string;
  actor_role: string;
  summary: string;
  changes_json: unknown;
  metadata_json: unknown;
  created_at: string;
};

export type NewProductAuditRecord = {
  publicId?: string;
  clientId: string;
  productId: number;
  entityType: AuditEntityType;
  entityPublicId: string;
  action: string;
  actorUserId: string;
  actorNameSnapshot: string;
  actorRole: string;
  summary: string;
  changesJson?: unknown;
  metadataJson?: unknown;
};

export class ProductAuditRepository {
  constructor(private pool?: Pool) {}

  private database(): Pool | null {
    if (this.pool) return this.pool;
    try {
      this.pool = getPool();
      return this.pool;
    } catch {
      return null;
    }
  }

  getPool(): Pool {
    const pool = this.database();
    if (!pool) return getPool();
    return pool;
  }

  /**
   * Records an audit log entry in the database.
   * MUST participate in the active transaction connection.
   */
  async record(
    entry: NewProductAuditRecord,
    connection?: Pool | PoolConnection | null
  ): Promise<ProductAuditRow> {
    const executor = connection ?? this.database();
    if (!executor) {
      return {
        id: 1,
        public_id: entry.publicId ?? randomUUID(),
        client_id: entry.clientId,
        product_id: entry.productId,
        product_public_id: undefined,
        entity_type: entry.entityType,
        entity_public_id: entry.entityPublicId,
        action: entry.action,
        actor_user_id: entry.actorUserId,
        actor_name_snapshot: entry.actorNameSnapshot,
        actor_role: entry.actorRole ?? null,
        summary: entry.summary,
        changes_json: entry.changesJson ?? null,
        metadata_json: entry.metadataJson ?? null,
        created_at: new Date().toISOString(),
      } as unknown as ProductAuditRow;
    }
    const publicId = entry.publicId ?? randomUUID();
    const truncatedSummary = entry.summary.slice(0, 255);

    const changesJsonStr =
      entry.changesJson !== undefined && entry.changesJson !== null
        ? JSON.stringify(entry.changesJson)
        : null;

    const metadataJsonStr =
      entry.metadataJson !== undefined && entry.metadataJson !== null
        ? JSON.stringify(entry.metadataJson)
        : null;

    await executor.execute<ResultSetHeader>(
      `INSERT INTO erp_product_audit_logs
        (public_id, client_id, product_id, entity_type, entity_public_id, action,
         actor_user_id, actor_name_snapshot, actor_role, summary, changes_json, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicId,
        entry.clientId,
        entry.productId,
        entry.entityType,
        entry.entityPublicId,
        entry.action,
        entry.actorUserId,
        entry.actorNameSnapshot,
        entry.actorRole,
        truncatedSummary,
        changesJsonStr,
        metadataJsonStr,
      ]
    );

    const [rows] = await executor.execute<ProductAuditRow[]>(
      `SELECT a.*, p.public_id AS product_public_id
       FROM erp_product_audit_logs a
       INNER JOIN erp_products p ON p.client_id = a.client_id AND p.id = a.product_id
       WHERE a.client_id = ? AND a.public_id = ?
       LIMIT 1`,
      [entry.clientId, publicId]
    );

    if (rows && rows[0]) {
      return rows[0];
    }

    return {
      id: 0,
      public_id: publicId,
      client_id: entry.clientId,
      product_id: entry.productId,
      entity_type: entry.entityType,
      entity_public_id: entry.entityPublicId,
      action: entry.action,
      actor_user_id: entry.actorUserId,
      actor_name_snapshot: entry.actorNameSnapshot,
      actor_role: entry.actorRole,
      summary: truncatedSummary,
      changes_json: entry.changesJson ?? null,
      metadata_json: entry.metadataJson ?? null,
      created_at: new Date().toISOString(),
    } as ProductAuditRow;
  }

  async list(
    clientId: string,
    productId: number,
    options: ProductAuditListInput,
    connection?: Pool | PoolConnection
  ): Promise<{ items: ProductAuditRow[]; total: number }> {
    const executor = connection ?? this.database();
    if (!executor) {
      return { items: [], total: 0 };
    }

    const limit = Math.max(1, Math.min(100, Math.trunc(options.pageSize)));
    const offset = Math.max(
      0,
      (Math.max(1, Math.trunc(options.page)) - 1) * limit
    );

    const conditions = ["a.client_id = ?", "a.product_id = ?"];
    const parameters: Array<string | number> = [clientId, productId];

    if (options.entityType) {
      conditions.push("a.entity_type = ?");
      parameters.push(options.entityType);
    }

    if (options.action) {
      conditions.push("a.action = ?");
      parameters.push(options.action);
    }

    if (options.actor) {
      conditions.push(
        "(a.actor_user_id = ? OR a.actor_name_snapshot LIKE ?)"
      );
      parameters.push(options.actor, `%${options.actor}%`);
    }

    if (options.from) {
      conditions.push("a.created_at >= ?");
      parameters.push(options.from);
    }

    if (options.to) {
      conditions.push("a.created_at <= ?");
      parameters.push(options.to);
    }

    const whereClause = conditions.join(" AND ");

    const [countRows] = await executor.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM erp_product_audit_logs a
       WHERE ${whereClause}`,
      parameters
    );

    const [rows] = await executor.execute<ProductAuditRow[]>(
      `SELECT a.*, p.public_id AS product_public_id
       FROM erp_product_audit_logs a
       INNER JOIN erp_products p ON p.client_id = a.client_id AND p.id = a.product_id
       WHERE ${whereClause}
       ORDER BY a.created_at DESC, a.id DESC
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
    productId: number,
    publicId: string,
    connection?: Pool | PoolConnection
  ): Promise<ProductAuditRow | null> {
    const executor = connection ?? this.database();
    if (!executor) return null;

    const [rows] = await executor.execute<ProductAuditRow[]>(
      `SELECT a.*, p.public_id AS product_public_id
       FROM erp_product_audit_logs a
       INNER JOIN erp_products p ON p.client_id = a.client_id AND p.id = a.product_id
       WHERE a.client_id = ? AND a.product_id = ? AND a.public_id = ?
       LIMIT 1`,
      [clientId, productId, publicId]
    );

    return rows[0] ?? null;
  }
}
