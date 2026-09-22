import { z } from "zod";
import type { OperationalRole } from "../contracts";

export const SUPPLIER_FILE_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export const supplierFileCategories = [
  "contracts",
  "invoices",
  "price_tables",
  "fiscal_documents",
  "other",
] as const;

export type SupplierFileCategory = (typeof supplierFileCategories)[number];

export const SUPPLIER_FILE_CATEGORY_LABELS: Record<SupplierFileCategory, string> = {
  contracts: "Contratos",
  invoices: "Notas Fiscais",
  price_tables: "Tabelas de Preço",
  fiscal_documents: "Documentos Fiscais",
  other: "Outros",
};

export const allowedSupplierFileMimeTypes = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/csv",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type AllowedSupplierFileMimeType = (typeof allowedSupplierFileMimeTypes)[number];

export const supplierFilePublicId = z.string().uuid();

export const supplierFileUploadInput = z.object({
  supplierPublicId: z.string().uuid(),
  fileName: z.string().trim().min(1, "Nome do arquivo obrigatório.").max(255, "Nome do arquivo muito longo."),
  category: z.enum(supplierFileCategories),
  description: z.string().trim().max(500).optional().nullable().transform(v => v || null),
  mimeType: z.string().trim().min(1).max(128),
  base64: z.string().min(1, "Conteúdo do arquivo não fornecido."),
});

export type SupplierFileUploadInput = z.infer<typeof supplierFileUploadInput>;

export const supplierFileListInput = z.object({
  supplierPublicId: z.string().uuid(),
  category: z.enum(supplierFileCategories).optional(),
  includeDeleted: z.boolean().optional().default(false),
});

export type SupplierFileListInput = z.infer<typeof supplierFileListInput>;

export const supplierFileDeleteInput = z.object({
  supplierPublicId: z.string().uuid(),
  filePublicId: z.string().uuid(),
});

export type SupplierFileDeleteInput = z.infer<typeof supplierFileDeleteInput>;

export type SupplierFileView = {
  publicId: string;
  supplierPublicId: string;
  fileName: string;
  category: SupplierFileCategory;
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

export function canManageSupplierFiles(role: OperationalRole): boolean {
  return role === "admin" || role === "manager";
}

export function formatActorName(name?: string | null): string {
  if (!name) return "Usuário indisponível";
  const trimmed = name.trim();
  if (!trimmed) return "Usuário indisponível";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return "Usuário indisponível";
  }
  return trimmed;
}
