/**
 * Evolution Webhook Handler
 * Recebe eventos da Evolution API e os processa:
 *   - CONNECTION_UPDATE  → atualiza status da sessão
 *   - QRCODE_UPDATED     → notifica frontend via Socket.IO
 *   - MESSAGES_UPSERT    → salva mensagem recebida na conversa
 */

import type { Request, Response } from "express";
import { upsertSession, instanceNameFor } from "./session-store";
import { randomUUID } from "node:crypto";
import { getPool } from "../db";
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
  if (!jid || jid.includes("@g.us")) return [];

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
        // Eventos ignorados (MESSAGES_UPDATE, PRESENCE_UPDATE, etc.)
        break;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[Evolution Webhook] event processing failed");
    res.status(500).json({ error: "Webhook processing failed" });
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
    await saveIncomingMessage(clientId, externalMessageId, phoneCandidates, pushName, text, now, payload);
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

async function saveIncomingMessage(
  clientId: string,
  externalMessageId: string,
  phoneCandidates: string[],
  pushName: string,
  text: string,
  at: Date,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const phone = phoneCandidates[0];
  const pool = getPool();
  const connection = await pool.getConnection();
  const lockName = `evo:${clientId}:${phone}`.slice(0, 64);

  try {
    await connection.execute("SELECT GET_LOCK(?, 10)", [lockName]);
    await connection.beginTransaction();
    // 1. Busca conversa existente pelo telefone
    const [convRows] = await connection.execute(
      `SELECT conversation_id, messages_json, customer_name
       FROM megadesk_domain_conversations
       WHERE client_id = ? AND phone IN (?, ?, ?)
       ORDER BY created_at DESC
       LIMIT 1 FOR UPDATE`,
      [clientId, phoneCandidates[0], phoneCandidates[1] ?? phoneCandidates[0], phoneCandidates[2] ?? phoneCandidates[0]]
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
      let   messages: any[] = [];

      try { messages = JSON.parse(conv.messages_json || "[]"); } catch { messages = []; }
      messages.push(newMsg);

      // Atualiza mensagens — mantém status atual (bot ou open), não sobrescreve
      const [insertResult] = await connection.execute(
        `INSERT IGNORE INTO megadesk_domain_conversations_messages
           (message_id, conversation_id, sender, message, timestamp, status)
         VALUES (?, ?, 'customer', ?, ?, 'received')`,
        [externalMessageId, convId, text, at],
      ) as any[];
      if (!insertResult.affectedRows) {
        await connection.rollback();
        return;
      }

      await connection.execute(
        `UPDATE megadesk_domain_conversations
         SET messages_json     = ?,
             last_message      = ?,
             last_message_from = 'customer',
             unread_count      = unread_count + 1,
             updated_at        = NOW()
         WHERE conversation_id = ? AND client_id = ?`,
        [JSON.stringify(messages), text.substring(0, 255), convId, clientId]
      );

      await emitToClient(clientId, "conversation:message", {
        conversationId: convId,
        clientId,
        message: newMsg,
      });
    } else {
      // ─── Nova conversa ───────────────────────────────────────────────────
      const customerName = pushName || `+${phone}`;
      const conversationId = `conv-${randomUUID()}`;

      // Garante que o contato existe
      await connection.execute(
        `INSERT INTO megadesk_domain_customers (customerId, clientId, name, phone, company)
         VALUES (?, ?, ?, ?, '')
         ON DUPLICATE KEY UPDATE name = COALESCE(NULLIF(VALUES(name), ''), name)`,
        [`cust-${randomUUID()}`, clientId, customerName, phone],
      );

      await connection.execute(
        `INSERT INTO megadesk_domain_conversations
          (conversation_id, client_id, customer_name, phone, company, status, last_message,
           last_message_from, time_label, messages_json, unread_count)
         VALUES (?, ?, ?, ?, '', 'open', ?, 'customer', ?, ?, 1)`,
        [conversationId, clientId, customerName, phone, text.substring(0, 255), newMsg.time, JSON.stringify([newMsg])],
      );

      await connection.execute(
        `INSERT INTO megadesk_domain_conversations_messages
           (message_id, conversation_id, sender, message, timestamp, status)
         VALUES (?, ?, 'customer', ?, ?, 'received')`,
        [externalMessageId, conversationId, text, at],
      );

      // Garante status BOT (primeiro atendimento automático) e campos extras
      await connection.execute(
        `UPDATE megadesk_domain_conversations
         SET last_message_from = 'customer',
             unread_count = 1,
             status = 'open'
         WHERE conversation_id = ? AND client_id = ?`,
        [conversationId, clientId]
      );

      await emitToClient(clientId, "conversation:new", {
        clientId,
        conversation: {
          id:           conversationId,
          name:         customerName,
          phone,
          company:      "",
          status:       "open",
          lastMessage:  text.substring(0, 255),
          unreadCount:  1,
          lastMessageFrom: "customer",
        },
      });
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback().catch(() => undefined);
    console.error(`[Evolution] incoming message persistence failed: clientId=${clientId}`);
  } finally {
    await connection.execute("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
    connection.release();
  }
}

