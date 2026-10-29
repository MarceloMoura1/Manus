/**
 * Gemini IA Client — por cliente
 * Usa fetch HTTP direto para a API Gemini (mais compatível com ambientes de deploy).
 * Mantém histórico de conversa no banco de dados.
 * Suporta function calling para consultar dados do ERP/conversas/chamados.
 */
import dns from "node:dns";
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {}

import { getPool, getUserHermesPreferences, saveUserHermesPreferences, type UserHermesPreferences } from "./db";
import { nanoid } from "nanoid";
import { dropEmptyArgs } from "./hermes-sanitize";
import { evoGetStatus } from "./evolution/client";
import { instanceNameFor } from "./evolution/session-store";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_MODEL = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
export const MAX_GEMINI_PROMPT_HISTORY_MESSAGES = 6;
export const GEMINI_REQUEST_TIMEOUT_MS = 35_000;

function normalizeGeminiApiKey(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getEnvironmentGeminiApiKey(): string | null {
  return normalizeGeminiApiKey(process.env.GEMINI_API_KEY);
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface IAMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
  pendingActionRequest?: PendingActionRequest;
}

export function serializeMessageForPrompt(msg: IAMessage): IAMessage {
  let content = msg.content;
  if (msg.role === "assistant" && msg.pendingActionRequest) {
    const action = msg.pendingActionRequest;
    if (action.actionType === "CREATE_PROPOSAL") {
      const clientName = String(action.args.clientName ?? action.args.clientId ?? "Cliente");
      let items = Array.isArray(action.args.items)
        ? (action.args.items as Array<Record<string, unknown>>)
            .map(it => `${Number(it.quantity ?? 1)}x ${String(it.productName ?? it.description ?? "Item")} (R$ ${Number(it.unitPrice ?? 0).toFixed(2).replace(".", ",")})`)
            .join(", ")
        : "";
      if (items.length > 300) {
        items = `${items.slice(0, 297)}...`;
      }
      const proposalContext = `[Proposta em rascunho anterior: Cliente: ${clientName}, Itens: ${items || "Nenhum"}].`;
      content = content ? `${content}\n\n${proposalContext}` : proposalContext;
    } else if (action.summary) {
      let summary = action.summary;
      if (summary.length > 300) {
        summary = `${summary.slice(0, 297)}...`;
      }
      content = content ? `${content}\n\n[Ação anterior: ${summary}]` : `[Ação anterior: ${summary}]`;
    }
  }

  // Sanitize: Nas mensagens anteriores enviadas ao Gemini, trunque saídas de ferramentas que contenham listas grandes para no máximo 300 caracteres
  if (msg.role === "assistant" && content && content.length > 300) {
    const hasLargeListOrToolData =
      /[\n\r]\s*[-*•\d]/.test(content) ||
      content.startsWith("{") ||
      content.startsWith("[") ||
      content.includes("[Ação anterior:") ||
      content.includes("[Proposta em rascunho anterior:");
    if (hasLargeListOrToolData) {
      content = `${content.slice(0, 297)}...`;
    }
  }

  return { ...msg, content };
}

/** Seleciona apenas a janela recente enviada ao provedor, enriquecendo o contexto de propostas/ações anteriores. */
export function selectGeminiPromptHistory(history: readonly IAMessage[]): IAMessage[] {
  return history.slice(-MAX_GEMINI_PROMPT_HISTORY_MESSAGES).map(serializeMessageForPrompt);
}

/**
 * Detecta se a mensagem é puramente conversacional/saudação, sem intenção operacional.
 * Permite fast-path (< 1.5s) enviando tools: undefined ao Gemini.
 */
export function isConversationalGreeting(message: string): boolean {
  if (!message || typeof message !== "string") return false;
  const clean = message.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Se a mensagem mencionar entidades ou ações de negócio, NÃO é puramente conversacional
  const businessPattern = /\b(chamad|ticket|suport|atendiment|client|crm|lead|propost|orcament|cotac|prec|cust|valor|vend|fatur|produt|servic|estoqu|inventari|sku|forneced|compr|pedid|regra|prefer|nome|chame|estilo|whatsapp|zap|convers|busc|consult|list|relatori|cadastr|cri|atualiz|alter|delet|remov|status|cancel|aprov|fech|abert)/i;
  if (businessPattern.test(clean)) {
    return false;
  }

  // Padrões de saudações, despedidas e gentilezas cotidianas
  const conversationalPhrases = [
    /^(ol[a|e]|oi[e]?|hey|hello|hi)\b/,
    /^(bom dia|boa tarde|boa noite)\b/,
    /\b(tudo bem|tudo bom|como vai|como voce esta|como esta|e ai)\b/,
    /\b(quem e voce|o que voce faz|quem e vc|qual o seu papel|ajuda|help)\b/,
    /\b(obrigad[oa]|valeu|agradecid[oa]|tks|thanks|gratidao)\b/,
    /\b(tchau|ate logo|ate mais|ate breve|falou)\b/,
    /\b(ok|beleza|entendi|perfeito|certo|show)\b/,
  ];

  return conversationalPhrases.some(pattern => pattern.test(clean));
}

/** Identifica consultas operacionais que exigem uma leitura antes da resposta. */
export function requiredBusinessReadTool(message: string): "get_suppliers_list" | "get_whatsapp_status" | null {
  const normalized = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/\b(whatsapp|whats|zap|evolution)\b/.test(normalized)
    && /\b(status|conex[a-z]*|instanc[a-z]*|conectad[a-z]*|desconectad[a-z]*|online|offline)\b/.test(normalized)) {
    return "get_whatsapp_status";
  }
  if (/\b(fornecedor[a-z]*|supplier[a-z]*)\b/.test(normalized)
    && /\b(quais|qual|listar|liste|lista|consultar|consulta|buscar|busque|cadastrad[a-z]*|temos|mostre|mostrar|contato[a-z]*|telefone[a-z]*)\b/.test(normalized)
    && !/\b(criar|crie|cadastrar|cadastre|atualizar|atualize|enviar|envie)\b/.test(normalized)) {
    return "get_suppliers_list";
  }
  return null;
}

function asksForBusinessData(message: string): boolean {
  const normalized = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\b(meu|meus|minha|minhas|nosso|nossos|nossa|nossas|qual|quais|quanto|quantos|quantas|liste|listar|mostre|mostrar|exiba|saldo|status|cadastrad[a-z]*|temos)\b/.test(normalized)
    && /\b(client[a-z]*|forneced[a-z]*|produt[a-z]*|estoqu[a-z]*|propost[a-z]*|orcament[a-z]*|chamad[a-z]*|contato[a-z]*|whatsapp|venda[a-z]*|faturament[a-z]*|receita[a-z]*|pedid[a-z]*|servic[a-z]*)\b/.test(normalized);
}

export interface ChatResult {
  ok: boolean;
  response: string;
  tokensUsed: number;
  conversationId: string;
  functionCallsMade?: string[];
  pendingActionRequest?: PendingActionRequest;
}

export type HermesToolType = "READ" | "MUTATION";
export type HermesPermission = string;
export type HermesTicketActionType = "CREATE_TICKET" | "UPDATE_TICKET_STATUS" | "ASSIGN_TICKET" | "ADD_TICKET_ACTIVITY";
export type HermesCrmActionType = "CREATE_CLIENT" | "UPDATE_CLIENT" | "ADD_CLIENT_TIMELINE" | "CREATE_PROPOSAL" | "UPDATE_PROPOSAL_STATUS" | "SEND_PROPOSAL_WHATSAPP";
export type HermesErpActionType = "CREATE_PRODUCT" | "UPDATE_PRODUCT" | "LINK_PRODUCT_SUPPLIER" | "UPDATE_SERVICE" | "CREATE_SERVICE" | "CREATE_SUPPLIER" | "UPDATE_SUPPLIER" | "REQUEST_PURCHASE" | "SEND_SUPPLIER_MESSAGE";
export type HermesActionType = HermesTicketActionType | HermesCrmActionType | HermesErpActionType;

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: { type: "OBJECT"; properties: Record<string, unknown>; required: string[] };
}

/**
 * Sanitiza e blinda a declaração de função para a API REST do Gemini (OpenAPI schema subset).
 * Garante que:
 * 1. Todos os tipos sejam em maiúsculas (OBJECT, ARRAY, STRING, NUMBER, BOOLEAN, INTEGER).
 * 2. Toda propriedade com type: "ARRAY" possua items definido validamente.
 * 3. Todo objeto aninhado possua properties válido.
 */
export function sanitizeFunctionDeclaration(declaration: GeminiFunctionDeclaration): GeminiFunctionDeclaration {
  const clone = JSON.parse(JSON.stringify(declaration)) as GeminiFunctionDeclaration;

  const sanitizeSchemaNode = (node: any) => {
    if (!node || typeof node !== "object") return;

    if (typeof node.type === "string") {
      node.type = node.type.toUpperCase();
    }

    if (node.type === "ARRAY") {
      if (!node.items || typeof node.items !== "object") {
        node.items = { type: "STRING" };
      } else {
        sanitizeSchemaNode(node.items);
      }
    }

    if (node.type === "OBJECT") {
      if (!node.properties || typeof node.properties !== "object") {
        node.properties = {};
      } else {
        for (const child of Object.values(node.properties)) {
          sanitizeSchemaNode(child);
        }
      }
    }
  };

  sanitizeSchemaNode(clone.parameters);
  return clone;
}

export interface HermesToolDefinition {
  name: string;
  type: HermesToolType;
  requiredPermissions: readonly HermesPermission[];
  declaration: GeminiFunctionDeclaration;
  validateArgs: (args: Record<string, unknown>) => Record<string, unknown>;
  actionType?: HermesActionType;
}

export interface PendingActionRequest {
  id: string;
  toolName: string;
  type: "MUTATION";
  actionType: HermesActionType;
  args: Record<string, unknown>;
  status: "PENDING_APPROVAL";
  /** Descrição amigável exibida no card de aprovação (HITL). */
  summary: string;
}

type PendingActionOwner = { clientId: string; userId: string };
type StoredPendingAction = PendingActionRequest & PendingActionOwner & {
  expiresAt: number;
  state: "PENDING_APPROVAL" | "EXECUTING";
};

type SqlExecutor = (sql: string, values: unknown[]) => Promise<unknown>;

const noArguments = (args: Record<string, unknown>): Record<string, unknown> => {
  if (Object.keys(args).length > 0) {
    throw new Error("A ferramenta não aceita parâmetros.");
  }
  return {};
};

const HERMES_ACTION_TTL_MS = 10 * 60 * 1_000;
const pendingActions = new Map<string, StoredPendingAction>();

function objectArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (!args || Array.isArray(args)) throw new Error("Parâmetros de ferramenta inválidos.");
  return args;
}

function stringArg(args: Record<string, unknown>, key: string, options: { min?: number; max?: number; optional?: boolean } = {}): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    if (options.optional) return undefined;
    throw new Error(`Parâmetro obrigatório ausente: ${key}.`);
  }
  if (typeof value !== "string") throw new Error(`Parâmetro inválido: ${key}.`);
  const normalized = value.trim();
  if ((options.min ?? 1) > normalized.length || normalized.length > (options.max ?? 2_000)) {
    throw new Error(`Tamanho inválido para ${key}.`);
  }
  return normalized;
}

function enumArg<T extends readonly string[]>(args: Record<string, unknown>, key: string, allowed: T): T[number] {
  const value = stringArg(args, key, { max: 80 });
  if (!value || !allowed.includes(value)) throw new Error(`Valor inválido para ${key}.`);
  return value as T[number];
}

function optionalLimit(args: Record<string, unknown>): number | undefined {
  if (args.limit === undefined) return undefined;
  const value = Number(args.limit);
  if (!Number.isInteger(value) || value < 1 || value > 20) throw new Error("limit deve ser um inteiro entre 1 e 20.");
  return value;
}

function rejectUnknownArgs(args: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error("Parâmetros não permitidos para esta ferramenta.");
}

function openTicketsArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args);
  rejectUnknownArgs(args, ["search", "ticketNumber"]);
  const search = stringArg(args, "search", { min: 1, max: 180, optional: true });
  const rawNum = args.ticketNumber !== undefined ? Number(args.ticketNumber) : undefined;
  const ticketNumber = rawNum !== undefined && Number.isFinite(rawNum) ? rawNum : undefined;
  return {
    ...(search ? { search } : {}),
    ...(ticketNumber !== undefined ? { ticketNumber } : {}),
  };
}

function ticketOverviewArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["status", "search", "limit"]);
  const status = args.status === undefined ? undefined : enumArg(args, "status", ["open", "in_progress", "pending", "waiting", "resolved", "closed"] as const);
  const search = stringArg(args, "search", { min: 1, max: 180, optional: true });
  const limit = optionalLimit(args);
  return { ...(status ? { status } : {}), ...(search ? { search } : {}), ...(limit ? { limit } : {}) };
}

function webSearchArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["query", "focus"]);
  const query = stringArg(args, "query", { min: 2, max: 500 })!;
  const focus = stringArg(args, "focus", { min: 2, max: 120, optional: true });
  return { query, ...(focus ? { focus } : {}) };
}

function ticketDetailsArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["ticketId", "ticketNumber"]);
  const ticketId = stringArg(args, "ticketId", { min: 1, max: 80, optional: true });
  const rawNum = args.ticketNumber;
  const ticketNumber = (rawNum !== undefined && rawNum !== null && String(rawNum).trim())
    ? (!isNaN(Number(rawNum)) ? Number(rawNum) : String(rawNum).trim())
    : undefined;
  if (!ticketId && ticketNumber === undefined) throw new Error("Informe ticketId ou ticketNumber.");
  return {
    ...(ticketId ? { ticketId } : {}),
    ...(ticketNumber !== undefined ? { ticketNumber } : {}),
  };
}

function createTicketArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["title", "description", "priority", "clientNameOuId", "customer", "category"]);
  const customer = stringArg(args, "customer", { min: 1, max: 180, optional: true })
    ?? stringArg(args, "clientNameOuId", { min: 1, max: 180, optional: true });
  if (!customer) throw new Error("Parâmetro obrigatório ausente: customer.");
  return {
    title: stringArg(args, "title", { min: 1, max: 500 })!,
    description: stringArg(args, "description", { min: 0, max: 2_000, optional: true }) ?? "",
    priority: args.priority ? enumArg(args, "priority", ["low", "medium", "high", "urgent"] as const) : "medium",
    customer,
    clientNameOuId: customer,
    category: stringArg(args, "category", { min: 1, max: 120, optional: true }) ?? "suporte",
  };
}

function updateTicketStatusArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["ticketId", "ticketNumber", "newStatus", "resolutionNote", "resolutionNotes"]);
  const rawId = stringArg(args, "ticketId", { min: 1, max: 80, optional: true })
    ?? (args.ticketNumber !== undefined && args.ticketNumber !== null ? String(args.ticketNumber).trim() : undefined);
  if (!rawId) throw new Error("Informe ticketId ou ticketNumber.");
  const note = stringArg(args, "resolutionNote", { min: 0, max: 2_000, optional: true })
    ?? stringArg(args, "resolutionNotes", { min: 0, max: 2_000, optional: true });
  return {
    ticketId: rawId,
    ticketNumber: args.ticketNumber !== undefined ? args.ticketNumber : (!isNaN(Number(rawId)) ? Number(rawId) : undefined),
    newStatus: enumArg(args, "newStatus", ["open", "in_progress", "pending", "resolved", "closed", "waiting"] as const),
    ...(note ? { resolutionNote: note, resolutionNotes: note } : {}),
  };
}

function assignTicketArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["ticketId", "ticketNumber", "assigneeNameOuId", "operatorName", "operatorId", "transferReason", "reason"]);
  const rawId = stringArg(args, "ticketId", { min: 1, max: 80, optional: true })
    ?? (args.ticketNumber !== undefined && args.ticketNumber !== null ? String(args.ticketNumber).trim() : undefined);
  if (!rawId) throw new Error("Informe ticketId ou ticketNumber.");
  const operator = stringArg(args, "operatorName", { min: 1, max: 180, optional: true })
    ?? stringArg(args, "operatorId", { min: 1, max: 80, optional: true })
    ?? stringArg(args, "assigneeNameOuId", { min: 1, max: 180, optional: true });
  if (!operator) throw new Error("Informe operatorName, operatorId ou assigneeNameOuId.");
  const reason = stringArg(args, "reason", { min: 0, max: 2_000, optional: true })
    ?? stringArg(args, "transferReason", { min: 0, max: 2_000, optional: true });
  return {
    ticketId: rawId,
    ticketNumber: args.ticketNumber !== undefined ? args.ticketNumber : (!isNaN(Number(rawId)) ? Number(rawId) : undefined),
    operatorName: operator,
    assigneeNameOuId: operator,
    ...(reason ? { reason, transferReason: reason } : {}),
  };
}

function addTicketActivityArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["ticketId", "noteContent", "isInternal"]);
  if (args.isInternal !== undefined && typeof args.isInternal !== "boolean") throw new Error("isInternal deve ser booleano.");
  return {
    ticketId: stringArg(args, "ticketId", { min: 1, max: 80 })!,
    noteContent: stringArg(args, "noteContent", { min: 1, max: 2_000 })!,
    isInternal: args.isInternal === true,
  };
}

function crmSummaryArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["period"]);
  const period = args.period === undefined ? undefined : enumArg(args, "period", ["today", "month", "year"] as const);
  return { ...(period ? { period } : {}) };
}

function crmClientLookupArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["clientId", "search"]);
  const clientId = stringArg(args, "clientId", { min: 1, max: 80, optional: true });
  const search = stringArg(args, "search", { min: 1, max: 180, optional: true });
  if (!clientId && !search) throw new Error("Informe clientId ou search.");
  return { ...(clientId ? { clientId } : {}), ...(search ? { search } : {}) };
}

function createClientArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); args = dropEmptyArgs(args);
  if (typeof args.companyName === "string" && !args.name) args.name = args.companyName;
  if (typeof args.clientName === "string" && !args.name) args.name = args.clientName;
  rejectUnknownArgs(args, ["name", "document", "phone", "email", "notes"]);
  const rawEmail = stringArg(args, "email", { min: 1, max: 255, optional: true });
  const email = rawEmail && /^\S+@\S+\.\S+$/.test(rawEmail) ? rawEmail : undefined;
  return {
    name: stringArg(args, "name", { min: 1, max: 255 })!,
    ...(stringArg(args, "document", { min: 1, max: 24, optional: true }) ? { document: stringArg(args, "document", { min: 1, max: 24, optional: true }) } : {}),
    ...(stringArg(args, "phone", { min: 1, max: 40, optional: true }) ? { phone: stringArg(args, "phone", { min: 1, max: 40, optional: true }) } : {}),
    ...(email ? { email } : {}),
    ...(stringArg(args, "notes", { min: 1, max: 2_000, optional: true }) ? { notes: stringArg(args, "notes", { min: 1, max: 2_000, optional: true }) } : {}),
  };
}

function updateClientArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args);
  rejectUnknownArgs(args, ["clientId", "name", "phone", "email", "notes", "document", "fieldsToUpdate"]);
  const clientId = stringArg(args, "clientId", { min: 1, max: 80, optional: true });
  const name = stringArg(args, "name", { min: 1, max: 180, optional: true });
  if (!clientId && !name) throw new Error("Informe clientId ou name do cliente para atualizar.");
  const rawFields = (args.fieldsToUpdate && typeof args.fieldsToUpdate === "object" && !Array.isArray(args.fieldsToUpdate))
    ? args.fieldsToUpdate as Record<string, unknown>
    : {};
  const merged: Record<string, unknown> = { ...args, ...rawFields };
  delete merged.fieldsToUpdate;
  delete merged.clientId;
  const fieldsToUpdate: Record<string, unknown> = {};
  if (typeof merged.name === "string" && merged.name.trim()) fieldsToUpdate.name = merged.name.trim();
  if (typeof merged.document === "string" && merged.document.trim()) fieldsToUpdate.document = merged.document.trim();
  if (typeof merged.phone === "string" && merged.phone.trim()) fieldsToUpdate.phone = merged.phone.trim();
  if (typeof merged.email === "string" && merged.email.trim()) fieldsToUpdate.email = merged.email.trim();
  if (typeof merged.notes === "string" && merged.notes.trim()) fieldsToUpdate.notes = merged.notes.trim();
  return {
    ...(clientId ? { clientId } : {}),
    ...(name ? { name } : {}),
    ...fieldsToUpdate,
    fieldsToUpdate: Object.keys(fieldsToUpdate).length > 0 ? fieldsToUpdate : { notes: "Atualizado via Hermes" },
  };
}

function clientTimelineArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["clientId", "name", "title", "description", "eventType"]);
  const clientId = stringArg(args, "clientId", { min: 1, max: 80, optional: true });
  const name = stringArg(args, "name", { min: 1, max: 180, optional: true });
  if (!clientId && !name) throw new Error("Informe clientId ou name do cliente.");
  const title = stringArg(args, "title", { min: 1, max: 180 })!;
  const description = stringArg(args, "description", { min: 0, max: 2_000, optional: true }) ?? "";
  const eventType = args.eventType !== undefined ? enumArg(args, "eventType", ["call", "note", "meeting"] as const) : "note";
  return {
    ...(clientId ? { clientId } : {}),
    ...(name ? { name } : {}),
    title,
    description,
    eventType,
  };
}

function proposalSummaryArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["status", "sellerId", "period"]);
  const status = args.status === undefined ? undefined : enumArg(args, "status", ["draft", "negotiation", "approved", "lost"] as const);
  const sellerId = stringArg(args, "sellerId", { min: 1, max: 80, optional: true });
  const period = args.period === undefined ? undefined : stringArg(args, "period", { min: 1, max: 20, optional: true });
  return { ...(status ? { status } : {}), ...(sellerId ? { sellerId } : {}), ...(period ? { period } : {}) };
}

function proposalDetailsArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["proposalId", "orderNumber", "proposalNumber"]);
  const proposalId = stringArg(args, "proposalId", { min: 1, max: 80, optional: true });
  const orderNumber = stringArg(args, "orderNumber", { min: 1, max: 80, optional: true })
    ?? stringArg(args, "proposalNumber", { min: 1, max: 80, optional: true });
  if (!proposalId && !orderNumber) throw new Error("Informe proposalId ou orderNumber.");
  return { ...(proposalId ? { proposalId } : {}), ...(orderNumber ? { orderNumber, proposalNumber: orderNumber } : {}) };
}

function createProposalArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); args = dropEmptyArgs(args); rejectUnknownArgs(args, ["clientId", "clientName", "items", "notes", "paymentTerms"]);
  const clientId = stringArg(args, "clientId", { min: 1, max: 80, optional: true });
  const clientName = stringArg(args, "clientName", { min: 2, max: 180, optional: true });
  if (clientId && clientName) throw new Error("Informe apenas um identificador de cliente (clientId ou clientName).");
  if (!clientId && !clientName) throw new Error("Informe clientName ou clientId.");
  if (!Array.isArray(args.items) || args.items.length < 1 || args.items.length > 100) throw new Error("items inválido.");
  const items = args.items.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Item inválido.");
    const value = item as Record<string, unknown>;
    rejectUnknownArgs(value, ["productId", "productName", "description", "quantity", "unitPrice"]);
    const productId = stringArg(value, "productId", { min: 1, max: 80, optional: true });
    const productName = stringArg(value, "productName", { min: 1, max: 255, optional: true });
    const description = stringArg(value, "description", { min: 1, max: 1_000, optional: true });
    if (!productId && !productName && !description) {
      throw new Error("Item deve possuir ao menos productId, productName ou description.");
    }
    const rawQty = value.quantity !== undefined ? Number(value.quantity) : 1;
    const quantity = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
    const rawPrice = value.unitPrice !== undefined ? Number(value.unitPrice) : 0;
    const unitPrice = Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : 0;
    return {
      ...(productId ? { productId } : {}),
      productName: productName ?? description ?? (productId ? "Produto " + productId : "Item Avulso"),
      ...(description ? { description } : {}),
      quantity,
      unitPrice,
    };
  });
  return { ...(clientId ? { clientId } : { clientName: clientName }), items, ...(stringArg(args, "notes", { min: 1, max: 4_000, optional: true }) ? { notes: stringArg(args, "notes", { min: 1, max: 4_000, optional: true }) } : {}), ...(stringArg(args, "paymentTerms", { min: 1, max: 500, optional: true }) ? { paymentTerms: stringArg(args, "paymentTerms", { min: 1, max: 500, optional: true }) } : {}) };
}

function proposalStatusArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["proposalId", "orderNumber", "newStatus", "reason", "convertToSale"]);
  const proposalId = stringArg(args, "proposalId", { min: 1, max: 80, optional: true })
    ?? stringArg(args, "orderNumber", { min: 1, max: 80, optional: true });
  if (!proposalId) throw new Error("Informe proposalId ou orderNumber.");
  return {
    proposalId,
    ...(args.orderNumber ? { orderNumber: stringArg(args, "orderNumber") } : {}),
    newStatus: enumArg(args, "newStatus", ["draft", "negotiation", "approved", "rejected", "expired", "sale", "converted", "lost"] as const),
    ...(args.convertToSale ? { convertToSale: Boolean(args.convertToSale) } : {}),
    ...(stringArg(args, "reason", { min: 1, max: 500, optional: true }) ? { reason: stringArg(args, "reason", { min: 1, max: 500, optional: true }) } : {}),
  };
}

function proposalWhatsappArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["proposalId", "orderNumber", "phone", "recipientPhone", "customMessage"]);
  const proposalId = stringArg(args, "proposalId", { min: 1, max: 80, optional: true })
    ?? stringArg(args, "orderNumber", { min: 1, max: 80, optional: true });
  if (!proposalId) throw new Error("Informe proposalId ou orderNumber.");
  const phone = stringArg(args, "phone", { min: 8, max: 40, optional: true })
    ?? stringArg(args, "recipientPhone", { min: 8, max: 40, optional: true });
  return {
    proposalId,
    ...(args.orderNumber ? { orderNumber: stringArg(args, "orderNumber") } : {}),
    ...(phone ? { phone, recipientPhone: phone } : {}),
    ...(stringArg(args, "customMessage", { min: 1, max: 2_000, optional: true }) ? { customMessage: stringArg(args, "customMessage", { min: 1, max: 2_000, optional: true }) } : {}),
  };
}

function conversationsSummaryArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["status", "search"]);
  const status = args.status === undefined ? undefined : enumArg(args, "status", ["open", "closed", "all"] as const);
  const search = stringArg(args, "search", { min: 1, max: 180, optional: true });
  return { ...(status ? { status } : {}), ...(search ? { search } : {}) };
}

function extractLeadArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["conversationId", "phone", "search"]);
  const conversationId = stringArg(args, "conversationId", { min: 1, max: 80, optional: true });
  const phone = stringArg(args, "phone", { min: 1, max: 40, optional: true });
  const search = stringArg(args, "search", { min: 1, max: 180, optional: true });
  return { ...(conversationId ? { conversationId } : {}), ...(phone ? { phone } : {}), ...(search ? { search } : {}) };
}

function erpProductsArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["search", "filter", "status"]);
  const search = stringArg(args, "search", { min: 1, max: 180, optional: true });
  const filter = stringArg(args, "filter", { min: 1, max: 40, optional: true })
    ?? stringArg(args, "status", { min: 1, max: 40, optional: true });
  return { ...(search ? { search } : {}), ...(filter ? { filter } : {}) };
}

function erpLookupArgs(args: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, fields);
  const result: Record<string, unknown> = {};
  for (const field of fields) if (typeof args[field] === "string") result[field] = stringArg(args, field, { min: 1, max: 180, optional: true });
  return result;
}
function productMutationArgs(args: Record<string, unknown>, update = false): Record<string, unknown> {
  objectArgs(args);
  if (update) {
    rejectUnknownArgs(args, ["productId", "fieldsToUpdate"]);
    const fields = args.fieldsToUpdate;
    if (!fields || typeof fields !== "object" || Array.isArray(fields) || !Object.keys(fields).length) throw new Error("fieldsToUpdate inválido.");
    const record = fields as Record<string, unknown>;
    rejectUnknownArgs(record, ["name", "sku", "barcode", "description", "category", "categoryPublicId", "brandPublicId", "unit", "costPriceCents", "salePriceCents", "minimumStock"]);
    return { productId: stringArg(args, "productId", { min: 1, max: 80 })!, fieldsToUpdate: record };
  }
  args = dropEmptyArgs(args);
  if (args.price !== undefined && args.salePrice === undefined) {
    args.salePrice = args.price;
  }
  rejectUnknownArgs(args, ["name", "sku", "category", "salePrice", "costPrice", "initialStock", "minStock", "unit", "description", "price"]);
  const price = (key: string) => { const value = Number(args[key] ?? 0); if (!Number.isFinite(value) || value < 0) throw new Error(key + " inválido."); return value; };
  const quantity = Number(args.initialStock ?? 0); if (!Number.isFinite(quantity) || quantity < 0) throw new Error("initialStock inválido.");
  const minStock = Number(args.minStock ?? 0); if (!Number.isFinite(minStock) || minStock < 0) throw new Error("minStock inválido.");
  const unit = args.unit === undefined ? "unit" : enumArg(args, "unit", ["unit", "kg", "liter", "meter"] as const);
  const sku = stringArg(args, "sku", { min: 1, max: 80, optional: true }) ?? ("PRD-" + nanoid(8).replace(/[^A-Za-z0-9]/g, "X").toUpperCase());
  return { name: stringArg(args, "name", { min: 2, max: 180 })!, sku, category: stringArg(args, "category", { min: 1, max: 120, optional: true }), salePrice: price("salePrice"), costPrice: price("costPrice"), initialStock: quantity, minStock, unit };
}
const SUPPLIER_OPTIONAL_TEXT_FIELDS = ["tradeName", "stateRegistration", "postalCode", "street", "addressNumber", "addressComplement", "district", "city", "state", "notes"] as const;
function erpActionArgs(args: Record<string, unknown>, kind: "supplier" | "supplier-update" | "purchase" | "message" | "service" | "service-create" | "link"): Record<string, unknown> {
  objectArgs(args); args = dropEmptyArgs(args);
  if (kind === "supplier") {
    if (typeof args.legalName === "string" && !args.name) args.name = args.legalName;
    if (typeof args.tradeName === "string" && !args.name) args.name = args.tradeName;
  }
  const allowed = (kind === "supplier" || kind === "supplier-update")
    ? ["name", "document", "phone", "email", "contactName", ...SUPPLIER_OPTIONAL_TEXT_FIELDS, "fieldsToUpdate", "supplierId", "legalName"]
    : kind === "purchase" ? ["supplierId", "supplierName", "items", "notes"] : kind === "message" ? ["supplierId", "recipientPhone", "messageText"] : kind === "service" ? ["serviceId", "fieldsToUpdate"] : kind === "service-create" ? ["name", "code", "category", "price", "defaultPrice", "estimatedCost", "description"] : ["productId", "supplierId"];
  rejectUnknownArgs(args, allowed);
  if (kind === "supplier-update") {
    const rawUpdate: Record<string, unknown> = (args.fieldsToUpdate && typeof args.fieldsToUpdate === "object" && !Array.isArray(args.fieldsToUpdate))
      ? { ...args.fieldsToUpdate as Record<string, unknown> }
      : {};
    for (const key of ["name", "legalName", "document", "taxId", "phone", "email", "contactName", "tradeName", "notes"]) {
      if (typeof args[key] === "string" && rawUpdate[key] === undefined) {
        rawUpdate[key] = args[key];
      }
    }
    const update = dropEmptyArgs(rawUpdate);
    const supplierId = typeof args.supplierId === "string" ? stringArg(args, "supplierId", { min: 1, max: 80 }) : undefined;
    const name = typeof args.name === "string" ? stringArg(args, "name", { min: 1, max: 180 }) : (typeof args.legalName === "string" ? stringArg(args, "legalName", { min: 1, max: 180 }) : undefined);
    if (!supplierId && !name) throw new Error("Informe o nome ou ID do fornecedor para atualizar.");
    return {
      ...(supplierId ? { supplierId } : {}),
      ...(name ? { name } : {}),
      fieldsToUpdate: update,
      ...update,
    };
  }
  if (kind === "service-create") {
    const rawPrice = args.defaultPrice !== undefined ? args.defaultPrice : args.price;
    const money = (val: unknown, key: string) => { const value = Number(val ?? 0); if (!Number.isFinite(value) || value < 0) throw new Error(key + " inválido."); return value; };
    return {
      name: stringArg(args, "name", { min: 2, max: 255 })!,
      price: money(rawPrice, "price"),
      defaultPrice: money(rawPrice, "defaultPrice"),
      estimatedCost: money(args.estimatedCost, "estimatedCost"),
      ...(stringArg(args, "code", { min: 1, max: 50, optional: true }) ? { code: stringArg(args, "code", { min: 1, max: 50, optional: true }) } : {}),
      ...(stringArg(args, "category", { min: 1, max: 100, optional: true }) ? { category: stringArg(args, "category", { min: 1, max: 100, optional: true }) } : {}),
      ...(stringArg(args, "description", { min: 0, max: 2_000, optional: true }) ? { description: stringArg(args, "description", { min: 0, max: 2_000, optional: true }) } : {}),
    };
  }
  if (kind === "link") return { productId: stringArg(args, "productId", { min: 1, max: 80 })!, supplierId: stringArg(args, "supplierId", { min: 1, max: 80 })! };
  if (kind === "service") { if (!args.fieldsToUpdate || typeof args.fieldsToUpdate !== "object" || Array.isArray(args.fieldsToUpdate)) throw new Error("fieldsToUpdate inválido."); return { serviceId: Number(args.serviceId), fieldsToUpdate: args.fieldsToUpdate as Record<string, unknown> }; }
  if (kind === "message") return { supplierId: stringArg(args, "supplierId", { min: 1, max: 80 })!, recipientPhone: stringArg(args, "recipientPhone", { min: 8, max: 40 })!, messageText: stringArg(args, "messageText", { min: 1, max: 2_000 })! };
  if (kind === "purchase") {
    if (!Array.isArray(args.items) || !args.items.length || args.items.length > 100) throw new Error("items inválido.");
    const supplierId = typeof args.supplierId === "string" ? stringArg(args, "supplierId", { min: 1, max: 80, optional: true }) : undefined;
    const supplierName = typeof args.supplierName === "string" ? stringArg(args, "supplierName", { min: 1, max: 180, optional: true }) : undefined;
    if (!supplierId && !supplierName) throw new Error("Informe o ID ou nome do fornecedor.");
    const items = args.items.map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Item inválido.");
      const it = item;
      const productId = typeof it.productId === "string" ? stringArg(it, "productId", { min: 1, max: 80, optional: true }) : undefined;
      const productName = typeof it.productName === "string" ? stringArg(it, "productName", { min: 1, max: 180, optional: true }) : undefined;
      if (!productId && !productName) throw new Error("Informe o productId ou productName do item.");
      const rawQty = Number(it.quantity ?? 1);
      const quantity = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
      const rawCost = Number(it.targetCost ?? 0);
      const targetCost = Number.isFinite(rawCost) && rawCost >= 0 ? rawCost : 0;
      return {
        ...(productId ? { productId } : {}),
        productName: productName ?? (productId ? "Produto " + productId : "Item"),
        quantity,
        targetCost,
      };
    });
    return {
      ...(supplierId ? { supplierId } : {}),
      ...(supplierName ? { supplierName } : {}),
      items,
      ...(typeof args.notes === "string" ? { notes: stringArg(args, "notes", { min: 1, max: 4_000 }) } : {}),
    };
  }
  const update = args.fieldsToUpdate === undefined ? undefined : args.fieldsToUpdate && typeof args.fieldsToUpdate === "object" && !Array.isArray(args.fieldsToUpdate) ? dropEmptyArgs(args.fieldsToUpdate as Record<string, unknown>) : null;
  if (update !== undefined && (!update || !Object.keys(update).length)) throw new Error("fieldsToUpdate inválido.");
  if (update) rejectUnknownArgs(update, ["name", "legalName", "document", "taxId", "phone", "email", "contactName", "tradeName", "notes"]);
  const optionalText = (key: string, min: number, max: number) => (typeof args[key] === "string" ? { [key]: stringArg(args, key, { min, max }) } : {});
  const result: Record<string, unknown> = { ...(typeof args.supplierId === "string" ? { supplierId: stringArg(args, "supplierId", { min: 1, max: 80 }) } : {}), ...(update ? { fieldsToUpdate: update } : {}), ...optionalText("name", 2, 180), ...optionalText("document", 1, 24), ...optionalText("phone", 1, 40), ...optionalText("email", 1, 255), ...optionalText("contactName", 1, 120), ...optionalText("tradeName", 1, 180), ...optionalText("stateRegistration", 1, 40), ...optionalText("postalCode", 1, 12), ...optionalText("street", 1, 180), ...optionalText("addressNumber", 1, 30), ...optionalText("addressComplement", 1, 120), ...optionalText("district", 1, 120), ...optionalText("city", 1, 120), ...optionalText("state", 1, 2), ...optionalText("notes", 1, 4_000) };
  if (!result.supplierId && !result.name) throw new Error("Informe o nome do fornecedor para criar o cadastro.");
  if (result.supplierId && !result.fieldsToUpdate) throw new Error("fieldsToUpdate é obrigatório para atualizar fornecedor.");
  return result;
}

/**
 * Registry único de capacidades Hermes. Ferramentas de mutação futuras devem
 * declarar validateArgs; o executor nunca as executa antes de aprovação humana.
 */
