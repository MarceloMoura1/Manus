/**
 * Evolution Manager
 * Gerencia instâncias de Evolution API e sincroniza com banco de dados
 */

import { EvolutionAPIClient, initEvolutionAPI } from "./evolution-api-client";
import { EvolutionWhatsAppAdapter } from "./evolution-whatsapp-adapter";
import { getPool } from "./db";

let evolutionClient: EvolutionAPIClient | null = null;
let evolutionAdapter: EvolutionWhatsAppAdapter | null = null;

/**
 * Inicializar Evolution API
 */
export async function initEvolutionManager(): Promise<void> {
  try {
    const baseUrl = process.env.EVOLUTION_API_URL || "http://localhost:8081";
    const apiKey = process.env.EVOLUTION_API_KEY || "evolution-api-key";

    console.log(`[Evolution Manager] Inicializando com URL: ${baseUrl}`);

    evolutionClient = initEvolutionAPI({
      baseUrl,
      apiKey,
    });

    evolutionAdapter = new EvolutionWhatsAppAdapter(evolutionClient);

    console.log(`[Evolution Manager] Inicializado com sucesso`);

    // Restaurar sessões existentes
    await restoreExistingSessions();
  } catch (err: any) {
    console.error(`[Evolution Manager] Erro ao inicializar:`, err);
    throw err;
  }
}

/**
 * Obter cliente Evolution
 */
export function getEvolutionClient(): EvolutionAPIClient {
  if (!evolutionClient) {
    throw new Error("Evolution API não foi inicializado");
  }
  return evolutionClient;
}

/**
 * Obter adapter Evolution
 */
export function getEvolutionAdapter(): EvolutionWhatsAppAdapter {
  if (!evolutionAdapter) {
    throw new Error("Evolution Adapter não foi inicializado");
  }
  return evolutionAdapter;
}

/**
 * Restaurar sessões existentes do banco de dados
 */
export async function restoreExistingSessions(): Promise<void> {
  try {
    console.log(`[Evolution Manager] Restaurando sessões existentes...`);

    if (!evolutionAdapter) {
      throw new Error("Evolution Adapter não inicializado");
    }

    // Buscar configurações de WhatsApp do banco
    const pool = getPool();
    const connection = await pool.getConnection();
    let whatsappConfigs: any[] = [];
    try {
      const [rows] = await connection.execute(
        `SELECT * FROM megadesk_whatsapp_config WHERE status = 'active'`
      );
      whatsappConfigs = rows as any[];
    } finally {
      connection.release();
    }

    for (const config of whatsappConfigs) {
      try {
        const { client_id, instance_id, token, phone_number } = config;

        console.log(`[Evolution Manager] Restaurando sessão: ${instance_id}`);

        await evolutionAdapter.restoreSession(client_id, instance_id, token);

        if (phone_number) {
          evolutionAdapter.updateSessionPhoneNumber(client_id, phone_number);
        }

        console.log(`[Evolution Manager] Sessão restaurada: ${instance_id}`);
      } catch (err: any) {
        console.error(
          `[Evolution Manager] Erro ao restaurar sessão ${config.instance_id}:`,
          err
        );
      }
    }

    console.log(`[Evolution Manager] Restauração completa`);
  } catch (err: any) {
    console.error(`[Evolution Manager] Erro ao restaurar sessões:`, err);
  }
}

/**
 * Criar nova sessão WhatsApp
 */
export async function createWhatsAppSession(clientId: string): Promise<{
  ok: boolean;
  instanceId?: string;
  token?: string;
  error?: string;
}> {
  try {
    if (!evolutionAdapter) {
      throw new Error("Evolution Adapter não inicializado");
    }

    console.log(`[Evolution Manager] Criando sessão para cliente: ${clientId}`);

    const instanceName = `megadesk-${clientId}-${Date.now()}`;
    const session = await evolutionAdapter.createSession(clientId, instanceName);

    // Salvar configuração no banco
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.execute(
        `INSERT INTO megadesk_whatsapp_config (client_id, instance_id, token, status, created_at)
         VALUES (?, ?, ?, 'active', NOW())
         ON DUPLICATE KEY UPDATE token = VALUES(token), status = 'active'`,
        [clientId, session.instanceId, session.token]
      );
    } finally {
      connection.release();
    }

    console.log(`[Evolution Manager] Sessão criada: ${session.instanceId}`);

    return {
      ok: true,
      instanceId: session.instanceId,
      token: session.token,
    };
  } catch (err: any) {
    console.error(`[Evolution Manager] Erro ao criar sessão:`, err);
    return {
      ok: false,
      error: err?.message || "Erro ao criar sessão",
    };
  }
}

