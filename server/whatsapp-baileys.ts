/**
 * WhatsApp Baileys Manager
 * Gerencia sessões WhatsApp por clientId usando Baileys (WhatsApp Web)
 * Transmite QR Code via SSE (Server-Sent Events)
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import path from "path";
import fs from "fs";
import pino from "pino";
import { getPool } from "./db";

// Diretório para armazenar sessões
const SESSIONS_DIR = path.join(process.cwd(), ".baileys-sessions");
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

type SessionStatus = "disconnected" | "connecting" | "qr_ready" | "connected";

interface SessionInfo {
  status: SessionStatus;
  qrDataUrl?: string;
  phoneNumber?: string;
  connectedAt?: number;
  sock?: ReturnType<typeof makeWASocket>;
  sseClients: Set<(data: string) => void>;
}

// Mapa de sessões ativas por clientId
const sessions = new Map<string, SessionInfo>();

function getSessionDir(clientId: string): string {
  return path.join(SESSIONS_DIR, clientId.replace(/[^a-zA-Z0-9-_]/g, "_"));
}

function broadcast(clientId: string, event: string, data: unknown) {
  const session = sessions.get(clientId);
  if (!session) return;
  const payload = `data: ${JSON.stringify({ event, data })}\n\n`;
  session.sseClients.forEach((send) => {
    try {
      send(payload);
    } catch {
      // cliente desconectou
    }
  });
}

export function addSseClient(
  clientId: string,
  send: (data: string) => void
): () => void {
  let session = sessions.get(clientId);
  if (!session) {
    session = { status: "disconnected", sseClients: new Set() };
    sessions.set(clientId, session);
  }
  session.sseClients.add(send);

  // Enviar estado atual imediatamente
  send(
    `data: ${JSON.stringify({
      event: "status",
      data: {
        status: session.status,
        qrDataUrl: session.qrDataUrl,
        phoneNumber: session.phoneNumber,
      },
    })}\n\n`
  );

  return () => {
    session!.sseClients.delete(send);
  };
}

export async function startWhatsAppSession(clientId: string): Promise<void> {
  // Se já está conectado, não reiniciar
  const existing = sessions.get(clientId);
  if (existing?.status === "connected") {
    return;
  }

  // Se já está conectando, não duplicar
  if (existing?.status === "connecting" || existing?.status === "qr_ready") {
    return;
  }

  // Fechar sessão anterior se existir
  if (existing?.sock) {
    try {
      existing.sock.end(undefined);
    } catch {
      // ignorar
    }
  }

  const session: SessionInfo = {
    status: "connecting",
    sseClients: existing?.sseClients || new Set(),
  };
  sessions.set(clientId, session);

  broadcast(clientId, "status", { status: "connecting" });

  try {
    const sessionDir = getSessionDir(clientId);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const logger = pino({ level: "silent" });

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger,
      browser: ["MegaDesk", "Chrome", "1.0.0"],
    });

    session.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, {
            width: 300,
            margin: 2,
            color: { dark: "#000000", light: "#ffffff" },
          });
          session.status = "qr_ready";
          session.qrDataUrl = qrDataUrl;
          broadcast(clientId, "qr", { qrDataUrl });
          broadcast(clientId, "status", { status: "qr_ready", qrDataUrl });
        } catch (err) {
          console.error("[Baileys] Erro ao gerar QR Code:", err);
        }
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const isConflict = statusCode === DisconnectReason.connectionReplaced;

        session.status = "disconnected";
        session.qrDataUrl = undefined;
        broadcast(clientId, "status", { status: "disconnected" });

        if (isLoggedOut || isConflict) {
          // Deslogado explicitamente pelo usuário OU conflito de sessão
          // NÃO apagar arquivos automaticamente — deixar o usuário decidir
          console.log(`[Baileys] Sessão encerrada (${isLoggedOut ? 'logout' : 'conflito'}). Reconecte via QR Code.`);
          // Remover sock para evitar uso de socket morto
          session.sock = undefined;
        } else {
          // Queda de conexão temporária — reconectar após 5 segundos
          console.log(`[Baileys] Conexão perdida (código: ${statusCode}). Reconectando em 5s...`);
          setTimeout(() => {
            // Verificar se ainda não foi reconectado por outra instância
            const current = sessions.get(clientId);
            if (current && current.status === "disconnected") {
              startWhatsAppSession(clientId);
            }
          }, 5000);
        }
      }

      if (connection === "open") {
        const phoneNumber =
          sock.user?.id?.split(":")[0]?.replace(/\D/g, "") || "";
        session.status = "connected";
        session.phoneNumber = phoneNumber;
        session.qrDataUrl = undefined;
        session.connectedAt = Date.now();
        console.log(`[Baileys] ✅ Conectado! Número: +${phoneNumber}, clientId: ${clientId}`);
        broadcast(clientId, "status", {
          status: "connected",
          phoneNumber,
          connectedAt: session.connectedAt,
        });
      }
    });

    // Receber mensagens e persistir no banco
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        if (!msg.message) continue;
        // Ignorar mensagens enviadas pelo próprio número
        if (msg.key.fromMe) continue;
        const from = msg.key.remoteJid || "";
        const isGroup = from.endsWith("@g.us");
        if (isGroup) continue;

        // Extrair número de telefone corretamente do JID
        // Formato: "5511987654321@s.whatsapp.net" ou "5511987654321:0@s.whatsapp.net"
        let phone = from.replace("@s.whatsapp.net", "").replace(/@c\.us$/, "");
        // Se houver ":", pegar apenas a parte antes dele
        if (phone.includes(":")) {
          phone = phone.split(":")[0];
        }
        
        // Debug: logar o número antes de processar
        console.log(`[Baileys] Raw phone from JID: ${phone}, from: ${from}`);
        
        const pushName = msg.pushName || null; // Nome do contato no WhatsApp
        
        // Extrair conteúdo da mensagem com suporte a múltiplos tipos
        let text = "[mídia]";
        if (msg.message.conversation) {
          text = msg.message.conversation;
        } else if (msg.message.extendedTextMessage?.text) {
          text = msg.message.extendedTextMessage.text;
        } else if (msg.message.imageMessage?.caption) {
          text = msg.message.imageMessage.caption;
        } else if (msg.message.videoMessage?.caption) {
          text = msg.message.videoMessage.caption;
        } else if (msg.message.documentMessage?.caption) {
          text = msg.message.documentMessage.caption;
        } else if (msg.message.audioMessage) {
          text = "[áudio]";
        } else if (msg.message.imageMessage) {
          text = "[imagem]";
        } else if (msg.message.videoMessage) {
          text = "[vídeo]";
        } else if (msg.message.documentMessage) {
          text = `[documento: ${msg.message.documentMessage.fileName || 'arquivo'}]`;
        } else if (msg.message.stickerMessage) {
          text = "[figurinha]";
        } else if (msg.message.locationMessage) {
          text = "[localização]";
        } else if (msg.message.contactMessage) {
          text = "[contato compartilhado]";
        } else if (msg.message.listMessage) {
          text = "[lista]";
        } else if (msg.message.buttonsMessage) {
          text = msg.message.buttonsMessage.contentText || "[mensagem com botões]";
        } else if (msg.message.templateMessage) {
          text = "[template]";
        }

        const timestamp = Number(msg.messageTimestamp) * 1000;
        const now = new Date(timestamp);

        try {
          await handleIncomingMessage(clientId, phone, text, now, pushName);
        } catch (err) {
          console.error("[Baileys] Erro ao persistir mensagem:", err);
        }

        broadcast(clientId, "message", {
          from: phone,
          text,
          timestamp: msg.messageTimestamp,
        });
      }
    });
  } catch (err) {
    console.error("[Baileys] Erro ao iniciar sessão:", err);
    const session = sessions.get(clientId);
    if (session) {
      session.status = "disconnected";
      broadcast(clientId, "status", { status: "disconnected" });
    }
  }
}

export async function disconnectWhatsApp(clientId: string): Promise<void> {
  const session = sessions.get(clientId);
  if (!session) return;

  if (session.sock) {
    try {
      await session.sock.logout();
    } catch {
      try {
        session.sock.end(undefined);
      } catch {
        // ignorar
      }
    }
  }

  // Limpar sessão salva
  const sessionDir = getSessionDir(clientId);
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }

  session.status = "disconnected";
  session.qrDataUrl = undefined;
  session.phoneNumber = undefined;
  session.sock = undefined;
  broadcast(clientId, "status", { status: "disconnected" });
}

export function getSessionStatus(clientId: string): {
  status: SessionStatus;
  phoneNumber?: string;
  connectedAt?: number;
} {
  const session = sessions.get(clientId);
  if (!session) return { status: "disconnected" };
  return {
    status: session.status,
    phoneNumber: session.phoneNumber,
    connectedAt: session.connectedAt,
  };
}

// Restaurar sessões já autenticadas ao iniciar o servidor
export async function restoreExistingSessions(): Promise<void> {
  if (!fs.existsSync(SESSIONS_DIR)) return;
  const dirs = fs.readdirSync(SESSIONS_DIR);
  for (const dir of dirs) {
    const sessionDir = path.join(SESSIONS_DIR, dir);
    const credsFile = path.join(sessionDir, "creds.json");
    if (fs.existsSync(credsFile)) {
      const clientId = dir; // nome do diretório = clientId sanitizado
      console.log(`[Baileys] Restaurando sessão para: ${clientId}`);
      try {
        await startWhatsAppSession(clientId);
      } catch (err) {
        console.error(`[Baileys] Falha ao restaurar sessão ${clientId}:`, err);
      }
    }
  }
}

/**
 * Processa mensagem recebida: cria ou atualiza a conversa no banco com status "bot"
 * Garante isolamento por clientId e que a conversa aparece na página de Conversas
 */