export const HERMES_TOOL_REGISTRY: readonly HermesToolDefinition[] = [
  {
    name: "get_sales_summary",
    type: "READ",
    requiredPermissions: ["sales", "erp-sales", "erp"],
    declaration: { name: "get_sales_summary", description: "Retorna o resumo de vendas do cliente para hoje, incluindo total de vendas e valor total.", parameters: { type: "OBJECT", properties: {}, required: [] } },
    validateArgs: noArguments,
  },
  {
    name: "get_open_tickets",
    type: "READ",
    requiredPermissions: ["tickets", "support"],
    declaration: {
      name: "get_open_tickets",
      description: "Retorna o número e a lista de chamados/tickets abertos ou em andamento. Permite buscar por código, número ou termo.",
      parameters: {
        type: "OBJECT",
        properties: {
          search: { type: "STRING", description: "Código, número ou termo do chamado (ex: '0003')" },
          ticketNumber: { type: "INTEGER", description: "Número do chamado (ex: 3)" },
        },
        required: [],
      },
    },
    validateArgs: openTicketsArgs,
  },
  {
    name: "get_tickets_overview",
    type: "READ",
    requiredPermissions: ["tickets", "support"],
    declaration: {
      name: "get_tickets_overview",
      description: "Retorna métricas consolidadas dos chamados do cliente no sistema (total, abertos, em andamento, pendentes) e lista recente.",
      parameters: {
        type: "OBJECT",
        properties: {
          status: { type: "STRING", enum: ["open", "in_progress", "pending", "resolved", "closed"] },
          search: { type: "STRING", description: "Busca textual em títulos, clientes ou número do chamado formatado" },
          limit: { type: "INTEGER" }
        },
        required: []
      }
    },
    validateArgs: ticketOverviewArgs,
  },
  {
    name: "get_ticket_details",
    type: "READ",
    requiredPermissions: ["tickets", "support"],
    declaration: {
      name: "get_ticket_details",
      description: "Retorna a ficha completa de um chamado específico (dados, responsável, timeline e notas).",
      parameters: {
        type: "OBJECT",
        properties: {
          ticketId: { type: "STRING", description: "ID interno do chamado" },
          ticketNumber: { type: "STRING", description: "Número sequencial visível do chamado (ex: '0003' ou '3')" }
        },
        required: []
      }
    },
    validateArgs: ticketDetailsArgs,
  },
  {
    name: "create_ticket",
    type: "MUTATION",
    actionType: "CREATE_TICKET",
    requiredPermissions: ["tickets", "support"],
    declaration: {
      name: "create_ticket",
      description: "Abre um novo chamado de suporte mediante aprovação humana.",
      parameters: {
        type: "OBJECT",
        properties: {
          customer: { type: "STRING", description: "Nome ou identificador do cliente" },
          title: { type: "STRING", description: "Assunto do chamado" },
          description: { type: "STRING", description: "Detalhamento do problema" },
          priority: { type: "STRING", enum: ["low", "medium", "high", "urgent"] },
          category: { type: "STRING", description: "Categoria do atendimento" }
        },
        required: ["customer", "title"]
      }
    },
    validateArgs: createTicketArgs,
  },
  {
    name: "update_ticket_status",
    type: "MUTATION",
    actionType: "UPDATE_TICKET_STATUS",
    requiredPermissions: ["tickets", "support"],
    declaration: {
      name: "update_ticket_status",
      description: "Altera o estado de um chamado ou realiza o encerramento; exige aprovação humana.",
      parameters: {
        type: "OBJECT",
        properties: {
          ticketNumber: { type: "STRING", description: "Número ou ID do chamado" },
          ticketId: { type: "STRING", description: "ID interno do chamado" },
          newStatus: { type: "STRING", enum: ["in_progress", "pending", "resolved", "closed"] },
          resolutionNote: { type: "STRING", description: "Motivo ou descrição da solução" }
        },
        required: ["newStatus"]
      }
    },
    validateArgs: updateTicketStatusArgs,
  },
  {
    name: "assign_ticket",
    type: "MUTATION",
    actionType: "ASSIGN_TICKET",
    requiredPermissions: ["tickets", "support"],
    declaration: {
      name: "assign_ticket",
      description: "Atribui ou transfere o chamado para um operador específico; exige aprovação humana.",
      parameters: {
        type: "OBJECT",
        properties: {
          ticketNumber: { type: "STRING", description: "Número ou ID do chamado" },
          ticketId: { type: "STRING", description: "ID interno do chamado" },
          operatorName: { type: "STRING", description: "Nome do operador responsável" },
          operatorId: { type: "STRING", description: "ID do operador" },
          reason: { type: "STRING", description: "Motivo da transferência" }
        },
        required: []
      }
    },
    validateArgs: assignTicketArgs,
  },
  {
    name: "add_ticket_activity",
    type: "MUTATION",
    actionType: "ADD_TICKET_ACTIVITY",
    requiredPermissions: ["tickets", "support"],
    declaration: { name: "add_ticket_activity", description: "Prepara uma atividade em chamado; só executa após aprovação explícita.", parameters: { type: "OBJECT", properties: { ticketId: { type: "STRING" }, noteContent: { type: "STRING" }, isInternal: { type: "BOOLEAN" } }, required: ["ticketId", "noteContent"] } },
    validateArgs: addTicketActivityArgs,
  },
  {
    name: "get_crm_summary",
    type: "READ",
    requiredPermissions: ["crm", "clients"],
    declaration: {
      name: "get_crm_summary",
      description: "Métricas de volume e funil da base de clientes no período solicitado.",
      parameters: {
        type: "OBJECT",
        properties: {
          period: { type: "STRING", enum: ["today", "month", "year"], description: "Período das métricas" }
        },
        required: []
      }
    },
    validateArgs: crmSummaryArgs
  },
  { name: "list_crm_clients", type: "READ", requiredPermissions: ["crm", "clients"], declaration: { name: "list_crm_clients", description: "Lista clientes recentes do CRM ou busca por nome, telefone ou e-mail.", parameters: { type: "OBJECT", properties: { search: { type: "STRING", description: "Nome, telefone ou e-mail (opcional)" }, limit: { type: "INTEGER", description: "Máximo de resultados (1 a 20)" } }, required: [] } }, validateArgs: args => { objectArgs(args); args = dropEmptyArgs(args); rejectUnknownArgs(args, ["search", "limit"]); const search = stringArg(args, "search", { min: 1, max: 180, optional: true }); const limit = optionalLimit(args); return { ...(search ? { search } : {}), ...(limit ? { limit } : {}) }; } },
  {
    name: "get_client_360",
    type: "READ",
    requiredPermissions: ["crm", "clients"],
    declaration: {
      name: "get_client_360",
      description: "Consulta a visão 360° do cliente em todas as pontas do sistema (chamados, propostas, faturamento, conversas).",
      parameters: {
        type: "OBJECT",
        properties: {
          search: { type: "STRING", description: "Nome, CPF/CNPJ, e-mail ou telefone do cliente" },
          clientId: { type: "STRING", description: "ID do cliente no CRM" }
        },
        required: []
      }
    },
    validateArgs: crmClientLookupArgs
  },
  {
    name: "create_client",
    type: "MUTATION",
    actionType: "CREATE_CLIENT",
    requiredPermissions: ["crm", "clients"],
    declaration: {
      name: "create_client",
      description: "Cadastra novo cliente ou lead comercial; exige aprovação humana.",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Nome ou razão social" },
          document: { type: "STRING", description: "CPF ou CNPJ formatado" },
          phone: { type: "STRING" },
          email: { type: "STRING" },
          notes: { type: "STRING" }
        },
        required: ["name"]
      }
    },
    validateArgs: createClientArgs
  },
  {
    name: "update_client",
    type: "MUTATION",
    actionType: "UPDATE_CLIENT",
    requiredPermissions: ["crm", "clients"],
    declaration: {
      name: "update_client",
      description: "Atualiza dados cadastrais de contato ou observações do cliente; exige aprovação humana.",
      parameters: {
        type: "OBJECT",
        properties: {
          clientId: { type: "STRING", description: "ID do cliente no CRM (opcional se name for informado)" },
          name: { type: "STRING", description: "Nome do cliente para localizar ou atualizar" },
          phone: { type: "STRING" },
          email: { type: "STRING" },
          notes: { type: "STRING" }
        },
        required: []
      }
    },
    validateArgs: updateClientArgs
  },
  {
    name: "add_client_timeline_event",
    type: "MUTATION",
    actionType: "ADD_CLIENT_TIMELINE",
    requiredPermissions: ["crm", "clients"],
    declaration: {
      name: "add_client_timeline_event",
      description: "Registra evento (ligação, visita, alinhamento) na linha do tempo do cliente; exige aprovação humana.",
      parameters: {
        type: "OBJECT",
        properties: {
          clientId: { type: "STRING", description: "ID do cliente no CRM (opcional se name for informado)" },
          name: { type: "STRING", description: "Nome do cliente" },
          title: { type: "STRING", description: "Título do evento" },
          description: { type: "STRING", description: "Detalhamento do evento" },
          eventType: { type: "STRING", enum: ["call", "meeting", "note"] }
        },
        required: ["title"]
      }
    },
    validateArgs: clientTimelineArgs
  },
  {
    name: "get_proposals_summary",
    type: "READ",
    requiredPermissions: ["sales", "crm", "proposals"],
    declaration: {
      name: "get_proposals_summary",
      description: "Resumo financeiro e contagem das propostas comerciais no sistema.",
      parameters: {
        type: "OBJECT",
        properties: {
          status: { type: "STRING", enum: ["draft", "negotiation", "approved", "lost"] },
          sellerId: { type: "STRING" },
          period: { type: "STRING" }
        },
        required: []
      }
    },
    validateArgs: proposalSummaryArgs
  },
  {
    name: "get_proposal_details",
    type: "READ",
    requiredPermissions: ["sales", "crm", "proposals"],
    declaration: {
      name: "get_proposal_details",
      description: "Ficha completa de um orçamento específico por número ou ID.",
      parameters: {
        type: "OBJECT",
        properties: {
          orderNumber: { type: "STRING", description: "Número visível do orçamento (ex: 'O-18')" },
          proposalId: { type: "STRING", description: "ID público da proposta" }
        },
        required: []
      }
    },
    validateArgs: proposalDetailsArgs
  },
  {
    name: "create_proposal",
    type: "MUTATION",
    actionType: "CREATE_PROPOSAL",
    requiredPermissions: ["sales", "crm", "proposals"],
    declaration: {
      name: "create_proposal",
      description: "Monta e emite proposta comercial/orçamento; exige aprovação humana.",
      parameters: {
        type: "OBJECT",
        properties: {
          clientName: { type: "STRING", description: "Nome do cliente comercial" },
          clientId: { type: "STRING", description: "ID do cliente no CRM (opcional)" },
          items: {
            type: "ARRAY",
            description: "Itens ou serviços da proposta com quantidade e preço unitário.",
            items: {
              type: "OBJECT",
              properties: {
                productName: { type: "STRING", description: "Nome do produto ou serviço" },
                productId: { type: "STRING", description: "ID do produto no catálogo (opcional)" },
                quantity: { type: "NUMBER", description: "Quantidade" },
                unitPrice: { type: "NUMBER", description: "Preço unitário em reais" }
              },
              required: ["productName", "quantity", "unitPrice"]
            }
          },
          notes: { type: "STRING" },
          paymentTerms: { type: "STRING" }
        },
        required: ["items"]
      }
    },
    validateArgs: createProposalArgs
  },
  {
    name: "update_proposal_status",
    type: "MUTATION",
    actionType: "UPDATE_PROPOSAL_STATUS",
    requiredPermissions: ["sales", "crm", "proposals"],
    declaration: {
      name: "update_proposal_status",
      description: "Altera status da proposta ou converte diretamente em venda no ERP; exige aprovação humana.",
      parameters: {
        type: "OBJECT",
        properties: {
          proposalId: { type: "STRING", description: "ID ou número da proposta" },
          orderNumber: { type: "STRING", description: "Número visível da proposta (ex: 'O-18')" },
          newStatus: { type: "STRING", enum: ["draft", "negotiation", "approved", "rejected", "expired", "sale", "converted", "lost"] },
          convertToSale: { type: "BOOLEAN", description: "Converte o orçamento diretamente em venda no ERP" },
          reason: { type: "STRING" }
        },
        required: ["newStatus"]
      }
    },
    validateArgs: proposalStatusArgs
  },
  {
    name: "send_proposal_whatsapp",
    type: "MUTATION",
    actionType: "SEND_PROPOSAL_WHATSAPP",
    requiredPermissions: ["sales", "crm", "proposals"],
    declaration: {
      name: "send_proposal_whatsapp",
      description: "Dispara mensagem formatada com o orçamento para o WhatsApp do cliente; exige aprovação humana.",
      parameters: {
        type: "OBJECT",
        properties: {
          orderNumber: { type: "STRING", description: "Número visível do orçamento (ex: 'O-18')" },
          proposalId: { type: "STRING", description: "ID público da proposta" },
          phone: { type: "STRING", description: "Telefone do cliente (opcional; obtém do cadastro se omitido)" },
          customMessage: { type: "STRING", description: "Mensagem personalizada opcional" }
        },
        required: []
      }
    },
    validateArgs: proposalWhatsappArgs
  },
  { name: "get_erp_summary", type: "READ", requiredPermissions: ["products", "inventory", "erp"], declaration: { name: "get_erp_summary", description: "Retorna o resumo de produtos, estoque e serviços ativos do tenant.", parameters: { type: "OBJECT", properties: {}, required: [] } }, validateArgs: noArguments },
  {
    name: "get_product_details",
    type: "READ",
    requiredPermissions: ["products", "inventory", "erp"],
    declaration: {
      name: "get_product_details",
      description: "Ficha técnica completa de produto por ID ou SKU.",
      parameters: {
        type: "OBJECT",
        properties: {
          productId: { type: "STRING" },
          sku: { type: "STRING" }
        },
        required: []
      }
    },
    validateArgs: args => { const value = erpLookupArgs(args, ["productId", "sku"]); if ((value.productId ? 1 : 0) + (value.sku ? 1 : 0) !== 1) throw new Error("Informe exatamente productId ou sku."); return value; }
  },
  {
    name: "get_inventory_status",
    type: "READ",
    requiredPermissions: ["products", "inventory", "erp"],
    declaration: {
      name: "get_inventory_status",
      description: "Consulta saldos por status de estoque ou busca textual.",
      parameters: {
        type: "OBJECT",
        properties: {
          status: { type: "STRING" },
          search: { type: "STRING" }
        },
        required: []
      }
    },
    validateArgs: args => { objectArgs(args); rejectUnknownArgs(args, ["status", "search"]); const value: Record<string, unknown> = {}; if (typeof args.search === "string") value.search = stringArg(args, "search", { min: 1, max: 180 }); if (args.status !== undefined) value.status = enumArg(args, "status", ["empty", "low", "regular"] as const); return value; }
  },
  {
    name: "create_product",
    type: "MUTATION",
    actionType: "CREATE_PRODUCT",
    requiredPermissions: ["products", "inventory", "erp"],
    declaration: {
      name: "create_product",
      description: "Cadastra novo produto físico no catálogo; exige aprovação humana.",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Nome do produto (obrigatório)" },
          sku: { type: "STRING", description: "Código SKU (opcional, gerado automaticamente)" },
          salePrice: { type: "NUMBER", description: "Preço de venda em reais" },
          costPrice: { type: "NUMBER", description: "Preço de custo em reais" },
          initialStock: { type: "NUMBER", description: "Estoque inicial" },
          minStock: { type: "NUMBER", description: "Estoque mínimo" },
          unit: { type: "STRING" }
        },
        required: ["name"]
      }
    },
    validateArgs: args => productMutationArgs(args)
  },
  { name: "update_product", type: "MUTATION", actionType: "UPDATE_PRODUCT", requiredPermissions: ["products", "inventory", "erp"], declaration: { name: "update_product", description: "Prepara atualização de produto; exige aprovação humana.", parameters: { type: "OBJECT", properties: { productId: { type: "STRING" }, fieldsToUpdate: { type: "OBJECT", description: "Campos a atualizar", properties: { name: { type: "STRING" }, sku: { type: "STRING" }, barcode: { type: "STRING" }, description: { type: "STRING" }, category: { type: "STRING" }, categoryPublicId: { type: "STRING" }, brandPublicId: { type: "STRING" }, unit: { type: "STRING" }, costPriceCents: { type: "NUMBER" }, salePriceCents: { type: "NUMBER" }, minimumStock: { type: "NUMBER" } } } }, required: ["productId", "fieldsToUpdate"] } }, validateArgs: args => productMutationArgs(args, true) },
  { name: "link_product_supplier", type: "MUTATION", actionType: "LINK_PRODUCT_SUPPLIER", requiredPermissions: ["products", "suppliers", "erp"], declaration: { name: "link_product_supplier", description: "Prepara vínculo de fornecedor ao produto; exige aprovação humana.", parameters: { type: "OBJECT", properties: { productId: { type: "STRING" }, supplierId: { type: "STRING" } }, required: ["productId", "supplierId"] } }, validateArgs: args => erpActionArgs(args, "link") },
  {
    name: "get_services_list",
    type: "READ",
    requiredPermissions: ["services", "erp"],
    declaration: {
      name: "get_services_list",
      description: "Consulta a lista de serviços e mão de obra disponíveis no catálogo.",
      parameters: {
        type: "OBJECT",
        properties: {
          search: { type: "STRING", description: "Busca por descrição ou nome de serviço" }
        },
        required: []
      }
    },
    validateArgs: args => erpLookupArgs(args, ["search"])
  },
  { name: "update_service", type: "MUTATION", actionType: "UPDATE_SERVICE", requiredPermissions: ["services", "erp"], declaration: { name: "update_service", description: "Prepara atualização de serviço; exige aprovação humana.", parameters: { type: "OBJECT", properties: { serviceId: { type: "INTEGER" }, fieldsToUpdate: { type: "OBJECT", description: "Campos a atualizar", properties: { name: { type: "STRING" }, code: { type: "STRING" }, category: { type: "STRING" }, price: { type: "NUMBER" }, estimatedCost: { type: "NUMBER" }, isActive: { type: "BOOLEAN" } } } }, required: ["serviceId", "fieldsToUpdate"] } }, validateArgs: args => erpActionArgs(args, "service") },
  {
    name: "create_service",
    type: "MUTATION",
    actionType: "CREATE_SERVICE",
    requiredPermissions: ["services", "erp"],
    declaration: {
      name: "create_service",
      description: "Cadastra novo serviço no catálogo do ERP; exige aprovação humana.",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Nome do serviço (obrigatório)" },
          defaultPrice: { type: "NUMBER", description: "Preço padrão em reais" },
          description: { type: "STRING", description: "Descrição do serviço" }
        },
        required: ["name"]
      }
    },
    validateArgs: args => erpActionArgs(args, "service-create")
  },
  { name: "get_sales_analytics", type: "READ", requiredPermissions: ["sales", "erp"], declaration: { name: "get_sales_analytics", description: "Retorna faturamento, pedidos e ticket médio no período solicitado.", parameters: { type: "OBJECT", properties: { period: { type: "STRING" }, startDate: { type: "STRING" }, endDate: { type: "STRING" } }, required: [] } }, validateArgs: args => { objectArgs(args); rejectUnknownArgs(args, ["period", "startDate", "endDate"]); const period = args.period === undefined ? "month" : enumArg(args, "period", ["today", "week", "month", "custom"] as const); const result: Record<string, unknown> = { period }; if (period === "custom") { result.startDate = stringArg(args, "startDate", { min: 10, max: 10 })!; result.endDate = stringArg(args, "endDate", { min: 10, max: 10 })!; } return result; } },
  {
    name: "get_suppliers_list",
    type: "READ",
    requiredPermissions: ["suppliers", "purchases", "erp"],
    declaration: {
      name: "get_suppliers_list",
      description: "Consulta os fornecedores homologados da empresa por nome, razão social ou CNPJ.",
      parameters: {
        type: "OBJECT",
        properties: {
          search: { type: "STRING", description: "Nome fantasia, razão social ou CNPJ" }
        },
        required: []
      }
    },
    validateArgs: args => erpLookupArgs(args, ["search"])
  },
  {
    name: "create_supplier",
    type: "MUTATION",
    actionType: "CREATE_SUPPLIER",
    requiredPermissions: ["suppliers", "purchases", "erp"],
    declaration: {
      name: "create_supplier",
      description: "Cadastro rápido de fornecedor; exige apenas o nome, os demais dados são opcionais. Exige aprovação humana.",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Nome ou razão social (obrigatório)" },
          document: { type: "STRING", description: "CPF ou CNPJ formatado (opcional)" },
          phone: { type: "STRING" },
          email: { type: "STRING" },
          contactName: { type: "STRING" },
          notes: { type: "STRING" }
        },
        required: ["name"]
      }
    },
    validateArgs: args => erpActionArgs(args, "supplier")
  },
  {
    name: "update_supplier",
    type: "MUTATION",
    actionType: "UPDATE_SUPPLIER",
    requiredPermissions: ["suppliers", "purchases", "erp"],
    declaration: {
      name: "update_supplier",
      description: "Atualiza dados cadastrais de fornecedor existente (telefone, e-mail, contato, notas); localiza por nome ou supplierId. Exige aprovação humana.",
      parameters: {
        type: "OBJECT",
        properties: {
          supplierId: { type: "STRING", description: "ID público do fornecedor" },
          name: { type: "STRING", description: "Nome ou razão social do fornecedor para localizar" },
          phone: { type: "STRING" },
          email: { type: "STRING" },
          contactName: { type: "STRING" },
          notes: { type: "STRING" },
          fieldsToUpdate: {
            type: "OBJECT",
            description: "Campos de contato para atualização",
            properties: {
              phone: { type: "STRING" },
              email: { type: "STRING" },
              contactName: { type: "STRING" },
              notes: { type: "STRING" }
            }
          }
        },
        required: []
      }
    },
    validateArgs: args => erpActionArgs(args, "supplier-update")
  },
  {
    name: "request_purchase_order",
    type: "MUTATION",
    actionType: "REQUEST_PURCHASE",
    requiredPermissions: ["suppliers", "purchases", "erp"],
    declaration: {
      name: "request_purchase_order",
      description: "Gera solicitação/ordem de compra para reposição de mercadoria; exige aprovação humana.",
      parameters: {
        type: "OBJECT",
        properties: {
          supplierName: { type: "STRING", description: "Nome do fornecedor" },
          supplierId: { type: "STRING", description: "ID do fornecedor (opcional se supplierName informado)" },
          items: {
            type: "ARRAY",
            description: "Itens da solicitação de compra",
            items: {
              type: "OBJECT",
              properties: {
                productName: { type: "STRING", description: "Nome do produto" },
                productId: { type: "STRING", description: "ID público do produto (opcional)" },
                quantity: { type: "NUMBER", description: "Quantidade" },
                targetCost: { type: "NUMBER", description: "Custo alvo unitário em reais" }
              },
              required: ["quantity"]
            }
          },
          notes: { type: "STRING" }
        },
        required: ["items"]
      }
    },
    validateArgs: args => erpActionArgs(args, "purchase")
  },
  { name: "send_supplier_message", type: "MUTATION", actionType: "SEND_SUPPLIER_MESSAGE", requiredPermissions: ["suppliers", "purchases", "erp"], declaration: { name: "send_supplier_message", description: "Prepara mensagem a fornecedor; exige aprovação humana.", parameters: { type: "OBJECT", properties: { supplierId: { type: "STRING" }, recipientPhone: { type: "STRING" }, messageText: { type: "STRING" } }, required: ["supplierId", "recipientPhone", "messageText"] } }, validateArgs: args => erpActionArgs(args, "message") },
  {
    name: "get_conversations_summary",
    type: "READ",
    requiredPermissions: ["conversations", "chat"],
    declaration: {
      name: "get_conversations_summary",
      description: "Consulta atendimentos e conversas recentes do WhatsApp.",
      parameters: {
        type: "OBJECT",
        properties: {
          status: { type: "STRING", enum: ["open", "closed", "all"] },
          search: { type: "STRING", description: "Nome do contato ou telefone" }
        },
        required: []
      }
    },
    validateArgs: conversationsSummaryArgs,
  },
  {
    name: "get_whatsapp_status",
    type: "READ",
    requiredPermissions: ["conversations", "chat"],
    declaration: {
      name: "get_whatsapp_status",
      description: "Consulta o estado atual da conexão WhatsApp do tenant na Evolution API. Use para perguntas sobre conexão, status ou instância do WhatsApp.",
      parameters: { type: "OBJECT", properties: {}, required: [] },
    },
    validateArgs: noArguments,
  },
  {
    name: "extract_lead_from_conversation",
    type: "READ",
    requiredPermissions: ["conversations", "chat", "crm"],
    declaration: {
      name: "extract_lead_from_conversation",
      description: "Analisa histórico recente de chat e extrai dados cadastrais de cliente (nome, documento, veículo, serviços solicitados) para geração direta de orçamentos.",
      parameters: {
        type: "OBJECT",
        properties: {
          conversationId: { type: "STRING", description: "ID da conversa" },
          phone: { type: "STRING", description: "Telefone do contato" },
          search: { type: "STRING", description: "Nome do contato ou telefone" }
        },
        required: []
      }
    },
    validateArgs: extractLeadArgs,
  },
  {
    name: "set_user_preference",
    type: "READ",
    requiredPermissions: ["ai-assistant"],
    declaration: {
      name: "set_user_preference",
      description: "Salva ou atualiza as preferências de comunicação, tratamento, nome e regras customizadas do usuário no perfil permanente.",
      parameters: {
        type: "OBJECT",
        properties: {
          preferredName: { type: "STRING", description: "Como o usuário prefere ser chamado (ex: 'Senhor Marcelo', 'Marcelo', 'Chefe')" },
          honorific: { type: "STRING", description: "Pronome ou forma de tratamento ('Senhor', 'Senhora', 'Você', 'Doutor', etc.)" },
          communicationStyle: { type: "STRING", description: "Estilo de comunicação ('direto', 'formal', 'descontraído', 'executivo', etc.)" },
          customRule: { type: "STRING", description: "Regra operacional, diretriz ou preferência de rotina informada pelo usuário" }
        },
        required: []
      }
    },
    validateArgs: args => {
      objectArgs(args);
      rejectUnknownArgs(args, ["preferredName", "honorific", "communicationStyle", "customRule"]);
      return {
        ...(typeof args.preferredName === "string" ? { preferredName: stringArg(args, "preferredName", { min: 1, max: 100 }) } : {}),
        ...(typeof args.honorific === "string" ? { honorific: stringArg(args, "honorific", { min: 1, max: 50 }) } : {}),
        ...(typeof args.communicationStyle === "string" ? { communicationStyle: stringArg(args, "communicationStyle", { min: 1, max: 100 }) } : {}),
        ...(typeof args.customRule === "string" ? { customRule: stringArg(args, "customRule", { min: 1, max: 1_000 }) } : {}),
      };
    }
  },
  {
    name: "get_erp_products",
    type: "READ",
    requiredPermissions: ["products", "erp"],
    declaration: {
      name: "get_erp_products",
      description: "Consulta catálogo e saldos de produtos físicos em estoque.",
      parameters: {
        type: "OBJECT",
        properties: {
          search: { type: "STRING", description: "Nome ou SKU do item" },
          filter: { type: "STRING", enum: ["all", "out_of_stock", "low_stock"] }
        },
        required: []
      }
    },
    validateArgs: erpProductsArgs,
  },
  {
    name: "web_search",
    type: "READ",
    requiredPermissions: ["ai-assistant"],
    declaration: {
      name: "web_search",
      description: "Realiza pesquisas em tempo real na web para buscar informações públicas, fornecedores, cotações, concorrentes e contatos.",
      parameters: {
        type: "OBJECT",
        properties: { query: { type: "STRING" }, focus: { type: "STRING" } },
        required: ["query"],
      },
    },
    validateArgs: webSearchArgs,
  },
];

export function getAllowedHermesTools(permissions: readonly string[]): HermesToolDefinition[] {
  const granted = new Set(permissions);
  return HERMES_TOOL_REGISTRY.filter(tool => tool.requiredPermissions.some(permission => granted.has(permission)));
}

/** Defesa em profundidade: a ferramenta precisa ser autorizada na execução, não só na declaração enviada ao modelo. */
export function getAuthorizedHermesTool(name: string, permissions: readonly string[]): HermesToolDefinition | null {
  return getAllowedHermesTools(permissions).find(tool => tool.name === name) ?? null;
}

/** Descrição amigável de uma mutação pendente, usada no card de aprovação humana. */
export function summarizePendingAction(actionType: HermesActionType, args: Record<string, unknown>): string {
  const name = String(args.name ?? args.legalName ?? "").trim();
  if (actionType === "CREATE_CLIENT") return `Cadastrar o cliente "${name}"${args.phone ? ` (telefone ${String(args.phone)})` : ""}.`;
  if (actionType === "CREATE_SUPPLIER") return `Cadastrar o fornecedor "${name}".`;
  if (actionType === "UPDATE_SUPPLIER") {
    const rawFields = (args.fieldsToUpdate && typeof args.fieldsToUpdate === "object") ? args.fieldsToUpdate as Record<string, unknown> : args;
    const parts: string[] = [];
    if (rawFields.phone) parts.push(`telefone: ${rawFields.phone}`);
    if (rawFields.email) parts.push(`e-mail: ${rawFields.email}`);
    if (rawFields.notes) parts.push(`anotação: "${rawFields.notes}"`);
    const details = parts.length > 0 ? ` (${parts.join(", ")})` : "";
    return `Atualizar o fornecedor "${name || String(args.supplierId ?? "selecionado")}"${details}.`;
  }
  if (actionType === "CREATE_PRODUCT") return `Cadastrar o produto "${name}".`;
  if (actionType === "CREATE_SERVICE") return `Cadastrar o serviço "${name}".`;
  if (actionType === "CREATE_TICKET") {
    const cust = args.customer ? ` para ${String(args.customer)}` : "";
    return `Abrir o chamado "${String(args.title ?? "")}"${cust}.`;
  }
  if (actionType === "UPDATE_PROPOSAL_STATUS") {
    const isSale = args.newStatus === "sale" || args.newStatus === "converted" || Boolean(args.convertToSale);
    if (isSale) return `Aprovar e converter a proposta ${String(args.proposalId ?? "")} em venda no ERP.`;
    return `Atualizar status da proposta ${String(args.proposalId ?? "")} para "${String(args.newStatus ?? "")}".`;
  }
  if (actionType === "CREATE_PROPOSAL") {
    const items = Array.isArray(args.items) ? args.items as Array<{ quantity?: number; unitPrice?: number }> : [];
    const total = items.reduce((sum, item) => sum + Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0), 0);
    return `Criar proposta comercial para ${String(args.clientName ?? args.clientId ?? "o cliente")} com ${items.length} item(ns), total de R$ ${total.toFixed(2).replace(".", ",")}.`;
  }
  return "Executar a ação sugerida mediante sua aprovação.";
}