/**
 * Obter QR Code para conectar WhatsApp
 */
export async function getWhatsAppQRCode(clientId: string): Promise<{
  ok: boolean;
  qrCode?: string;
  error?: string;
}> {
  try {
    if (!evolutionAdapter) {
      throw new Error("Evolution Adapter não inicializado");
    }

    const qrCode = await evolutionAdapter.getQRCode(clientId);

    return {
      ok: true,
      qrCode,
    };
  } catch (err: any) {
    console.error(`[Evolution Manager] Erro ao obter QR Code:`, err);
    return {
      ok: false,
      error: err?.message || "Erro ao obter QR Code",
    };
  }
}

/**
 * Obter imagem do QR Code
 */
export async function getWhatsAppQRCodeImage(clientId: string): Promise<{
  ok: boolean;
  image?: string;
  error?: string;
}> {
  try {
    if (!evolutionAdapter) {
      throw new Error("Evolution Adapter não inicializado");
    }

    const image = await evolutionAdapter.getQRCodeImage(clientId);

    return {
      ok: true,
      image,
    };
  } catch (err: any) {
    console.error(`[Evolution Manager] Erro ao obter imagem QR:`, err);
    return {
      ok: false,
      error: err?.message || "Erro ao obter imagem QR",
    };
  }
}

/**
 * Enviar mensagem WhatsApp
 */
export async function sendWhatsAppMessage(
  clientId: string,
  conversationId: string,
  phoneNumber: string,
  text: string,
  agentName: string = "Atendente"
): Promise<{
  ok: boolean;
  messageId?: string;
  error?: string;
}> {
  try {
    if (!evolutionAdapter) {
      throw new Error("Evolution Adapter não inicializado");
    }

    console.log(
      `[Evolution Manager] Enviando mensagem para ${phoneNumber}: "${text.substring(0, 50)}..."`
    );

    const result = await evolutionAdapter.sendMessage(clientId, phoneNumber, text);

    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
      };
    }

    // Salvar mensagem no banco
    try {
      await db.query(
        `INSERT INTO megadesk_domain_conversations_messages 
         (conversation_id, sender, message, timestamp, status)
         VALUES (?, ?, ?, NOW(), ?)`,
        [conversationId, agentName, text, "sent"]
      );
    } catch (dbErr: any) {
      console.warn(`[Evolution Manager] Erro ao salvar mensagem no banco:`, dbErr);
    }

    return {
      ok: true,
      messageId: result.messageId,
    };
  } catch (err: any) {
    console.error(`[Evolution Manager] Erro ao enviar mensagem:`, err);
    return {
      ok: false,
      error: err?.message || "Erro ao enviar mensagem",
    };
  }
}

/**
 * Obter status da sessão
 */
export function getWhatsAppStatus(clientId: string): {
  status: string;
  phoneNumber?: string;
  instanceId?: string;
  connected: boolean;
} {
  try {
    if (!evolutionAdapter) {
      throw new Error("Evolution Adapter não inicializado");
    }

    return evolutionAdapter.getStatus(clientId);
  } catch (err: any) {
    console.error(`[Evolution Manager] Erro ao obter status:`, err);
    return {
      status: "error",
      connected: false,
    };
  }
}

/**
 * Desconectar WhatsApp
 */
export async function disconnectWhatsApp(clientId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    if (!evolutionAdapter) {
      throw new Error("Evolution Adapter não inicializado");
    }

    await evolutionAdapter.disconnect(clientId);

    // Atualizar status no banco
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.execute(
        `UPDATE megadesk_whatsapp_config SET status = 'disconnected' WHERE client_id = ?`,
        [clientId]
      );
    } finally {
      connection.release();
    }

    return { ok: true };
  } catch (err: any) {
    console.error(`[Evolution Manager] Erro ao desconectar:`, err);
    return {
      ok: false,
      error: err?.message || "Erro ao desconectar",
    };
  }
}

/**
 * Configurar webhook para receber mensagens
 */
export async function configureWebhook(clientId: string, webhookUrl: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    if (!evolutionAdapter || !evolutionClient) {
      throw new Error("Evolution não inicializado");
    }

    const session = evolutionAdapter.getSession(clientId);
    if (!session) {
      throw new Error("Sessão não encontrada");
    }

    await evolutionClient.setWebhook(
      session.instanceId,
      session.token,
      webhookUrl,
      ["messages", "connection", "status"]
    );

    return { ok: true };
  } catch (err: any) {
    console.error(`[Evolution Manager] Erro ao configurar webhook:`, err);
    return {
      ok: false,
      error: err?.message || "Erro ao configurar webhook",
    };
  }
}
