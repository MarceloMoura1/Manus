import { createHash, randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { productMediaRoot } from "./product-media";

const CLIENT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const STORAGE_KEY = /^tenants\/([A-Za-z0-9_-]{1,80})\/conversation-media\/([0-9a-f]{2})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.bin$/i;

export const CONVERSATION_MEDIA_MAX_BYTES = 20 * 1024 * 1024;

export type ConversationMediaReferenceV2 = {
  version: 2;
  storage: "local";
  storageKey: string;
  mimeType: string;
  fileName?: string;
  byteSize: number;
  sha256: string;
};

export class ConversationMediaStorageError extends Error {
  constructor(public readonly stage: "validation" | "root" | "directory" | "write" | "read" | "remove" | "integrity") {
    super("CONVERSATION_MEDIA_STORAGE_ERROR");
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSafeConversationMediaMime(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 3 || value.length > 120) return false;
  const mime = value.toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime)) return false;
  if (mime === "image/svg+xml" || mime === "text/html" || mime === "application/xhtml+xml") return false;
  return mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/")
    || mime.startsWith("application/") || mime === "text/plain" || mime === "text/csv";
}

export function safeConversationMediaFileName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\\/\x00-\x1f\x7f"\r\n]/g, "_").trim().slice(0, 255);
  return cleaned || undefined;
}

export function isConversationMediaReferenceV2(value: unknown): value is ConversationMediaReferenceV2 {
  if (!record(value) || value.version !== 2 || value.storage !== "local") return false;
  if (typeof value.storageKey !== "string" || typeof value.mimeType !== "string"
    || typeof value.byteSize !== "number" || !Number.isSafeInteger(value.byteSize)
    || value.byteSize < 1 || value.byteSize > CONVERSATION_MEDIA_MAX_BYTES
    || typeof value.sha256 !== "string" || !SHA256.test(value.sha256) || !isSafeConversationMediaMime(value.mimeType)) return false;
  if (value.fileName !== undefined && typeof value.fileName !== "string") return false;
  const match = STORAGE_KEY.exec(value.storageKey);
  return Boolean(match && match[2].toLowerCase() === match[3].slice(0, 2).toLowerCase());
}

export function parseConversationMediaReferenceV2(value: unknown): ConversationMediaReferenceV2 | null {
  if (typeof value === "string") {
    try { return parseConversationMediaReferenceV2(JSON.parse(value)); } catch { return null; }
  }
  if (!isConversationMediaReferenceV2(value)) return null;
  return {
    version: 2,
    storage: "local",
    storageKey: value.storageKey,
    mimeType: value.mimeType.toLowerCase(),
    ...(safeConversationMediaFileName(value.fileName) ? { fileName: safeConversationMediaFileName(value.fileName) } : {}),
    byteSize: value.byteSize,
    sha256: value.sha256.toLowerCase(),
  };
}

export function conversationMediaStorageKey(clientId: string, objectId: string): string {
  if (!CLIENT_ID.test(clientId) || !UUID.test(objectId)) throw new ConversationMediaStorageError("validation");
  const normalized = objectId.toLowerCase();
  return `tenants/${clientId}/conversation-media/${normalized.slice(0, 2)}/${normalized}.bin`;
}

function safeRoot(root: string): string {
  if (!root || !path.isAbsolute(root)) throw new ConversationMediaStorageError("root");
  return path.resolve(root);
}

function assertDirectory(directory: string, stage: "root" | "directory"): void {
  try {
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("unsafe directory");
  } catch (error) {
    if (error instanceof ConversationMediaStorageError) throw error;
    throw new ConversationMediaStorageError(stage);
  }
}

async function ensurePrivateDirectoryChain(root: string, target: string): Promise<void> {
  try {
    await mkdir(root, { recursive: true });
    assertDirectory(root, "root");
    const relative = path.relative(root, path.dirname(target));
    let current = root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      await mkdir(current).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      });
      assertDirectory(current, "directory");
    }
  } catch (error) {
    if (error instanceof ConversationMediaStorageError) throw error;
    throw new ConversationMediaStorageError("directory");
  }
}

function assertPrivateDirectoryChain(root: string, target: string): void {
  assertDirectory(root, "root");
  const relative = path.relative(root, path.dirname(target));
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    assertDirectory(current, "directory");
  }
}

