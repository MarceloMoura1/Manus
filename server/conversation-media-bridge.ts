import type { Express, Request, Response } from "express";
import { getPool } from "./db";
import { resolveOperationalSessionReadOnly } from "./_core/megadesk-session";
import {
  CONVERSATION_MEDIA_MAX_BYTES,
  isSafeConversationMediaMime,
  parseConversationMediaReferenceV2,
  readConversationMedia,
} from "./conversation-media-storage";
import { findLegacyConversationMedia } from "./conversation-legacy-history";
import { hasConversationAccess } from "./routers-conversations";

function safeName(value: unknown): string {
  return typeof value === "string" && value.length > 0 && value.length <= 255 ? value.replace(/["\r\n]/g, "_") : "arquivo";
}

function dataUrl(value: unknown): { mime: string; bytes: Buffer } | null {
  if (typeof value !== "string") return null;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match || match[2].length % 4 !== 0 || !isSafeConversationMediaMime(match[1])) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > CONVERSATION_MEDIA_MAX_BYTES) return null;
  return { mime: match[1].toLowerCase(), bytes };
}

export async function sendConversationMedia(req: Request, res: Response, pool = getPool()): Promise<void> {
  return createConversationMediaHandler(pool)(req, res);
}

export function createConversationMediaHandler(
  pool: Pick<ReturnType<typeof getPool>, "execute">,
  resolveIdentity: typeof resolveOperationalSessionReadOnly = resolveOperationalSessionReadOnly,
  readV2: typeof readConversationMedia = readConversationMedia,
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
      `SELECT m.media_reference AS mediaReference, m.message_type AS messageType
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
      let reference: Record<string, unknown>;
      try { reference = JSON.parse(rows[0].mediaReference); } catch { res.status(404).end(); return; }
      const v2 = parseConversationMediaReferenceV2(reference);
      if (v2) {
        const content = await readV2({ clientId: identity.tenantId, reference: v2 });
        bytes = content.bytes;
        mimeType = content.mimeType;
        fileName = content.fileName;
      } else {
        const content = dataUrl(reference.mediaData);
        if (!content) { res.status(404).end(); return; }
        bytes = content.bytes;
        mimeType = content.mime;
        fileName = reference.fileName;
      }
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
