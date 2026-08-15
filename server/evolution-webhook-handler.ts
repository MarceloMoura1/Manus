/**
 * Evolution Webhook Handler
 * Processa eventos recebidos da Evolution API (mensagens, status, etc.)
 */

import { getPool } from "./db";
import { loadMegaDeskStructuredState, saveMegaDeskStructuredState } from "./db";

export interface EvolutionWebhookPayload {
  event: string;
  instance: string;
  data: {
    key?: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
    };
    message?: {
      conversation?: string;
      extendedTextMessage?: {
        text: string;
      };
      imageMessage?: {
        caption?: string;
      };
    };
    status?: string;
    phoneNumber?: string;
    connectionStatus?: string;
  };
}

/**
 * Processar webhook de mensagem recebida
 */
export async function handleIncomingMessage(payload: EvolutionWebhookPayload): Promise<void> {
  try {
    console.log(`[Evolution Webhook] Mensagem recebida:`, {
      event: payload.event,
      instance: payload.instance,
      remoteJid: payload.data.key?.remoteJid,
    });

    // Extrair informações da mensagem
    const remoteJid = payload.data.key?.remoteJid;
    if (!remoteJid) {
      console.warn(`[Evolution Webhook] remoteJid não encontrado`);
      return;
    }

    // Extrair número de telefone do JID
    const phoneNumber = remoteJid.split("@")[0];
    if (!phoneNumber) {
      console.warn(`[Evolution Webhook] Não foi possível extrair número do JID: ${remoteJid}`);
      return;
    }

    // Extrair texto da mensagem
    let messageText = "";
    if (payload.data.message?.conversation) {
      messageText = payload.data.message.conversation;
    } else if (payload.data.message?.extendedTextMessage?.text) {
      messageText = payload.data.message.extendedTextMessage.text;
    } else if (payload.data.message?.imageMessage?.caption) {
      messageText = `[Imagem] ${payload.data.message.imageMessage.caption}`;
    } else {
      messageText = "[Mensagem sem texto]";
    }

    console.log(`[Evolution Webhook] Processando mensagem de ${phoneNumber}: "${messageText.substring(0, 50)}..."`);

    // Buscar ou criar conversa
    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      // TODO: Buscar clientId da instância (Evolution API)
      // Por enquanto, usar um clientId padrão para teste
      const clientId = "cliente-001"; // FIXME: Obter do mapeamento de instância

      // Buscar conversa existente
      const [conversations] = await connection.execute(
        `SELECT conversation_id, client_id FROM megadesk_domain_conversations 
         WHERE phone = ? AND client_id = ? AND status != 'closed'
         LIMIT 1`,
        [phoneNumber, clientId]
      );

      let conversationId: string;

      if (Array.isArray(conversations) && conversations.length > 0) {
        // Conversa existente
        conversationId = (conversations[0] as any).conversation_id;
        console.log(`[Evolution Webhook] Conversa existente: ${conversationId}`);
      } else {
        // Criar nova conversa
        conversationId = `conv-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        await connection.execute(
          `INSERT INTO megadesk_domain_conversations 
           (conversation_id, client_id, customer_name, phone, company, status, assigned_user_id, assigned_user_name, last_message, last_message_from, time_label, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            conversationId,
            clientId,
            `Contato ${phoneNumber}`,
            phoneNumber,
            "N/A",
            "open",
            null,
            "Bot",
            messageText.substring(0, 100),
            "customer",
            new Date().toLocaleTimeString("pt-BR"),
          ]
        );

        console.log(`[Evolution Webhook] Nova conversa criada: ${conversationId}`);
      }

      // Salvar mensagem
      const messageId = `msg-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      await connection.execute(
        `INSERT INTO megadesk_domain_conversations_messages 
         (message_id, conversation_id, sender, message, timestamp, status)
         VALUES (?, ?, ?, ?, NOW(), ?)`,
        [messageId, conversationId, "customer", messageText, "received"]
      );

      console.log(`[Evolution Webhook] Mensagem salva: ${messageId}`);

      // Atualizar última mensagem da conversa
      await connection.execute(
        `UPDATE megadesk_domain_conversations 
         SET last_message = ?, last_message_from = ?, time_label = ?, updated_at = NOW()
         WHERE conversation_id = ?`,
        [
          messageText.substring(0, 100),
          "customer",
          new Date().toLocaleTimeString("pt-BR"),
          conversationId,
        ]
      );

      console.log(`[Evolution Webhook] Conversa atualizada: ${conversationId}`);
    } finally {
      connection.release();
    }
  } catch (err: any) {
    console.error(`[Evolution Webhook] Erro ao processar mensagem:`, err);
  }
}

/**
 * Processar webhook de status de conexão
 */
export async function handleConnectionStatus(payload: EvolutionWebhookPayload): Promise<void> {
  try {
    console.log(`[Evolution Webhook] Status de conexão:`, {
      instance: payload.instance,
      status: payload.data.connectionStatus,
      phoneNumber: payload.data.phoneNumber,
    });

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      // Atualizar status da instância no banco
      // TODO: Mapear instance para clientId
      const clientId = "cliente-001"; // FIXME: Obter do mapeamento

      if (payload.data.connectionStatus === "open" && payload.data.phoneNumber) {
        // Conexão estabelecida
        await connection.execute(
          `UPDATE megadesk_whatsapp_config 
           SET connectionStatus = 1, phoneNumber = ?, updatedAt = NOW()
           WHERE phoneNumberId = ?`,
          [payload.data.phoneNumber, payload.instance]
        );

        console.log(`[Evolution Webhook] Conexão estabelecida: ${payload.data.phoneNumber}`);
      } else if (payload.data.connectionStatus === "closed") {
        // Conexão fechada
        await connection.execute(
          `UPDATE megadesk_whatsapp_config 
           SET connectionStatus = 0, updatedAt = NOW()
           WHERE phoneNumberId = ?`,
          [payload.instance]
        );

        console.log(`[Evolution Webhook] Conexão fechada`);
      }
    } finally {
      connection.release();
    }
  } catch (err: any) {
    console.error(`[Evolution Webhook] Erro ao processar status:`, err);
  }
}

/**
 * Processar webhook de status de mensagem
 */
export async function handleMessageStatus(payload: EvolutionWebhookPayload): Promise<void> {
  try {
    console.log(`[Evolution Webhook] Status de mensagem:`, {
      messageId: payload.data.key?.id,
      status: payload.data.status,
    });

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      // Atualizar status da mensagem
      const messageId = payload.data.key?.id;
      if (!messageId) return;

      // Mapear status da Evolution para status do MegaDesk
      let status = "sent";
      if (payload.data.status === "DELIVERY_ACK") {
        status = "delivered";
      } else if (payload.data.status === "READ") {
        status = "read";
      } else if (payload.data.status === "ERROR") {
        status = "failed";
      }

      await connection.execute(
        `UPDATE megadesk_domain_conversations_messages 
         SET status = ?, updated_at = NOW()
         WHERE message_id = ?`,
        [status, messageId]
      );

      console.log(`[Evolution Webhook] Status da mensagem atualizado: ${messageId} -> ${status}`);
    } finally {
      connection.release();
    }
  } catch (err: any) {
    console.error(`[Evolution Webhook] Erro ao processar status de mensagem:`, err);
  }
}

/**
 * Processar webhook genérico
 */
export async function handleEvolutionWebhook(payload: EvolutionWebhookPayload): Promise<void> {
  try {
    console.log(`[Evolution Webhook] Recebido evento:`, payload.event);

    switch (payload.event) {
      case "messages.upsert":
        // Mensagem recebida
        if (!payload.data.key?.fromMe) {
          await handleIncomingMessage(payload);
        }
        break;

      case "connection.update":
        // Status de conexão alterado
        await handleConnectionStatus(payload);
        break;

      case "message.update":
        // Status de mensagem alterado
        await handleMessageStatus(payload);
        break;

      default:
        console.log(`[Evolution Webhook] Evento não tratado: ${payload.event}`);
    }
  } catch (err: any) {
    console.error(`[Evolution Webhook] Erro ao processar webhook:`, err);
  }
}
