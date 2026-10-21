import { TRPCError } from "@trpc/server";
import { isValidCpf, isValidCnpj } from "../../../../shared/br-documents";
import { normalizeContactPhone } from "../../../../shared/contact-phone";
import { findDuplicateCrmClient } from "../../../db-crm";
import * as repo from "./repository";
import type {
  LeadListInput,
  LeadCreateInput,
  LeadUpdateInput,
  LeadConvertInput,
  LeadView,
} from "./contracts";

function validateDocument(customerType: string | null | undefined, cpfCnpj: string | null | undefined) {
  if (!cpfCnpj) return;
  const cleaned = cpfCnpj.replace(/\D/g, "");
  if (!cleaned) return;
  if (customerType === "company" && !isValidCnpj(cleaned)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "CNPJ inválido." });
  }
  if (customerType === "person" && !isValidCpf(cleaned)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "CPF inválido." });
  }
}

export async function listLeads(
  clientId: string,
  input: LeadListInput
) {
  return repo.listLeads(clientId, input);
}

export async function getLeadsSummary(clientId: string) {
  return repo.getLeadsSummary(clientId);
}

export async function getLeadById(
  clientId: string,
  crmClientId: string
): Promise<LeadView> {
  const lead = await repo.getLeadById(clientId, crmClientId);
  if (!lead) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado." });
  }
  return lead;
}

export async function createLead(
  clientId: string,
  input: LeadCreateInput,
  actor: string
) {
  validateDocument(input.customerType, input.cpfCnpj);

  if (input.phone) {
    const p = normalizeContactPhone(input.phone);
    if (p.status === "invalid") {
      throw new TRPCError({ code: "BAD_REQUEST", message: p.reason });
    }
  }

  if (input.whatsapp) {
    const w = normalizeContactPhone(input.whatsapp);
    if (w.status === "invalid") {
      throw new TRPCError({ code: "BAD_REQUEST", message: w.reason });
    }
  }

  try {
    return await repo.createLead(clientId, input, actor);
  } catch (err: any) {
    if (err instanceof TRPCError) throw err;
    const msg = String(err?.message || "");
    if (msg.includes("Duplicate entry") || msg.includes("uq_mcc_tenant")) {
      throw new TRPCError({ code: "CONFLICT", message: "Cadastro com dado duplicado já existente." });
    }
    console.error("[CRM Leads] Falha inesperada ao cadastrar lead:", err);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível cadastrar o lead. Tente novamente." });
  }
}

export async function updateLead(
  clientId: string,
  input: LeadUpdateInput,
  actor: string
) {
  const existing = await getLeadById(clientId, input.crmClientId);
  const targetCustomerType = input.customerType ?? existing.customerType;
  const targetDoc = input.cpfCnpj !== undefined ? input.cpfCnpj : existing.cpfCnpj;
  validateDocument(targetCustomerType, targetDoc);

  // Check duplicate
  if (input.cpfCnpj || input.phone) {
    const duplicate = await findDuplicateCrmClient(
      clientId,
      { cpfCnpj: input.cpfCnpj, phone: input.phone },
      input.crmClientId
    );
    if (duplicate) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Já existe outro cadastro (${duplicate.companyName}) com estes dados.`,
      });
    }
  }

  try {
    await repo.updateLead(clientId, input.crmClientId, input, actor);
    return { success: true };
  } catch (err: any) {
    if (err instanceof TRPCError) throw err;
    const msg = String(err?.message || "");
    if (msg === "Lead não encontrado ou sem permissão.") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado." });
    }
    if (msg.includes("Duplicate entry") || msg.includes("uq_mcc_tenant")) {
      throw new TRPCError({ code: "CONFLICT", message: "Já existe outro cadastro com estes dados." });
    }
    console.error("[CRM Leads] Falha inesperada ao atualizar lead:", err);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível atualizar o lead. Tente novamente." });
  }
}

export async function convertLeadToClient(
  clientId: string,
  input: LeadConvertInput,
  actor: string
) {
  const existing = await getLeadById(clientId, input.crmClientId);

  if (existing.status === "ativo") {
    throw new TRPCError({ code: "CONFLICT", message: "Este lead já foi convertido em cliente ativo." });
  }

  const targetCustomerType = input.customerType ?? existing.customerType;
  const targetDoc = input.cpfCnpj ?? existing.cpfCnpj;
  validateDocument(targetCustomerType, targetDoc);

  if (input.cpfCnpj) {
    const duplicate = await findDuplicateCrmClient(
      clientId,
      { cpfCnpj: input.cpfCnpj },
      input.crmClientId
    );
    if (duplicate) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Já existe um cliente ativo (${duplicate.companyName}) com este documento.`,
      });
    }
  }

  try {
    return await repo.convertLeadToClient(clientId, input, actor);
  } catch (err: any) {
    if (err instanceof TRPCError) throw err;
    const msg = String(err?.message || "");
    if (msg === "Este lead já foi convertido em cliente ativo.") {
      throw new TRPCError({ code: "CONFLICT", message: msg });
    }
    if (msg === "Lead não encontrado ou sem permissão.") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado." });
    }
    if (msg.startsWith("Falha na conversão concorrente")) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Este lead foi alterado por outra requisição concorrente. Atualize a página e tente novamente.",
      });
    }
    if (msg.startsWith("Este lead não pode ser convertido")) {
      throw new TRPCError({ code: "BAD_REQUEST", message: msg });
    }
    console.error("[CRM Leads] Falha inesperada ao converter lead:", err);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível converter o lead. Tente novamente." });
  }
}

export async function getLeadTimeline(
  clientId: string,
  crmClientId: string
) {
  await getLeadById(clientId, crmClientId);
  return repo.getLeadTimeline(clientId, crmClientId);
}

export async function addLeadTimelineNote(
  clientId: string,
  crmClientId: string,
  note: string,
  actor: string
) {
  if (!note || !note.trim()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Nota não pode ser vazia." });
  }
  try {
    await repo.addLeadTimelineNote(clientId, crmClientId, note.trim(), actor);
    return { success: true };
  } catch (err: any) {
    if (err instanceof TRPCError) throw err;
    if (err?.message === "Lead não encontrado ou sem permissão.") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado." });
    }
    console.error("[CRM Leads] Falha inesperada ao adicionar nota:", err);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível registrar a nota na linha do tempo." });
  }
}
