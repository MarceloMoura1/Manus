/**
 * Evolution Router (tRPC)
 * Procedures expostas ao frontend da MegaDesk para gerenciar WhatsApp via Evolution API.
 *
 * Endpoints:
 *   evolution.connect        → cria instância + retorna QR Code base64
 *   evolution.getQRCode      → busca QR Code atual (polling)
 *   evolution.getStatus      → status atual da conexão
 *   evolution.disconnect     → desconecta (logout) e limpa sessão
 *   evolution.sendMessage    → envia mensagem de texto
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import {
  evoCreateInstance,
  evoGetQRCode,
  evoGetStatus,
  evoLogout,
  evoSendText,
  evoSetWebhook,
} from "./client";
import {
  getSession,
  upsertSession,
  deleteSession,
  instanceNameFor,
} from "./session-store";

// Tempo máximo de espera pelo QR Code (polling interno no connect)
const QR_POLL_MAX_MS    = 30_000;  // Aumentado de 15s para 30s
const QR_POLL_INTERVAL  = 1_000;   // Reduzido de 1.5s para 1s para resposta mais rápida

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Aguarda até que o QR Code esteja disponível na Evolution API (até maxMs). */
async function waitForQRCode(
  instanceName: string,
  maxMs = QR_POLL_MAX_MS
): Promise<{ base64: string } | null> {
  const deadline = Date.now() + maxMs;

  while (Date.now() < deadline) {
    const qr = await evoGetQRCode(instanceName).catch(() => null);
    if (qr?.base64) return qr;

    await new Promise((r) => setTimeout(r, QR_POLL_INTERVAL));
  }

  return null;
}