export function createPendingActionRequest(tool: HermesToolDefinition, args: Record<string, unknown>, owner?: PendingActionOwner): PendingActionRequest {
  if (tool.type !== "MUTATION") throw new Error("Somente ferramentas de mutação exigem aprovação humana.");
  if (!tool.actionType) throw new Error("Ferramenta de mutação sem actionType autorizado.");
  const validatedArgs = tool.validateArgs(args);
  const request: PendingActionRequest = {
    id: `action-${nanoid()}`,
    toolName: tool.name,
    type: "MUTATION",
    actionType: tool.actionType,
    args: validatedArgs,
    status: "PENDING_APPROVAL",
    summary: summarizePendingAction(tool.actionType, validatedArgs),
  };
  if (owner) {
    pendingActions.set(request.id, { ...request, ...owner, expiresAt: Date.now() + HERMES_ACTION_TTL_MS, state: "PENDING_APPROVAL" });
  }
  return request;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function beginPendingHermesAction(input: { actionId: string; actionType: HermesActionType; payload: Record<string, unknown>; clientId: string; userId: string }) {
  const stored = pendingActions.get(input.actionId);
  if (!stored || stored.expiresAt <= Date.now()) {
    pendingActions.delete(input.actionId);
    throw new Error("Ação pendente ausente ou expirada; solicite uma nova ação ao Hermes.");
  }
  if (stored.state !== "PENDING_APPROVAL" || stored.clientId !== input.clientId || stored.userId !== input.userId || stored.actionType !== input.actionType) {
    throw new Error("Ação pendente não pertence à sessão autenticada.");
  }
  const tool = HERMES_TOOL_REGISTRY.find(item => item.name === stored.toolName && item.actionType === input.actionType);
  if (!tool) throw new Error("Ação pendente inválida.");
  const validatedPayload = tool.validateArgs(input.payload);
  if (stableJson(validatedPayload) !== stableJson(stored.args)) throw new Error("O payload da ação não confere com a aprovação pendente.");
  stored.state = "EXECUTING";
  return { ...stored, args: validatedPayload };
}

export function completePendingHermesAction(actionId: string): void {
  pendingActions.delete(actionId);
}

export function releasePendingHermesAction(actionId: string): void {
  const stored = pendingActions.get(actionId);
  if (stored?.state === "EXECUTING") stored.state = "PENDING_APPROVAL";
}

export function cancelPendingHermesAction(input: { actionId: string; actionType: HermesActionType; clientId: string; userId: string }): void {
  const stored = pendingActions.get(input.actionId);
  if (!stored || stored.expiresAt <= Date.now()) {
    pendingActions.delete(input.actionId);
    throw new Error("Ação pendente ausente ou expirada.");
  }
  if (stored.state !== "PENDING_APPROVAL" || stored.clientId !== input.clientId || stored.userId !== input.userId || stored.actionType !== input.actionType) {
    throw new Error("Ação pendente não pertence à sessão autenticada.");
  }
  pendingActions.delete(input.actionId);
}

// ─── Helpers de chamada HTTP Gemini ──────────────────────────────────────────

interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text?: string; functionCall?: any; functionResponse?: any }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  tools?: any[];
  systemInstruction?: { parts: Array<{ text: string }> } | string;
  generationConfig?: { temperature?: number; maxOutputTokens?: number };
}

type GeminiHttpRequest = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

/** Requisição padrão com timeout explícito para não travar o chat quando o provedor demora. */
const defaultGeminiRequest: GeminiHttpRequest = async (url, init) => {
  const signal = (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function")
    ? AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS)
    : undefined;
  const controller = signal ? undefined : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS) : undefined;
  try {
    return await fetch(url, { ...init, signal: signal || controller?.signal });
  } catch (error: any) {
    if (signal?.aborted || controller?.signal?.aborted || error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(`Gemini API excedeu o tempo limite de ${GEMINI_REQUEST_TIMEOUT_MS / 1000}s.`);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export class GeminiProviderError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly providerStatus?: unknown,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "GeminiProviderError";
  }
}

function stringifyGeminiErrorDetails(details: unknown): string {
  if (details === undefined) return "";
  try {
    return ` details=${JSON.stringify(details)}`;
  } catch {
    return " details=[unserializable]";
  }
}

function toTextOnlyGeminiRequest(body: GeminiRequest): GeminiRequest {
  const { tools: _tools, ...textOnlyBody } = body;
  const contents = body.contents
    .map(content => ({
      ...content,
      parts: content.parts.filter(part => typeof part.text === "string" && part.text.trim().length > 0),
    }))
    .filter(content => content.parts.length > 0);
  return { ...textOnlyBody, contents };
}

function webSearchFallback(message: string): string {
  return JSON.stringify({ ok: false, results: [], message });
}

/**
 * Executa uma consulta de leitura com Google Search Grounding via Gemini.
 * Falhas do provedor são retornadas como resultado estruturado para não derrubar
 * a conversa nem permitir que o chamador tente uma operação fora do registry.
 */
export async function executeWebSearch(
  geminiKey: string,
  query: string,
  focus?: string,
  request: GeminiHttpRequest = defaultGeminiRequest,
): Promise<string> {
  const prompt = [
    "Pesquise na web e retorne resultados públicos de forma estruturada, incluindo nomes, contatos publicados, links e um resumo objetivo quando disponíveis.",
    focus ? `Foco da pesquisa: ${focus}.` : undefined,
    `Consulta: ${query}`,
  ].filter(Boolean).join("\n");

  try {
    const response = await request(`${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.2 },
      }),
    });
    const data = await response.json() as any;
    if (!response.ok) return webSearchFallback("Pesquisa web temporariamente indisponível.");

    const result = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((part: { text?: unknown }) => typeof part.text === "string" ? part.text.trim() : "")
      .filter(Boolean)
      .join("\n");
    if (!result) return webSearchFallback("A pesquisa web não retornou resultados textuais.");

    const sources = (data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
      .map((chunk: { web?: { uri?: unknown; title?: unknown } }) => {
        const web = chunk.web;
        if (!web || typeof web.uri !== "string") return null;
        return { url: web.uri, ...(typeof web.title === "string" ? { title: web.title } : {}) };
      })
      .filter((source: { url: string } | null): source is { url: string; title?: string } => source !== null);

    return JSON.stringify({ ok: true, query, ...(focus ? { focus } : {}), result, sources });
  } catch {
    return webSearchFallback("Pesquisa web temporariamente indisponível.");
  }
}

export async function callGeminiAPI(
  apiKey: string,
  body: GeminiRequest,
  request: GeminiHttpRequest = defaultGeminiRequest,
): Promise<any> {
  const normalizedApiKey = normalizeGeminiApiKey(apiKey);
  if (!normalizedApiKey) throw new Error("Chave da API Gemini não configurada.");
  const normalizedBody = {
    ...body,
    ...(body.systemInstruction
      ? {
          systemInstruction:
            typeof body.systemInstruction === "string"
              ? { parts: [{ text: body.systemInstruction }] }
              : body.systemInstruction,
        }
      : {}),
  };
  const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(normalizedApiKey)}`;
  const timeoutSignal = (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function")
    ? AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS)
    : undefined;
  const response = await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalizedBody),
    ...(timeoutSignal ? { signal: timeoutSignal } : {}),
  });
  const data = await response.json() as any;
  if (!response.ok) {
    const errMsg = data?.error?.message ?? `HTTP ${response.status}`;
    const errStatus = data?.error?.status;
    const details = data?.error?.details;
    const providerError = new GeminiProviderError(
      `Gemini API HTTP ${response.status}${errStatus ? ` ${String(errStatus)}` : ""}: ${String(errMsg)}${stringifyGeminiErrorDetails(details)}`,
      response.status,
      errStatus,
      details,
    );
    if (response.status === 400 && body.tools?.length) {
      console.warn("[Assistant] Gemini rejected the tools payload; retrying once without tools.", {
        message: providerError.message,
        details: providerError.details,
      });
      return callGeminiAPI(normalizedApiKey, toTextOnlyGeminiRequest(body), request);
    }
    console.error("[Assistant] Gemini provider request failed:", {
      message: providerError.message,
      stack: providerError.stack,
      details: providerError.details,
    });
    throw providerError;
  }
  return data;
}

function isGeminiCredentialFailure(error: unknown): boolean {
  if (!(error instanceof GeminiProviderError)) return false;
  const details = stringifyGeminiErrorDetails(error.details);
  return /api[_\s-]?key|permission[_\s-]?denied|unauthenticated/i.test(
    `${error.message} ${String(error.providerStatus ?? "")} ${details}`,
  );
}

export async function callGeminiWithEnvironmentFallback(
  apiKey: string,
  body: GeminiRequest,
  request: GeminiHttpRequest = defaultGeminiRequest,
): Promise<{ data: any; apiKey: string }> {
  const normalizedApiKey = normalizeGeminiApiKey(apiKey);
  if (!normalizedApiKey) throw new Error("Chave da API Gemini não configurada.");

  try {
    return { data: await callGeminiAPI(normalizedApiKey, body, request), apiKey: normalizedApiKey };
  } catch (error) {
    const environmentKey = getEnvironmentGeminiApiKey();
    if (!environmentKey || environmentKey === normalizedApiKey || !isGeminiCredentialFailure(error)) throw error;

    console.warn("[Assistant] Tenant Gemini credential was rejected; retrying once with the configured environment credential.", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { data: await callGeminiAPI(environmentKey, body, request), apiKey: environmentKey };
  }
}

/** Testa a conexão com a API Gemini usando fetch direto */
export async function testGeminiConnection(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const data = await callGeminiAPI(apiKey, {
      contents: [{ role: "user", parts: [{ text: "Responda apenas com a palavra: OK" }] }],
      generationConfig: { maxOutputTokens: 100 },
    });
    // Aceita qualquer resposta válida — o modelo pode retornar texto vazio se usar tokens de pensamento
    const candidates = data?.candidates ?? [];
    const text: string = candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const finishReason: string = candidates?.[0]?.finishReason ?? "";
    // Se chegou aqui sem erro, a chave é válida
    if (candidates.length > 0 || data?.usageMetadata) {
      const resposta = text.length > 0 ? `"${text.slice(0, 50)}"` : `(modelo: ${data?.modelVersion ?? GEMINI_MODEL}, tokens: ${data?.usageMetadata?.totalTokenCount ?? "?"})`;
      return { ok: true, message: `Conexão com Gemini IA validada com sucesso. ${resposta}` };
    }
    return { ok: false, message: "Gemini não retornou resposta válida." };
  } catch (err: any) {
    const errMsg: string = err?.message ?? "Erro desconhecido";
    if (errMsg.includes("API_KEY_INVALID") || errMsg.includes("API key not valid")) {
      return { ok: false, message: "Token inválido. Verifique a chave da API Gemini." };
    } else if (errMsg.includes("PERMISSION_DENIED")) {
      return { ok: false, message: "Permissão negada. Verifique se a chave tem acesso ao Gemini." };
    } else if (errMsg.includes("QUOTA_EXCEEDED") || errMsg.includes("quota")) {
      return { ok: false, message: "Cota da API Gemini excedida. Verifique seu plano." };
    } else if (errMsg.includes("RESOURCE_EXHAUSTED")) {
      return { ok: false, message: "Limite de requisições atingido. Tente novamente em alguns segundos." };
    }
    return { ok: false, message: `Erro ao conectar com Gemini: ${errMsg.slice(0, 120)}` };
  }
}

// ─── Helpers de banco ─────────────────────────────────────────────────────────

/** Busca o token Gemini e a quota mensal do cliente */
export async function getClientGeminiConfig(clientId: string): Promise<{ geminiKey: string | null; geminiQuotaMensal: number }> {
  const pool = getPool();
  const [rows] = await pool.execute(
    "SELECT integrations_json FROM megadesk_domain_clients WHERE client_id = ? LIMIT 1",
    [clientId]
  ) as any[];
  if (!rows || rows.length === 0) return { geminiKey: getEnvironmentGeminiApiKey(), geminiQuotaMensal: 0 };
  try {
    const integrations = JSON.parse(rows[0].integrations_json ?? "{}");
    return {
      geminiKey: normalizeGeminiApiKey(integrations.geminiKey) ?? getEnvironmentGeminiApiKey(),
      geminiQuotaMensal: Number(integrations.geminiQuotaMensal ?? 0),
    };
  } catch {
    return { geminiKey: getEnvironmentGeminiApiKey(), geminiQuotaMensal: 0 };
  }
}

/** Busca o total de tokens usados no mês atual pelo cliente */
/**
 * Consulta isolada para que falhas possam ser testadas sem abrir conexão.
 * Nunca transforma uma indisponibilidade do banco em consumo zero: a quota é
 * um controle de segurança e deve falhar fechada.
 */
export async function readMonthlyTokenUsage(execute: SqlExecutor, clientId: string): Promise<number> {
  const result = await execute(
    `SELECT COALESCE(SUM(tokens_used), 0) as total
     FROM megadesk_domain_ia_conversations
     WHERE client_id = ? AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())`,
    [clientId]
  ) as [Array<{ total?: unknown }>];
  const total = Number(result[0]?.[0]?.total ?? 0);
  if (!Number.isFinite(total) || total < 0) {
    throw new Error("Não foi possível validar o consumo mensal de tokens.");
  }
  return Math.floor(total);
}

/** Busca o total de tokens usados no mês atual pelo cliente, falhando fechada. */
export async function getClientTokensUsedThisMonth(clientId: string): Promise<number> {
  const pool = getPool();
  try {
    return await readMonthlyTokenUsage((sql, values) => pool.execute(sql, values as any), clientId);
  } catch {
    throw new Error("Não foi possível validar a quota de IA no momento. Tente novamente mais tarde.");
  }
}

/** Retorna o status da IA do cliente: ativa, inativa, quota_atingida */
export async function getClientIAStatus(clientId: string): Promise<{
  status: "ativa" | "inativa" | "quota_atingida";
  geminiKey: string | null;
  geminiQuotaMensal: number;
  tokensUsadosMes: number;
  percentualUso: number;
}> {
  const config = await getClientGeminiConfig(clientId);
  if (!config.geminiKey) {
    return { status: "inativa", geminiKey: null, geminiQuotaMensal: 0, tokensUsadosMes: 0, percentualUso: 0 };
  }
  const tokensUsadosMes = await getClientTokensUsedThisMonth(clientId);
  const quota = config.geminiQuotaMensal;
  const percentualUso = quota > 0 ? Math.round((tokensUsadosMes / quota) * 100) : 0;
  if (quota > 0 && tokensUsadosMes >= quota) {
    return { status: "quota_atingida", geminiKey: config.geminiKey, geminiQuotaMensal: quota, tokensUsadosMes, percentualUso };
  }
  return { status: "ativa", geminiKey: config.geminiKey, geminiQuotaMensal: quota, tokensUsadosMes, percentualUso };
}

/** Busca o token Gemini do cliente diretamente na tabela megadesk_domain_clients */
export async function getClientGeminiToken(clientId: string): Promise<string | null> {
  return (await getClientGeminiConfig(clientId)).geminiKey;
}

/** Carrega histórico de conversa do usuário no banco */
export async function loadConversationHistory(clientId: string, userId: string): Promise<IAMessage[]> {
  const pool = getPool();
  const [rows] = await pool.execute(
    "SELECT messages_json FROM megadesk_domain_ia_conversation_history WHERE client_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 1",
    [clientId, userId]
  ) as any[];
  if (!rows || rows.length === 0) return [];
  try {
    return JSON.parse(rows[0].messages_json ?? "[]");
  } catch {
    return [];
  }
}

/**
 * Persiste IMEDIATAMENTE a mensagem do usuário, antes de qualquer chamada ao provedor.
 * Se o Gemini falhar ou o usuário recarregar a página, a mensagem permanece no histórico.
 */
export async function persistUserMessageImmediately(
  clientId: string,
  userId: string,
  previousHistory: IAMessage[],
  userMessage: string,
): Promise<IAMessage[]> {
  const userEntry: IAMessage = { role: "user", content: userMessage, timestamp: Date.now() };
  const next: IAMessage[] = [...previousHistory, userEntry].slice(-50);
  await saveConversationHistory(clientId, userId, next);
  return next;
}

/**
 * Persiste uma mensagem gerada pelo assistente (ex.: confirmação ou cancelamento de ação HITL)
 * diretamente no histórico do banco, garantindo que permaneça visível após reload/troca de abas.
 */
export async function appendAssistantMessageToHistory(
  clientId: string,
  userId: string,
  content: string,
): Promise<IAMessage[]> {
  const current = await loadConversationHistory(clientId, userId);
  const assistantEntry: IAMessage = { role: "assistant", content, timestamp: Date.now() };
  const next: IAMessage[] = [...current, assistantEntry].slice(-50);
  await saveConversationHistory(clientId, userId, next);
  return next;
}

/** Salva/atualiza histórico de conversa do usuário no banco */
export async function saveConversationHistory(
  clientId: string,
  userId: string,
  messages: IAMessage[]
): Promise<void> {
  const pool = getPool();
  const historyId = nanoid();
  const messagesJson = JSON.stringify(messages);
  await pool.execute(
    `INSERT INTO megadesk_domain_ia_conversation_history 
      (history_id, client_id, user_id, messages_json, context_json)
     VALUES (?, ?, ?, ?, '{}')
     ON DUPLICATE KEY UPDATE messages_json = VALUES(messages_json), updated_at = NOW()`,
    [historyId, clientId, userId, messagesJson]
  );
}

/** Registra uma troca de mensagem no log de conversas IA */
export async function logIAConversation(
  clientId: string,
  userId: string,
  userMessage: string,
  iaResponse: string,
  tokensUsed: number,
  status: "sucesso" | "erro" = "sucesso",
  errorMessage?: string
): Promise<string> {
  const pool = getPool();
  const conversationId = nanoid();
  await pool.execute(
    `INSERT INTO megadesk_domain_ia_conversations 
      (conversation_id, client_id, user_id, user_message, ia_response, tokens_used, tipo, status, error_message, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, 'consulta', ?, ?, '{}')`,
    [conversationId, clientId, userId, userMessage, iaResponse, tokensUsed, status, errorMessage ?? null]
  );
  return conversationId;
}

export interface TokenUsageRecord {
  clientId: string;
  userEmail: string;
  conversationId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  functionCallsCount: number;
}

