import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { getPool } from "../../../db";
import { ErpDomainError } from "../errors";
import type { SaleDocumentType } from "./documents-contracts";

export type SaleDocumentRow = RowDataPacket & {
  id: number;
  public_id: string;
  client_id: string;
  sale_order_id: number;
  sale_public_id: string;
  order_number: string;
  crm_client_id: string;
  client_file_id: number;
  file_public_id: string;
  file_name: string;
  description: string | null;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  storage_key: string;
  document_type: SaleDocumentType;
  upload_idempotency_key: string;
  upload_payload_hash: string;
  state: "pending_upload" | "active" | "pending_delete" | "deleted";
  created_by: string;
  created_at: string;
  deleted_by: string | null;
  deleted_at: string | null;
  pending_delete_at: string | null;
  created_by_name: string | null;
  deleted_by_name: string | null;
};

export type CreateSaleDocumentData = {
  documentPublicId: string;
  filePublicId: string;
  storageKey: string;
  fileName: string;
  description: string | null;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  documentType: SaleDocumentType;
  idempotencyKey: string;
  payloadHash: string;
  createdBy: string;
  createdByName: string | null;
};

type SaleOwnerRow = RowDataPacket & {
  id: number;
  public_id: string;
  order_number: string;
  crm_client_id: string;
  lifecycle_state: "active" | "inactive" | "archived";
};

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    (error as { code?: unknown }).code === "ER_DUP_ENTRY";
}

export class SaleDocumentRepository {
  constructor(private pool?: Pool) {}

  private db(): Pool {
    return (this.pool ??= getPool());
  }