/** Configura o webhook da instância apontando para o backend MegaDesk. */
async function setupWebhook(instanceName: string): Promise<void> {
  const baseUrl =
    process.env.APP_BASE_URL ||
    process.env.VITE_API_URL ||
    "http://localhost:5000";

  const webhookUrl = `${baseUrl}/webhook/evolution`;

  try {
    await evoSetWebhook(instanceName, webhookUrl);
    console.log(`[Evolution] Webhook configurado: ${webhookUrl}`);
  } catch (err) {
    // Não fatal — mensagens ainda podem ser puxadas por polling
    console.warn("[Evolution] Aviso: não foi possível configurar webhook:", err);
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const evolutionRouter = router({

  /**
   * Inicia a conexão WhatsApp para um cliente.
   * Cria a instância na Evolution API (se não existir) e retorna o QR Code base64.
   *
   * O frontend renderiza a imagem e aguarda o usuário escanear.
   * Após escanear, a Evolution dispara CONNECTION_UPDATE via webhook.
   */
  connect: publicProcedure
    .input(z.object({ clientId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { clientId } = input;
      const instanceName = instanceNameFor(clientId);

      // 1. Verifica se já está conectado
      const existing = await getSession(clientId);
      if (existing?.status === "connected") {
        return {
          ok: true,
          status: "connected" as const,
          phoneNumber: existing.phoneNumber,
          qrCode: null,
        };
      }

      // 2. Tenta criar instância na Evolution API (idempotente)
      try {
        await evoCreateInstance(instanceName);
      } catch (err: any) {
        // "instance already exists" ou "Invalid integration" nao sao erros
        const msg = err.message?.toLowerCase() || "";
        if (!msg.includes("already") && !msg.includes("invalid integration")) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Erro ao criar instância: ${err.message}`,
          });
        }
      }

      // 3. Persiste sessão como "connecting"
      await upsertSession(clientId, instanceName, "connecting");

      // 4. Configura webhook (nao eh critico)
      await setupWebhook(instanceName).catch(() => {});

      // 5. Obtém QR Code imediatamente (a instância já deve existir)
      const qr = await evoGetQRCode(instanceName).catch(() => null);
      
      if (qr?.base64) {
        return {
          ok: true,
          status: "connecting" as const,
          phoneNumber: null,
          qrCode: qr.base64,
        };
      }

      // Se nao conseguir imediatamente, fazer polling
      const qrPolled = await waitForQRCode(instanceName);
      if (!qrPolled) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "QR Code não foi gerado a tempo. Verifique se a Evolution API está rodando e tente novamente.",
        });
      }

      return {
        ok: true,
        status: "connecting" as const,
        phoneNumber: null,
        qrCode: qrPolled.base64,
      };
    }),

  /**
   * Retorna o QR Code atual para uma instância já criada.
   * Usado pelo botão "Gerar novo QR Code" quando o anterior expirou.
   */
  getQRCode: publicProcedure
    .input(z.object({ clientId: z.string().min(1) }))
    .query(async ({ input }) => {
      const { clientId } = input;
      const instanceName = instanceNameFor(clientId);

      // Se já estiver conectado, não faz sentido gerar QR
      const session = await getSession(clientId);
      if (session?.status === "connected") {
        return { ok: true, status: "connected" as const, qrCode: null };
      }

      const qr = await evoGetQRCode(instanceName).catch(() => null);

      return {
        ok: true,
        status: "connecting" as const,
        qrCode: qr?.base64 ?? null,
      };
    }),

  /**
   * Retorna o status atual da conexão WhatsApp do cliente.
   * O frontend faz polling nesta procedure a cada 3–5 segundos enquanto status = "connecting".
   */
  getStatus: publicProcedure
    .input(z.object({ clientId: z.string().min(1) }))
    .query(async ({ input }) => {
      const { clientId } = input;
      const instanceName = instanceNameFor(clientId);

      // Primeiro consulta o banco (mais rápido)
      const session = await getSession(clientId);

      // Se o banco diz "connected", confiar sem chamar a Evolution
      if (session?.status === "connected") {
        return {
          ok: true,
          status: "connected" as const,
          phoneNumber: session.phoneNumber ?? null,
          instanceName,
        };
      }

      // Se não há sessão ou está "connecting", verifica ao vivo na Evolution API
      const liveStatus = await evoGetStatus(instanceName);

      // Sincroniza banco se houve mudança
      if (session && liveStatus !== session.status) {
        await upsertSession(clientId, instanceName, liveStatus);
      } else if (!session && liveStatus !== "disconnected") {
        await upsertSession(clientId, instanceName, liveStatus);
      }

      return {
        ok: true,
        status: liveStatus,
        phoneNumber: session?.phoneNumber ?? null,
        instanceName,
      };
    }),

  /**
   * Desconecta o WhatsApp (logout) e limpa a sessão no banco.
   * NÃO deleta a instância na Evolution — apenas desconecta.
   */
  disconnect: publicProcedure
    .input(z.object({ clientId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { clientId } = input;
      const instanceName = instanceNameFor(clientId);

      try {
        await evoLogout(instanceName);
      } catch (err: any) {
        // Se a instância não existir, não é erro crítico
        console.warn(`[Evolution] Aviso ao desconectar ${clientId}:`, err.message);
      }

      await deleteSession(clientId);

      return { ok: true };
    }),

  /**
   * Envia mensagem de texto para um número via WhatsApp.
   * Usado internamente por outros routers (conversas, atendimento, etc.).
   */
  sendMessage: publicProcedure
    .input(
      z.object({
        clientId:    z.string().min(1),
        phoneNumber: z.string().min(8),
        text:        z.string().min(1).max(4096),
      })
    )
    .mutation(async ({ input }) => {
      const { clientId, phoneNumber, text } = input;
      const instanceName = instanceNameFor(clientId);

      // Verifica se está conectado
      const session = await getSession(clientId);
      if (!session || session.status !== "connected") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "WhatsApp não está conectado. Conecte antes de enviar mensagens.",
        });
      }

      // Normaliza número: adiciona @s.whatsapp.net se necessário
      const number = phoneNumber.replace(/\D/g, "");

      try {
        const result = await evoSendText(instanceName, number, text);
        return { ok: true, messageId: result.key?.id };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao enviar mensagem: ${err.message}`,
        });
      }
    }),
});
