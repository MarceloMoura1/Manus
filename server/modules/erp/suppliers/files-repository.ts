import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "../../../db";
import type { SupplierFileCategory } from "./files-contracts";

export type SupplierFileRow = RowDataPacket & {
  id: number;
  public_id: string;
  client_id: string;
  supplier_id: number;
  file_name: string;
  category: SupplierFileCategory;
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

export class SupplierFileRepository {
  constructor(private pool?: Pool) {}

  private db(): Pool {
    return (this.pool ??= getPool());
  }

  async findSupplier(clientId: string, supplierPublicId: string): Promise<{ id: number; publicId: string; active: boolean } | null> {
    const [rows] = await this.db().execute<RowDataPacket[]>(
      `SELECT id, public_id AS publicId, active
       FROM erp_suppliers
       WHERE client_id = ? AND public_id = ?
       LIMIT 1`,
      [clientId, supplierPublicId]
    );
    if (!rows[0]) return null;
    return {
      id: Number(rows[0].id),
      publicId: String(rows[0].publicId),
      active: rows[0].active === 1,
    };
  }

  async insertFile(
    clientId: string,
    supplierId: number,
    data: {
      publicId: string;
      fileName: string;
      category: SupplierFileCategory;
      description: string | null;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      storageKey: string;
      createdBy: string;
    }
  ): Promise<SupplierFileRow> {
    const [result] = await this.db().execute<ResultSetHeader>(
      `INSERT INTO erp_supplier_files
       (public_id, client_id, supplier_id, file_name, category, description, mime_type, size_bytes, sha256, storage_key, state, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [
        data.publicId,
        clientId,
        supplierId,
        data.fileName,
        data.category,
        data.description,
        data.mimeType,
        data.sizeBytes,
        data.sha256,
        data.storageKey,
        data.createdBy,
      ]
    );

    const inserted = await this.findById(clientId, supplierId, result.insertId);
    if (!inserted) {
      throw new Error("Falha ao recuperar arquivo recém-inserido.");
    }
    return inserted;
  }

  async findById(clientId: string, supplierId: number, id: number): Promise<SupplierFileRow | null> {
    const [rows] = await this.db().execute<SupplierFileRow[]>(
      `SELECT f.*,
              COALESCE(u_created.name, u_created.email, 'Usuário indisponível') AS created_by_name,
              COALESCE(u_deleted.name, u_deleted.email, 'Usuário indisponível') AS deleted_by_name
       FROM erp_supplier_files f
       LEFT JOIN megadesk_domain_client_users u_created
         ON u_created.client_id = f.client_id AND u_created.user_id = f.created_by
       LEFT JOIN megadesk_domain_client_users u_deleted
         ON u_deleted.client_id = f.client_id AND u_deleted.user_id = f.deleted_by
       WHERE f.client_id = ? AND f.supplier_id = ? AND f.id = ?
       LIMIT 1`,
      [clientId, supplierId, id]
    );
    return rows[0] ?? null;
  }

  async findByPublicId(clientId: string, supplierId: number, filePublicId: string): Promise<SupplierFileRow | null> {
    const [rows] = await this.db().execute<SupplierFileRow[]>(
      `SELECT f.*,
              COALESCE(u_created.name, u_created.email, 'Usuário indisponível') AS created_by_name,
              COALESCE(u_deleted.name, u_deleted.email, 'Usuário indisponível') AS deleted_by_name
       FROM erp_supplier_files f
       LEFT JOIN megadesk_domain_client_users u_created
         ON u_created.client_id = f.client_id AND u_created.user_id = f.created_by
       LEFT JOIN megadesk_domain_client_users u_deleted
         ON u_deleted.client_id = f.client_id AND u_deleted.user_id = f.deleted_by
       WHERE f.client_id = ? AND f.supplier_id = ? AND f.public_id = ?
       LIMIT 1`,
      [clientId, supplierId, filePublicId]
    );
    return rows[0] ?? null;
  }

  async list(
    clientId: string,
    supplierId: number,
    options: { category?: SupplierFileCategory; includeDeleted?: boolean } = {}
  ): Promise<SupplierFileRow[]> {
    const conditions: string[] = ["f.client_id = ?", "f.supplier_id = ?"];
    const params: any[] = [clientId, supplierId];

    if (!options.includeDeleted) {
      conditions.push("f.state = 'active'");
    }

    if (options.category) {
      conditions.push("f.category = ?");
      params.push(options.category);
    }

    const [rows] = await this.db().execute<SupplierFileRow[]>(
      `SELECT f.*,
              COALESCE(u_created.name, u_created.email, 'Usuário indisponível') AS created_by_name,
              COALESCE(u_deleted.name, u_deleted.email, 'Usuário indisponível') AS deleted_by_name
       FROM erp_supplier_files f
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

  /**
   * Makes a file non-readable without falsely claiming its physical object is
   * gone. Existing deleted rows never enter this pending lifecycle.
   */
  async transitionToPendingDelete(clientId: string, supplierId: number, filePublicId: string, userId: string): Promise<SupplierFileRow | null> {
    const existing = await this.findByPublicId(clientId, supplierId, filePublicId);
    if (!existing || existing.state === "deleted") return null;
    if (existing.state === "pending_delete") return null;
    const [result] = await this.db().execute<ResultSetHeader>(
      `UPDATE erp_supplier_files
       SET state = 'pending_delete', pending_delete_at = NOW(), deleted_by = ?, deleted_at = NULL
       WHERE client_id = ? AND supplier_id = ? AND public_id = ? AND state = 'active'`,
      [userId, clientId, supplierId, filePublicId]
    );
    if (result.affectedRows === 0) {
      const current = await this.findByPublicId(clientId, supplierId, filePublicId);
      return current?.state === "pending_delete" ? current : null;
    }
    return this.findByPublicId(clientId, supplierId, filePublicId);
  }

  async listEligiblePhysicalCleanup(clientId: string, limit = 100): Promise<SupplierFileRow[]> {
    const boundedLimit = Math.max(1, Math.min(1_000, limit));
    const [rows] = await this.db().execute<SupplierFileRow[]>(
      `SELECT * FROM erp_supplier_files
       WHERE client_id = ? AND state = 'pending_delete' AND pending_delete_at IS NOT NULL
       ORDER BY pending_delete_at ASC, id ASC
       LIMIT ${boundedLimit}`,
      [clientId],
    );
    return rows;
  }
}
