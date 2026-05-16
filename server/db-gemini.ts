import { getDb } from "./db";
const db = getDb();
import { megadeskDomainGeminiConfig, megadeskDomainIAConversations, megadeskDomainIAConversationHistory } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "default-key-change-in-production";
const ENCRYPTION_IV = process.env.ENCRYPTION_IV || "default-iv-16-chr";

/**
 * Encripta um token
 */
function encryptToken(token: string): string {
  try {
    const cipher = crypto.createCipheriv(
      "aes-256-cbc",
      Buffer.from(ENCRYPTION_KEY.padEnd(32, "0")).slice(0, 32),
      Buffer.from(ENCRYPTION_IV.padEnd(16, "0")).slice(0, 16)
    );
    let encrypted = cipher.update(token, "utf8", "hex");
    encrypted += cipher.final("hex");
    return encrypted;
  } catch (error) {
    console.error("[ERROR] Falha ao encriptar token:", error);
    throw new Error("Falha ao encriptar token");
  }
}

/**
 * Descriptografa um token
 */
function decryptToken(encryptedToken: string): string {
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(ENCRYPTION_KEY.padEnd(32, "0")).slice(0, 32),
      Buffer.from(ENCRYPTION_IV.padEnd(16, "0")).slice(0, 16)
    );
    let decrypted = decipher.update(encryptedToken, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("[ERROR] Falha ao descriptografar token:", error);
    throw new Error("Falha ao descriptografar token");
  }
}

/**
 * Obter configuração Gemini do cliente
 */
export async function getGeminiConfig(clientId: string) {
  try {
    const dbInstance = getDb();
    const config = await dbInstance
      .select()
      .from(megadeskDomainGeminiConfig)
      .where(eq(megadeskDomainGeminiConfig.clientId, clientId))
      .limit(1);
    return config[0] || null;
  } catch (error) {
    console.error("[ERROR] Falha ao obter config Gemini:", error);
    return null;
  }
}

/**
 * Obter token descriptografado
 */
export async function getGeminiToken(clientId: string): Promise<string | null> {
  try {
    const config = await getGeminiConfig(clientId);
    if (!config) return null;
    return decryptToken(config.geminiTokenEncrypted);
  } catch (error) {
    console.error("[ERROR] Falha ao obter token Gemini:", error);
    return null;
  }
}

/**
 * Salvar/atualizar configuração Gemini
 */
export async function saveGeminiConfig(
  clientId: string,
  token: string,
  quotaMode: "free" | "limited" | "hybrid" = "free",
  quotaMensal: number = 5000
) {
  try {
    const configId = uuidv4();
    const encryptedToken = encryptToken(token);
    const nextResetDate = new Date();
    nextResetDate.setMonth(nextResetDate.getMonth() + 1);
    nextResetDate.setDate(1);
    nextResetDate.setHours(0, 0, 0, 0);

    const existingConfig = await getGeminiConfig(clientId);

    const dbInstance = getDb();
    if (existingConfig) {
      // Atualizar
      await dbInstance
        .update(megadeskDomainGeminiConfig)
        .set({
          geminiTokenEncrypted: encryptedToken,
          quotaMode,
          quotaMensal,
          updatedAt: new Date(),
        })
        .where(eq(megadeskDomainGeminiConfig.clientId, clientId));

      console.log(`[LOG] Config Gemini atualizada para cliente ${clientId}`);
      return existingConfig.configId;
    } else {
      // Criar nova
      await dbInstance.insert(megadeskDomainGeminiConfig).values({
        configId,
        clientId,
        geminiTokenEncrypted: encryptedToken,
        quotaMode,
        quotaMensal,
        quotaUsadaMes: 0,
        dataResetQuota: nextResetDate,
        permissionsJson: JSON.stringify(["vendas", "atendimentos", "rastreio"]),
        ativo: false,
        testeConexao: false,
      });

      console.log(`[LOG] Config Gemini criada para cliente ${clientId}`);
      return configId;
    }
  } catch (error) {
    console.error("[ERROR] Falha ao salvar config Gemini:", error);
    throw error;
  }
}

/**
 * Testar conexão com Gemini
 */
export async function testGeminiConnection(clientId: string): Promise<boolean> {
  try {
    const token = await getGeminiToken(clientId);
    if (!token) {
      console.error("[ERROR] Token não encontrado para cliente:", clientId);
      return false;
    }

    // Fazer uma chamada simples ao Gemini para testar
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": token,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Teste de conexão. Responda apenas com 'OK'.",
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("[ERROR] Falha ao testar Gemini:", response.statusText);
      return false;
    }

    // Atualizar status de teste
    const dbInstance = getDb();
    await dbInstance
      .update(megadeskDomainGeminiConfig)
      .set({
        testeConexao: true,
        ultimoTesteEm: new Date(),
      })
      .where(eq(megadeskDomainGeminiConfig.clientId, clientId));

    console.log(`[SUCCESS] Conexão Gemini testada com sucesso para ${clientId}`);
    return true;
  } catch (error) {
    console.error("[ERROR] Erro ao testar conexão Gemini:", error);
    return false;
  }
}

