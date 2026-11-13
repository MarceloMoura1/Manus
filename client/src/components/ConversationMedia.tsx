import React from "react";
import { conversationMediaUrl } from "@/lib/trpc-url";
import {
  ConversationMediaResource,
  createBrowserConversationMediaDeps,
} from "@/lib/conversation-media-resource";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Props = {
  conversationId: string;
  message: any;
  caption?: string;
  fallback: React.ReactNode;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function extractQuotePdfCode(message: any, explicitCaption?: string): string | null {
  if (!message || typeof message !== "object") return null;

  const candidateUrls = [
    message.quotePdfUrl,
    message.mediaReference?.quotePdfUrl,
    message.mediaUrl,
    message.media_url,
    message.url,
    message.mediaData,
    message.mediaReference?.url,
    message.mediaReference?.mediaUrl,
    message.mediaReference?.media_url,
    message.mediaReference?.mediaData,
  ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);

  const fileName = String(
    message.fileName || message.mediaReference?.fileName || ""
  ).trim();

  const messageText = [
    explicitCaption,
    message.text,
    message.message,
    message.content,
    message.caption,
    message.mediaReference?.caption,
  ]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" ");

  const publicId = message.publicId || message.mediaReference?.publicId;
  const hasValidUuidPublicId = typeof publicId === "string" && UUID_REGEX.test(publicId.trim());

  const isQuotePdf =
    candidateUrls.some((u) => /\/api\/(?:crm\/quotes|erp\/sales)\//i.test(u)) ||
    /^or[çc]amento/i.test(fileName) ||
    /(?:or[çc]amento|proposta)\s+comercial/i.test(messageText) ||
    message.mediaReference?.storage === "quote_document" ||
    hasValidUuidPublicId;

  if (!isQuotePdf) {
    return null;
  }

  // 1. De orderNumber explícito (ex: "O-22")
  const orderNumber = message.orderNumber || message.mediaReference?.orderNumber;
  if (typeof orderNumber === "string" && orderNumber.trim().length > 0) {
    return orderNumber.trim();
  }

  // 2. Da URL direta /api/crm/quotes/<codigo>/pdf
  for (const rawUrl of candidateUrls) {
    const quoteUrlMatch = /\/api\/crm\/quotes\/([^/?#]+)\/pdf/i.exec(rawUrl);
    if (quoteUrlMatch?.[1]) {
      return decodeURIComponent(quoteUrlMatch[1]);
    }
  }

  // 3. Do fileName (ex: orcamento-O-22.pdf -> O-22)
  const fileMatch = /or[çc]amento-([A-Za-z0-9_-]+)\.pdf/i.exec(fileName);
  if (fileMatch?.[1]) {
    return fileMatch[1];
  }

  // 4. Do texto da mensagem via regex (ex: "orçamento comercial O-22" ou "proposta comercial *O-22*")
  const textMatch =
    /or[çc]amento\s+comercial\s+\*?([A-Za-z0-9_-]+)\*?/i.exec(messageText) ||
    /proposta\s+comercial\s+\*?([A-Za-z0-9_-]+)\*?/i.exec(messageText);
  if (textMatch?.[1]) {
    return textMatch[1];
  }

  // 5. Fallback para /api/erp/sales/<id>/pdf ou publicId
  for (const rawUrl of candidateUrls) {
    const salesUrlMatch = /\/api\/erp\/sales\/([^/?#]+)\/pdf/i.exec(rawUrl);
    if (salesUrlMatch?.[1]) {
      return decodeURIComponent(salesUrlMatch[1]);
    }
  }
  if (hasValidUuidPublicId) {
    return publicId.trim();
  }

  return null;
}

export function ConversationMedia({ conversationId, message, caption, fallback }: Props) {
  const quoteCode = React.useMemo(
    () => extractQuotePdfCode(message, caption),
    [
      message?.fileName,
      message?.text,
      message?.message,
      message?.content,
      message?.caption,
      message?.quotePdfUrl,
      message?.mediaUrl,
      message?.media_url,
      message?.url,
      message?.mediaData,
      message?.publicId,
      message?.orderNumber,
      message?.mediaReference,
      caption,
    ]
  );

  const resolvedQuoteUrl = React.useMemo(
    () => (quoteCode ? `/api/crm/quotes/${encodeURIComponent(quoteCode)}/pdf` : null),
    [quoteCode]
  );

  const explicitDirectUrl =
    (typeof message.mediaUrl === "string" && message.mediaUrl) ||
    (typeof message.media_url === "string" && message.media_url) ||
    (typeof message.url === "string" && message.url) ||
    (typeof message.mediaData === "string" && message.mediaData) ||
    (typeof message.mediaReference?.url === "string" && message.mediaReference.url) ||
    (typeof message.mediaReference?.mediaUrl === "string" && message.mediaReference.mediaUrl) ||
    (typeof message.mediaReference?.media_url === "string" && message.mediaReference.media_url) ||
    (typeof message.mediaReference?.mediaData === "string" && message.mediaReference.mediaData) ||
    null;

  const directUrl = explicitDirectUrl || resolvedQuoteUrl || null;

  const [url, setUrl] = React.useState<string | null>(directUrl);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [isOpeningDocument, setIsOpeningDocument] = React.useState(false);

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

  const effectiveUrl = directUrl || url;
  if (!effectiveUrl) return <>{fallback}</>;
  if (message.type === "image" || message.type === "sticker") {
    const alt = message.fileName || "Imagem da conversa";
    return <>
      <button type="button" onClick={() => setPreviewOpen(true)} aria-label={`Abrir ${alt} em tamanho ampliado`} className="block cursor-zoom-in rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
        <img src={effectiveUrl} alt={alt} className={message.type === "sticker" ? "h-40 w-40 object-contain" : "max-h-80 rounded-xl object-contain"} />
      </button>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent aria-describedby={undefined} className="w-[min(96vw,72rem)] max-w-none border-slate-700 bg-slate-950 p-3 text-white sm:p-5 [&_[data-slot=dialog-close]]:text-white">
          <DialogHeader className="sr-only"><DialogTitle>Visualização ampliada de {alt}</DialogTitle></DialogHeader>
          <img src={effectiveUrl} alt={alt} className="max-h-[85vh] w-full object-contain" />
        </DialogContent>
      </Dialog>
    </>;
  }
  if (message.type === "audio") return <audio controls preload="metadata" src={effectiveUrl} className="max-w-full" />;
  if (message.type === "video") return <video controls preload="metadata" src={effectiveUrl} className="max-h-80 rounded-xl" />;
  const openDocument = async (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const targetUrl = resolvedQuoteUrl || effectiveUrl;
    if (!targetUrl || isOpeningDocument) return;

    if (targetUrl.startsWith("data:")) {
      // Browsers block top-level navigation to data: URLs; convert to a blob URL first.
      const popup = window.open("", "_blank");
      void fetch(targetUrl)
        .then(response => response.blob())
        .then(blob => {
          const blobUrl = URL.createObjectURL(blob);
          if (popup) popup.location.href = blobUrl;
          else window.location.assign(blobUrl);
          window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
        })
        .catch(() => popup?.close());
      return;
    }

    // Abertura imediata da nova aba de forma síncrona antes de qualquer await para evitar bloqueio de popup
    const pdfTab = window.open("", "_blank");

    if (targetUrl.startsWith("blob:")) {
      if (pdfTab && !pdfTab.closed) {
        pdfTab.location.href = targetUrl;
      } else {
        window.location.assign(targetUrl);
      }
      return;
    }

    setIsOpeningDocument(true);
    try {
      const headers: Record<string, string> = {};
      let sessionToken = localStorage.getItem("megadesk-session-token");
      if (sessionToken) {
        headers["Authorization"] = `Bearer ${sessionToken}`;
      }
      try {
        const storedSession = localStorage.getItem("megadesk_session_v1");
        if (storedSession) {
          const parsed = JSON.parse(storedSession);
          if (parsed?.token && !headers["Authorization"]) {
            sessionToken = String(parsed.token);
            headers["Authorization"] = `Bearer ${parsed.token}`;
          }
          if (parsed?.clientId) headers["x-tenant-id"] = String(parsed.clientId);
          if (parsed?.userRole) headers["x-user-role"] = String(parsed.userRole);
          if (parsed?.userEmail) headers["x-user-email"] = String(parsed.userEmail);
        }
      } catch {
        // Ignora parse se inválido
      }

      let fetchUrl = targetUrl;
      const effectiveToken = sessionToken || (headers["Authorization"] ? headers["Authorization"].replace(/^Bearer\s+/i, "") : null);
      if (effectiveToken && !fetchUrl.includes("token=")) {
        const separator = fetchUrl.includes("?") ? "&" : "?";
        fetchUrl = `${fetchUrl}${separator}token=${encodeURIComponent(effectiveToken)}`;
      }

      const res = await fetch(fetchUrl, {
        method: "GET",
        credentials: "include",
        headers,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const mime = res.headers.get("content-type") || "application/pdf";
      const isPdfTarget = Boolean(resolvedQuoteUrl) || mime.toLowerCase().includes("pdf") || /\.pdf$/i.test(String(message.fileName || ""));
      const finalBlob = isPdfTarget && blob.type !== "application/pdf"
        ? new Blob([blob], { type: "application/pdf" })
        : blob;

      const blobUrl = URL.createObjectURL(finalBlob);
      if (pdfTab && !pdfTab.closed) {
        pdfTab.location.href = blobUrl;
      } else {
        window.location.assign(blobUrl);
      }
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
    } catch (err: any) {
      pdfTab?.close();
      console.error("[ConversationMedia] Erro ao abrir documento autenticado:", err);
      toast.error(`Não foi possível carregar o documento (${err?.message || "falha de rede"}).`);
    } finally {
      setIsOpeningDocument(false);
    }
  };

  return (
    <button
      type="button"
      data-href={effectiveUrl}
      data-target="_blank"
      onClick={openDocument}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      aria-busy={isOpeningDocument}
      className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-black/10 dark:bg-white/10 px-3 py-2 text-sm font-semibold underline decoration-current/40 hover:bg-black/20 dark:hover:bg-white/20 hover:decoration-current transition text-left"
    >
      {isOpeningDocument ? (
        <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin text-blue-500" />
      ) : (
        <FileText className="w-4 h-4 flex-shrink-0" />
      )}
      <span className="truncate max-w-[220px]">
        {isOpeningDocument ? "Abrindo documento…" : (message.fileName || "Baixar documento")}
      </span>
    </button>
  );
}
