import type { Express, Request, Response } from "express";
import { getPool } from "./db";
import { resolveOperationalSessionReadOnly } from "./_core/megadesk-session";

function safeName(value: unknown): string {
  return typeof value === "string" && value.length > 0 && value.length <= 255 ? value.replace(/["\r\n]/g, "_") : "arquivo";
}

function dataUrl(value: unknown): { mime: string; bytes: Buffer } | null {
  if (typeof value !== "string") return null;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match || !/^(image|audio|video)\/[A-Za-z0-9.+-]+$|^application\/[A-Za-z0-9.+-]+$/.test(match[1])) return null;
  return { mime: match[1], bytes: Buffer.from(match[2], "base64") };
}

export async function sendConversationMedia(req: Request, res: Response, pool = getPool()): Promise<void> {
  return createConversationMediaHandler(pool)(req, res);
}

export function createConversationMediaHandler(
  pool: Pick<ReturnType<typeof getPool>, "execute">,
  resolveIdentity: typeof resolveOperationalSessionReadOnly = resolveOperationalSessionReadOnly,
) {
  return async (req: Request, res: Response): Promise<void> => {
  const identity = await resolveIdentity(req);
  if (!identity) { res.status(401).end(); return; }
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
    if (!rows.length) { res.status(404).end(); return; }
    let reference: Record<string, unknown>;
    try { reference = JSON.parse(rows[0].mediaReference); } catch { res.status(404).end(); return; }
    const content = dataUrl(reference.mediaData);
    if (!content) { res.status(404).end(); return; }
    const attachment = rows[0].messageType === "document";
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", content.mime);
    res.setHeader("Content-Disposition", `${attachment ? "attachment" : "inline"}; filename=\"${safeName(reference.fileName)}\"`);
    res.status(200).send(content.bytes);
  } catch { res.status(404).end(); }
  };
}

export function registerConversationMediaBridge(app: Express): void {
  app.get("/api/conversations/:conversationId/messages/:messageId/media", (req, res) => void sendConversationMedia(req, res));
}
