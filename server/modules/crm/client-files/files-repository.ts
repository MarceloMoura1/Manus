import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "../../../db";
import type { ClientFileCategory } from "./files-contracts";

export type ClientFileRow = RowDataPacket & {
  id: number;
  public_id: string;
  client_id: string;
  crm_client_id: string;
  file_name: string;
  category: ClientFileCategory;
  description: string | null;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  storage_key: string;
  state: "active" | "pending_delete" | "deleted";
  created_by: string;
  created_at: string;
  deleted_by: string | null;
  deleted_at: string | null;
  pending_delete_at: string | null;
  created_by_name?: string | null;
  deleted_by_name?: string | null;
};

export type CrmClientFileOwner = {
  crmClientId: string;
  lifecycleState: "active" | "inactive" | "archived";
};

export class ClientFileRepository {
  constructor(private pool?: Pool) {}

  private db(): Pool {
    return (this.pool ??= getPool());
  }

  async findClient(clientId: string, crmClientId: string): Promise<CrmClientFileOwner | null> {
    const [rows] = await this.db().execute<RowDataPacket[]>(
      `SELECT crm_client_id AS crmClientId, lifecycle_state AS lifecycleState
       FROM megadesk_crm_clients
       WHERE client_id = ? AND crm_client_id = ?
       LIMIT 1`,
      [clientId, crmClientId]
    );
    if (!rows[0]) return null;
    return { crmClientId: String(rows[0].crmClientId), lifecycleState: rows[0].lifecycleState as CrmClientFileOwner["lifecycleState"] };
  }

  async insertFile(clientId: string, crmClientId: string, data: {
    publicId: string;
    fileName: string;
    category: ClientFileCategory;
    description: string | null;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    storageKey: string;
    createdBy: string;
  }): Promise<ClientFileRow> {
    await this.db().execute<ResultSetHeader>(
      `INSERT INTO megadesk_crm_client_files
       (public_id, client_id, crm_client_id, file_name, category, description, mime_type, size_bytes, sha256, storage_key, state, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [data.publicId, clientId, crmClientId, data.fileName, data.category, data.description, data.mimeType, data.sizeBytes, data.sha256, data.storageKey, data.createdBy]
    );
    const inserted = await this.findByPublicId(clientId, crmClientId, data.publicId);
    if (!inserted) throw new Error("Falha ao recuperar arquivo recém-inserido.");
    return inserted;
  }

  async findByPublicId(clientId: string, crmClientId: string, filePublicId: string): Promise<ClientFileRow | null> {
    const [rows] = await this.db().execute<ClientFileRow[]>(
      `SELECT f.*,
              COALESCE(u_created.name, u_created.email, 'Usuário indisponível') AS created_by_name,
              COALESCE(u_deleted.name, u_deleted.email, 'Usuário indisponível') AS deleted_by_name
       FROM megadesk_crm_client_files f
       LEFT JOIN megadesk_domain_client_users u_created
         ON u_created.client_id = f.client_id AND u_created.user_id = f.created_by
       LEFT JOIN megadesk_domain_client_users u_deleted
         ON u_deleted.client_id = f.client_id AND u_deleted.user_id = f.deleted_by
       WHERE f.client_id = ? AND f.crm_client_id = ? AND f.public_id = ?
       LIMIT 1`,
      [clientId, crmClientId, filePublicId]
    );
    return rows[0] ?? null;
  }

  async list(clientId: string, crmClientId: string, options: { category?: ClientFileCategory; includeDeleted?: boolean } = {}): Promise<ClientFileRow[]> {
    const conditions: string[] = ["f.client_id = ?", "f.crm_client_id = ?"];
    const params: unknown[] = [clientId, crmClientId];
    if (!options.includeDeleted) conditions.push("f.state = 'active'");
    if (options.category) {
      conditions.push("f.category = ?");
      params.push(options.category);
    }
    const [rows] = await this.db().execute<ClientFileRow[]>(
      `SELECT f.*,
              COALESCE(u_created.name, u_created.email, 'Usuário indisponível') AS created_by_name,
              COALESCE(u_deleted.name, u_deleted.email, 'Usuário indisponível') AS deleted_by_name
       FROM megadesk_crm_client_files f
       LEFT JOIN megadesk_domain_client_users u_created
         ON u_created.client_id = f.client_id AND u_created.user_id = f.created_by
       LEFT JOIN megadesk_domain_client_users u_deleted
         ON u_deleted.client_id = f.client_id AND u_deleted.user_id = f.deleted_by
       WHERE ${conditions.join(" AND ")}
       ORDER BY f.created_at DESC, f.id DESC`,
      params
    );
    return rows;
  }

  async transitionToPendingDelete(clientId: string, crmClientId: string, filePublicId: string, userId: string): Promise<ClientFileRow | null> {
    const existing = await this.findByPublicId(clientId, crmClientId, filePublicId);
    if (!existing || existing.state === "deleted") return null;
    if (existing.state === "pending_delete") return existing;
    const [result] = await this.db().execute<ResultSetHeader>(
      `UPDATE megadesk_crm_client_files
       SET state = 'pending_delete', pending_delete_at = NOW(), deleted_by = ?, deleted_at = NULL
       WHERE client_id = ? AND crm_client_id = ? AND public_id = ? AND state = 'active'`,
      [userId, clientId, crmClientId, filePublicId]
    );
    if (result.affectedRows !== 1) {
      const current = await this.findByPublicId(clientId, crmClientId, filePublicId);
      return current?.state === "pending_delete" ? current : null;
    }
    return this.findByPublicId(clientId, crmClientId, filePublicId);
  }

  async finalizePendingDelete(clientId: string, crmClientId: string, filePublicId: string): Promise<ClientFileRow | null> {
    const [result] = await this.db().execute<ResultSetHeader>(
      `UPDATE megadesk_crm_client_files
       SET state = 'deleted', deleted_at = NOW(), pending_delete_at = NULL
       WHERE client_id = ? AND crm_client_id = ? AND public_id = ? AND state = 'pending_delete'`,
      [clientId, crmClientId, filePublicId]
    );
    if (result.affectedRows === 1) return this.findByPublicId(clientId, crmClientId, filePublicId);
    const current = await this.findByPublicId(clientId, crmClientId, filePublicId);
    return current?.state === "deleted" ? current : null;
  }

  async listEligiblePhysicalCleanup(clientId: string, limit = 100): Promise<ClientFileRow[]> {
    const boundedLimit = Math.max(1, Math.min(1_000, limit));
    const [rows] = await this.db().execute<ClientFileRow[]>(
      `SELECT * FROM megadesk_crm_client_files
       WHERE client_id = ? AND state = 'pending_delete' AND pending_delete_at IS NOT NULL
       ORDER BY pending_delete_at ASC, id ASC
       LIMIT ${boundedLimit}`,
      [clientId]
    );
    return rows;
  }
}
