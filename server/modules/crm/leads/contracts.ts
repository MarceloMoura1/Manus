import { z } from "zod";
import { CUSTOMER_TYPES } from "../../../../shared/crm";

export const leadOriginValues = [
  "whatsapp",
  "instagram",
  "facebook",
  "site",
  "indicacao",
  "outro",
] as const;
export type LeadOrigin = (typeof leadOriginValues)[number];

export const leadStatusValues = [
  "lead",
  "ativo",
  "inativo",
  "cancelado",
] as const;
export type LeadStatus = (typeof leadStatusValues)[number];

export const leadContactItemSchema = z.object({
  name: z.string().trim().max(180).optional().default(""),
  role: z.string().trim().max(80).optional().default(""),
  phone: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.string().max(40).optional().default("")
  ),
  whatsapp: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.string().max(40).optional().default("")
  ),
  email: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.union([z.literal(""), z.string().email("E-mail inválido.").max(255)]).optional().default("")
  ),
  description: z.string().trim().max(255).optional().default(""),
});

export type LeadContactItem = z.infer<typeof leadContactItemSchema>;

export const leadListInputSchema = z.object({
  search: z.string().trim().optional(),
  origin: z.enum(leadOriginValues).optional(),
  status: z.enum(leadStatusValues).optional().default("lead"),
  internalResponsible: z.string().trim().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inicial inválida (AAAA-MM-DD).").optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data final inválida (AAAA-MM-DD).").optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type LeadListInput = z.infer<typeof leadListInputSchema>;

export const leadCreateInputSchema = z.object({
  companyName: z.string().trim().min(1, "Nome ou Razão Social é obrigatório.").max(255),
  customerType: z.enum(CUSTOMER_TYPES).default("company"),
  responsibleName: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.string().max(180).optional().default("")
  ),
  cpfCnpj: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.string().max(20).optional().default("")
  ),
  phone: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.string().max(40).optional().default("")
  ),
  whatsapp: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.string().max(40).optional().default("")
  ),
  email: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.union([z.literal(""), z.string().email("E-mail inválido.").max(255)]).optional().default("")
  ),
  origin: z.enum(leadOriginValues).default("outro"),
  internalResponsible: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.string().max(180).optional().default("")
  ),
  tags: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.string().max(500).optional().default("")
  ),
  observations: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.string().max(5000).optional().default("")
  ),
  contacts: z.array(leadContactItemSchema).optional().default([]),
});

export type LeadCreateInput = z.infer<typeof leadCreateInputSchema>;

export const leadUpdateInputSchema = z.object({
  crmClientId: z.string().trim().min(1, "Identificador do lead é obrigatório.").max(80),
  companyName: z.string().trim().min(1, "Nome ou Razão Social é obrigatório.").max(255).optional(),
  customerType: z.enum(CUSTOMER_TYPES).optional(),
  responsibleName: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.string().max(180).optional()
  ),
  cpfCnpj: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.string().max(20).optional()
  ),
  phone: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.string().max(40).optional()
  ),
  whatsapp: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.string().max(40).optional()
  ),
  email: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.union([z.literal(""), z.string().email("E-mail inválido.").max(255)]).optional()
  ),
  origin: z.enum(leadOriginValues).optional(),
  internalResponsible: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.string().max(180).optional()
  ),
  tags: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.string().max(500).optional()
  ),
  observations: z.preprocess(
    val => (val === undefined || val === null ? "" : typeof val === "string" ? val.trim() : val),
    z.string().max(5000).optional()
  ),
  contacts: z.array(leadContactItemSchema).optional(),
});

export type LeadUpdateInput = z.infer<typeof leadUpdateInputSchema>;

export const leadConvertInputSchema = z.object({
  crmClientId: z.string().trim().min(1, "Identificador do lead é obrigatório.").max(80),
  customerType: z.enum(CUSTOMER_TYPES).optional(),
  cpfCnpj: z.preprocess(
    val => (val === undefined || val === null ? undefined : typeof val === "string" ? val.trim() : val),
    z.string().max(20).optional()
  ),
  companyName: z.string().trim().min(1).max(255).optional(),
  responsibleName: z.string().trim().max(180).optional(),
  notes: z.string().trim().max(500).optional(),
});

export type LeadConvertInput = z.infer<typeof leadConvertInputSchema>;

export type LeadView = {
  crmClientId: string;
  customerType: (typeof CUSTOMER_TYPES)[number] | null;
  companyName: string;
  responsibleName: string;
  cpfCnpj: string | null;
  phone: string | null;
  whatsapp: string;
  email: string | null;
  status: string;
  origin: LeadOrigin;
  internalResponsible: string;
  tags: string;
  observations: string;
  contacts: LeadContactItem[];
  createdAt: string;
  updatedAt: string;
};
