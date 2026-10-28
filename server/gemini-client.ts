/**
 * Gemini IA Client — por cliente
 * Usa fetch HTTP direto para a API Gemini (mais compatível com ambientes de deploy).
 * Mantém histórico de conversa no banco de dados.
 * Suporta function calling para consultar dados do ERP/conversas/chamados.
 */
import { getPool } from "./db";
import { nanoid } from "nanoid";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_MODEL = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
export const MAX_GEMINI_PROMPT_HISTORY_MESSAGES = 10;
export const GEMINI_REQUEST_TIMEOUT_MS = 45_000;

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
}

/** Seleciona apenas a janela recente enviada ao provedor, sem truncar o histórico persistido. */
export function selectGeminiPromptHistory(history: readonly IAMessage[]): IAMessage[] {
  return history.slice(-MAX_GEMINI_PROMPT_HISTORY_MESSAGES);
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
export type HermesErpActionType = "CREATE_PRODUCT" | "UPDATE_PRODUCT" | "LINK_PRODUCT_SUPPLIER" | "UPDATE_SERVICE" | "CREATE_SUPPLIER" | "UPDATE_SUPPLIER" | "REQUEST_PURCHASE" | "SEND_SUPPLIER_MESSAGE";
export type HermesActionType = HermesTicketActionType | HermesCrmActionType | HermesErpActionType;

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: { type: "OBJECT"; properties: Record<string, unknown>; required: string[] };
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

function ticketOverviewArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["status", "search", "limit"]);
  const status = args.status === undefined ? undefined : enumArg(args, "status", ["open", "in_progress", "waiting", "closed"] as const);
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
  const ticketNumber = args.ticketNumber === undefined ? undefined : Number(args.ticketNumber);
  if (ticketNumber !== undefined && (!Number.isInteger(ticketNumber) || ticketNumber < 1)) throw new Error("ticketNumber inválido.");
  if ((ticketId ? 1 : 0) + (ticketNumber ? 1 : 0) !== 1) throw new Error("Informe exatamente ticketId ou ticketNumber.");
  return ticketId ? { ticketId } : { ticketNumber };
}

function createTicketArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["title", "description", "priority", "clientNameOuId", "category"]);
  return {
    title: stringArg(args, "title", { min: 1, max: 500 })!,
    description: stringArg(args, "description", { min: 1, max: 2_000 })!,
    priority: enumArg(args, "priority", ["low", "medium", "high", "urgent"] as const),
    clientNameOuId: stringArg(args, "clientNameOuId", { min: 1, max: 180 })!,
    ...(stringArg(args, "category", { min: 1, max: 120, optional: true }) ? { category: stringArg(args, "category", { min: 1, max: 120, optional: true }) } : {}),
  };
}

function updateTicketStatusArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["ticketId", "newStatus", "resolutionNotes"]);
  return {
    ticketId: stringArg(args, "ticketId", { min: 1, max: 80 })!,
    newStatus: enumArg(args, "newStatus", ["open", "in_progress", "resolved", "closed"] as const),
    ...(stringArg(args, "resolutionNotes", { min: 1, max: 2_000, optional: true }) ? { resolutionNotes: stringArg(args, "resolutionNotes", { min: 1, max: 2_000, optional: true }) } : {}),
  };
}

function assignTicketArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["ticketId", "assigneeNameOuId", "transferReason"]);
  return {
    ticketId: stringArg(args, "ticketId", { min: 1, max: 80 })!,
    assigneeNameOuId: stringArg(args, "assigneeNameOuId", { min: 1, max: 180 })!,
    ...(stringArg(args, "transferReason", { min: 1, max: 2_000, optional: true }) ? { transferReason: stringArg(args, "transferReason", { min: 1, max: 2_000, optional: true }) } : {}),
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
  objectArgs(args); rejectUnknownArgs(args, []); return {};
}

function crmClientLookupArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["clientId", "search"]);
  const clientId = stringArg(args, "clientId", { min: 1, max: 80, optional: true });
  const search = stringArg(args, "search", { min: 2, max: 180, optional: true });
  if ((clientId ? 1 : 0) + (search ? 1 : 0) !== 1) throw new Error("Informe exatamente clientId ou search.");
  return clientId ? { clientId } : { search };
}

function createClientArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["name", "document", "phone", "email", "notes"]);
  const email = stringArg(args, "email", { min: 3, max: 255, optional: true });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error("E-mail inválido.");
  return {
    name: stringArg(args, "name", { min: 1, max: 255 })!,
    ...(stringArg(args, "document", { min: 8, max: 20, optional: true }) ? { document: stringArg(args, "document", { min: 8, max: 20, optional: true }) } : {}),
    ...(stringArg(args, "phone", { min: 8, max: 40, optional: true }) ? { phone: stringArg(args, "phone", { min: 8, max: 40, optional: true }) } : {}),
    ...(email ? { email } : {}),
    ...(stringArg(args, "notes", { min: 1, max: 2_000, optional: true }) ? { notes: stringArg(args, "notes", { min: 1, max: 2_000, optional: true }) } : {}),
  };
}

function updateClientArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["clientId", "fieldsToUpdate"]);
  const fields = args.fieldsToUpdate;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("fieldsToUpdate inválido.");
  const allowed = ["name", "document", "phone", "email", "notes"];
  const record = fields as Record<string, unknown>;
  rejectUnknownArgs(record, allowed);
  if (!Object.keys(record).length) throw new Error("fieldsToUpdate não pode estar vazio.");
  const normalized = createClientArgs({ name: typeof record.name === "string" ? record.name : "Atualização", ...record });
  delete normalized.name;
  return { clientId: stringArg(args, "clientId", { min: 1, max: 80 })!, fieldsToUpdate: normalized };
}

function clientTimelineArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["clientId", "title", "description", "eventType"]);
  return {
    clientId: stringArg(args, "clientId", { min: 1, max: 80 })!, title: stringArg(args, "title", { min: 1, max: 180 })!,
    description: stringArg(args, "description", { min: 1, max: 2_000 })!, eventType: enumArg(args, "eventType", ["call", "note", "meeting"] as const),
  };
}

function proposalSummaryArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["status", "sellerId", "period"]);
  const status = args.status === undefined ? undefined : enumArg(args, "status", ["draft", "negotiation", "approved", "lost"] as const);
  const sellerId = stringArg(args, "sellerId", { min: 1, max: 80, optional: true });
  const period = args.period === undefined ? undefined : enumArg(args, "period", ["7", "30", "90"] as const);
  return { ...(status ? { status } : {}), ...(sellerId ? { sellerId } : {}), ...(period ? { period } : {}) };
}

function proposalDetailsArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["proposalId", "proposalNumber"]);
  const proposalId = stringArg(args, "proposalId", { min: 1, max: 80, optional: true });
  const proposalNumber = stringArg(args, "proposalNumber", { min: 1, max: 80, optional: true });
  if ((proposalId ? 1 : 0) + (proposalNumber ? 1 : 0) !== 1) throw new Error("Informe exatamente proposalId ou proposalNumber.");
  return proposalId ? { proposalId } : { proposalNumber };
}

function createProposalArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["clientId", "clientName", "items", "notes", "paymentTerms"]);
  const clientId = stringArg(args, "clientId", { min: 1, max: 80, optional: true });
  const clientName = stringArg(args, "clientName", { min: 2, max: 180, optional: true });
  if ((clientId ? 1 : 0) + (clientName ? 1 : 0) !== 1) throw new Error("Informe exatamente clientId ou clientName.");
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
      productName: productName ?? description ?? (productId ? `Produto ${productId}` : "Item Avulso"),
      ...(description ? { description } : {}),
      quantity,
      unitPrice,
    };
  });
  return { ...(clientId ? { clientId } : { clientName }), items, ...(stringArg(args, "notes", { min: 1, max: 4_000, optional: true }) ? { notes: stringArg(args, "notes", { min: 1, max: 4_000, optional: true }) } : {}), ...(stringArg(args, "paymentTerms", { min: 1, max: 500, optional: true }) ? { paymentTerms: stringArg(args, "paymentTerms", { min: 1, max: 500, optional: true }) } : {}) };
}

function proposalStatusArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["proposalId", "newStatus", "reason"]);
  return { proposalId: stringArg(args, "proposalId", { min: 1, max: 80 })!, newStatus: enumArg(args, "newStatus", ["draft", "negotiation", "approved", "rejected", "expired"] as const), ...(stringArg(args, "reason", { min: 1, max: 500, optional: true }) ? { reason: stringArg(args, "reason", { min: 1, max: 500, optional: true }) } : {}) };
}

function proposalWhatsappArgs(args: Record<string, unknown>): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, ["proposalId", "recipientPhone", "customMessage"]);
  return { proposalId: stringArg(args, "proposalId", { min: 1, max: 80 })!, recipientPhone: stringArg(args, "recipientPhone", { min: 8, max: 40 })!, ...(stringArg(args, "customMessage", { min: 1, max: 2_000, optional: true }) ? { customMessage: stringArg(args, "customMessage", { min: 1, max: 2_000, optional: true }) } : {}) };
}

