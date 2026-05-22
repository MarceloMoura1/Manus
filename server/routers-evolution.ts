/**
 * tRPC router para gerenciar Evolution API
 * Procedures para conectar WhatsApp, enviar mensagens, etc.
 */

import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createWhatsAppSession,
  getWhatsAppQRCode,
  getWhatsAppQRCodeImage,
  sendWhatsAppMessage,
  getWhatsAppStatus,
  disconnectWhatsApp,
  configureWebhook,
} from "./evolution-manager";
import { validateMegaDeskClientToken } from "./db";

/**
 * Validar que o cliente está ativo
 */
async function getReleasedClientOrThrow(clientId: string) {
  if (!clientId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cliente não identificado" });
  }
  // TODO: Implementar validação real do cliente no banco
  return { clientId };
}

export const evolutionRouter = router({
  /**
   * Iniciar nova sessão WhatsApp
   * POST /trpc/evolution.startSession
   */
  startSession: protectedProcedure
    .input(z.object({ clientId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Validar que o cliente existe e está ativo
      const client = await getReleasedClientOrThrow(input.clientId);

      console.log(`[Evolution Router] Iniciando sessão para cliente: ${input.clientId}`);

      const result = await createWhatsAppSession(input.clientId);

      if (!result.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error || "Erro ao criar sessão",
        });
      }

      return {
        ok: true,
        instanceId: result.instanceId,
        token: result.token,
      };
    }),

  /**
   * Obter QR Code para conectar
   * GET /trpc/evolution.getQRCode
   */
  getQRCode: protectedProcedure
    .input(z.object({ clientId: z.string() }))
    .query(async ({ input }) => {
      // Validar que o cliente existe
      await getReleasedClientOrThrow(input.clientId);

      console.log(`[Evolution Router] Obtendo QR Code para cliente: ${input.clientId}`);

      const result = await getWhatsAppQRCode(input.clientId);

      if (!result.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error || "Erro ao obter QR Code",
        });
      }

      return {
        ok: true,
        qrCode: result.qrCode,
      };
    }),

  /**
   * Obter imagem do QR Code em base64
   * GET /trpc/evolution.getQRCodeImage
   */
  getQRCodeImage: protectedProcedure
    .input(z.object({ clientId: z.string() }))
    .query(async ({ input }) => {
      // Validar que o cliente existe
      await getReleasedClientOrThrow(input.clientId);

      console.log(`[Evolution Router] Obtendo imagem QR Code para cliente: ${input.clientId}`);

      const result = await getWhatsAppQRCodeImage(input.clientId);

      if (!result.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error || "Erro ao obter imagem QR Code",
        });
      }

      return {
        ok: true,
        image: result.image,
      };
    }),

  /**
   * Enviar mensagem WhatsApp
   * POST /trpc/evolution.sendMessage
   */
  sendMessage: protectedProcedure
    .input(
      z.object({
        clientId: z.string(),
        conversationId: z.string(),
        phoneNumber: z.string(),
        text: z.string(),
        agentName: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Validar que o cliente existe
      await getReleasedClientOrThrow(input.clientId);

      // Validar entrada
      if (!input.phoneNumber || !input.text) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Número de telefone e mensagem são obrigatórios",
        });
      }

      console.log(
        `[Evolution Router] Enviando mensagem para ${input.phoneNumber}: "${input.text.substring(0, 50)}..."`
      );

      const result = await sendWhatsAppMessage(
        input.clientId,
        input.conversationId,
        input.phoneNumber,
        input.text,
        input.agentName || "Atendente"
      );

      if (!result.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error || "Erro ao enviar mensagem",
        });
      }

      return {
        ok: true,
        messageId: result.messageId,
      };
    }),

  /**
   * Obter status da sessão
   * GET /trpc/evolution.getStatus
   */
  getStatus: protectedProcedure
    .input(z.object({ clientId: z.string() }))
    .query(async ({ input }) => {
      // Validar que o cliente existe
      await getReleasedClientOrThrow(input.clientId);

      const status = getWhatsAppStatus(input.clientId);

      return {
        ok: true,
        status: status.status,
        phoneNumber: status.phoneNumber,
        instanceId: status.instanceId,
        connected: status.connected,
      };
    }),

  /**
   * Desconectar WhatsApp
   * POST /trpc/evolution.disconnect
   */
  disconnect: protectedProcedure
    .input(z.object({ clientId: z.string() }))
    .mutation(async ({ input }) => {
      // Validar que o cliente existe
      await getReleasedClientOrThrow(input.clientId);

      console.log(`[Evolution Router] Desconectando cliente: ${input.clientId}`);

      const result = await disconnectWhatsApp(input.clientId);

      if (!result.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error || "Erro ao desconectar",
        });
      }

      return {
        ok: true,
      };
    }),

  /**
   * Configurar webhook para receber mensagens
   * POST /trpc/evolution.configureWebhook
   */
  configureWebhook: adminProcedure
    .input(
      z.object({
        clientId: z.string(),
        webhookUrl: z.string().url(),
      })
    )
    .mutation(async ({ input }) => {
      // Validar que o cliente existe
      await getReleasedClientOrThrow(input.clientId);

      console.log(
        `[Evolution Router] Configurando webhook para cliente: ${input.clientId} -> ${input.webhookUrl}`
      );

      const result = await configureWebhook(input.clientId, input.webhookUrl);

      if (!result.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error || "Erro ao configurar webhook",
        });
      }

      return {
        ok: true,
      };
    }),
});
