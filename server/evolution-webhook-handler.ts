/**
 * Evolution Webhook Handler
 * Processa eventos recebidos da Evolution API (mensagens, status, etc.)
 * Sincroniza automaticamente com banco de dados via db-evolution-sync
 */

import {
  syncEvolutionMessage,
  syncMessageStatus,
  syncConnectionStatus,
  EvolutionMessagePayload,
} from "./db-evolution-sync";
import { getAllSessions } from "./evolution-manager";

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
        url?: string;
        caption?: string;
      };
      audioMessage?: {
        url?: string;
      };
      videoMessage?: {
        url?: string;
        caption?: string;
      };
      documentMessage?: {
        url?: string;
        fileName?: string;
      };
    };
    status?: string;
    phoneNumber?: string;
    connectionStatus?: string;
    pushName?: string;
    timestamp?: number;
  };
}

/**
 * Mapear instanceId da Evolution para clientId do MegaDesk
 * TODO: Implementar mapeamento real em banco de dados
 */
async function getClientIdFromInstance(instanceId: string): Promise<string | null> {
  try {
    // Por enquanto, usar mapeamento em memória do evolutionManager
    // No futuro, isso será armazenado em banco de dados
    const sessions = getAllSessions();
    for (const [clientId, session] of Object.entries(sessions)) {
      if (session.instanceId === instanceId) {
        return clientId;
      }
    }
    return null;
  } catch (err) {
    console.error(`[Evolution Webhook] Erro ao mapear instanceId para clientId:`, err);
    return null;
  }
}

/**
 * Processar webhook de mensagem recebida
 */
export async function handleIncomingMessage(payload: EvolutionWebhookPayload): Promise<void> {
  try {
    const { instance, data } = payload;
    const { key, message, pushName, timestamp } = data;

    if (!key) {
      console.warn(`[Evolution Webhook] key nao encontrada`);
      return;
    }

    // Obter clientId a partir do instanceId
    const clientId = await getClientIdFromInstance(instance);
    if (!clientId) {
      console.warn(`[Evolution Webhook] Nao foi possivel mapear instanceId para clientId: ${instance}`);
      return;
    }

    // Construir payload de mensagem para sincronização
    const syncPayload: EvolutionMessagePayload = {
      instanceId: instance,
      data: {
        key,
        message,
        pushName,
        timestamp,
      },
    };

    // Sincronizar mensagem com banco de dados
    const { conversationId, messageId } = await syncEvolutionMessage(clientId, syncPayload);

    console.log(`[Evolution Webhook] Mensagem sincronizada:`, {
      conversationId,
      messageId,
      clientId,
      phoneNumber: key.remoteJid,
    });
  } catch (err: any) {
    console.error(`[Evolution Webhook] Erro ao processar mensagem:`, err);
  }
}

/**
 * Processar webhook de status de conexao
 */
export async function handleConnectionStatus(payload: EvolutionWebhookPayload): Promise<void> {
  try {
    const { instance, data } = payload;
    const { connectionStatus, phoneNumber } = data;

    // Obter clientId a partir do instanceId
    const clientId = await getClientIdFromInstance(instance);
    if (!clientId) {
      console.warn(`[Evolution Webhook] Nao foi possivel mapear instanceId para clientId: ${instance}`);
      return;
    }

    const connected = connectionStatus === "open";

    // Sincronizar status de conexao
    await syncConnectionStatus(clientId, instance, connected, phoneNumber);

    console.log(`[Evolution Webhook] Status de conexao sincronizado:`, {
      instance,
      clientId,
      connected,
      phoneNumber,
    });
  } catch (err: any) {
    console.error(`[Evolution Webhook] Erro ao processar status de conexao:`, err);
  }
}

/**
 * Processar webhook de status de mensagem
 */
export async function handleMessageStatus(payload: EvolutionWebhookPayload): Promise<void> {
  try {
    const { instance, data } = payload;
    const { key, status } = data;

    if (!key) {
      console.warn(`[Evolution Webhook] key nao encontrada`);
      return;
    }

    // Obter clientId a partir do instanceId
    const clientId = await getClientIdFromInstance(instance);
    if (!clientId) {
      console.warn(`[Evolution Webhook] Nao foi possivel mapear instanceId para clientId: ${instance}`);
      return;
    }

    // Mapear status da Evolution para status do MegaDesk
    let msgStatus: "sent" | "delivered" | "read" | "failed" = "sent";
    if (status === "DELIVERY_ACK") {
      msgStatus = "delivered";
    } else if (status === "READ") {
      msgStatus = "read";
    } else if (status === "ERROR") {
      msgStatus = "failed";
    }

    // Sincronizar status de mensagem
    await syncMessageStatus(clientId, key.id, msgStatus);

    console.log(`[Evolution Webhook] Status de mensagem sincronizado:`, {
      messageId: key.id,
      status: msgStatus,
      clientId,
    });
  } catch (err: any) {
    console.error(`[Evolution Webhook] Erro ao processar status de mensagem:`, err);
  }
}

/**
 * Processar webhook generico
 */
export async function handleEvolutionWebhook(payload: EvolutionWebhookPayload): Promise<void> {
  try {
    console.log(`[Evolution Webhook] Evento recebido:`, {
      event: payload.event,
      instance: payload.instance,
    });

    switch (payload.event) {
      case "messages.upsert":
        // Mensagem recebida (ignorar mensagens enviadas por nos)
        if (!payload.data.key?.fromMe) {
          await handleIncomingMessage(payload);
        }
        break;

      case "connection.update":
        // Status de conexao alterado
        await handleConnectionStatus(payload);
        break;

      case "message.update":
        // Status de mensagem alterado
        await handleMessageStatus(payload);
        break;

      default:
        console.log(`[Evolution Webhook] Evento nao tratado: ${payload.event}`);
    }
  } catch (err: any) {
    console.error(`[Evolution Webhook] Erro ao processar webhook:`, err);
  }
}
