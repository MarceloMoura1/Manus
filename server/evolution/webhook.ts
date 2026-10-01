/**
 * Evolution Webhook Handler
 * Recebe eventos da Evolution API e os processa:
 *   - CONNECTION_UPDATE  → atualiza status da sessão
 *   - QRCODE_UPDATED     → notifica frontend via Socket.IO
 *   - MESSAGES_UPSERT    → salva mensagem recebida na conversa
 */

import type { Request, Response } from "express";
import { upsertSession, instanceNameFor } from "./session-store";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { getPool } from "../db";
import { generateConversationPublicCode, withPublicCodeRetry } from "../conversation-public-code";
import { persistCanonicalMessage } from "../conversation-message-store";
import { normalizeProviderMessageReference, type ProviderMessageReference } from "../conversation-provider-reference";
import {
  decodeConversationMediaDataUrl,
  removeConversationMedia,
  type ConversationMediaReferenceV2,
  writeConversationMedia,
} from "../conversation-media-storage";
import { getEvolutionWebhookSecret } from "./config";
import { WriteFreezeError, type PreparedWebhook } from "../write-freeze";
import { evoGetMediaBase64, normalizeEvolutionRecipient } from "./client";
import {
  cleanupExpiredConversationReceipts,
  persistConversationReceipt,
  persistOrApplyConversationReceipt,
  type ConversationReceiptPersistenceResult,
} from "../conversation-receipt-store";

// Socket.IO — importado dinamicamente para evitar dependência circular
export type EvolutionRealtimeDeliveryResult = {
  attempted: boolean;
  succeeded: boolean;
  recipientCount: number;
  candidateCount: number;
  outcome: "delivered" | "partial" | "no_recipients" | "no_eligible_recipients" | "failed";
  failureClass: "SOCKET_DELIVERY_FAILED" | "NO_ELIGIBLE_RECIPIENTS" | null;
};

type OperationalDelivery = { candidates: number; emitted: number; disconnected: number; roleFiltered: number };
type RealtimeAdapterLoader = () => Promise<{
  emitOperationalTenantEventAsync: (clientId: string, event: string, data: unknown) => Promise<OperationalDelivery>;
}>;

export async function emitToClient(
  clientId: string,
  event: string,
  data: unknown,
  loadAdapter: RealtimeAdapterLoader = () => import("../modules/whatsapp/socket/whatsapp.socket"),
): Promise<EvolutionRealtimeDeliveryResult> {
  try {
    const { emitOperationalTenantEventAsync } = await loadAdapter();
    const delivery = await emitOperationalTenantEventAsync(clientId, event, data);
    if (delivery.candidates === 0) {
      return { attempted: false, succeeded: false, recipientCount: 0, candidateCount: 0,
        outcome: "no_recipients", failureClass: null };
    }
    if (delivery.emitted === 0) {
      return { attempted: true, succeeded: false, recipientCount: 0, candidateCount: delivery.candidates,
        outcome: "no_eligible_recipients", failureClass: "NO_ELIGIBLE_RECIPIENTS" };
    }
    const partial = delivery.emitted < delivery.candidates;
    return { attempted: true, succeeded: true, recipientCount: delivery.emitted, candidateCount: delivery.candidates,
      outcome: partial ? "partial" : "delivered", failureClass: null };
  } catch {
    console.error("[Evolution Realtime] Falha ao entregar evento.", { event });
    return { attempted: true, succeeded: false, recipientCount: 0, candidateCount: 0,
      outcome: "failed", failureClass: "SOCKET_DELIVERY_FAILED" };
  }
}

/** Resolve clientId a partir do instanceName (ex: "megadesk-cliente-001" → "cliente-001") */
export async function clientIdFromInstance(instanceName: string): Promise<string | null> {
  const [rows] = await getPool().execute(
    `SELECT s.client_id AS clientId
       FROM megadesk_evolution_sessions s
       JOIN megadesk_domain_clients c ON c.client_id = s.client_id
      WHERE s.instance_name = ? AND c.status = 'active' AND c.access_released = 1
      LIMIT 1`,
    [instanceName],
  ) as any[];
  return rows?.[0]?.clientId ?? null;
}

// ─── Tipos de payload Evolution ──────────────────────────────────────────────

interface EvolutionWebhookPayload {
  event: string;
  instance: string;         // instanceName
  data: Record<string, any>;
}

function secureSecretMatch(received: unknown, expected: string): boolean {
  if (typeof received !== "string") return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function evolutionProviderEventId(data: unknown): string | null {
  const candidates = Array.isArray(data) ? data : [data];
  const ids = candidates.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, any>;
    return [record.id, record.keyId, record.messageId, record.key?.id]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 180)
      .map(value => value.trim());
  });
  return ids.length ? [...new Set(ids)].sort().join(",") : null;
}

