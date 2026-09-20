import { z } from "zod";
import type { OperationalRole } from "../contracts";
import { isValidCpf, isValidCnpj } from "@shared/br-documents";

export const supplierPersonTypes = ["legal", "individual"] as const;
export const supplierPublicId = z.string().uuid();
const optionalText = (max: number) => z.string().trim().max(max).optional().transform(value => value || null);
const optionalEmail = z.string().trim().max(254).optional().transform(value => value || null);

export const supplierInput = z.object({
  legalName: z.string().trim().max(180),
  tradeName: optionalText(180),
  personType: z.enum(supplierPersonTypes),
  taxId: z.string().trim().max(24).optional().transform(value => value || null),
  stateRegistration: optionalText(40),
  email: optionalEmail,
  phone: optionalText(30),
  contactName: optionalText(120),
  postalCode: z.string().trim().max(12).optional().transform(value => value || null),
  street: optionalText(180),
  addressNumber: optionalText(30),
  addressComplement: optionalText(120),
  district: optionalText(120),
  city: optionalText(120),
  state: z.string().trim().max(2).optional().transform(value => value || null),
  notes: optionalText(4_000),
}).superRefine((value, context) => {
  const taxId = normalizeTaxId(value.taxId);
  if (value.personType === "legal") {
    if (!value.legalName || value.legalName.trim().length < 2) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["legalName"], message: "Informe a razão social." });
    }
    if (!value.tradeName || value.tradeName.trim().length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["tradeName"], message: "Informe o nome fantasia." });
    }
    if (!taxId || !isValidCnpj(taxId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["taxId"], message: "CNPJ inválido." });
    }
  } else {
    if (!value.legalName || value.legalName.trim().length < 2) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["legalName"], message: "Informe o nome completo." });
    }
    if (!taxId || !isValidCpf(taxId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["taxId"], message: "CPF inválido." });
    }
  }

  const hasPhone = Boolean(value.phone && value.phone.trim().length > 0);
  const hasEmail = Boolean(value.email && value.email.trim().length > 0);
  if (!hasPhone && !hasEmail) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["phone"], message: "Informe pelo menos um telefone ou e-mail." });
  }

  if (value.email && value.email.trim().length > 0) {
    const emailResult = z.string().email().safeParse(value.email.trim());
    if (!emailResult.success) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "E-mail inválido." });
    }
  }

  if (value.state && !/^[A-Za-z]{2}$/.test(value.state.trim())) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["state"], message: "UF deve conter duas letras." });
  }

  const postalCode = normalizeDigits(value.postalCode);
  if (postalCode && postalCode.length !== 8) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["postalCode"], message: "CEP deve conter 8 dígitos." });
  }
});

export const supplierListInput = z.object({
  search: z.string().trim().max(180).default(""), active: z.boolean().optional(), city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(2).optional().transform(value => value ? value.toUpperCase() : undefined),
  sort: z.enum(["legalName", "createdAt"]).default("legalName"), direction: z.enum(["asc", "desc"]).default("asc"),
  page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(20),
});

export type SupplierInput = z.infer<typeof supplierInput>;
export type SupplierListInput = z.infer<typeof supplierListInput>;
export type SupplierOperation = "created" | "updated" | "activated" | "deactivated";
export type SupplierEvent = { publicId: string; operation: SupplierOperation; occurredAt: string };
export function normalizeDigits(value: string | null | undefined): string | null { const digits = value?.replace(/\D/g, "") ?? ""; return digits || null; }
export function normalizeTaxId(value: string | null | undefined): string | null { return normalizeDigits(value); }
export function normalizeEmail(value: string | null | undefined): string | null { const email = value?.trim().toLowerCase() ?? ""; return email || null; }
export function normalizeOptionalText(value: string | null | undefined): string | null { const text = value?.trim().replace(/\s+/g, " ") ?? ""; return text || null; }
export function normalizeSupplierInput(input: SupplierInput): SupplierInput { return { ...input, legalName: input.legalName.trim().replace(/\s+/g, " "), tradeName: normalizeOptionalText(input.tradeName), taxId: normalizeTaxId(input.taxId), stateRegistration: normalizeOptionalText(input.stateRegistration), email: normalizeEmail(input.email), phone: normalizeOptionalText(input.phone), contactName: normalizeOptionalText(input.contactName), postalCode: normalizeDigits(input.postalCode), street: normalizeOptionalText(input.street), addressNumber: normalizeOptionalText(input.addressNumber), addressComplement: normalizeOptionalText(input.addressComplement), district: normalizeOptionalText(input.district), city: normalizeOptionalText(input.city), state: input.state?.trim().toUpperCase() || null, notes: input.notes?.trim() || null }; }
export function canWriteSuppliers(role: OperationalRole): boolean { return role === "admin" || role === "manager"; }
export function supplierEvent(publicId: string, operation: SupplierOperation, occurredAt = new Date().toISOString()): SupplierEvent { return { publicId, operation, occurredAt }; }
