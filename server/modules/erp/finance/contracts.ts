import { z } from "zod";
import type { OperationalRole } from "../contracts";

export const financeDirections = ["payable", "receivable"] as const;
export const financeStatuses = ["open", "settled", "cancelled"] as const;
export const categoryDirections = [...financeDirections, "both"] as const;
export const sourceTypes = ["manual", "purchase_order", "sales_order"] as const;
export type FinanceDirection = (typeof financeDirections)[number];
export type FinanceStatus = (typeof financeStatuses)[number];
export type FinanceOperation = "created" | "updated" | "settled" | "cancelled" | "activated" | "deactivated";
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform(v => v || null);
const publicId = z.string().uuid();
const date = z.string().date();
export const accountInput = z.object({ name: z.string().trim().min(2).max(180), type: z.enum(["cash", "bank"]), initialBalanceCents: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER), allowNegative: z.boolean().default(false) }).refine(v=>v.allowNegative||v.initialBalanceCents>=0,{message:"Saldo inicial negativo exige permissão de saldo negativo.",path:["initialBalanceCents"]});
export const categoryInput = z.object({ name: z.string().trim().min(2).max(180), direction: z.enum(categoryDirections) });
export const manualEntryInput = z.object({
  documentNumber: z.string().trim().min(1).max(80), direction: z.enum(financeDirections), description: z.string().trim().min(2).max(500),
  amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), dueDate: date, issueDate: date, categoryPublicId: publicId,
  financialAccountPublicId: publicId.optional().nullable(), supplierPublicId: publicId.optional().nullable(), crmClientId: z.string().trim().max(80).optional().nullable(),
  partyName: optionalText(255), notes: optionalText(4_000),
});
export const sourceEntryInput = z.object({ sourcePublicId: publicId, dueDate: date, categoryPublicId: publicId, financialAccountPublicId: publicId.optional().nullable(), notes: optionalText(4_000) });
export const updateEntryInput = z.object({ publicId, description: z.string().trim().min(2).max(500), dueDate: date, categoryPublicId: publicId, financialAccountPublicId: publicId.optional().nullable(), notes: optionalText(4_000) });
export const settlementInput = z.object({ publicId, financialAccountPublicId: publicId, idempotencyKey: publicId });
export const cancelEntryInput = z.object({ publicId, reason: z.string().trim().min(3).max(500) });
export const financeListInput = z.object({
  search: z.string().trim().max(180).default(""), direction: z.enum(financeDirections).optional(), status: z.enum(financeStatuses).optional(), overdue: z.boolean().optional(),
  issueFrom: date.optional(), issueTo: date.optional(), dueFrom: date.optional(), dueTo: date.optional(), categoryPublicId: publicId.optional(), financialAccountPublicId: publicId.optional(),
  supplierPublicId: publicId.optional(), crmClientId: z.string().trim().max(80).optional(), sourceType: z.enum(sourceTypes).optional(),
  sort: z.enum(["dueDate", "issueDate", "amount", "documentNumber"]).default("dueDate"), directionSort: z.enum(["asc", "desc"]).default("asc"),
  page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(20),
});
export const periodInput = z.object({ from: date.optional(), to: date.optional() });
export type AccountInput = z.infer<typeof accountInput>;
export type CategoryInput = z.infer<typeof categoryInput>;
export type ManualEntryInput = z.infer<typeof manualEntryInput>;
export type SourceEntryInput = z.infer<typeof sourceEntryInput>;
export type UpdateEntryInput = z.infer<typeof updateEntryInput>;
export type FinanceListInput = z.infer<typeof financeListInput>;
export const canReadFinance = (role: OperationalRole) => role === "admin" || role === "manager" || role === "viewer";
export const canWriteFinance = (role: OperationalRole) => role === "admin" || role === "manager";
export const isOverdue = (status: FinanceStatus, dueDate: string, today = new Date().toISOString().slice(0, 10)) => status === "open" && dueDate < today;
export const signedSettlementAmount = (direction: FinanceDirection, amountCents: number) => direction === "payable" ? -amountCents : amountCents;
export const financeEvent = (publicId: string, operation: FinanceOperation, occurredAt = new Date().toISOString()) => ({ publicId, operation, occurredAt });
