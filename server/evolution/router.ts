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
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { router, megadeskProcedure } from "../_core/trpc";
import {
  evoCreateInstance,
  evoGetQRCode,
  evoGetStatus,
  evoLogout,
  evoSendText,
  evoSetWebhook,
  evoGetWebhookSummary,
  EvolutionApiError,
} from "./client";
import {
  getSession,
  upsertSession,
  deleteSession,
  instanceNameFor,
} from "./session-store";
import { getEvolutionSafeOrigin } from "./config";
import { getPool } from "../db";

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
function configuredWebhookUrl(): string {
  // Prioridade: WEBHOOK_BASE_URL (produção) > APP_URL > localhost:3000
  const baseUrl = (
    process.env.WEBHOOK_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");

  return `${baseUrl}/webhook/evolution`;
}

type WebhookSetupResult =
  | { ok: true; configuredEvents: string[] }
  | { ok: false; code: "WEBHOOK_CONFIGURATION_FAILED"; safeMessage: string };

export async function setupWebhook(instanceName: string): Promise<WebhookSetupResult> {
  const webhookUrl = configuredWebhookUrl();
  try {
    await evoSetWebhook(instanceName, webhookUrl);
    return { ok: true, configuredEvents: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"] };
  } catch (err) {
    console.warn("[Evolution] webhook configuration failed", err instanceof EvolutionApiError ? { code: err.code, status: err.status } : undefined);
    return { ok: false, code: "WEBHOOK_CONFIGURATION_FAILED", safeMessage: "A instância respondeu, mas o webhook não pôde ser configurado." };
  }
}

export function isExistingEvolutionInstanceError(error: unknown): error is EvolutionApiError {
  if (!(error instanceof EvolutionApiError) || error.status !== 403) return false;
  const detail = error.safeDetail.toLowerCase();
  return /\balready exists\b/.test(detail)
    || /\balready in use\b/.test(detail)
    || /\bname\b.{0,100}\bis already in use\b/.test(detail);
}

function requireEvolutionAdmin(role: string | null | undefined): void {
  if (role !== "admin" && role !== "manager") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Somente administradores podem alterar a conexão do WhatsApp." });
  }
}

type AuditPhase = "intent" | "success" | "failure";
type EvolutionAuditEvent = {
  operationId: string; tenantId: string; operatorUserId: string; operatorRole: string;
  instanceName: string; origin: "whatsapp.settings"; action: "evolution.repair" | "evolution.logout";
  phase: AuditPhase; errorCode?: string | null; sourceIp?: string | null;
  metadata: { sourceIpStatus: "recorded" | "unavailable"; providerRecovered?: boolean; webhookConfigured?: boolean };
};

function trustedSourceIp(req: { ip?: string } | undefined): string | null {
  const value = req?.ip?.replace(/^::ffff:/, "") ?? "";
  return isIP(value) ? value.slice(0, 45) : null;
}

async function auditEvolutionAction(event: EvolutionAuditEvent): Promise<void> {
  const parsed = z.object({
    operationId: z.string().uuid(), tenantId: z.string().min(1).max(80), operatorUserId: z.string().min(1).max(80),
    operatorRole: z.enum(["admin", "manager"]), instanceName: z.string().min(1).max(120),
    origin: z.literal("whatsapp.settings"), action: z.enum(["evolution.repair", "evolution.logout"]),
    phase: z.enum(["intent", "success", "failure"]), errorCode: z.string().max(80).nullable().optional(),
    sourceIp: z.string().max(45).refine(value => isIP(value) !== 0).nullable().optional(),
    metadata: z.object({ sourceIpStatus: z.enum(["recorded", "unavailable"]), providerRecovered: z.boolean().optional(), webhookConfigured: z.boolean().optional() }).strict(),
  }).strict().parse(event);
  const success = parsed.phase === "intent" ? null : parsed.phase === "success" ? 1 : 0;
  await getPool().execute(
    `INSERT INTO megadesk_domain_audit_logs
      (audit_id, platform, action, client_id, success, operation_id, operator_user_id, operator_role,
       instance_name, origin, event_phase, error_code, source_ip, metadata_json)
     VALUES (?, 'MegaDesk', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`audit-${randomUUID()}`, parsed.action, parsed.tenantId, success, parsed.operationId, parsed.operatorUserId,
      parsed.operatorRole, parsed.instanceName, parsed.origin, parsed.phase, parsed.errorCode ?? null,
      parsed.sourceIp ?? null, JSON.stringify(parsed.metadata).slice(0, 1_000)],
  );
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
  connect: megadeskProcedure
    .input(z.object({ clientId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      if (input.clientId !== ctx.tenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant inválido." });
      requireEvolutionAdmin(ctx.operationalUserRole);
      const { clientId } = input;
      const instanceName = instanceNameFor(clientId);

      console.log(`[Evolution] connect → clientId=${clientId}, instance=${instanceName}`);

      // 1. Verifica status ao vivo na Evolution (não só no banco)
      let liveStatus: "connected" | "connecting" | "disconnected";
      try {
        liveStatus = await evoGetStatus(instanceName);
      } catch {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "A Evolution API está indisponível. Tente novamente mais tarde." });
      }
      if (liveStatus === "connected") {
        const existing = await getSession(clientId);
        await upsertSession(clientId, instanceName, "connected", existing?.phoneNumber);
        const webhook = await setupWebhook(instanceName);
        return {
          ok: true,
          status: "connected" as const,
          phoneNumber: existing?.phoneNumber ?? null,
          qrCode: null,
          webhookConfigured: webhook.ok,
          integrationStatus: webhook.ok ? "connected" as const : "webhook_degraded" as const,
        };
      }

      // 2. Tenta criar instância (idempotente) — a resposta já pode incluir QR Code
      let qrFromCreate: string | null = null;
      try {
        const createResult = await evoCreateInstance(instanceName);
        qrFromCreate = createResult.qrBase64; // QR Code pode vir direto na criação
        console.log(`[Evolution] Instância criada: ${instanceName}${qrFromCreate ? " (QR incluso)" : ""}`);
      } catch (err: unknown) {
        if (!isExistingEvolutionInstanceError(err)) {
          console.error("[Evolution] instance creation failed", err instanceof EvolutionApiError ? { code: err.code, status: err.status } : undefined);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Não foi possível preparar a instância do WhatsApp.",
          });
        }
      }

      // 3. Persiste sessão como "connecting"
      await upsertSession(clientId, instanceName, "connecting");

      // 4. Configura webhook explicitamente; falha permanece visível no resultado.
      const webhook = await setupWebhook(instanceName);

      // 5. Retornar QR Code — primeiro o da criação, depois busca via GET
      if (qrFromCreate) {
        return {
          ok: true,
          status: "connecting" as const,
          phoneNumber: null,
          qrCode: qrFromCreate,
          webhookConfigured: webhook.ok,
          integrationStatus: webhook.ok ? "connecting" as const : "webhook_degraded" as const,
        };
      }

      // 5b. Buscar QR via GET /instance/connect/:name
      const qr = await evoGetQRCode(instanceName).catch(() => {
        console.warn("[Evolution] QR request failed");
        return null;
      });

      if (qr?.base64) {
        console.log(`[Evolution] QR Code obtido via GET /instance/connect`);
        return {
          ok: true,
          status: "connecting" as const,
          phoneNumber: null,
          qrCode: qr.base64,
          webhookConfigured: webhook.ok,
          integrationStatus: webhook.ok ? "qr_required" as const : "webhook_degraded" as const,
        };
      }

      // 5c. Polling — aguarda até 30s pela geração do QR
      console.log(`[Evolution] QR não disponível ainda, iniciando polling...`);
      const qrPolled = await waitForQRCode(instanceName);
      if (!qrPolled) {
        console.error(`[Evolution] QR Code não gerado em ${QR_POLL_MAX_MS}ms para ${instanceName}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "QR Code não foi gerado pela Evolution API. " +
            `Verifique se ela está disponível na origem configurada (${getEvolutionSafeOrigin()}) ` +
            "e tente novamente.",
        });
      }

      return {
        ok: true,
        status: "connecting" as const,
        phoneNumber: null,
        qrCode: qrPolled.base64,
        webhookConfigured: webhook.ok,
        integrationStatus: webhook.ok ? "qr_required" as const : "webhook_degraded" as const,
      };
    }),

  /**
   * Retorna o QR Code atual para uma instância já criada.
   * Usado pelo botão "Gerar novo QR Code" quando o anterior expirou.
   */
  getQRCode: megadeskProcedure
    .input(z.object({ clientId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      if (input.clientId !== ctx.tenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant inválido." });
      requireEvolutionAdmin(ctx.operationalUserRole);
      const { clientId } = input;
      const instanceName = instanceNameFor(clientId);

      // Verifica status ao vivo na Evolution (não depende do banco)
      const liveStatus = await evoGetStatus(instanceName).catch(() => "disconnected" as const);

      if (liveStatus === "connected") return { ok: true, status: "connected" as const, integrationStatus: "connected" as const, qrCode: null };

      // Busca QR Code atual
      const qr = await evoGetQRCode(instanceName).catch(() => {
        console.warn("[Evolution] QR refresh failed");
        return null;
      });

      return {
        ok: true,
        status: liveStatus as "connecting" | "disconnected",
        integrationStatus: qr?.base64 ? "qr_required" as const : liveStatus,
        qrCode: qr?.base64 ?? null,
      };
    }),

  /**
   * Retorna o status atual da conexão WhatsApp do cliente.
   * O frontend faz polling nesta procedure a cada 3–5 segundos enquanto status = "connecting".
   */
  getStatus: megadeskProcedure
    .input(z.object({ clientId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      if (input.clientId !== ctx.tenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant inválido." });
      const { clientId } = input;
      const instanceName = instanceNameFor(clientId);

      // Primeiro consulta o banco (mais rápido)
      const session = await getSession(clientId);

      // Se banco diz "connected", confirmar ao vivo na Evolution a cada 2 min
      // (evita estado fantasma quando o celular desconecta sem disparar webhook)
      if (session?.status === "connected") {
        const staleSec = session.connectedAt
          ? Math.floor((Date.now() - new Date(session.connectedAt).getTime()) / 1000)
          : 0;
        const needsLiveCheck = staleSec > 120; // revalida a cada 2 minutos

        if (!needsLiveCheck) {
          return {
            ok: true,
            status: "connected" as const,
            phoneNumber: session.phoneNumber ?? null,
            instanceName,
            integrationStatus: "connected" as const,
          };
        }

        // Revalidação ao vivo
        let liveStatus: "connected" | "connecting" | "disconnected";
        try {
          liveStatus = await evoGetStatus(instanceName);
        } catch {
          return { ok: true, status: "connected" as const, phoneNumber: session.phoneNumber ?? null, instanceName, providerReachable: false, integrationStatus: "provider_unavailable" as const };
        }
        if (liveStatus !== "connected") return { ok: true, status: liveStatus, phoneNumber: session.phoneNumber ?? null, instanceName, providerReachable: true, integrationStatus: liveStatus };
        return { ok: true, status: "connected" as const, phoneNumber: session.phoneNumber ?? null, instanceName, providerReachable: true, integrationStatus: "connected" as const };
      }

      // Sem sessão ou status "connecting"/"disconnected" → verifica ao vivo
      let liveStatus: "connected" | "connecting" | "disconnected";
      try {
        liveStatus = await evoGetStatus(instanceName);
      } catch {
        return { ok: true, status: session?.status ?? "disconnected", phoneNumber: session?.phoneNumber ?? null, instanceName, providerReachable: false, integrationStatus: "provider_unavailable" as const };
      }

      return {
        ok: true,
        status: liveStatus,
        phoneNumber: session?.phoneNumber ?? null,
        instanceName,
        providerReachable: true,
        integrationStatus: liveStatus,
      };
    }),

  health: megadeskProcedure
    .input(z.object({ clientId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      if (input.clientId !== ctx.tenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant inválido." });
      const instanceName = instanceNameFor(input.clientId);
      try {
        const [status, webhook] = await Promise.all([
          evoGetStatus(instanceName),
          evoGetWebhookSummary(instanceName),
        ]);
        const requiredEvents = ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"];
        const webhookHealthy = webhook.enabled
          && webhook.url === configuredWebhookUrl()
          && webhook.hasSecretHeader
          && requiredEvents.every(event => webhook.events.includes(event));
        return { providerReachable: true, status, webhookHealthy, repairRecommended: !webhookHealthy,
          integrationStatus: webhookHealthy ? status : "webhook_degraded" as const };
      } catch {
        return { providerReachable: false, status: "unknown" as const, webhookHealthy: false, repairRecommended: true, integrationStatus: "provider_unavailable" as const };
      }
    }),

  repair: megadeskProcedure
    .input(z.object({ clientId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      if (input.clientId !== ctx.tenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant inválido." });
      requireEvolutionAdmin(ctx.operationalUserRole);
      const instanceName = instanceNameFor(input.clientId);
      const operationId = randomUUID();
      const sourceIp = trustedSourceIp(ctx.req);
      const baseAudit = {
        operationId, tenantId: input.clientId, operatorUserId: ctx.operationalUserId!, operatorRole: ctx.operationalUserRole!,
        instanceName, origin: "whatsapp.settings" as const, action: "evolution.repair" as const, sourceIp,
        metadata: { sourceIpStatus: sourceIp ? "recorded" as const : "unavailable" as const },
      };
      try {
        await auditEvolutionAction({ ...baseAudit, phase: "intent" });
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "A tentativa de reparo não pôde ser auditada; nenhuma alteração foi executada." });
      }
      try {
        const status = await evoGetStatus(instanceName);
        const webhook = await setupWebhook(instanceName);
        const qr = status === "connected" ? null : await evoGetQRCode(instanceName);
        await upsertSession(input.clientId, instanceName, status);
        let auditStatus: "complete" | "degraded" = "complete";
        try {
          await auditEvolutionAction({ ...baseAudit, phase: webhook.ok ? "success" : "failure",
            errorCode: webhook.ok ? null : webhook.code,
            metadata: { ...baseAudit.metadata, providerRecovered: true, webhookConfigured: webhook.ok } });
        } catch {
          auditStatus = "degraded";
          console.error("[Evolution] repair final audit failed", { operationId });
        }
        return {
          ok: webhook.ok && auditStatus === "complete", providerRecovered: true, webhookConfigured: webhook.ok,
          auditStatus, integrationStatus: webhook.ok ? (status === "connected" ? "connected" as const : qr ? "qr_required" as const : status) : "webhook_degraded" as const,
          status, qrCode: qr?.base64 ?? null,
        };
      } catch (error) {
        let auditStatus: "complete" | "degraded" = "complete";
        try {
          await auditEvolutionAction({ ...baseAudit, phase: "failure", errorCode: error instanceof EvolutionApiError ? error.code : "REPAIR_FAILED",
            metadata: { ...baseAudit.metadata, providerRecovered: false, webhookConfigured: false } });
        } catch {
          auditStatus = "degraded";
          console.error("[Evolution] repair failure audit failed", { operationId });
        }
        return { ok: false, providerRecovered: false, webhookConfigured: false, auditStatus,
          integrationStatus: "provider_unavailable" as const, status: "unknown" as const, qrCode: null };
      }
    }),

  /**
   * Desconecta o WhatsApp (logout) e limpa a sessão no banco.
   * NÃO deleta a instância na Evolution — apenas desconecta.
   */
  disconnect: megadeskProcedure
    .input(z.object({ clientId: z.string().min(1), confirmation: z.literal("DESCONECTAR") }))
    .mutation(async ({ input, ctx }) => {
      if (input.clientId !== ctx.tenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant inválido." });
      requireEvolutionAdmin(ctx.operationalUserRole);
      const { clientId } = input;
      const instanceName = instanceNameFor(clientId);
      const operationId = randomUUID();
      const sourceIp = trustedSourceIp(ctx.req);
      const baseAudit = {
        operationId, tenantId: clientId, operatorUserId: ctx.operationalUserId!, operatorRole: ctx.operationalUserRole!,
        instanceName, origin: "whatsapp.settings" as const, action: "evolution.logout" as const, sourceIp,
        metadata: { sourceIpStatus: sourceIp ? "recorded" as const : "unavailable" as const },
      };
      try {
        await auditEvolutionAction({ ...baseAudit, phase: "intent" });
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "A intenção de logout não pôde ser auditada; o WhatsApp não foi desconectado." });
      }
      try {
        await evoLogout(instanceName);
        await deleteSession(clientId);
        try {
          await auditEvolutionAction({ ...baseAudit, phase: "success" });
          return { ok: true, auditStatus: "complete" as const, integrationStatus: "disconnected" as const, operationId };
        } catch {
          console.error("[Evolution] logout final audit failed", { operationId });
          return { ok: true, auditStatus: "degraded" as const, integrationStatus: "disconnected" as const, operationId };
        }
      } catch (err: unknown) {
        try {
          await auditEvolutionAction({ ...baseAudit, phase: "failure", errorCode: err instanceof EvolutionApiError ? err.code : "LOGOUT_FAILED" });
        } catch (auditError) {
          console.error("[Evolution] logout failure audit failed", { operationId, reason: auditError instanceof Error ? auditError.message : "unknown" });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Falha ao desconectar; a sessão local foi preservada." });
      }
    }),

  /**
   * Envia mensagem de texto para um número via WhatsApp.
   * Usado internamente por outros routers (conversas, atendimento, etc.).
   */
  sendMessage: megadeskProcedure
    .input(
      z.object({
        clientId:    z.string().min(1),
        phoneNumber: z.string().min(8),
        text:        z.string().min(1).max(4096),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.clientId !== ctx.tenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant inválido." });
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
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Não foi possível enviar a mensagem pelo provedor.",
        });
      }
    }),
});
