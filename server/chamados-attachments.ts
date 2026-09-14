import { createHash, randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { fileTypeFromBuffer } from "file-type";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { getPool } from "./db";
import { resolveOperationalSessionReadOnly } from "./_core/megadesk-session";
import { storageGet, storagePutExact } from "./storage";
import {
  activateTicketAttachment,
  markTicketAttachmentPendingDelete,
  reserveTicketAttachment,
  type CanonicalTicketActor,
} from "./chamados-domain";

export const TICKET_ATTACHMENT_MAX_BYTES = 12 * 1024 * 1024;

const allowedMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const inlineMimeTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain", "text/csv"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storageKeyPattern = /^ticket-attachments\/[0-9a-f]{2}\/[0-9a-f-]{36}$/i;

export type AllowedTicketAttachmentMime =
  | "application/pdf"
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "text/plain"
  | "text/csv"
  | "application/msword"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.ms-excel"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export class TicketAttachmentError extends Error {
  constructor(readonly code: "BAD_FILE" | "TOO_LARGE" | "CONFLICT" | "NOT_FOUND" | "STORAGE", message: string) {
    super(message);
  }
}

export type TicketAttachmentStorage = {
  putExact(key: string, bytes: Buffer, mimeType: string): Promise<{ key: string }>;
  get(key: string): Promise<{ url: string }>;
};

const forgeTicketAttachmentStorage: TicketAttachmentStorage = {
  putExact: async (key, bytes, mimeType) => {
    const result = await storagePutExact(key, bytes, mimeType);
    return { key: result.key };
  },
  get: async key => storageGet(key),
};

