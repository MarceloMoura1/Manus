import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { applyCanonicalMigrations, MAIN_MIGRATIONS_DIR } from "./_core/canonical-migrations";
import {
  persistConversationReceipt,
  reconcileConversationReceiptAfterOutbound,
} from "./conversation-receipt-store";
import { reconcileOutboundDelivery, type OutboundAttemptInput } from "./conversation-outbound";

const physical = describe.runIf(process.env.RUN_DATABASE_INTEGRATION === "1");
const DATABASES = ["megadesk_test_n09_0035_fresh", "megadesk_test_n09_0035_upgrade"] as const;
const [FRESH_DATABASE, UPGRADE_DATABASE] = DATABASES;
let adminPool: Pool;
let prefixRoot = "";

function databaseUrl(database: (typeof DATABASES)[number]): string {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error("TEST_DATABASE_URL is required for N09 disposable integration.");
  const url = new URL(raw);
  if (url.protocol !== "mysql:" || url.hostname !== "127.0.0.1" || url.port !== "3325") {
    throw new Error("N09 integration requires the dedicated disposable MySQL on 127.0.0.1:3325.");
  }
  url.pathname = `/${database}`;
  return url.toString();
}

function adminDatabaseUrl(): string {
  const raw = process.env.TEST_DATABASE_ADMIN_URL;
  if (!raw) throw new Error("TEST_DATABASE_ADMIN_URL is required for N09 disposable integration.");
  const url = new URL(raw);
  if (url.protocol !== "mysql:" || url.hostname !== "127.0.0.1" || url.port !== "3325"
    || url.pathname !== "/mysql") {
    throw new Error("N09 integration admin URL must target mysql://127.0.0.1:3325/mysql.");
  }
  return url.toString();
}

function migrationPrefix(lastTag: string): string {
  const root = mkdtempSync(join(tmpdir(), "megadesk-n09-0035-prefix-"));
  const folder = resolve(root, "drizzle/main-migrations");
  cpSync(MAIN_MIGRATIONS_DIR, folder, { recursive: true });
  const journalPath = resolve(folder, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
  const lastIndex = journal.entries.findIndex(entry => entry.tag === lastTag);
  if (lastIndex < 0) throw new Error(`Migration prefix not found: ${lastTag}`);
  const removed = journal.entries.slice(lastIndex + 1).map(entry => entry.tag);
  journal.entries = journal.entries.slice(0, lastIndex + 1);
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  for (const tag of removed) {
    rmSync(resolve(folder, `${tag}.sql`), { force: true });
    rmSync(resolve(folder, `meta/${tag.slice(0, 4)}_snapshot.json`), { force: true });
  }
  return root;
}

async function applyPrefix(database: string): Promise<void> {
  const pool = mysql.createPool({ uri: database, timezone: "Z" });
  try {
    await migrate(drizzle(pool), { migrationsFolder: resolve(prefixRoot, "drizzle/main-migrations") });
  } finally {
    await pool.end();
  }
}

async function recreate(database: string) {
  await adminPool.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await adminPool.query(`CREATE DATABASE \`${database}\``);
}

async function scalar(pool: Pool, sql: string, values: unknown[] = []): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, values);
  return Number(rows[0]?.value ?? 0);
}

async function tenant(pool: Pool, clientId: string) {
  await pool.execute(
    `INSERT INTO megadesk_domain_clients
      (client_id, internal_id, tenant_database_name, company, contact, phone, plan, status, status_type,
       access_released, api_token, modules_json, integrations_json)
     VALUES (?, ?, ?, ?, 'Fixture', '00000000000', 'Test', 'active', 'test', 1, 'synthetic', '[]', '{}')`,
    [clientId, `${clientId}-internal`, `mdsk_${clientId.replace(/-/g, "_")}`, `Fixture ${clientId}`],
  );
}

function outbound(messageId: string): OutboundAttemptInput {
  return {
    messageId,
    clientAttemptId: `attempt-${messageId}`,
    conversationId: "conv-a",
    clientId: "tenant-a",
    provider: "evolution",
    integrationId: "instance-a",
    recipient: "5511999999999",
    messageType: "text",
    sender: "agent",
    text: "fixture",
    timestamp: new Date(),
    legacyMessage: { from: "agent", text: "fixture" },
  };
}

function providerReference(externalMessageId: string) {
  return { key: { id: externalMessageId, remoteJid: "5511999999999@s.whatsapp.net", fromMe: true } };
}

