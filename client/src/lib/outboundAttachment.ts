export type OutboundAttachmentKind = "image" | "video" | "audio" | "document" | "sticker";

export type PreparedOutboundAttachment = {
  kind: OutboundAttachmentKind;
  dataUrl: string;
  mimeType: string;
  fileName: string;
};

const MAX_BYTES: Readonly<Record<OutboundAttachmentKind, number>> = {
  image: 8_000_000,
  sticker: 8_000_000,
  audio: 12_000_000,
  video: 20_000_000,
  document: 12_000_000,
};

export const outboundAttachmentAccept = "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt";

export function attachmentKindForFile(file: Pick<File, "type">): OutboundAttachmentKind {
  if (file.type === "image/webp") return "sticker";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

export function prepareOutboundAttachment(file: File): Promise<PreparedOutboundAttachment> {
  const kind = attachmentKindForFile(file);
  if (file.size > MAX_BYTES[kind]) {
    return Promise.reject(new Error("Arquivo excede o limite permitido para este tipo."));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      kind,
      dataUrl: String(reader.result),
      mimeType: file.type || "application/octet-stream",
      fileName: file.name,
    });
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}
