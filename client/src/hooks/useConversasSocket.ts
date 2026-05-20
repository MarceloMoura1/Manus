/**
 * Hook useConversasSocket
 * Conecta ao Socket.IO e escuta eventos de conversas em tempo real.
 * Atualiza o estado local quando conversas são criadas, fechadas, atribuídas ou reabertas.
 */
import { useEffect, useRef, useCallback } from "react";
import { io, type Socket } from "socket.io-client";

export type ConversaSocketItem = {
  id: string;
  customerName: string;
  customerPhone: string;
  companyName: string;
  lastMessage: string;
  lastMessageAt: Date;
  unreadCount: number;
  status: "open" | "pending" | "closed";
  assignedUserId: string | null;
  assignedUserName?: string;
  iaActive: boolean;
  lastMessageFrom?: "customer" | "agent" | "bot";
  createdAt?: string;
};

type UseConversasSocketOptions = {
  clientId: string | null;
  onConversationNew?: (conv: ConversaSocketItem) => void;
  onConversationClosed?: (conversationId: string) => void;
  onConversationReopened?: (conversationId: string) => void;
  onConversationAssigned?: (data: { conversationId: string; assignedUserId: string; assignedUserName?: string }) => void;
};

export function useConversasSocket({
  clientId,
  onConversationNew,
  onConversationClosed,
  onConversationReopened,
  onConversationAssigned,
}: UseConversasSocketOptions) {
  const socketRef = useRef<Socket | null>(null);
  const connectedClientIdRef = useRef<string | null>(null);

  const handleNew = useCallback(
    (data: { conversation: any }) => {
      if (!onConversationNew) return;
      const c = data.conversation;
      onConversationNew({
        id: c.id,
        customerName: c.name,
        customerPhone: c.phone,
        companyName: c.company,
        lastMessage: c.lastMessage,
        lastMessageAt: c.createdAt ? new Date(c.createdAt) : new Date(),
        unreadCount: c.unreadCount ?? 1,
        status: (c.status as "open" | "pending" | "closed") ?? "open",
        assignedUserId: c.assignedUserId ?? null,
        assignedUserName: c.assignedUserName,
        iaActive: c.iaActive ?? false,
        lastMessageFrom: c.lastMessageFrom ?? "customer",
        createdAt: c.createdAt,
      });
    },
    [onConversationNew]
  );

  const handleClosed = useCallback(
    (data: { conversationId: string }) => {
      onConversationClosed?.(data.conversationId);
    },
    [onConversationClosed]
  );

  const handleReopened = useCallback(
    (data: { conversationId: string }) => {
      onConversationReopened?.(data.conversationId);
    },
    [onConversationReopened]
  );

  const handleAssigned = useCallback(
    (data: { conversationId: string; assignedUserId: string; assignedUserName?: string }) => {
      onConversationAssigned?.(data);
    },
    [onConversationAssigned]
  );

  useEffect(() => {
    if (!clientId) return;

    // Reutilizar socket existente se já conectado para o mesmo clientId
    if (socketRef.current && connectedClientIdRef.current === clientId) {
      return;
    }

    // Desconectar socket anterior se clientId mudou
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    const socket = io(window.location.origin, {
      path: "/api/ws/whatsapp",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;
    connectedClientIdRef.current = clientId;

    socket.on("connect", () => {
      console.log("[ConversasSocket] Conectado:", socket.id);
      socket.emit("wa:join_client", clientId);
    });

    socket.on("disconnect", (reason) => {
      console.log("[ConversasSocket] Desconectado:", reason);
    });

    socket.on("conversation:new", handleNew);
    socket.on("conversation:closed", handleClosed);
    socket.on("conversation:reopened", handleReopened);
    socket.on("conversation:assigned", handleAssigned);

    return () => {
      socket.off("conversation:new", handleNew);
      socket.off("conversation:closed", handleClosed);
      socket.off("conversation:reopened", handleReopened);
      socket.off("conversation:assigned", handleAssigned);
      socket.emit("wa:leave_client", clientId);
      socket.disconnect();
      socketRef.current = null;
      connectedClientIdRef.current = null;
    };
  }, [clientId, handleNew, handleClosed, handleReopened, handleAssigned]);

  return { socket: socketRef.current };
}
