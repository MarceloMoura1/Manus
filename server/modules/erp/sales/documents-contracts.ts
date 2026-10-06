import { z } from "zod";
import {
  CLIENT_FILE_BASE64_MAX_CHARS,
  CLIENT_FILE_MAX_BYTES,
  allowedClientFileMimeTypes,
} from "../../crm/client-files/files-contracts";
import type { OperationalRole } from "../contracts";
import { canWriteSales } from "./contracts";

export const SALE_DOCUMENT_MAX_BYTES = CLIENT_FILE_MAX_BYTES;
export const SALE_DOCUMENT_BASE64_MAX_CHARS = CLIENT_FILE_BASE64_MAX_CHARS;
export const allowedSaleDocumentMimeTypes = allowedClientFileMimeTypes;

export const saleDocumentTypes = [
  "invoice",
  "content_declaration",
  "other",
] as const;

export type SaleDocumentType = (typeof saleDocumentTypes)[number];

export const SALE_DOCUMENT_TYPE_LABELS: Record<SaleDocumentType, string> = {
  invoice: "Nota fiscal",
  content_declaration: "Declaração de conteúdo",
  other: "Outros",
};

export const saleDocumentListInput = z.object({
  salePublicId: z.string().uuid(),
});

export const saleDocumentUploadInput = z.object({
  salePublicId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  documentType: z.enum(saleDocumentTypes),
  fileName: z.string().trim().min(1, "Nome do arquivo obrigatório.").max(255),
  description: z.string().trim().max(500).optional().nullable().transform(value => value || null),
  mimeType: z.string().trim().min(1).max(128),
  base64: z.string().min(1, "Conteúdo do arquivo não fornecido.").max(
    SALE_DOCUMENT_BASE64_MAX_CHARS,
    "Arquivo excede o limite máximo de 20 MB."
  ),
});

export const saleDocumentDeleteInput = z.object({
  salePublicId: z.string().uuid(),
  documentPublicId: z.string().uuid(),
});

export const saleDocumentDownloadInput = saleDocumentDeleteInput;

export const customerSalesInput = z.object({
  crmClientId: z.string().trim().min(1).max(80),
});

export type SaleDocumentUploadInput = z.infer<typeof saleDocumentUploadInput>;
export type SaleDocumentDeleteInput = z.infer<typeof saleDocumentDeleteInput>;

export type SaleDocumentView = {
  publicId: string;
  salePublicId: string;
  crmClientId: string;
  documentType: SaleDocumentType;
  documentTypeLabel: string;
  filePublicId: string;
  fileName: string;
  description: string | null;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  state: "pending_upload" | "active" | "pending_delete" | "deleted";
  createdBy: string;
  createdByName: string;
  createdAt: string;
  deletedBy: string | null;
  deletedByName: string | null;
  deletedAt: string | null;
  downloadUrl: string;
};

export function canManageSaleDocuments(role: OperationalRole): boolean {
  return canWriteSales(role);
}