export async function prepareEvolutionWebhookSpool(req: Request): Promise<PreparedWebhook> {
  let expected: string;
  try { expected = getEvolutionWebhookSecret(); }
  catch { throw new WriteFreezeError("Evolution webhook indisponível.", "INVALID_WEBHOOK"); }
  if (!secureSecretMatch(req.headers["x-megadesk-webhook-secret"], expected)) {
    throw new WriteFreezeError("Evolution webhook não autenticado.", "INVALID_WEBHOOK");
  }
  const payload = req.body as Partial<EvolutionWebhookPayload>;
  if (typeof payload?.event !== "string" || typeof payload?.instance !== "string"
    || !payload.event.trim() || !payload.instance.trim() || payload.data === null || typeof payload.data !== "object") {
    throw new WriteFreezeError("Payload Evolution inválido.", "INVALID_WEBHOOK");
  }
  const clientId = await clientIdFromInstance(payload.instance);
  if (!clientId) throw new WriteFreezeError("Instância Evolution desconhecida.", "INVALID_WEBHOOK");
  return {
    provider: "evolution",
    event: normalizeEvolutionEvent(payload.event),
    providerEventId: evolutionProviderEventId(payload.data),
    bindings: [{ tenantId: clientId, integrationId: payload.instance }],
  };
}

export function normalizeEvolutionEvent(event: string): string {
  return event.trim().toUpperCase().replace(/[.\-\s]+/g, "_");
}

const EVOLUTION_RECEIPT_STATUS: Record<string, "pending" | "sent" | "delivered" | "read" | "played" | "failed"> = {
  PENDING: "pending",
  SERVER_ACK: "sent",
  SENT: "sent",
  DELIVERY_ACK: "delivered",
  DELIVERED: "delivered",
  READ: "read",
  PLAYED: "played",
  ERROR: "failed",
  FAILED: "failed",
};

export function canonicalEvolutionReceiptStatus(value: unknown): "pending" | "sent" | "delivered" | "read" | "played" | "failed" | null {
  if (typeof value !== "string") return null;
  return EVOLUTION_RECEIPT_STATUS[value.trim().toUpperCase()] ?? null;
}

export function canonicalEvolutionEventTimestamp(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!raw) return null;

  let milliseconds: number;
  if (/^\d{10}$/.test(raw)) {
    milliseconds = Number(raw) * 1_000;
  } else if (/^\d{13}$/.test(raw)) {
    milliseconds = Number(raw);
  } else if (typeof value === "string") {
    milliseconds = Date.parse(raw);
  } else {
    return null;
  }

  const minimum = Date.UTC(2000, 0, 1);
  // MySQL TIMESTAMP tops out in January 2038; reject unpersistable provider values.
  const maximum = Date.UTC(2038, 0, 19);
  if (!Number.isFinite(milliseconds) || milliseconds < minimum || milliseconds >= maximum) return null;
  return new Date(milliseconds).toISOString();
}

/** Supports Evolution's webhook (`keyId` + `status`) and native (`key.id` + `update.status`) update shapes. */
export function parseEvolutionMessageStatusUpdates(data: Record<string, any> | Record<string, any>[]): Array<{ externalMessageId: string; status: "pending" | "sent" | "delivered" | "read" | "played" | "failed"; providerEventAt: string | null }> {
  const candidates = Array.isArray(data)
    ? data
    : Array.isArray(data?.updates)
      ? data.updates
      : Array.isArray(data?.messages)
        ? data.messages
        : [data];
  return candidates.flatMap((item: Record<string, any>) => {
    const externalMessageId = [item?.keyId, item?.messageId, item?.key?.id, item?.id]
      .find((value): value is string => typeof value === "string"
        && value.trim().length > 0 && value.trim().length <= 180)?.trim();
    const status = canonicalEvolutionReceiptStatus(item?.status ?? item?.update?.status);
    const providerEventAt = canonicalEvolutionEventTimestamp(
      item?.timestamp ?? item?.messageTimestamp ?? item?.update?.timestamp ?? item?.update?.messageTimestamp,
    );
    return externalMessageId && status ? [{ externalMessageId, status, providerEventAt }] : [];
  });
}

export function evolutionPhoneCandidates(key: Record<string, any> | undefined): string[] {
  const primary = typeof key?.remoteJid === "string" ? key.remoteJid : "";
  const alternative = typeof key?.remoteJidAlt === "string" ? key.remoteJidAlt : "";
  const jid = primary.endsWith("@lid") && alternative ? alternative : primary || alternative;
  if (!jid || jid.includes("@g.us") || jid.endsWith("@lid")) return [];

  const digits = jid.replace(/@(?:s\.whatsapp\.net|lid)$/, "").replace(/\D/g, "");
  if (!digits) return [];
  let canonical: string;
  try { canonical = normalizeEvolutionRecipient(digits); } catch { return []; }
  const candidates = [canonical, digits];
  if (canonical.startsWith("55") && (canonical.length === 12 || canonical.length === 13)) {
    candidates.push(canonical.slice(2));
  }
  return Array.from(new Set(candidates));
}

