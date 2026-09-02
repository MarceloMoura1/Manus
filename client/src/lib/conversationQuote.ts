export type ConversationReplyPreview = {
  messageId: string;
  senderName?: string | null;
  sender?: string | null;
  direction?: string | null;
  type?: string | null;
  textPreview?: string | null;
  mediaLabel?: string | null;
  available?: boolean;
};

const typeLabel: Record<string, string> = {
  image: "Foto",
  video: "Vídeo",
  audio: "Áudio",
  document: "Documento",
  sticker: "Figurinha",
};

export function messageReplyPreview(message: Record<string, any>): ConversationReplyPreview | null {
  const messageId = typeof message.id === "string" ? message.id : "";
  if (!messageId) return null;
  const type = String(message.type ?? "text");
  const text = String(message.text ?? message.message ?? "").trim();
  return {
    messageId,
    senderName: message.agentName ?? null,
    sender: message.sender ?? message.from ?? null,
    direction: message.direction ?? null,
    type,
    textPreview: text.slice(0, 180),
    mediaLabel: typeLabel[type] ?? null,
    available: true,
  };
}

export function replyAuthor(reply: ConversationReplyPreview | null | undefined): string {
  if (reply?.senderName?.trim()) return reply.senderName.trim();
  return reply?.sender === "agent" || reply?.direction === "outbound" ? "Operador" : "Contato";
}

export function replyPreview(reply: ConversationReplyPreview | null | undefined): string {
  if (!reply?.available) return "Mensagem original indisponível";
  const text = reply.textPreview?.trim() ?? "";
  const normalizedText = text.replace(/^\[(imagem|vídeo|áudio|documento|figurinha)\]$/i, "");
  return normalizedText || reply.mediaLabel || typeLabel[String(reply.type ?? "")] || "Mensagem";
}
