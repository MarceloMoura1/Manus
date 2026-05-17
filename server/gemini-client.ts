/**
 * Gemini IA Client — por cliente
 * Usa fetch HTTP direto para a API Gemini (mais compatível com ambientes de deploy).
 * Mantém histórico de conversa no banco de dados.
 * Suporta function calling para consultar dados do ERP/conversas/chamados.
 */
import { getPool } from "./db";
import { nanoid } from "nanoid";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = "gemini-2.5-flash";

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
}

// ─── Helpers de chamada HTTP Gemini ──────────────────────────────────────────

interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text?: string; functionCall?: any; functionResponse?: any }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  tools?: any[];
  systemInstruction?: { parts: [{ text: string }] };
  generationConfig?: { temperature?: number; maxOutputTokens?: number };
}

async function callGeminiAPI(apiKey: string, body: GeminiRequest): Promise<any> {
  const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
export async function getClientTokensUsedThisMonth(clientId: string): Promise<number> {
  const pool = getPool();
  try {
    const [rows] = await pool.execute(
      `SELECT COALESCE(SUM(tokens_used), 0) as total
       FROM megadesk_domain_ia_conversations
       WHERE client_id = ? AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())`,
      [clientId]
    ) as any[];
    return Number((rows as any[])[0]?.total ?? 0);
  } catch {
    return 0;
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

// ─── Function Calling — consultas ao banco do cliente ─────────────────────────

/** Busca dados do ERP/conversas/chamados do cliente para o Gemini */
async function executeClientFunction(
  functionName: string,
  args: Record<string, any>,
  clientId: string
): Promise<string> {
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

const CLIENT_FUNCTIONS_TOOL = {
  functionDeclarations: [
    {
      name: "get_sales_summary",
      description: "Retorna o resumo de vendas do cliente para hoje, incluindo total de vendas e valor total.",
      parameters: { type: "OBJECT", properties: {}, required: [] },
    },
    {
      name: "get_open_tickets",
      description: "Retorna o número de chamados/tickets abertos e quantos são urgentes.",
      parameters: { type: "OBJECT", properties: {}, required: [] },
    },
    {
      name: "get_conversations_summary",
      description: "Retorna o resumo de conversas dos últimos 7 dias, incluindo abertas e fechadas.",
      parameters: { type: "OBJECT", properties: {}, required: [] },
    },
    {
      name: "get_erp_products",
      description: "Retorna a lista de produtos cadastrados no ERP do cliente com estoque.",
      parameters: { type: "OBJECT", properties: {}, required: [] },
    },
  ],
};

const SYSTEM_INSTRUCTION = `Você é o Assistente IA da plataforma MegaDesk, especializado em ajudar a equipe de atendimento.

Você tem acesso a dados em tempo real do sistema através de funções especiais. Quando o usuário perguntar sobre:
- Vendas, faturamento, produtos → use get_sales_summary ou get_erp_products
- Chamados, tickets, suporte → use get_open_tickets
- Conversas, atendimentos, WhatsApp → use get_conversations_summary

Sempre responda em português brasileiro de forma clara, objetiva e profissional.
Quando buscar dados, informe ao usuário que está consultando o sistema antes de responder.
Se não tiver dados suficientes, seja honesto e sugira como o usuário pode obter a informação.`;

// ─── Chat principal ────────────────────────────────────────────────────────────

export async function chatWithClientGemini(
  clientId: string,
  userId: string,
  userMessage: string,
  existingHistory: IAMessage[]
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
  const requestBody: GeminiRequest = {
    contents,
    tools: [CLIENT_FUNCTIONS_TOOL],
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
  };

  let data = await callGeminiAPI(geminiKey, requestBody);
  const functionCallsMade: string[] = [];
  let tokensUsed = data?.usageMetadata?.totalTokenCount ?? 0;

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

    // Executa a função localmente
    const funcResult = await executeClientFunction(fc.name, fc.args ?? {}, clientId);

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
    tokensUsed += data?.usageMetadata?.totalTokenCount ?? 0;
  }

  const finalResponse: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "Sem resposta do modelo.";

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

  return {
    ok: true,
    response: finalResponse,
    tokensUsed,
    conversationId,
    functionCallsMade,
  };
}