/** Gravação detalhada mantida no backend para impedir números forjados pelo navegador. */
export async function insertTokenUsage(execute: SqlExecutor, usage: TokenUsageRecord): Promise<string> {
  const id = `tu-${nanoid()}`;
  await execute(
    `INSERT INTO megadesk_ia_token_usage
      (id, client_id, user_email, conversation_id, prompt_tokens, completion_tokens, total_tokens, model, function_calls_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      usage.clientId,
      usage.userEmail,
      usage.conversationId,
      usage.promptTokens,
      usage.completionTokens,
      usage.totalTokens,
      usage.model,
      usage.functionCallsCount,
      Date.now(),
    ]
  );
  return id;
}

async function recordTokenUsage(usage: TokenUsageRecord): Promise<string> {
  const pool = getPool();
  return insertTokenUsage((sql, values) => pool.execute(sql, values as any), usage);
}

// ─── Function Calling — consultas ao banco do cliente ─────────────────────────

/** Busca dados do ERP/conversas/chamados do cliente para o Gemini */
export async function executeClientFunction(
  functionName: string,
  args: Record<string, unknown>,
  clientId: string,
  permissions: readonly string[],
  geminiKey?: string,
  userId?: string,
): Promise<string> {
  try {
    const tool = getAuthorizedHermesTool(functionName, permissions);
    if (!tool) {
      return JSON.stringify({ success: false, error: "Você não possui permissão para consultar dados deste módulo." });
    }
    // Validação ocorre novamente no executor, mesmo se o modelo recebeu a tool.
    const validatedArgs = tool.validateArgs(args);
  if (functionName === "web_search") {
    if (!geminiKey) return webSearchFallback("Pesquisa web indisponível: credencial do provedor ausente.");
    const search = validatedArgs as { query: string; focus?: string };
    return executeWebSearch(geminiKey, search.query, search.focus);
  }
  if (functionName === "get_whatsapp_status") {
    const status = await evoGetStatus(instanceNameFor(clientId));
    return JSON.stringify({ status });
  }
  const pool = getPool();

  if (functionName === "set_user_preference") {
    const prefs = validatedArgs as { preferredName?: string; honorific?: string; communicationStyle?: string; customRule?: string };
    if (userId) {
      await saveUserHermesPreferences(clientId, userId, {
        preferredName: prefs.preferredName,
        honorific: prefs.honorific,
        communicationStyle: prefs.communicationStyle,
        customRules: prefs.customRule ? [prefs.customRule] : undefined,
      }, pool);
    }
    return JSON.stringify({
      success: true,
      message: "Preferências de usuário atualizadas com sucesso.",
      updated: prefs,
    });
  }

  if (functionName === "get_sales_summary") {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as total, SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.value')) AS DECIMAL(10,2))) as total_value
       FROM megadesk_domain_operational_records 
       WHERE client_id = ? AND record_type = 'sale' AND DATE(created_at) = CURDATE()`,
      [clientId]
    ) as any[];
    const data = rows[0] ?? { total: 0, total_value: 0 };
    return JSON.stringify({ vendas_hoje: data.total, valor_total: data.total_value ?? 0 });
  }

  if (functionName === "get_open_tickets") {
    const filters = (validatedArgs ?? {}) as { search?: string; ticketNumber?: number };
    const where = [
      "clientId = ?",
      "LOWER(status) IN ('open', 'aberto', 'pendente', 'em_andamento', 'in_progress', 'aguardando')",
    ];
    const values: unknown[] = [clientId];
    const searchTerm = filters.search ?? (filters.ticketNumber !== undefined ? String(filters.ticketNumber) : undefined);
    if (searchTerm) {
      where.push("(title LIKE ? OR customerName LIKE ? OR company LIKE ? OR CAST(chamadoNumber AS CHAR) LIKE ? OR LPAD(CAST(chamadoNumber AS CHAR), 4, '0') LIKE ? OR chamadoId LIKE ?)");
      const query = `%${searchTerm.trim()}%`;
      values.push(query, query, query, query, query, query);
    }
    const [totalsRows] = await pool.execute(
      `SELECT COUNT(*) as total, 
       SUM(CASE WHEN LOWER(priority) IN ('alta', 'critica', 'high', 'urgent') THEN 1 ELSE 0 END) as urgentes
       FROM megadesk_domain_chamados 
       WHERE ${where.join(" AND ")}`,
      values
    ) as any[];
    const [recentRows] = await pool.execute(
      `SELECT chamadoId, chamadoNumber, title, customerName, company, status, priority, assignedTo, updatedAt
       FROM megadesk_domain_chamados 
       WHERE ${where.join(" AND ")}
       ORDER BY updatedAt DESC, chamadoNumber DESC LIMIT 10`,
      values
    ) as any[];
    const data = totalsRows?.[0] ?? { total: 0, urgentes: 0 };
    return JSON.stringify({
      total: data.total ?? 0,
      chamados_abertos: data.total ?? 0,
      urgentes: data.urgentes ?? 0,
      resumo: { total: data.total ?? 0, urgentes: data.urgentes ?? 0 },
      chamados: Array.isArray(recentRows) ? recentRows : [],
    });
  }

  if (functionName === "get_tickets_overview") {
    const filters = validatedArgs as { status?: string; search?: string; limit?: number };
    const where = ["clientId = ?"];
    const values: unknown[] = [clientId];
    if (filters.status) {
      const statusMap: Record<string, string> = { resolved: "closed", pending: "waiting" };
      const normalizedStatus = statusMap[filters.status] ?? filters.status;
      where.push("status = ?");
      values.push(normalizedStatus);
    }
    if (filters.search) {
      where.push("(title LIKE ? OR customerName LIKE ? OR company LIKE ? OR CAST(chamadoNumber AS CHAR) LIKE ? OR LPAD(CAST(chamadoNumber AS CHAR), 4, '0') LIKE ?)");
      const query = `%${filters.search}%`;
      values.push(query, query, query, query, query);
    }
    const [totalsRows] = await pool.execute(
      `SELECT COUNT(*) AS total,
              SUM(status = 'open') AS open,
              SUM(status = 'in_progress') AS in_progress,
              SUM(status = 'waiting') AS waiting,
              SUM(status = 'closed') AS closed
         FROM megadesk_domain_chamados WHERE ${where.join(" AND ")}`,
      values,
    ) as any[];
    const [recentRows] = await pool.execute(
      `SELECT chamadoId, chamadoNumber, title, customerName, company, status, priority, assignedTo, createdAt, updatedAt
         FROM megadesk_domain_chamados WHERE ${where.join(" AND ")}
        ORDER BY updatedAt DESC, chamadoNumber DESC LIMIT ?`,
      [...values, filters.limit ?? 10],
    ) as any[];
    const totals = totalsRows[0] ?? { total: 0, open: 0, in_progress: 0, waiting: 0, closed: 0 };
    const tickets = (Array.isArray(recentRows) ? recentRows : []).map(r => ({
      id: r.chamadoId,
      ticketNumber: r.chamadoNumber,
      title: r.title,
      customer: r.customerName || r.company || "",
      status: r.status,
      priority: r.priority,
      createdAt: r.createdAt || r.updatedAt,
    }));
    return JSON.stringify({
      total: Number(totals.total ?? 0),
      open: Number(totals.open ?? 0),
      inProgress: Number(totals.in_progress ?? 0),
      pending: Number(totals.waiting ?? 0),
      tickets,
      resumo: totals,
      chamados: recentRows,
    });
  }

  if (functionName === "get_ticket_details") {
    const selector = validatedArgs as { ticketId?: string; ticketNumber?: number | string };
    const num = selector.ticketNumber !== undefined && !isNaN(Number(selector.ticketNumber)) ? Number(selector.ticketNumber) : undefined;
    const predicate = num !== undefined ? "chamadoNumber = ?" : "chamadoId = ?";
    const value = num !== undefined ? num : (selector.ticketId ?? selector.ticketNumber);
    const [ticketRows] = await pool.execute(
      `SELECT chamadoId, chamadoNumber, customerId, customerName, company, title, observations, status, priority, assignedTo, assigned_to_user_id AS assignedToUserId, createdAt, updatedAt
         FROM megadesk_domain_chamados WHERE clientId = ? AND ${predicate} LIMIT 1`,
      [clientId, value],
    ) as any[];
    const ticket = ticketRows[0];
    if (!ticket) {
      const target = selector.ticketId ?? selector.ticketNumber ?? "";
      return JSON.stringify({ found: false, message: target ? `Chamado ${target} não encontrado no sistema.` : "Chamado não encontrado no sistema." });
    }
    const [activityRows] = await pool.execute(
      `SELECT activity_id AS activityId, description, attendant, action_type AS actionType, created_at AS createdAt
         FROM megadesk_domain_chamado_activities
        WHERE client_id = ? AND chamado_id = ? ORDER BY created_at DESC, activity_id DESC LIMIT 50`,
      [clientId, ticket.chamadoId],
    ) as any[];
    const actList = Array.isArray(activityRows) ? activityRows : [];
    const timeline = actList.map(r => ({
      date: r.createdAt,
      action: r.description,
      author: r.attendant,
    }));
    const notes = actList
      .filter(r => r.actionType === "note" || String(r.description).startsWith("[Nota"))
      .map(r => String(r.description));
    return JSON.stringify({
      id: ticket.chamadoId,
      ticketNumber: ticket.chamadoNumber,
      title: ticket.title,
      description: ticket.observations,
      customer: ticket.customerName || ticket.company || "",
      status: ticket.status,
      priority: ticket.priority,
      assignedOperator: ticket.assignedTo || "",
      timeline,
      notes,
      chamado: ticket,
      atividades: actList,
    });
  }

  if (functionName === "get_crm_summary") {
    const filters = (validatedArgs ?? {}) as { period?: string };
    const period = filters.period || "month";
    const periodClause = period === "today"
      ? "DATE(created_at) = CURDATE()"
      : period === "year"
      ? "created_at >= DATE_FORMAT(CURDATE(), '%Y-01-01')"
      : "created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')";

    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS total,
              SUM(lifecycle_state = 'active') AS active,
              SUM(lifecycle_state = 'inactive') AS inactive,
              SUM(status = 'lead') AS leads
         FROM megadesk_crm_clients
        WHERE client_id = ? AND lifecycle_state <> 'archived'`,
      [clientId],
    ) as any[];
    const [periodLeadsRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM megadesk_crm_clients
        WHERE client_id = ? AND lifecycle_state <> 'archived' AND status = 'lead' AND ${periodClause}`,
      [clientId],
    ) as any[];
    const [statusRows] = await pool.execute(
      `SELECT status, COUNT(*) AS cnt FROM megadesk_crm_clients
        WHERE client_id = ? AND lifecycle_state <> 'archived' GROUP BY status`,
      [clientId],
    ) as any[];
    const statusDistribution: Record<string, number> = {};
    if (Array.isArray(statusRows)) {
      for (const sr of statusRows) {
        if (sr.status) statusDistribution[sr.status] = Number(sr.cnt ?? 0);
      }
    }
    const [latestRows] = await pool.execute(
      `SELECT crm_client_id AS crmClientId, company_name AS name, phone, email, created_at AS createdAt
         FROM megadesk_crm_clients WHERE client_id = ? AND lifecycle_state <> 'archived'
        ORDER BY created_at DESC LIMIT 5`,
      [clientId],
    ) as any[];
    const totalClients = Number(rows[0]?.total ?? 0);
    const activeCustomersCount = Number(rows[0]?.active ?? 0);
    const newLeadsCount = Number(periodLeadsRows[0]?.total ?? rows[0]?.leads ?? 0);
    return JSON.stringify({
      totalClients,
      newLeadsCount,
      activeCustomersCount,
      statusDistribution,
      resumo: { ...(rows[0] ?? { total: 0, active: 0, inactive: 0, leads: 0 }), newThisMonth: newLeadsCount },
      ultimosClientes: latestRows,
    });
  }

  if (functionName === "list_crm_clients") {
    const filters = (validatedArgs ?? {}) as { search?: string; limit?: number };
    const limit = Math.min(Math.max(Number(filters.limit ?? 10) || 10, 1), 20);
    const values: unknown[] = [clientId];
    let predicate = "";
    if (filters.search) {
      predicate = " AND (company_name LIKE ? OR phone LIKE ? OR email LIKE ?)";
      const query = `%${filters.search}%`;
      values.push(query, query, query);
    }
    const [listRows] = await pool.execute(
      `SELECT crm_client_id AS crmClientId, company_name AS name, phone, email, status, created_at AS createdAt
         FROM megadesk_crm_clients WHERE client_id = ? AND lifecycle_state <> 'archived'${predicate}
        ORDER BY created_at DESC LIMIT ${limit}`,
      values,
    ) as any[];
    return JSON.stringify({ total: Array.isArray(listRows) ? listRows.length : 0, clientes: Array.isArray(listRows) ? listRows : [] });
  }

  if (functionName === "get_client_360") {
    const lookup = validatedArgs as { clientId?: string; search?: string };
    const predicate = lookup.clientId
      ? "crm_client_id = ?"
      : "(company_name LIKE ? OR responsible_name LIKE ? OR phone LIKE ? OR email LIKE ? OR cpf_cnpj LIKE ?)";
    const lookupValue = lookup.clientId ?? `%${lookup.search}%`;
    const clientValues = lookup.clientId
      ? [clientId, lookupValue]
      : [clientId, lookupValue, lookupValue, lookupValue, lookupValue, lookupValue];
    const [clientRows] = await pool.execute(
      `SELECT crm_client_id AS crmClientId, company_name AS name, responsible_name AS responsibleName,
              cpf_cnpj AS cpfCnpj, phone, whatsapp, email, status, lifecycle_state AS lifecycleState, observations, created_at AS createdAt, updated_at AS updatedAt
         FROM megadesk_crm_clients
        WHERE client_id = ? AND lifecycle_state <> 'archived' AND ${predicate}
        ORDER BY updated_at DESC LIMIT 1`,
      clientValues,
    ) as any[];
    const crmClient = clientRows[0];
    if (!crmClient) {
      const searchTarget = lookup.search ?? lookup.clientId ?? "";
      return JSON.stringify({
        found: false,
        search: searchTarget,
        message: searchTarget ? `Cliente ${searchTarget} não encontrado no cadastro.` : "Cliente não encontrado no cadastro.",
      });
    }
    const [timelineRows] = await pool.execute(
      `SELECT timeline_id AS timelineId, entry_type AS type, description, author, created_at AS createdAt
         FROM megadesk_crm_timeline
        WHERE client_id = ? AND crm_client_id = ? ORDER BY created_at DESC LIMIT 30`,
      [clientId, crmClient.crmClientId],
    ) as any[];
    const [ticketRows] = await pool.execute(
      `SELECT chamadoId, chamadoNumber, title, status, priority, updatedAt
         FROM megadesk_domain_chamados
        WHERE clientId = ? AND customerId = ? ORDER BY updatedAt DESC LIMIT 20`,
      [clientId, crmClient.crmClientId],
    ) as any[];
    const [conversationRows] = await pool.execute(
      `SELECT conversation_id AS conversationId, status, last_message AS lastMessage, updated_at AS updatedAt
         FROM megadesk_domain_conversations
        WHERE client_id = ? AND (customer_name = ? OR phone = ? OR phone = ?) ORDER BY updated_at DESC LIMIT 20`,
      [clientId, crmClient.name, crmClient.phone, crmClient.whatsapp],
    ) as any[];
    const [proposalRows] = await pool.execute(
      `SELECT COUNT(*) AS activeCount FROM erp_sale_orders
        WHERE client_id = ? AND crm_client_id = ? AND document_type = 'quote' AND commercial_status IN ('draft', 'negotiation')`,
      [clientId, crmClient.crmClientId],
    ) as any[];
    const [saleRows] = await pool.execute(
      `SELECT COUNT(*) AS saleCount FROM erp_sale_orders
        WHERE client_id = ? AND crm_client_id = ? AND document_type = 'sale' AND status <> 'cancelled'`,
      [clientId, crmClient.crmClientId],
    ) as any[];
    const openTicketsCount = (Array.isArray(ticketRows) ? ticketRows : []).filter(t => t.status === "open" || t.status === "in_progress" || t.status === "waiting").length;
    const activeProposalsCount = Number(proposalRows?.[0]?.activeCount ?? 0);
    const totalPurchasesCount = Number(saleRows?.[0]?.saleCount ?? 0);
    const lastInteractions = [
      ...(Array.isArray(timelineRows) ? timelineRows.map(t => `${t.type}: ${t.description}`) : []),
      ...(Array.isArray(conversationRows) ? conversationRows.map(c => `WhatsApp: ${c.lastMessage}`) : []),
    ].slice(0, 5);

    return JSON.stringify({
      found: true,
      client: {
        id: crmClient.crmClientId,
        name: crmClient.name,
        document: crmClient.cpfCnpj ?? "",
        phone: crmClient.phone ?? "",
        email: crmClient.email ?? "",
        status: crmClient.status ?? "active",
        openTickets: openTicketsCount,
        activeProposals: activeProposalsCount,
        totalPurchases: totalPurchasesCount,
        lastInteractions,
      },
      cliente: crmClient,
      timeline: timelineRows,
      chamados: ticketRows,
      conversas: conversationRows,
    });
  }

  if (functionName === "get_proposals_summary") {
    const filters = validatedArgs as { status?: string; sellerId?: string; period?: string };
    const where = ["o.client_id = ?", "o.document_type = 'quote'"];
    const values: unknown[] = [clientId];
    if (filters.status) { where.push("o.commercial_status = ?"); values.push(filters.status); }
    if (filters.sellerId) { where.push("o.seller_user_id = ?"); values.push(filters.sellerId); }
    if (filters.period) { where.push("o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"); values.push(Number(filters.period)); }
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS total, COALESCE(SUM(o.total_cents), 0) AS totalCents,
              SUM(o.commercial_status = 'draft') AS drafts, SUM(o.commercial_status = 'negotiation') AS negotiation,
              SUM(o.commercial_status = 'approved') AS approved, SUM(o.commercial_status = 'lost') AS lost
         FROM erp_sale_orders o WHERE ${where.join(" AND ")}`,
      values,
    ) as any[];
    const [proposalListRows] = await pool.execute(
      `SELECT o.public_id AS id, o.order_number AS orderNumber, c.company_name AS clientName,
              o.total_cents AS totalCents, o.commercial_status AS status, o.created_at AS createdAt
         FROM erp_sale_orders o
         LEFT JOIN megadesk_crm_clients c ON c.crm_client_id = o.crm_client_id AND c.client_id = o.client_id
        WHERE ${where.join(" AND ")} ORDER BY o.created_at DESC LIMIT 50`,
      values,
    ) as any[];
    const resumo = rows[0] ?? { total: 0, totalCents: 0, drafts: 0, negotiation: 0, approved: 0, lost: 0 };
    const proposals = (Array.isArray(proposalListRows) ? proposalListRows : []).map(p => ({
      id: p.id,
      orderNumber: p.orderNumber,
      clientName: p.clientName || "Cliente",
      totalValue: Number(p.totalCents ?? 0) / 100,
      status: p.status,
      createdAt: p.createdAt,
    }));
    return JSON.stringify({
      total: Number(resumo.total ?? 0),
      totalValue: Number(resumo.totalCents ?? 0) / 100,
      draftCount: Number(resumo.drafts ?? 0),
      negotiationCount: Number(resumo.negotiation ?? 0),
      approvedCount: Number(resumo.approved ?? 0),
      proposals,
      resumo,
    });
  }

  if (functionName === "get_proposal_details") {
    const lookup = validatedArgs as { proposalId?: string; orderNumber?: string; proposalNumber?: string };
    const predicate = lookup.proposalId ? "o.public_id = ?" : "o.order_number = ?";
    const targetVal = lookup.proposalId ?? lookup.orderNumber ?? lookup.proposalNumber;
    const [orderRows] = await pool.execute(
      `SELECT o.id, o.public_id AS publicId, o.order_number AS orderNumber, o.commercial_status AS commercialStatus,
              o.total_cents AS totalCents, o.notes, o.payment_terms_snapshot AS paymentTerms, o.created_at AS createdAt,
              c.crm_client_id AS crmClientId, c.company_name AS clientName, c.phone AS clientPhone
         FROM erp_sale_orders o JOIN megadesk_crm_clients c ON c.crm_client_id = o.crm_client_id AND c.client_id = o.client_id
        WHERE o.client_id = ? AND o.document_type = 'quote' AND ${predicate} LIMIT 1`,
      [clientId, targetVal],
    ) as any[];
    const proposal = orderRows[0];
    if (!proposal) {
      const target = targetVal ?? "";
      return JSON.stringify({ found: false, message: target ? `Proposta ${target} não encontrada no sistema.` : "Proposta não encontrada no sistema." });
    }
    const [itemRows] = await pool.execute(
      `SELECT public_id AS publicId, product_name_snapshot AS productName, sku_snapshot AS sku, quantity,
              unit_price_cents AS unitPriceCents, discount_cents AS discountCents, line_total_cents AS lineTotalCents
         FROM erp_sale_order_items WHERE sale_order_id = ? ORDER BY id ASC`,
      [proposal.id],
    ) as any[];
    const items = (Array.isArray(itemRows) ? itemRows : []).map(i => ({
      name: i.productName || i.sku || "Item",
      quantity: Number(i.quantity ?? 1),
      unitPrice: Number(i.unitPriceCents ?? 0) / 100,
      total: Number(i.lineTotalCents ?? 0) / 100,
    }));
    return JSON.stringify({
      id: proposal.publicId,
      orderNumber: proposal.orderNumber,
      clientName: proposal.clientName,
      status: proposal.commercialStatus,
      totalValue: Number(proposal.totalCents ?? 0) / 100,
      items,
      paymentTerms: proposal.paymentTerms || "",
      deliveryForecast: "",
      proposta: proposal,
      itens: itemRows,
    });
  }

  if (functionName === "get_erp_summary") {
    const [productRows] = await pool.execute(`SELECT COUNT(*) total, SUM(active = 1) active, SUM(active = 1 AND quantity <= 0) empty, SUM(active = 1 AND quantity > 0 AND quantity <= minimum_stock) low FROM erp_products WHERE client_id = ? AND active <> -1`, [clientId]) as any[];
    const [serviceRows] = await pool.execute(`SELECT COUNT(*) total FROM megadesk_erp_services WHERE client_id = ? AND is_active = 1`, [clientId]) as any[];
    return JSON.stringify({ produtos: productRows[0] ?? { total: 0, active: 0, empty: 0, low: 0 }, servicosAtivos: serviceRows[0]?.total ?? 0 });
  }

  if (functionName === "get_product_details") {
    const lookup = validatedArgs as { productId?: string; sku?: string };
    const predicate = lookup.productId ? "p.public_id = ?" : "p.sku = ?";
    const [rows] = await pool.execute(`SELECT p.public_id publicId,p.name,p.sku,p.description,p.unit,p.cost_price_cents costPriceCents,p.sale_price_cents salePriceCents,p.quantity,p.minimum_stock minimumStock,p.active,p.category,ps.supplier_public_id supplierId,ps.supplier_legal_name supplierName FROM erp_products p LEFT JOIN erp_product_suppliers ps ON ps.product_id=p.id AND ps.client_id=p.client_id AND ps.is_preferred=1 AND ps.active=1 WHERE p.client_id=? AND p.active<>-1 AND ${predicate} LIMIT 1`, [clientId, lookup.productId ?? lookup.sku]) as any[];
    if (!rows[0]) {
      const target = lookup.sku ?? lookup.productId ?? "";
      return JSON.stringify({ found: false, message: target ? `Produto ${target} não encontrado no cadastro.` : "Produto não encontrado no cadastro." });
    }
    const [auditRows] = await pool.execute(`SELECT action,summary,created_at createdAt FROM erp_product_audit_logs WHERE client_id=? AND product_id=(SELECT id FROM erp_products WHERE client_id=? AND public_id=? LIMIT 1) ORDER BY created_at DESC LIMIT 20`, [clientId, clientId, rows[0].publicId]) as any[];
    const p = rows[0];
    return JSON.stringify({
      id: p.publicId,
      name: p.name,
      sku: p.sku,
      category: p.category || "",
      salePrice: Number(p.salePriceCents ?? 0) / 100,
      costPrice: Number(p.costPriceCents ?? 0) / 100,
      stock: Number(p.quantity ?? 0),
      minStock: Number(p.minimumStock ?? 0),
      supplierName: p.supplierName || "",
      history: auditRows,
      produto: p,
      timeline: auditRows,
    });
  }

  if (functionName === "get_inventory_status") {
    const filters = validatedArgs as { status?: string; search?: string };
    const where = ["client_id = ?", "active <> -1"]; const values: unknown[] = [clientId];
    if (filters.search) { where.push("(name LIKE ? OR sku LIKE ?)"); values.push(`%${filters.search}%`, `%${filters.search}%`); }
    if (filters.status === "empty") where.push("quantity <= 0");
    if (filters.status === "low") where.push("quantity > 0 AND quantity <= minimum_stock");
    if (filters.status === "regular") where.push("quantity > minimum_stock");
    const [rows] = await pool.execute(`SELECT public_id publicId,name,sku,quantity,minimum_stock minimumStock,unit FROM erp_products WHERE ${where.join(" AND ")} ORDER BY name LIMIT 100`, values) as any[];
    const items = (Array.isArray(rows) ? rows : []).map(r => ({
      id: r.publicId,
      name: r.name,
      sku: r.sku,
      stock: Number(r.quantity ?? 0),
      minStock: Number(r.minimumStock ?? 0),
      salePrice: 0,
      costPrice: 0,
    }));
    return JSON.stringify({ total: items.length, items, itens: rows });
  }

  if (functionName === "get_services_list") {
    const query = (validatedArgs as { search?: string }).search;
    const [rows] = await pool.execute(`SELECT id,name,code,category,price,estimated_cost estimatedCost,is_active isActive FROM megadesk_erp_services WHERE client_id=? ${query ? "AND (name LIKE ? OR code LIKE ? OR category LIKE ?)" : ""} ORDER BY name LIMIT 100`, query ? [clientId, `%${query}%`, `%${query}%`, `%${query}%`] : [clientId]) as any[];
    const services = (Array.isArray(rows) ? rows : []).map(r => ({
      id: r.id,
      name: r.name,
      defaultPrice: Number(r.price ?? 0),
      active: Boolean(r.isActive),
    }));
    return JSON.stringify({ total: services.length, services, servicos: rows });
  }

  if (functionName === "get_sales_analytics") {
    const filters = validatedArgs as { period: string; startDate?: string; endDate?: string };
    const range = filters.period === "today" ? ["CURDATE()", "CURDATE()"] : filters.period === "week" ? ["DATE_SUB(CURDATE(), INTERVAL 6 DAY)", "CURDATE()"] : filters.period === "month" ? ["DATE_FORMAT(CURDATE(), '%Y-%m-01')", "CURDATE()"] : ["?", "?"];
    const values: unknown[] = [clientId, ...(filters.period === "custom" ? [filters.startDate, filters.endDate] : [])];
    const [rows] = await pool.execute(`SELECT COUNT(*) orders,COALESCE(SUM(total_cents),0) revenueCents,COALESCE(AVG(total_cents),0) averageTicketCents FROM erp_sale_orders WHERE client_id=? AND document_type='sale' AND status<>'cancelled' AND DATE(created_at) BETWEEN ${range[0]} AND ${range[1]}`, values) as any[];
    return JSON.stringify({ analise: rows[0] ?? { orders: 0, revenueCents: 0, averageTicketCents: 0 } });
  }

  if (functionName === "get_suppliers_list") {
    const query = (validatedArgs as { search?: string }).search;
    const [rows] = await pool.execute(`SELECT public_id publicId,legal_name legalName,trade_name tradeName,tax_id taxId,phone,email,contact_name contactName,active FROM erp_suppliers WHERE client_id=? ${query ? "AND (legal_name LIKE ? OR trade_name LIKE ? OR tax_id LIKE ?)" : ""} ORDER BY legal_name LIMIT 100`, query ? [clientId, `%${query}%`, `%${query}%`, `%${query}%`] : [clientId]) as any[];
    const suppliers = (Array.isArray(rows) ? rows : []).map(r => ({
      id: r.publicId,
      name: r.legalName || r.tradeName || "",
      document: r.taxId || "",
      phone: r.phone || "",
      email: r.email || "",
      contactName: r.contactName || "",
    }));
    return JSON.stringify({ total: suppliers.length, suppliers });
  }

  if (functionName === "get_conversations_summary") {
    const filters = (validatedArgs ?? {}) as { status?: string; search?: string };
    const where = ["client_id = ?"];
    const values: unknown[] = [clientId];
    if (filters.status && filters.status !== "all") {
      where.push("status = ?");
      values.push(filters.status);
    }
    if (filters.search) {
      where.push("(customer_name LIKE ? OR phone LIKE ? OR company LIKE ?)");
      const q = `%${filters.search}%`;
      values.push(q, q, q);
    }
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as abertas,
              SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as fechadas
         FROM megadesk_domain_conversations
        WHERE ${where.join(" AND ")}`,
      values,
    ) as any[];
    const [listRows] = await pool.execute(
      `SELECT conversation_id, customer_name, phone, company, status, last_message, updated_at
         FROM megadesk_domain_conversations
        WHERE ${where.join(" AND ")}
        ORDER BY updated_at DESC LIMIT 20`,
      values,
    ) as any[];
    const counts = countRows[0] ?? { total: 0, abertas: 0, fechadas: 0 };
    const conversations = (Array.isArray(listRows) ? listRows : []).map(r => ({
      id: r.conversation_id,
      contactName: r.customer_name || r.company || "",
      phone: r.phone || "",
      lastMessage: r.last_message || "",
      updatedAt: r.updated_at,
      unreadCount: 0,
    }));
    return JSON.stringify({
      total: Number(counts.total ?? 0),
      conversations,
      conversas_7dias: Number(counts.total ?? 0),
      abertas: Number(counts.abertas ?? 0),
      fechadas: Number(counts.fechadas ?? 0),
    });
  }

  if (functionName === "extract_lead_from_conversation") {
    const filters = (validatedArgs ?? {}) as { conversationId?: string; phone?: string; search?: string };
    const where = ["client_id = ?"];
    const values: unknown[] = [clientId];
    if (filters.conversationId) {
      where.push("conversation_id = ?");
      values.push(filters.conversationId);
    } else if (filters.phone) {
      where.push("phone LIKE ?");
      values.push(`%${filters.phone.replace(/\D/g, "")}%`);
    } else if (filters.search) {
      where.push("(customer_name LIKE ? OR phone LIKE ?)");
      values.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    const [rows] = await pool.execute(
      `SELECT conversation_id, customer_name, phone, company, status, last_message, messages_json
         FROM megadesk_domain_conversations
        WHERE ${where.join(" AND ")}
        ORDER BY updated_at DESC LIMIT 1`,
      values,
    ) as any[];
    const conv = rows[0];
    if (!conv) {
      return JSON.stringify({ found: false, message: "Nenhuma conversa encontrada para os critérios informados." });
    }

    let allText = `${conv.customer_name || ""} ${conv.last_message || ""}`;
    try {
      const parsed = typeof conv.messages_json === "string" ? JSON.parse(conv.messages_json) : conv.messages_json;
      if (Array.isArray(parsed)) {
        allText += " " + parsed.map((m: any) => m.text || m.body || m.message || "").join(" ");
      }
    } catch {}

    const docMatch = allText.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/);
    const document = docMatch ? docMatch[0] : "";
    const vehicleRegex = /\b(?:carro|veículo|veiculo|moto|caminhão|placa|modelo|gol|onix|civic|corolla|hb20|hilux|palio|uno|fox|fit|ka|sandero|prisma|compass|renegade|creta|toro|strada|saveiro|kwid|polo|tracker|kicks|argo|mobi|etios|yaris|versa|cruze|spin|duster|ecosport|ranger|s10|amarok|l200|frontier)\b[^\n,.]*/i;
    const vehicleMatch = allText.match(vehicleRegex);
    const vehicle = vehicleMatch ? vehicleMatch[0].trim() : "";

    const serviceKeywords = ["lavagem", "troca de óleo", "troca de oleo", "correia dentada", "revisão", "revisao", "alinhamento", "balanceamento", "freio", "pastilha", "pneu", "suspensão", "suspensao", "embreagem", "filtro", "vela", "bateria", "ar condicionado", "elétrica", "eletrica", "mecânica", "mecanica"];
    const requestedServices: string[] = [];
    for (const kw of serviceKeywords) {
      if (new RegExp(`\\b${kw}\\b`, "i").test(allText)) {
        requestedServices.push(kw);
      }
    }

    const lead = {
      name: conv.customer_name || conv.company || "Lead",
      contactName: conv.customer_name || conv.company || "Lead",
      phone: conv.phone || "",
      document,
      vehicle,
      requestedServices,
      suggestedItems: requestedServices,
      summary: `Lead ${conv.customer_name || conv.phone}: ${requestedServices.length ? requestedServices.join(", ") : "Atendimento geral"}`,
    };

    return JSON.stringify({ found: true, lead });
  }

  if (functionName === "get_erp_products") {
    const filters = (validatedArgs ?? {}) as { search?: string; filter?: string };
    const where = ["client_id = ?", "active <> -1"];
    const values: unknown[] = [clientId];
    if (filters.search) {
      where.push("(name LIKE ? OR sku LIKE ?)");
      values.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    if (filters.filter === "out_of_stock") where.push("quantity <= 0");
    if (filters.filter === "low_stock") where.push("quantity > 0 AND quantity <= minimum_stock");
    const [rows] = await pool.execute(
      `SELECT public_id AS id, name, sku, quantity AS stock, minimum_stock AS minStock,
              sale_price_cents AS salePriceCents, cost_price_cents AS costPriceCents
         FROM erp_products WHERE ${where.join(" AND ")} ORDER BY name LIMIT 100`,
      values,
    ) as any[];
    const items = (Array.isArray(rows) ? rows : []).map(r => ({
      id: r.id,
      name: r.name,
      sku: r.sku,
      stock: Number(r.stock ?? 0),
      minStock: Number(r.minStock ?? 0),
      salePrice: Number(r.salePriceCents ?? 0) / 100,
      costPrice: Number(r.costPriceCents ?? 0) / 100,
    }));
    return JSON.stringify({
      total: items.length,
      items,
      produtos: items.map(it => ({ nome: it.name, estoque: it.stock })),
    });
  }

    return JSON.stringify({ success: false, error: "Função não reconhecida" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao processar consulta interna.";
    return JSON.stringify({ success: false, error: message });
  }
}

// ─── Declarações de funções para o Gemini (formato REST) ──────────────────────

function tokenUsagePart(data: any, field: "promptTokenCount" | "candidatesTokenCount"): number {
  const value = Number(data?.usageMetadata?.[field] ?? 0);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function tokenUsageTotal(data: any, promptTokens: number, completionTokens: number): number {
  const total = Number(data?.usageMetadata?.totalTokenCount);
  return Number.isFinite(total) && total >= 0 ? Math.floor(total) : promptTokens + completionTokens;
}

export function detectUserPreferencesFromMessage(message: string): Partial<UserHermesPreferences> | null {
  const text = message.trim();
  const result: Partial<UserHermesPreferences> = {};
  let detected = false;

  // 1. Honorifics / Formas de tratamento
  const honorificMatch = text.match(/(?:(?:agora\s+)?(?:me\s+chame\s+de|me\s+trate\s+por|trate-me\s+por|pode\s+me\s+chamar\s+de))\s+(senhor\s+[a-zà-ú]+|senhora\s+[a-zà-ú]+|senhor|senhora|sr\.?|sra\.?|doutor|doutora|dr\.?|dra\.?|voc[êe]|chefe)\b/i);
  if (honorificMatch && honorificMatch[1]) {
    const raw = honorificMatch[1].trim();
    if (/^senhor\s+/i.test(raw)) {
      result.honorific = "Senhor";
      result.preferredName = raw.charAt(0).toUpperCase() + raw.slice(1);
    } else if (/^senhora\s+/i.test(raw)) {
      result.honorific = "Senhora";
      result.preferredName = raw.charAt(0).toUpperCase() + raw.slice(1);
    } else if (/^senhor$/i.test(raw) || /^sr\.?$/i.test(raw)) {
      result.honorific = "Senhor";
      result.preferredName = "Senhor";
    } else if (/^senhora$/i.test(raw) || /^sra\.?$/i.test(raw)) {
      result.honorific = "Senhora";
      result.preferredName = "Senhora";
    } else if (/^doutor$/i.test(raw) || /^dr\.?$/i.test(raw)) {
      result.honorific = "Doutor";
      result.preferredName = "Doutor";
    } else if (/^doutora$/i.test(raw) || /^dra\.?$/i.test(raw)) {
      result.honorific = "Doutora";
      result.preferredName = "Doutora";
    } else if (/^voc[êe]$/i.test(raw)) {
      result.honorific = "Você";
    } else if (/^chefe$/i.test(raw)) {
      result.honorific = "Chefe";
      result.preferredName = "Chefe";
    }
    detected = true;
  }

  // 2. Nome preferido
  const nameMatch = text.match(/(?:(?:me\s+chame\s+(?:pelo\s+nome|de)|meu\s+nome\s+[ée]|pode\s+me\s+chamar\s+(?:pelo\s+nome|de)))\s+([A-ZÀ-Úa-zà-ú]+(?:\s+[A-ZÀ-Úa-zà-ú]+)?)\b/i);
  if (nameMatch && nameMatch[1]) {
    const candidate = nameMatch[1].trim();
    const isHonorific = /^(senhor|senhora|sr|sra|doutor|doutora|dr|dra|você|voce|chefe)$/i.test(candidate);
    if (!isHonorific) {
      result.preferredName = candidate.charAt(0).toUpperCase() + candidate.slice(1);
      detected = true;
    }
  }

  // 3. Estilo de comunicação
  if (/(?:seja\s+mais\s+direto|fale\s+mais\s+direto|seja\s+mais\s+objetivo|respostas\s+mais\s+curtas|respostas\s+diretas)/i.test(text)) {
    result.communicationStyle = "direto e objetivo";
    detected = true;
  } else if (/(?:seja\s+mais\s+formal|fale\s+de\s+forma\s+mais\s+formal|tom\s+formal|linguagem\s+formal)/i.test(text)) {
    result.communicationStyle = "formal e cortês";
    detected = true;
  } else if (/(?:seja\s+mais\s+descontra[ií]do|fale\s+de\s+forma\s+descontra[ií]da|tom\s+descontra[ií]do)/i.test(text)) {
    result.communicationStyle = "descontraído e ágil";
    detected = true;
  } else if (/(?:seja\s+mais\s+detalhado|estilo\s+executivo\s+detalhado|respostas\s+mais\s+detalhadas)/i.test(text)) {
    result.communicationStyle = "executivo detalhado";
    detected = true;
  }

  // 4. Regras customizadas
  const ruleMatch = text.match(/(?:lembre-se\s+que|lembre\s+que|n[aã]o\s+se\s+esque[çc]a\s+que)\s+(.+)/i);
  if (ruleMatch && ruleMatch[1]) {
    const rawRule = ruleMatch[1].trim().replace(/[.!?]+$/, "");
    if (rawRule.length >= 3) {
      result.customRules = [rawRule];
      detected = true;
    }
  }

  return detected ? result : null;
}

export function buildSystemInstruction(
  allowedTools: readonly HermesToolDefinition[],
  preferences?: UserHermesPreferences
): string {
  const names = allowedTools.map(tool => tool.name).join(", ") || "nenhuma";
  const preferredName = preferences?.preferredName || "Operador";
  const honorific = preferences?.honorific || "Você";
  const communicationStyle = preferences?.communicationStyle || "executivo e resolutivo";
  const rulesList = preferences?.customRules && preferences.customRules.length > 0
    ? preferences.customRules.map(r => `  • ${r}`).join("\n")
    : "  • Nenhuma diretriz customizada adicional definida.";

  return `Você é o Hermes, a inteligência central e o braço direito operacional dos sócios da MegaDesk. Atue como um diretor de operações ágil: presente, confiável, resolutivo e claro. Não soe como um chatbot genérico, um terminal de comandos ou um consultor prolixo.

=======================================================
PREFERÊNCIAS VIGENTES DE TRATAMENTO E PERFIL DO USUÁRIO:
- Como chamar o usuário: ${preferredName}
- Pronome / Forma de tratamento: ${honorific}
- Estilo de comunicação ativo: ${communicationStyle}
- Diretrizes personalizadas acumuladas:
${rulesList}

REGRA ABSOLUTA DE PERSONALIDADE:
Respeite rigorosamente a forma de tratamento solicitada acima em todas as saudações e frases.
Mantenha continuidade contextual com as conversas passadas. Se a preferência gravada for "Senhor Marcelo", use esse tratamento com brevidade; não atribua esse nome a outros usuários.
Se o usuário alterar a forma de tratamento, confirme em uma frase curta.
=======================================================

REGRA ZERO HALLUCINATION — DADOS DE NEGÓCIO:
- Nunca invente, suponha, exemplifique ou deduza clientes, fornecedores, produtos, saldos de estoque, valores de propostas, chamados, contatos ou status de integrações.
- Para responder sobre dados corporativos, invoque a ferramenta de leitura correspondente. Fornecedores cadastrados exigem get_suppliers_list; conexão, instância ou status do WhatsApp exigem get_whatsapp_status. Não use web_search como substituto de dados internos.
- Se a ferramenta necessária não estiver disponível ou falhar, diga objetivamente que não foi possível consultar esses dados. Nunca transforme erro de consulta em resultado vazio.
- Se a consulta for bem-sucedida e retornar lista vazia ou found: false, informe a ausência com naturalidade e precisão. Uma lista vazia de produtos cadastrados não comprova, por si só, saldo físico zero; use a ferramenta de estoque para falar de disponibilidade.
- Só forneça exemplo hipotético quando o usuário o pedir expressamente; identifique-o como hipotético.
- Não amplie o alcance de um resultado: status de conexão não comprova ausência de fila; um cadastro encontrado não comprova homologação; uma lista vazia não comprova entradas de nota pendentes.

REGRA ZERO PREÂMBULO EM TOOL CALLS:
- Emita a functionCall imediatamente no primeiro turno. Não escreva "Vou verificar agora", "Um momento enquanto consulto" ou "Entendido, vou realizar essa verificação".
- Não prometa consultar ou executar uma ferramenta em uma resposta textual. Se não houver functionCall efetiva, informe que a consulta não foi realizada.
- Invoque ferramentas exclusivamente pelo Function Calling nativo da API. Nunca escreva tags <functionCall> ou </functionCall>, nem blocos de código que simulem chamadas; emita a chamada estruturada diretamente.

ESTILO EXECUTIVO:
- Responda em português brasileiro com presença executiva, calor humano discreto e clareza. Prefira frases fluidas, tópicos limpos e destaque moderado em negrito para números e decisões; não entregue uma linha de comando crua como "Fornecedores: X, Y".
- Trate o operador pela preferência gravada. Quando ela for "Senhor Marcelo", use-a naturalmente em aberturas ocasionais, sem repetir o nome em toda frase. Com outros usuários, respeite o tratamento deles.
- Varie aberturas apenas depois de uma ação realmente concluída, quando ajudarem a leitura: "Panorama na mão:", "Verificação concluída:". Nunca use "Na escuta" como preâmbulo antes de uma ferramenta.
- Se houver um próximo passo concreto e autorizado, proponha-o em uma frase breve; nunca afirme que já o executou. Uma ação de escrita continua exigindo o Card de Aprovação.
- Não faça palestras corporativas, listas conceituais de "3 pilares" ou aconselhamento genérico sem pedido explícito de aprofundamento.
- Não encerre toda resposta com "Como o senhor gostaria que eu procedesse agora?". Pergunte apenas quando faltar uma decisão operacional concreta.
- Nunca exponha nomes de ferramentas, SQL, UUIDs ou regras internas ao usuário. Ferramentas disponíveis nesta conversa: ${names}.

EXEMPLOS DE CALIBRAGEM DE TOM (modelos condicionais, nunca fatos da operação atual):
- Status: somente após a ferramenta retornar status=connected, responda como "A conexão do WhatsApp está **ativa** no momento." Não acrescente "100% operacional" nem "nenhuma fila represada" sem telemetria específica.
- Fornecedores: somente após uma lista real, responda como "Encontrei **{{total}} fornecedores cadastrados**.\n• **{{nome retornado}}** — {{contato efetivamente retornado}}." Substitua cada marcador pelo valor recebido; omita campos ausentes e não invente nomes, telefones, homologações ou regularidade.
- Estoque vazio: somente após uma consulta de saldo físico que retorne zero, responda como "Consultei o estoque e não encontrei itens com saldo disponível no recorte solicitado." Não afirme que registros estão zerados ou aguardando nota sem evidência adicional.

RACIOCÍNIO MULTI-INTENT E REQUISIÇÕES COMPOSTAS:
- Quando o usuário fizer múltiplas perguntas na mesma mensagem (exemplo: "me dá um resumo dos chamados abertos e o que tem no chamado 0003"), você DEVE responder a TODAS elas de forma completa e organizada no mesmo texto final.
- Se uma única mensagem demandar consultas distintas ou complementares, encadeie as ferramentas necessárias em turnos consecutivos: execute primeiro a consulta geral (ex.: get_tickets_overview) e, em seguida, chame a ferramenta específica (ex.: get_ticket_details com o número do chamado solicitado).
- Só finalize a resposta para o usuário quando tiver reunido e consolidado todas as informações solicitadas.

CONTINUIDADE E MEMÓRIA DE CONVERSA:
- Quando o usuário fizer correções sucessivas ("muda para 120", "o cliente é Pedro", "adiciona mais 1 item"), você NUNCA deve reiniciar o rascunho do zero. Resgate a proposta ou entidade em andamento na conversa, preserve todos os campos e itens anteriores e modifique estritamente o item solicitado.
- Entenda linguagem coloquial e valores flexíveis ("120 conto", "60 pila", "coloca 120 reais", "muda o preço pra 50").
- NUNCA zere valores informados pelo usuário. Mantenha os demais itens da proposta e seus preços anteriores preservados.

EXECUÇÃO DE FERRAMENTAS E FLUXO HITL:
- Ao decidir executar consultas (READ) ou registrar preferências (set_user_preference), emita a functionCall correspondente sem mensagens preliminares.
- Quando a solicitação demandar criação ou alteração (MUTATION), use apenas dados fornecidos pelo usuário ou consultados por ferramentas. Emita a ferramenta apropriada para preparar o Card de Aprovação (HITL); nenhuma escrita ocorre antes da confirmação humana.`;
}

const ACTION_STOPWORDS = new Set([
  "troca", "trocar", "troque", "muda", "mudar", "mude", "coloca", "colocar", "coloque",
  "altera", "alterar", "altere", "ajusta", "ajustar", "ajuste", "bote", "botar", "bota",
  "atualiza", "atualizar", "atualize", "falei", "disse", "quero", "favor", "por", "para",
  "pra", "de", "do", "da", "dos", "das", "o", "a", "os", "as", "um", "uma", "uns", "umas",
  "valor", "preço", "preco", "custo", "é", "e", "em", "no", "na", "nos", "nas", "reais",
  "real", "r$", "conto", "pila", "pilas"
]);

export function extractPriceFromText(text: string): number | null {
  // 1. R$ 120 or R$120,50
  const rDollar = text.match(/(?:r\$|\$)\s*(\d+(?:[.,]\d{1,2})?)/i);
  if (rDollar && rDollar[1]) {
    const val = Number(rDollar[1].replace(",", "."));
    if (Number.isFinite(val) && val >= 0) return val;
  }

  // 2. 120 reais, 120 conto, 120 pila
  const reais = text.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:reais|real|conto|pila|pilas)\b/i);
  if (reais && reais[1]) {
    const val = Number(reais[1].replace(",", "."));
    if (Number.isFinite(val) && val >= 0) return val;
  }

  // 3. por / para / pra / de / = / : / custa / valor seguido de número
  const prep = text.match(/(?:por|é|valor(?:\s+de)?|custa|pra|para|de|em|a|=|:)\s*(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:reais|real|conto|pila|pilas)?\b/i);
  if (prep && prep[1]) {
    const val = Number(prep[1].replace(",", "."));
    if (Number.isFinite(val) && val >= 0) return val;
  }

  // 4. Qualquer número isolado no texto
  const standalone = text.match(/\b(\d+(?:[.,]\d{1,2})?)\b/);
  if (standalone && standalone[1]) {
    const val = Number(standalone[1].replace(",", "."));
    if (Number.isFinite(val) && val >= 0) return val;
  }

  return null;
}

