import { createHash, randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { fileTypeFromBuffer } from "file-type";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { getPool } from "./db";
import { resolveOperationalSessionReadOnly } from "./_core/megadesk-session";
import { ENV } from "./_core/env";
import { StorageReadError } from "./storage";
import { productMediaRoot } from "./product-media";
import {
  activateTicketAttachment,
  discardTicketAttachmentReservation,
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
const storageKeyPattern = /^ticket-attachments\/([0-9a-f]{2})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function validStorageKey(value: string): boolean {
  const match = storageKeyPattern.exec(value);
  return Boolean(match && match[1].toLowerCase() === match[2].slice(0, 2).toLowerCase());
}

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
  readonly storageStage?: string;
  readonly causeName?: string;

  constructor(
    readonly code: "BAD_FILE" | "TOO_LARGE" | "CONFLICT" | "NOT_FOUND" | "STORAGE",
    message: string,
    details: { storageStage?: string; causeName?: string } = {},
  ) {
    super(message);
    this.storageStage = details.storageStage;
    this.causeName = details.causeName;
  }
}

export type TicketAttachmentReadFailureStage = "local" | "local_storage" | "storage_config" | "download_url" | "signed_fetch" | "content_validation";
export type TicketAttachmentReadFailureKind = "not_found" | "auth" | "rate_limit" | "server" | "transport" | "timeout" | "invalid_response" | "content_invalid" | "config" | "internal";

export class TicketAttachmentReadError extends TicketAttachmentError {
  readonly cause?: unknown;

  constructor(readonly details: {
    stage: TicketAttachmentReadFailureStage;
    kind: TicketAttachmentReadFailureKind;
    providerStatus?: number;
    cause?: unknown;
  }) {
    super(
      details.stage === "local" || (details.stage === "signed_fetch" && details.kind === "not_found") ? "NOT_FOUND" : "STORAGE",
      "Arquivo não disponível.",
    );
    this.name = "TicketAttachmentReadError";
    this.cause = details.cause;
  }

  get stage() { return this.details.stage; }
  get kind() { return this.details.kind; }
  get providerStatus() { return this.details.providerStatus; }
}

function signedFetchFailureKind(status: number): TicketAttachmentReadFailureKind {
  if (status === 404) return "not_found";
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "invalid_response";
}

function storageReadFailure(error: unknown): TicketAttachmentReadError {
  if (error instanceof StorageReadError) {
    return new TicketAttachmentReadError({
      stage: error.stage,
      kind: error.kind,
      ...(error.providerStatus == null ? {} : { providerStatus: error.providerStatus }),
      cause: error.cause ?? error,
    });
  }
  return new TicketAttachmentReadError({ stage: "download_url", kind: "transport", cause: error });
}

export type TicketAttachmentStorage = {
  putExact(key: string, bytes: Buffer, mimeType: string): Promise<{ key: string }>;
  readExact?(key: string): Promise<{ bytes: Buffer }>;
  removeExact?(key: string): Promise<void>;
  get?(key: string): Promise<{ url: string }>;
};

export type TicketAttachmentStorageFailureStage = "root" | "directory" | "write" | "sync" | "finalize" | "read" | "remove";

export class TicketAttachmentStorageError extends Error {
  constructor(readonly stage: TicketAttachmentStorageFailureStage, readonly cause?: unknown) {
    super(`Ticket attachment storage failed at ${stage}`);
    this.name = "TicketAttachmentStorageError";
  }
}

function isMissingStoragePath(error: unknown): boolean {
  if (error instanceof TicketAttachmentStorageError) return isMissingStoragePath(error.cause);
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export function resolveTicketAttachmentPath(root: string, key: string): string {
  if (!root || !path.isAbsolute(root) || !validStorageKey(key)) {
    throw new TicketAttachmentStorageError("root");
  }
  const canonicalRoot = path.resolve(root);
  const resolved = path.resolve(canonicalRoot, ...key.split("/"));
  if (!resolved.startsWith(`${canonicalRoot}${path.sep}`)) throw new TicketAttachmentStorageError("root");
  return resolved;
}

function assertPrivateDirectory(directory: string, stage: TicketAttachmentStorageFailureStage): void {
  try {
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe storage directory");
  } catch (cause) {
    throw new TicketAttachmentStorageError(stage, cause);
  }
}

async function prepareTicketAttachmentDirectory(root: string, target: string): Promise<void> {
  try {
    await mkdir(root, { recursive: true });
    assertPrivateDirectory(root, "root");
    const relativeDirectory = path.relative(root, path.dirname(target));
    let current = root;
    for (const segment of relativeDirectory.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      await mkdir(current).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      });
      assertPrivateDirectory(current, "directory");
    }
  } catch (cause) {
    if (cause instanceof TicketAttachmentStorageError) throw cause;
    throw new TicketAttachmentStorageError("directory", cause);
  }
}

