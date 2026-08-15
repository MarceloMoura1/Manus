/**
 * WhatsApp Module — tRPC Router
 * Todas as procedures do módulo WhatsApp expostas via tRPC.
 * Integrado ao router principal em server/routers.ts
 */
import { z } from "zod";
import { router, megadeskProcedure } from "../../_core/trpc";
import {
  listConversationsSchema,
  getConversationSchema,
  updateConversationSchema,
  markReadSchema,
  listMessagesSchema,
  sendTextSchema,
  sendMediaSchema,
  sendTemplateSchema,
  createWaAccountSchema,
  updateWaAccountSchema,
  deleteWaAccountSchema,
} from "./validators";
import { connectAccount, listAccounts, getAccount, updateAccount, disconnectAccount, removeAccount } from "./services/whatsapp-account.service";
import { getConversations, getConversation, changeConversationStatus, assignConversation, readConversation } from "./services/conversation.service";
import { sendText, sendMedia, sendTemplate, getMessages, markRead } from "./services/message.service";
import type { WaConversationStatus } from "./types";

export const whatsappRouter = router({
  // ─── Contas WhatsApp ─────────────────────────────────────────────────────────

  /**
   * Conectar uma nova conta WhatsApp Business.
   * Verifica o token com a Meta API antes de salvar.
   */
  connectAccount: megadeskProcedure
    .input(createWaAccountSchema)
    .mutation(async ({ input }) => {
      return connectAccount(input);
    }),

  /**
   * Listar todas as contas WhatsApp do tenant.
   */
  listAccounts: megadeskProcedure
    .input(z.object({ clientId: z.string() }))
    .query(async ({ input }) => {
      return listAccounts(input.clientId);
    }),

  /**
   * Obter detalhes de uma conta (sem expor o token completo).
   */
  getAccount: megadeskProcedure
    .input(z.object({ clientId: z.string(), accountId: z.string() }))
    .query(async ({ input }) => {
      return getAccount(input.clientId, input.accountId);
    }),

  /**
   * Atualizar nome ou token de uma conta.
   */
  updateAccount: megadeskProcedure
    .input(updateWaAccountSchema)
    .mutation(async ({ input }) => {
      return updateAccount(input.clientId, input.accountId, {
        displayName: input.displayName,
        accessToken: input.accessToken,
      });
    }),

  /**
   * Desconectar (inativar) uma conta sem remover do banco.
   */
  disconnectAccount: megadeskProcedure
    .input(z.object({ clientId: z.string(), accountId: z.string() }))
    .mutation(async ({ input }) => {
      return disconnectAccount(input.clientId, input.accountId);
    }),

  /**
   * Remover permanentemente uma conta.
   */
  removeAccount: megadeskProcedure
    .input(deleteWaAccountSchema)
    .mutation(async ({ input }) => {
      return removeAccount(input.clientId, input.accountId);
    }),

  // ─── Conversas ───────────────────────────────────────────────────────────────

  /**
   * Listar conversas com filtros opcionais.
   */
  listConversations: megadeskProcedure
    .input(listConversationsSchema)
    .query(async ({ input }) => {
      return getConversations(input.clientId, {
        accountId: input.accountId,
        status: input.status,
        search: input.search,
        limit: input.limit,
        offset: input.offset,
      });
    }),

  /**
   * Obter detalhes de uma conversa.
   */
  getConversation: megadeskProcedure
    .input(getConversationSchema)
    .query(async ({ input }) => {
      return getConversation(input.clientId, input.conversationId);
    }),

  /**
   * Alterar status de uma conversa (open, pending, closed).
   */
  updateConversationStatus: megadeskProcedure
    .input(z.object({
      clientId: z.string(),
      conversationId: z.string(),
      status: z.enum(["open", "pending", "closed"]),
    }))
    .mutation(async ({ input }) => {
      return changeConversationStatus(input.clientId, input.conversationId, input.status);
    }),

  /**
   * Atribuir conversa a um atendente.
   */
  assignConversation: megadeskProcedure
    .input(z.object({
      clientId: z.string(),
      conversationId: z.string(),
      assignedUserId: z.string().nullable(),
    }))
    .mutation(async ({ input }) => {
      return assignConversation(input.clientId, input.conversationId, input.assignedUserId);
    }),

  /**
   * Marcar conversa como lida (zerar contador de não lidas).
   */
  markConversationRead: megadeskProcedure
    .input(markReadSchema)
    .mutation(async ({ input }) => {
      return readConversation(input.clientId, input.conversationId);
    }),

  // ─── Mensagens ───────────────────────────────────────────────────────────────

  /**
   * Listar mensagens de uma conversa com paginação por cursor.
   */
  listMessages: megadeskProcedure
    .input(listMessagesSchema)
    .query(async ({ input }) => {
      return getMessages(input.clientId, input.conversationId, {
        limit: input.limit,
        before: input.before,
      });
    }),

  /**
   * Enviar mensagem de texto.
   */
  sendText: megadeskProcedure
    .input(sendTextSchema.extend({ accountId: z.string() }))
    .mutation(async ({ input }) => {
      return sendText({
        clientId: input.clientId,
        accountId: input.accountId,
        conversationId: input.conversationId as string,
        to: "",
        text: input.text,
      });
    }),

  /**
   * Enviar mensagem com mídia (imagem, áudio, vídeo, documento).
   */
  sendMedia: megadeskProcedure
    .input(sendMediaSchema.extend({ accountId: z.string() }))
    .mutation(async ({ input }) => {
      return sendMedia({
        clientId: input.clientId,
        accountId: input.accountId,
        conversationId: input.conversationId,
        to: "",
        type: input.type,
        mediaUrl: input.mediaUrl,
        caption: input.caption,
        filename: input.filename,
      });
    }),

  /**
   * Enviar mensagem de template (HSM).
   */
  sendTemplate: megadeskProcedure
    .input(sendTemplateSchema.extend({ accountId: z.string() }))
    .mutation(async ({ input }) => {
      return sendTemplate({
        clientId: input.clientId,
        accountId: input.accountId,
        conversationId: input.conversationId,
        to: "",
        templateName: input.templateName,
        languageCode: input.languageCode,
        components: input.components,
      });
    }),

  /**
   * Marcar mensagens como lidas na Meta API.
   */
  markRead: megadeskProcedure
    .input(z.object({
      clientId: z.string(),
      conversationId: z.string(),
      lastWaMessageId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return markRead(input.clientId, input.conversationId, input.lastWaMessageId);
    }),
});

export type WhatsAppRouter = typeof whatsappRouter;