export function updateItemsWithUserPrices<T extends { productName: string; quantity: number; unitPrice: number }>(
  items: T[],
  userText: string
): T[] {
  if (!items.length) return items;

  const result = items.map(it => ({ ...it }));
  const chunks = userText.split(/(?:\s+e\s+|[,;\n]+)/i).map(c => c.trim()).filter(Boolean);
  let updatedAny = false;

  for (const chunk of chunks) {
    const price = extractPriceFromText(chunk);
    if (price === null) continue;

    const chunkWords = chunk.toLowerCase().split(/[\s:=-]+/).map(w => w.replace(/[^a-zà-ú0-9]/g, "")).filter(Boolean);
    const chunkKeywords = chunkWords.filter(w => !ACTION_STOPWORDS.has(w) && !/^\d+$/.test(w));

    let bestItemIdx = -1;
    let maxMatches = 0;

    result.forEach((item, idx) => {
      const itemWords = item.productName.toLowerCase().split(/[\s:=-]+/).map(w => w.replace(/[^a-zà-ú0-9]/g, "")).filter(Boolean);
      const itemKeywords = itemWords.filter(w => !ACTION_STOPWORDS.has(w));
      const effectiveKeywords = itemKeywords.length > 0 ? itemKeywords : itemWords;

      let matches = 0;
      for (const kw of effectiveKeywords) {
        if (chunkKeywords.some(cw => cw.includes(kw) || kw.includes(cw))) {
          matches++;
        }
      }
      if (matches > maxMatches) {
        maxMatches = matches;
        bestItemIdx = idx;
      }
    });

    if (bestItemIdx !== -1 && maxMatches > 0) {
      result[bestItemIdx].unitPrice = price;
      updatedAny = true;
    }
  }

  if (!updatedAny) {
    const overallPrice = extractPriceFromText(userText);
    if (overallPrice !== null) {
      const textWords = userText.toLowerCase().split(/[\s:=-]+/).map(w => w.replace(/[^a-zà-ú0-9]/g, "")).filter(Boolean);
      const textKeywords = textWords.filter(w => !ACTION_STOPWORDS.has(w) && !/^\d+$/.test(w));

      let bestItemIdx = -1;
      let maxMatches = 0;

      result.forEach((item, idx) => {
        const itemWords = item.productName.toLowerCase().split(/[\s:=-]+/).map(w => w.replace(/[^a-zà-ú0-9]/g, "")).filter(Boolean);
        const itemKeywords = itemWords.filter(w => !ACTION_STOPWORDS.has(w));
        const effectiveKeywords = itemKeywords.length > 0 ? itemKeywords : itemWords;

        let matches = 0;
        for (const kw of effectiveKeywords) {
          if (textKeywords.some(tw => tw.includes(kw) || kw.includes(tw))) {
            matches++;
          }
        }
        if (matches > maxMatches) {
          maxMatches = matches;
          bestItemIdx = idx;
        }
      });

      if (bestItemIdx !== -1 && maxMatches > 0) {
        result[bestItemIdx].unitPrice = overallPrice;
        updatedAny = true;
      } else if (result.length === 1) {
        result[0].unitPrice = overallPrice;
        updatedAny = true;
      }
    }
  }

  return result;
}

export function enforceUserProvidedPrices(
  args: Record<string, unknown>,
  userMessage: string,
  existingHistory: readonly IAMessage[] = []
): Record<string, unknown> {
  const lastProposal = findLastProposalInHistory(existingHistory);
  let rawItems = Array.isArray(args.items) ? (args.items as Array<Record<string, unknown>>) : [];

  if (rawItems.length === 0 && lastProposal) {
    rawItems = lastProposal.items;
  }

  const typedItems = rawItems.map(it => ({
    productName: String(it.productName ?? it.description ?? "Item"),
    quantity: Number(it.quantity ?? 1) || 1,
    unitPrice: Number(it.unitPrice ?? 0) || 0,
    ...(it.productId ? { productId: String(it.productId) } : {}),
    ...(it.description ? { description: String(it.description) } : {}),
  }));

  const isAdjustment = Boolean(
    lastProposal &&
    /\b(valor|preço|preco|custo|ajuste|corrija|altere|mude|troque|coloque|bote|adicione|atualize|reais)\b/i.test(userMessage)
  );

  let mergedItems = typedItems;
  if (isAdjustment && lastProposal && typedItems.length < lastProposal.items.length) {
    const updatedNames = new Set(typedItems.map(i => i.productName.toLowerCase()));
    const missingItems = lastProposal.items.filter(prev => !updatedNames.has(prev.productName.toLowerCase()));
    mergedItems = [...missingItems, ...typedItems];
  }

  const updatedItems = updateItemsWithUserPrices(mergedItems, userMessage);

  return {
    ...args,
    items: updatedItems,
  };
}

