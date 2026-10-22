import React from "react";
import { conversationMediaUrl } from "@/lib/trpc-url";
import {
  ConversationMediaResource,
  createBrowserConversationMediaDeps,
} from "@/lib/conversation-media-resource";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText } from "lucide-react";

type Props = { conversationId: string; message: any; fallback: React.ReactNode };

export function ConversationMedia({ conversationId, message, fallback }: Props) {
  const directUrl =
    (typeof message.mediaUrl === "string" && message.mediaUrl) ||
    (typeof message.media_url === "string" && message.media_url) ||
    (typeof message.url === "string" && message.url) ||
    (typeof message.mediaData === "string" && message.mediaData) ||
    (typeof message.mediaReference?.url === "string" && message.mediaReference.url) ||
    (typeof message.mediaReference?.mediaUrl === "string" && message.mediaReference.mediaUrl) ||
    (typeof message.mediaReference?.media_url === "string" && message.mediaReference.media_url) ||
    (typeof message.mediaReference?.mediaData === "string" && message.mediaReference.mediaData) ||
    null;

  const [url, setUrl] = React.useState<string | null>(directUrl);
  const [previewOpen, setPreviewOpen] = React.useState(false);

  React.useEffect(() => {
    if (directUrl) {
      setUrl(directUrl);
      return;
    }

    const messageId = message.mediaReference?.messageId;
    if (!messageId) {
      setUrl(null);
      return;
    }

    const resource = new ConversationMediaResource(
      {
        ...createBrowserConversationMediaDeps(window),
        mediaUrl: conversationMediaUrl,
      },
      setUrl,
    );
    void resource.resolve(conversationId, messageId);
    return () => resource.dispose();
  }, [conversationId, directUrl, message.mediaReference?.messageId]);

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
  const openDocument = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (!url) return;
    if (url.startsWith("data:")) {
      // Browsers block top-level navigation to data: URLs; convert to a blob URL first.
      const popup = window.open("", "_blank");
      void fetch(url)
        .then(response => response.blob())
        .then(blob => {
          const blobUrl = URL.createObjectURL(blob);
          if (popup) popup.location.href = blobUrl;
          else window.open(blobUrl, "_blank");
          window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
        })
        .catch(() => popup?.close());
      return;
    }
    // Same-origin URLs (e.g. /api/erp/sales/:id/pdf) carry the session cookie automatically.
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={openDocument}
      className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-black/10 dark:bg-white/10 px-3 py-2 text-sm font-semibold underline decoration-current/40 hover:bg-black/20 dark:hover:bg-white/20 hover:decoration-current transition"
    >
      <FileText className="w-4 h-4 flex-shrink-0" />
      <span className="truncate max-w-[220px]">{message.fileName || "Baixar documento"}</span>
    </a>
  );
}
