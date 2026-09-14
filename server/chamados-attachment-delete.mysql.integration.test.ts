import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { MAIN_MIGRATIONS_DIR, applyCanonicalMigrations } from "./_core/canonical-migrations";
import { logicallyRemoveTicketAttachment } from "./chamados-domain";
import { listTicketAttachments, readTicketAttachment, TicketAttachmentError } from "./chamados-attachments";

const physical = describe.runIf(process.env.RUN_ATTACHMENT_DELETE_MYSQL_INTEGRATION === "1");

const DATABASE = "megadesk_test_chamados_0024_logical_delete";
const TENANT_A = "attachment-delete-tenant-a";
const TENANT_B = "attachment-delete-tenant-b";
const ACTOR = { userId: "attachment-delete-operator", userName: "Operador Sintético" };

let pool: Pool;

function testUrl(): string {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error("TEST_DATABASE_URL is required for the attachment-delete disposable integration suite.");
  const url = new URL(raw);
  if (url.protocol !== "mysql:" || url.hostname !== "127.0.0.1" || url.port !== "33326" || decodeURIComponent(url.pathname.slice(1)) !== DATABASE) {
    throw new Error("Attachment-delete integration refused a database outside the dedicated 127.0.0.1:33326 disposable instance.");
  }
  return url.toString();
}

async function scalar(connection: Pool, sql: string, values: unknown[] = []): Promise<number> {
  const [rows] = await connection.execute<Array<RowDataPacket & { value: number }>>(sql, values);
  return Number(rows[0]?.value ?? 0);
}

async function insertTicket(chamadoId: string, clientId = TENANT_A, number = 1): Promise<void> {
  await pool.execute(
    `INSERT INTO megadesk_domain_chamados (chamadoId, clientId, chamadoNumber, title)
     VALUES (?, ?, ?, 'Chamado sintético de remoção')`,
    [chamadoId, clientId, number],
  );
}

async function insertAttachment(attachmentId: string, chamadoId: string, clientId = TENANT_A): Promise<void> {
  await pool.execute(
    `INSERT INTO megadesk_domain_chamado_attachments
      (attachment_id, chamado_id, client_id, file_name, storage_key, file_size, mime_type,
       uploaded_by, uploaded_by_user_id, sha256, client_attempt_id, attachment_state)
     VALUES (?, ?, ?, 'evidence.txt', ?, 17, 'text/plain', ?, ?, ?, ?, 'active')`,
    [
      attachmentId,
      chamadoId,
      clientId,
      `ticket-attachments/${attachmentId.slice(0, 2)}/${attachmentId}`,
      ACTOR.userName,
      ACTOR.userId,
      "a".repeat(64),
      attachmentId,
    ],
  );
}

async function attachmentState(attachmentId: string): Promise<{ state: string; pendingDeleteAt: string | null }> {
  const [rows] = await pool.execute<Array<RowDataPacket & { state: string; pendingDeleteAt: string | null }>>(
    `SELECT attachment_state AS state,
            DATE_FORMAT(pending_delete_at, '%Y-%m-%d %H:%i:%s') AS pendingDeleteAt
     FROM megadesk_domain_chamado_attachments WHERE attachment_id=?`,
    [attachmentId],
  );
  return rows[0]!;
}

