/**
 * WhatsApp Module — Socket.IO
 * Gerenciamento de conexões em tempo real para conversas WhatsApp.
 * Cada cliente (tenant) tem sua própria sala isolada.
 */
import type { Server as HttpServer } from "http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import type { WaConversationRecord, WaMessageRecord, WaMessageStatus } from "../types";

let io: SocketIOServer | null = null;

/**
 * Inicializa o servidor Socket.IO integrado ao servidor HTTP existente.
 * Deve ser chamado uma vez durante a inicialização do servidor.
 */
export function initWhatsAppSocket(httpServer: HttpServer): SocketIOServer {
  if (io) return io;

  io = new SocketIOServer(httpServer, {
    path: "/api/ws/whatsapp",
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket: Socket) => {
    console.log(`[WA Socket] Cliente conectado: ${socket.id}`);

    // Cliente entra na sala do seu tenant
    socket.on("wa:join_client", (clientId: string) => {
      if (typeof clientId === "string" && clientId.length > 0) {
        socket.join(`client:${clientId}`);
        console.log(`[WA Socket] ${socket.id} entrou na sala: client:${clientId}`);
      }
    });

    // Cliente sai da sala
    socket.on("wa:leave_client", (clientId: string) => {
      socket.leave(`client:${clientId}`);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[WA Socket] Cliente desconectado: ${socket.id} (${reason})`);
    });
  });

  console.log("[WA Socket] Socket.IO inicializado em /api/ws/whatsapp");
  return io;
}

/**
 * Retorna a instância do Socket.IO (pode ser null antes da inicialização).
 */
export function getSocketIO(): SocketIOServer | null {
  return io;
}

// ─── Emissores de Eventos ──────────────────────────────────────────────────────

/**
 * Emite uma nova mensagem recebida para todos os atendentes do tenant.
 */
export function emitNewMessage(
  clientId: string,
  conversation: WaConversationRecord,
  message: WaMessageRecord
): void {
  if (!io) return;
  io.to(`client:${clientId}`).emit("wa:new_message", { conversation, message });
}

/**
 * Emite atualização de status de mensagem.
 */
export function emitMessageStatus(
  waMessageId: string,
  status: WaMessageStatus
): void {
  if (!io) return;
  // Broadcast global — o frontend filtra pelo ID
  io.emit("wa:message_status", { waMessageId, status });
}

/**
 * Emite atualização de conversa existente.
 */
export function emitConversationUpdated(
  clientId: string,
  conversation: WaConversationRecord
): void {
  if (!io) return;
  io.to(`client:${clientId}`).emit("wa:conversation_updated", { conversation });
}

/**
 * Emite nova conversa criada.
 */
export function emitNewConversation(
  clientId: string,
  conversation: WaConversationRecord
): void {
  if (!io) return;
  io.to(`client:${clientId}`).emit("wa:new_conversation", { conversation });
}