// ─── Handler principal ───────────────────────────────────────────────────────

export async function handleEvolutionWebhook(req: Request, res: Response): Promise<void> {
  // Validar segredo exclusivo do webhook.
  let expectedKey: string;
  try {
    expectedKey = getEvolutionWebhookSecret();
  } catch {
    res.status(503).json({ error: "Evolution webhook is not configured" });
    return;
  }
  const receivedKey = req.headers["x-megadesk-webhook-secret"];
  if (!secureSecretMatch(receivedKey, expectedKey)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = req.body as EvolutionWebhookPayload;
    if (!payload?.event || !payload?.instance) {
      res.status(400).json({ error: "Invalid webhook payload" });
      return;
    }

    const clientId = await clientIdFromInstance(payload.instance);
    if (!clientId) {
      res.status(404).json({ error: "Unknown instance" });
      return;
    }
    const event = normalizeEvolutionEvent(payload.event);

    switch (event) {
      case "CONNECTION_UPDATE":
        await handleConnectionUpdate(clientId, payload.instance, payload.data);
        break;

      case "QRCODE_UPDATED":
        await handleQRCodeUpdated(clientId, payload.data);
        break;

      case "MESSAGES_UPSERT":
        {
          const outcome = await handleMessagesUpsert(clientId, payload.instance, payload.data);
          res.status(200).json({ ok: true, outcome });
          return;
        }

      case "MESSAGES_UPDATE":
        await handleMessagesUpdate(clientId, payload.instance, payload.data);
        break;

      default:
        res.status(204).send();
        return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof EvolutionWebhookPayloadError) {
      console.warn("[Evolution Webhook] MESSAGES_UPSERT payload rejected");
      res.status(400).json({ error: "Unprocessable MESSAGES_UPSERT payload" });
      return;
    }
    console.error("[Evolution Webhook] event processing failed");
    res.status(503).json({ error: "Webhook processing failed" });
  }
}

export type EvolutionReceiptTelemetry = {
  event: "evolution_receipt_update";
  status: "pending" | "sent" | "delivered" | "read" | "played" | "failed";
  clientId: string;
  integrationId: string;
  externalMessageIdHash: string;
  receivedAt: string;
  providerEventAt: string | null;
  providerToWebhookMs: number | null;
  persistenceCompletedAt: string;
  webhookToPersistenceMs: number;
  realtimeEmittedAt: string | null;
  persistenceToRealtimeMs: number | null;
  realtimeAttempted: boolean | null;
  realtimeEmitSucceeded: boolean | null;
  realtimeRecipientCount: number | null;
  realtimeOutcome: EvolutionRealtimeDeliveryResult["outcome"] | null;
  realtimeFailureClass: EvolutionRealtimeDeliveryResult["failureClass"];
  affectedRows: number;
  matchedRows: number;
  applied: boolean;
  zeroMatch: boolean;
  deferred: boolean;
  persistenceOutcome: "APPLIED" | "STALE_OR_DUPLICATE" | "RECEIPT_DEFERRED";
  storedStatus: string | null;
};

type ReceiptUpdateDependencies = {
  execute?: (sql: string, values: unknown[]) => Promise<[unknown, unknown?]>;
  emit?: (clientId: string, event: string, data: unknown) => Promise<EvolutionRealtimeDeliveryResult>;
  recordTelemetry?: (telemetry: EvolutionReceiptTelemetry) => void;
  now?: () => Date;
};

