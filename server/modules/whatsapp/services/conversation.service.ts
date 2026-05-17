/**
 * WhatsApp Module — Conversation Service
 * Lógica de negócio para gerenciamento de conversas WhatsApp.
 */
import {
  listConversations,
  getConversationById,
  updateConversation,
  markConversationRead,
} from "../repositories/conversation.repo";
import { emitConversationUpdated } from "../socket/whatsapp.socket";
import { TRPCError } from "@trpc/server";
import type { WaConversationStatus } from "../types";

export async function getConversations(
  clientId: string,
  opts: {
    accountId?: string;
    status?: WaConversationStatus;
    search?: string;
    limit?: number;
    offset?: number;
  }
) {
  return listConversations(clientId, opts);
}

export async function getConversation(clientId: string, conversationId: string) {
  const conv = await getConversationById(conversationId, clientId);
  if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada" });
  return conv;
}

export async function changeConversationStatus(
  clientId: string,
  conversationId: string,
  status: WaConversationStatus
) {
  const conv = await getConversationById(conversationId, clientId);
  if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada" });

  await updateConversation(conversationId, clientId, { status });

  const updated = { ...conv, status };
  emitConversationUpdated(clientId, updated);

  return { success: true };
}

export async function assignConversation(
  clientId: string,
  conversationId: string,
  assignedUserId: string | null
) {
  const conv = await getConversationById(conversationId, clientId);
  if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada" });

  await updateConversation(conversationId, clientId, { assignedUserId });

  const updated = { ...conv, assignedUserId };
  emitConversationUpdated(clientId, updated);

  return { success: true };
}

export async function readConversation(clientId: string, conversationId: string) {
  const conv = await getConversationById(conversationId, clientId);
  if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada" });

  await markConversationRead(conversationId, clientId);

  const updated = { ...conv, unreadCount: 0 };
  emitConversationUpdated(clientId, updated);

  return { success: true };
}
