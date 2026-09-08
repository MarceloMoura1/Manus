import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { MAIN_MIGRATIONS_DIR, applyCanonicalMigrations } from "./_core/canonical-migrations";
import { getPool } from "./db";
import { persistCanonicalMessage } from "./conversation-message-store";
import {
  CONVERSATION_TIMESTAMP_REPAIR_EXPECTED_COUNT,
  assertConversationTimestampRepairManifestMatchesDatabase,
  createConversationTimestampRepairManifest,
  rollbackConversationTimestampRepair,
} from "./conversation-timestamp-repair";
import { formatTime } from "../client/src/lib/conversationDateTime";

const physical = describe.runIf(process.env.RUN_DATABASE_INTEGRATION === "1");

const DATABASES = [
  "megadesk_test_tzrepair",
  "megadesk_test_tzrepair_fresh",
  "megadesk_test_tzrepair_guard",
] as const;
const UPGRADE_DATABASE = DATABASES[0];
const FRESH_DATABASE = DATABASES[1];
const GUARD_DATABASE = DATABASES[2];
const CLIENT_ID = "tzrepair-tenant";
const CONVERSATION_ID = "tzrepair-conversation";
const OLD_TIMESTAMP = "2026-09-07 20:28:05";
const REPAIRED_TIMESTAMP = "2026-09-07 23:28:05";
const LEGACY_TIMESTAMP = "2026-09-07T23:28:05.220Z";
const ORIGINAL_UPDATED_AT = "2020-01-01 00:00:00";
const MIGRATION_TIMEOUT_MS = 120_000;
const EXCLUDED_COUNT = 63;
const INVALID_MIRROR_EXCLUDED_COUNT = EXCLUDED_COUNT - 4;

let adminPool: Pool;
let priorMigrationsFolder = "";

function disposableUrl(database: string): string {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error("TEST_DATABASE_URL is required for the disposable UTC repair suite.");
  const url = new URL(raw);
  if (url.protocol !== "mysql:" || url.hostname !== "127.0.0.1" || url.port !== "3319") {
    throw new Error("UTC repair integration requires the dedicated 127.0.0.1:3319 disposable MySQL instance.");
  }
  if (!DATABASES.includes(database as (typeof DATABASES)[number])) {
    throw new Error("UTC repair integration refused an unexpected database name.");
  }
  url.pathname = `/${database}`;
  return url.toString();
}

function adminUrl(): string {
  const url = new URL(disposableUrl(UPGRADE_DATABASE));
  url.pathname = "/mysql";
  return url.toString();
}

function priorMigrations(): string {
  const folder = mkdtempSync(join(tmpdir(), "megadesk-tzrepair-prior-"));
  cpSync(MAIN_MIGRATIONS_DIR, folder, { recursive: true });
  rmSync(resolve(folder, "0019_utc_conversation_timestamp_repair.sql"));
  rmSync(resolve(folder, "meta/0019_snapshot.json"));
  const journalPath = resolve(folder, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
  journal.entries = journal.entries.filter((entry) => entry.tag !== "0019_utc_conversation_timestamp_repair");
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  return folder;
}

async function recreateDatabase(database: string): Promise<void> {
  await adminPool.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await adminPool.query(`CREATE DATABASE \`${database}\``);
}

async function applyPriorBaseline(database: string): Promise<void> {
  await recreateDatabase(database);
  await applyCanonicalMigrations(disposableUrl(database), priorMigrationsFolder);
}

async function query<T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, values: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.execute<T[]>(sql, values);
  return rows;
}

async function scalar(pool: Pool, sql: string, values: unknown[] = []): Promise<number> {
  return Number((await query(pool, sql, values))[0]?.value ?? 0);
}

async function insertConversation(pool: Pool, conversationId: string, messagesJson: string): Promise<void> {
  await pool.execute(
    `INSERT INTO megadesk_domain_conversations
      (conversation_id, client_id, public_code, origin, channel, provider, integration_id,
       customer_name, phone, company, status, last_message, time_label, messages_json)
     VALUES (?, ?, ?, 'inbound', 'whatsapp', 'evolution', 'tzrepair-instance',
       'Synthetic UTC Repair', '5500000000000', '', 'closed', '', '', ?)`,
    [conversationId, CLIENT_ID, `UTC-${conversationId.slice(-12)}`, messagesJson],
  );
}