export function resolveConversationMediaPath(root: string, clientId: string, storageKey: string): string {
  const canonicalRoot = safeRoot(root);
  if (!CLIENT_ID.test(clientId)) throw new ConversationMediaStorageError("validation");
  const match = STORAGE_KEY.exec(storageKey);
  if (!match || match[1] !== clientId || match[2].toLowerCase() !== match[3].slice(0, 2).toLowerCase()) {
    throw new ConversationMediaStorageError("validation");
  }
  const target = path.resolve(canonicalRoot, ...storageKey.split("/"));
  if (!target.startsWith(`${canonicalRoot}${path.sep}`)) throw new ConversationMediaStorageError("validation");
  return target;
}

async function atomicWrite(target: string, bytes: Buffer): Promise<void> {
  try {
    const existingInfo = await (async () => {
      try { return lstatSync(target); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    })();
    if (existingInfo) {
      if (!existingInfo.isFile() || existingInfo.isSymbolicLink()) throw new ConversationMediaStorageError("write");
      if ((await readFile(target)).equals(bytes)) return;
      throw new ConversationMediaStorageError("write");
    }
    const temporary = `${target}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporary, target);
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof ConversationMediaStorageError) throw error;
    throw new ConversationMediaStorageError("write");
  }
}

export async function writeConversationMedia(input: {
  clientId: string;
  bytes: Buffer;
  mimeType: string;
  fileName?: string | null;
  objectId?: string;
  root?: string;
}): Promise<ConversationMediaReferenceV2> {
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length < 1 || input.bytes.length > CONVERSATION_MEDIA_MAX_BYTES
    || !isSafeConversationMediaMime(input.mimeType)) throw new ConversationMediaStorageError("validation");
  const root = safeRoot(input.root ?? productMediaRoot());
  const objectId = input.objectId ?? randomUUID();
  const storageKey = conversationMediaStorageKey(input.clientId, objectId);
  const target = resolveConversationMediaPath(root, input.clientId, storageKey);
  await ensurePrivateDirectoryChain(root, target);
  await atomicWrite(target, input.bytes);
  const fileName = safeConversationMediaFileName(input.fileName);
  return {
    version: 2,
    storage: "local",
    storageKey,
    mimeType: input.mimeType.toLowerCase(),
    ...(fileName ? { fileName } : {}),
    byteSize: input.bytes.length,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
  };
}

export async function readConversationMedia(input: {
  clientId: string;
  reference: ConversationMediaReferenceV2;
  root?: string;
}, dependencies: { readFile?: typeof readFile } = {}): Promise<{ bytes: Buffer; mimeType: string; fileName?: string }> {
  const reference = parseConversationMediaReferenceV2(input.reference);
  if (!reference) throw new ConversationMediaStorageError("validation");
  const root = safeRoot(input.root ?? productMediaRoot());
  const target = resolveConversationMediaPath(root, input.clientId, reference.storageKey);
  try {
    assertPrivateDirectoryChain(root, target);
    const info = lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("unsafe object");
    if (info.size < 1 || info.size > CONVERSATION_MEDIA_MAX_BYTES || info.size !== reference.byteSize) {
      throw new ConversationMediaStorageError("integrity");
    }
    const bytes = await (dependencies.readFile ?? readFile)(target);
    if (bytes.length !== reference.byteSize || createHash("sha256").update(bytes).digest("hex") !== reference.sha256) {
      throw new ConversationMediaStorageError("integrity");
    }
    return { bytes, mimeType: reference.mimeType, ...(reference.fileName ? { fileName: reference.fileName } : {}) };
  } catch (error) {
    if (error instanceof ConversationMediaStorageError) throw error;
    throw new ConversationMediaStorageError("read");
  }
}

export async function removeConversationMedia(input: {
  clientId: string;
  reference: ConversationMediaReferenceV2;
  root?: string;
}): Promise<void> {
  const reference = parseConversationMediaReferenceV2(input.reference);
  if (!reference) throw new ConversationMediaStorageError("validation");
  const root = safeRoot(input.root ?? productMediaRoot());
  const target = resolveConversationMediaPath(root, input.clientId, reference.storageKey);
  try {
    assertPrivateDirectoryChain(root, target);
    const info = lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("unsafe object");
    await rm(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    if (error instanceof ConversationMediaStorageError) throw error;
    throw new ConversationMediaStorageError("remove");
  }
}

async function safeDirectoryNames(directory: string): Promise<string[]> {
  try {
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new ConversationMediaStorageError("directory");
    return await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    if (error instanceof ConversationMediaStorageError) throw error;
    throw new ConversationMediaStorageError("directory");
  }
}

/**
 * Read-only inventory primitive for a future orphan reconciler. It never follows
 * symbolic links, returns only validated relative keys, and never touches a database.
 */
export async function listConversationMediaObjects(input: { root?: string; clientId?: string } = {}): Promise<string[]> {
  const root = safeRoot(input.root ?? productMediaRoot());
  assertDirectory(root, "root");
  if (input.clientId !== undefined && !CLIENT_ID.test(input.clientId)) throw new ConversationMediaStorageError("validation");
  const tenantIds = input.clientId ? [input.clientId] : await safeDirectoryNames(path.join(root, "tenants"));
  const keys: string[] = [];
  for (const clientId of tenantIds) {
    if (!CLIENT_ID.test(clientId)) continue;
    const mediaDirectory = path.join(root, "tenants", clientId, "conversation-media");
    for (const shard of await safeDirectoryNames(mediaDirectory)) {
      if (!/^[0-9a-f]{2}$/i.test(shard)) continue;
      const shardDirectory = path.join(mediaDirectory, shard);
      for (const name of await safeDirectoryNames(shardDirectory)) {
        if (!name.endsWith(".bin") || !UUID.test(name.slice(0, -4))) continue;
        const storageKey = `tenants/${clientId}/conversation-media/${shard}/${name}`;
        const target = resolveConversationMediaPath(root, clientId, storageKey);
        try {
          const info = lstatSync(target);
          if (info.isFile() && !info.isSymbolicLink()) keys.push(storageKey);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ConversationMediaStorageError("directory");
        }
      }
    }
  }
  return keys.sort();
}

/** Converts a transient, validated Data URL into bytes. The caller must not persist the URL. */
export function decodeConversationMediaDataUrl(dataUrl: string, declaredMimeType: string): { bytes: Buffer; mimeType: string } | null {
  if (typeof dataUrl !== "string" || typeof declaredMimeType !== "string") return null;
  const match = /^data:([^,]+),([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) return null;
  const metadata = match[1].split(";").map(part => part.trim()).filter(Boolean);
  const mimeType = metadata.shift()?.toLowerCase() ?? "";
  if (!metadata.some(part => part.toLowerCase() === "base64")) return null;
  if (mimeType !== declaredMimeType.split(";", 1)[0].trim().toLowerCase() || !isSafeConversationMediaMime(mimeType)) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > CONVERSATION_MEDIA_MAX_BYTES) return null;
  return { bytes, mimeType };
}

export function containsConversationMediaBinary(value: unknown, depth = 0): boolean {
  if (depth > 16 || value == null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(item => containsConversationMediaBinary(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) =>
    key === "base64" || key === "mediaData" || key === "dataUrl" || containsConversationMediaBinary(nested, depth + 1));
}

export function publicConversationMediaMetadata(value: unknown, messageId: unknown): Record<string, unknown> | null {
  const id = typeof messageId === "string" && messageId.trim() ? messageId : null;
  if (!id || !record(value)) return null;
  const v2 = parseConversationMediaReferenceV2(value);
  if (v2) {
    return { mimeType: v2.mimeType, ...(v2.fileName ? { fileName: v2.fileName } : {}), byteSize: v2.byteSize,
      mediaReference: { storage: "private", messageId: id } };
  }
  const mimeType = isSafeConversationMediaMime(value.mimeType) ? value.mimeType.toLowerCase() : undefined;
  const fileName = safeConversationMediaFileName(value.fileName);
  if (typeof value.mediaData === "string" || typeof value.base64 === "string" || typeof value.dataUrl === "string") {
    return { ...(mimeType ? { mimeType } : {}), ...(fileName ? { fileName } : {}), mediaReference: { storage: "private", messageId: id } };
  }
  return null;
}
