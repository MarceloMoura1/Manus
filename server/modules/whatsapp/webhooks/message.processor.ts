/**
 * WhatsApp Module — Message Processor
 * Processa eventos de mensagem recebidos via webhook da Meta.
 * Responsável por: criar/atualizar conversa, salvar mensagem, emitir socket.
 */
import { findOrCreateConversation, updateConversationLastMessage } from "../repositories/conversation.repo";
import { createMessage, updateMessageStatus, getMessageByWaId } from "../repositories/message.repo";
import { getMediaUrl } from "../meta/graph-api";
import { emitNewMessage, emitMessageStatus, emitNewConversation, emitConversationUpdated } from "../socket/whatsapp.socket";
import type {
  MetaWebhookMessage,
  MetaWebhookContact,
  MetaWebhookStatus,
  WaMessageType,
  WaAccountRecord,
} from "../types";

/**
 * Processa uma mensagem recebida do webhook Meta.
 */
export async function processIncomingMessage(
  account: WaAccountRecord,
  message: MetaWebhookMessage,
  contact: MetaWebhookContact | undefined
): Promise<void> {
  // A conta e o tenant foram resolvidos autoritativamente pelo handler.
  const existing = await getMessageByWaId(account.clientId, message.id);
  if (existing) {
    console.log(`[WA Webhook] Mensagem duplicada ignorada: ${message.id}`);
    return;
  }

  // 3. Encontrar ou criar conversa
  const customerPhone = message.from;
  const customerName = contact?.profile?.name ?? customerPhone;

  const { conversation, isNew } = await findOrCreateConversation(
    account.clientId,
    account.id,
    customerPhone,
    customerName
  );

  // 4. Determinar tipo e conteúdo da mensagem
  const messageType = message.type as WaMessageType;
  let content = "";
  let mediaUrl: string | undefined;
  let mediaId: string | undefined;
  let caption: string | undefined;

  switch (message.type) {
    case "text":
      content = message.text?.body ?? "";
      break;
    case "image":
      mediaId = message.image?.id;
      caption = message.image?.caption;
      content = caption ?? "[Imagem]";
      if (mediaId) {
        try {
          mediaUrl = await getMediaUrl(mediaId, account.accessToken);
        } catch (e) {
          console.error("[WA Webhook] Falha ao obter URL de mídia:", e);
        }
      }
      break;
    case "audio":
      mediaId = message.audio?.id;
      content = "[Áudio]";
      if (mediaId) {
        try {
          mediaUrl = await getMediaUrl(mediaId, account.accessToken);
        } catch (e) {
          console.error("[WA Webhook] Falha ao obter URL de mídia:", e);
        }
      }
      break;
    case "video":
      mediaId = message.video?.id;
      caption = message.video?.caption;
      content = caption ?? "[Vídeo]";
      if (mediaId) {
        try {
          mediaUrl = await getMediaUrl(mediaId, account.accessToken);
        } catch (e) {
          console.error("[WA Webhook] Falha ao obter URL de mídia:", e);
        }
      }
      break;
    case "document":
      mediaId = message.document?.id;
      caption = message.document?.caption;
      content = message.document?.filename ?? caption ?? "[Documento]";
      if (mediaId) {
        try {
          mediaUrl = await getMediaUrl(mediaId, account.accessToken);
        } catch (e) {
          console.error("[WA Webhook] Falha ao obter URL de mídia:", e);
        }
      }
      break;
    case "sticker":
      content = "[Sticker]";
      break;
    case "location":
      content = `[Localização: ${message.location?.name ?? `${message.location?.latitude},${message.location?.longitude}`}]`;
      break;
    case "reaction":
      content = `[Reação: ${message.reaction?.emoji}]`;
      break;
    default:
      content = `[${message.type}]`;
  }

  // 5. Salvar mensagem no banco
  const savedMessage = await createMessage({
    conversationId: conversation.id,
    clientId: account.clientId,
    waMessageId: message.id,
    senderType: "customer",
    messageType,
    content,
    mediaUrl,
    mediaId,
    caption,
    metadata: { timestamp: message.timestamp, context: message.context },
  });

  // 6. Atualizar última mensagem da conversa (incrementar não lidas)
  await updateConversationLastMessage(conversation.id, account.clientId, content, true);

  // 7. Emitir via Socket.IO
  const updatedConversation = { ...conversation, lastMessage: content, unreadCount: conversation.unreadCount + 1 };

  if (isNew) {
    emitNewConversation(account.clientId, updatedConversation);
  } else {
    emitConversationUpdated(account.clientId, updatedConversation);
  }

  emitNewMessage(account.clientId, updatedConversation, savedMessage);
}

/**
 * Processa atualizações de status de mensagem (sent, delivered, read, failed).
 */
export async function processMessageStatus(clientId: string, status: MetaWebhookStatus): Promise<void> {
  const waStatus = status.status;
  await updateMessageStatus(clientId, status.id, waStatus);

  // Emitir atualização de status via socket
  emitMessageStatus(clientId, status.id, waStatus);
}
