/**
 * Evolution Webhook Handler
 * Recebe eventos da Evolution API e os processa:
 *   - CONNECTION_UPDATE  → atualiza status da sessão
 *   - QRCODE_UPDATED     → notifica frontend via Socket.IO
 *   - MESSAGES_UPSERT    → salva mensagem recebida na conversa
 */

import type { Request, Response } from "express";
import { upsertSession, instanceNameFor } from "./session-store";
import { createHash, randomUUID } from "node:crypto";
import { getPool } from "../db";
import { generateConversationPublicCode, withPublicCodeRetry } from "../conversation-public-code";
import { persistCanonicalMessage } from "../conversation-message-store";
import { getEvolutionWebhookSecret } from "./config";
import { evoGetMediaBase64, normalizeEvolutionRecipient } from "./client";

// Socket.IO — importado dinamicamente para evitar dependência circular
async function emitToClient(clientId: string, event: string, data: unknown) {
  try {
    const { getSocketIO } = await import("../modules/whatsapp/socket/whatsapp.socket");
    const io = getSocketIO();
    if (io) io.to(`client:${clientId}`).emit(event, data);
  } catch {
    // socket não disponível
  }
}

/** Resolve clientId a partir do instanceName (ex: "megadesk-cliente-001" → "cliente-001") */
async function clientIdFromInstance(instanceName: string): Promise<string | null> {
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

export function normalizeEvolutionEvent(event: string): string {
  return event.trim().toUpperCase().replace(/[.\-\s]+/g, "_");
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
  const receivedKey = req.headers["x-megadesk-webhook-secret"] as string;
  if (!receivedKey || receivedKey !== expectedKey) {
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
        await handleMessagesUpsert(clientId, payload.instance, payload.data);
        break;

      default:
        res.status(204).send();
        return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[Evolution Webhook] event processing failed");
    res.status(503).json({ error: "Webhook processing failed" });
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

async function handleMessagesUpsert(
  clientId: string,
  instanceName: string,
  data: Record<string, any>
): Promise<void> {
  // Evolution pode enviar "messages" como array ou objeto único
  const messages: any[] = Array.isArray(data?.messages)
    ? data.messages
    : data?.message
    ? [data]
    : [];

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
        const downloaded = await evoGetMediaBase64(instanceName, msg);
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

    const pushName: string = msg?.pushName || "";
    const now = new Date();

    const externalMessageId = msg?.key?.id;
    if (!externalMessageId || typeof externalMessageId !== "string") continue;
    await saveIncomingMessage(clientId, instanceName, externalMessageId, phoneCandidates, pushName, text, now, payload);
  }
}

export function parseEvolutionIncomingMessage(msg: Record<string, any>): { text: string; payload: Record<string, unknown> } | null {
  const image = msg?.message?.imageMessage;
  const video = msg?.message?.videoMessage;
  const audio = msg?.message?.audioMessage;
  const document = msg?.message?.documentMessage;
  const sticker = msg?.message?.stickerMessage;
  const contact = msg?.message?.contactMessage;
  const contacts = msg?.message?.contactsArrayMessage;
  const textualContent: string = msg?.message?.conversation || msg?.message?.extendedTextMessage?.text ||
    image?.caption || video?.caption || document?.caption || "";
  const mediaNode = image || video || audio || document || sticker;
  // Na Evolution 2.3.7 com webhookBase64=true, o binário chega como irmão do
  // imageMessage/audioMessage/etc. dentro de `message.base64`.
  const rawBase64 = mediaNode?.base64 || msg?.message?.base64 || msg?.base64 || msg?.data?.base64 || "";
  const mimeType = mediaNode?.mimetype || mediaNode?.mimeType || "";
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
    fileName: document?.fileName || document?.filename || undefined,
    contact: contactPayload,
  } };
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
): Promise<"persisted" | "duplicate"> {
  const phone = phoneCandidates[0];
  const pool = getPool();
  const connection = await pool.getConnection();
  let lockName: string | null = null;
  let transactionStarted = false;
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
    const contactName = pushName || `+${phone}`;
    await connection.execute(
      `INSERT INTO megadesk_conversation_contacts
       (contact_id, client_id, display_name, canonical_phone, channel, provider, external_identity)
       VALUES (?, ?, ?, ?, 'whatsapp', 'evolution', ?)
       ON DUPLICATE KEY UPDATE display_name = COALESCE(NULLIF(VALUES(display_name), ''), display_name)`,
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

    if (convRows && convRows.length > 0) {
      // ─── Conversa existente: adiciona mensagem ───────────────────────────
      const conv      = convRows[0];
      const convId    = conv.conversation_id;
      const inserted = await persistCanonicalMessage(connection, {
        messageId: externalMessageId, externalMessageId, conversationId: convId, clientId,
        provider: "evolution", integrationId, direction: "inbound", messageType: String(payload.type ?? "text"),
        sender: "customer", text, status: "received", timestamp: at, legacyMessage: newMsg,
        mediaReference: payload.type === "text" ? null : payload,
        incrementUnread: true,
      });
      if (!inserted) {
        await connection.rollback();
        transactionStarted = false;
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

      // Garante que o contato existe
      await connection.execute(
        `INSERT INTO megadesk_domain_customers (customerId, clientId, name, phone, company)
         VALUES (?, ?, ?, ?, '')
         ON DUPLICATE KEY UPDATE name = COALESCE(NULLIF(VALUES(name), ''), name)`,
        [`cust-${randomUUID()}`, clientId, customerName, phone],
      );

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
        mediaReference: payload.type === "text" ? null : payload,
        incrementUnread: true,
      });
      if (!inserted) {
        await connection.rollback();
        transactionStarted = false;
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
         (event_id, client_id, conversation_id, event_type, metadata_json)
         VALUES (?, ?, ?, 'created_inbound', '{"queue":"bot"}')`,
        [`event-${randomUUID()}`, clientId, conversationId],
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
    console.error(`[Evolution] incoming message persistence failed: clientId=${clientId}`);
    throw err;
  } finally {
    if (lockName) await connection.execute("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
    connection.release();
  }
}

