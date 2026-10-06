import { createHash, randomUUID } from "node:crypto";
import type { OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import {
  formatActorName,
} from "../../crm/client-files/files-contracts";
import {
  deleteCrmClientFilePhysical,
  readCrmClientFile,
  sanitizeFileName,
  validateAndInspectFile,
  writeCrmClientFileAtomic,
} from "../../crm/client-files/files-storage";
import {
  canManageSaleDocuments,
  SALE_DOCUMENT_TYPE_LABELS,
  type SaleDocumentDeleteInput,
  type SaleDocumentUploadInput,
  type SaleDocumentView,
} from "./documents-contracts";
import {
  SaleDocumentRepository,
  type SaleDocumentRow,
} from "./documents-repository";

type Identity = {
  clientId: string;
  userId: string;
  userName: string | null;
  role: OperationalRole;
};

type Storage = {
  write(clientId: string, storageKey: string, bytes: Buffer): Promise<string>;
  read(clientId: string, storageKey: string): Promise<Buffer>;
  delete(clientId: string, storageKey: string): Promise<void>;
};

const defaultStorage: Storage = {
  write: writeCrmClientFileAtomic,
  read: readCrmClientFile,
  delete: deleteCrmClientFilePhysical,
};

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function decodeBase64(base64: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw new ErpDomainError("VALIDATION", "Conteúdo em formato base64 inválido.");
  }
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.toString("base64") !== base64) {
    throw new ErpDomainError("VALIDATION", "Conteúdo em formato base64 inválido.");
  }
  return bytes;
}

function toView(row: SaleDocumentRow): SaleDocumentView {
  return {
    publicId: row.public_id,
    salePublicId: row.sale_public_id,
    crmClientId: row.crm_client_id,
    documentType: row.document_type,
    documentTypeLabel: SALE_DOCUMENT_TYPE_LABELS[row.document_type],
    filePublicId: row.file_public_id,
    fileName: row.file_name,
    description: row.description,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    state: row.state,
    createdBy: row.created_by,
    createdByName: formatActorName(row.created_by_name),
    createdAt: row.created_at,
    deletedBy: row.deleted_by,
    deletedByName: row.deleted_by_name ? formatActorName(row.deleted_by_name) : null,
    deletedAt: row.deleted_at,
    downloadUrl: `/api/erp/sales/${encodeURIComponent(row.sale_public_id)}/documents/${encodeURIComponent(row.public_id)}`,
  };
}

export class SaleDocumentService {
  constructor(
    private readonly repository = new SaleDocumentRepository(),
    private readonly storage: Storage = defaultStorage
  ) {}

  private assertManage(identity: Identity): void {
    if (!canManageSaleDocuments(identity.role)) {
      throw new ErpDomainError(
        "FORBIDDEN",
        "Seu perfil possui acesso somente leitura aos documentos de Vendas."
      );
    }
  }

  async list(identity: Identity, salePublicId: string): Promise<SaleDocumentView[]> {
    return (await this.repository.list(identity.clientId, salePublicId)).map(toView);
  }

  async upload(identity: Identity, input: SaleDocumentUploadInput): Promise<SaleDocumentView> {
    this.assertManage(identity);
    const fileName = sanitizeFileName(input.fileName);
    const bytes = decodeBase64(input.base64);
    const inspected = await validateAndInspectFile(bytes, input.mimeType);
    const storageKey = randomUUID();
    const filePublicId = randomUUID();
    const documentPublicId = randomUUID();
    const payloadHash = createHash("sha256").update(JSON.stringify({
      salePublicId: input.salePublicId,
      documentType: input.documentType,
      fileName,
      description: input.description ?? null,
      mimeType: inspected.mimeType,
      sizeBytes: bytes.length,
      sha256: inspected.sha256,
    })).digest("hex");
    const reservation = await this.repository.reserveUpload(
      identity.clientId,
      input.salePublicId,
      {
        documentPublicId,
        filePublicId,
        storageKey,
        fileName,
        description: input.description ?? null,
        mimeType: inspected.mimeType,
        sizeBytes: bytes.length,
        sha256: inspected.sha256,
        documentType: input.documentType,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        createdBy: identity.userId,
        createdByName: identity.userName,
      }
    );
    if (reservation.document.state === "active") {
      return toView(reservation.document);
    }
    if (reservation.document.state !== "pending_upload") {
      throw new ErpDomainError(
        "IDEMPOTENCY_CONFLICT",
        "O upload associado a esta chave já foi removido. Inicie um novo upload."
      );
    }

    const probePhysical = async (): Promise<"missing" | "match" | "mismatch"> => {
      try {
        const stored = await this.storage.read(
          identity.clientId,
          reservation.document.storage_key
        );
        return sha256(stored) === reservation.document.sha256 ? "match" : "mismatch";
      } catch (error) {
        if (error instanceof ErpDomainError && error.code === "NOT_FOUND") return "missing";
        throw error;
      }
    };

    let physicalState: "missing" | "match" | "mismatch" = reservation.replay
      ? await probePhysical()
      : "missing";
    if (physicalState === "mismatch") {
      throw new ErpDomainError(
        "CONFLICT",
        "O arquivo reservado diverge do conteúdo validado. O upload não foi substituído."
      );
    }
    if (physicalState === "missing") {
      try {
        await this.storage.write(
          identity.clientId,
          reservation.document.storage_key,
          bytes
        );
      } catch (writeError) {
        physicalState = await probePhysical();
        if (physicalState !== "match") throw writeError;
      }
    }
    return toView(await this.repository.finalizeUpload(
      identity.clientId,
      input.salePublicId,
      reservation.document.public_id
    ));
  }

  async delete(
    identity: Identity,
    input: SaleDocumentDeleteInput
  ): Promise<{ ok: true }> {
    this.assertManage(identity);
    const document = await this.repository.transitionToPendingDelete(
      identity.clientId,
      input.salePublicId,
      input.documentPublicId,
      { userId: identity.userId, name: identity.userName }
    );
    if (!document) {
      throw new ErpDomainError("NOT_FOUND", "Documento não encontrado ou já excluído.");
    }
    try {
      await this.storage.delete(identity.clientId, document.storage_key);
      const finalized = await this.repository.finalizePendingDelete(
        identity.clientId,
        input.salePublicId,
        input.documentPublicId
      );
      if (!finalized || finalized.state !== "deleted") {
        throw new ErpDomainError(
          "CONFLICT",
          "Não foi possível concluir a exclusão do documento."
        );
      }
      return { ok: true };
    } catch (error) {
      if (error instanceof ErpDomainError && error.code === "CONFLICT") throw error;
      throw new ErpDomainError(
        "CONFLICT",
        "Não foi possível concluir a exclusão física. O documento permanece pendente para uma nova tentativa segura."
      );
    }
  }

  async getForDownload(
    identity: Identity,
    salePublicId: string,
    documentPublicId: string
  ) {
    const document = await this.repository.findByPublicId(
      identity.clientId,
      salePublicId,
      documentPublicId
    );
    if (!document || document.state !== "active") {
      throw new ErpDomainError("NOT_FOUND", "Documento não encontrado ou indisponível.");
    }
    return {
      bytes: await this.storage.read(identity.clientId, document.storage_key),
      fileName: document.file_name,
      mimeType: document.mime_type,
    };
  }

  async customerSales(identity: Identity, crmClientId: string) {
    return this.repository.customerSales(identity.clientId, crmClientId);
  }
}