  private async findOwnerWith(
    executor: Pool | PoolConnection,
    clientId: string,
    salePublicId: string,
    lock = false
  ): Promise<SaleOwnerRow | null> {
    const [rows] = await executor.execute<SaleOwnerRow[]>(
      `SELECT o.id,o.public_id,o.order_number,o.crm_client_id,c.lifecycle_state
       FROM erp_sale_orders o
       INNER JOIN megadesk_crm_clients c
         ON c.client_id=o.client_id AND c.crm_client_id=o.crm_client_id
       WHERE o.client_id=? AND o.public_id=?
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, salePublicId]
    );
    return rows[0] ?? null;
  }

  async findOwner(clientId: string, salePublicId: string): Promise<SaleOwnerRow | null> {
    return this.findOwnerWith(this.db(), clientId, salePublicId);
  }

  private async findByUploadKeyWith(
    executor: Pool | PoolConnection,
    clientId: string,
    idempotencyKey: string,
    lock = false
  ): Promise<SaleDocumentRow | null> {
    const [rows] = await executor.execute<SaleDocumentRow[]>(
      `${this.selectDocumentSql()}
       WHERE d.client_id=? AND d.upload_idempotency_key=?
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, idempotencyKey]
    );
    return rows[0] ?? null;
  }

  private async findPendingUploadByPayloadWith(
    executor: PoolConnection,
    clientId: string,
    saleOrderId: number,
    payloadHash: string
  ): Promise<SaleDocumentRow | null> {
    const [rows] = await executor.execute<SaleDocumentRow[]>(
      `${this.selectDocumentSql()}
       WHERE d.client_id=? AND d.sale_order_id=?
         AND d.upload_payload_hash=? AND d.state='pending_upload'
       ORDER BY d.id LIMIT 1 FOR UPDATE`,
      [clientId, saleOrderId, payloadHash]
    );
    return rows[0] ?? null;
  }

  async findByUploadKey(
    clientId: string,
    idempotencyKey: string
  ): Promise<SaleDocumentRow | null> {
    return this.findByUploadKeyWith(this.db(), clientId, idempotencyKey);
  }

  private assertUploadReplay(
    existing: SaleDocumentRow,
    salePublicId: string,
    payloadHash: string
  ): void {
    if (
      existing.sale_public_id !== salePublicId ||
      existing.upload_payload_hash !== payloadHash
    ) {
      throw new ErpDomainError(
        "IDEMPOTENCY_CONFLICT",
        "Chave idempotente já usada em outro upload de documento."
      );
    }
  }

  async reserveUpload(
    clientId: string,
    salePublicId: string,
    data: CreateSaleDocumentData
  ): Promise<{ document: SaleDocumentRow; replay: boolean }> {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const owner = await this.findOwnerWith(connection, clientId, salePublicId, true);
      if (!owner) throw new ErpDomainError("NOT_FOUND", "Venda não encontrada.");
      const replay = await this.findByUploadKeyWith(
        connection,
        clientId,
        data.idempotencyKey,
        true
      );
      if (replay) {
        this.assertUploadReplay(replay, salePublicId, data.payloadHash);
        await connection.commit();
        return { document: replay, replay: true };
      }
      const interruptedUpload = await this.findPendingUploadByPayloadWith(
        connection,
        clientId,
        owner.id,
        data.payloadHash
      );
      if (interruptedUpload) {
        await connection.commit();
        return { document: interruptedUpload, replay: true };
      }
      if (owner.lifecycle_state === "archived") {
        throw new ErpDomainError(
          "VALIDATION",
          "Não é possível anexar documentos a uma venda de cliente arquivado."
        );
      }

      const [fileInsert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO megadesk_crm_client_files
         (public_id,client_id,crm_client_id,file_name,category,description,mime_type,size_bytes,sha256,storage_key,state,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,'pending_upload',?)`,
        [
          data.filePublicId,
          clientId,
          owner.crm_client_id,
          data.fileName,
          data.documentType === "other" ? "other" : "commercial",
          data.description,
          data.mimeType,
          data.sizeBytes,
          data.sha256,
          data.storageKey,
          data.createdBy,
        ]
      );

      await connection.execute<ResultSetHeader>(
        `INSERT INTO erp_sale_documents
         (public_id,client_id,sale_order_id,client_file_id,document_type,upload_idempotency_key,upload_payload_hash,state,created_by)
         VALUES (?,?,?,?,?,?,?,'pending_upload',?)`,
        [
          data.documentPublicId,
          clientId,
          owner.id,
          fileInsert.insertId,
          data.documentType,
          data.idempotencyKey,
          data.payloadHash,
          data.createdBy,
        ]
      );
      const reserved = await this.findByUploadKeyWith(
        connection,
        clientId,
        data.idempotencyKey,
        true
      );
      if (!reserved) throw new Error("Falha ao reservar upload de documento.");
      await connection.commit();
      return { document: reserved, replay: false };
    } catch (error) {
      await connection.rollback();
      if (isDuplicateKeyError(error)) {
        const replay = await this.findByUploadKey(clientId, data.idempotencyKey);
        if (replay) {
          this.assertUploadReplay(replay, salePublicId, data.payloadHash);
          return { document: replay, replay: true };
        }
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async finalizeUpload(
    clientId: string,
    salePublicId: string,
    documentPublicId: string
  ): Promise<SaleDocumentRow> {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const owner = await this.findOwnerWith(connection, clientId, salePublicId, true);
      if (!owner) throw new ErpDomainError("NOT_FOUND", "Venda não encontrada.");
      if (owner.lifecycle_state === "archived") {
        throw new ErpDomainError(
          "VALIDATION",
          "Não é possível concluir o upload para uma venda de cliente arquivado."
        );
      }
      const document = await this.findByPublicIdWith(
        connection,
        clientId,
        salePublicId,
        documentPublicId,
        true
      );
      if (!document) throw new ErpDomainError("NOT_FOUND", "Documento não encontrado.");
      if (document.state === "active") {
        await connection.commit();
        return document;
      }
      if (document.state !== "pending_upload") {
        throw new ErpDomainError("CONFLICT", "Upload de documento não pode ser finalizado neste estado.");
      }
      const [documentUpdate] = await connection.execute<ResultSetHeader>(
        `UPDATE erp_sale_documents SET state='active'
         WHERE client_id=? AND id=? AND state='pending_upload'`,
        [clientId, document.id]
      );
      const [clientFileUpdate] = await connection.execute<ResultSetHeader>(
        `UPDATE megadesk_crm_client_files SET state='active'
         WHERE client_id=? AND id=? AND state='pending_upload'`,
        [clientId, document.client_file_id]
      );
      if (documentUpdate.affectedRows !== 1 || clientFileUpdate.affectedRows !== 1) {
        throw new ErpDomainError(
          "CONFLICT",
          "O upload mudou durante a finalização. Repita a operação."
        );
      }
      await connection.execute<ResultSetHeader>(
        `INSERT INTO erp_sale_order_events
         (public_id,client_id,sale_order_id,event_type,after_json,changed_by,changed_by_name_snapshot)
         VALUES (?, ?, ?, 'document_added', ?, ?, ?)`,
        [
          crypto.randomUUID(),
          clientId,
          document.sale_order_id,
          JSON.stringify({
            documentPublicId: document.public_id,
            documentType: document.document_type,
            fileName: document.file_name,
            sizeBytes: Number(document.size_bytes),
            sha256: document.sha256,
          }),
          document.created_by,
          document.created_by_name,
        ]
      );
      const finalized = await this.findByPublicIdWith(
        connection,
        clientId,
        salePublicId,
        documentPublicId,
        true
      );
      if (!finalized || finalized.state !== "active") {
        throw new Error("Falha ao finalizar upload de documento.");
      }
      await connection.commit();
      return finalized;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async findByPublicIdWith(
    executor: Pool | PoolConnection,
    clientId: string,
    salePublicId: string,
    documentPublicId: string,
    lock = false
  ): Promise<SaleDocumentRow | null> {
    const [rows] = await executor.execute<SaleDocumentRow[]>(
      `${this.selectDocumentSql()}
       WHERE d.client_id=? AND o.public_id=? AND d.public_id=?
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, salePublicId, documentPublicId]
    );
    return rows[0] ?? null;
  }

  async findByPublicId(
    clientId: string,
    salePublicId: string,
    documentPublicId: string
  ): Promise<SaleDocumentRow | null> {
    return this.findByPublicIdWith(
      this.db(),
      clientId,
      salePublicId,
      documentPublicId
    );
  }

  async list(clientId: string, salePublicId: string): Promise<SaleDocumentRow[]> {
    const owner = await this.findOwner(clientId, salePublicId);
    if (!owner) throw new ErpDomainError("NOT_FOUND", "Venda não encontrada.");
    const [rows] = await this.db().execute<SaleDocumentRow[]>(
      `${this.selectDocumentSql()}
       WHERE d.client_id=? AND o.public_id=? AND d.state='active' AND f.state='active'
       ORDER BY d.created_at DESC,d.id DESC`,
      [clientId, salePublicId]
    );
    return rows;
  }

  async transitionToPendingDelete(
    clientId: string,
    salePublicId: string,
    documentPublicId: string,
    actor: { userId: string; name: string | null }
  ): Promise<SaleDocumentRow | null> {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const document = await this.findByPublicIdWith(
        connection,
        clientId,
        salePublicId,
        documentPublicId,
        true
      );
      if (!document || document.state === "deleted") {
        await connection.rollback();
        return null;
      }
      if (document.state === "pending_upload") {
        throw new ErpDomainError(
          "CONFLICT",
          "Upload do documento ainda não foi concluído. Repita o upload antes de removê-lo."
        );
      }
      if (document.state === "active") {
        const [documentUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE erp_sale_documents
           SET state='pending_delete',pending_delete_at=NOW(),deleted_by=?,deleted_at=NULL
           WHERE client_id=? AND id=? AND state='active'`,
          [actor.userId, clientId, document.id]
        );
        const [clientFileUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE megadesk_crm_client_files
           SET state='pending_delete',pending_delete_at=NOW(),deleted_by=?,deleted_at=NULL
           WHERE client_id=? AND id=? AND state='active'`,
          [actor.userId, clientId, document.client_file_id]
        );
        if (documentUpdate.affectedRows !== 1 || clientFileUpdate.affectedRows !== 1) {
          throw new ErpDomainError(
            "CONFLICT",
            "O documento mudou durante a remoção. Repita a operação."
          );
        }
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.findByPublicId(clientId, salePublicId, documentPublicId);
  }

  async finalizePendingDelete(
    clientId: string,
    salePublicId: string,
    documentPublicId: string
  ): Promise<SaleDocumentRow | null> {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const document = await this.findByPublicIdWith(
        connection,
        clientId,
        salePublicId,
        documentPublicId,
        true
      );
      if (!document) {
        await connection.rollback();
        return null;
      }
      if (document.state === "pending_delete") {
        const [documentUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE erp_sale_documents
           SET state='deleted',deleted_at=NOW(),pending_delete_at=NULL
           WHERE client_id=? AND id=? AND state='pending_delete'`,
          [clientId, document.id]
        );
        const [clientFileUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE megadesk_crm_client_files
           SET state='deleted',deleted_at=NOW(),pending_delete_at=NULL
           WHERE client_id=? AND id=? AND state='pending_delete'`,
          [clientId, document.client_file_id]
        );
        if (documentUpdate.affectedRows !== 1 || clientFileUpdate.affectedRows !== 1) {
          throw new ErpDomainError(
            "CONFLICT",
            "O documento mudou durante a exclusão. Repita a operação."
          );
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO erp_sale_order_events
           (public_id,client_id,sale_order_id,event_type,before_json,changed_by,changed_by_name_snapshot)
           VALUES (?, ?, ?, 'document_removed', ?, ?, ?)`,
          [
            crypto.randomUUID(),
            clientId,
            document.sale_order_id,
            JSON.stringify({
              documentPublicId: document.public_id,
              documentType: document.document_type,
              fileName: document.file_name,
              sha256: document.sha256,
            }),
            document.deleted_by,
            document.deleted_by_name,
          ]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.findByPublicId(clientId, salePublicId, documentPublicId);
  }

  async customerSales(clientId: string, crmClientId: string) {
    const [customers] = await this.db().execute<RowDataPacket[]>(
      `SELECT company_name FROM megadesk_crm_clients
       WHERE client_id=? AND crm_client_id=? LIMIT 1`,
      [clientId, crmClientId]
    );
    if (!customers[0]) throw new ErpDomainError("NOT_FOUND", "Cliente não encontrado.");

    const [orders] = await this.db().execute<RowDataPacket[]>(
      `SELECT o.id,o.public_id AS publicId,o.order_number AS orderNumber,
              o.customer_name_snapshot AS customerName,o.status,
              COALESCE(o.current_stage,
                CASE WHEN o.status='draft' THEN 'created'
                     WHEN o.status='fulfilled' THEN 'completed'
                     ELSE 'confirmed' END) AS currentStage,
              o.total_cents AS totalCents,o.created_at AS createdAt,
              COALESCE(payments.paid_cents,0) AS paidCents
       FROM erp_sale_orders o
       LEFT JOIN (
         SELECT e.client_id,e.source_public_id,SUM(s.amount_cents) paid_cents
         FROM erp_financial_entries e
         INNER JOIN erp_financial_settlements s
           ON s.client_id=e.client_id AND s.financial_entry_id=e.id
         WHERE e.source_type='sales_order'
         GROUP BY e.client_id,e.source_public_id
       ) payments ON payments.client_id=o.client_id AND payments.source_public_id=o.public_id
       WHERE o.client_id=? AND o.crm_client_id=?
       ORDER BY o.created_at DESC,o.id DESC
       LIMIT 100`,
      [clientId, crmClientId]
    );
    if (!orders.length) return { customerName: String(customers[0].company_name), sales: [] };

    const ids = orders.map(order => Number(order.id));
    const placeholders = ids.map(() => "?").join(",");
    const [items] = await this.db().execute<RowDataPacket[]>(
      `SELECT sale_order_id AS saleOrderId,product_name_snapshot AS productName,
               sku_snapshot AS sku,quantity,line_total_cents AS lineTotalCents
        FROM erp_sale_order_items i
        INNER JOIN erp_sale_orders item_order
          ON item_order.client_id=? AND item_order.id=i.sale_order_id
        WHERE i.sale_order_id IN (${placeholders})
        ORDER BY i.id`,
      [clientId, ...ids]
    );
    const [documents] = await this.db().execute<RowDataPacket[]>(
      `SELECT d.sale_order_id AS saleOrderId,d.public_id AS publicId,
              d.document_type AS documentType,f.file_name AS fileName
       FROM erp_sale_documents d
       INNER JOIN megadesk_crm_client_files f
         ON f.client_id=d.client_id AND f.id=d.client_file_id
       WHERE d.client_id=? AND d.sale_order_id IN (${placeholders})
         AND d.state='active' AND f.state='active'
       ORDER BY d.created_at DESC,d.id DESC`,
      [clientId, ...ids]
    );

    return {
      customerName: String(customers[0].company_name),
      sales: orders.map(order => {
        const totalCents = Number(order.totalCents);
        const paidCents = Number(order.paidCents);
        return {
          publicId: String(order.publicId),
          orderNumber: String(order.orderNumber),
          customerName: String(order.customerName),
          status: String(order.status),
          currentStage: String(order.currentStage),
          totalCents,
          paidCents,
          paymentStatus: paidCents <= 0 ? "pending" : paidCents >= totalCents ? "paid" : "partial",
          createdAt: String(order.createdAt),
          items: items.filter(item => Number(item.saleOrderId) === Number(order.id)).map(item => ({
            productName: String(item.productName),
            sku: String(item.sku),
            quantity: String(item.quantity),
            lineTotalCents: Number(item.lineTotalCents),
          })),
          documents: documents.filter(document => Number(document.saleOrderId) === Number(order.id)).map(document => ({
            publicId: String(document.publicId),
            documentType: String(document.documentType),
            fileName: String(document.fileName),
            downloadUrl: `/api/erp/sales/${encodeURIComponent(String(order.publicId))}/documents/${encodeURIComponent(String(document.publicId))}`,
          })),
        };
      }),
    };
  }

  private selectDocumentSql(): string {
    return `SELECT d.*,o.public_id AS sale_public_id,o.order_number,o.crm_client_id,
                   f.public_id AS file_public_id,f.file_name,f.description,f.mime_type,
                   f.size_bytes,f.sha256,f.storage_key,
                   COALESCE(u_created.name,u_created.email,'Usuário indisponível') AS created_by_name,
                   COALESCE(u_deleted.name,u_deleted.email,'Usuário indisponível') AS deleted_by_name
            FROM erp_sale_documents d
            INNER JOIN erp_sale_orders o
              ON o.client_id=d.client_id AND o.id=d.sale_order_id
            INNER JOIN megadesk_crm_client_files f
              ON f.client_id=d.client_id AND f.id=d.client_file_id
            LEFT JOIN megadesk_domain_client_users u_created
              ON u_created.client_id=d.client_id AND u_created.user_id=d.created_by
            LEFT JOIN megadesk_domain_client_users u_deleted
              ON u_deleted.client_id=d.client_id AND u_deleted.user_id=d.deleted_by`;
  }
}