export async function handleMessagesUpdate(
  clientId: string,
  integrationId: string,
  data: Record<string, any> | Record<string, any>[],
  dependencies: ReceiptUpdateDependencies = {},
): Promise<void> {
  const execute = dependencies.execute ?? (async (sql: string, values: unknown[]) => (
    getPool().execute(sql, values) as unknown as Promise<[unknown, unknown?]>
  ));
  const emit = dependencies.emit ?? emitToClient;
  const recordTelemetry = dependencies.recordTelemetry ?? ((telemetry: EvolutionReceiptTelemetry) => {
    console.info("[Evolution Receipt]", telemetry);
  });
  const now = dependencies.now ?? (() => new Date());
  const webhookReceivedDate = now();
  const receivedAt = webhookReceivedDate.toISOString();

  for (const update of parseEvolutionMessageStatusUpdates(data)) {
    const receiptInput = {
      clientId,
      provider: "evolution",
      integrationId,
      externalMessageId: update.externalMessageId,
      status: update.status,
      providerEventAt: update.providerEventAt,
      receivedAt: webhookReceivedDate,
    } as const;
    let persistence: ConversationReceiptPersistenceResult;
    if (dependencies.execute) {
      persistence = await persistOrApplyConversationReceipt({ execute }, receiptInput);
    } else {
      persistence = await persistConversationReceipt(getPool(), receiptInput);
      if (persistence.deferred) {
        await cleanupExpiredConversationReceipts(getPool()).catch(() => {
          console.warn("[Evolution Receipt] bounded expiry cleanup failed");
        });
      }
    }
    const { affectedRows, matchedRows, applied, deferred, zeroMatch, storedStatus } = persistence;
    const persistenceCompletedDate = now();
    let realtimeEmittedAt: string | null = null;
    let realtimeAttempted: boolean | null = null;
    let realtimeEmitSucceeded: boolean | null = null;
    let realtimeRecipientCount: number | null = null;
    let realtimeOutcome: EvolutionRealtimeDeliveryResult["outcome"] | null = null;
    let realtimeFailureClass: EvolutionRealtimeDeliveryResult["failureClass"] = null;

    if (applied) {
      try {
        const delivery = await emit(clientId, "conversation:receipt", {
          clientId,
          status: update.status,
          receivedAt,
        });
        realtimeAttempted = delivery.attempted;
        realtimeEmitSucceeded = delivery.succeeded;
        realtimeRecipientCount = delivery.recipientCount;
        realtimeOutcome = delivery.outcome;
        realtimeFailureClass = delivery.failureClass;
      } catch {
        realtimeAttempted = true;
        realtimeEmitSucceeded = false;
        realtimeRecipientCount = 0;
        realtimeOutcome = "failed";
        realtimeFailureClass = "SOCKET_DELIVERY_FAILED";
      }
      realtimeEmittedAt = now().toISOString();
    }

    const providerEventTime = update.providerEventAt === null ? null : Date.parse(update.providerEventAt);
    const realtimeEmittedTime = realtimeEmittedAt === null ? null : Date.parse(realtimeEmittedAt);
    const telemetry: EvolutionReceiptTelemetry = {
      event: "evolution_receipt_update",
      status: update.status,
      clientId,
      integrationId,
      externalMessageIdHash: createHash("sha256").update(update.externalMessageId).digest("hex"),
      receivedAt,
      providerEventAt: update.providerEventAt,
      providerToWebhookMs: providerEventTime === null ? null : webhookReceivedDate.getTime() - providerEventTime,
      persistenceCompletedAt: persistenceCompletedDate.toISOString(),
      webhookToPersistenceMs: persistenceCompletedDate.getTime() - webhookReceivedDate.getTime(),
      realtimeEmittedAt,
      persistenceToRealtimeMs: realtimeEmittedTime === null ? null : realtimeEmittedTime - persistenceCompletedDate.getTime(),
      realtimeAttempted,
      realtimeEmitSucceeded,
      realtimeRecipientCount,
      realtimeOutcome,
      realtimeFailureClass,
      affectedRows,
      matchedRows,
      applied,
      zeroMatch,
      deferred,
      persistenceOutcome: deferred ? "RECEIPT_DEFERRED" : applied ? "APPLIED" : "STALE_OR_DUPLICATE",
      storedStatus,
    };
    recordTelemetry(telemetry);
  }
}

// ─── CONNECTION_UPDATE ───────────────────────────────────────────────────────

async function handleConnectionUpdate(
  clientId: string,
  instanceName: string,
  data: Record<string, any>
): Promise<void> {
  const state: string = data?.state || data?.connection || "";
  const phoneNumber: string | null = data?.wuid?.replace(/@s\.whatsapp\.net$/, "") || null;

  // "open"       → conectado
  // "connecting" → aguardando QR / reconectando
  // "close"      → DESCONECTADO (não "connecting"!)
  // demais       → desconectado
  let status: "disconnected" | "connecting" | "connected";
  if (state === "open")        status = "connected";
  else if (state === "connecting") status = "connecting";
  else                         status = "disconnected"; // close, logout, conflict, etc.

  await upsertSession(clientId, instanceName, status, phoneNumber);

  console.log(`[Evolution] tenant session status updated: clientId=${clientId} status=${status}`);

  // Notifica o frontend em tempo real
  await emitToClient(clientId, "whatsapp:status", {
    clientId,
    status,
    phoneNumber: phoneNumber || null,
  });
}

// ─── QRCODE_UPDATED ──────────────────────────────────────────────────────────

async function handleQRCodeUpdated(
  clientId: string,
  data: Record<string, any>
): Promise<void> {
  const raw: string =
    data?.qrcode?.base64 ||
    data?.base64 ||
    data?.qrcode ||
    "";

  if (!raw) return;

  const base64 = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;

  // Atualiza status para "connecting" no banco
  const instanceName = instanceNameFor(clientId);
  await upsertSession(clientId, instanceName, "connecting");

  // Envia o QR atualizado ao frontend via socket (útil se o QR expirou e foi regenerado)
  await emitToClient(clientId, "whatsapp:qrcode", { clientId, base64 });
}

// ─── MESSAGES_UPSERT ─────────────────────────────────────────────────────────

type InboundMessagesUpsertOutcome = "persisted" | "duplicate" | "ignored";

class EvolutionWebhookPayloadError extends Error {}

function isEvolutionMessageRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEvolutionMessageEnvelope(value: unknown): value is Record<string, any> {
  return isEvolutionMessageRecord(value)
    && isEvolutionMessageRecord(value.key)
    && isEvolutionMessageRecord(value.message);
}

export function normalizeMessagesUpsertPayload(data: unknown): Record<string, any>[] {
  if (!isEvolutionMessageRecord(data)) {
    throw new EvolutionWebhookPayloadError("MESSAGES_UPSERT data must be an object");
  }
  if (Array.isArray(data.messages)) {
    if (!data.messages.length || !data.messages.every(isEvolutionMessageEnvelope)) {
      throw new EvolutionWebhookPayloadError("MESSAGES_UPSERT messages must contain key and message objects");
    }
    return data.messages;
  }
  if (isEvolutionMessageEnvelope(data.messages)) return [data.messages];
  if (isEvolutionMessageEnvelope(data)) return [data];
  throw new EvolutionWebhookPayloadError("MESSAGES_UPSERT message envelope is unsupported");
}

const EVOLUTION_MESSAGE_WRAPPERS = [
  "ephemeralMessage",
  "documentWithCaptionMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
] as const;

/**
 * Baileys wraps some real media (notably iOS audio and view-once messages) in
 * one or more container messages. Keep the original envelope for provider
 * downloads/quotes, but inspect the innermost content for MegaDesk metadata.
 */
export function unwrapEvolutionMessageContent(value: unknown): Record<string, any> {
  let content = isEvolutionMessageRecord(value) ? value : {};
  const visited = new Set<Record<string, any>>();
  for (let depth = 0; depth < 8 && !visited.has(content); depth += 1) {
    visited.add(content);
    const wrapper = EVOLUTION_MESSAGE_WRAPPERS
      .map(key => content[key])
      .find(candidate => isEvolutionMessageRecord(candidate) && isEvolutionMessageRecord(candidate.message));
    if (!wrapper) break;
    content = wrapper.message;
  }
  return content;
}

/** Provider download endpoint needs the real typed message, not a Baileys wrapper. */
export function evolutionMediaDownloadEnvelope(message: Record<string, any>): Record<string, any> {
  const content = unwrapEvolutionMessageContent(message.message);
  return content === message.message ? message : { ...message, message: content };
}

async function handleMessagesUpsert(
  clientId: string,
  instanceName: string,
  data: unknown,
): Promise<InboundMessagesUpsertOutcome> {
  // Evolution pode enviar "messages" como array ou objeto único
  const messages = normalizeMessagesUpsertPayload(data);
  let persisted = 0;
  let duplicate = 0;

  for (const msg of messages) {
    // Ignorar mensagens enviadas por nós (fromMe)
    if (msg?.key?.fromMe) continue;

    const phoneCandidates = evolutionPhoneCandidates(msg?.key);
    if (!phoneCandidates.length) continue;

    // Extrai texto, mídia e contatos. Com webhookBase64=true, a Evolution inclui
    // o binário para persistência compartilhada no banco do tenant.
    const parsed = parseEvolutionIncomingMessage(msg);
    if (!parsed) continue;
    const { text, payload } = parsed;
    if (payload.type !== "text" && payload.type !== "contact" && !payload.mediaData) {
      try {
        const downloaded = await evoGetMediaBase64(instanceName, evolutionMediaDownloadEnvelope(msg));
        const mimeType = downloaded.mimetype || String(payload.mimeType || "application/octet-stream");
        payload.mediaData = downloaded.base64.startsWith("data:")
          ? downloaded.base64
          : `data:${mimeType};base64,${downloaded.base64}`;
        payload.mimeType = mimeType;
        payload.fileName = downloaded.fileName || payload.fileName;
      } catch {
        console.error(`[Evolution Webhook] media download failed: instance=${instanceName} messageId=${String(msg?.key?.id || "unknown")}`);
      }
    }

    // Evolution entrega o nome de perfil do remetente no campo oficial
     // `pushName` do item de messages.upsert. Não fazemos nenhuma consulta
     // paralela ao provider para obter esse dado.
     const pushName = extractEvolutionProviderName(msg);
    const now = new Date();

    const externalMessageId = msg?.key?.id;
    if (!externalMessageId || typeof externalMessageId !== "string") continue;
    const saved = await saveIncomingMessage(clientId, instanceName, externalMessageId, phoneCandidates, pushName, text, now, payload, {
      providerMessageReference: normalizeProviderMessageReference({ key: msg.key, message: msg.message }),
      quotedExternalMessageId: extractEvolutionQuotedExternalMessageId(msg),
    });
    if (saved === "persisted") persisted += 1;
    else duplicate += 1;
  }
  return persisted ? "persisted" : duplicate ? "duplicate" : "ignored";
}