function erpLookupArgs(args: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, fields);
  const result: Record<string, unknown> = {};
  for (const field of fields) if (typeof args[field] === "string") result[field] = stringArg(args, field, { min: 1, max: 180, optional: true });
  return result;
}
function productMutationArgs(args: Record<string, unknown>, update = false): Record<string, unknown> {
  objectArgs(args); rejectUnknownArgs(args, update ? ["productId", "fieldsToUpdate"] : ["name", "sku", "category", "salePrice", "costPrice", "initialStock", "unit"]);
  if (update) {
    const fields = args.fieldsToUpdate;
    if (!fields || typeof fields !== "object" || Array.isArray(fields) || !Object.keys(fields).length) throw new Error("fieldsToUpdate inválido.");
    const record = fields as Record<string, unknown>;
    rejectUnknownArgs(record, ["name", "sku", "barcode", "description", "category", "categoryPublicId", "brandPublicId", "unit", "costPriceCents", "salePriceCents", "minimumStock"]);
    return { productId: stringArg(args, "productId", { min: 1, max: 80 })!, fieldsToUpdate: record };
  }
  const price = (key: string) => { const value = Number(args[key]); if (!Number.isFinite(value) || value < 0) throw new Error(`${key} inválido.`); return value; };
  const quantity = Number(args.initialStock ?? 0); if (!Number.isFinite(quantity) || quantity < 0) throw new Error("initialStock inválido.");
  return { name: stringArg(args, "name", { min: 2, max: 180 })!, sku: stringArg(args, "sku", { min: 1, max: 80 })!, category: stringArg(args, "category", { min: 1, max: 120, optional: true }), salePrice: price("salePrice"), costPrice: price("costPrice"), initialStock: quantity, unit: enumArg(args, "unit", ["unit", "kg", "liter", "meter"] as const) };
}
function erpActionArgs(args: Record<string, unknown>, kind: "supplier" | "purchase" | "message" | "service" | "link"): Record<string, unknown> {
  objectArgs(args);
  const allowed = kind === "supplier" ? ["name", "document", "phone", "email", "contactName", "fieldsToUpdate", "supplierId"] : kind === "purchase" ? ["supplierId", "items", "notes"] : kind === "message" ? ["supplierId", "recipientPhone", "messageText"] : kind === "service" ? ["serviceId", "fieldsToUpdate"] : ["productId", "supplierId"];
  rejectUnknownArgs(args, allowed);
  if (kind === "link") return { productId: stringArg(args, "productId", { min: 1, max: 80 })!, supplierId: stringArg(args, "supplierId", { min: 1, max: 80 })! };
  if (kind === "service") { if (!args.fieldsToUpdate || typeof args.fieldsToUpdate !== "object" || Array.isArray(args.fieldsToUpdate)) throw new Error("fieldsToUpdate inválido."); return { serviceId: Number(args.serviceId), fieldsToUpdate: args.fieldsToUpdate as Record<string, unknown> }; }
  if (kind === "message") return { supplierId: stringArg(args, "supplierId", { min: 1, max: 80 })!, recipientPhone: stringArg(args, "recipientPhone", { min: 8, max: 40 })!, messageText: stringArg(args, "messageText", { min: 1, max: 2_000 })! };
  if (kind === "purchase") { if (!Array.isArray(args.items) || !args.items.length || args.items.length > 100) throw new Error("items inválido."); return { supplierId: stringArg(args, "supplierId", { min: 1, max: 80 })!, items: args.items, ...(typeof args.notes === "string" ? { notes: stringArg(args, "notes", { min: 1, max: 4_000 }) } : {}) }; }
  const update = args.fieldsToUpdate;
  if (update !== undefined && (!update || typeof update !== "object" || Array.isArray(update) || !Object.keys(update).length)) throw new Error("fieldsToUpdate inválido.");
  if (update) rejectUnknownArgs(update as Record<string, unknown>, ["name", "legalName", "document", "taxId", "phone", "email", "contactName", "tradeName", "notes"]);
  const result = { ...(typeof args.supplierId === "string" ? { supplierId: stringArg(args, "supplierId", { min: 1, max: 80 }) } : {}), ...(update ? { fieldsToUpdate: update as Record<string, unknown> } : {}), ...(typeof args.name === "string" ? { name: stringArg(args, "name", { min: 2, max: 180 }) } : {}), ...(typeof args.document === "string" ? { document: stringArg(args, "document", { min: 11, max: 20 }) } : {}), ...(typeof args.phone === "string" ? { phone: stringArg(args, "phone", { min: 8, max: 40 }) } : {}), ...(typeof args.email === "string" ? { email: stringArg(args, "email", { min: 3, max: 255 }) } : {}), ...(typeof args.contactName === "string" ? { contactName: stringArg(args, "contactName", { min: 1, max: 120 }) } : {}) };
  if (!result.supplierId && (!result.name || !result.document)) throw new Error("name e document são obrigatórios para criar fornecedor.");
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
    declaration: { name: "get_open_tickets", description: "Retorna o número de chamados/tickets abertos e quantos são urgentes.", parameters: { type: "OBJECT", properties: {}, required: [] } },
    validateArgs: noArguments,
  },
  {
    name: "get_tickets_overview",
    type: "READ",
    requiredPermissions: ["tickets", "support"],
    declaration: { name: "get_tickets_overview", description: "Retorna totais e chamados recentes do tenant; permite filtrar por status e texto.", parameters: { type: "OBJECT", properties: { status: { type: "STRING" }, search: { type: "STRING" }, limit: { type: "INTEGER" } }, required: [] } },
    validateArgs: ticketOverviewArgs,
  },
  {
    name: "get_ticket_details",
    type: "READ",
    requiredPermissions: ["tickets", "support"],
    declaration: { name: "get_ticket_details", description: "Retorna dados, responsável, atividades e mensagens de um chamado do tenant.", parameters: { type: "OBJECT", properties: { ticketId: { type: "STRING" }, ticketNumber: { type: "INTEGER" } }, required: [] } },
    validateArgs: ticketDetailsArgs,
  },
  {
    name: "create_ticket",
    type: "MUTATION",
    actionType: "CREATE_TICKET",
    requiredPermissions: ["tickets", "support"],
    declaration: { name: "create_ticket", description: "Prepara a criação de chamado; só executa após aprovação explícita.", parameters: { type: "OBJECT", properties: { title: { type: "STRING" }, description: { type: "STRING" }, priority: { type: "STRING", enum: ["low", "medium", "high", "urgent"] }, clientNameOuId: { type: "STRING" }, category: { type: "STRING" } }, required: ["title", "description", "priority", "clientNameOuId"] } },
    validateArgs: createTicketArgs,
  },
  {
    name: "update_ticket_status",
    type: "MUTATION",
    actionType: "UPDATE_TICKET_STATUS",
    requiredPermissions: ["tickets", "support"],
    declaration: { name: "update_ticket_status", description: "Prepara a mudança de status de um chamado; só executa após aprovação explícita.", parameters: { type: "OBJECT", properties: { ticketId: { type: "STRING" }, newStatus: { type: "STRING", enum: ["open", "in_progress", "resolved", "closed"] }, resolutionNotes: { type: "STRING" } }, required: ["ticketId", "newStatus"] } },
    validateArgs: updateTicketStatusArgs,
  },
  {
    name: "assign_ticket",
    type: "MUTATION",
    actionType: "ASSIGN_TICKET",
    requiredPermissions: ["tickets", "support"],
    declaration: { name: "assign_ticket", description: "Prepara o encaminhamento de chamado; só executa após aprovação explícita.", parameters: { type: "OBJECT", properties: { ticketId: { type: "STRING" }, assigneeNameOuId: { type: "STRING" }, transferReason: { type: "STRING" } }, required: ["ticketId", "assigneeNameOuId"] } },
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
  { name: "get_crm_summary", type: "READ", requiredPermissions: ["crm", "clients"], declaration: { name: "get_crm_summary", description: "Retorna métricas básicas da carteira CRM do tenant.", parameters: { type: "OBJECT", properties: {}, required: [] } }, validateArgs: crmSummaryArgs },
  { name: "get_client_360", type: "READ", requiredPermissions: ["crm", "clients"], declaration: { name: "get_client_360", description: "Retorna cadastro, chamados, conversas e timeline de um cliente CRM do tenant.", parameters: { type: "OBJECT", properties: { clientId: { type: "STRING" }, search: { type: "STRING" } }, required: [] } }, validateArgs: crmClientLookupArgs },
  { name: "create_client", type: "MUTATION", actionType: "CREATE_CLIENT", requiredPermissions: ["crm", "clients"], declaration: { name: "create_client", description: "Prepara a criação de cliente CRM; exige aprovação humana.", parameters: { type: "OBJECT", properties: { name: { type: "STRING" }, document: { type: "STRING" }, phone: { type: "STRING" }, email: { type: "STRING" }, notes: { type: "STRING" } }, required: ["name"] } }, validateArgs: createClientArgs },
  { name: "update_client", type: "MUTATION", actionType: "UPDATE_CLIENT", requiredPermissions: ["crm", "clients"], declaration: { name: "update_client", description: "Prepara atualização de cliente CRM; exige aprovação humana.", parameters: { type: "OBJECT", properties: { clientId: { type: "STRING" }, fieldsToUpdate: { type: "OBJECT", description: "Campos a atualizar", properties: { name: { type: "STRING" }, document: { type: "STRING" }, phone: { type: "STRING" }, email: { type: "STRING" }, notes: { type: "STRING" } } } }, required: ["clientId", "fieldsToUpdate"] } }, validateArgs: updateClientArgs },
  { name: "add_client_timeline_event", type: "MUTATION", actionType: "ADD_CLIENT_TIMELINE", requiredPermissions: ["crm", "clients"], declaration: { name: "add_client_timeline_event", description: "Prepara evento de timeline CRM; exige aprovação humana.", parameters: { type: "OBJECT", properties: { clientId: { type: "STRING" }, title: { type: "STRING" }, description: { type: "STRING" }, eventType: { type: "STRING", enum: ["call", "note", "meeting"] } }, required: ["clientId", "title", "description", "eventType"] } }, validateArgs: clientTimelineArgs },
  { name: "get_proposals_summary", type: "READ", requiredPermissions: ["sales", "crm", "proposals"], declaration: { name: "get_proposals_summary", description: "Retorna métricas de propostas comerciais do tenant.", parameters: { type: "OBJECT", properties: { status: { type: "STRING" }, sellerId: { type: "STRING" }, period: { type: "STRING" } }, required: [] } }, validateArgs: proposalSummaryArgs },
  { name: "get_proposal_details", type: "READ", requiredPermissions: ["sales", "crm", "proposals"], declaration: { name: "get_proposal_details", description: "Retorna proposta, cliente e itens do tenant.", parameters: { type: "OBJECT", properties: { proposalId: { type: "STRING" }, proposalNumber: { type: "STRING" } }, required: [] } }, validateArgs: proposalDetailsArgs },
  { name: "create_proposal", type: "MUTATION", actionType: "CREATE_PROPOSAL", requiredPermissions: ["sales", "crm", "proposals"], declaration: { name: "create_proposal", description: "Prepara proposta comercial; exige aprovação humana.", parameters: { type: "OBJECT", properties: { clientId: { type: "STRING", description: "ID do cliente CRM (obtido via get_client_360). Use este OU clientName." }, clientName: { type: "STRING", description: "Nome do cliente CRM; deve identificar um único cliente." }, items: { type: "ARRAY", description: "Itens ou serviços da proposta. Aceita productId de catálogo ou descrição/nome avulso.", items: { type: "OBJECT", properties: { productId: { type: "STRING", description: "ID do produto no catálogo (opcional)" }, productName: { type: "STRING", description: "Nome do produto ou serviço" }, description: { type: "STRING", description: "Descrição do item ou serviço avulso" }, quantity: { type: "NUMBER", description: "Quantidade (padrão 1 se omitido)" }, unitPrice: { type: "NUMBER", description: "Preço unitário em reais (padrão 0 para rascunho se omitido)" } }, required: [] } }, notes: { type: "STRING" }, paymentTerms: { type: "STRING" } }, required: ["items"] } }, validateArgs: createProposalArgs },
  { name: "update_proposal_status", type: "MUTATION", actionType: "UPDATE_PROPOSAL_STATUS", requiredPermissions: ["sales", "crm", "proposals"], declaration: { name: "update_proposal_status", description: "Prepara mudança de status comercial; exige aprovação humana.", parameters: { type: "OBJECT", properties: { proposalId: { type: "STRING" }, newStatus: { type: "STRING", enum: ["draft", "negotiation", "approved", "rejected", "expired"] }, reason: { type: "STRING" } }, required: ["proposalId", "newStatus"] } }, validateArgs: proposalStatusArgs },
  { name: "send_proposal_whatsapp", type: "MUTATION", actionType: "SEND_PROPOSAL_WHATSAPP", requiredPermissions: ["sales", "crm", "proposals"], declaration: { name: "send_proposal_whatsapp", description: "Prepara envio de proposta por WhatsApp; exige aprovação humana.", parameters: { type: "OBJECT", properties: { proposalId: { type: "STRING" }, recipientPhone: { type: "STRING" }, customMessage: { type: "STRING" } }, required: ["proposalId", "recipientPhone"] } }, validateArgs: proposalWhatsappArgs },
  { name: "get_erp_summary", type: "READ", requiredPermissions: ["products", "inventory", "erp"], declaration: { name: "get_erp_summary", description: "Retorna o resumo de produtos, estoque e serviços ativos do tenant.", parameters: { type: "OBJECT", properties: {}, required: [] } }, validateArgs: noArguments },
  { name: "get_product_details", type: "READ", requiredPermissions: ["products", "inventory", "erp"], declaration: { name: "get_product_details", description: "Retorna detalhes de produto por ID público ou SKU.", parameters: { type: "OBJECT", properties: { productId: { type: "STRING" }, sku: { type: "STRING" } }, required: [] } }, validateArgs: args => { const value = erpLookupArgs(args, ["productId", "sku"]); if ((value.productId ? 1 : 0) + (value.sku ? 1 : 0) !== 1) throw new Error("Informe exatamente productId ou sku."); return value; } },
  { name: "get_inventory_status", type: "READ", requiredPermissions: ["products", "inventory", "erp"], declaration: { name: "get_inventory_status", description: "Consulta saldos por status de estoque ou busca textual.", parameters: { type: "OBJECT", properties: { status: { type: "STRING" }, search: { type: "STRING" } }, required: [] } }, validateArgs: args => { objectArgs(args); rejectUnknownArgs(args, ["status", "search"]); const value: Record<string, unknown> = {}; if (typeof args.search === "string") value.search = stringArg(args, "search", { min: 1, max: 180 }); if (args.status !== undefined) value.status = enumArg(args, "status", ["empty", "low", "regular"] as const); return value; } },
  { name: "create_product", type: "MUTATION", actionType: "CREATE_PRODUCT", requiredPermissions: ["products", "inventory", "erp"], declaration: { name: "create_product", description: "Prepara criação de produto; exige aprovação humana.", parameters: { type: "OBJECT", properties: { name: { type: "STRING" }, sku: { type: "STRING" }, category: { type: "STRING" }, salePrice: { type: "NUMBER" }, costPrice: { type: "NUMBER" }, initialStock: { type: "NUMBER" }, unit: { type: "STRING" } }, required: ["name", "sku", "salePrice", "costPrice", "unit"] } }, validateArgs: args => productMutationArgs(args) },
  { name: "update_product", type: "MUTATION", actionType: "UPDATE_PRODUCT", requiredPermissions: ["products", "inventory", "erp"], declaration: { name: "update_product", description: "Prepara atualização de produto; exige aprovação humana.", parameters: { type: "OBJECT", properties: { productId: { type: "STRING" }, fieldsToUpdate: { type: "OBJECT", description: "Campos a atualizar", properties: { name: { type: "STRING" }, sku: { type: "STRING" }, barcode: { type: "STRING" }, description: { type: "STRING" }, category: { type: "STRING" }, categoryPublicId: { type: "STRING" }, brandPublicId: { type: "STRING" }, unit: { type: "STRING" }, costPriceCents: { type: "NUMBER" }, salePriceCents: { type: "NUMBER" }, minimumStock: { type: "NUMBER" } } } }, required: ["productId", "fieldsToUpdate"] } }, validateArgs: args => productMutationArgs(args, true) },
  { name: "link_product_supplier", type: "MUTATION", actionType: "LINK_PRODUCT_SUPPLIER", requiredPermissions: ["products", "suppliers", "erp"], declaration: { name: "link_product_supplier", description: "Prepara vínculo de fornecedor ao produto; exige aprovação humana.", parameters: { type: "OBJECT", properties: { productId: { type: "STRING" }, supplierId: { type: "STRING" } }, required: ["productId", "supplierId"] } }, validateArgs: args => erpActionArgs(args, "link") },
  { name: "get_services_list", type: "READ", requiredPermissions: ["services", "erp"], declaration: { name: "get_services_list", description: "Lista serviços, valores e status do tenant.", parameters: { type: "OBJECT", properties: { search: { type: "STRING" } }, required: [] } }, validateArgs: args => erpLookupArgs(args, ["search"]) },
  { name: "update_service", type: "MUTATION", actionType: "UPDATE_SERVICE", requiredPermissions: ["services", "erp"], declaration: { name: "update_service", description: "Prepara atualização de serviço; exige aprovação humana.", parameters: { type: "OBJECT", properties: { serviceId: { type: "INTEGER" }, fieldsToUpdate: { type: "OBJECT", description: "Campos a atualizar", properties: { name: { type: "STRING" }, code: { type: "STRING" }, category: { type: "STRING" }, price: { type: "NUMBER" }, estimatedCost: { type: "NUMBER" }, isActive: { type: "BOOLEAN" } } } }, required: ["serviceId", "fieldsToUpdate"] } }, validateArgs: args => erpActionArgs(args, "service") },
  { name: "get_sales_analytics", type: "READ", requiredPermissions: ["sales", "erp"], declaration: { name: "get_sales_analytics", description: "Retorna faturamento, pedidos e ticket médio no período solicitado.", parameters: { type: "OBJECT", properties: { period: { type: "STRING" }, startDate: { type: "STRING" }, endDate: { type: "STRING" } }, required: [] } }, validateArgs: args => { objectArgs(args); rejectUnknownArgs(args, ["period", "startDate", "endDate"]); const period = args.period === undefined ? "month" : enumArg(args, "period", ["today", "week", "month", "custom"] as const); const result: Record<string, unknown> = { period }; if (period === "custom") { result.startDate = stringArg(args, "startDate", { min: 10, max: 10 })!; result.endDate = stringArg(args, "endDate", { min: 10, max: 10 })!; } return result; } },
  { name: "get_suppliers_list", type: "READ", requiredPermissions: ["suppliers", "purchases", "erp"], declaration: { name: "get_suppliers_list", description: "Busca fornecedores por nome, documento ou segmento.", parameters: { type: "OBJECT", properties: { search: { type: "STRING" } }, required: [] } }, validateArgs: args => erpLookupArgs(args, ["search"]) },
  { name: "create_supplier", type: "MUTATION", actionType: "CREATE_SUPPLIER", requiredPermissions: ["suppliers", "purchases", "erp"], declaration: { name: "create_supplier", description: "Prepara criação de fornecedor; exige aprovação humana.", parameters: { type: "OBJECT", properties: { name: { type: "STRING" }, document: { type: "STRING" }, phone: { type: "STRING" }, email: { type: "STRING" }, contactName: { type: "STRING" } }, required: ["name", "document"] } }, validateArgs: args => erpActionArgs(args, "supplier") },
  { name: "update_supplier", type: "MUTATION", actionType: "UPDATE_SUPPLIER", requiredPermissions: ["suppliers", "purchases", "erp"], declaration: { name: "update_supplier", description: "Prepara atualização de fornecedor; exige aprovação humana.", parameters: { type: "OBJECT", properties: { supplierId: { type: "STRING" }, fieldsToUpdate: { type: "OBJECT", description: "Campos a atualizar", properties: { name: { type: "STRING" }, legalName: { type: "STRING" }, document: { type: "STRING" }, taxId: { type: "STRING" }, phone: { type: "STRING" }, email: { type: "STRING" }, contactName: { type: "STRING" }, tradeName: { type: "STRING" }, notes: { type: "STRING" } } } }, required: ["supplierId", "fieldsToUpdate"] } }, validateArgs: args => erpActionArgs(args, "supplier") },
  { name: "request_purchase_order", type: "MUTATION", actionType: "REQUEST_PURCHASE", requiredPermissions: ["suppliers", "purchases", "erp"], declaration: { name: "request_purchase_order", description: "Prepara pedido de compra; exige aprovação humana.", parameters: { type: "OBJECT", properties: { supplierId: { type: "STRING" }, items: { type: "ARRAY", description: "Itens do pedido de compra", items: { type: "OBJECT", properties: { productId: { type: "STRING", description: "ID público do produto" }, quantity: { type: "NUMBER" }, targetCost: { type: "NUMBER", description: "Custo alvo unitário em reais" } }, required: ["productId", "quantity", "targetCost"] } }, notes: { type: "STRING" } }, required: ["supplierId", "items"] } }, validateArgs: args => erpActionArgs(args, "purchase") },
  { name: "send_supplier_message", type: "MUTATION", actionType: "SEND_SUPPLIER_MESSAGE", requiredPermissions: ["suppliers", "purchases", "erp"], declaration: { name: "send_supplier_message", description: "Prepara mensagem a fornecedor; exige aprovação humana.", parameters: { type: "OBJECT", properties: { supplierId: { type: "STRING" }, recipientPhone: { type: "STRING" }, messageText: { type: "STRING" } }, required: ["supplierId", "recipientPhone", "messageText"] } }, validateArgs: args => erpActionArgs(args, "message") },
  {
    name: "get_conversations_summary",
    type: "READ",
    requiredPermissions: ["conversations", "chat"],
    declaration: { name: "get_conversations_summary", description: "Retorna o resumo de conversas dos últimos 7 dias, incluindo abertas e fechadas.", parameters: { type: "OBJECT", properties: {}, required: [] } },
    validateArgs: noArguments,
  },
  {
    name: "get_erp_products",
    type: "READ",
    requiredPermissions: ["products", "erp"],
    declaration: { name: "get_erp_products", description: "Retorna a lista de produtos cadastrados no ERP do cliente com estoque.", parameters: { type: "OBJECT", properties: {}, required: [] } },
    validateArgs: noArguments,
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
  if (actionType === "CREATE_CLIENT") return `Cadastrar o cliente "${String(args.name ?? "")}"${args.phone ? ` (telefone ${String(args.phone)})` : ""}.`;
  if (actionType === "CREATE_PROPOSAL") {
    const items = Array.isArray(args.items) ? args.items as Array<{ quantity?: number; unitPrice?: number }> : [];
    const total = items.reduce((sum, item) => sum + Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0), 0);
    return `Criar proposta comercial para ${String(args.clientName ?? args.clientId ?? "o cliente")} com ${items.length} item(ns), total de R$ ${total.toFixed(2).replace(".", ",")}.`;
  }
  return `Executar a ação ${actionType} mediante sua aprovação.`;
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
  role: "user" | "model" | "function";
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Gemini API excedeu o tempo limite de ${GEMINI_REQUEST_TIMEOUT_MS / 1000}s.`);
    throw error;
  } finally {
    clearTimeout(timer);
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
  const response = await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalizedBody),
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
    "SELECT messages_json FROM megadesk_domain_ia_conversation_history WHERE client_id = ? AND user_id = ? LIMIT 1",
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
  const pool = getPool();

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
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as total, 
       SUM(CASE WHEN priority = 'alta' OR priority = 'critica' THEN 1 ELSE 0 END) as urgentes
       FROM megadesk_domain_chamados 
       WHERE clientId = ? AND status <> 'closed'`,
      [clientId]
    ) as any[];
    const data = rows[0] ?? { total: 0, urgentes: 0 };
    return JSON.stringify({ chamados_abertos: data.total, urgentes: data.urgentes });
  }

  if (functionName === "get_tickets_overview") {
    const filters = validatedArgs as { status?: string; search?: string; limit?: number };
    const where = ["clientId = ?"];
    const values: unknown[] = [clientId];
    if (filters.status) {
      where.push("status = ?");
      values.push(filters.status);
    }
    if (filters.search) {
      where.push("(title LIKE ? OR customerName LIKE ? OR company LIKE ? OR CAST(chamadoNumber AS CHAR) LIKE ?)");
      const query = `%${filters.search}%`;
      values.push(query, query, query, query);
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
      `SELECT chamadoId, chamadoNumber, title, customerName, company, status, priority, assignedTo, updatedAt
         FROM megadesk_domain_chamados WHERE ${where.join(" AND ")}
        ORDER BY updatedAt DESC, chamadoNumber DESC LIMIT ?`,
      [...values, filters.limit ?? 10],
    ) as any[];
    return JSON.stringify({ resumo: totalsRows[0] ?? { total: 0, open: 0, in_progress: 0, waiting: 0, closed: 0 }, chamados: recentRows });
  }

  if (functionName === "get_ticket_details") {
    const selector = validatedArgs as { ticketId?: string; ticketNumber?: number };
    const predicate = selector.ticketId ? "chamadoId = ?" : "chamadoNumber = ?";
    const value = selector.ticketId ?? selector.ticketNumber;
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
    return JSON.stringify({ chamado: ticket, atividades: activityRows });
  }

  if (functionName === "get_crm_summary") {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS total,
              SUM(lifecycle_state = 'active') AS active,
              SUM(lifecycle_state = 'inactive') AS inactive,
              SUM(status = 'lead') AS leads
         FROM megadesk_crm_clients
        WHERE client_id = ? AND lifecycle_state <> 'archived'`,
      [clientId],
    ) as any[];
    const [newRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM megadesk_crm_clients
        WHERE client_id = ? AND lifecycle_state <> 'archived' AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
      [clientId],
    ) as any[];
    const [latestRows] = await pool.execute(
      `SELECT crm_client_id AS crmClientId, company_name AS name, phone, email, created_at AS createdAt
         FROM megadesk_crm_clients WHERE client_id = ? AND lifecycle_state <> 'archived'
        ORDER BY created_at DESC LIMIT 5`,
      [clientId],
    ) as any[];
    return JSON.stringify({ resumo: { ...(rows[0] ?? { total: 0, active: 0, inactive: 0, leads: 0 }), newThisMonth: newRows[0]?.total ?? 0 }, ultimosClientes: latestRows });
  }

  if (functionName === "get_client_360") {
    const lookup = validatedArgs as { clientId?: string; search?: string };
    const predicate = lookup.clientId ? "crm_client_id = ?" : "(company_name LIKE ? OR phone LIKE ? OR email LIKE ?)";
    const lookupValue = lookup.clientId ?? `%${lookup.search}%`;
    const clientValues = lookup.clientId ? [clientId, lookupValue] : [clientId, lookupValue, lookupValue, lookupValue];
    const [clientRows] = await pool.execute(
      `SELECT crm_client_id AS crmClientId, company_name AS name, responsible_name AS responsibleName,
              phone, whatsapp, email, status, lifecycle_state AS lifecycleState, observations, created_at AS createdAt, updated_at AS updatedAt
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
        WHERE client_id = ? AND crm_client_id = ? ORDER BY updated_at DESC LIMIT 20`,
      [clientId, crmClient.crmClientId],
    ) as any[];
    return JSON.stringify({ cliente: crmClient, timeline: timelineRows, chamados: ticketRows, conversas: conversationRows });
  }

  if (functionName === "get_proposals_summary") {
    const filters = validatedArgs as { status?: string; sellerId?: string; period?: string };
    const where = ["client_id = ?", "document_type = 'quote'"];
    const values: unknown[] = [clientId];
    if (filters.status) { where.push("commercial_status = ?"); values.push(filters.status); }
    if (filters.sellerId) { where.push("seller_user_id = ?"); values.push(filters.sellerId); }
    if (filters.period) { where.push("created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"); values.push(Number(filters.period)); }
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS total, COALESCE(SUM(total_cents), 0) AS totalCents,
              SUM(commercial_status = 'draft') AS drafts, SUM(commercial_status = 'negotiation') AS negotiation,
              SUM(commercial_status = 'approved') AS approved, SUM(commercial_status = 'lost') AS lost
         FROM erp_sale_orders WHERE ${where.join(" AND ")}`,
      values,
    ) as any[];
    return JSON.stringify({ resumo: rows[0] ?? { total: 0, totalCents: 0, drafts: 0, negotiation: 0, approved: 0, lost: 0 } });
  }

  if (functionName === "get_proposal_details") {
    const lookup = validatedArgs as { proposalId?: string; proposalNumber?: string };
    const predicate = lookup.proposalId ? "o.public_id = ?" : "o.order_number = ?";
    const [orderRows] = await pool.execute(
      `SELECT o.id, o.public_id AS publicId, o.order_number AS orderNumber, o.commercial_status AS commercialStatus,
              o.total_cents AS totalCents, o.notes, o.payment_terms_snapshot AS paymentTerms, o.created_at AS createdAt,
              c.crm_client_id AS crmClientId, c.company_name AS clientName, c.phone AS clientPhone
         FROM erp_sale_orders o JOIN megadesk_crm_clients c ON c.crm_client_id = o.crm_client_id AND c.client_id = o.client_id
        WHERE o.client_id = ? AND o.document_type = 'quote' AND ${predicate} LIMIT 1`,
      [clientId, lookup.proposalId ?? lookup.proposalNumber],
    ) as any[];
    const proposal = orderRows[0];
    if (!proposal) {
      const target = lookup.proposalId ?? lookup.proposalNumber ?? "";
      return JSON.stringify({ found: false, message: target ? `Proposta ${target} não encontrada no sistema.` : "Proposta não encontrada no sistema." });
    }
    const [itemRows] = await pool.execute(
      `SELECT public_id AS publicId, product_name_snapshot AS productName, sku_snapshot AS sku, quantity,
              unit_price_cents AS unitPriceCents, discount_cents AS discountCents, line_total_cents AS lineTotalCents
         FROM erp_sale_order_items WHERE sale_order_id = ? ORDER BY id ASC`,
      [proposal.id],
    ) as any[];
    return JSON.stringify({ proposta: proposal, itens: itemRows });
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
    return JSON.stringify({ produto: rows[0], timeline: auditRows });
  }

  if (functionName === "get_inventory_status") {
    const filters = validatedArgs as { status?: string; search?: string };
    const where = ["client_id = ?", "active <> -1"]; const values: unknown[] = [clientId];
    if (filters.search) { where.push("(name LIKE ? OR sku LIKE ?)"); values.push(`%${filters.search}%`, `%${filters.search}%`); }
    if (filters.status === "empty") where.push("quantity <= 0");
    if (filters.status === "low") where.push("quantity > 0 AND quantity <= minimum_stock");
    if (filters.status === "regular") where.push("quantity > minimum_stock");
    const [rows] = await pool.execute(`SELECT public_id publicId,name,sku,quantity,minimum_stock minimumStock,unit FROM erp_products WHERE ${where.join(" AND ")} ORDER BY name LIMIT 100`, values) as any[];
    return JSON.stringify({ itens: rows });
  }

  if (functionName === "get_services_list") {
    const query = (validatedArgs as { search?: string }).search;
    const [rows] = await pool.execute(`SELECT id,name,code,category,price,estimated_cost estimatedCost,is_active isActive FROM megadesk_erp_services WHERE client_id=? ${query ? "AND (name LIKE ? OR code LIKE ? OR category LIKE ?)" : ""} ORDER BY name LIMIT 100`, query ? [clientId, `%${query}%`, `%${query}%`, `%${query}%`] : [clientId]) as any[];
    return JSON.stringify({ servicos: rows });
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
    return JSON.stringify({ fornecedores: rows });
  }

  if (functionName === "get_conversations_summary") {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as total,
       SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as abertas,
       SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as fechadas
       FROM megadesk_domain_conversations 
       WHERE client_id = ? AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`,
      [clientId]
    ) as any[];
    const data = rows[0] ?? { total: 0, abertas: 0, fechadas: 0 };
    return JSON.stringify({ conversas_7dias: data.total, abertas: data.abertas, fechadas: data.fechadas });
  }

  if (functionName === "get_erp_products") {
    const [rows] = await pool.execute(
      `SELECT JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.name')) as nome,
       JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.stock')) as estoque
       FROM megadesk_domain_operational_records 
       WHERE client_id = ? AND record_type = 'product' LIMIT 10`,
      [clientId]
    ) as any[];
    return JSON.stringify({ produtos: rows });
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

function buildSystemInstruction(allowedTools: readonly HermesToolDefinition[]): string {
  const names = allowedTools.map(tool => tool.name).join(", ") || "nenhuma";
  return `Você é o Assistente IA da plataforma MegaDesk, especializado em ajudar a equipe de atendimento.

Você só pode usar as ferramentas explicitamente disponibilizadas nesta conversa: ${names}. Nunca alegue consultar dados de uma ferramenta que não esteja disponível.
Para cadastrar cliente use create_client; para propostas comerciais use create_proposal (identifique o cliente com get_client_360 e os produtos com get_product_details antes). Ferramentas de escrita NÃO alteram dados: elas geram um card de aprovação humana. Nunca diga que algo foi criado antes da confirmação do usuário.
Se consultar um cliente ou produto com get_client_360 ou get_product_details e o retorno indicar found: false, você pode sugerir o cadastro antes de prosseguir OU gerar a proposta em rascunho com o nome e itens informados usando create_proposal.

REGRA CRÍTICA DE EXECUÇÃO DE FERRAMENTAS:
Quando você decidir invocar qualquer ferramenta (functionCall), NUNCA gere mensagens preliminares ou textos de espera como 'Estou consultando o sistema...', 'Um momento...', 'Verificando...'.
Emita EXCLUSIVAMENTE o bloco functionCall. O backend executará a ferramenta e devolverá o resultado na mesma sessão para que você formule a resposta final completa com os dados reais já consultados.

Sempre responda em português brasileiro de forma clara, objetiva e profissional.
Se não tiver dados suficientes, seja honesto e sugira como o usuário pode obter a informação.`;
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

  // 3. Primeira chamada ao Gemini
  const allowedTools = getAllowedHermesTools(userPermissions);
  const requestBody: GeminiRequest = {
    contents,
    ...(allowedTools.length > 0 ? { tools: [{ functionDeclarations: allowedTools.map(tool => tool.declaration) }] } : {}),
    systemInstruction: { parts: [{ text: buildSystemInstruction(allowedTools) }] },
    generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
  };

  let providerResponse = await callGeminiWithEnvironmentFallback(geminiKey, requestBody);
  let data = providerResponse.data;
  geminiKey = providerResponse.apiKey;
  const functionCallsMade: string[] = [];
  let promptTokens = tokenUsagePart(data, "promptTokenCount");
  let completionTokens = tokenUsagePart(data, "candidatesTokenCount");
  let tokensUsed = tokenUsageTotal(data, promptTokens, completionTokens);
  let pendingActionRequest: PendingActionRequest | undefined;

  // 4. Processa function calls em loop (até 4 iterações consecutivas)
  let iterations = 0;
  while (iterations < 4) {
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const functionCallPart = parts.find((p: any) => p.functionCall);
    if (!functionCallPart) break;

    iterations++;
    const fc = functionCallPart.functionCall;
    functionCallsMade.push(fc.name);

    const authorizedTool = getAuthorizedHermesTool(fc.name, userPermissions);
    if (authorizedTool?.type === "MUTATION") {
      // Ferramentas de mutação geram solicitação pendente para aprovação humana (HITL)
      pendingActionRequest = createPendingActionRequest(authorizedTool, fc.args ?? {}, { clientId, userId });
      break;
    }

    // Ferramenta READ: executa localmente no banco com tolerância estrita a erros
    let funcResult: string;
    try {
      funcResult = await executeClientFunction(fc.name, fc.args ?? {}, clientId, userPermissions, geminiKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao executar ferramenta local.";
      funcResult = JSON.stringify({ success: false, error: message });
    }

    // Turno 1: emite EXCLUSIVAMENTE o bloco functionCall (ignora qualquer texto preliminar como "Estou consultando...")
    const modelTurn: GeminiContent = {
      role: "model",
      parts: [{ functionCall: fc }],
    };
    let parsedOutput: unknown;
    try {
      parsedOutput = JSON.parse(funcResult);
    } catch {
      parsedOutput = funcResult;
    }

    // Turno 2: resposta da função
    const functionResponseTurn: GeminiContent = {
      role: "function",
      parts: [
        {
          functionResponse: {
            name: fc.name,
            response: {
              output: parsedOutput,
              ...(parsedOutput && typeof parsedOutput === "object" && !Array.isArray(parsedOutput) ? parsedOutput : {}),
            },
          },
        },
      ],
    };

    requestBody.contents = [...requestBody.contents, modelTurn, functionResponseTurn];
    providerResponse = await callGeminiWithEnvironmentFallback(geminiKey, requestBody);
    data = providerResponse.data;
    geminiKey = providerResponse.apiKey;
    const nextPromptTokens = tokenUsagePart(data, "promptTokenCount");
    const nextCompletionTokens = tokenUsagePart(data, "candidatesTokenCount");
    promptTokens += nextPromptTokens;
    completionTokens += nextCompletionTokens;
    tokensUsed += tokenUsageTotal(data, nextPromptTokens, nextCompletionTokens);
  }

  const candidateParts = data?.candidates?.[0]?.content?.parts ?? [];
  const modelText = candidateParts
    .map((p: any) => (typeof p.text === "string" ? p.text.trim() : ""))
    .filter(Boolean)
    .filter((text: string) => {
      const lower = text.toLowerCase();
      return (
        !lower.startsWith("estou consultando") &&
        !lower.startsWith("consultando o sistema") &&
        !lower.startsWith("verificando no sistema") &&
        !lower.startsWith("verificando os dados") &&
        !lower.startsWith("um momento")
      );
    })
    .join("\n")
    .trim();

  const finalResponse: string = pendingActionRequest
    ? (modelText || pendingActionRequest.summary || "Ação preparada e aguardando sua aprovação antes de qualquer alteração.")
    : (modelText || "Sem resposta do modelo.");

  // 5. Salva no histórico
  const updatedHistory: IAMessage[] = [
    ...existingHistory,
    { role: "user", content: userMessage, timestamp: Date.now() },
    { role: "assistant", content: finalResponse, timestamp: Date.now() },
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
  } catch (error) {
    const providerError = error as Error & { details?: unknown; cause?: unknown };
    console.error("[Assistant] Gemini chat failed:", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      details: providerError?.details ?? providerError?.cause,
    });
    throw error;
  }
}
