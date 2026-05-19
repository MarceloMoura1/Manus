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
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !==
          DisconnectReason.loggedOut;

        session.status = "disconnected";
        session.qrDataUrl = undefined;
        broadcast(clientId, "status", { status: "disconnected" });

        if (shouldReconnect) {
          // Tentar reconectar após 3 segundos
          setTimeout(() => startWhatsAppSession(clientId), 3000);
        } else {
          // Usuário deslogou — limpar sessão salva
          const sessionDir = getSessionDir(clientId);
          if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
          }
        }
      }

      if (connection === "open") {
        const phoneNumber =
          sock.user?.id?.split(":")[0]?.replace(/\D/g, "") || "";
        session.status = "connected";
        session.phoneNumber = phoneNumber;
        session.qrDataUrl = undefined;
        session.connectedAt = Date.now();
        broadcast(clientId, "status", {
          status: "connected",
          phoneNumber,
          connectedAt: session.connectedAt,
        });
      }
    });

    // Receber mensagens
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        if (!msg.message) continue;
        const from = msg.key.remoteJid || "";
        const isGroup = from.endsWith("@g.us");
        if (isGroup) continue;

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          "";

        if (text) {
          broadcast(clientId, "message", {
            from: from.replace("@s.whatsapp.net", ""),
            text,
            timestamp: msg.messageTimestamp,
          });
        }
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