function decodeBase64(value: string): Buffer {
  if (!value || value.length > Math.ceil(TICKET_ATTACHMENT_MAX_BYTES * 4 / 3) + 8) {
    throw new TicketAttachmentError("TOO_LARGE", "Arquivo excede o limite de 12 MiB.");
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new TicketAttachmentError("BAD_FILE", "Arquivo codificado de forma inválida.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0) throw new TicketAttachmentError("BAD_FILE", "Arquivo vazio não é permitido.");
  if (bytes.length > TICKET_ATTACHMENT_MAX_BYTES) throw new TicketAttachmentError("TOO_LARGE", "Arquivo excede o limite de 12 MiB.");
  return bytes;
}

function safeText(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  const text = bytes.toString("utf8");
  if (text.includes("\uFFFD")) return false;
  return !/<(?:script|html|svg|iframe|object|embed)\b/i.test(text);
}

function safeFileName(value: string): string {
  const normalized = value.normalize("NFKC").replace(/[\\/:*?"<>|\x00-\x1F\x7F]/g, "_").trim();
  if (!normalized || normalized === "." || normalized === "..") throw new TicketAttachmentError("BAD_FILE", "Nome de arquivo inválido.");
  return normalized.slice(0, 255);
}

function declaredTextMime(value: string): "text/plain" | "text/csv" {
  return value.toLowerCase().split(";", 1)[0].trim() === "text/csv" ? "text/csv" : "text/plain";
}

export async function sniffTicketAttachment(bytes: Buffer, declaredMimeType: string): Promise<AllowedTicketAttachmentMime> {
  const detected = await fileTypeFromBuffer(bytes);
  if (detected?.mime && allowedMimeTypes.has(detected.mime)) return detected.mime as AllowedTicketAttachmentMime;
  if (!detected && safeText(bytes)) return declaredTextMime(declaredMimeType);
  throw new TicketAttachmentError("BAD_FILE", "Tipo de arquivo não permitido ou conteúdo incompatível.");
}

function storageKeyFor(attachmentId: string): string {
  return `ticket-attachments/${attachmentId.slice(0, 2).toLowerCase()}/${attachmentId.toLowerCase()}`;
}

export type TicketAttachmentView = {
  attachmentId: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  uploadedBy: string;
  createdAt: string;
  state: "legacy" | "staged" | "active" | "pending_delete" | "deleted";
  canView: boolean;
  legacy: boolean;
};

export async function listTicketAttachments(chamadoId: string, clientId: string, pool: Pool = getPool()): Promise<TicketAttachmentView[]> {
  const [rows] = await pool.execute<Array<RowDataPacket & Omit<TicketAttachmentView, "canView" | "legacy"> & { storageKey: string | null }>>(
    `SELECT attachment_id AS attachmentId, file_name AS fileName, file_size AS fileSize, mime_type AS mimeType,
            uploaded_by AS uploadedBy, created_at AS createdAt, attachment_state AS state, storage_key AS storageKey
     FROM megadesk_domain_chamado_attachments
      WHERE chamado_id=? AND client_id=? AND attachment_state NOT IN ('pending_delete','deleted')
     ORDER BY created_at DESC, attachment_id DESC`,
    [chamadoId, clientId],
  );
  return rows.map(row => ({
    attachmentId: row.attachmentId,
    fileName: row.fileName,
    fileSize: row.fileSize == null ? null : Number(row.fileSize),
    mimeType: row.mimeType,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
    state: row.state,
    canView: row.state === "active" && Boolean(row.storageKey && storageKeyPattern.test(row.storageKey)),
    legacy: row.state === "legacy",
  }));
}

export async function uploadTicketAttachment(
  input: {
    chamadoId: string;
    clientId: string;
    actor: CanonicalTicketActor;
    clientAttemptId: string;
    fileName: string;
    declaredMimeType: string;
    fileBase64: string;
  },
  dependencies: { pool?: Pool; storage?: TicketAttachmentStorage } = {},
): Promise<{ attachmentId: string; reused: boolean }> {
  if (!uuid.test(input.chamadoId) || !uuid.test(input.clientAttemptId)) {
    throw new TicketAttachmentError("BAD_FILE", "Identificador de anexo inválido.");
  }
  const bytes = decodeBase64(input.fileBase64);
  const fileName = safeFileName(input.fileName);
  const mimeType = await sniffTicketAttachment(bytes, input.declaredMimeType);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const attachmentId = randomUUID();
  const storageKey = storageKeyFor(attachmentId);
  const pool = dependencies.pool ?? getPool();
  const storage = dependencies.storage ?? forgeTicketAttachmentStorage;
  const reservation = await reserveTicketAttachment({
    chamadoId: input.chamadoId,
    clientId: input.clientId,
    actor: input.actor,
    clientAttemptId: input.clientAttemptId,
    fileName,
    fileSize: bytes.length,
    mimeType,
    sha256,
    storageKey,
  }, pool);
  if (reservation.existingActive) return { attachmentId: reservation.attachmentId, reused: true };
  if (reservation.state !== "staged") {
    throw new TicketAttachmentError("CONFLICT", "Esta tentativa de anexo está pendente de reconciliação.");
  }
  try {
    const stored = await storage.putExact(reservation.storageKey, bytes, mimeType);
    if (stored.key !== reservation.storageKey || !storageKeyPattern.test(stored.key)) {
      throw new TicketAttachmentError("STORAGE", "Storage retornou uma referência inválida.");
    }
    await activateTicketAttachment({
      attachmentId: reservation.attachmentId,
      chamadoId: input.chamadoId,
      clientId: input.clientId,
      actor: input.actor,
      fileName,
      fileSize: bytes.length,
      mimeType,
      sha256,
    }, pool);
    return { attachmentId: reservation.attachmentId, reused: false };
  } catch (error) {
    await markTicketAttachmentPendingDelete(reservation.attachmentId, input.clientId, pool).catch(() => undefined);
    if (error instanceof TicketAttachmentError) throw error;
    throw new TicketAttachmentError("STORAGE", "Não foi possível armazenar o anexo com segurança.");
  }
}

type ReadableAttachmentRow = RowDataPacket & {
  storageKey: string | null;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
  state: string;
};

export async function readTicketAttachment(
  clientId: string,
  chamadoId: string,
  attachmentId: string,
  dependencies: { pool?: Pool; storage?: TicketAttachmentStorage } = {},
): Promise<{ bytes: Buffer; fileName: string; mimeType: AllowedTicketAttachmentMime; inline: boolean }> {
  if (!uuid.test(chamadoId) || !uuid.test(attachmentId)) throw new TicketAttachmentError("NOT_FOUND", "Anexo não encontrado.");
  const pool = dependencies.pool ?? getPool();
  const [rows] = await pool.execute<ReadableAttachmentRow[]>(
    `SELECT a.storage_key AS storageKey, a.file_name AS fileName, a.mime_type AS mimeType, a.file_size AS fileSize, a.attachment_state AS state
     FROM megadesk_domain_chamado_attachments a
     INNER JOIN megadesk_domain_chamados c ON c.chamadoId=a.chamado_id AND c.clientId=a.client_id
     WHERE a.attachment_id=? AND a.chamado_id=? AND a.client_id=? AND a.attachment_state='active' LIMIT 1`,
    [attachmentId, chamadoId, clientId],
  );
  const row = rows[0];
  if (!row || !row.storageKey || !storageKeyPattern.test(row.storageKey) || !row.mimeType || !allowedMimeTypes.has(row.mimeType)) {
    throw new TicketAttachmentError("NOT_FOUND", "Anexo não encontrado.");
  }
  const storage = dependencies.storage ?? forgeTicketAttachmentStorage;
  const reference = await storage.get(row.storageKey);
  const response = await fetch(reference.url);
  if (!response.ok) throw new TicketAttachmentError("NOT_FOUND", "Arquivo não disponível.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > TICKET_ATTACHMENT_MAX_BYTES || (row.fileSize != null && bytes.length !== Number(row.fileSize))) {
    throw new TicketAttachmentError("STORAGE", "Arquivo armazenado inválido.");
  }
  const detectedMimeType = await sniffTicketAttachment(bytes, row.mimeType);
  if (detectedMimeType !== row.mimeType) throw new TicketAttachmentError("STORAGE", "Arquivo armazenado não confere com sua metadata.");
  return { bytes, fileName: safeFileName(row.fileName), mimeType: detectedMimeType, inline: inlineMimeTypes.has(detectedMimeType) };
}

/**
 * Forge storage has no documented delete primitive. Reconciliation therefore
 * keeps failed uploads non-readable and observable in pending_delete rather
 * than falsely claiming that an external object was removed.
 */
export async function reconcileTicketAttachmentStates(
  olderThanMs = 60 * 60 * 1000,
  pool: Pool = getPool(),
): Promise<{ markedPendingDelete: number }> {
  const cutoff = new Date(Date.now() - Math.max(60_000, olderThanMs));
  const [result] = await pool.execute<any>(
    `UPDATE megadesk_domain_chamado_attachments
     SET attachment_state='pending_delete'
     WHERE attachment_state='staged' AND created_at < ?`,
    [cutoff.toISOString().slice(0, 19).replace("T", " ")],
  );
  return { markedPendingDelete: Number(result.affectedRows ?? 0) };
}

function statusFor(error: unknown): number {
  if (error instanceof TicketAttachmentError) {
    if (error.code === "NOT_FOUND") return 404;
    if (error.code === "TOO_LARGE") return 413;
    if (error.code === "CONFLICT") return 409;
    if (error.code === "BAD_FILE") return 400;
  }
  return 502;
}

export function registerTicketAttachmentRoutes(app: Express): void {
  app.get("/api/chamados/:chamadoId/attachments/:attachmentId/file", async (req: Request, res: Response) => {
    const identity = await resolveOperationalSessionReadOnly(req);
    if (!identity) { res.status(401).end(); return; }
    try {
      const attachment = await readTicketAttachment(identity.tenantId, req.params.chamadoId, req.params.attachmentId);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "sandbox");
      res.setHeader("Content-Type", attachment.mimeType);
      res.setHeader("Content-Length", String(attachment.bytes.length));
      res.setHeader("Content-Disposition", `${attachment.inline ? "inline" : "attachment"}; filename=\"${attachment.fileName.replace(/[\"\r\n]/g, "_")}\"`);
      res.status(200).send(attachment.bytes);
    } catch (error) {
      res.status(statusFor(error)).end();
    }
  });
}