function assertTicketAttachmentDirectoryChain(root: string, target: string): void {
  assertPrivateDirectory(root, "root");
  const relativeDirectory = path.relative(root, path.dirname(target));
  let current = root;
  for (const segment of relativeDirectory.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    assertPrivateDirectory(current, "directory");
  }
}

async function atomicWriteTicketAttachment(target: string, bytes: Buffer): Promise<void> {
  try {
    const existing = await readFile(target).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (existing) {
      if (existing.equals(bytes)) return;
      throw new TicketAttachmentStorageError("finalize");
    }
  } catch (cause) {
    if (cause instanceof TicketAttachmentStorageError) throw cause;
    throw new TicketAttachmentStorageError("read", cause);
  }

  const temporary = `${target}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(bytes);
    } catch (cause) {
      throw new TicketAttachmentStorageError("write", cause);
    }
    try {
      await handle.sync();
    } catch (cause) {
      throw new TicketAttachmentStorageError("sync", cause);
    }
    await handle.close();
    handle = null;
    try {
      await rename(temporary, target);
    } catch (cause) {
      throw new TicketAttachmentStorageError("finalize", cause);
    }
  } finally {
    await closeTicketAttachmentHandle(handle);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function closeTicketAttachmentHandle(handle: Awaited<ReturnType<typeof open>> | null): Promise<void> {
  if (handle) await handle.close().catch(() => undefined);
}

export function createLocalTicketAttachmentStorage(root = productMediaRoot()): TicketAttachmentStorage {
  const canonicalRoot = path.resolve(root);
  return {
    async putExact(key, bytes) {
      const target = resolveTicketAttachmentPath(canonicalRoot, key);
      await prepareTicketAttachmentDirectory(canonicalRoot, target);
      await atomicWriteTicketAttachment(target, bytes);
      return { key };
    },
    async readExact(key) {
      const target = resolveTicketAttachmentPath(canonicalRoot, key);
      try {
        assertTicketAttachmentDirectoryChain(canonicalRoot, target);
        const info = lstatSync(target);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsafe attachment object");
        return { bytes: await readFile(target) };
      } catch (cause) {
        if (cause instanceof TicketAttachmentStorageError) throw cause;
        throw new TicketAttachmentStorageError("read", cause);
      }
    },
    async removeExact(key) {
      const target = resolveTicketAttachmentPath(canonicalRoot, key);
      try {
        assertTicketAttachmentDirectoryChain(canonicalRoot, target);
        await rm(target, { force: true });
      } catch (cause) {
        if (isMissingStoragePath(cause)) return;
        if (cause instanceof TicketAttachmentStorageError) throw cause;
        throw new TicketAttachmentStorageError("remove", cause);
      }
    },
  };
}

function defaultTicketAttachmentStorage(): TicketAttachmentStorage {
  return createLocalTicketAttachmentStorage(productMediaRoot());
}

function decodeBase64(value: string): Buffer {
  if (!value || value.length > Math.ceil(TICKET_ATTACHMENT_MAX_BYTES * 4 / 3) + 8) {
    throw new TicketAttachmentError("TOO_LARGE", "Arquivo excede o limite de 12 MiB.");
  }
  const firstPadding = value.indexOf("=");
  const paddingLength = firstPadding < 0 ? 0 : value.length - firstPadding;
  const invalidPadding = value.length % 4 !== 0
    || paddingLength > 2
    || (firstPadding >= 0 && !/^={1,2}$/.test(value.slice(firstPadding)));
  if (invalidPadding || /[^A-Za-z0-9+/=]/.test(value)) {
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

export function ticketAttachmentContentDisposition(fileName: string, inline: boolean): string {
  const normalized = safeFileName(fileName);
  const fallback = normalized
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_") || "arquivo";
  const encoded = [...Buffer.from(normalized, "utf8")]
    .map(byte => `%${byte.toString(16).padStart(2, "0").toUpperCase()}`)
    .join("");
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
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
    canView: row.state === "active" && Boolean(row.storageKey && validStorageKey(row.storageKey)),
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
  const storage = dependencies.storage ?? defaultTicketAttachmentStorage();
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
  let storedObject = false;
  try {
    const stored = await storage.putExact(reservation.storageKey, bytes, mimeType);
    if (stored.key !== reservation.storageKey || !validStorageKey(stored.key)) {
      throw new TicketAttachmentError("STORAGE", "Storage retornou uma referência inválida.");
    }
    storedObject = true;
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
    let compensated = false;
    if (storage.removeExact) {
      try {
        await storage.removeExact(reservation.storageKey);
        compensated = await discardTicketAttachmentReservation(reservation.attachmentId, input.clientId, pool);
      } catch {
        compensated = false;
      }
    }
    if (!compensated) await markTicketAttachmentPendingDelete(reservation.attachmentId, input.clientId, pool).catch(() => undefined);
    if (error instanceof TicketAttachmentError) throw error;
    const stage = error instanceof TicketAttachmentStorageError
      ? error.stage
      : storedObject ? "metadata_activation" : "storage_write";
    throw new TicketAttachmentError("STORAGE", "Não foi possível armazenar o anexo com segurança.", {
      storageStage: stage,
      causeName: error instanceof Error ? error.name : typeof error,
    });
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
  dependencies: { pool?: Pool; storage?: TicketAttachmentStorage; timeoutMs?: number } = {},
): Promise<{ bytes: Buffer; fileName: string; mimeType: AllowedTicketAttachmentMime; inline: boolean }> {
  if (!uuid.test(chamadoId) || !uuid.test(attachmentId)) {
    throw new TicketAttachmentReadError({ stage: "local", kind: "not_found" });
  }
  const pool = dependencies.pool ?? getPool();
  let rows: ReadableAttachmentRow[];
  try {
    [rows] = await pool.execute<ReadableAttachmentRow[]>(
      `SELECT a.storage_key AS storageKey, a.file_name AS fileName, a.mime_type AS mimeType, a.file_size AS fileSize, a.attachment_state AS state
       FROM megadesk_domain_chamado_attachments a
       INNER JOIN megadesk_domain_chamados c ON c.chamadoId=a.chamado_id AND c.clientId=a.client_id
       WHERE a.attachment_id=? AND a.chamado_id=? AND a.client_id=? AND a.attachment_state='active' LIMIT 1`,
      [attachmentId, chamadoId, clientId],
    );
  } catch (cause) {
    throw new TicketAttachmentReadError({ stage: "local", kind: "internal", cause });
  }
  const row = rows[0];
  if (!row || row.state !== "active" || !row.storageKey || !validStorageKey(row.storageKey) || !row.mimeType || !allowedMimeTypes.has(row.mimeType)) {
    throw new TicketAttachmentReadError({ stage: "local", kind: "not_found" });
  }
  const storage = dependencies.storage ?? defaultTicketAttachmentStorage();
  let bytes: Buffer;
  if (storage.readExact) {
    try {
      bytes = (await storage.readExact(row.storageKey)).bytes;
    } catch (cause) {
      throw new TicketAttachmentReadError({ stage: "local_storage", kind: "internal", cause });
    }
    if (bytes.length === 0 || bytes.length > TICKET_ATTACHMENT_MAX_BYTES || (row.fileSize != null && bytes.length !== Number(row.fileSize))) {
      throw new TicketAttachmentReadError({ stage: "content_validation", kind: "content_invalid" });
    }
    try {
      const detectedMimeType = await sniffTicketAttachment(bytes, row.mimeType);
      if (detectedMimeType !== row.mimeType) throw new Error("Stored MIME type does not match metadata");
      return { bytes, fileName: safeFileName(row.fileName), mimeType: detectedMimeType, inline: inlineMimeTypes.has(detectedMimeType) };
    } catch (cause) {
      throw new TicketAttachmentReadError({ stage: "content_validation", kind: "content_invalid", cause });
    }
  }
  if (!storage.get) throw new TicketAttachmentReadError({ stage: "storage_config", kind: "config" });
  let reference: { url: string };
  try {
    reference = await storage.get(row.storageKey);
  } catch (error) {
    throw storageReadFailure(error);
  }
  let signedUrl: URL;
  try {
    signedUrl = new URL(reference.url);
    if (signedUrl.protocol !== "http:" && signedUrl.protocol !== "https:") throw new Error("Unsupported signed URL protocol");
  } catch (cause) {
    throw new TicketAttachmentReadError({ stage: "download_url", kind: "invalid_response", cause });
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, dependencies.timeoutMs ?? ENV.ticketAttachmentReadTimeoutMs);
  try {
    let response: globalThis.Response;
    try {
      response = await fetch(signedUrl, { signal: controller.signal });
    } catch (cause) {
      throw new TicketAttachmentReadError({ stage: "signed_fetch", kind: timedOut ? "timeout" : "transport", cause });
    }
    if (!response.ok) {
      throw new TicketAttachmentReadError({
        stage: "signed_fetch",
        kind: signedFetchFailureKind(response.status),
        providerStatus: response.status,
      });
    }
    try {
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (cause) {
      throw new TicketAttachmentReadError({ stage: "signed_fetch", kind: timedOut ? "timeout" : "transport", cause });
    }
  } finally {
    clearTimeout(timer);
  }
  if (bytes.length === 0 || bytes.length > TICKET_ATTACHMENT_MAX_BYTES || (row.fileSize != null && bytes.length !== Number(row.fileSize))) {
    throw new TicketAttachmentReadError({ stage: "content_validation", kind: "content_invalid" });
  }
  let detectedMimeType: AllowedTicketAttachmentMime;
  try {
    detectedMimeType = await sniffTicketAttachment(bytes, row.mimeType);
    if (detectedMimeType !== row.mimeType) throw new Error("Stored MIME type does not match metadata");
  } catch (cause) {
    throw new TicketAttachmentReadError({ stage: "content_validation", kind: "content_invalid", cause });
  }
  try {
    return { bytes, fileName: safeFileName(row.fileName), mimeType: detectedMimeType, inline: inlineMimeTypes.has(detectedMimeType) };
  } catch (cause) {
    throw new TicketAttachmentReadError({ stage: "content_validation", kind: "content_invalid", cause });
  }
}

export const TICKET_ATTACHMENT_CLEANUP_LIFECYCLE_VERSION = 1;

export type TicketAttachmentPhysicalCleanupInventory = { candidates: number };

type TicketAttachmentPhysicalCleanupCandidate = {
  attachmentId: string;
  clientId: string;
  chamadoId: string;
  state: string;
  cleanupLifecycleVersion: number | null;
  physicalCleanupEligibleAt: string | null;
};

export function isEligibleTicketAttachmentPhysicalCleanupCandidate(
  candidate: TicketAttachmentPhysicalCleanupCandidate,
  cutoff: Date,
): boolean {
  return candidate.state === "pending_delete"
    && Number(candidate.cleanupLifecycleVersion) === TICKET_ATTACHMENT_CLEANUP_LIFECYCLE_VERSION
    && typeof candidate.physicalCleanupEligibleAt === "string"
    && !Number.isNaN(Date.parse(candidate.physicalCleanupEligibleAt))
    && Date.parse(candidate.physicalCleanupEligibleAt) < cutoff.getTime();
}

/**
 * Bounded dry-run inventory. It never touches metadata or storage. The
 * eligibility marker is introduced without a backfill, which structurally
 * excludes historical pending_delete rows from this query.
 */
export async function inventoryEligibleTicketAttachmentPhysicalCleanup(options: {
  clientId: string;
  chamadoId: string;
  olderThanMs?: number;
  limit?: number;
  pool?: Pool;
}): Promise<TicketAttachmentPhysicalCleanupInventory> {
  if (!options.clientId?.trim() || !options.chamadoId?.trim()) {
    throw new Error("TICKET_ATTACHMENT_CLEANUP_SCOPE_REQUIRED");
  }
  const olderThanMs = options.olderThanMs ?? 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - Math.max(60_000, olderThanMs));
  const limit = Math.max(1, Math.min(1_000, options.limit ?? 100));
  const pool = options.pool ?? getPool();
  const [rows] = await pool.execute<Array<RowDataPacket & TicketAttachmentPhysicalCleanupCandidate>>(
    `SELECT attachment_id AS attachmentId, client_id AS clientId, chamado_id AS chamadoId,
            attachment_state AS state, cleanup_lifecycle_version AS cleanupLifecycleVersion,
            physical_cleanup_eligible_at AS physicalCleanupEligibleAt
     FROM megadesk_domain_chamado_attachments
     WHERE client_id=? AND chamado_id=?
       AND attachment_state='pending_delete'
       AND cleanup_lifecycle_version=${TICKET_ATTACHMENT_CLEANUP_LIFECYCLE_VERSION}
       AND physical_cleanup_eligible_at IS NOT NULL
       AND physical_cleanup_eligible_at < ?
     ORDER BY physical_cleanup_eligible_at ASC, attachment_id ASC
     LIMIT ${limit}`,
    [options.clientId, options.chamadoId, cutoff.toISOString().slice(0, 19).replace("T", " ")],
  );
  return { candidates: rows.filter(row => isEligibleTicketAttachmentPhysicalCleanupCandidate(row, cutoff)).length };
}

/**
 * The state transition is retained for failed uploads. Physical collection is
 * intentionally not performed here; it needs a separately authorized gate.
 */
export async function reconcileTicketAttachmentStates(
  olderThanMs = 60 * 60 * 1000,
  pool: Pool = getPool(),
): Promise<{ markedPendingDelete: number }> {
  const cutoff = new Date(Date.now() - Math.max(60_000, olderThanMs));
  const [result] = await pool.execute<any>(
    `UPDATE megadesk_domain_chamado_attachments
     SET attachment_state='pending_delete', pending_delete_at=NOW(), physical_cleanup_eligible_at=NOW()
     WHERE attachment_state='staged' AND cleanup_lifecycle_version=${TICKET_ATTACHMENT_CLEANUP_LIFECYCLE_VERSION}
       AND created_at < ?`,
    [cutoff.toISOString().slice(0, 19).replace("T", " ")],
  );
  return { markedPendingDelete: Number(result.affectedRows ?? 0) };
}

export function ticketAttachmentReadHttpStatus(error: unknown): number {
  if (error instanceof TicketAttachmentReadError) {
    if (error.stage === "local" && error.kind === "not_found") return 404;
    if (error.stage === "signed_fetch" && error.kind === "not_found") return 404;
    if (error.kind === "rate_limit" || error.kind === "server" || error.kind === "transport" || error.kind === "timeout") return 503;
    return 502;
  }
  if (error instanceof TicketAttachmentError) {
    if (error.code === "NOT_FOUND") return 404;
    if (error.code === "TOO_LARGE") return 413;
    if (error.code === "CONFLICT") return 409;
    if (error.code === "BAD_FILE") return 400;
  }
  return 502;
}

function safeCauseName(cause: unknown): string {
  return cause instanceof Error ? cause.name : typeof cause;
}

export function logTicketAttachmentReadFailure(
  error: unknown,
  input: { attachmentId: string; chamadoId: string; clientId: string },
): void {
  const failure = error instanceof TicketAttachmentReadError
    ? error
    : new TicketAttachmentReadError({ stage: "local", kind: "internal", cause: error });
  console.error("[Ticket Attachments]", {
    event: "ticket_attachment_read_failed",
    stage: failure.stage,
    kind: failure.kind,
    ...(failure.providerStatus == null ? {} : { providerStatus: failure.providerStatus }),
    attachmentId: input.attachmentId,
    chamadoId: input.chamadoId,
    clientId: input.clientId,
    cause: safeCauseName(failure.cause),
  });
}

export function createTicketAttachmentFileHandler(
  resolveIdentity: typeof resolveOperationalSessionReadOnly = resolveOperationalSessionReadOnly,
  readAttachment: typeof readTicketAttachment = readTicketAttachment,
) {
  return async (req: Request, res: Response): Promise<void> => {
    const identity = await resolveIdentity(req);
    if (!identity) { res.status(401).end(); return; }
    try {
      const attachment = await readAttachment(identity.tenantId, req.params.chamadoId, req.params.attachmentId);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "sandbox");
      res.setHeader("Content-Type", attachment.mimeType);
      res.setHeader("Content-Length", String(attachment.bytes.length));
      res.setHeader("Content-Disposition", ticketAttachmentContentDisposition(attachment.fileName, attachment.inline));
      res.status(200).send(attachment.bytes);
    } catch (error) {
      logTicketAttachmentReadFailure(error, {
        attachmentId: req.params.attachmentId,
        chamadoId: req.params.chamadoId,
        clientId: identity.tenantId,
      });
      res.status(ticketAttachmentReadHttpStatus(error)).end();
    }
  };
}

export function registerTicketAttachmentRoutes(app: Express): void {
  app.get("/api/chamados/:chamadoId/attachments/:attachmentId/file", createTicketAttachmentFileHandler());
}