type FixtureOptions = { duplicateLegacyId?: boolean; affectedCount?: number };

type FixtureMessage = { id: string; direction: "inbound" | "outbound"; type: string };

function affectedMessages(count: number): FixtureMessage[] {
  const approvedClasses: Array<Pick<FixtureMessage, "direction" | "type">> = [
    ...Array.from({ length: 33 }, () => ({ direction: "inbound" as const, type: "text" })),
    ...Array.from({ length: 2 }, () => ({ direction: "inbound" as const, type: "image" })),
    ...Array.from({ length: 59 }, () => ({ direction: "outbound" as const, type: "text" })),
    ...Array.from({ length: 4 }, () => ({ direction: "outbound" as const, type: "image" })),
    ...Array.from({ length: 2 }, () => ({ direction: "outbound" as const, type: "audio" })),
    { direction: "outbound" as const, type: "video" },
  ];
  return Array.from({ length: count }, (_, index) => ({
    id: `tzrepair-affected-${String(index).padStart(3, "0")}`,
    ...(approvedClasses[index] ?? { direction: "outbound" as const, type: "text" }),
  }));
}

async function insertRepairFixture(pool: Pool, options: FixtureOptions = {}): Promise<{
  messagesJson: string;
  eventCreatedAt: string;
  excluded: Map<string, { timestamp: string; updatedAt: string }>;
}> {
  const legacy: Array<{ id: string; timestamp: string }> = [];
  const affected = affectedMessages(options.affectedCount ?? CONVERSATION_TIMESTAMP_REPAIR_EXPECTED_COUNT);
  const invalidMirrorExcluded = Array.from({ length: INVALID_MIRROR_EXCLUDED_COUNT }, (_, index) =>
    `tzrepair-invalid-mirror-${String(index).padStart(3, "0")}`,
  );
  for (const message of affected) legacy.push({ id: message.id, timestamp: LEGACY_TIMESTAMP });
  if (options.duplicateLegacyId) legacy.push({ id: affected[0].id, timestamp: LEGACY_TIMESTAMP });
  legacy.push(
    { id: "tzrepair-incomplete", timestamp: LEGACY_TIMESTAMP },
    { id: "tzrepair-correct", timestamp: LEGACY_TIMESTAMP },
    { id: "tzrepair-outside-delta", timestamp: LEGACY_TIMESTAMP },
  );
  for (const id of invalidMirrorExcluded) legacy.push({ id, timestamp: "not-a-rfc3339-utc-timestamp" });
  const messagesJson = JSON.stringify(legacy);
  await insertConversation(pool, CONVERSATION_ID, messagesJson);

  for (const message of affected) {
    await pool.execute(
      `INSERT INTO megadesk_domain_conversations_messages
        (message_id, conversation_id, client_id, provider, integration_id, direction, message_type,
         sender, message, timestamp, status, updated_at)
       VALUES (?, ?, ?, 'evolution', 'tzrepair-instance', ?, ?, 'customer', 'Synthetic affected', ?, 'received', ?)`,
      [message.id, CONVERSATION_ID, CLIENT_ID, message.direction, message.type, OLD_TIMESTAMP, ORIGINAL_UPDATED_AT],
    );
  }
  await pool.execute(
    `INSERT INTO megadesk_domain_conversations_messages
      (message_id, conversation_id, client_id, provider, integration_id, direction, message_type,
       sender, message, timestamp, status, updated_at)
     VALUES ('tzrepair-incomplete', ?, ?, NULL, 'tzrepair-instance', 'inbound', 'text', 'customer', 'Excluded legacy', ?, 'received', ?),
            ('tzrepair-no-mirror', ?, ?, 'evolution', 'tzrepair-instance', 'inbound', 'text', 'customer', 'Excluded missing mirror', ?, 'received', ?),
            ('tzrepair-correct', ?, ?, 'evolution', 'tzrepair-instance', 'inbound', 'text', 'customer', 'Already UTC', ?, 'received', ?),
            ('tzrepair-outside-delta', ?, ?, 'evolution', 'tzrepair-instance', 'inbound', 'text', 'customer', 'Outside delta', ?, 'received', ?)`,
    [
      CONVERSATION_ID, CLIENT_ID, OLD_TIMESTAMP, ORIGINAL_UPDATED_AT,
      CONVERSATION_ID, CLIENT_ID, OLD_TIMESTAMP, ORIGINAL_UPDATED_AT,
      CONVERSATION_ID, CLIENT_ID, REPAIRED_TIMESTAMP, ORIGINAL_UPDATED_AT,
      CONVERSATION_ID, CLIENT_ID, "2026-09-07 20:28:03", ORIGINAL_UPDATED_AT,
      ],
  );
  for (const id of invalidMirrorExcluded) {
    await pool.execute(
      `INSERT INTO megadesk_domain_conversations_messages
        (message_id, conversation_id, client_id, provider, integration_id, direction, message_type,
         sender, message, timestamp, status, updated_at)
       VALUES (?, ?, ?, 'evolution', 'tzrepair-instance', 'inbound', 'text', 'customer', 'Invalid mirror', ?, 'received', ?)`,
      [id, CONVERSATION_ID, CLIENT_ID, OLD_TIMESTAMP, ORIGINAL_UPDATED_AT],
    );
  }
  await pool.execute(
    `INSERT INTO megadesk_conversation_events
      (event_id, client_id, conversation_id, event_type, anchor_message_id, timeline_anchor_kind, metadata_json)
     VALUES ('tzrepair-event', ?, ?, 'transfer', 'tzrepair-affected-000', 'message', '{"synthetic":true}')`,
    [CLIENT_ID, CONVERSATION_ID],
  );
  const [event] = await query(pool,
    "SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS createdAt FROM megadesk_conversation_events WHERE event_id='tzrepair-event'",
  );
  return {
    messagesJson,
    eventCreatedAt: String(event.createdAt),
    excluded: new Map([
      ["tzrepair-incomplete", { timestamp: OLD_TIMESTAMP, updatedAt: ORIGINAL_UPDATED_AT }],
      ["tzrepair-no-mirror", { timestamp: OLD_TIMESTAMP, updatedAt: ORIGINAL_UPDATED_AT }],
      ["tzrepair-correct", { timestamp: REPAIRED_TIMESTAMP, updatedAt: ORIGINAL_UPDATED_AT }],
      ["tzrepair-outside-delta", { timestamp: "2026-09-07 20:28:03", updatedAt: ORIGINAL_UPDATED_AT }],
      ...invalidMirrorExcluded.map((id) => [id, { timestamp: OLD_TIMESTAMP, updatedAt: ORIGINAL_UPDATED_AT }] as const),
    ]),
  };
}