async function handleIncomingMessage(
  clientId: string,
  phone: string,
  text: string,
  timestamp: Date,
  pushName?: string | null
): Promise<void> {
  const pool = getPool();

  // Formatar o número de telefone (remover caracteres não numéricos)
  let cleanPhone = phone.replace(/\D/g, "");
  
  // Debug: logar o número após limpeza
  console.log(`[Baileys] Cleaned phone: ${cleanPhone}, original: ${phone}`);
  
  // Normalizar: se o número for muito longo (mais de 13 dígitos), pode ter ID do Baileys
  if (cleanPhone.length > 13) {
    console.log(`[Baileys] Phone number too long (${cleanPhone.length} digits): ${cleanPhone}`);
    // Padrão Brasil: 55 + 2 dígitos de área + 8-9 dígitos = 11-12 dígitos total
    if (cleanPhone.startsWith("55")) {
      cleanPhone = cleanPhone.slice(-11);
    } else {
      cleanPhone = cleanPhone.slice(-10);
    }
    console.log(`[Baileys] Normalized phone: ${cleanPhone}`);
  }

  // 1. Buscar conversa existente para esse telefone + clientId com status != closed
  const [existingRows] = await pool.execute(
    `SELECT conversation_id, messages_json, customer_name, company
     FROM megadesk_domain_conversations
     WHERE client_id = ? AND phone = ? AND status != 'closed'
     ORDER BY created_at DESC LIMIT 1`,
    [clientId, cleanPhone]
  ) as any[];

  const nowLabel = timestamp.toLocaleString("pt-BR");
  const messageEntry = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    sender: "customer",
    text,
    timestamp: timestamp.toISOString(),
    type: "text",
  };

  if (existingRows && existingRows.length > 0) {
    // 2a. Conversa já existe — adicionar mensagem e atualizar last_message
    const existing = existingRows[0];
    let messages: any[] = [];
    try {
      messages = JSON.parse(existing.messages_json || "[]");
    } catch { messages = []; }
    messages.push(messageEntry);

    await pool.execute(
      `UPDATE megadesk_domain_conversations
       SET messages_json = ?, last_message = ?, time_label = ?, status = 'bot',
           last_message_from = 'customer', unread_count = COALESCE(unread_count, 0) + 1,
           updated_at = NOW()
       WHERE conversation_id = ? AND client_id = ?`,
      [JSON.stringify(messages), text, nowLabel, existing.conversation_id, clientId]
    );

    console.log(`[Baileys] Mensagem adicionada à conversa existente ${existing.conversation_id}`);
  } else {
    // 2b. Nova conversa — criar com status "bot"
    const conversationId = `conv-baileys-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;

    // Tentar buscar nome do cliente cadastrado
    const [customerRows] = await pool.execute(
      `SELECT name, company FROM megadesk_domain_customers
       WHERE client_id = ? AND phone = ? LIMIT 1`,
      [clientId, cleanPhone]
    ) as any[];

    const customerName =
      customerRows && customerRows.length > 0
        ? customerRows[0].name
        : pushName || `+${cleanPhone}`; // Usa pushName do WhatsApp se disponível
    const company =
      customerRows && customerRows.length > 0
        ? customerRows[0].company || ""
        : "";

    const messages = [messageEntry];

    await pool.execute(
      `INSERT INTO megadesk_domain_conversations
         (conversation_id, client_id, customer_name, phone, company, status,
          last_message, time_label, messages_json, last_message_from, unread_count,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'bot', ?, ?, ?, 'customer', 1, NOW(), NOW())`,
      [
        conversationId,
        clientId,
        customerName,
        cleanPhone,
        company,
        text,
        nowLabel,
        JSON.stringify(messages),
      ]
    );

    console.log(`[Baileys] Nova conversa criada: ${conversationId} para +${cleanPhone}`);
  }
}

/**
 * Envia uma mensagem de texto via Baileys para um número de telefone.
 * Também salva a mensagem no banco de dados da conversa.
 */
export async function sendBaileysMessage(
  clientId: string,
  conversationId: string,
  phone: string,
  text: string,
  agentName: string
): Promise<{ ok: boolean; error?: string }> {
  // Tentar encontrar sessão pelo clientId original ou sanitizado
  const sanitizedId = clientId.replace(/[^a-zA-Z0-9-_]/g, "_");
  
  // Função auxiliar: sessão válida = tem sock e status é connected ou connecting (pode estar reconectando)
  const isUsable = (s: SessionInfo | undefined): boolean => !!(s?.sock && (s.status === "connected" || s.status === "connecting"));
  
  let session = sessions.get(clientId);
  if (!isUsable(session)) {
    session = sessions.get(sanitizedId);
  }
  if (!isUsable(session)) {
    // Fallback: buscar qualquer sessão com sock ativo
    for (const [key, s] of sessions.entries()) {
      if (s.sock && (s.status === "connected" || s.status === "connecting")) {
        session = s;
        console.log(`[Baileys] Usando sessão fallback: ${key} para clientId: ${clientId}`);
        break;
      }
    }
  }
  if (!session?.sock) {
    console.error(`[Baileys] Sessão não encontrada para clientId: ${clientId} (sanitized: ${sanitizedId}). Sessões ativas: ${[...sessions.entries()].map(([k,v]) => k+':'+v.status).join(", ")}`);
    return { ok: false, error: "WhatsApp não conectado para este cliente" };
  }

  try {
    // Formatar JID do WhatsApp
    const cleanPhone = phone.replace(/\D/g, "");
    const jid = cleanPhone.includes("@") ? cleanPhone : `${cleanPhone}@s.whatsapp.net`;

    // Enviar mensagem via Baileys
    await session.sock.sendMessage(jid, { text });

    // Salvar mensagem no banco
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT messages_json FROM megadesk_domain_conversations
       WHERE conversation_id = ? AND client_id = ? LIMIT 1`,
      [conversationId, clientId]
    ) as any[];

    if (rows && rows.length > 0) {
      let messages: any[] = [];
      try { messages = JSON.parse(rows[0].messages_json || "[]"); } catch { messages = []; }
      messages.push({
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        sender: "agent",
        agentName,
        text,
        timestamp: new Date().toISOString(),
        type: "text",
      });
      const nowLabel = new Date().toLocaleString("pt-BR");
      await pool.execute(
        `UPDATE megadesk_domain_conversations
         SET messages_json = ?, last_message = ?, time_label = ?,
             last_message_from = 'agent', updated_at = NOW()
         WHERE conversation_id = ? AND client_id = ?`,
        [JSON.stringify(messages), text, nowLabel, conversationId, clientId]
      );
    }

    console.log(`[Baileys] Mensagem enviada para ${phone} (conversa ${conversationId})`);
    return { ok: true };
  } catch (err: any) {
    console.error(`[Baileys] Erro ao enviar mensagem:`, err);
    return { ok: false, error: err?.message || "Erro ao enviar mensagem" };
  }
}