physical.sequential("0024 logical attachment deletion against disposable MySQL", () => {
  beforeAll(async () => {
    pool = mysql.createPool({ uri: testUrl(), timezone: "Z" });
    expect(await scalar(pool, "SELECT COUNT(*) AS value FROM __drizzle_migrations")).toBe(24);
    await insertTicket("11111111-1111-4111-8111-111111111111", TENANT_A, 1);
    await insertTicket("33333333-3333-4333-8333-333333333333", TENANT_A, 2);
    await insertTicket("44444444-4444-4444-8444-444444444444", TENANT_A, 3);
    await insertTicket("55555555-5555-4555-8555-555555555555", TENANT_A, 4);
    await insertAttachment("22222222-2222-4222-8222-222222222222", "11111111-1111-4111-8111-111111111111");
    await insertAttachment("66666666-6666-4666-8666-666666666666", "33333333-3333-4333-8333-333333333333");
    await insertAttachment("77777777-7777-4777-8777-777777777777", "44444444-4444-4444-8444-444444444444");
    await insertAttachment("88888888-8888-4888-8888-888888888888", "55555555-5555-4555-8555-555555555555");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("upgrades the 0023 baseline with legacy fixtures and preserves the physical contract", async () => {
    expect(await scalar(pool, "SELECT COUNT(*) AS value FROM __drizzle_migrations")).toBe(24);
    await applyCanonicalMigrations(testUrl(), MAIN_MIGRATIONS_DIR);
    expect(await scalar(pool, "SELECT COUNT(*) AS value FROM __drizzle_migrations")).toBe(25);
    expect(await scalar(pool, "SELECT COUNT(*) AS value FROM __drizzle_migrations WHERE hash IS NULL OR created_at IS NULL")).toBe(0);
    const [pendingColumn] = await pool.query<Array<RowDataPacket & { Type: string; Null: string }>>("SHOW COLUMNS FROM megadesk_domain_chamado_attachments LIKE 'pending_delete_at'");
    expect(pendingColumn[0]).toMatchObject({ Type: "timestamp", Null: "YES" });
    const [actionColumn] = await pool.query<Array<RowDataPacket & { Type: string; Null: string; Default: string }>>("SHOW COLUMNS FROM megadesk_domain_chamado_activities LIKE 'action_type'");
    expect(actionColumn[0]).toMatchObject({ Null: "NO", Default: "note" });
    expect(actionColumn[0]?.Type).toContain("attachment_removed");
  });

  it("changes active to pending_delete exactly once and is idempotent", async () => {
    const input = { attachmentId: "22222222-2222-4222-8222-222222222222", chamadoId: "11111111-1111-4111-8111-111111111111", clientId: TENANT_A, actor: ACTOR };
    await expect(logicallyRemoveTicketAttachment(input, pool)).resolves.toEqual({ logicallyRemoved: true, state: "pending_delete", reused: false });
    const first = await attachmentState(input.attachmentId);
    expect(first.state).toBe("pending_delete");
    expect(first.pendingDeleteAt).not.toBeNull();
    expect(await scalar(pool, "SELECT COUNT(*) AS value FROM megadesk_domain_chamado_activities WHERE chamado_id=? AND action_type='attachment_removed'", [input.chamadoId])).toBe(1);
    await expect(logicallyRemoveTicketAttachment(input, pool)).resolves.toEqual({ logicallyRemoved: true, state: "pending_delete", reused: true });
    expect(await attachmentState(input.attachmentId)).toEqual(first);
    expect(await scalar(pool, "SELECT COUNT(*) AS value FROM megadesk_domain_chamado_activities WHERE chamado_id=? AND action_type='attachment_removed'", [input.chamadoId])).toBe(1);
  });

  it("uses two independent pools safely under concurrent deletion", async () => {
    const input = { attachmentId: "66666666-6666-4666-8666-666666666666", chamadoId: "33333333-3333-4333-8333-333333333333", clientId: TENANT_A, actor: ACTOR };
    const firstPool = mysql.createPool({ uri: testUrl(), connectionLimit: 1, timezone: "Z" });
    const secondPool = mysql.createPool({ uri: testUrl(), connectionLimit: 1, timezone: "Z" });
    try {
      const results = await Promise.all([logicallyRemoveTicketAttachment(input, firstPool), logicallyRemoveTicketAttachment(input, secondPool)]);
      expect(results.map(result => result.reused).sort()).toEqual([false, true]);
    } finally {
      await firstPool.end();
      await secondPool.end();
    }
    expect((await attachmentState(input.attachmentId)).state).toBe("pending_delete");
    expect(await scalar(pool, "SELECT COUNT(*) AS value FROM megadesk_domain_chamado_activities WHERE chamado_id=? AND action_type='attachment_removed'", [input.chamadoId])).toBe(1);
  });

  it("rolls back the state transition when the audit insert fails", async () => {
    await pool.query(`CREATE TRIGGER megadesk_0024_attachment_delete_rollback BEFORE INSERT ON megadesk_domain_chamado_activities
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic attachment removal audit failure'`);
    const input = { attachmentId: "77777777-7777-4777-8777-777777777777", chamadoId: "44444444-4444-4444-8444-444444444444", clientId: TENANT_A, actor: ACTOR };
    try {
      await expect(logicallyRemoveTicketAttachment(input, pool)).rejects.toThrow("synthetic attachment removal audit failure");
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS megadesk_0024_attachment_delete_rollback");
    }
    expect(await attachmentState(input.attachmentId)).toEqual({ state: "active", pendingDeleteAt: null });
    expect(await scalar(pool, "SELECT COUNT(*) AS value FROM megadesk_domain_chamado_activities WHERE chamado_id=? AND action_type='attachment_removed'", [input.chamadoId])).toBe(0);
  });

  it("rejects a different tenant without a state transition or an audit row", async () => {
    const input = { attachmentId: "88888888-8888-4888-8888-888888888888", chamadoId: "55555555-5555-4555-8555-555555555555", clientId: TENANT_B, actor: ACTOR };
    await expect(logicallyRemoveTicketAttachment(input, pool)).rejects.toThrow("ATTACHMENT_NOT_FOUND");
    expect(await attachmentState(input.attachmentId)).toEqual({ state: "active", pendingDeleteAt: null });
    expect(await scalar(pool, "SELECT COUNT(*) AS value FROM megadesk_domain_chamado_activities WHERE chamado_id=? AND action_type='attachment_removed'", [input.chamadoId])).toBe(0);
  });

  it("hides a pending-delete attachment from normal listing and private reads without touching storage", async () => {
    const chamadoId = "11111111-1111-4111-8111-111111111111";
    const attachmentId = "22222222-2222-4222-8222-222222222222";
    expect(await listTicketAttachments(chamadoId, TENANT_A, pool)).not.toContainEqual(expect.objectContaining({ attachmentId }));
    let storageGets = 0;
    const storage = { putExact: async () => ({ key: "unused" }), get: async () => { storageGets += 1; return { url: "https://invalid.example/never-called" }; } };
    await expect(readTicketAttachment(TENANT_A, chamadoId, attachmentId, { pool, storage })).rejects.toMatchObject<TicketAttachmentError>({ code: "NOT_FOUND" });
    expect(storageGets).toBe(0);
  });
});
