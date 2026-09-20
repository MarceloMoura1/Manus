import { randomUUID } from "node:crypto";
import type { OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import {
  canManageSupplierFiles,
  formatActorName,
  type SupplierFileDeleteInput,
  type SupplierFileListInput,
  type SupplierFileUploadInput,
  type SupplierFileView,
  SUPPLIER_FILE_CATEGORY_LABELS,
} from "./files-contracts";
import { SupplierFileRepository, type SupplierFileRow } from "./files-repository";
import {
  readSupplierFile,
  removeSupplierFilePhysical,
  sanitizeFileName,
  validateAndInspectFile,
  validateUuid,
  writeSupplierFileAtomic,
} from "./files-storage";

type Identity = {
  clientId: string;
  userId: string;
  role: OperationalRole;
};

function toFileView(row: SupplierFileRow, supplierPublicId: string): SupplierFileView {
  return {
    publicId: row.public_id,
    supplierPublicId,
    fileName: row.file_name,
    category: row.category,
    categoryLabel: SUPPLIER_FILE_CATEGORY_LABELS[row.category] || "Outros",
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
    downloadUrl: `/api/erp/suppliers/${supplierPublicId}/files/${row.public_id}`,
  };
}

export class SupplierFileService {
  constructor(private readonly repository = new SupplierFileRepository()) {}

  private assertManage(identity: Identity): void {
    if (!canManageSupplierFiles(identity.role)) {
      throw new ErpDomainError("FORBIDDEN", "Seu perfil não permite gerenciar arquivos de fornecedores.");
    }
  }

  async list(identity: Identity, input: SupplierFileListInput): Promise<SupplierFileView[]> {
    validateUuid(input.supplierPublicId, "Fornecedor");
    const supplier = await this.repository.findSupplier(identity.clientId, input.supplierPublicId);
    if (!supplier) {
      throw new ErpDomainError("NOT_FOUND", "Fornecedor não encontrado.");
    }

    const rows = await this.repository.list(identity.clientId, supplier.id, {
      category: input.category,
      includeDeleted: input.includeDeleted,
    });

    return rows.map(r => toFileView(r, input.supplierPublicId));
  }

  async upload(identity: Identity, input: SupplierFileUploadInput): Promise<SupplierFileView> {
    this.assertManage(identity);
    validateUuid(input.supplierPublicId, "Fornecedor");

    const supplier = await this.repository.findSupplier(identity.clientId, input.supplierPublicId);
    if (!supplier) {
      throw new ErpDomainError("NOT_FOUND", "Fornecedor não encontrado.");
    }
    if (!supplier.active) {
      throw new ErpDomainError("VALIDATION", "Não é possível anexar arquivos a um fornecedor inativo.");
    }

    const safeName = sanitizeFileName(input.fileName);
    let bytes: Buffer;
    try {
      bytes = Buffer.from(input.base64, "base64");
    } catch {
      throw new ErpDomainError("VALIDATION", "Conteúdo em formato base64 inválido.");
    }

    const { mimeType, sha256 } = await validateAndInspectFile(bytes, input.mimeType);
    const filePublicId = randomUUID();
    const storageKey = randomUUID();

    // 1. Atomic write to isolated disk storage
    await writeSupplierFileAtomic(identity.clientId, storageKey, bytes);

    // 2. Insert metadata into database with compensating cleanup
    try {
      const row = await this.repository.insertFile(identity.clientId, supplier.id, {
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

      return toFileView(row, input.supplierPublicId);
    } catch (error) {
      // Compensating cleanup on DB failure
      await removeSupplierFilePhysical(identity.clientId, storageKey);
      throw error;
    }
  }

  async delete(identity: Identity, input: SupplierFileDeleteInput): Promise<{ ok: boolean }> {
    this.assertManage(identity);
    validateUuid(input.supplierPublicId, "Fornecedor");
    validateUuid(input.filePublicId, "Arquivo");

    const supplier = await this.repository.findSupplier(identity.clientId, input.supplierPublicId);
    if (!supplier) {
      throw new ErpDomainError("NOT_FOUND", "Fornecedor não encontrado.");
    }

    const success = await this.repository.softDelete(
      identity.clientId,
      supplier.id,
      input.filePublicId,
      identity.userId
    );

    if (!success) {
      throw new ErpDomainError("NOT_FOUND", "Arquivo não encontrado ou já excluído.");
    }

    return { ok: true };
  }

  async getFileForDownload(
    identity: Identity,
    supplierPublicId: string,
    filePublicId: string
  ): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
    validateUuid(supplierPublicId, "Fornecedor");
    validateUuid(filePublicId, "Arquivo");

    const supplier = await this.repository.findSupplier(identity.clientId, supplierPublicId);
    if (!supplier) {
      throw new ErpDomainError("NOT_FOUND", "Fornecedor não encontrado.");
    }

    const file = await this.repository.findByPublicId(identity.clientId, supplier.id, filePublicId);
    if (!file || file.state !== "active") {
      throw new ErpDomainError("NOT_FOUND", "Arquivo não encontrado ou indisponível.");
    }

    const bytes = await readSupplierFile(identity.clientId, file.storage_key);

    return {
      bytes,
      mimeType: file.mime_type,
      fileName: file.file_name,
    };
  }
}
