import React from "react";
import { conversationMediaUrl } from "@/lib/trpc-url";
import { ConversationMediaResource } from "@/lib/conversation-media-resource";

type Props = { conversationId: string; message: any; fallback: React.ReactNode };

export function ConversationMedia({ conversationId, message, fallback }: Props) {
  const [url, setUrl] = React.useState<string | null>(message.mediaData ?? null);
  React.useEffect(() => {
    if (message.mediaData || !message.mediaReference?.messageId) return;
    const resource = new ConversationMediaResource({ fetch, createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL, mediaUrl: conversationMediaUrl }, setUrl);
    void resource.resolve(conversationId, message.mediaReference.messageId);
    return () => resource.dispose();
  }, [conversationId, message.mediaData, message.mediaReference?.messageId]);
  if (!url) return <>{fallback}</>;
  if (message.type === "image" || message.type === "sticker") return <img src={url} alt={message.fileName || "Mídia recebida"} className={message.type === "sticker" ? "h-40 w-40 object-contain" : "max-h-80 rounded-xl object-contain"} />;
  if (message.type === "audio") return <audio controls preload="metadata" src={url} className="max-w-full" />;
  if (message.type === "video") return <video controls preload="metadata" src={url} className="max-h-80 rounded-xl" />;
  return <a href={url} download={message.fileName || "documento"} className="underline">{message.fileName || "Documento"}</a>;
}
