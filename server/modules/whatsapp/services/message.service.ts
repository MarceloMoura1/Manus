/**
 * WhatsApp Module — Message Service
 * Lógica de negócio para envio e gerenciamento de mensagens.
 * Orquestra: repository → Meta Graph API → Socket.IO
 */
import { getWaAccountById } from "../repositories/whatsapp.repo";
import { getConversationById } from "../repositories/conversation.repo";
import {
  createMessage,
  updateMessageWaId,
  markMessageFailed,
  listMessages,
} from "../repositories/message.repo";
import {
  sendTextMessage,
  sendImageMessage,
  sendAudioMessage,
  sendVideoMessage,
  sendDocumentMessage,
  sendTemplateMessage,
  markMessageAsRead,
} from "../meta/graph-api";
import { emitNewMessage, emitConversationUpdated } from "../socket/whatsapp.socket";
import { updateConversationLastMessage } from "../repositories/conversation.repo";
import type { SendTextMessageInput, SendMediaMessageInput, SendTemplateMessageInput } from "../types";
import { TRPCError } from "@trpc/server";

// ─── Envio de Texto ────────────────────────────────────────────────────────────

export async function sendText(input: SendTextMessageInput) {
  const account = await getWaAccountById(input.accountId, input.clientId);
  if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Conta WhatsApp não encontrada" });

  const conversation = await getConversationById(input.conversationId ?? "", input.clientId);
  if (!conversation) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada" });

  // Salvar mensagem como pending
  const message = await createMessage({
    conversationId: conversation.id,
    clientId: input.clientId,
    senderType: "agent",
    messageType: "text",
    content: input.text,
  });

  try {
    // Enviar via Meta API
    const result = await sendTextMessage(
      account.phoneNumberId,
      account.accessToken,
      conversation.customerPhone,
      input.text
    );

    const waMessageId = result.messages?.[0]?.id;
    if (waMessageId) {
      await updateMessageWaId(message.id, waMessageId, "sent");
    }

    // Atualizar última mensagem
    await updateConversationLastMessage(conversation.id, input.clientId, input.text, false);

    // Emitir via socket
    const updatedMsg = { ...message, waMessageId: waMessageId ?? null, status: "sent" as const };
    const updatedConv = { ...conversation, lastMessage: input.text };
    emitNewMessage(input.clientId, updatedConv, updatedMsg);
    emitConversationUpdated(input.clientId, updatedConv);

    return { success: true, messageId: message.id, waMessageId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Erro desconhecido";
    await markMessageFailed(message.id, errMsg);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Falha ao enviar mensagem: ${errMsg}` });
  }
}

// ─── Envio de Mídia ────────────────────────────────────────────────────────────

export async function sendMedia(input: SendMediaMessageInput & { conversationId: string }) {
  const account = await getWaAccountById(input.accountId, input.clientId);
  if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Conta WhatsApp não encontrada" });

  const conversation = await getConversationById(input.conversationId, input.clientId);
  if (!conversation) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada" });

  const content = input.caption ?? `[${input.type.charAt(0).toUpperCase() + input.type.slice(1)}]`;

  const message = await createMessage({
    conversationId: conversation.id,
    clientId: input.clientId,
    senderType: "agent",
    messageType: input.type,
    content,
    mediaUrl: input.mediaUrl,
    caption: input.caption,
  });

  try {
    let result: { messages?: { id: string }[] };

    switch (input.type) {
      case "image":
        result = await sendImageMessage(account.phoneNumberId, account.accessToken, conversation.customerPhone, input.mediaUrl, input.caption);
        break;
      case "audio":
        result = await sendAudioMessage(account.phoneNumberId, account.accessToken, conversation.customerPhone, input.mediaUrl);
        break;
      case "video":
        result = await sendVideoMessage(account.phoneNumberId, account.accessToken, conversation.customerPhone, input.mediaUrl, input.caption);
        break;
      case "document":
        result = await sendDocumentMessage(account.phoneNumberId, account.accessToken, conversation.customerPhone, input.mediaUrl, input.filename, input.caption);
        break;
      default:
        throw new Error(`Tipo de mídia não suportado: ${input.type}`);
    }

    const waMessageId = result.messages?.[0]?.id;
    if (waMessageId) await updateMessageWaId(message.id, waMessageId, "sent");

    await updateConversationLastMessage(conversation.id, input.clientId, content, false);

    const updatedMsg = { ...message, waMessageId: waMessageId ?? null, status: "sent" as const };
    const updatedConv = { ...conversation, lastMessage: content };
    emitNewMessage(input.clientId, updatedConv, updatedMsg);
    emitConversationUpdated(input.clientId, updatedConv);

    return { success: true, messageId: message.id, waMessageId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Erro desconhecido";
    await markMessageFailed(message.id, errMsg);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Falha ao enviar mídia: ${errMsg}` });
  }
}

// ─── Envio de Template ─────────────────────────────────────────────────────────

export async function sendTemplate(input: SendTemplateMessageInput & { conversationId: string }) {
  const account = await getWaAccountById(input.accountId, input.clientId);
  if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Conta WhatsApp não encontrada" });

  const conversation = await getConversationById(input.conversationId, input.clientId);
  if (!conversation) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada" });

  const content = `[Template: ${input.templateName}]`;

  const message = await createMessage({
    conversationId: conversation.id,
    clientId: input.clientId,
    senderType: "agent",
    messageType: "template",
    content,
  });

  try {
    const result = await sendTemplateMessage(
      account.phoneNumberId,
      account.accessToken,
      conversation.customerPhone,
      input.templateName,
      input.languageCode,
      input.components
    );

    const waMessageId = result.messages?.[0]?.id;
    if (waMessageId) await updateMessageWaId(message.id, waMessageId, "sent");

    await updateConversationLastMessage(conversation.id, input.clientId, content, false);

    return { success: true, messageId: message.id, waMessageId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Erro desconhecido";
    await markMessageFailed(message.id, errMsg);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Falha ao enviar template: ${errMsg}` });
  }
}

// ─── Listar Mensagens ──────────────────────────────────────────────────────────

export async function getMessages(
  clientId: string,
  conversationId: string,
  opts: { limit?: number; before?: string } = {}
) {
  // Verificar que a conversa pertence ao cliente
  const conversation = await getConversationById(conversationId, clientId);
  if (!conversation) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada" });

  return listMessages(conversationId, clientId, opts);
}

// ─── Marcar como lido ──────────────────────────────────────────────────────────

export async function markRead(
  clientId: string,
  conversationId: string,
  lastWaMessageId?: string
) {
  const conversation = await getConversationById(conversationId, clientId);
  if (!conversation) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada" });

  // Marcar como lido na Meta se tiver o ID da última mensagem
  if (lastWaMessageId) {
    const account = await getWaAccountById(conversation.accountId, clientId);
    if (account) {
      markMessageAsRead(account.phoneNumberId, account.accessToken, lastWaMessageId).catch(() => {});
    }
  }

  return { success: true };
}
