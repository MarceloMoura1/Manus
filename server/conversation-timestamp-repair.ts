import { createHash } from "node:crypto";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

/** The audited production population. A clean/new database has zero candidates. */
export const CONVERSATION_TIMESTAMP_REPAIR_EXPECTED_COUNT = 101;
export const CONVERSATION_TIMESTAMP_REPAIR_MIN_DELTA_MICROSECONDS = 10_799_000_000;
export const CONVERSATION_TIMESTAMP_REPAIR_MAX_DELTA_MICROSECONDS_EXCLUSIVE = 10_801_000_000;
export const CONVERSATION_TIMESTAMP_REPAIR_MANIFEST_VERSION = 1;

export type ConversationTimestampRepairEntry = {
  clientId: string;
  conversationId: string;
  messageId: string;
  oldTimestamp: string;
  legacyUtcTimestamp: string;
};

export type ConversationTimestampRepairManifest = {
  version: typeof CONVERSATION_TIMESTAMP_REPAIR_MANIFEST_VERSION;
  entries: ConversationTimestampRepairEntry[];
  sha256: string;
};

type Queryable = Pick<Pool, "execute"> | Pick<PoolConnection, "execute">;

type RepairRow = RowDataPacket & {
  clientId: string;
  conversationId: string;
  messageId: string;
  oldTimestamp: string;
  legacyUtcTimestamp: string;
};

/**
 * This is intentionally a row-local proof, not a date-range heuristic. A
 * normalized row is eligible only when its strong identity appears once in its
 * own legacy mirror and that mirror proves the precise three-hour transport
 * discrepancy.
 */
export const conversationTimestampRepairSelectorSql = `
WITH legacy_messages AS (
  SELECT
    c.conversation_id,
    legacy.message_id,
    legacy.legacy_timestamp
  FROM megadesk_domain_conversations AS c
  JOIN JSON_TABLE(
    c.messages_json,
    '$[*]' COLUMNS (
      message_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.id',
      legacy_timestamp VARCHAR(64) PATH '$.timestamp'
    )
  ) AS legacy
), candidates AS (
  SELECT
    m.client_id AS clientId,
    m.conversation_id AS conversationId,
    m.message_id AS messageId,
    DATE_FORMAT(m.timestamp, '%Y-%m-%d %H:%i:%s') AS oldTimestamp,
    DATE_FORMAT(
      CASE
        WHEN legacy.legacy_timestamp REGEXP '[.][0-9]{1,6}Z$'
          THEN STR_TO_DATE(TRIM(TRAILING 'Z' FROM legacy.legacy_timestamp), '%Y-%m-%dT%H:%i:%s.%f')
        ELSE STR_TO_DATE(TRIM(TRAILING 'Z' FROM legacy.legacy_timestamp), '%Y-%m-%dT%H:%i:%s')
      END,
      '%Y-%m-%dT%H:%i:%s.%fZ'
    ) AS legacyUtcTimestamp,
    TIMESTAMPDIFF(
      MICROSECOND,
      m.timestamp,
      CASE
        WHEN legacy.legacy_timestamp REGEXP '[.][0-9]{1,6}Z$'
          THEN STR_TO_DATE(TRIM(TRAILING 'Z' FROM legacy.legacy_timestamp), '%Y-%m-%dT%H:%i:%s.%f')
        ELSE STR_TO_DATE(TRIM(TRAILING 'Z' FROM legacy.legacy_timestamp), '%Y-%m-%dT%H:%i:%s')
      END
    ) AS deltaMicroseconds
  FROM megadesk_domain_conversations_messages AS m
  JOIN legacy_messages AS legacy
    ON BINARY legacy.conversation_id = BINARY m.conversation_id
   AND BINARY legacy.message_id = BINARY m.message_id
  WHERE m.client_id IS NOT NULL
    AND m.provider IS NOT NULL
    AND m.integration_id IS NOT NULL
    AND m.direction IS NOT NULL
    AND m.message_type IS NOT NULL
    AND legacy.legacy_timestamp REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
)
SELECT clientId, conversationId, messageId, oldTimestamp, legacyUtcTimestamp
FROM candidates
WHERE deltaMicroseconds >= ${CONVERSATION_TIMESTAMP_REPAIR_MIN_DELTA_MICROSECONDS}
  AND deltaMicroseconds < ${CONVERSATION_TIMESTAMP_REPAIR_MAX_DELTA_MICROSECONDS_EXCLUSIVE}
ORDER BY clientId, conversationId, messageId`;

function canonicalEntries(entries: ConversationTimestampRepairEntry[]): string {
  return JSON.stringify(entries.map(entry => ({
    clientId: entry.clientId,
    conversationId: entry.conversationId,
    messageId: entry.messageId,
    oldTimestamp: entry.oldTimestamp,
    legacyUtcTimestamp: entry.legacyUtcTimestamp,
  })));
}

