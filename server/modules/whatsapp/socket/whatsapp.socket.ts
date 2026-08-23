/**
 * WhatsApp Module — Socket.IO
 * Gerenciamento de conexões em tempo real para conversas WhatsApp.
 * Cada cliente (tenant) tem sua própria sala isolada.
 */
import type { Server as HttpServer } from "http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import type { Request } from "express";
import type { WaConversationRecord, WaMessageRecord, WaMessageStatus } from "../types";
import { operationalAllowedOrigins, resolveOperationalSession } from "../../../_core/megadesk-session";

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
      origin: [...operationalAllowedOrigins()],
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  io.use(async (socket, next) => {
    try {
      const identity = await resolveOperationalSession(socket.request as Request);
      if (!identity) return next(new Error("UNAUTHORIZED"));
      const declaredTenant = socket.handshake.auth?.clientId ?? socket.handshake.query?.clientId ?? socket.handshake.headers["x-tenant-id"];
      if (typeof declaredTenant === "string" && declaredTenant !== identity.tenantId) return next(new Error("FORBIDDEN"));
      socket.data.operationalIdentity = identity;
      next();
    } catch { next(new Error("UNAUTHORIZED")); }
  });

  io.on("connection", (socket: Socket) => {
    const identity = socket.data.operationalIdentity as Awaited<ReturnType<typeof resolveOperationalSession>>;
    if (!identity) return socket.disconnect(true);
    socket.join(`client:${identity.tenantId}`);

    // Cliente entra na sala do seu tenant
    socket.on("wa:join_client", async (clientId: string) => {
      const current = await resolveOperationalSession(socket.request as Request).catch(() => null);
      if (!current || current.tenantId !== identity.tenantId || clientId !== identity.tenantId) socket.disconnect(true);
    });

    // Cliente sai da sala
    socket.on("wa:leave_client", async (clientId: string) => {
      const current = await resolveOperationalSession(socket.request as Request).catch(() => null);
      if (!current || current.tenantId !== identity.tenantId || clientId !== identity.tenantId) return socket.disconnect(true);
      socket.leave(`client:${identity.tenantId}`);
    });

    socket.on("disconnect", (reason) => {
      if (process.env.NODE_ENV === "development") console.log(`[WA Socket] Cliente desconectado (${reason})`);
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

export function emitOperationalTenantEvent(clientId: string, event: string, payload: unknown): void {
  if (!io) return;
  void (async () => {
    const sockets = [...io!.sockets.sockets.values()].filter(socket => socket.rooms.has(`client:${clientId}`));
    await Promise.all(sockets.map(async socket => {
      const identity = await resolveOperationalSession(socket.request as Request).catch(() => null);
      if (!identity || identity.tenantId !== clientId) return socket.disconnect(true);
      socket.emit(event, payload);
    }));
  })().catch(() => {
    if (process.env.NODE_ENV === "development") console.error("[WA Socket] Falha ao validar destinatários de evento.");
  });
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
  emitOperationalTenantEvent(clientId, "wa:new_message", { conversation, message });
}

/**
 * Emite atualização de status de mensagem.
 */
export function emitMessageStatus(
  clientId: string,
  waMessageId: string,
  status: WaMessageStatus
): void {
  emitOperationalTenantEvent(clientId, "wa:message_status", { waMessageId, status });
}

/**
 * Emite atualização de conversa existente.
 */
export function emitConversationUpdated(
  clientId: string,
  conversation: WaConversationRecord
): void {
  emitOperationalTenantEvent(clientId, "wa:conversation_updated", { conversation });
}

/**
 * Emite nova conversa criada.
 */
export function emitNewConversation(
  clientId: string,
  conversation: WaConversationRecord
): void {
  emitOperationalTenantEvent(clientId, "wa:new_conversation", { conversation });
}
