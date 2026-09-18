import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createLocalTicketAttachmentStorage,
  listTicketAttachments,
  readTicketAttachment,
  resolveTicketAttachmentPath,
  TicketAttachmentError,
  TicketAttachmentStorageError,
  TICKET_ATTACHMENT_MAX_BYTES,
  uploadTicketAttachment,
} from "./chamados-attachments";
import { logicallyRemoveTicketAttachment } from "./chamados-domain";
import { productMediaRoot } from "./product-media";

const chamadoId = "11111111-1111-4111-8111-111111111111";
const attemptId = "22222222-2222-4222-8222-222222222222";
const tenantId = "tenant-a";
const actor = { userId: "operator-a", userName: "Operadora Sintética" };

type AttachmentRow = {
  attachmentId: string;
  chamadoId: string;
  clientId: string;
  fileName: string;
  storageKey: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  uploadedByUserId: string;
  sha256: string;
  clientAttemptId: string;
  state: "staged" | "active" | "pending_delete" | "deleted";
  createdAt: string;
  pendingDeleteAt: string | null;
};

function controlledPool() {
  const attachments = new Map<string, AttachmentRow>();
  const activities: Array<{ actionType: string; metadata: unknown }> = [];
  const execute = vi.fn(async (sqlValue: string, params: unknown[] = []) => {
    const sql = String(sqlValue);
    if (sql.includes("FROM megadesk_domain_chamados") && sql.includes("FOR UPDATE")) {
      return [[params[0] === tenantId && params[1] === chamadoId ? {
        chamadoId, clientId: tenantId, customerId: null, customerName: "Cliente Sintético", customerPhone: null,
        customerEmail: null, customerCNPJ: null, company: "Fixture", title: "Chamado sintético", observations: null,
        status: "open", priority: "media", assignedTo: null, assignedToUserId: null,
      } : undefined].filter(Boolean), []];
    }
    if (sql.startsWith("INSERT INTO megadesk_domain_chamado_attachments")) {
      const [attachmentId, ticket, clientId, fileName, storageKey, fileSize, mimeType, uploadedBy, uploadedByUserId, sha256, clientAttemptId] = params as [string, string, string, string, string, number, string, string, string, string, string];
      if (![...attachments.values()].some(row => row.clientId === clientId && row.clientAttemptId === clientAttemptId)) {
        attachments.set(attachmentId, { attachmentId, chamadoId: ticket, clientId, fileName, storageKey, fileSize, mimeType, uploadedBy, uploadedByUserId, sha256, clientAttemptId, state: "staged", createdAt: "2026-09-16T12:00:00.000Z", pendingDeleteAt: null });
      }
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes("FROM megadesk_domain_chamado_attachments WHERE client_id=? AND client_attempt_id=?")) {
      const row = [...attachments.values()].find(value => value.clientId === params[0] && value.clientAttemptId === params[1]);
      return [row ? [{ attachmentId: row.attachmentId, storageKey: row.storageKey, state: row.state, chamadoId: row.chamadoId, clientId: row.clientId, sha256: row.sha256 }] : [], []];
    }
    if (sql.startsWith("UPDATE megadesk_domain_chamado_attachments") && sql.includes("SET attachment_state='active'")) {
      const row = attachments.get(String(params[0]));
      if (!row || row.chamadoId !== params[1] || row.clientId !== params[2] || row.state !== "staged") return [{ affectedRows: 0 }, []];
      row.state = "active";
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith("INSERT INTO megadesk_domain_chamado_activities")) {
      activities.push({ actionType: String(params[6]), metadata: JSON.parse(String(params[7])) });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes("SELECT attachment_id AS attachmentId") && sql.includes("attachment_state NOT IN")) {
      return [[...attachments.values()].filter(row => row.chamadoId === params[0] && row.clientId === params[1] && !["pending_delete", "deleted"].includes(row.state)).map(row => ({
        attachmentId: row.attachmentId, fileName: row.fileName, fileSize: row.fileSize, mimeType: row.mimeType,
        uploadedBy: row.uploadedBy, createdAt: row.createdAt, state: row.state, storageKey: row.storageKey,
      })), []];
    }
    if (sql.includes("SELECT a.storage_key AS storageKey")) {
      const row = attachments.get(String(params[0]));
      return [row && row.chamadoId === params[1] && row.clientId === params[2] && row.state === "active" ? [{
        storageKey: row.storageKey, fileName: row.fileName, mimeType: row.mimeType, fileSize: row.fileSize, state: row.state,
      }] : [], []];
    }
    if (sql.startsWith("DELETE FROM megadesk_domain_chamado_attachments")) {
      const row = attachments.get(String(params[0]));
      if (!row || row.clientId !== params[1] || row.state !== "staged") return [{ affectedRows: 0 }, []];
      attachments.delete(row.attachmentId);
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes("SET attachment_state='pending_delete'") && sql.includes("attachment_state='staged'")) {
      const row = attachments.get(String(params[0]));
      if (!row || row.clientId !== params[1] || row.state !== "staged") return [{ affectedRows: 0 }, []];
      row.state = "pending_delete";
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes("SELECT attachment_state AS state, file_name AS fileName")) {
      const row = attachments.get(String(params[0]));
      return [row && row.chamadoId === params[1] && row.clientId === params[2] ? [{ state: row.state, fileName: row.fileName, mimeType: row.mimeType, fileSize: row.fileSize, sha256: row.sha256 }] : [], []];
    }
    if (sql.includes("SET attachment_state='pending_delete', pending_delete_at=NOW()")) {
      const row = attachments.get(String(params[0]));
      if (!row || row.chamadoId !== params[1] || row.clientId !== params[2] || row.state !== "active") return [{ affectedRows: 0 }, []];
      row.state = "pending_delete";
      row.pendingDeleteAt = "set";
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected SQL in attachment fixture: ${sql}`);
  });
  const connection = { execute, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
  return { pool: { execute, getConnection: vi.fn(async () => connection) } as any, attachments, activities, execute };
}

describe.sequential("local ticket attachment storage", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), `megadesk-attachment-test-${process.pid}-`));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resolves the same persistent media root used by the runtime outside immutable releases", () => {
    const previous = { nodeEnv: process.env.NODE_ENV, configured: process.env.MEGADESK_MEDIA_ROOT, local: process.env.LOCALAPPDATA };
    process.env.NODE_ENV = "production";
    delete process.env.MEGADESK_MEDIA_ROOT;
    process.env.LOCALAPPDATA = "C:\\Users\\Synthetic\\AppData\\Local";
    try {
      expect(productMediaRoot()).toBe(path.resolve("C:\\Users\\Synthetic\\AppData\\Local", "MegaDesk", "media"));
      expect(productMediaRoot()).not.toContain(`${path.sep}releases${path.sep}`);
    } finally {
      if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
      if (previous.configured === undefined) delete process.env.MEGADESK_MEDIA_ROOT; else process.env.MEGADESK_MEDIA_ROOT = previous.configured;
      if (previous.local === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = previous.local;
    }
  });

  it("reproduces the legacy Forge-only configuration failure without network or real data", async () => {
    const previousUrl = process.env.BUILT_IN_FORGE_API_URL;
    const previousKey = process.env.BUILT_IN_FORGE_API_KEY;
    delete process.env.BUILT_IN_FORGE_API_URL;
    delete process.env.BUILT_IN_FORGE_API_KEY;
    vi.resetModules();
    try {
      const { storagePutExact } = await import("./storage");
      await expect(storagePutExact("ticket-attachments/22/22222222-2222-4222-8222-222222222222", Buffer.from("fixture"), "text/plain"))
        .rejects.toThrow("Storage proxy credentials missing");
    } finally {
      if (previousUrl === undefined) delete process.env.BUILT_IN_FORGE_API_URL; else process.env.BUILT_IN_FORGE_API_URL = previousUrl;
      if (previousKey === undefined) delete process.env.BUILT_IN_FORGE_API_KEY; else process.env.BUILT_IN_FORGE_API_KEY = previousKey;
      vi.resetModules();
    }
  });

  it("completes upload, metadata, audit, listing, private read, tenant isolation and logical removal", async () => {
    const controlled = controlledPool();
    const storage = createLocalTicketAttachmentStorage(root);
    const bytes = Buffer.from("isolated attachment fixture", "utf8");
    const uploaded = await uploadTicketAttachment({
      chamadoId, clientId: tenantId, actor, clientAttemptId: attemptId, fileName: "evidence.txt",
      declaredMimeType: "text/plain", fileBase64: bytes.toString("base64"),
    }, { pool: controlled.pool, storage });

    const row = controlled.attachments.get(uploaded.attachmentId)!;
    expect(row).toMatchObject({ state: "active", clientId: tenantId, chamadoId, mimeType: "text/plain", fileSize: bytes.length });
    expect(controlled.activities).toHaveLength(1);
    expect(controlled.activities[0]).toMatchObject({ actionType: "attachment_added", metadata: { eventType: "attachment_added", attachmentId: uploaded.attachmentId } });
    expect(await listTicketAttachments(chamadoId, tenantId, controlled.pool)).toEqual([expect.objectContaining({ attachmentId: uploaded.attachmentId, canView: true })]);
    await expect(readTicketAttachment(tenantId, chamadoId, uploaded.attachmentId, { pool: controlled.pool, storage }))
      .resolves.toMatchObject({ bytes, mimeType: "text/plain", fileName: "evidence.txt" });
    await expect(readTicketAttachment("tenant-b", chamadoId, uploaded.attachmentId, { pool: controlled.pool, storage }))
      .rejects.toMatchObject({ code: "NOT_FOUND", stage: "local" });

    const objectPath = resolveTicketAttachmentPath(root, row.storageKey);
    expect(await readdir(path.dirname(objectPath))).toEqual([path.basename(objectPath)]);
    await expect(logicallyRemoveTicketAttachment({ attachmentId: uploaded.attachmentId, chamadoId, clientId: tenantId, actor }, controlled.pool))
      .resolves.toMatchObject({ logicallyRemoved: true, state: "pending_delete", reused: false });
    expect(controlled.activities.map(activity => activity.actionType)).toEqual(["attachment_added", "attachment_removed"]);
    expect(await listTicketAttachments(chamadoId, tenantId, controlled.pool)).toEqual([]);
    await expect(readTicketAttachment(tenantId, chamadoId, uploaded.attachmentId, { pool: controlled.pool, storage }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each([
    {
      label: "PNG",
      attempt: "33333333-3333-4333-8333-333333333333",
      fileName: "captura.png",
      mimeType: "image/png",
      bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    },
    {
      label: "PDF",
      attempt: "44444444-4444-4444-8444-444444444444",
      fileName: "relatorio.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF", "utf8"),
    },
  ])("persists and privately reads an authenticated $label fixture without duplicate activity", async fixture => {
    const controlled = controlledPool();
    const storage = createLocalTicketAttachmentStorage(root);
    const input = {
      chamadoId,
      clientId: tenantId,
      actor,
      clientAttemptId: fixture.attempt,
      fileName: fixture.fileName,
      declaredMimeType: fixture.mimeType,
      fileBase64: fixture.bytes.toString("base64"),
    };

    const uploaded = await uploadTicketAttachment(input, { pool: controlled.pool, storage });
    const replay = await uploadTicketAttachment(input, { pool: controlled.pool, storage });
    const read = await readTicketAttachment(tenantId, chamadoId, uploaded.attachmentId, { pool: controlled.pool, storage });

    expect(replay).toEqual({ attachmentId: uploaded.attachmentId, reused: true });
    expect(read).toMatchObject({ bytes: fixture.bytes, mimeType: fixture.mimeType, fileName: fixture.fileName, inline: true });
    expect(controlled.activities).toHaveLength(1);
    expect(controlled.activities[0]).toMatchObject({
      actionType: "attachment_added",
      metadata: { eventType: "attachment_added", attachmentId: uploaded.attachmentId },
    });
  });

  it("returns a controlled local-storage failure when active metadata points to a missing file", async () => {
    const controlled = controlledPool();
    const storage = createLocalTicketAttachmentStorage(root);
    const bytes = Buffer.from("missing file fixture", "utf8");
    const uploaded = await uploadTicketAttachment({
      chamadoId,
      clientId: tenantId,
      actor,
      clientAttemptId: "55555555-5555-4555-8555-555555555555",
      fileName: "missing.txt",
      declaredMimeType: "text/plain",
      fileBase64: bytes.toString("base64"),
    }, { pool: controlled.pool, storage });
    const row = controlled.attachments.get(uploaded.attachmentId)!;
    await rm(resolveTicketAttachmentPath(root, row.storageKey));

    await expect(readTicketAttachment(tenantId, chamadoId, uploaded.attachmentId, { pool: controlled.pool, storage }))
      .rejects.toMatchObject({ stage: "local_storage", kind: "internal" });
  });

  it("blocks an intermediate symlink from escaping the private storage root", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), `megadesk-attachment-outside-${process.pid}-`));
    const key = "ticket-attachments/22/22222222-2222-4222-8222-222222222222";
    try {
      await mkdir(path.join(outside, "22"), { recursive: true });
      await writeFile(path.join(outside, "22", "22222222-2222-4222-8222-222222222222"), "outside");
      await symlink(outside, path.join(root, "ticket-attachments"), process.platform === "win32" ? "junction" : "dir");

      await expect(createLocalTicketAttachmentStorage(root).readExact!(key))
        .rejects.toMatchObject<TicketAttachmentStorageError>({ stage: "directory" });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("compensates a failed write without metadata, activity, final object or temporary file", async () => {
    const controlled = controlledPool();
    const local = createLocalTicketAttachmentStorage(root);
    const failing = {
      putExact: vi.fn(async () => { throw new TicketAttachmentStorageError("write", new Error("synthetic")); }),
      readExact: local.readExact,
      removeExact: local.removeExact,
    };
    await expect(uploadTicketAttachment({
      chamadoId, clientId: tenantId, actor, clientAttemptId: attemptId, fileName: "failure.txt",
      declaredMimeType: "text/plain", fileBase64: Buffer.from("failure fixture").toString("base64"),
    }, { pool: controlled.pool, storage: failing })).rejects.toMatchObject<TicketAttachmentError>({ code: "STORAGE", storageStage: "write" });
    expect(controlled.attachments.size).toBe(0);
    expect(controlled.activities).toEqual([]);
    expect(await readdir(root)).toEqual([]);
  });

  it("rejects traversal, oversized payloads and incompatible content before persistence", async () => {
    expect(() => resolveTicketAttachmentPath(root, "../../Windows/system.ini")).toThrow(TicketAttachmentStorageError);
    const controlled = controlledPool();
    const storage = createLocalTicketAttachmentStorage(root);
    await expect(uploadTicketAttachment({ chamadoId, clientId: tenantId, actor, clientAttemptId: attemptId, fileName: "large.bin", declaredMimeType: "text/plain", fileBase64: Buffer.alloc(TICKET_ATTACHMENT_MAX_BYTES + 1, 65).toString("base64") }, { pool: controlled.pool, storage }))
      .rejects.toMatchObject({ code: "TOO_LARGE" });
    await expect(uploadTicketAttachment({ chamadoId, clientId: tenantId, actor, clientAttemptId: attemptId, fileName: "fake.png", declaredMimeType: "image/png", fileBase64: Buffer.from("<svg></svg>").toString("base64") }, { pool: controlled.pool, storage }))
      .rejects.toMatchObject({ code: "BAD_FILE" });
    expect(controlled.attachments.size).toBe(0);
    expect(controlled.execute).not.toHaveBeenCalled();
  });
});
