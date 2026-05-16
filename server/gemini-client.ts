/**
 * Gemini IA Client — por cliente
 * Usa o token Gemini configurado no MegaAdmin para cada cliente.
 * Mantém histórico de conversa no banco de dados.
 * Suporta function calling para consultar dados do ERP/conversas/chamados.
 */
import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { getPool } from "./db";
import { nanoid } from "nanoid";

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

// ─── Helpers de banco ─────────────────────────────────────────────────────────

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
    // Resumo de vendas do ERP
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
    // Chamados abertos
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
    // Resumo de conversas
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
    // Produtos do ERP
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

// ─── Declarações de funções para o Gemini ─────────────────────────────────────

const CLIENT_FUNCTIONS: FunctionDeclaration[] = [
  {
    name: "get_sales_summary",
    description: "Retorna o resumo de vendas do cliente para hoje, incluindo total de vendas e valor total.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_open_tickets",
    description: "Retorna o número de chamados/tickets abertos e quantos são urgentes.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_conversations_summary",
    description: "Retorna o resumo de conversas dos últimos 7 dias, incluindo abertas e fechadas.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_erp_products",
    description: "Retorna a lista de produtos cadastrados no ERP do cliente com estoque.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
      required: [],
    },
  },
];

// ─── Chat principal ────────────────────────────────────────────────────────────

export async function chatWithClientGemini(
  clientId: string,
  userId: string,
  userMessage: string,
  existingHistory: IAMessage[]
): Promise<ChatResult> {
  // 1. Busca o token do cliente
  const geminiKey = await getClientGeminiToken(clientId);
  if (!geminiKey) {
    throw new Error("Token Gemini não configurado para este cliente. Solicite ao administrador que configure a API do Gemini.");
  }

  // 2. Inicializa o cliente Gemini com o token do cliente
  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    tools: [{ functionDeclarations: CLIENT_FUNCTIONS }],
    systemInstruction: `Você é o Assistente IA da plataforma MegaDesk, especializado em ajudar a equipe de atendimento.

Você tem acesso a dados em tempo real do sistema através de funções especiais. Quando o usuário perguntar sobre:
- Vendas, faturamento, produtos → use get_sales_summary ou get_erp_products
- Chamados, tickets, suporte → use get_open_tickets
- Conversas, atendimentos, WhatsApp → use get_conversations_summary

Sempre responda em português brasileiro de forma clara, objetiva e profissional.
Quando buscar dados, informe ao usuário que está consultando o sistema antes de responder.
Se não tiver dados suficientes, seja honesto e sugira como o usuário pode obter a informação.`,
  });

  // 3. Monta o histórico para o Gemini (sem a mensagem atual)
  const geminiHistory = existingHistory.map((msg) => ({
    role: msg.role === "user" ? "user" as const : "model" as const,
    parts: [{ text: msg.content }],
  }));

  // 4. Inicia o chat com histórico
  const chat = model.startChat({ history: geminiHistory });

  // 5. Envia a mensagem e processa function calls
  let result = await chat.sendMessage(userMessage);
  let response = result.response;
  const functionCallsMade: string[] = [];
  let tokensUsed = response.usageMetadata?.totalTokenCount ?? 0;

  // 6. Processa function calls em loop (o Gemini pode chamar múltiplas funções)
  let iterations = 0;
  while (response.functionCalls()?.length && iterations < 5) {
    iterations++;
    const functionCalls = response.functionCalls()!;
    const functionResults = [];

    for (const fc of functionCalls) {
      functionCallsMade.push(fc.name);
      const funcResult = await executeClientFunction(fc.name, fc.args as Record<string, any>, clientId);
      functionResults.push({
        functionResponse: {
          name: fc.name,
          response: JSON.parse(funcResult),
        },
      });
    }

    // Envia os resultados das funções de volta ao Gemini
    result = await chat.sendMessage(functionResults);
    response = result.response;
    tokensUsed += response.usageMetadata?.totalTokenCount ?? 0;
  }

  const finalResponse = response.text();

  // 7. Salva no histórico
  const updatedHistory: IAMessage[] = [
    ...existingHistory,
    { role: "user", content: userMessage, timestamp: Date.now() },
    { role: "assistant", content: finalResponse, timestamp: Date.now() },
  ];

  // Mantém apenas as últimas 50 mensagens para não sobrecarregar
  const trimmedHistory = updatedHistory.slice(-50);
  await saveConversationHistory(clientId, userId, trimmedHistory);

  // 8. Loga a conversa
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