export function isPreliminaryWaitingText(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  return (
    /^(?:estou\s+consultando|consultando|verificando|buscando|aguarde|um\s+momento|só\s+um\s+instante|vou\s+verificar|para\s+responder\s+[àa]\s+sua\s+pergunta,\s*preciso)/i.test(t) ||
    /^(?:estou\s+consultando\s+o\s+sistema|estou\s+verificando\s+no\s+sistema)/i.test(t)
  );
}

function findLastProposalInHistory(history: readonly IAMessage[]): {
  clientName: string;
  items: Array<{ productName: string; quantity: number; unitPrice: number }>;
} | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.pendingActionRequest?.actionType === "CREATE_PROPOSAL") {
      const args = msg.pendingActionRequest.args;
      const clientName = String(args.clientName ?? args.clientId ?? "").trim();
      const rawItems = Array.isArray(args.items) ? args.items as Array<Record<string, unknown>> : [];
      const items = rawItems.map(it => ({
        productName: String(it.productName ?? it.description ?? "Item"),
        quantity: Number(it.quantity ?? 1) || 1,
        unitPrice: Number(it.unitPrice ?? 0) || 0,
      }));
      if (clientName || items.length > 0) {
        return { clientName, items };
      }
    }
  }
  return null;
}

function extractProposalDetailsFromMessage(
  userMessage: string,
  executedReadResults: Array<{ name: string; args: Record<string, unknown>; output: any }>,
  existingHistory: readonly IAMessage[] = []
): {
  isProposal: boolean;
  clientName: string;
  items: Array<{ productName: string; quantity: number; unitPrice: number }>;
} {
  // NUNCA cria uma ação de CREATE_PROPOSAL se a mensagem do usuário contiver verbos de aprovação, consulta, venda ou status
  const isApprovalOrQueryOrStatus = /\b(aprova|aprovar|aprove|aprovad[ao]|status|venda|vendas|converter|converta|conversao|conversão|gerar\s+venda|consultar?|qual|quais|ver|listar?|buscar?|como\s+est[aá]|exibir?)\b/i.test(userMessage);
  if (isApprovalOrQueryOrStatus) {
    return { isProposal: false, clientName: "", items: [] };
  }

  const lastProposal = findLastProposalInHistory(existingHistory);
  const isAdjustment = Boolean(
    lastProposal &&
    /\b(valor|preço|preco|custo|ajuste|corrija|altere|mude|troque|coloque|bote|adicione|atualize|reais)\b/i.test(userMessage)
  );

  // A criação automática de proposta só pode ser acionada se o usuário explicitamente pedir "fazer orçamento", "criar proposta", "novo orçamento"
  const explicitCreationPattern = /\b(?:fazer|faça|faca|criar|crie|novo|nova|gerar|gere|preparar?|monte|montar)\s+(?:um\s+|uma\s+)?(?:orçamento|orcamento|proposta|cotacao|cotação)\b/i;
  const isExplicitCreation = explicitCreationPattern.test(userMessage);

  if (!isAdjustment && !isExplicitCreation) {
    return { isProposal: false, clientName: "", items: [] };
  }

  // 1. Extrai nome do cliente a partir de get_client_360 executado, da mensagem ou da proposta anterior
  let clientName = "";
  const client360Call = executedReadResults.find(r => r.name === "get_client_360");
  if (client360Call) {
    const rawSearch = client360Call.args.search ?? client360Call.args.clientId;
    if (typeof rawSearch === "string" && rawSearch.trim().length >= 2) {
      clientName = rawSearch.trim();
    }
  }

  if (!clientName) {
    const clientMatch = userMessage.match(/(?:cliente|pro\s+cliente|para\s+o\s+cliente|para\s+cliente|ao\s+cliente)\s+([A-ZÀ-Úa-zà-ú0-9\s]+?)(?:\s+(?:para|com|de\s+serviços?|itens?)|\s*$)/i);
    if (clientMatch && clientMatch[1]) {
      clientName = clientMatch[1].trim();
    }
  }

  if (!clientName && lastProposal) {
    clientName = lastProposal.clientName;
  }

  // 2. Extrai itens ou atualiza itens da proposta anterior
  let items: Array<{ productName: string; quantity: number; unitPrice: number }> = [];

  if (lastProposal && isAdjustment) {
    items = updateItemsWithUserPrices(lastProposal.items, userMessage);
  }

  if (items.length === 0) {
    const itemsMatch = userMessage.match(/(?:para|com|de\s+serviços?|itens?)\s+([^.]+)/i);
    if (itemsMatch && itemsMatch[1]) {
      const textAfterClient = clientName && userMessage.toLowerCase().includes(clientName.toLowerCase())
        ? userMessage.substring(userMessage.toLowerCase().indexOf(clientName.toLowerCase()) + clientName.length)
        : itemsMatch[1];

      const secondMatch = textAfterClient.match(/(?:para|com|de\s+serviços?|itens?)\s+([^.]+)/i) || { 1: textAfterClient };
      const rawTarget = secondMatch[1]?.trim() || itemsMatch[1].trim();

      const rawParts = rawTarget
        .split(/\s+e\s+|,\s*/i)
        .map(s => s.replace(/^(para|com|de)\s+/i, "").trim())
        .filter(s => s.length >= 2 && !/^(cliente|orçamento|proposta)/i.test(s));

      if (rawParts.length > 0) {
        items = rawParts.map(part => {
          const price = extractPriceFromText(part) ?? 0;
          const cleanName = part
            .replace(/(?:por|para|pra|de|=|:)?\s*(?:r\$|\$)?\s*\d+(?:[.,]\d{1,2})?\s*(?:reais|real)?/gi, "")
            .trim();
          return { productName: cleanName || part, quantity: 1, unitPrice: price };
        });
        // Atualiza caso haja valores numéricos adicionais no texto
        items = updateItemsWithUserPrices(items, userMessage);
      }
    }
  }

  if (items.length === 0 && lastProposal) {
    items = updateItemsWithUserPrices(lastProposal.items, userMessage);
  }

  // A criação automática de proposta só pode ser acionada com cliente OU itens definidos
  const hasValidClient = Boolean(clientName && clientName.toLowerCase() !== "cliente");
  const hasValidItems = items.length > 0 && items.some(it => it.productName && it.productName !== "Serviço solicitado");

  if (!hasValidClient && !hasValidItems) {
    return { isProposal: false, clientName: "", items: [] };
  }

  return { isProposal: true, clientName: clientName || "Cliente", items: items.length > 0 ? items : [{ productName: "Serviço solicitado", quantity: 1, unitPrice: 0 }] };
}

