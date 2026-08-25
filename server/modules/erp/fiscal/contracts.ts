import { createHash } from "node:crypto";
import { z } from "zod";
import type { OperationalRole } from "../contracts";
export const fiscalDocumentTypes = ["sale", "purchase", "manual"] as const;
export const fiscalDocumentStatuses = [
  "draft",
  "ready_for_integration",
  "cancelled",
] as const;
export type FiscalOperation =
  | "created"
  | "updated"
  | "ready_for_integration"
  | "cancelled";
const digits = (length: number) =>
  z
    .string()
    .trim()
    .transform(v => v.replace(/\D/g, ""))
    .refine(v => !v || v.length === length, `Informe ${length} dígitos.`)
    .optional()
    .nullable()
    .transform(v => v || null);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => v || null);
const publicId = z.string().uuid(),
  date = z.string().date(),
  key = z.string().uuid();
export const fiscalSettingsInput = z.object({
  taxRegime: z.enum([
    "mei",
    "simples_nacional",
    "lucro_presumido",
    "lucro_real",
    "other",
  ]),
  taxpayerIndicator: z.enum(["taxpayer", "exempt", "non_taxpayer"]),
  stateRegistration: text(30),
  municipalRegistration: text(30),
  mainCnae: digits(7),
  ibgeCityCode: digits(7),
  environment: z.enum(["homologation", "production"]),
  provider: z.literal("none").default("none"),
});
export const productFiscalProfileInput = z.object({
  productPublicId: publicId,
  ncm: digits(8),
  cest: digits(7),
  defaultOutboundCfop: digits(4),
  defaultInboundCfop: digits(4),
  goodsOrigin: digits(1),
  fiscalUnit: z
    .string()
    .trim()
    .min(1)
    .max(12)
    .transform(v => v.toUpperCase()),
  gtin: z
    .string()
    .trim()
    .regex(/^\d{8,14}$/)
    .optional()
    .nullable()
    .transform(v => v || null),
  serviceCode: text(20),
  operationNature: text(120),
  internalNotes: text(4000),
});
export const sourceDocumentInput = z.object({
  type: z.enum(["sale", "purchase"]),
  sourcePublicId: publicId,
  internalIssueDate: date,
  internalNotes: text(4000),
  idempotencyKey: key,
});
export const manualDocumentInput = z.object({
  internalIssueDate: date,
  partyName: z.string().trim().min(2).max(255),
  partyDocument: text(30),
  internalNotes: text(4000),
  idempotencyKey: key,
  items: z
    .array(
      z.object({
        productPublicId: publicId.optional().nullable(),
        name: z.string().trim().min(2).max(180),
        sku: text(80),
        quantityMillis: z.number().int().positive(),
        unitAmountCents: z.number().int().nonnegative(),
      })
    )
    .min(1)
    .max(200),
});
export const updateDraftInput = z.object({
    publicId,
    internalIssueDate: date,
    internalNotes: text(4000),
  }),
  readyInput = z.object({ publicId, idempotencyKey: key }),
  cancelInput = z.object({
    publicId,
    reason: z.string().trim().min(3).max(500),
  });
export const fiscalListInput = z.object({
  type: z.enum(fiscalDocumentTypes).optional(),
  status: z.enum(fiscalDocumentStatuses).optional(),
  source: z.enum(["with_source", "manual"]).optional(),
  from: date.optional(),
  to: date.optional(),
  search: z.string().trim().max(180).default(""),
  sort: z
    .enum(["issueDate", "number", "createdAt", "total"])
    .default("issueDate"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export type FiscalSettingsInput = z.infer<typeof fiscalSettingsInput>;
export type ProductFiscalProfileInput = z.infer<
  typeof productFiscalProfileInput
>;
export type SourceDocumentInput = z.infer<typeof sourceDocumentInput>;
export type ManualDocumentInput = z.infer<typeof manualDocumentInput>;
export type UpdateDraftInput = z.infer<typeof updateDraftInput>;
export type FiscalListInput = z.infer<typeof fiscalListInput>;
export const canReadFiscal = (role: OperationalRole) =>
    role === "admin" || role === "manager" || role === "viewer",
  canWriteFiscal = (role: OperationalRole) =>
    role === "admin" || role === "manager";
export const settingsStatus = (x: FiscalSettingsInput) =>
  x.mainCnae && x.ibgeCityCode
    ? ("ready_for_integration" as const)
    : ("incomplete" as const);
export const productFiscalCompleteness = (x: ProductFiscalProfileInput) =>
  x.ncm && x.defaultOutboundCfop && x.defaultInboundCfop && x.fiscalUnit
    ? ("complete" as const)
    : ("incomplete" as const);
export const fiscalEvent = (
  publicId: string,
  operation: FiscalOperation,
  occurredAt = new Date().toISOString()
) => ({ publicId, operation, occurredAt });
export const payloadHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const internalFiscalNumber = (year: number, number: number) =>
  `FIS-${year}-${String(number).padStart(6, "0")}`;