physical("0035 pending receipts against disposable MySQL", () => {
  beforeAll(async () => {
    prefixRoot = migrationPrefix("0034_cold_multiple_man");
    adminPool = mysql.createPool({ uri: adminDatabaseUrl(), timezone: "Z" });
    for (const database of DATABASES) await recreate(database);
    await applyPrefix(databaseUrl(UPGRADE_DATABASE));
  }, 180_000);

  afterAll(async () => {
    try {
      for (const database of DATABASES) await adminPool.query(`DROP DATABASE IF EXISTS \`${database}\``);
    } finally {
      if (prefixRoot) rmSync(prefixRoot, { recursive: true, force: true });
      await adminPool.end();
    }
  }, 180_000);

  it("PHYSICAL installs the complete fresh chain with the exact constraints and indexes", async () => {
    await applyCanonicalMigrations(databaseUrl(FRESH_DATABASE), MAIN_MIGRATIONS_DIR);
    const pool = mysql.createPool({ uri: databaseUrl(FRESH_DATABASE), timezone: "Z" });
    try {
      expect(await scalar(pool, "SELECT COUNT(*) value FROM __drizzle_migrations")).toBe(36);
      expect(await scalar(pool, "SELECT COUNT(*) value FROM information_schema.tables WHERE table_schema=? AND table_name='megadesk_conversation_pending_receipts'", [FRESH_DATABASE])).toBe(1);
      const [indexes] = await pool.execute<RowDataPacket[]>(
        "SELECT index_name AS indexName, GROUP_CONCAT(column_name ORDER BY seq_in_index) columnsCsv, non_unique AS nonUnique FROM information_schema.statistics WHERE table_schema=? AND table_name='megadesk_conversation_pending_receipts' GROUP BY index_name,non_unique",
        [FRESH_DATABASE],
      );
      expect(indexes).toEqual(expect.arrayContaining([
        expect.objectContaining({ indexName: "uq_mdpr_external_scope", columnsCsv: "client_id,provider,integration_id,external_message_id", nonUnique: 0 }),
        expect.objectContaining({ indexName: "idx_mdpr_expiry", columnsCsv: "expires_at,replay_state" }),
      ]));
      expect(await scalar(pool, "SELECT COUNT(*) value FROM information_schema.referential_constraints WHERE constraint_schema=? AND table_name='megadesk_conversation_pending_receipts' AND constraint_name='fk_mdpr_client'", [FRESH_DATABASE])).toBe(1);
      await applyCanonicalMigrations(databaseUrl(FRESH_DATABASE), MAIN_MIGRATIONS_DIR);
      expect(await scalar(pool, "SELECT COUNT(*) value FROM __drizzle_migrations")).toBe(36);
    } finally {
      await pool.end();
    }
  }, 180_000);

  it("PHYSICAL upgrades 0034 additively and reconciles restart, duplicates and scoped collisions", async () => {
    const pool = mysql.createPool({ uri: databaseUrl(UPGRADE_DATABASE), timezone: "Z" });
    try {
      expect(await scalar(pool, "SELECT COUNT(*) value FROM __drizzle_migrations")).toBe(35);
      await tenant(pool, "tenant-a");
      await tenant(pool, "tenant-b");
      await pool.execute(
        `INSERT INTO megadesk_domain_conversations
          (conversation_id,client_id,customer_name,phone,company,status,last_message,time_label,messages_json)
         VALUES ('conv-a','tenant-a','A','1','A','open','fixture','now','[]'),
                ('conv-b','tenant-b','B','2','B','open','fixture','now','[]'),
                ('conv-i','tenant-a','I','3','I','open','fixture','now','[]')`,
      );
      await pool.execute(
        `INSERT INTO megadesk_domain_conversations_messages
          (message_id,conversation_id,client_id,provider,integration_id,direction,message_type,sender,message,status,external_message_id)
         VALUES ('msg-a','conv-a','tenant-a','evolution','instance-a','outbound','text','agent','fixture','sent',NULL),
                ('msg-b','conv-b','tenant-b','evolution','instance-a','outbound','text','agent','fixture','sent',NULL),
                ('msg-i','conv-i','tenant-a','evolution','instance-b','outbound','text','agent','fixture','sent',NULL),
                ('msg-d','conv-a','tenant-a','evolution','instance-a','outbound','text','agent','fixture','delivered','provider-d'),
                ('msg-r','conv-a','tenant-a','evolution','instance-a','outbound','text','agent','fixture','read','provider-r'),
                ('msg-p','conv-a','tenant-a','evolution','instance-a','outbound','text','agent','fixture','played','provider-p'),
                ('msg-f','conv-a','tenant-a','evolution','instance-a','outbound','text','agent','fixture','failed','provider-f'),
                ('msg-race','conv-a','tenant-a','evolution','instance-a','outbound','text','agent','fixture','pending',NULL)`,
      );
      await applyCanonicalMigrations(databaseUrl(UPGRADE_DATABASE), MAIN_MIGRATIONS_DIR);
      expect(await scalar(pool, "SELECT COUNT(*) value FROM __drizzle_migrations")).toBe(36);
      expect(await scalar(pool, "SELECT COUNT(*) value FROM megadesk_domain_conversations_messages")).toBe(8);

      const receipt = { clientId: "tenant-a", provider: "evolution", integrationId: "instance-a",
        externalMessageId: "provider-collision", status: "delivered" as const,
        providerEventAt: null, receivedAt: new Date() };
      await persistConversationReceipt(pool, receipt);
      await persistConversationReceipt(pool, { ...receipt, status: "read" });
      await persistConversationReceipt(pool, { ...receipt, status: "read" });
      expect(await scalar(pool, "SELECT COUNT(*) value FROM megadesk_conversation_pending_receipts")).toBe(1);

      const restartedPool = mysql.createPool({ uri: databaseUrl(UPGRADE_DATABASE), timezone: "Z" });
      try {
        await reconcileConversationReceiptAfterOutbound(restartedPool, receipt, async connection => {
          await connection.execute("UPDATE megadesk_domain_conversations_messages SET external_message_id=? WHERE message_id='msg-a' AND client_id='tenant-a'", [receipt.externalMessageId]);
        });
      } finally {
        await restartedPool.end();
      }
      await expect(reconcileOutboundDelivery(pool, outbound("msg-a"), "sent", receipt.externalMessageId,
        providerReference(receipt.externalMessageId))).resolves.toMatchObject({ reconciled: false });
      for (const [messageId, externalMessageId] of [
        ["msg-d", "provider-d"], ["msg-r", "provider-r"], ["msg-p", "provider-p"], ["msg-f", "provider-f"],
      ] as const) {
        await expect(reconcileOutboundDelivery(pool, outbound(messageId), "sent", externalMessageId,
          providerReference(externalMessageId))).resolves.toMatchObject({ reconciled: false });
      }
      await Promise.all(Array.from({ length: 3 }, () => reconcileOutboundDelivery(
        pool, outbound("msg-p"), "sent", "provider-p", providerReference("provider-p"),
      )));

      const racingReceipt = { ...receipt, externalMessageId: "provider-race", status: "delivered" as const };
      await Promise.all([
        reconcileOutboundDelivery(pool, outbound("msg-race"), "sent", "provider-race", providerReference("provider-race")),
        persistConversationReceipt(pool, racingReceipt),
      ]);

      const [messages] = await pool.execute<RowDataPacket[]>("SELECT message_id,status,external_message_id FROM megadesk_domain_conversations_messages ORDER BY message_id");
      expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ message_id: "msg-a", status: "read", external_message_id: "provider-collision" }),
        expect.objectContaining({ message_id: "msg-b", status: "sent", external_message_id: null }),
        expect.objectContaining({ message_id: "msg-i", status: "sent", external_message_id: null }),
        expect.objectContaining({ message_id: "msg-d", status: "delivered", external_message_id: "provider-d" }),
        expect.objectContaining({ message_id: "msg-r", status: "read", external_message_id: "provider-r" }),
        expect.objectContaining({ message_id: "msg-p", status: "played", external_message_id: "provider-p" }),
        expect.objectContaining({ message_id: "msg-f", status: "failed", external_message_id: "provider-f" }),
        expect.objectContaining({ message_id: "msg-race", status: "delivered", external_message_id: "provider-race" }),
      ]));
      expect(await scalar(pool, "SELECT COUNT(*) value FROM megadesk_conversation_pending_receipts WHERE replay_state='replayed'"))
        .toBeGreaterThanOrEqual(1);
      expect(await scalar(pool, `SELECT COUNT(*) value FROM megadesk_conversation_pending_receipts
        WHERE external_message_id IN ('provider-collision','provider-race') AND replay_state='pending'`)).toBe(0);
    } finally {
      await pool.end();
    }
  }, 180_000);
});