function extractEntityCreationFromMessage(
  userMessage: string,
  allowedTools: readonly HermesToolDefinition[],
  owner?: PendingActionOwner,
  existingHistory: readonly IAMessage[] = []
): PendingActionRequest | null {
  // 1. Atualizar fornecedor (ex: "cadastrar telefone na Elétrica Moura", "cadastrar telefone (11) 98888-7777 no fornecedor Elétrica Moura")
  const updateSupplierMatch = userMessage.match(/(?:atualizar?|cadastrar?|adicionar?|alterar?|mudar?)\s+(?:o\s+)?(?:telefone|contato|email|e-mail|anotação|observação|dados)(?:[\s\S]*?)(?:no|do|para\s+o|na|da|para|pro|pra)\s+(?:fornecedor\s+)?([A-ZÀ-Úa-zà-ú0-9\s.&'-]+)/i) ||
    userMessage.match(/(?:atualizar?|alterar?|editar?)\s+(?:o\s+)?fornecedor\s+([A-ZÀ-Úa-zà-ú0-9\s.&'-]+)/i);
  if (updateSupplierMatch && updateSupplierMatch[1]) {
    const tool = allowedTools.find(t => t.name === "update_supplier");
    if (tool) {
      let rawName = updateSupplierMatch[1].trim().replace(/[?!.,]+$/, "");
      const phoneMatch = userMessage.match(/(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}/);
      const emailMatch = userMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      const phone = phoneMatch ? phoneMatch[0].trim() : undefined;
      const email = emailMatch ? emailMatch[0].trim() : undefined;
      if (phone) {
        rawName = rawName.replace(phone, "").trim().replace(/\s+(?:com\s+o\s+número|número|tel|telefone)$/i, "");
      }
      if (rawName.length >= 2) {
        try {
          return createPendingActionRequest(tool, {
            name: rawName,
            ...(phone ? { phone } : {}),
            ...(email ? { email } : {}),
            fieldsToUpdate: {
              ...(phone ? { phone } : {}),
              ...(email ? { email } : {}),
            },
          }, owner);
        } catch { /* segue */ }
      }
    }
  }

  // 1b. Fornecedor: "criar/cadastrar fornecedor chamado X"
  const supplierMatch = userMessage.match(/(?:cria|criar|cadastra|cadastrar|novo|adiciona|adicionar|consegue\s+criar)\s+(?:um\s+)?fornecedor\s+(?:chamado\s+|de\s+nome\s+)?([A-ZÀ-Úa-zà-ú0-9\s.&'-]+)/i);
  if (supplierMatch && supplierMatch[1]) {
    const tool = allowedTools.find(t => t.name === "create_supplier");
    if (tool) {
      const name = supplierMatch[1].trim().replace(/[?!.,]+$/, "");
      if (name.length >= 2) {
        try {
          return createPendingActionRequest(tool, { name }, owner);
        } catch { /* segue */ }
      }
    }
  }

  // 2. Proposta comercial: aprovar ou converter em venda (ex: "aprova essa proposta", "aprova a proposta O-18", "aprova e gera como venda")
  const isApprovalOrSaleIntent = /\b(aprova|aprovar|aprove|aprovad[ao]|converter|converta|conversao|conversão|gerar\s+venda)\b/i.test(userMessage);
  if (isApprovalOrSaleIntent && /\b(proposta|orçamento|orcamento|venda|pedido)\b/i.test(userMessage)) {
    const tool = allowedTools.find(t => t.name === "update_proposal_status");
    if (tool) {
      let proposalTarget = "";
      const codeMatch = userMessage.match(/\b([A-Za-z]?-\d+|\d+)\b/);
      if (codeMatch && !/^(19|20)\d\d$/.test(codeMatch[1])) {
        proposalTarget = codeMatch[1];
      }
      if (!proposalTarget) {
        const lastProp = findLastProposalInHistory(existingHistory);
        if (lastProp) {
          proposalTarget = lastProp.clientName || "proposta atual";
        }
      }
      if (proposalTarget) {
        const isSale = /\b(venda|vendas|converter|converta|conversao|conversão|gerar\s+venda)\b/i.test(userMessage);
        try {
          return createPendingActionRequest(tool, {
            proposalId: proposalTarget,
            newStatus: isSale ? "sale" : "approved",
            convertToSale: isSale,
            reason: isSale ? "Aprovação e conversão em venda solicitada pelo usuário" : "Aprovação comercial solicitada pelo usuário",
          }, owner);
        } catch { /* segue */ }
      }
    }
  }

  // 3. Cliente: "criar/cadastrar cliente chamado X" (se não for proposta)
  const isProposal = /\b(orçamento|orcamento|proposta|cotacao|cotação)\b/i.test(userMessage);
  if (!isProposal) {
    const clientMatch = userMessage.match(/(?:cria|criar|cadastra|cadastrar|novo|adiciona|adicionar|consegue\s+criar)\s+(?:um\s+)?cliente\s+(?:chamado\s+|de\s+nome\s+)?([A-ZÀ-Úa-zà-ú0-9\s.&'-]+)/i);
    if (clientMatch && clientMatch[1]) {
      const tool = allowedTools.find(t => t.name === "create_client");
      if (tool) {
        const name = clientMatch[1].trim().replace(/[?!.,]+$/, "");
        if (name.length >= 2) {
          try {
            return createPendingActionRequest(tool, { name }, owner);
          } catch { /* segue */ }
        }
      }
    }
  }

  // 4. Serviço
  const serviceMatch = userMessage.match(/(?:cria|criar|cadastra|cadastrar|novo|adiciona|adicionar|consegue\s+criar)\s+(?:um\s+)?serviço\s+(?:no\s+catálogo\s+)?(?:chamado\s+|de\s+nome\s+)?([A-ZÀ-Úa-zà-ú0-9\s.&'-]+)/i);
  if (serviceMatch && serviceMatch[1]) {
    const tool = allowedTools.find(t => t.name === "create_service");
    if (tool) {
      const name = serviceMatch[1].trim().replace(/[?!.,]+$/, "");
      if (name.length >= 2) {
        try {
          return createPendingActionRequest(tool, { name }, owner);
        } catch { /* segue */ }
      }
    }
  }

  // 5. Produto
  const productMatch = userMessage.match(/(?:cria|criar|cadastra|cadastrar|novo|adiciona|adicionar|consegue\s+criar)\s+(?:um\s+)?produto\s+(?:chamado\s+|de\s+nome\s+)?([A-ZÀ-Úa-zà-ú0-9\s.&'-]+)/i);
  if (productMatch && productMatch[1]) {
    const tool = allowedTools.find(t => t.name === "create_product");
    if (tool) {
      const name = productMatch[1].trim().replace(/[?!.,]+$/, "");
      if (name.length >= 2) {
        try {
          return createPendingActionRequest(tool, { name }, owner);
        } catch { /* segue */ }
      }
    }
  }

  return null;
}

export function sanitizeModelResponseText(text: string): string {
  if (!text) return "";
  // Pseudo-chamadas são texto do modelo, nunca conteúdo destinado à interface.
  const withoutPseudoCalls = text
    .replace(/<functionCall\b[^>]*>[\s\S]*?<\/functionCall\s*>/gi, "")
    .replace(/<functionCall\b[^>]*>[\s\S]*$/gi, "")
    .replace(/<\/functionCall\s*>/gi, "");
  const trimmed = withoutPseudoCalls.trim();
  // Se for exclusivamente uma chamada de tool (ex: get_client_360({search: 'Pedro Ferrari'}) ou get_services_list({search: 'lavagem'}))
  if (/^[a-zA-Z0-9_]+\s*\(\{?[\s\S]*?\}?\);?$/i.test(trimmed)) {
    return "";
  }
  // Se for código em bloco json ou similar
  if (/^```(?:json)?\s*\{[\s\S]*?"(?:name|function|tool)":/i.test(trimmed)) {
    return "";
  }
  // Remove linhas que são chamadas de ferramentas isoladas
  const lines = withoutPseudoCalls.split("\n");
  const filtered = lines.filter(line => {
    const l = line.trim();
    if (/^[a-zA-Z0-9_]+\s*\(\{?[\s\S]*?\}?\);?$/i.test(l)) return false;
    if (/^(?:get_|create_|update_|delete_|add_|link_|send_|request_)[a-zA-Z0-9_]+\s*\(/i.test(l)) return false;
    return true;
  });
  return filtered.join("\n").trim();
}

function parseTextFunctionCalls(text: string, permissions: readonly string[]): Array<{ functionCall: { name: string; args: Record<string, unknown> } }> {
  const calls: Array<{ functionCall: { name: string; args: Record<string, unknown> } }> = [];
  for (const match of text.matchAll(/<functionCall>\s*([a-zA-Z0-9_]+)\s*([\s\S]*?)<\/functionCall\s*>/gi)) {
    if (calls.length >= 8) break;
    const tool = getAuthorizedHermesTool(match[1], permissions);
    // Esta ferramenta é classificada como READ, mas grava preferências; texto livre não pode acioná-la.
    if (!tool || tool.name === "set_user_preference") continue;
    try {
      const rawArgs: unknown = match[2].trim() ? JSON.parse(match[2]) : {};
      if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) continue;
      const args = tool.validateArgs(rawArgs as Record<string, unknown>);
      calls.push({ functionCall: { name: tool.name, args } });
    } catch {
      // Argumentos inválidos não são executados e a tag é removida da resposta.
    }
  }
  return calls;
}

function synthesizeDeterministicSingle(
  result: { name: string; args: Record<string, unknown>; output: any },
  userMessage: string,
  executedReadResults: Array<{ name: string; args: Record<string, unknown>; output: any }>,
): string | null {
  const { name, args, output } = result;

  if (name === "set_user_preference") {
    const target = (output?.updated?.preferredName || output?.updated?.honorific || args.preferredName || args.honorific || "Operador") as string;
    return `Entendido, ${target}. A partir de agora nos comunicaremos desta forma. Como posso ajudar com as operações hoje?`;
  }

  if (name === "get_tickets_overview") {
    const rawTotal = output?.total ?? output?.resumo?.total ?? output?.tickets?.length ?? output?.chamados?.length ?? 0;
    const total = Number(rawTotal) || 0;
    if (total === 0) {
      return "Não foram encontrados chamados no sistema para os critérios consultados.";
    }
    const open = output?.open ?? output?.resumo?.open ?? 0;
    const inProgress = output?.inProgress ?? output?.resumo?.in_progress ?? 0;
    const pending = output?.pending ?? output?.resumo?.waiting ?? 0;
    const list = Array.isArray(output?.tickets) && output.tickets.length > 0
      ? output.tickets.slice(0, 5).map((t: any) => `#${String(t.ticketNumber ?? t.chamadoNumber ?? t.id).padStart(4, "0")}: "${t.title}" (${t.customer || ""})`).join("; ")
      : "";
    const listSuffix = list ? `: ${list}` : ".";
    return `Total de ${total} chamado(s) encontrado(s) (${open} aberto(s), ${inProgress} em andamento, ${pending} pendente(s))${listSuffix}`;
  }

  if (name === "get_ticket_details") {
    if (output?.found === false) {
      return output.message || "Chamado não encontrado no sistema.";
    }
    const t = output?.chamado || output;
    if (t) {
      const num = String(t.ticketNumber ?? t.chamadoNumber ?? t.id ?? "").padStart(4, "0");
      return `Chamado #${num} - "${t.title}" (Cliente: ${t.customer || t.customerName || t.company || "Não informado"}, Status: ${t.status}, Prioridade: ${t.priority}). Responsável: ${t.assignedOperator || t.assignedTo || "Não atribuído"}.`;
    }
  }

  if (name === "extract_lead_from_conversation") {
    if (output?.found === false) {
      return output.message || "Não foram encontrados dados de lead no histórico recente desta conversa.";
    }
    const lead = output?.lead;
    if (lead) {
      const services = Array.isArray(lead.requestedServices) && lead.requestedServices.length > 0
        ? lead.requestedServices.join(", ")
        : "Nenhum serviço identificado";
      return `Identifiquei os seguintes dados na conversa:\n- Nome: ${lead.name || "Não informado"}\n- Telefone: ${lead.phone || "Não informado"}\n- Documento: ${lead.document || "Não informado"}\n- Veículo: ${lead.vehicle || "Não informado"}\n- Serviços/Itens: ${services}.\n\nDeseja que eu crie uma proposta comercial ou cadastre o cliente?`;
    }
  }

  if (name === "get_open_tickets") {
    const rawTotal = output?.total ?? output?.chamados_abertos ?? output?.resumo?.total ?? output?.chamados?.length ?? 0;
    const total = Number(rawTotal) || 0;
    if (total === 0) {
      return "Não há chamados abertos no momento.";
    }
    const urgent = Number(output?.urgentes ?? 0) || 0;
    const urgentText = urgent > 0 ? `, ${urgent} urgente(s)` : "";
    if (Array.isArray(output?.chamados) && output.chamados.length > 0) {
      const validChamados = output.chamados
        .slice(0, 5)
        .filter((c: any) => c && (c.title || c.chamadoNumber !== undefined || c.chamadoId));
      if (validChamados.length > 0) {
        const list = validChamados
          .map((c: any) => `#${String(c.chamadoNumber ?? c.chamadoId ?? "").padStart(4, "0")}: "${c.title ?? "Sem título"}"`)
          .join("; ");
        return `Há ${total} chamados abertos${urgentText}: ${list}.`;
      }
    }
    return `Há ${total} chamados abertos${urgentText}.`;
  }

  if (name === "get_client_360") {
    const searchName = String(args.search ?? args.clientId ?? "o cliente");
    const isProposal = /\b(orçamento|orcamento|proposta|cotacao|cotação)\b/i.test(userMessage);

    if (output?.found === false) {
      if (isProposal) {
        const proposal = extractProposalDetailsFromMessage(userMessage, executedReadResults);
        const services = proposal.items.map(i => `'${i.productName}'`).join(" e ");
        return `O cliente '${proposal.clientName}' não foi localizado no cadastro. Deseja que eu realize o cadastro dele agora ou prefere gerar a proposta como rascunho para os serviços: ${services}?`;
      }
      return `O cliente '${searchName}' não foi localizado no cadastro do CRM. Deseja que eu realize o cadastro dele agora?`;
    }

    if (output?.cliente) {
      const c = output.cliente;
      return `Cliente localizado: ${c.name || searchName} (Status: ${c.status || "Ativo"}). Telefone: ${c.phone || "Não informado"}.`;
    }
  }

  if (name === "get_crm_summary") {
    const r = output?.resumo;
    if (r) {
      return `Resumo da carteira CRM: ${r.total ?? 0} clientes (${r.active ?? 0} ativos, ${r.leads ?? 0} leads). Novos cadastrados este mês: ${r.newThisMonth ?? 0}.`;
    }
  }

  if (name === "get_proposals_summary") {
    const r = output?.resumo;
    if (r) {
      const totalReais = ((r.totalCents ?? 0) / 100).toFixed(2).replace(".", ",");
      return `Resumo de propostas: ${r.total ?? 0} propostas no total (R$ ${totalReais}). Rascunhos: ${r.drafts ?? 0}, Em negociação: ${r.negotiation ?? 0}, Aprovadas: ${r.approved ?? 0}.`;
    }
  }

  if (name === "get_sales_summary") {
    const total = output?.total ?? 0;
    const count = output?.count ?? output?.vendas ?? 0;
    const valorFormatado = typeof total === "number" ? `R$ ${(total / 100).toFixed(2).replace(".", ",")}` : String(total);
    return `Resumo de vendas de hoje: ${count} venda(s) registrada(s), totalizando ${valorFormatado}.`;
  }

  if (name === "get_erp_products") {
    const prods = output?.produtos;
    if (Array.isArray(prods) && prods.length > 0) {
      const list = prods.map((p: any) => `${p.nome} (${p.estoque ?? 0} em estoque)`).join(", ");
      return `Temos os seguintes produtos em estoque: ${list}.`;
    }
    return "Consultei o estoque no sistema e não encontrei nenhum produto físico com saldo disponível no momento.";
  }

  if (name === "get_inventory_status") {
    const itens = output?.itens;
    if (Array.isArray(itens) && itens.length > 0) {
      const list = itens.slice(0, 5).map((p: any) => `${p.name} (SKU: ${p.sku}, Estoque: ${p.quantity ?? 0} ${p.unit || "un"})`).join("; ");
      const extra = itens.length > 5 ? ` e mais ${itens.length - 5} item(ns)` : "";
      return `Status de estoque: ${list}${extra}.`;
    }
    return "Consultei o estoque no sistema e não encontrei nenhum produto físico com saldo disponível no momento.";
  }

  if (name === "get_erp_summary") {
    const p = output?.produtos;
    const s = output?.servicosAtivos ?? 0;
    if (p) {
      return `Resumo do ERP: ${p.total ?? 0} produto(s) cadastrado(s) (${p.active ?? 0} ativos, ${p.empty ?? 0} zerados) e ${s} serviço(s) ativo(s).`;
    }
  }

  if (name === "get_services_list") {
    const list = output?.servicos;
    const searchTerm = String(args.search ?? "").trim();
    if (Array.isArray(list) && list.length > 0) {
      const names = list.slice(0, 5).map((s: any) => {
        const price = s.price ? ` (R$ ${Number(s.price).toFixed(2).replace(".", ",")})` : "";
        return `${s.name}${price}`;
      }).join(", ");
      const extra = list.length > 5 ? ` e mais ${list.length - 5} serviço(s)` : "";
      return `Temos os seguintes serviços no catálogo${searchTerm ? ` para "${searchTerm}"` : ""}: ${names}${extra}.`;
    }
    return searchTerm
      ? `Nenhum serviço encontrado para "${searchTerm}".`
      : "Consultei os serviços no sistema e não encontrei nenhum serviço cadastrado no catálogo.";
  }

  if (name === "get_product_details") {
    if (output?.found === false) {
      return output.message || "Produto não encontrado no cadastro.";
    }
    if (output?.produto) {
      const p = output.produto;
      const price = ((p.salePriceCents ?? 0) / 100).toFixed(2).replace(".", ",");
      return `Produto: ${p.name} (SKU: ${p.sku}). Preço de venda: R$ ${price}. Estoque: ${p.quantity ?? 0} ${p.unit || "un"}.`;
    }
  }

  if (name === "get_suppliers_list") {
    if (output?.success === false) return "Não foi possível consultar os fornecedores no momento.";
    const list = output?.suppliers;
    if (!Array.isArray(list)) return "Não foi possível confirmar a lista de fornecedores no momento.";
    const searchTerm = String(args.search ?? "").trim();
    if (list.length > 0) {
      const lines = list.slice(0, 5).map((supplier: any) => {
        const name = String(supplier.name ?? "").trim() || "Nome não informado";
        const contacts = [
          supplier.contactName ? `Contato: ${supplier.contactName}` : "",
          supplier.phone ? `Telefone: ${supplier.phone}` : "",
          supplier.email ? `E-mail: ${supplier.email}` : "",
        ].filter(Boolean);
        return `• **${name}** — ${contacts.join(", ") || "contato não informado"}`;
      });
      const remaining = list.length > 5 ? `\nHá mais ${list.length - 5} cadastro(s) neste resultado.` : "";
      const label = list.length === 1 ? "fornecedor" : "fornecedores";
      return `Consultei a base${searchTerm ? ` para "${searchTerm}"` : ""} e encontrei **${list.length} ${label}**:\n${lines.join("\n")}${remaining}`;
    }
    return searchTerm
      ? `Consultei a base e não encontrei fornecedores para "${searchTerm}".`
      : "Consultei a base e ainda não há fornecedores cadastrados. Se precisar, posso preparar o primeiro cadastro para sua aprovação.";
  }

  if (name === "get_whatsapp_status") {
    if (output?.success === false) return "Não foi possível consultar o status do WhatsApp no momento.";
    if (output?.status === "connected") return "A conexão do WhatsApp está **ativa** no momento.";
    if (output?.status === "connecting") return "A instância do WhatsApp está **em conexão**. Aguarde a confirmação do estado antes de enviar mensagens.";
    if (output?.status === "disconnected") return "A instância do WhatsApp está **desconectada**. É preciso restabelecer a conexão antes de enviar mensagens.";
    return "Não foi possível confirmar o status do WhatsApp no momento.";
  }

  if (name === "get_sales_analytics") {
    const a = output?.analise;
    if (a) {
      const rev = ((a.revenueCents ?? 0) / 100).toFixed(2).replace(".", ",");
      return `Análise de vendas: ${a.orders ?? 0} pedido(s), receita total de R$ ${rev}.`;
    }
  }

  if (name === "get_conversations_summary") {
    const total = output?.total ?? 0;
    const abertas = output?.abertas ?? 0;
    return `Resumo de conversas no atendimento: ${total} conversa(s) no total (${abertas} aberta(s)).`;
  }

  if (executedReadResults.length > 0) {
    return "Consulta realizada com sucesso no sistema, mas não há detalhes adicionais para exibir no momento.";
  }

  return null;
}

function synthesizeDeterministicResponse(
  executedReadResults: Array<{ name: string; args: Record<string, unknown>; output: any }>,
  userMessage: string,
): string | null {
  if (!executedReadResults.length) return null;

  // Se executou múltiplas ferramentas (ex: overview de chamados + detalhes de um chamado), sintetiza ambas
  if (executedReadResults.length > 1) {
    const overview = executedReadResults.find(r => r.name === "get_tickets_overview" || r.name === "get_open_tickets");
    const details = executedReadResults.find(r => r.name === "get_ticket_details");
    if (overview && details) {
      const ovText = synthesizeDeterministicSingle(overview, userMessage, executedReadResults);
      const dtText = synthesizeDeterministicSingle(details, userMessage, executedReadResults);
      if (ovText && dtText) return `${ovText}\n\n${dtText}`;
    }
  }

  const lastResult = executedReadResults[executedReadResults.length - 1];
  return synthesizeDeterministicSingle(lastResult, userMessage, executedReadResults);
}

async function chatWithClientGeminiInternal(
  clientId: string,
  userId: string,
  userMessage: string,
  existingHistory: IAMessage[],
  userPermissions: readonly string[]
): Promise<ChatResult> {
  // 1. Busca o token e verifica quota do cliente
  const iaStatus = await getClientIAStatus(clientId);
  if (iaStatus.status === "inativa") {
    throw new Error("Token Gemini não configurado para este cliente. Solicite ao administrador que configure a API do Gemini.");
  }
  if (iaStatus.status === "quota_atingida") {
    throw new Error(`Quota mensal de tokens atingida (${iaStatus.tokensUsadosMes.toLocaleString("pt-BR")} / ${iaStatus.geminiQuotaMensal.toLocaleString("pt-BR")} tokens). O Assistente IA será liberado no próximo mês ou após o administrador ajustar o limite.`);
  }
  let geminiKey = iaStatus.geminiKey!;

  // 2. Monta o histórico no formato REST do Gemini
  const contents: GeminiContent[] = selectGeminiPromptHistory(existingHistory).map((msg) => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: msg.content }],
  }));

  // Adiciona a mensagem atual do usuário
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  // Pool para operações de banco
  let pool: any = null;
  try {
    pool = getPool();
  } catch {}

  // 2.1 Assimilação de preferências do usuário
  const detectedPrefs = detectUserPreferencesFromMessage(userMessage);
  if (detectedPrefs) {
    try {
      await saveUserHermesPreferences(clientId, userId, detectedPrefs, pool);
    } catch {}
  }
  const userPreferences = await getUserHermesPreferences(clientId, userId, pool);
  if (detectedPrefs) {
    if (detectedPrefs.preferredName) userPreferences.preferredName = detectedPrefs.preferredName;
    if (detectedPrefs.honorific) userPreferences.honorific = detectedPrefs.honorific;
    if (detectedPrefs.communicationStyle) userPreferences.communicationStyle = detectedPrefs.communicationStyle;
    if (detectedPrefs.customRules && detectedPrefs.customRules.length > 0) {
      userPreferences.customRules = Array.from(new Set([...(userPreferences.customRules || []), ...detectedPrefs.customRules]));
    }
  }

  // 3. Primeira chamada ao Gemini (com fast-path para saudações e conversas puras)
  const allowedTools = getAllowedHermesTools(userPermissions);
  const isConversational = isConversationalGreeting(userMessage);
  const activeTools = isConversational ? [] : allowedTools;
  const requestBody: GeminiRequest = {
    contents,
    ...(activeTools.length > 0 ? { tools: [{ functionDeclarations: activeTools.map(tool => sanitizeFunctionDeclaration(tool.declaration)) }] } : {}),
    systemInstruction: { parts: [{ text: buildSystemInstruction(activeTools, userPreferences) }] },
    generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
  };

  let providerResponse = await callGeminiWithEnvironmentFallback(geminiKey, requestBody);
  let data = providerResponse.data;
  geminiKey = providerResponse.apiKey;
  const functionCallsMade: string[] = [];
  let promptTokens = tokenUsagePart(data, "promptTokenCount");
  let completionTokens = tokenUsagePart(data, "candidatesTokenCount");
  let tokensUsed = tokenUsageTotal(data, promptTokens, completionTokens);
  let pendingActionRequest: PendingActionRequest | undefined;
  const executedReadResults: Array<{ name: string; args: Record<string, unknown>; output: any }> = [];
  let sawTextFunctionCall = false;

  // 4. Processa function calls em loop (até 3 iterações consecutivas para multi-intent)
  let iterations = 0;
  while (iterations < 3) {
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const structuredCalls = parts.filter((p: any) => Boolean(p.functionCall));
    const candidateText = parts.map((p: any) => typeof p.text === "string" ? p.text : "").join("\n");
    const textCallTurn = structuredCalls.length === 0 && /<functionCall\b/i.test(candidateText);
    if (textCallTurn) sawTextFunctionCall = true;
    const functionCallParts = textCallTurn
      ? parseTextFunctionCalls(candidateText, userPermissions)
      : structuredCalls;
    if (functionCallParts.length === 0) break;

    iterations++;
    const modelParts: any[] = [];
    const functionResponseParts: any[] = [];

    // Se houver ferramentas MUTATION, processa a primeira mutação como HITL e encerra o loop
    const mutationFcp = functionCallParts.find((fcp: any) => {
      const tool = getAuthorizedHermesTool(fcp.functionCall?.name, userPermissions);
      return tool?.type === "MUTATION";
    });

    if (mutationFcp) {
      const fc = mutationFcp.functionCall;
      functionCallsMade.push(fc.name);
      const authorizedTool = getAuthorizedHermesTool(fc.name, userPermissions)!;
      let mutationArgs = fc.args ?? {};
      if (fc.name === "create_proposal") {
        mutationArgs = enforceUserProvidedPrices(mutationArgs, userMessage, existingHistory);
      }
      pendingActionRequest = createPendingActionRequest(authorizedTool, mutationArgs, { clientId, userId });
      break;
    }

    // Executa todas as ferramentas READ em paralelo com Promise.all
    for (const fcp of functionCallParts) {
      const fc = fcp.functionCall;
      functionCallsMade.push(fc.name);
      modelParts.push({ functionCall: fc });
    }

    const toolExecutionResults = await Promise.all(
      functionCallParts.map(async (fcp: any) => {
        const fc = fcp.functionCall;
        let funcResult: string;
        try {
          funcResult = await executeClientFunction(fc.name, fc.args ?? {}, clientId, userPermissions, geminiKey, userId);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Falha ao executar ferramenta local.";
          funcResult = JSON.stringify({ success: false, error: message });
        }

        let parsedOutput: unknown;
        try {
          parsedOutput = JSON.parse(funcResult);
        } catch {
          parsedOutput = funcResult;
        }

        return {
          name: fc.name,
          args: fc.args ?? {},
          output: parsedOutput,
        };
      })
    );

    for (const res of toolExecutionResults) {
      executedReadResults.push(res);
      functionResponseParts.push({
        functionResponse: {
          name: res.name,
          response: {
            output: res.output,
            instrucao_resposta: "Use somente dados efetivamente retornados pelas ferramentas. Se faltar consulta complementar, chame a ferramenta correspondente sem preâmbulo. Se a consulta falhou, informe a falha; se o resultado está vazio, informe ausência. Responda de forma breve e direta.",
            ...(res.output && typeof res.output === "object" && !Array.isArray(res.output) ? res.output : {}),
          },
        },
      });
    }

    // O provedor não emitiu uma chamada estruturada: não forjar um turno nativo.
    // Os resultados reais serão formatados deterministicamente abaixo.
    if (textCallTurn) break;

    requestBody.contents = [
      ...requestBody.contents,
      { role: "model", parts: modelParts },
      { role: "user", parts: functionResponseParts },
    ];
    providerResponse = await callGeminiWithEnvironmentFallback(geminiKey, requestBody);
    data = providerResponse.data;
    geminiKey = providerResponse.apiKey;
    const nextPromptTokens = tokenUsagePart(data, "promptTokenCount");
    const nextCompletionTokens = tokenUsagePart(data, "candidatesTokenCount");
    promptTokens += nextPromptTokens;
    completionTokens += nextCompletionTokens;
    tokensUsed += tokenUsageTotal(data, nextPromptTokens, nextCompletionTokens);
  }

  // A resposta textual do modelo não comprova uma consulta. Para intenções
  // inequívocas, executa a leitura autorizada mesmo se o modelo a omitiu.
  const requiredReadTool = requiredBusinessReadTool(userMessage);
  if (requiredReadTool && !pendingActionRequest
    && !executedReadResults.some(result => result.name === requiredReadTool)
    && getAuthorizedHermesTool(requiredReadTool, userPermissions)) {
    const rawResult = await executeClientFunction(requiredReadTool, {}, clientId, userPermissions, geminiKey, userId);
    let output: unknown;
    try { output = JSON.parse(rawResult); } catch { output = { success: false }; }
    executedReadResults.push({ name: requiredReadTool, args: {}, output });
    functionCallsMade.push(requiredReadTool);
  }

  // Se a intenção do usuário foi orçamento/proposta e a checagem READ terminou sem pendingActionRequest,
  // emite a pendingActionRequest de create_proposal para que o Card HITL seja renderizado na tela.
  const proposalDetails = extractProposalDetailsFromMessage(userMessage, executedReadResults, existingHistory);
  if (proposalDetails.isProposal && !pendingActionRequest) {
    const createProposalTool = getAllowedHermesTools(userPermissions).find(t => t.name === "create_proposal");
    if (createProposalTool) {
      try {
        pendingActionRequest = createPendingActionRequest(
          createProposalTool,
          {
            clientName: proposalDetails.clientName,
            items: proposalDetails.items,
            notes: `Orçamento gerado a partir do pedido do usuário: "${userMessage}"`,
          },
          { clientId, userId }
        );
        if (!functionCallsMade.includes("create_proposal")) {
          functionCallsMade.push("create_proposal");
        }
      } catch {
        // Se houver qualquer falha na validação de parâmetros, segue sem travar
      }
    }
  }

  // Se o usuário solicitou cadastro de entidade (fornecedor, cliente, serviço, produto, proposta) e o modelo não emitiu functionCall
  if (!pendingActionRequest) {
    const entityAction = extractEntityCreationFromMessage(userMessage, allowedTools, { clientId, userId }, existingHistory);
    if (entityAction) {
      pendingActionRequest = entityAction;
      if (!functionCallsMade.includes(entityAction.toolName)) {
        functionCallsMade.push(entityAction.toolName);
      }
    }
  }

  const candidateParts = data?.candidates?.[0]?.content?.parts ?? [];
  let modelText = candidateParts
    .map((p: any) => (typeof p.text === "string" ? p.text.trim() : ""))
    .filter(Boolean)
    .join("\n")
    .trim();

  modelText = sanitizeModelResponseText(modelText);

  if (isPreliminaryWaitingText(modelText)) {
    modelText = "";
  }

  const synthesizedFallback = synthesizeDeterministicResponse(executedReadResults, userMessage);

  const ticketsResult = executedReadResults.find(r => r.name === "get_open_tickets" || r.name === "get_tickets_overview");
  if (ticketsResult && (!modelText || isPreliminaryWaitingText(modelText))) {
    modelText = synthesizeDeterministicResponse(executedReadResults, userMessage) || "";
  }

  let finalResponse = modelText;

  if (!finalResponse || isPreliminaryWaitingText(finalResponse)) {
    if (detectedPrefs) {
      const salutation = userPreferences.preferredName || userPreferences.honorific || "Operador";
      finalResponse = `Entendido, ${salutation}. A partir de agora nos comunicaremos desta forma.`;
    } else 
    if (synthesizedFallback) {
      finalResponse = synthesizedFallback;
    } else if (pendingActionRequest) {
      const rawTarget = pendingActionRequest.args.name ??
        pendingActionRequest.args.legalName ??
        pendingActionRequest.args.clientName ??
        pendingActionRequest.args.title;
      const targetName = typeof rawTarget === "string" ? rawTarget.trim() : "";

      if (pendingActionRequest.actionType === "CREATE_PROPOSAL") {
        finalResponse = "Preparei a proposta abaixo para sua revisão:";
      } else if (pendingActionRequest.actionType === "CREATE_SUPPLIER") {
        finalResponse = targetName
          ? `Preparei o cadastro do fornecedor ${targetName} para sua aprovação:`
          : "Preparei o cadastro do fornecedor para sua aprovação:";
      } else if (pendingActionRequest.actionType === "UPDATE_SUPPLIER") {
        finalResponse = targetName
          ? `Preparei a atualização do fornecedor ${targetName} para sua aprovação:`
          : "Preparei a atualização do fornecedor para sua aprovação:";
      } else if (pendingActionRequest.actionType === "UPDATE_PROPOSAL_STATUS") {
        const isSale = pendingActionRequest.args.convertToSale || pendingActionRequest.args.newStatus === "sale" || pendingActionRequest.args.newStatus === "converted";
        finalResponse = isSale
          ? "Preparei a aprovação e conversão da proposta comercial em venda para sua confirmação:"
          : "Preparei a atualização da proposta comercial para sua aprovação:";
      } else if (pendingActionRequest.actionType === "CREATE_CLIENT") {
        finalResponse = targetName
          ? `Preparei o cadastro do cliente ${targetName} para sua aprovação:`
          : "Preparei o cadastro do cliente para sua aprovação:";
      } else if (pendingActionRequest.actionType === "CREATE_PRODUCT") {
        finalResponse = targetName
          ? `Preparei o cadastro do produto ${targetName} para sua aprovação:`
          : "Preparei o cadastro do produto para sua aprovação:";
      } else if (pendingActionRequest.actionType === "CREATE_SERVICE") {
        finalResponse = targetName
          ? `Preparei o cadastro do serviço ${targetName} para sua aprovação:`
          : "Preparei o cadastro do serviço para sua aprovação:";
      } else if (pendingActionRequest.actionType === "CREATE_TICKET") {
        finalResponse = targetName
          ? `Preparei a abertura do chamado "${targetName}" para sua aprovação:`
          : "Preparei a abertura do chamado para sua aprovação:";
      } else if (pendingActionRequest.summary) {
        finalResponse = `Preparei a seguinte ação para sua aprovação: ${pendingActionRequest.summary}`;
      } else {
        finalResponse = "Preparei a ação solicitada para sua aprovação:";
      }
    } else if (executedReadResults.length > 0) {
      finalResponse = "Consulta realizada com sucesso no sistema, mas não há detalhes adicionais para exibir no momento.";
    } else {
      finalResponse = "Não consegui processar a resposta neste momento. Pode repetir ou detalhar sua solicitação?";
    }
  }

  // Garantia absoluta: se get_open_tickets foi executado, sintetizar deterministicamente
  if (ticketsResult && (!finalResponse || isPreliminaryWaitingText(finalResponse))) {
    finalResponse = synthesizeDeterministicResponse([ticketsResult], userMessage) || "Não há chamados abertos no momento.";
  }

  if (!pendingActionRequest && requiredReadTool) {
    const requiredResult = executedReadResults.find(result => result.name === requiredReadTool);
    finalResponse = requiredResult
      ? synthesizeDeterministicSingle(requiredResult, userMessage, executedReadResults)
        || "Não foi possível confirmar os dados solicitados."
      : "Você não possui permissão para consultar dados deste módulo.";
  } else if (!pendingActionRequest && asksForBusinessData(userMessage)) {
    const readResults = executedReadResults.filter(result => result.name !== "set_user_preference");
    finalResponse = readResults.map(result => result.output?.success === false
      ? "Não foi possível consultar os dados solicitados no momento."
      : synthesizeDeterministicSingle(result, userMessage, readResults))
      .filter(Boolean).join("\n\n") || "Não foi possível consultar os dados solicitados no momento.";
  }

  if (sawTextFunctionCall && !pendingActionRequest) {
    finalResponse = executedReadResults.map(result => result.output?.success === false
      ? "Não foi possível consultar os dados solicitados no momento."
      : synthesizeDeterministicSingle(result, userMessage, executedReadResults))
      .filter(Boolean).join("\n\n") || "Não foi possível executar a consulta solicitada.";
  }
  finalResponse = sanitizeModelResponseText(finalResponse)
    || "Não foi possível obter uma resposta válida no momento.";

  // 5. Salva no histórico
  const updatedHistory: IAMessage[] = [
    ...existingHistory,
    { role: "user", content: userMessage, timestamp: Date.now() },
    {
      role: "assistant",
      content: finalResponse,
      timestamp: Date.now(),
      ...(pendingActionRequest ? { pendingActionRequest } : {}),
    },
  ];

  // Mantém apenas as últimas 50 mensagens
  const trimmedHistory = updatedHistory.slice(-50);
  await saveConversationHistory(clientId, userId, trimmedHistory);

  // 6. Loga a conversa
  const conversationId = await logIAConversation(
    clientId, userId, userMessage, finalResponse, tokensUsed
  );
  await recordTokenUsage({
    clientId,
    userEmail: userId,
    conversationId,
    promptTokens,
    completionTokens,
    totalTokens: tokensUsed,
    model: GEMINI_MODEL,
    functionCallsCount: functionCallsMade.length,
  });

  return {
    ok: true,
    response: finalResponse,
    tokensUsed,
    conversationId,
    functionCallsMade,
    pendingActionRequest,
  };
}

/**
 * Boundary for the tenant chat: logs diagnostic provider details server-side
 * while callers continue to receive the existing safe tRPC error response.
 */
export async function chatWithClientGemini(
  clientId: string,
  userId: string,
  userMessage: string,
  existingHistory: IAMessage[],
  userPermissions: readonly string[],
): Promise<ChatResult> {
  try {
    return await chatWithClientGeminiInternal(clientId, userId, userMessage, existingHistory, userPermissions);
  } catch (error: any) {
    const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError" || /tempo limite|timeout|excedeu o tempo/i.test(error?.message || "");
    if (isTimeout) {
      console.warn("[Assistant] Gemini request timed out in chatWithClientGemini:", error);
      const timeoutResponse = "O processamento demorou mais que o esperado devido à alta latência momentânea do serviço de IA. Por favor, tente enviar sua mensagem novamente.";
      try {
        const currentHistory = await loadConversationHistory(clientId, userId);
        const updatedHistory = [...currentHistory, { role: "assistant" as const, content: timeoutResponse, timestamp: Date.now() }].slice(-50);
        await saveConversationHistory(clientId, userId, updatedHistory);
      } catch {}
      return {
        ok: true,
        response: timeoutResponse,
        tokensUsed: 0,
        conversationId: `conv-${nanoid()}`,
      };
    }
    const providerError = error as Error & { details?: unknown; cause?: unknown };
    console.error("[Assistant] Gemini chat failed:", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      details: providerError?.details ?? providerError?.cause,
    });
    throw error;
  }
}
