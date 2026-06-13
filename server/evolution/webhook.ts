/**
 * Evolution Webhook Handler
 * Recebe eventos da Evolution API e os processa:
 *   - CONNECTION_UPDATE  → atualiza status da sessão
 *   - QRCODE_UPDATED     → notifica frontend via Socket.IO
 *   - MESSAGES_UPSERT    → salva mensagem recebida na conversa
 */

import type { Request, Response } from "express";
import { upsertSession, instanceNameFor } from "./session-store";
import { getPool, getDb, searchCustomerByPhone, createCustomer, createConversation } from "../db";

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
function clientIdFromInstance(instanceName: string): string {
  return instanceName.replace(/^megadesk-/, "");
}

// ─── Tipos de payload Evolution ──────────────────────────────────────────────

interface EvolutionWebhookPayload {
  event: string;
  instance: string;         // instanceName
  data: Record<string, any>;
}

// ─── Handler principal ───────────────────────────────────────────────────────

export async function handleEvolutionWebhook(req: Request, res: Response): Promise<void> {
  // Validar API key da Evolution (quando configurada)
  const expectedKey = process.env.EVOLUTION_API_KEY;
  if (expectedKey) {
    const receivedKey = req.headers["apikey"] as string || req.headers["x-api-key"] as string;
    if (!receivedKey || receivedKey !== expectedKey) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  // Responde 200 imediatamente para não bloquear a Evolution API
  res.status(200).json({ ok: true });

  try {
    const payload = req.body as EvolutionWebhookPayload;
    if (!payload?.event || !payload?.instance) return;

    const clientId = clientIdFromInstance(payload.instance);
    const event    = payload.event.toUpperCase();

    switch (event) {
      case "CONNECTION_UPDATE":
        await handleConnectionUpdate(clientId, payload.instance, payload.data);
        break;

      case "QRCODE_UPDATED":
        await handleQRCodeUpdated(clientId, payload.data);
        break;

      case "MESSAGES_UPSERT":
        await handleMessagesUpsert(clientId, payload.data);
        break;

      default:
        // Eventos ignorados (MESSAGES_UPDATE, PRESENCE_UPDATE, etc.)
        break;
    }
  } catch (err) {
    console.error("[Evolution Webhook] Erro ao processar evento:", err);
  }
}

// ─── CONNECTION_UPDATE ───────────────────────────────────────────────────────

async function handleConnectionUpdate(
  clientId: string,
  instanceName: string,
  data: Record<string, any>
): Promise<void> {
  const state: string = data?.state || data?.connection || "";
  const phoneNumber: string = data?.wuid?.replace(/@s\.whatsapp\.net$/, "") || null;

  let status: "disconnected" | "connecting" | "connected";
  if (state === "open")  status = "connected";
  else if (state === "connecting" || state === "close") status = "connecting";
  else status = "disconnected";

  await upsertSession(clientId, instanceName, status, phoneNumber);

  console.log(`[Evolution] ${clientId} → ${status}${phoneNumber ? ` (${phoneNumber})` : ""}`);

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

    const remoteJid: string = msg?.key?.remoteJid || "";
    // Ignorar grupos (contêm @g.us)
    if (remoteJid.includes("@g.us")) continue;

    // Extrai número limpo: "5541999999999@s.whatsapp.net" → "5541999999999"
    const phone = remoteJid.replace(/@s\.whatsapp\.net$/, "").replace(/[^0-9]/g, "");
    if (!phone) continue;

    // Extrai texto da mensagem (suporta texto, extended text e caption de mídia)
    const text: string =
      msg?.message?.conversation ||
      msg?.message?.extendedTextMessage?.text ||
      msg?.message?.imageMessage?.caption ||
      msg?.message?.videoMessage?.caption ||
      msg?.message?.documentMessage?.caption ||
      msg?.message?.audioMessage ? "[Áudio]" :
      msg?.message?.imageMessage ? "[Imagem]" :
      msg?.message?.videoMessage ? "[Vídeo]" :
      msg?.message?.documentMessage ? "[Documento]" :
      msg?.message?.stickerMessage ? "[Sticker]" : "";

    if (!text) continue;

    const pushName: string = msg?.pushName || "";
    const now = new Date();

    await saveIncomingMessage(clientId, phone, pushName, text, now);
  }
}

// ─── Salvar mensagem recebida no banco ───────────────────────────────────────

async function saveIncomingMessage(
  clientId: string,
  phone: string,
  pushName: string,
  text: string,
  at: Date
): Promise<void> {
  const pool = getPool();
  const db   = getDb();
  const now  = at;

  try {
    // 1. Busca conversa existente pelo telefone
    const [convRows] = await pool.execute(
      `SELECT conversation_id, messages_json, customer_name
       FROM megadesk_domain_conversations
       WHERE client_id = ? AND phone = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [clientId, phone]
    ) as any[];

    const newMsg = {
      from: "customer" as const,
      text,
      time: at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      timestamp: at.toISOString(),
    };

    if (convRows && convRows.length > 0) {
      // ─── Conversa existente: adiciona mensagem ───────────────────────────
      const conv      = convRows[0];
      const convId    = conv.conversation_id;
      let   messages: any[] = [];

      try { messages = JSON.parse(conv.messages_json || "[]"); } catch { messages = []; }
      messages.push(newMsg);

      // Atualiza mensagens — mantém status atual (bot ou open), não sobrescreve
      await pool.execute(
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
      const conversationId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // Garante que o contato existe
      const existing = await searchCustomerByPhone(phone, clientId);
      if (!existing) {
        const customerId = `cust-${Date.now()}`;
        await createCustomer({ customerId, clientId, name: customerName, phone, company: "" });
      }

      await createConversation({
        conversationId,
        clientId,
        customerName,
        phone,
        company: "",
        lastMessage: text.substring(0, 255),
        messages: [newMsg],
      });

      // Garante status BOT (primeiro atendimento automático) e campos extras
      await pool.execute(
        `UPDATE megadesk_domain_conversations
         SET last_message_from = 'customer',
             unread_count = 1,
             status = 'bot'
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
          status:       "bot",
          lastMessage:  text.substring(0, 255),
          unreadCount:  1,
          lastMessageFrom: "customer",
        },
      });
    }
  } catch (err) {
    console.error(`[Evolution] Erro ao salvar mensagem de ${phone}:`, err);
  }
}