export function parseEvolutionIncomingMessage(msg: Record<string, any>): { text: string; payload: Record<string, unknown> } | null {
  const messageRoot = isEvolutionMessageRecord(msg?.message) ? msg.message : {};
  const content = unwrapEvolutionMessageContent(messageRoot);
  const image = content.imageMessage;
  const video = content.videoMessage || content.ptvMessage;
  const audio = content.audioMessage;
  const document = content.documentMessage;
  const sticker = content.stickerMessage;
  const contact = content.contactMessage;
  const contacts = content.contactsArrayMessage;
  const textualContent: string = content.conversation || content.extendedTextMessage?.text ||
    image?.caption || video?.caption || document?.caption || "";
  const mediaNode = image || video || audio || document || sticker;
  // Na Evolution 2.3.7 com webhookBase64=true, o binário chega como irmão do
  // imageMessage/audioMessage/etc. dentro de `message.base64`.
  const rawBase64 = mediaNode?.base64 || content.base64 || messageRoot.base64 || msg?.base64 || msg?.data?.base64 || "";
  const mimeType = mediaNode?.mimetype || mediaNode?.mimeType || mediaNode?.mime_type || "";
  const type = image ? "image" : video ? "video" : audio ? "audio" : document ? "document" :
    sticker ? "sticker" : contact || contacts ? "contact" : "text";
  const text: string = textualContent || (audio ? "[Áudio]" : image ? "[Imagem]" : video ? "[Vídeo]" :
    document ? "[Documento]" : sticker ? "[Figurinha]" : contact || contacts ? "[Contato]" : "");
  if (!text) return null;
  const contactPayload = contact ? { name: contact.displayName || "Contato", vcard: contact.vcard || "" } : contacts ? {
    name: contacts.displayName || "Contatos",
    vcard: (contacts.contacts || []).map((item: any) => item.vcard || "").filter(Boolean).join("\n"),
  } : undefined;
  const mediaData = rawBase64 ? (String(rawBase64).startsWith("data:") ? String(rawBase64) :
    `data:${mimeType || "application/octet-stream"};base64,${rawBase64}`) : undefined;
  return { text, payload: {
    type, mediaData, mimeType: mimeType || undefined,
    fileName: mediaNode?.fileName || mediaNode?.filename || undefined,
    contact: contactPayload,
  } };
}

type ConversationMediaWriter = typeof writeConversationMedia;
type ConversationMediaRemover = typeof removeConversationMedia;
type InboundMediaDependencies = { write?: ConversationMediaWriter; remove?: ConversationMediaRemover };

/**
 * Converts the provider's transient media payload into V2 metadata. This is the
 * only inbound boundary allowed to see a Data URL; callers persist `reference`,
 * never `payload.mediaData`.
 */
export async function prepareInboundConversationMedia(
  clientId: string,
  payload: Record<string, unknown>,
  write: ConversationMediaWriter = writeConversationMedia,
): Promise<{ payload: Record<string, unknown>; reference: ConversationMediaReferenceV2 | null }> {
  const { mediaData: _mediaData, base64: _base64, dataUrl: _dataUrl, ...safePayload } = payload;
  if (typeof _mediaData !== "string") return { payload: safePayload, reference: null };
  const inferredMime = /^data:([^;,]+);base64,/.exec(_mediaData)?.[1] ?? "";
  const declaredMime = typeof payload.mimeType === "string" ? payload.mimeType : inferredMime;
  const decoded = decodeConversationMediaDataUrl(_mediaData, declaredMime);
  if (!decoded) throw new Error("INBOUND_CONVERSATION_MEDIA_INVALID");
  const reference = await write({
    clientId,
    bytes: decoded.bytes,
    mimeType: decoded.mimeType,
    fileName: typeof payload.fileName === "string" ? payload.fileName : undefined,
  });
  return { payload: safePayload, reference };
}

/** Nome de perfil já entregue pelo payload inbound oficial da Evolution. */
export function extractEvolutionProviderName(msg: Record<string, any>): string {
  const value = typeof msg?.pushName === "string" ? msg.pushName : "";
  return value.trim().replace(/\s+/g, " ").slice(0, 180);
}

/** Evolution 2.3.7 prepares contextInfo at the message root; raw fixtures may retain it inside the typed message. */
export function extractEvolutionQuotedExternalMessageId(msg: Record<string, any>): string | null {
  const message = msg?.message && typeof msg.message === "object" ? msg.message : {};
  const contexts = [
    msg?.contextInfo,
    msg?.message?.extendedTextMessage?.contextInfo,
    ...Object.values(message as Record<string, any>).map((value: any) => value?.contextInfo),
  ];
  for (const context of contexts) {
    const stanzaId = typeof context?.stanzaId === "string" ? context.stanzaId.trim() : "";
    if (stanzaId) return stanzaId;
  }
  return null;
}

/**
 * Manual/ERP names are authoritative. A provider name can only fill an empty
 * lightweight contact (including the historical phone/placeholder values).
 */
