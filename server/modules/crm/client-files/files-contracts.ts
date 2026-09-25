import { z } from "zod";
import type { OperationalRole } from "../../erp/contracts";
import {
  SUPPLIER_FILE_MAX_BYTES,
  allowedSupplierFileMimeTypes,
  formatActorName,
} from "../../erp/suppliers/files-contracts";

export const CLIENT_FILE_MAX_BYTES = SUPPLIER_FILE_MAX_BYTES;
export const CLIENT_FILE_BASE64_MAX_CHARS = Math.ceil((CLIENT_FILE_MAX_BYTES * 4) / 3) + 4;

export const clientFileCategories = [
  "contracts",
  "identification",
  "commercial",
  "other",
] as const;

export type ClientFileCategory = (typeof clientFileCategories)[number];

export const CLIENT_FILE_CATEGORY_LABELS: Record<ClientFileCategory, string> = {
  contracts: "Contratos",
  identification: "Identificação",
  commercial: "Comercial",
  other: "Outros",
};

export const allowedClientFileMimeTypes = allowedSupplierFileMimeTypes;
export { formatActorName };

export const clientFileUploadInput = z.object({
  crmClientId: z.string().uuid(),
  fileName: z.string().trim().min(1, "Nome do arquivo obrigatório.").max(255, "Nome do arquivo muito longo."),
  category: z.enum(clientFileCategories),
  description: z.string().trim().max(500).optional().nullable().transform(value => value || null),
  mimeType: z.string().trim().min(1).max(128),
  base64: z.string().min(1, "Conteúdo do arquivo não fornecido.").max(CLIENT_FILE_BASE64_MAX_CHARS, "Arquivo excede o limite máximo de 20 MB."),
});

export type ClientFileUploadInput = z.infer<typeof clientFileUploadInput>;

export const clientFileListInput = z.object({
  crmClientId: z.string().uuid(),
  category: z.enum(clientFileCategories).optional(),
  includeDeleted: z.boolean().optional().default(false),
});

export type ClientFileListInput = z.infer<typeof clientFileListInput>;

export const clientFileDeleteInput = z.object({
  crmClientId: z.string().uuid(),
  filePublicId: z.string().uuid(),
});

export type ClientFileDeleteInput = z.infer<typeof clientFileDeleteInput>;

export type ClientFileView = {
  publicId: string;
  crmClientId: string;
  fileName: string;
  category: ClientFileCategory;
  categoryLabel: string;
  description: string | null;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  state: "active" | "pending_delete" | "deleted";
  createdBy: string;
  createdByName: string;
  createdAt: string;
  deletedBy?: string | null;
  deletedByName?: string | null;
  deletedAt?: string | null;
  downloadUrl: string;
};

export function canManageClientFiles(role: OperationalRole): boolean {
  return role === "admin" || role === "manager";
}
