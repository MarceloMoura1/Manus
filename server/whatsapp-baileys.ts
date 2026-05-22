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
  initAuthCreds,
  BufferJSON,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import path from "path";
import fs from "fs";
import pino from "pino";
import { getPool } from "./db";
import { saveFailedMessage } from "./baileys-failed-messages";
import { getSocketIO } from "./modules/whatsapp/socket/whatsapp.socket";

/**
 * Armazena uma mensagem na fila de reprocessamento quando o LID nao esta resolvido
 */
export async function addMessageToQueue(
  clientId: string,
  lidId: string,
  text: string,
  timestamp: Date,
  pushName?: string | null,
  msgType?: string,
  mediaFileName?: string
): Promise<void> {
  const pool = getPool();
  try {
    await pool.execute(
      `INSERT INTO baileys_pending_messages
       (client_id, lid_id, text, push_name, msg_type, media_file_name, timestamp, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [clientId, lidId, text, pushName || null, msgType || 'text', mediaFileName || null, timestamp.getTime()]
    );
    console.log(`[Baileys] Mensagem adicionada a fila: LID=${lidId}, clientId=${clientId}`);
  } catch (err) {
    console.error(`[Baileys] Erro ao adicionar mensagem a fila:`, err);
  }
}

/**
 * Reprocessa mensagens da fila quando um LID e resolvido
 */
export async function reprocessQueuedMessages(
  clientId: string,
  lidId: string,
  resolvedPhone: string
): Promise<void> {
  const pool = getPool();
  try {
    // Buscar mensagens pendentes para este LID
    const [rows] = await pool.execute(
      `SELECT id, text, push_name, msg_type, media_file_name, timestamp
       FROM baileys_pending_messages
       WHERE client_id = ? AND lid_id = ? AND status = 'pending'
       ORDER BY created_at ASC`,
      [clientId, lidId]
    ) as any[];

    if (!rows || rows.length === 0) {
      console.log(`[Baileys] Nenhuma mensagem na fila para LID ${lidId}`);
      return;
    }

    console.log(`[Baileys] Reprocessando ${rows.length} mensagens para LID ${lidId}`);

    for (const row of rows) {
      try {
        // Marcar como processando
        await pool.execute(
          `UPDATE baileys_pending_messages SET status = 'processing' WHERE id = ?`,
          [row.id]
        );

        // Reprocessar a mensagem com o numero resolvido
        const timestamp = new Date(row.timestamp);
        await handleIncomingMessage(
          clientId,
          resolvedPhone,
          row.text,
          timestamp,
          row.push_name,
          row.msg_type,
          row.media_file_name
        );

        // Marcar como concluida
        await pool.execute(
          `UPDATE baileys_pending_messages SET status = 'completed' WHERE id = ?`,
          [row.id]
        );

        console.log(`[Baileys] Mensagem reprocessada com sucesso: ID=${row.id}`);
      } catch (err) {
        console.error(`[Baileys] Erro ao reprocessar mensagem ${row.id}:`, err);
        // Incrementar retry_count
        await pool.execute(
          `UPDATE baileys_pending_messages SET retry_count = retry_count + 1, status = 'failed' WHERE id = ?`,
          [row.id]
        );
      }
    }
  } catch (err) {
    console.error(`[Baileys] Erro ao reprocessar fila:`, err);
  }
}

// Diretório para armazenar sessões (fallback local)
const SESSIONS_DIR = path.join(process.cwd(), ".baileys-sessions");
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

/**
 * Implementação de useDbAuthState: persiste credenciais Baileys no banco MySQL
 * Isso garante que as sessões sobrevivem a reinicializações do servidor e deploys
 */
async function useDbAuthState(clientId: string) {
  const pool = getPool();

  // Garante que a tabela existe
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS baileys_auth_state (
      client_id VARCHAR(255) NOT NULL,
      auth_key VARCHAR(255) NOT NULL,
      auth_value LONGTEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (client_id, auth_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Carrega todas as chaves de auth do banco
  const [rows] = await pool.execute(
    'SELECT auth_key, auth_value FROM baileys_auth_state WHERE client_id = ?',
    [clientId]
  ) as any[];

  const authData: Record<string, any> = {};
  for (const row of rows) {
    try {
      authData[row.auth_key] = JSON.parse(row.auth_value, BufferJSON.reviver);
    } catch {
      // ignorar chaves corrompidas
    }
  }

  // Inicializar credenciais se não existirem
  const creds = authData['creds'] || initAuthCreds();

  // Implementação de SignalKeyStore que persiste no banco
  const keys: any = {
    get: async (type: string, ids: string[]) => {
      const data: Record<string, any> = {};
      for (const id of ids) {
        const key = `key_${type}_${id}`;
        if (authData[key]) {
          data[id] = authData[key];
        }
      }
      return data;
    },
    set: async (data: Record<string, Record<string, any>>) => {
      const updates: [string, string, string][] = [];
      for (const [type, typeData] of Object.entries(data)) {
        for (const [id, value] of Object.entries(typeData)) {
          const key = `key_${type}_${id}`;
          const valueStr = JSON.stringify(value, BufferJSON.replacer);
          authData[key] = value;
          updates.push([clientId, key, valueStr]);
        }
      }
      if (updates.length > 0) {
        for (const [cid, k, v] of updates) {
          await pool.execute(
            'INSERT INTO baileys_auth_state (client_id, auth_key, auth_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE auth_value = VALUES(auth_value)',
            [cid, k, v]
          );
        }
      }
    },
  };

  const state = { creds, keys };

  const saveCreds = async () => {
    const credsStr = JSON.stringify(creds, BufferJSON.replacer);
    authData['creds'] = creds;
    await pool.execute(
      'INSERT INTO baileys_auth_state (client_id, auth_key, auth_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE auth_value = VALUES(auth_value)',
      [clientId, 'creds', credsStr]
    );
  };

  const clearAuth = async () => {
    await pool.execute('DELETE FROM baileys_auth_state WHERE client_id = ?', [clientId]);
  };

  return { state, saveCreds, clearAuth };
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

// Mapa global de LID -> número de telefone real por clientId
// Exemplo: { "cliente-005": { "63346606899236": "5541995484515" } }
const lidToPhoneMap = new Map<string, Map<string, string>>();

/**
 * Resolve um JID que pode ser um LID para o número de telefone real.
 * Se for um número normal, retorna direto. Se for LID, tenta resolver via mapa.
 */
function resolvePhoneFromJid(clientId: string, jid: string): string {
  // Extrair a parte antes do @
  const rawId = jid.split("@")[0].split(":")[0];
  const server = jid.split("@")[1] || "";
  
  // Se for um LID (@lid), tentar resolver para número real
  if (server === "lid" || jid.endsWith("@lid")) {
    const clientMap = lidToPhoneMap.get(clientId);
    const resolved = clientMap?.get(rawId);
    if (resolved) {
      return resolved.replace(/\D/g, "");
    }
    // LID não resolvido ainda — usar o próprio LID como identificador temporário
    // A conversa será criada e o número atualizado quando o mapeamento chegar
    console.warn(`[Baileys] LID não resolvido: ${rawId} para cliente ${clientId} — usando LID como número temporário`);
    return `lid${rawId}`; // prefixo 'lid' para identificar como temporário
  }
  
  // Número normal — retornar apenas dígitos
  return rawId.replace(/\D/g, "");
}

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
    // Usar banco de dados para persistir credenciais (sobrevive a restarts e deploys)
    let authState: Awaited<ReturnType<typeof useDbAuthState>>;
    try {
      authState = await useDbAuthState(clientId);
      console.log(`[Baileys] Usando auth state do banco de dados para ${clientId}`);
    } catch (dbErr) {
      // Fallback para sistema de arquivos se banco não estiver disponível
      console.warn(`[Baileys] Banco indisponível, usando auth state de arquivo para ${clientId}:`, dbErr);
      const sessionDir = getSessionDir(clientId);
      const fileAuth = await useMultiFileAuthState(sessionDir);
      authState = { state: fileAuth.state, saveCreds: fileAuth.saveCreds, clearAuth: async () => {} };
    }
    const { state, saveCreds, clearAuth } = authState;
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

    // Restaurar mapeamento LID do banco ao iniciar sessão
    try {
      const pool = getPool();
      const [lidRows] = await pool.execute(
        'SELECT lid_id, phone_number FROM baileys_lid_mapping WHERE client_id = ?',
        [clientId]
      ) as any[];
      if (lidRows.length > 0) {
        if (!lidToPhoneMap.has(clientId)) lidToPhoneMap.set(clientId, new Map());
        for (const row of lidRows) {
          lidToPhoneMap.get(clientId)!.set(row.lid_id, row.phone_number);
        }
        console.log(`[Baileys] Restaurados ${lidRows.length} mapeamentos LID do banco para ${clientId}`);
      }
    } catch (err) {
      console.warn('[Baileys] Erro ao restaurar mapeamentos LID:', err);
    }

    // Escutar evento de mapeamento LID -> número de telefone real
    // Emitido pelo Baileys quando recebe pnForLidChatAction do servidor do WhatsApp
    sock.ev.on("lid-mapping.update" as any, ({ lid, pn }: { lid: string; pn: string }) => {
      const lidId = lid.split("@")[0].split(":")[0];
      const pnId = pn.split("@")[0].split(":")[0].replace(/\D/g, "");
      if (lidId && pnId) {
        if (!lidToPhoneMap.has(clientId)) {
          lidToPhoneMap.set(clientId, new Map());
        }
        lidToPhoneMap.get(clientId)!.set(lidId, pnId);
        console.log(`[Baileys] LID mapeado: ${lidId} -> ${pnId} (cliente: ${clientId})`);
        
        // Persistir mapeamento LID no banco
        const pool = getPool();
        pool.execute(
          `INSERT INTO baileys_lid_mapping (client_id, lid_id, phone_number) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE phone_number = VALUES(phone_number)`,
          [clientId, lidId, pnId]
        ).catch((err: any) => {
          console.error(`[Baileys] Erro ao persistir LID no banco:`, err);
        });
        
        // Atualizar conversas existentes que usam o LID como número temporário
        // O número temporário é salvo com prefixo 'lid' (ex: lid63346606899236)
        const tempPhone = `lid${lidId}`;
        pool.execute(
          `UPDATE megadesk_domain_conversations SET phone = ?, customer_name = CASE WHEN customer_name = ? THEN ? ELSE customer_name END WHERE client_id = ? AND (phone = ? OR phone = ?)`,
          [pnId, tempPhone, `+${pnId}`, clientId, tempPhone, lidId]
        ).then(([result]: any) => {
          const affected = result?.affectedRows || 0;
          if (affected > 0) {
            console.log(`[Baileys] Corrigidos ${affected} registros: LID ${lidId} -> ${pnId}`);
            
            // Emitir evento Socket.IO para notificar o frontend sobre a resolução do LID
            const ioServer = getSocketIO();
            if (ioServer) {
              ioServer.to(`client:${clientId}`).emit('lid-resolved', {
                oldPhone: tempPhone,
                newPhone: pnId,
                lidId,
              });
              console.log(`[Baileys] Evento 'lid-resolved' emitido para cliente ${clientId}`);
            }
            
            // Reprocessar mensagens que estavam na fila aguardando este LID
            reprocessQueuedMessages(clientId, lidId, pnId).catch((err: any) => {
              console.error(`[Baileys] Erro ao reprocessar fila para LID ${lidId}:`, err);
            });
          }
        }).catch((err: any) => {
          console.error(`[Baileys] Erro ao atualizar LID no banco:`, err);
        });
      }
    });

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
          // Limpar credenciais do banco E arquivos locais para que novo QR code seja gerado
          console.log(`[Baileys] Sessão encerrada (${isLoggedOut ? 'logout' : 'conflito'}). Limpando sessão...`);
          session.sock = undefined;
          // Apagar credenciais do banco
          try {
            const pool = getPool();
            await pool.execute('DELETE FROM baileys_auth_state WHERE client_id = ?', [clientId]);
            console.log(`[Baileys] Credenciais do banco removidas para ${clientId}`);
          } catch (e) {
            console.error(`[Baileys] Erro ao limpar credenciais do banco:`, e);
          }
          // Apagar arquivos de sessão locais (fallback)
          try {
            const sessionDir = getSessionDir(clientId);
            if (fs.existsSync(sessionDir)) {
              fs.rmSync(sessionDir, { recursive: true, force: true });
              console.log(`[Baileys] Arquivos de sessão removidos para ${clientId}`);
            }
          } catch (e) {
            console.error(`[Baileys] Erro ao limpar arquivos de sessão:`, e);
          }
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

        // Resolver número de telefone: suporta JIDs normais e LIDs (multi-device)
        // LIDs são IDs internos do WhatsApp (ex: 63346606899236@lid) que precisam
        // ser mapeados para o número real via evento lid-mapping.update
        const phone = resolvePhoneFromJid(clientId, from);
        
        // Se o phone ficou vazio, significa que eh um LID nao resolvido
        // Armazenar na fila para reprocessar quando o mapeamento chegar
        if (!phone) {
          console.warn(`[Baileys] LID nao resolvido: ${from} - armazenando na fila`);
          
          // Extrair o LID do JID
          const lidMatch = from.match(/(\d+)@lid/);
          if (lidMatch) {
            const lidId = lidMatch[1];
            const pushName = msg.pushName || null;
            let text = '[midia]';
            let msgType = 'text';
            let mediaFileName: string | undefined;
            
            if (msg.message.conversation) {
              text = msg.message.conversation;
            } else if (msg.message.extendedTextMessage?.text) {
              text = msg.message.extendedTextMessage.text;
            }
            
            const timestamp = Number(msg.messageTimestamp) * 1000;
            const now = new Date(timestamp);
            
            // Adicionar a fila
            await addMessageToQueue(clientId, lidId, text, now, pushName, msgType, mediaFileName);
          }
          continue;
        }
        
        const pushName = msg.pushName || null; // Nome do contato no WhatsApp
        
        // Extrair conteúdo da mensagem com suporte a múltiplos tipos
        let text = "[mídia]";
        let msgType: string = "text";
        let mediaFileName: string | undefined;
        if (msg.message.conversation) {
          text = msg.message.conversation;
          msgType = "text";
        } else if (msg.message.extendedTextMessage?.text) {
          text = msg.message.extendedTextMessage.text;
          msgType = "text";
        } else if (msg.message.imageMessage) {
          text = msg.message.imageMessage.caption || "[imagem]";
          msgType = "image";
        } else if (msg.message.videoMessage) {
          text = msg.message.videoMessage.caption || "[vídeo]";
          msgType = "video";
        } else if (msg.message.audioMessage) {
          text = "[áudio]";
          msgType = "audio";
        } else if (msg.message.documentMessage) {
          mediaFileName = msg.message.documentMessage.fileName || 'arquivo';
          text = `[documento: ${mediaFileName}]`;
          msgType = "document";
        } else if (msg.message.stickerMessage) {
          text = "[figurinha]";
          msgType = "sticker";
        } else if (msg.message.locationMessage) {
          text = "[localização]";
          msgType = "location";
        } else if (msg.message.contactMessage) {
          text = "[contato compartilhado]";
          msgType = "contact";
        } else if (msg.message.listMessage) {
          text = "[lista]";
          msgType = "list";
        } else if (msg.message.buttonsMessage) {
          text = msg.message.buttonsMessage.contentText || "[mensagem com botões]";
          msgType = "buttons";
        } else if (msg.message.templateMessage) {
          text = "[template]";
          msgType = "template";
        }

        const timestamp = Number(msg.messageTimestamp) * 1000;
        const now = new Date(timestamp);

        try {
          await handleIncomingMessage(clientId, phone, text, now, pushName, msgType, mediaFileName);
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

  // Limpar credenciais do banco
  try {
    const pool = getPool();
    await pool.execute('DELETE FROM baileys_auth_state WHERE client_id = ?', [clientId]);
    console.log(`[Baileys] Credenciais do banco removidas para ${clientId} (disconnect)`);
  } catch (e) {
    console.error(`[Baileys] Erro ao limpar credenciais do banco:`, e);
  }
  // Limpar sessão salva em arquivo (fallback)
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
  const restoredClients = new Set<string>();

  // 1. Restaurar sessões do banco de dados (principal)
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT DISTINCT client_id FROM baileys_auth_state WHERE auth_key = ?',
      ['creds']
    ) as any[];
    for (const row of rows) {
      const clientId = row.client_id;
      console.log(`[Baileys] Restaurando sessão do banco para: ${clientId}`);
      try {
        await startWhatsAppSession(clientId);
        restoredClients.add(clientId);
      } catch (err) {
        console.error(`[Baileys] Falha ao restaurar sessão ${clientId} do banco:`, err);
      }
    }
  } catch (err) {
    console.warn('[Baileys] Banco indisponível para restaurar sessões, tentando arquivos locais:', err);
  }

  // 2. Restaurar sessões de arquivos locais (fallback para clientes não restaurados do banco)
  if (!fs.existsSync(SESSIONS_DIR)) return;
  const dirs = fs.readdirSync(SESSIONS_DIR);
  for (const dir of dirs) {
    const sessionDir = path.join(SESSIONS_DIR, dir);
    const credsFile = path.join(sessionDir, "creds.json");
    if (fs.existsSync(credsFile)) {
      const clientId = dir; // nome do diretório = clientId sanitizado
      if (restoredClients.has(clientId)) continue; // já restaurado do banco
      console.log(`[Baileys] Restaurando sessão de arquivo para: ${clientId}`);
      try {
        await startWhatsAppSession(clientId);
      } catch (err) {
        console.error(`[Baileys] Falha ao restaurar sessão ${clientId} de arquivo:`, err);
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
  pushName?: string | null,
  msgType?: string,
  mediaFileName?: string
): Promise<void> {
  const pool = getPool();

  // Formatar o número de telefone (remover caracteres não numéricos)
  // O JID já foi extraído corretamente antes de chegar aqui
  const cleanPhone = phone.replace(/\D/g, "");

  // 1. Buscar conversa existente para esse telefone + clientId com status != closed
  const [existingRows] = await pool.execute(
    `SELECT conversation_id, messages_json, customer_name, company
     FROM megadesk_domain_conversations
     WHERE client_id = ? AND phone = ? AND status != 'closed'
     ORDER BY created_at DESC LIMIT 1`,
    [clientId, cleanPhone]
  ) as any[];

  const nowLabel = timestamp.toLocaleString("pt-BR");
  const messageEntry: any = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    sender: "customer",
    text,
    timestamp: timestamp.toISOString(),
    type: msgType || "text",
  };
  if (mediaFileName) messageEntry.fileName = mediaFileName;

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
    
    // Emitir evento Socket.IO para atualizar frontend em tempo real
    const ioServer = getSocketIO();
    if (ioServer) {
      ioServer.to(`client:${clientId}`).emit("conversation:updated", {
        conversationId: existing.conversation_id,
        lastMessage: text,
        lastMessageFrom: "customer",
        status: "bot",
        unreadCount: (existing.unread_count || 0) + 1,
        newMessage: messageEntry,
      });
    }
  } else {
    // 2b. Nova conversa — criar com status "bot"
    const conversationId = `conv-baileys-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;

    // Tentar buscar nome do cliente cadastrado
    const [customerRows] = await pool.execute(
      `SELECT name, company FROM megadesk_domain_customers
       WHERE client_id = ? AND phone = ? LIMIT 1`,
      [clientId, cleanPhone]
    ) as any[];

    // Definir nome do cliente: prioridade: cadastro > pushName > número
    // Se o número é um LID temporário, usar pushName ou 'Contato Desconhecido'
    const isLidTemp = cleanPhone.startsWith('lid');
    const customerName =
      customerRows && customerRows.length > 0
        ? customerRows[0].name
        : pushName || (isLidTemp ? 'Contato Desconhecido' : `+${cleanPhone}`);
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
    
    // Emitir evento Socket.IO para que o frontend adicione a nova conversa em tempo real
    const ioServer = getSocketIO();
    if (ioServer) {
      ioServer.to(`client:${clientId}`).emit("conversation:new", {
        conversation: {
          id: conversationId,
          name: customerName,
          phone: cleanPhone,
          company,
          lastMessage: text,
          status: "bot",
          unreadCount: 1,
          lastMessageFrom: "customer",
          createdAt: new Date().toISOString(),
        },
      });
    }
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
    let cleanPhone = phone.replace(/\D/g, "");
    
    // Detectar se é um LID temporário (começa com 'lid' ou é um número muito longo > 15 dígitos sem formato de telefone)
    const isLidTemp = phone.startsWith('lid') || (cleanPhone.length > 15 && !phone.includes('@'));
    if (isLidTemp) {
      // Tentar resolver o LID para número real via mapa em memória
      const rawLid = cleanPhone.startsWith('lid') ? cleanPhone.slice(3) : cleanPhone;
      const clientMap = lidToPhoneMap.get(clientId);
      const resolved = clientMap?.get(rawLid);
      if (resolved) {
        cleanPhone = resolved.replace(/\D/g, "");
        console.log(`[Baileys] LID ${rawLid} resolvido para ${cleanPhone} ao enviar mensagem`);
      } else {
        // Tentar buscar no banco de dados
        const pool = getPool();
        const [lidRows] = await pool.execute(
          'SELECT phone_number FROM baileys_lid_mapping WHERE client_id = ? AND lid_id = ? LIMIT 1',
          [clientId, rawLid]
        ) as any[];
        if (lidRows && lidRows.length > 0) {
          cleanPhone = lidRows[0].phone_number.replace(/\D/g, "");
          console.log(`[Baileys] LID ${rawLid} resolvido do banco para ${cleanPhone}`);
          // Atualizar mapa em memória
          if (!lidToPhoneMap.has(clientId)) lidToPhoneMap.set(clientId, new Map());
          lidToPhoneMap.get(clientId)!.set(rawLid, cleanPhone);
        } else {
          console.error(`[Baileys] Não foi possível resolver LID ${rawLid} para envio — número desconhecido`);
          return { ok: false, error: "Número do contato ainda não identificado. Aguarde o contato enviar uma mensagem primeiro para que o número seja resolvido." };
        }
      }
    }
    
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
    
    // Salvar mensagem falhada para reenvio posterior
    try {
      await saveFailedMessage(
        clientId,
        conversationId,
        phone,
        text,
        err?.name || 'send_error',
        err?.message || 'Erro desconhecido ao enviar mensagem'
      );
      console.log(`[Baileys] Mensagem falhada armazenada para reenvio posterior`);
    } catch (saveErr: any) {
      console.error(`[Baileys] Erro ao salvar mensagem falhada:`, saveErr);
    }
    
    return { ok: false, error: err?.message || "Erro ao enviar mensagem" };
  }
}