export function selectInboundContactName(existingDisplayName: string | null | undefined, providerName: string, phone: string): string {
  const existing = String(existingDisplayName ?? "").trim();
  const normalizedProvider = providerName.trim().replace(/\s+/g, " ").slice(0, 180);
  if (existing && existing !== `+${phone}` && existing !== "Contato sem nome") return existing;
  return normalizedProvider || existing || "Contato sem nome";
}

// ─── Salvar mensagem recebida no banco ───────────────────────────────────────

export async function saveIncomingMessage(
  clientId: string,
  integrationId: string,
  externalMessageId: string,
  phoneCandidates: string[],
  pushName: string,
  text: string,
  at: Date,
  payload: Record<string, unknown> = {},
  references: { providerMessageReference?: ProviderMessageReference | null; quotedExternalMessageId?: string | null } = {},
  mediaDependencies: InboundMediaDependencies = {},
): Promise<"persisted" | "duplicate"> {
  const phone = phoneCandidates[0];
  const pool = getPool();
  const connection = await pool.getConnection();
  let lockName: string | null = null;
  let transactionStarted = false;
  let storedMediaReference: ConversationMediaReferenceV2 | null = null;
  let committedEvent: { name: "conversation:message" | "conversation:new"; payload: Record<string, unknown> } | null = null;

  try {
    // The canonical phone lock is acquired before any mutable contact/conversation work.
    // This gives retries and concurrent first messages one protected re-query region.
    const phoneLockKey = createHash("sha256").update(`${clientId}\0evolution\0${integrationId}\0${phone}`).digest("hex").slice(0, 54);
    lockName = `mdc-phone:${phoneLockKey}`;
    const [lockRows] = await connection.execute("SELECT GET_LOCK(?, 10) AS acquired", [lockName]) as any[];
    if (Number(lockRows?.[0]?.acquired) !== 1) throw new Error("ATTENDANCE_LOCK_TIMEOUT");
    await connection.beginTransaction();
    transactionStarted = true;
    const [duplicateRows] = await connection.execute(
      `SELECT message_id FROM megadesk_domain_conversations_messages
       WHERE client_id = ? AND provider = 'evolution' AND integration_id = ? AND external_message_id = ? LIMIT 1 FOR UPDATE`,
      [clientId, integrationId, externalMessageId],
    ) as any[];
    if (duplicateRows.length) {
      await connection.rollback();
      transactionStarted = false;
      return "duplicate";
    }
    const preparedMedia = await prepareInboundConversationMedia(clientId, payload, mediaDependencies.write ?? writeConversationMedia);
    payload = preparedMedia.payload;
    storedMediaReference = preparedMedia.reference;
    const contactName = pushName || "Contato sem nome";
    await connection.execute(
      `INSERT INTO megadesk_conversation_contacts
       (contact_id, client_id, display_name, canonical_phone, channel, provider, external_identity)
       VALUES (?, ?, ?, ?, 'whatsapp', 'evolution', ?)
       ON DUPLICATE KEY UPDATE display_name = CASE
         WHEN crm_client_id IS NULL AND (display_name IS NULL OR TRIM(display_name) = ''
           OR display_name = CONCAT('+', canonical_phone)
           OR display_name = 'Contato sem nome')
         THEN VALUES(display_name)
         ELSE display_name
       END`,
      [`contact-${randomUUID()}`, clientId, contactName, phone, phone],
    );
    const [contactRows] = await connection.execute(
      `SELECT contact_id FROM megadesk_conversation_contacts
       WHERE client_id = ? AND channel = 'whatsapp' AND provider = 'evolution' AND external_identity = ? LIMIT 1`,
      [clientId, phone],
    ) as any[];
    const contactId = contactRows[0].contact_id as string;
    const activeKey = createHash("sha256").update(`${clientId}\0evolution\0${integrationId}\0${contactId}`).digest("hex");
    // 1. Busca conversa existente pelo telefone
    const [convRows] = await connection.execute(
      `SELECT conversation_id, messages_json, customer_name
       FROM megadesk_domain_conversations
       WHERE client_id = ? AND status IN ('open', 'bot')
         AND (active_key = ? OR (active_key IS NULL AND phone IN (?, ?, ?)))
       ORDER BY created_at DESC
       LIMIT 1 FOR UPDATE`,
      [clientId, activeKey, phoneCandidates[0], phoneCandidates[1] ?? phoneCandidates[0], phoneCandidates[2] ?? phoneCandidates[0]]
    ) as any[];

    const newMsg = {
      from: "customer" as const,
      text,
      time: at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      timestamp: at.toISOString(),
      ...payload,
    };

    const resolveReplyToMessageId = async (conversationId: string): Promise<string | null> => {
      if (!references.quotedExternalMessageId) return null;
      const [rows] = await connection.execute(
        `SELECT message_id FROM megadesk_domain_conversations_messages
         WHERE client_id = ? AND conversation_id = ? AND provider = 'evolution'
           AND integration_id = ? AND external_message_id = ? LIMIT 1`,
        [clientId, conversationId, integrationId, references.quotedExternalMessageId],
      ) as any[];
      return typeof rows[0]?.message_id === "string" ? rows[0].message_id : null;
    };

    if (convRows && convRows.length > 0) {
      // ─── Conversa existente: adiciona mensagem ───────────────────────────
      const conv      = convRows[0];
      const convId    = conv.conversation_id;
      const replyToMessageId = await resolveReplyToMessageId(convId);
      const inserted = await persistCanonicalMessage(connection, {
        messageId: externalMessageId, externalMessageId, conversationId: convId, clientId,
        provider: "evolution", integrationId, direction: "inbound", messageType: String(payload.type ?? "text"),
        sender: "customer", text, status: "received", timestamp: at, legacyMessage: newMsg,
        mediaReference: storedMediaReference ?? (payload.type === "text" ? null : payload),
        replyToMessageId, providerMessageReference: references.providerMessageReference ?? null,
        incrementUnread: true,
      });
      if (!inserted) {
        await connection.rollback();
        transactionStarted = false;
        if (storedMediaReference) await (mediaDependencies.remove ?? removeConversationMedia)({ clientId, reference: storedMediaReference }).catch(() => undefined);
        storedMediaReference = null;
        return "duplicate";
      }

      committedEvent = { name: "conversation:message", payload: {
        conversationId: convId,
        clientId,
        message: newMsg,
      } };
    } else {
      // ─── Nova conversa ───────────────────────────────────────────────────
      const customerName = contactName;
      const conversationId = `conv-${randomUUID()}`;
      let publicCode = "";

      publicCode = await withPublicCodeRetry(async (candidate) => {
          publicCode = candidate;
          await connection.execute(
          `INSERT INTO megadesk_domain_conversations
          (conversation_id, client_id, public_code, origin, channel, provider, integration_id,
           contact_id, active_key, customer_name, phone, company, status, last_message, last_message_from, time_label,
           messages_json, unread_count, opened_at)
         VALUES (?, ?, ?, 'inbound', 'whatsapp', 'evolution', ?, ?, ?, ?, ?, '', 'bot', ?, 'customer', ?, ?, 1, NOW())`,
         [conversationId, clientId, publicCode, integrationId, contactId, activeKey, customerName, phone,
          text.substring(0, 255), newMsg.time, "[]"],
          );
          return candidate;
      }, { generate: () => generateConversationPublicCode(at) });

      const inserted = await persistCanonicalMessage(connection, {
        messageId: externalMessageId, externalMessageId, conversationId, clientId,
        provider: "evolution", integrationId, direction: "inbound", messageType: String(payload.type ?? "text"),
        sender: "customer", text, status: "received", timestamp: at, legacyMessage: newMsg,
        mediaReference: storedMediaReference ?? (payload.type === "text" ? null : payload),
        providerMessageReference: references.providerMessageReference ?? null,
        incrementUnread: true,
      });
      if (!inserted) {
        await connection.rollback();
        transactionStarted = false;
        if (storedMediaReference) await (mediaDependencies.remove ?? removeConversationMedia)({ clientId, reference: storedMediaReference }).catch(() => undefined);
        storedMediaReference = null;
        return "duplicate";
      }

      // Garante status BOT (primeiro atendimento automático) e campos extras
      await connection.execute(
        `UPDATE megadesk_domain_conversations
         SET last_message_from = 'customer',
             unread_count = 1,
             status = 'bot'
         WHERE conversation_id = ? AND client_id = ?`,
        [conversationId, clientId]
      );
      await connection.execute(
        `INSERT INTO megadesk_conversation_events
         (event_id, client_id, conversation_id, event_type, anchor_message_id, timeline_anchor_kind, metadata_json)
         VALUES (?, ?, ?, 'created_inbound', ?, 'message', '{"queue":"bot"}')`,
        [`event-${randomUUID()}`, clientId, conversationId, externalMessageId],
      );

      committedEvent = { name: "conversation:new", payload: {
        clientId,
        conversation: {
          id:           conversationId,
          name:         customerName,
          phone,
          company:      "",
          status:       "bot",
          publicCode,
          lastMessage:  text.substring(0, 255),
          unreadCount:  1,
          lastMessageFrom: "customer",
        },
      } };
    }
    await connection.commit();
    transactionStarted = false;
    if (committedEvent) await emitToClient(clientId, committedEvent.name, committedEvent.payload);
    return "persisted";
  } catch (err) {
    if (transactionStarted) await connection.rollback().catch(() => undefined);
    if (storedMediaReference) await (mediaDependencies.remove ?? removeConversationMedia)({ clientId, reference: storedMediaReference }).catch(() => undefined);
    console.error(`[Evolution] incoming message persistence failed: clientId=${clientId}`);
    throw err;
  } finally {
    if (lockName) await connection.execute("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
    connection.release();
  }
}

