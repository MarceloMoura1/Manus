import { randomUUID } from "node:crypto";
import type { OperationalRole } from "../../erp/contracts";
import { ErpDomainError } from "../../erp/errors";
import {
  CLIENT_FILE_CATEGORY_LABELS,
  canManageClientFiles,
  formatActorName,
  type ClientFileDeleteInput,
  type ClientFileListInput,
  type ClientFileUploadInput,
  type ClientFileView,
} from "./files-contracts";
import { ClientFileRepository, type ClientFileRow } from "./files-repository";
import {
  deleteCrmClientFilePhysical,
  readCrmClientFile,
  removeCrmClientFilePhysical,
  sanitizeFileName,
  validateAndInspectFile,
  writeCrmClientFileAtomic,
} from "./files-storage";

type Identity = {
  clientId: string;
  userId: string;
  role: OperationalRole;
};

function toFileView(row: ClientFileRow, crmClientId: string): ClientFileView {
  return {
    publicId: row.public_id,
    crmClientId,
    fileName: row.file_name,
    category: row.category,
    categoryLabel: CLIENT_FILE_CATEGORY_LABELS[row.category] || "Outros",
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
    downloadUrl: `/api/crm/clients/${encodeURIComponent(crmClientId)}/files/${encodeURIComponent(row.public_id)}`,
  };
}

function decodeBase64(base64: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw new ErpDomainError("VALIDATION", "Conteúdo em formato base64 inválido.");
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== base64) {
    throw new ErpDomainError("VALIDATION", "Conteúdo em formato base64 inválido.");
  }
  return bytes;
}

export class ClientFileService {
  constructor(
    private readonly repository = new ClientFileRepository(),
    private readonly deletePhysical = deleteCrmClientFilePhysical,
  ) {}

  private assertManage(identity: Identity): void {
    if (!canManageClientFiles(identity.role)) {
      throw new ErpDomainError("FORBIDDEN", "Seu perfil não permite gerenciar arquivos de clientes.");
    }
  }

  async list(identity: Identity, input: ClientFileListInput): Promise<ClientFileView[]> {
    const owner = await this.repository.findClient(identity.clientId, input.crmClientId);
    if (!owner) throw new ErpDomainError("NOT_FOUND", "Cliente não encontrado.");
    const rows = await this.repository.list(identity.clientId, owner.crmClientId, {
      category: input.category,
      includeDeleted: input.includeDeleted,
    });
    return rows.map(row => toFileView(row, owner.crmClientId));
  }

  async upload(identity: Identity, input: ClientFileUploadInput): Promise<ClientFileView> {
    this.assertManage(identity);
    const owner = await this.repository.findClient(identity.clientId, input.crmClientId);
    if (!owner) throw new ErpDomainError("NOT_FOUND", "Cliente não encontrado.");
    if (owner.lifecycleState === "archived") {
      throw new ErpDomainError("VALIDATION", "Não é possível anexar arquivos a um cliente arquivado.");
    }

    const safeName = sanitizeFileName(input.fileName);
    const bytes = decodeBase64(input.base64);
    const { mimeType, sha256 } = await validateAndInspectFile(bytes, input.mimeType);
    const filePublicId = randomUUID();
    const storageKey = randomUUID();

    await writeCrmClientFileAtomic(identity.clientId, storageKey, bytes);
    try {
      const row = await this.repository.insertFile(identity.clientId, owner.crmClientId, {
        publicId: filePublicId,
        fileName: safeName,
        category: input.category,
        description: input.description ?? null,
        mimeType,
        sizeBytes: bytes.length,
        sha256,
        storageKey,
        createdBy: identity.userId,
      });
      return toFileView(row, owner.crmClientId);
    } catch (error) {
      await removeCrmClientFilePhysical(identity.clientId, storageKey);
      throw error;
    }
  }

  async delete(identity: Identity, input: ClientFileDeleteInput): Promise<{ ok: boolean }> {
    this.assertManage(identity);
    const owner = await this.repository.findClient(identity.clientId, input.crmClientId);
    if (!owner) throw new ErpDomainError("NOT_FOUND", "Cliente não encontrado.");
    const file = await this.repository.transitionToPendingDelete(
      identity.clientId,
      owner.crmClientId,
      input.filePublicId,
      identity.userId
    );
    if (!file) throw new ErpDomainError("NOT_FOUND", "Arquivo não encontrado ou já excluído.");

    try {
      await this.deletePhysical(identity.clientId, file.storage_key);
      const finalized = await this.repository.finalizePendingDelete(identity.clientId, owner.crmClientId, file.public_id);
      if (!finalized || finalized.state !== "deleted") {
        throw new ErpDomainError("CONFLICT", "Não foi possível concluir a exclusão do arquivo.");
      }
    } catch (error) {
      if (error instanceof ErpDomainError && error.code === "CONFLICT") throw error;
      throw new ErpDomainError(
        "CONFLICT",
        "Não foi possível concluir a exclusão física do arquivo. O arquivo permanece pendente para nova tentativa."
      );
    }

    return { ok: true };
  }

  async getFileForDownload(identity: Identity, crmClientId: string, filePublicId: string): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
    const owner = await this.repository.findClient(identity.clientId, crmClientId);
    if (!owner) throw new ErpDomainError("NOT_FOUND", "Cliente não encontrado.");
    const file = await this.repository.findByPublicId(identity.clientId, owner.crmClientId, filePublicId);
    if (!file || file.state !== "active") {
      throw new ErpDomainError("NOT_FOUND", "Arquivo não encontrado ou indisponível.");
    }
    return {
      bytes: await readCrmClientFile(identity.clientId, file.storage_key),
      mimeType: file.mime_type,
      fileName: file.file_name,
    };
  }
}
