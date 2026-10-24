/**
 * Gemini IA Client — por cliente
 * Usa fetch HTTP direto para a API Gemini (mais compatível com ambientes de deploy).
 * Mantém histórico de conversa no banco de dados.
 * Suporta function calling para consultar dados do ERP/conversas/chamados.
 */
import { getPool } from "./db";
import { nanoid } from "nanoid";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface IAMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
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
}

export interface PendingActionRequest {
  id: string;
  toolName: string;
  type: "MUTATION";
  args: Record<string, unknown>;
  status: "PENDING_APPROVAL";
}

type SqlExecutor = (sql: string, values: unknown[]) => Promise<unknown>;

const noArguments = (args: Record<string, unknown>): Record<string, unknown> => {
  if (Object.keys(args).length > 0) {
    throw new Error("A ferramenta não aceita parâmetros.");
  }
  return {};
};

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
];

export function getAllowedHermesTools(permissions: readonly string[]): HermesToolDefinition[] {
  const granted = new Set(permissions);
  return HERMES_TOOL_REGISTRY.filter(tool => tool.requiredPermissions.some(permission => granted.has(permission)));
}

/** Defesa em profundidade: a ferramenta precisa ser autorizada na execução, não só na declaração enviada ao modelo. */
export function getAuthorizedHermesTool(name: string, permissions: readonly string[]): HermesToolDefinition | null {
  return getAllowedHermesTools(permissions).find(tool => tool.name === name) ?? null;
}

export function createPendingActionRequest(tool: HermesToolDefinition, args: Record<string, unknown>): PendingActionRequest {
  if (tool.type !== "MUTATION") throw new Error("Somente ferramentas de mutação exigem aprovação humana.");
  return {
    id: `action-${nanoid()}`,
    toolName: tool.name,
    type: "MUTATION",
    args: tool.validateArgs(args),
    status: "PENDING_APPROVAL",
  };
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

async function callGeminiAPI(apiKey: string, body: GeminiRequest): Promise<any> {
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
  const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalizedBody),
  });
  const data = await response.json() as any;
  if (!response.ok) {
    const errMsg = data?.error?.message ?? `HTTP ${response.status}`;
    const errStatus = data?.error?.status ?? "";
    throw new Error(`${errStatus}: ${errMsg}`);
  }
  return data;
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
  if (!rows || rows.length === 0) return { geminiKey: null, geminiQuotaMensal: 0 };
  try {
    const integrations = JSON.parse(rows[0].integrations_json ?? "{}");
    return {
      geminiKey: integrations.geminiKey ?? null,
      geminiQuotaMensal: Number(integrations.geminiQuotaMensal ?? 0),
    };
  } catch {
    return { geminiKey: null, geminiQuotaMensal: 0 };
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
  const pool = getPool();
  const [rows] = await pool.execute(
    "SELECT integrations_json FROM megadesk_domain_clients WHERE client_id = ? LIMIT 1",
    [clientId]
  ) as any[];
  if (!rows || rows.length === 0) return null;
  try {
    const integrations = JSON.parse(rows[0].integrations_json ?? "{}");
    return integrations.geminiKey ?? null;
  } catch {
    return null;
  }
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
async function executeClientFunction(
  functionName: string,
  args: Record<string, unknown>,
  clientId: string,
  permissions: readonly string[]
): Promise<string> {
  const tool = getAuthorizedHermesTool(functionName, permissions);
  if (!tool) {
    return JSON.stringify({ erro: "Você não possui permissão para consultar dados deste módulo." });
  }
  // Validação ocorre novamente no executor, mesmo se o modelo recebeu a tool.
  tool.validateArgs(args);
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
       SUM(CASE WHEN priority = 'high' OR priority = 'urgent' THEN 1 ELSE 0 END) as urgentes
       FROM megadesk_domain_chamados 
       WHERE client_id = ? AND status NOT IN ('closed', 'resolved')`,
      [clientId]
    ) as any[];
    const data = rows[0] ?? { total: 0, urgentes: 0 };
    return JSON.stringify({ chamados_abertos: data.total, urgentes: data.urgentes });
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

  return JSON.stringify({ erro: "Função não reconhecida" });
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
Sempre responda em português brasileiro de forma clara, objetiva e profissional.
Quando buscar dados, informe ao usuário que está consultando o sistema antes de responder.
Se não tiver dados suficientes, seja honesto e sugira como o usuário pode obter a informação.`;
}

export async function chatWithClientGemini(
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
  const geminiKey = iaStatus.geminiKey!;

  // 2. Monta o histórico no formato REST do Gemini
  const contents: GeminiContent[] = existingHistory.map((msg) => ({
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
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
  };

  let data = await callGeminiAPI(geminiKey, requestBody);
  const functionCallsMade: string[] = [];
  let promptTokens = tokenUsagePart(data, "promptTokenCount");
  let completionTokens = tokenUsagePart(data, "candidatesTokenCount");
  let tokensUsed = tokenUsageTotal(data, promptTokens, completionTokens);
  let pendingActionRequest: PendingActionRequest | undefined;

  // 4. Processa function calls em loop
  let iterations = 0;
  while (iterations < 5) {
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const functionCallPart = parts.find((p: any) => p.functionCall);
    if (!functionCallPart) break;

    iterations++;
    const fc = functionCallPart.functionCall;
    functionCallsMade.push(fc.name);

    const authorizedTool = getAuthorizedHermesTool(fc.name, userPermissions);
    if (authorizedTool?.type === "MUTATION") {
      // Nunca executa mutações no loop do modelo. A interface recebe apenas a solicitação pendente.
      pendingActionRequest = createPendingActionRequest(authorizedTool, fc.args ?? {});
      break;
    }

    // Executa a função localmente
    const funcResult = await executeClientFunction(fc.name, fc.args ?? {}, clientId, userPermissions);

    // Adiciona o resultado da função ao contexto e chama novamente
    const modelTurn: GeminiContent = {
      role: "model",
      parts: [{ functionCall: fc }],
    };
    const functionResponseTurn: GeminiContent = {
      role: "user",
      parts: [{ functionResponse: { name: fc.name, response: JSON.parse(funcResult) } }],
    };

    requestBody.contents = [...requestBody.contents, modelTurn, functionResponseTurn];
    data = await callGeminiAPI(geminiKey, requestBody);
    const nextPromptTokens = tokenUsagePart(data, "promptTokenCount");
    const nextCompletionTokens = tokenUsagePart(data, "candidatesTokenCount");
    promptTokens += nextPromptTokens;
    completionTokens += nextCompletionTokens;
    tokensUsed += tokenUsageTotal(data, nextPromptTokens, nextCompletionTokens);
  }

  const finalResponse: string = pendingActionRequest
    ? "Ação preparada e aguardando sua aprovação antes de qualquer alteração."
    : data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "Sem resposta do modelo.";

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
