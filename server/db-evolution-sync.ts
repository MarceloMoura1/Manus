/**
 * db-evolution-sync.ts
 * Helpers para sincronizar mensagens recebidas via Evolution API para o banco de dados
 */

import { getDb } from "./db";
import { waConversations, waMessages } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

import { v4 as uuidv4 } from "uuid";

export interface EvolutionMessagePayload {
  instanceId: string;
  data: {
    key: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
    };
    message?: {
      conversation?: string;
      imageMessage?: {
        url: string;
        caption?: string;
      };
      audioMessage?: {
        url: string;
      };
      videoMessage?: {
        url: string;
        caption?: string;
      };
      documentMessage?: {
        url: string;
        fileName: string;
      };
    };
    pushName?: string;
    timestamp?: number;
  };
}

/**
 * Sincronizar mensagem recebida da Evolution API para o banco de dados
 */
export async function syncEvolutionMessage(
  clientId: string,
  payload: EvolutionMessagePayload
): Promise<{ conversationId: string; messageId: string }> {
  const db = getDb();

  const { instanceId, data } = payload;
  const { key, message, pushName, timestamp } = data;
  const { remoteJid, fromMe, id: waMessageId } = key;

  // Extrair número de telefone (remover @s.whatsapp.com)
  const phoneNumber = remoteJid.replace("@s.whatsapp.com", "").replace("@g.us", "");

  // Determinar tipo de mensagem
  let messageType: "text" | "image" | "audio" | "video" | "document" = "text";
  let content = "";
  let mediaUrl: string | null = null;
  let caption: string | null = null;

  if (message?.conversation) {
    messageType = "text";
    content = message.conversation;
  } else if (message?.imageMessage) {
    messageType = "image";
    mediaUrl = message.imageMessage.url;
    caption = message.imageMessage.caption || "";
    content = caption || "[Imagem]";
  } else if (message?.audioMessage) {
    messageType = "audio";
    mediaUrl = message.audioMessage.url;
    content = "[Áudio]";
  } else if (message?.videoMessage) {
    messageType = "video";
    mediaUrl = message.videoMessage.url;
    caption = message.videoMessage.caption || "";
    content = caption || "[Vídeo]";
  } else if (message?.documentMessage) {
    messageType = "document";
    mediaUrl = message.documentMessage.url;
    content = `[Documento: ${message.documentMessage.fileName}]`;
  }

  // Buscar ou criar conversa
  let conversation = await db
    .select()
    .from(waConversations)
    .where(
      and(
        eq(waConversations.clientId, clientId),
        eq(waConversations.customerPhone, phoneNumber)
      )
    )
    .limit(1);

  let conversationId: string;

  if (conversation.length === 0) {
    // Criar nova conversa
    conversationId = uuidv4();
    await db.insert(waConversations).values({
      id: conversationId,
      clientId,
      accountId: instanceId,
      customerName: pushName || phoneNumber,
      customerPhone: phoneNumber,
      lastMessage: content,
      lastMessageAt: new Date(timestamp ? timestamp * 1000 : Date.now()),
      unreadCount: fromMe ? 0 : 1,
      status: "open",
      assignedUserId: null, // Será atribuído ao bot por padrão
      metadataJson: JSON.stringify({
        evolutionInstanceId: instanceId,
        waMessageId,
        source: "evolution_api",
      }),
    });
  } else {
    conversationId = conversation[0].id;

    // Atualizar conversa com última mensagem
    await db
      .update(waConversations)
      .set({
        lastMessage: content,
        lastMessageAt: new Date(timestamp ? timestamp * 1000 : Date.now()),
        unreadCount: fromMe ? conversation[0].unreadCount : conversation[0].unreadCount + 1,
        status: "open", // Reabrir se estava fechada
        updatedAt: new Date(),
      })
      .where(eq(waConversations.id, conversationId));
  }

  // Criar mensagem
  const messageId = uuidv4();
  await db.insert(waMessages).values({
    id: messageId,
    conversationId,
    clientId,
    waMessageId,
    senderType: fromMe ? "agent" : "customer",
    agentName: fromMe ? "Bot" : pushName || phoneNumber,
    messageType,
    content,
    mediaUrl: mediaUrl || null,
    caption: caption || null,
    status: "delivered",
    metadataJson: JSON.stringify({
      evolutionInstanceId: instanceId,
      remoteJid,
      timestamp,
    }),
  });

  return { conversationId, messageId };
}

/**
 * Sincronizar status de entrega de mensagem
 */
export async function syncMessageStatus(
  clientId: string,
  waMessageId: string,
  status: "sent" | "delivered" | "read" | "failed",
  errorMessage?: string
): Promise<void> {
  const db = getDb();

  await db
    .update(waMessages)
    .set({
      status,
      errorMessage: errorMessage || null,
    })
    .where(and(eq(waMessages.clientId, clientId), eq(waMessages.waMessageId, waMessageId)));
}

/**
 * Sincronizar status de conexão
 */
export async function syncConnectionStatus(
  clientId: string,
  instanceId: string,
  connected: boolean,
  phoneNumber?: string
): Promise<void> {
  const db = getDb();

  // Atualizar metadados da conta
  // Nota: wa_accounts não está definida neste arquivo, mas seria atualizada aqui
  console.log(
    `[Evolution Sync] Conexao ${connected ? "estabelecida" : "perdida"} para ${instanceId} (cliente: ${clientId})`
  );

  if (!connected) {
    // Marcar mensagens pendentes como falhas se a conexao foi perdida por muito tempo
    // Isso seria implementado com um job de cleanup
  }
}

/**
 * Obter conversas nao lidas de um cliente
 */
export async function getUnreadConversations(clientId: string): Promise<any[]> {
  const db = getDb();

  return await db
    .select()
    .from(waConversations)
    .where(and(eq(waConversations.clientId, clientId), eq(waConversations.status, "open")))
    .orderBy(waConversations.lastMessageAt);
}

/**
 * Marcar conversa como lida
 */
export async function markConversationAsRead(conversationId: string): Promise<void> {
  const db = getDb();

  await db
    .update(waConversations)
    .set({
      unreadCount: 0,
    })
    .where(eq(waConversations.id, conversationId));
}

/**
 * Atualizar atribuicao de conversa
 */
export async function assignConversationToUser(
  conversationId: string,
  userId: string,
  clientId: string
): Promise<void> {
  const db = getDb();

  await db
    .update(waConversations)
    .set({
      assignedUserId: userId,
      updatedAt: new Date(),
    })
    .where(and(eq(waConversations.id, conversationId), eq(waConversations.clientId, clientId)));
}

/**
 * Fechar conversa
 */
export async function closeConversation(conversationId: string, clientId: string): Promise<void> {
  const db = getDb();

  await db
    .update(waConversations)
    .set({
      status: "closed",
      updatedAt: new Date(),
    })
    .where(and(eq(waConversations.id, conversationId), eq(waConversations.clientId, clientId)));
}

/**
 * Obter mensagens de uma conversa
 */
export async function getConversationMessages(
  conversationId: string,
  clientId: string,
  limit = 50,
  offset = 0
): Promise<any[]> {
  const db = getDb();

  return await db
    .select()
    .from(waMessages)
    .where(and(eq(waMessages.conversationId, conversationId), eq(waMessages.clientId, clientId)))
    .orderBy(waMessages.createdAt)
    .limit(limit)
    .offset(offset);
}
