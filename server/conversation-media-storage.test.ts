import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdtemp, mkdir, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ConversationMediaStorageError,
  CONVERSATION_MEDIA_MAX_BYTES,
  listConversationMediaObjects,
  readConversationMedia,
  resolveConversationMediaPath,
  writeConversationMedia,
} from "./conversation-media-storage";

const tenantA = "tenant-a";
const tenantB = "tenant-b";

async function temporaryRoot() {
  return mkdtemp(path.join(os.tmpdir(), "megadesk-conversation-media-"));
}

describe.sequential("conversation media local storage", () => {
  it("writes and reads a V2 object with private tenant layout and verified metadata", async () => {
    const root = await temporaryRoot();
    const bytes = Buffer.from("conversation fixture");
    try {
      const reference = await writeConversationMedia({
        clientId: tenantA, bytes, mimeType: "image/png", fileName: "../../unsafe name.png", root,
      });
      expect(reference).toMatchObject({ version: 2, storage: "local", mimeType: "image/png", byteSize: bytes.length });
      expect(reference.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(reference.storageKey).toMatch(/^tenants\/tenant-a\/conversation-media\/[0-9a-f]{2}\/[0-9a-f-]+\.bin$/);
      expect(reference.storageKey).not.toContain("unsafe name");
      expect(path.isAbsolute(reference.storageKey)).toBe(false);
      expect(reference.fileName).toBe(".._.._unsafe name.png");
      expect(JSON.stringify(reference)).not.toMatch(/mediaData|base64|dataUrl|data:.*;base64/i);

      await expect(readConversationMedia({ clientId: tenantA, reference, root })).resolves.toMatchObject({ bytes, mimeType: "image/png" });
      const target = resolveConversationMediaPath(root, tenantA, reference.storageKey);
      expect((await lstat(target)).isSymbolicLink()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects cross-tenant reads, traversal and absolute keys", async () => {
    const root = await temporaryRoot();
    try {
      const reference = await writeConversationMedia({ clientId: tenantA, bytes: Buffer.from("tenant-a"), mimeType: "application/pdf", root });
      await expect(readConversationMedia({ clientId: tenantB, reference, root })).rejects.toMatchObject({ stage: "validation" });
      expect(() => resolveConversationMediaPath(root, tenantA, "../outside.bin")).toThrow(ConversationMediaStorageError);
      expect(() => resolveConversationMediaPath(root, tenantA, "C:/Windows/system.ini")).toThrow(ConversationMediaStorageError);
      expect(() => resolveConversationMediaPath(root, tenantA, "/etc/passwd")).toThrow(ConversationMediaStorageError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects V2 metadata that declares a size above the single storage limit", async () => {
    const reference = {
      version: 2 as const, storage: "local" as const,
      storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin",
      mimeType: "image/png", byteSize: CONVERSATION_MEDIA_MAX_BYTES + 1, sha256: "a".repeat(64),
    };
    await expect(readConversationMedia({ clientId: tenantA, reference, root: process.cwd() }))
      .rejects.toMatchObject({ stage: "validation" });
  });

  it("rejects oversized and mismatched files before calling readFile", async () => {
    const root = await temporaryRoot();
    try {
      const reference = await writeConversationMedia({ clientId: tenantA, bytes: Buffer.from("small"), mimeType: "image/png", root });
      const target = resolveConversationMediaPath(root, tenantA, reference.storageKey);
      const handle = await open(target, "r+");
      try { await handle.truncate(CONVERSATION_MEDIA_MAX_BYTES + 1); } finally { await handle.close(); }
      const read = vi.fn();
      await expect(readConversationMedia({ clientId: tenantA, reference, root }, { readFile: read as any }))
        .rejects.toMatchObject({ stage: "integrity" });
      expect(read).not.toHaveBeenCalled();

      await writeFile(target, Buffer.from("mismatch"));
      await expect(readConversationMedia({ clientId: tenantA, reference, root }, { readFile: read as any }))
        .rejects.toMatchObject({ stage: "integrity" });
      expect(read).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects empty, non-regular and hash-divergent objects while allowing valid objects", async () => {
    const root = await temporaryRoot();
    try {
      const reference = await writeConversationMedia({ clientId: tenantA, bytes: Buffer.from("secure"), mimeType: "application/pdf", root });
      const target = resolveConversationMediaPath(root, tenantA, reference.storageKey);
      await writeFile(target, Buffer.alloc(0));
      await expect(readConversationMedia({ clientId: tenantA, reference, root })).rejects.toMatchObject({ stage: "integrity" });

      await rm(target);
      await mkdir(target);
      await expect(readConversationMedia({ clientId: tenantA, reference, root })).rejects.toMatchObject({ stage: "read" });

      await rm(target, { recursive: true });
      await writeFile(target, Buffer.from("tamper"));
      await expect(readConversationMedia({ clientId: tenantA, reference, root })).rejects.toMatchObject({ stage: "integrity" });

      const valid = await writeConversationMedia({ clientId: tenantA, bytes: Buffer.from("valid"), mimeType: "application/pdf", root });
      await expect(readConversationMedia({ clientId: tenantA, reference: valid, root })).resolves.toMatchObject({ bytes: Buffer.from("valid") });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses an identical opaque object key for an outbound retry without a Data URL", async () => {
    const root = await temporaryRoot();
    const objectId = randomUUID();
    const bytes = Buffer.from("retry fixture");
    try {
      const first = await writeConversationMedia({ clientId: tenantA, bytes, mimeType: "application/pdf", objectId, root });
      const retry = await writeConversationMedia({ clientId: tenantA, bytes, mimeType: "application/pdf", objectId, root });
      expect(retry).toEqual(first);
      expect(JSON.stringify(retry)).not.toMatch(/mediaData|base64|dataUrl|data:.*;base64/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlink directory escape and leaves no final partial object after a failed write", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const objectId = randomUUID();
    try {
      await mkdir(path.join(root, "tenants"), { recursive: true });
      await symlink(outside, path.join(root, "tenants", tenantA), process.platform === "win32" ? "junction" : "dir");
      await expect(writeConversationMedia({ clientId: tenantA, bytes: Buffer.from("escape"), mimeType: "text/plain", root }))
        .rejects.toMatchObject({ stage: "directory" });

      await rm(path.join(root, "tenants", tenantA), { recursive: true, force: true });
      await mkdir(path.join(root, "tenants", tenantA, "conversation-media", objectId.slice(0, 2)), { recursive: true });
      const blockedShard = path.join(root, "tenants", tenantA, "conversation-media", objectId.slice(0, 2));
      await rm(blockedShard, { recursive: true, force: true });
      await (await import("node:fs/promises")).writeFile(blockedShard, "not-a-directory");

      await expect(writeConversationMedia({ clientId: tenantA, bytes: Buffer.from("partial"), mimeType: "text/plain", objectId, root }))
        .rejects.toBeInstanceOf(ConversationMediaStorageError);
      const finalPath = resolveConversationMediaPath(root, tenantA, `tenants/${tenantA}/conversation-media/${objectId.slice(0, 2)}/${objectId}.bin`);
      await expect(readFile(finalPath)).rejects.toMatchObject({ code: expect.stringMatching(/ENOENT|ENOTDIR/) });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("lists only validated relative objects for future dry-run reconciliation", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    try {
      const a = await writeConversationMedia({ clientId: tenantA, bytes: Buffer.from("a"), mimeType: "image/png", root });
      const b = await writeConversationMedia({ clientId: tenantB, bytes: Buffer.from("b"), mimeType: "image/png", root });
      await expect(listConversationMediaObjects({ root, clientId: tenantA })).resolves.toEqual([a.storageKey]);
      await expect(listConversationMediaObjects({ root })).resolves.toEqual([a.storageKey, b.storageKey].sort());

      const unsafeShard = path.join(root, "tenants", tenantA, "conversation-media", "ff");
      await symlink(outside, unsafeShard, process.platform === "win32" ? "junction" : "dir");
      await expect(listConversationMediaObjects({ root, clientId: tenantA }))
        .rejects.toMatchObject({ stage: "directory" });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