function manifestHash(entries: ConversationTimestampRepairEntry[]): string {
  return createHash("sha256").update(canonicalEntries(entries), "utf8").digest("hex");
}

function assertTimestamp(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    throw new Error(`CONVERSATION_TIMESTAMP_REPAIR_INVALID_${label}`);
  }
}

export function assertConversationTimestampRepairManifest(
  manifest: ConversationTimestampRepairManifest,
  expectedCount = CONVERSATION_TIMESTAMP_REPAIR_EXPECTED_COUNT,
): void {
  if (manifest.version !== CONVERSATION_TIMESTAMP_REPAIR_MANIFEST_VERSION) {
    throw new Error("CONVERSATION_TIMESTAMP_REPAIR_MANIFEST_VERSION_INVALID");
  }
  if (manifest.entries.length !== expectedCount) {
    throw new Error("CONVERSATION_TIMESTAMP_REPAIR_MANIFEST_COUNT_INVALID");
  }
  const identities = new Set<string>();
  for (const entry of manifest.entries) {
    if (!entry.clientId || !entry.conversationId || !entry.messageId) {
      throw new Error("CONVERSATION_TIMESTAMP_REPAIR_MANIFEST_IDENTITY_INVALID");
    }
    assertTimestamp(entry.oldTimestamp, "OLD_TIMESTAMP");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(entry.legacyUtcTimestamp)) {
      throw new Error("CONVERSATION_TIMESTAMP_REPAIR_MANIFEST_LEGACY_TIMESTAMP_INVALID");
    }
    const identity = `${entry.clientId}\u0000${entry.conversationId}\u0000${entry.messageId}`;
    if (identities.has(identity)) throw new Error("CONVERSATION_TIMESTAMP_REPAIR_MANIFEST_DUPLICATE_IDENTITY");
    identities.add(identity);
  }
  if (manifest.sha256 !== manifestHash(manifest.entries)) {
    throw new Error("CONVERSATION_TIMESTAMP_REPAIR_MANIFEST_HASH_INVALID");
  }
}

export async function createConversationTimestampRepairManifest(database: Queryable): Promise<ConversationTimestampRepairManifest> {
  const [rows] = await database.execute<RepairRow[]>(conversationTimestampRepairSelectorSql);
  const entries = rows.map(row => ({
    clientId: String(row.clientId),
    conversationId: String(row.conversationId),
    messageId: String(row.messageId),
    oldTimestamp: String(row.oldTimestamp),
    legacyUtcTimestamp: String(row.legacyUtcTimestamp),
  }));
  return {
    version: CONVERSATION_TIMESTAMP_REPAIR_MANIFEST_VERSION,
    entries,
    sha256: manifestHash(entries),
  };
}

/** JSON suitable for a protected operational backup artifact. This function performs no I/O. */
export function serializeConversationTimestampRepairManifest(manifest: ConversationTimestampRepairManifest): string {
  assertConversationTimestampRepairManifest(manifest);
  return JSON.stringify(manifest, null, 2);
}

export async function assertConversationTimestampRepairManifestMatchesDatabase(
  database: Queryable,
  manifest: ConversationTimestampRepairManifest,
): Promise<void> {
  assertConversationTimestampRepairManifest(manifest);
  const current = await createConversationTimestampRepairManifest(database);
  if (current.sha256 !== manifest.sha256 || canonicalEntries(current.entries) !== canonicalEntries(manifest.entries)) {
    throw new Error("CONVERSATION_TIMESTAMP_REPAIR_MANIFEST_MISMATCH");
  }
}

function repairedTimestamp(oldTimestamp: string): string {
  const parsed = new Date(`${oldTimestamp.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("CONVERSATION_TIMESTAMP_REPAIR_INVALID_OLD_TIMESTAMP");
  parsed.setUTCHours(parsed.getUTCHours() + 3);
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Recovery is deliberately manifest-driven. Once the repair has run, its
 * selector no longer matches; rollback must therefore never re-run it.
 */
export async function rollbackConversationTimestampRepair(
  pool: Pick<Pool, "getConnection">,
  manifest: ConversationTimestampRepairManifest,
): Promise<void> {
  assertConversationTimestampRepairManifest(manifest);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const entry of manifest.entries) {
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE megadesk_domain_conversations_messages
         SET timestamp = ?, updated_at = updated_at
         WHERE client_id = ? AND conversation_id = ? AND message_id = ?
           AND timestamp = ?`,
        [
          entry.oldTimestamp,
          entry.clientId,
          entry.conversationId,
          entry.messageId,
          repairedTimestamp(entry.oldTimestamp),
        ],
      );
      if (result.affectedRows !== 1) throw new Error("CONVERSATION_TIMESTAMP_REPAIR_ROLLBACK_MISMATCH");
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
