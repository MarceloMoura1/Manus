import React from "react";
import { conversationMediaUrl } from "@/lib/trpc-url";
import { ConversationMediaResource } from "@/lib/conversation-media-resource";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = { conversationId: string; message: any; fallback: React.ReactNode };

export function ConversationMedia({ conversationId, message, fallback }: Props) {
  const [url, setUrl] = React.useState<string | null>(message.mediaData ?? null);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  React.useEffect(() => {
    if (message.mediaData || !message.mediaReference?.messageId) return;
    const resource = new ConversationMediaResource({ fetch, createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL, mediaUrl: conversationMediaUrl }, setUrl);
    void resource.resolve(conversationId, message.mediaReference.messageId);
    return () => resource.dispose();
  }, [conversationId, message.mediaData, message.mediaReference?.messageId]);
  if (!url) return <>{fallback}</>;
  if (message.type === "image" || message.type === "sticker") {
    const alt = message.fileName || "Imagem da conversa";
    return <>
      <button type="button" onClick={() => setPreviewOpen(true)} aria-label={`Abrir ${alt} em tamanho ampliado`} className="block cursor-zoom-in rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
        <img src={url} alt={alt} className={message.type === "sticker" ? "h-40 w-40 object-contain" : "max-h-80 rounded-xl object-contain"} />
      </button>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent aria-describedby={undefined} className="w-[min(96vw,72rem)] max-w-none border-slate-700 bg-slate-950 p-3 text-white sm:p-5 [&_[data-slot=dialog-close]]:text-white">
          <DialogHeader className="sr-only"><DialogTitle>Visualização ampliada de {alt}</DialogTitle></DialogHeader>
          <img src={url} alt={alt} className="max-h-[85vh] w-full object-contain" />
        </DialogContent>
      </Dialog>
    </>;
  }
  if (message.type === "audio") return <audio controls preload="metadata" src={url} className="max-w-full" />;
  if (message.type === "video") return <video controls preload="metadata" src={url} className="max-h-80 rounded-xl" />;
  return <a href={url} download={message.fileName || "documento"} className="underline">{message.fileName || "Documento"}</a>;
}