async function timestamps(pool: Pool, ids: string[]): Promise<Map<string, { timestamp: string; updatedAt: string }>> {
  const placeholders = ids.map(() => "?").join(",");
  const rows = await query(pool,
    `SELECT message_id AS messageId,
            DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:%s') AS timestamp,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt
       FROM megadesk_domain_conversations_messages
      WHERE message_id IN (${placeholders})`,
    ids,
  );
  return new Map(rows.map((row) => [String(row.messageId), { timestamp: String(row.timestamp), updatedAt: String(row.updatedAt) }]));
}

async function fixtureEventSnapshot(pool: Pool) {
  return query(pool,
    `SELECT event_id AS eventId, client_id AS clientId, conversation_id AS conversationId, event_type AS eventType,
            metadata_json AS metadataJson, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
            anchor_message_id AS anchorMessageId, timeline_anchor_kind AS anchorKind
       FROM megadesk_conversation_events WHERE event_id='tzrepair-event'`,
  );
}

physical.sequential("UTC repair migration and mysql2 driver", () => {
  beforeAll(async () => {
    priorMigrationsFolder = priorMigrations();
    adminPool = mysql.createPool({ uri: adminUrl(), timezone: "Z" });
  });

  afterAll(async () => {
    try {
      for (const database of DATABASES) await adminPool.query(`DROP DATABASE IF EXISTS \`${database}\``);
    } finally {
      if (priorMigrationsFolder) rmSync(priorMigrationsFolder, { recursive: true, force: true });
      try { await getPool().end(); } catch { /* the app pool may not have been created */ }
      await adminPool.end();
    }
  });

  it("applies baseline -> 0019 cleanly when a fresh database has no historical candidates", async () => {
    await applyPriorBaseline(FRESH_DATABASE);
    await applyCanonicalMigrations(disposableUrl(FRESH_DATABASE), MAIN_MIGRATIONS_DIR);
    const fresh = mysql.createPool({ uri: disposableUrl(FRESH_DATABASE), timezone: "Z" });
    try {
      expect(await scalar(fresh, "SELECT COUNT(*) AS value FROM __drizzle_migrations")).toBe(20);
      expect(await scalar(fresh, "SELECT COUNT(*) AS value FROM megadesk_domain_conversations_messages")).toBe(0);
    } finally {
      await fresh.end();
    }
  }, MIGRATION_TIMEOUT_MS);

  it("repairs exactly the audited selector, preserves protected data, and rolls back from its manifest", async () => {
    await applyPriorBaseline(UPGRADE_DATABASE);
    const pool = mysql.createPool({ uri: disposableUrl(UPGRADE_DATABASE), timezone: "Z" });
    try {
      const fixture = await insertRepairFixture(pool);
      expect(CONVERSATION_TIMESTAMP_REPAIR_EXPECTED_COUNT).toBe(101);
      const manifest = await createConversationTimestampRepairManifest(pool);
      expect(manifest.entries).toHaveLength(101);
      await assertConversationTimestampRepairManifestMatchesDatabase(pool, manifest);
      const eventBefore = await fixtureEventSnapshot(pool);
      expect(eventBefore).toHaveLength(1);

      await applyCanonicalMigrations(disposableUrl(UPGRADE_DATABASE), MAIN_MIGRATIONS_DIR);
      const affectedIds = manifest.entries.map((entry) => entry.messageId);
      const repaired = await timestamps(pool, affectedIds);
      expect(repaired.size).toBe(101);
      for (const entry of manifest.entries) {
        expect(repaired.get(entry.messageId)).toEqual({ timestamp: REPAIRED_TIMESTAMP, updatedAt: ORIGINAL_UPDATED_AT });
      }
      const excluded = await timestamps(pool, [...fixture.excluded.keys()]);
      expect(excluded.size).toBe(63);
      expect(excluded).toEqual(fixture.excluded);
      expect((await query(pool, "SELECT messages_json AS messagesJson FROM megadesk_domain_conversations WHERE conversation_id=?", [CONVERSATION_ID]))[0].messagesJson).toBe(fixture.messagesJson);
      expect(await fixtureEventSnapshot(pool)).toEqual(eventBefore);

      await rollbackConversationTimestampRepair(pool, manifest);
      const rolledBack = await timestamps(pool, affectedIds);
      expect(rolledBack.size).toBe(101);
      for (const entry of manifest.entries) {
        expect(rolledBack.get(entry.messageId)).toEqual({ timestamp: OLD_TIMESTAMP, updatedAt: ORIGINAL_UPDATED_AT });
      }
      expect(await timestamps(pool, [...fixture.excluded.keys()])).toEqual(fixture.excluded);
      expect(await fixtureEventSnapshot(pool)).toEqual(eventBefore);
    } finally {
      await pool.end();
    }
  }, MIGRATION_TIMEOUT_MS);

  it("fails closed before changing any row when a legacy strong ID is ambiguous", async () => {
    await applyPriorBaseline(GUARD_DATABASE);
    const pool = mysql.createPool({ uri: disposableUrl(GUARD_DATABASE), timezone: "Z" });
    try {
      await insertRepairFixture(pool, { affectedCount: 100, duplicateLegacyId: true });
      let migrationFailure: unknown;
      try {
        await applyCanonicalMigrations(disposableUrl(GUARD_DATABASE), MAIN_MIGRATIONS_DIR);
      } catch (error) {
        migrationFailure = error;
      }
      expect(migrationFailure).toBeTruthy();
      expect((migrationFailure as { cause?: { sqlMessage?: string } }).cause?.sqlMessage)
        .toBe("CONVERSATION_TIMESTAMP_REPAIR_PRECONDITION_FAILED");
      expect(await scalar(pool,
        "SELECT COUNT(*) AS value FROM megadesk_domain_conversations_messages WHERE message_id LIKE 'tzrepair-affected-%' AND timestamp=?",
        [OLD_TIMESTAMP],
      )).toBe(100);
      expect(await scalar(pool, "SELECT COUNT(*) AS value FROM __drizzle_migrations")).toBe(19);
    } finally {
      await pool.end();
    }
  }, MIGRATION_TIMEOUT_MS);

  it.each([100, 102])("fails closed before changing any row when the selector has %i candidates", async (affectedCount) => {
    await applyPriorBaseline(GUARD_DATABASE);
    const pool = mysql.createPool({ uri: disposableUrl(GUARD_DATABASE), timezone: "Z" });
    try {
      await insertRepairFixture(pool, { affectedCount });
      let migrationFailure: unknown;
      try {
        await applyCanonicalMigrations(disposableUrl(GUARD_DATABASE), MAIN_MIGRATIONS_DIR);
      } catch (error) {
        migrationFailure = error;
      }
      expect(migrationFailure).toBeTruthy();
      expect((migrationFailure as { cause?: { sqlMessage?: string } }).cause?.sqlMessage)
        .toBe("CONVERSATION_TIMESTAMP_REPAIR_PRECONDITION_FAILED");
      expect(await scalar(pool,
        "SELECT COUNT(*) AS value FROM megadesk_domain_conversations_messages WHERE message_id LIKE 'tzrepair-affected-%' AND timestamp=?",
        [OLD_TIMESTAMP],
      )).toBe(affectedCount);
      expect(await scalar(pool, "SELECT COUNT(*) AS value FROM __drizzle_migrations")).toBe(19);
    } finally {
      await pool.end();
    }
  }, MIGRATION_TIMEOUT_MS);

  it("uses mysql2 UTC conversion for a new canonical message and a DEFAULT now() event", async () => {
    // Keep this proof independently runnable: it must never depend on a prior
    // repair test having left a disposable database behind.
    await applyPriorBaseline(UPGRADE_DATABASE);
    await applyCanonicalMigrations(disposableUrl(UPGRADE_DATABASE), MAIN_MIGRATIONS_DIR);
    const pool = getPool();
    await insertConversation(pool, "tzrepair-driver-conversation", "[]");
    const connection = await pool.getConnection();
    try {
      const knownInstant = new Date("2026-09-07T23:28:05.220Z");
      await expect(persistCanonicalMessage(connection, {
        messageId: "tzrepair-driver-known",
        conversationId: "tzrepair-driver-conversation",
        clientId: CLIENT_ID,
        provider: "evolution",
        integrationId: "tzrepair-instance",
        direction: "inbound",
        messageType: "text",
        sender: "customer",
        text: "UTC driver fixture",
        status: "received",
        timestamp: knownInstant,
        legacyMessage: { from: "customer", text: "UTC driver fixture" },
      })).resolves.toBe(true);
      await connection.execute(
        "INSERT INTO megadesk_conversation_events (event_id,client_id,conversation_id,event_type,metadata_json) VALUES ('tzrepair-driver-event',?,?, 'created', '{}')",
        [CLIENT_ID, "tzrepair-driver-conversation"],
      );
      const [message] = await query(pool,
        "SELECT timestamp, DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:%s') AS physical FROM megadesk_domain_conversations_messages WHERE message_id='tzrepair-driver-known'",
      );
      const [event] = await query(pool,
        "SELECT created_at AS createdAt, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS physical FROM megadesk_conversation_events WHERE event_id='tzrepair-driver-event'",
      );
      expect(message.physical).toBe(REPAIRED_TIMESTAMP);
      expect(message.timestamp).toBeInstanceOf(Date);
      expect((message.timestamp as Date).toISOString()).toBe("2026-09-07T23:28:05.000Z");
      expect(event.createdAt).toBeInstanceOf(Date);
      expect(Math.abs((event.createdAt as Date).getTime() - Date.now())).toBeLessThan(15_000);
      expect(formatTime(message.timestamp as Date)).toBe("20:28");
      expect(formatTime(event.createdAt as Date)).toBe(new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Sao_Paulo",
      }).format(event.createdAt as Date));
    } finally {
      connection.release();
    }
  }, MIGRATION_TIMEOUT_MS);
});