/**
 * Ativar/desativar Gemini para cliente
 */
export async function toggleGeminiStatus(clientId: string, ativo: boolean) {
  try {
    const dbInstance = getDb();
    await dbInstance
      .update(megadeskDomainGeminiConfig)
      .set({
        ativo,
        updatedAt: new Date(),
      })
      .where(eq(megadeskDomainGeminiConfig.clientId, clientId));

    console.log(`[LOG] Gemini ${ativo ? "ativado" : "desativado"} para cliente ${clientId}`);
  } catch (error) {
    console.error("[ERROR] Falha ao alternar status Gemini:", error);
    throw error;
  }
}

/**
 * Salvar conversa com IA
 */
export async function saveIAConversation(
  clientId: string,
  userId: string,
  userMessage: string,
  iaResponse: string,
  tokensUsed: number = 0,
  tipo: "consulta" | "relatorio" | "acao" | "analise" = "consulta"
) {
  try {
    const conversationId = uuidv4();
    const dbInstance = getDb();

    await dbInstance.insert(megadeskDomainIAConversations).values({
      conversationId,
      clientId,
      userId,
      userMessage,
      iaResponse,
      tokensUsed,
      tipo,
      status: "sucesso",
    });

    // Atualizar quota usada
    const config = await getGeminiConfig(clientId);
    if (config) {
      const dbInstance = getDb();
      await dbInstance
        .update(megadeskDomainGeminiConfig)
        .set({
          quotaUsadaMes: config.quotaUsadaMes + 1,
        })
        .where(eq(megadeskDomainGeminiConfig.clientId, clientId));
    }

    console.log(`[LOG] Conversa IA salva: ${conversationId}`);
    return conversationId;
  } catch (error) {
    console.error("[ERROR] Falha ao salvar conversa IA:", error);
    throw error;
  }
}

/**
 * Obter histórico de conversa
 */
export async function getConversationHistory(clientId: string, userId: string) {
  try {
    const dbInstance = getDb();
    const history = await dbInstance
      .select()
      .from(megadeskDomainIAConversationHistory)
      .where(
        and(
          eq(megadeskDomainIAConversationHistory.clientId, clientId),
          eq(megadeskDomainIAConversationHistory.userId, userId)
        )
      )
      .limit(1);

    if (!history || history.length === 0) return null;

    const h = history[0];
    return {
      ...h,
      messages: JSON.parse(h.messagesJson),
      context: JSON.parse(h.contextJson),
    };
  } catch (error) {
    console.error("[ERROR] Falha ao obter histórico:", error);
    return null;
  }
}

/**
 * Atualizar histórico de conversa
 */
export async function updateConversationHistory(
  clientId: string,
  userId: string,
  messages: any[],
  context: any = {}
) {
  try {
    const dbInstance = getDb();
    const existingHistory = await getConversationHistory(clientId, userId);

    if (existingHistory) {
      await dbInstance
        .update(megadeskDomainIAConversationHistory)
        .set({
          messagesJson: JSON.stringify(messages),
          contextJson: JSON.stringify(context),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(megadeskDomainIAConversationHistory.clientId, clientId),
            eq(megadeskDomainIAConversationHistory.userId, userId)
          )
        );
    } else {
      const historyId = uuidv4();
      await dbInstance.insert(megadeskDomainIAConversationHistory).values({
        historyId,
        clientId,
        userId,
        messagesJson: JSON.stringify(messages),
        contextJson: JSON.stringify(context),
      });
    }

    console.log(`[LOG] Histórico atualizado para ${userId}`);
  } catch (error) {
    console.error("[ERROR] Falha ao atualizar histórico:", error);
    throw error;
  }
}

/**
 * Validar quota disponível
 */
export async function validateQuota(clientId: string): Promise<boolean> {
  try {
    const config = await getGeminiConfig(clientId);
    if (!config) return false;

    if (config.quotaMode === "free") {
      return true; // Modo livre, sem limite
    }

    return config.quotaUsadaMes < config.quotaMensal;
  } catch (error) {
    console.error("[ERROR] Falha ao validar quota:", error);
    return false;
  }
}

/**
 * Obter informações de quota
 */
export async function getQuotaInfo(clientId: string) {
  try {
    const config = await getGeminiConfig(clientId);
    if (!config) return null;

    return {
      quotaMode: config.quotaMode,
      quotaMensal: config.quotaMensal,
      quotaUsadaMes: config.quotaUsadaMes,
      percentualUsado: Math.round((config.quotaUsadaMes / config.quotaMensal) * 100),
      disponivel: config.quotaMensal - config.quotaUsadaMes,
    };
  } catch (error) {
    console.error("[ERROR] Falha ao obter info quota:", error);
    return null;
  }
}
