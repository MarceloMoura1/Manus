import type { Express, Request, Response } from "express";
import { getPool } from "./db";
import { resolveOperationalSessionReadOnly } from "./_core/megadesk-session";
import {
  CONVERSATION_MEDIA_MAX_BYTES,
  decodeConversationMediaDataUrl,
  isSafeConversationMediaMime,
  parseConversationMediaReferenceV2,
  readConversationMedia,
  safeConversationMediaFileName,
} from "./conversation-media-storage";
import { findLegacyConversationMedia } from "./conversation-legacy-history";
import { hasConversationAccess } from "./routers-conversations";
import { normalizeProviderMessageReference } from "./conversation-provider-reference";
import { evoGetMediaBase64 } from "./evolution/client";
import { evolutionMediaDownloadEnvelope, parseEvolutionIncomingMessage } from "./evolution/webhook";

function safeName(value: unknown): string {
  return safeConversationMediaFileName(value) ?? "arquivo";
}

function dataUrl(value: unknown): { mime: string; bytes: Buffer } | null {
  if (typeof value !== "string") return null;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match || match[2].length % 4 !== 0 || !isSafeConversationMediaMime(match[1])) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > CONVERSATION_MEDIA_MAX_BYTES) return null;
  return { mime: match[1].toLowerCase(), bytes };
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

type ProviderMediaDownloader = typeof evoGetMediaBase64;

async function downloadProviderMedia(
  row: Record<string, any>,
  localMetadata: Record<string, unknown>,
  download: ProviderMediaDownloader,
): Promise<{ bytes: Buffer; mimeType: string; fileName?: string } | null> {
  if (row.provider !== "evolution" || typeof row.integrationId !== "string" || !row.integrationId) return null;
  const providerReference = normalizeProviderMessageReference(row.providerMessageReference);
  if (!providerReference) return null;
  const parsed = parseEvolutionIncomingMessage({ message: providerReference.message });
  const parsedMime = typeof parsed?.payload.mimeType === "string" ? parsed.payload.mimeType : "";
  const localMime = typeof localMetadata.mimeType === "string" ? localMetadata.mimeType : "";
  const downloadEnvelope = evolutionMediaDownloadEnvelope(providerReference);
  const result = await download(row.integrationId, downloadEnvelope);
  const declaredMime = result.mimetype || localMime || parsedMime;
  if (!declaredMime) return null;
  const encoded = result.base64.startsWith("data:")
    ? result.base64
    : `data:${declaredMime};base64,${result.base64}`;
  const decoded = decodeConversationMediaDataUrl(encoded, declaredMime);
  if (!decoded) return null;
  const parsedFileName = typeof parsed?.payload.fileName === "string" ? parsed.payload.fileName : undefined;
  const localFileName = typeof localMetadata.fileName === "string" ? localMetadata.fileName : undefined;
  const fileName = result.fileName || localFileName || parsedFileName;
  return { bytes: decoded.bytes, mimeType: decoded.mimeType, ...(fileName ? { fileName } : {}) };
}

export async function sendConversationMedia(req: Request, res: Response, pool = getPool()): Promise<void> {
  return createConversationMediaHandler(pool)(req, res);
}

export function createConversationMediaHandler(
  pool: Pick<ReturnType<typeof getPool>, "execute">,
  resolveIdentity: typeof resolveOperationalSessionReadOnly = resolveOperationalSessionReadOnly,
  readV2: typeof readConversationMedia = readConversationMedia,
  downloadProvider: ProviderMediaDownloader = evoGetMediaBase64,
) {
  return async (req: Request, res: Response): Promise<void> => {
   const identity = await resolveIdentity(req);
   if (!identity) { res.status(401).end(); return; }
   if (!hasConversationAccess({
     operationalUserRole: identity.role,
     operationalPermissions: identity.permissions,
   })) { res.status(403).end(); return; }
  const { conversationId, messageId } = req.params;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(conversationId) || !/^[A-Za-z0-9_-]{1,100}$/.test(messageId)) { res.status(400).end(); return; }
  try {
    const [rows] = await pool.execute(
      `SELECT m.media_reference AS mediaReference, m.provider_message_reference AS providerMessageReference,
        m.provider, m.integration_id AS integrationId, m.message_type AS messageType
       FROM megadesk_domain_conversations_messages m
       INNER JOIN megadesk_domain_conversations c ON c.conversation_id = m.conversation_id AND c.client_id = m.client_id
       WHERE m.message_id = ? AND m.conversation_id = ? AND m.client_id = ? LIMIT 1`,
      [messageId, conversationId, identity.tenantId],
    ) as any[];
    let bytes: Buffer;
    let mimeType: string;
    let fileName: unknown;
    let messageType: unknown;
    if (rows.length) {
      const reference = record(rows[0].mediaReference);
      const v2 = parseConversationMediaReferenceV2(reference);
      let content: { bytes: Buffer; mimeType: string; fileName?: string } | null = null;
      if (v2) {
        try {
          content = await readV2({ clientId: identity.tenantId, reference: v2 });
        } catch {
          // Historical/provider fallback below remains tenant- and attendance-scoped.
        }
      } else {
        const legacyContent = dataUrl(reference.mediaData);
        if (legacyContent) content = { bytes: legacyContent.bytes, mimeType: legacyContent.mime,
          ...(typeof reference.fileName === "string" ? { fileName: reference.fileName } : {}) };
      }
      content ??= await downloadProviderMedia(rows[0], reference, downloadProvider);
      if (!content) { res.status(404).end(); return; }
      bytes = content.bytes;
      mimeType = content.mimeType;
      fileName = content.fileName;
      messageType = rows[0].messageType;
    } else {
      const [legacyRows] = await pool.execute(
        `SELECT messages_json AS messagesJson FROM megadesk_domain_conversations
         WHERE conversation_id = ? AND client_id = ? LIMIT 1`,
        [conversationId, identity.tenantId],
      ) as any[];
      const legacy = findLegacyConversationMedia(legacyRows[0]?.messagesJson, messageId);
      const content = dataUrl(legacy?.mediaData);
      if (!legacy || !content) { res.status(404).end(); return; }
      bytes = content.bytes;
      mimeType = content.mime;
      fileName = legacy.fileName;
      messageType = legacy.messageType;
    }
    const attachment = messageType === "document" || !/^(image|audio|video)\//.test(mimeType);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `${attachment ? "attachment" : "inline"}; filename=\"${safeName(fileName)}\"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).send(bytes);
  } catch { res.status(404).end(); }
  };
}

export function registerConversationMediaBridge(app: Express): void {
  app.get("/api/conversations/:conversationId/messages/:messageId/media", (req, res) => void sendConversationMedia(req, res));
}
