import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const PLAN_URL = new URL("./reconciliation-plan.json", import.meta.url);
const AUX_TABLES = new Set(["_reconciliation_entity_map", "_reconciliation_audit"]);
const USER_REFERENCE_COLUMNS = new Set([
  "user_id", "created_by", "updated_by", "assigned_user_id", "closed_by_user_id",
  "reopened_by_user_id", "sender_user_id", "operator_user_id", "requested_by",
  "decided_by", "responsible_user_id", "requester_user_id", "approval_requested_by",
  "cancelled_by", "linked_by", "linked_by_user_id", "received_by", "actor_user_id"
]);
const DIRECT_REFERENCE_TABLES = new Map([
  ["conversation_id", "megadesk_domain_conversations"],
  ["contact_id", "megadesk_conversation_contacts"],
  ["anchor_message_id", "megadesk_domain_conversations_messages"],
  ["reply_to_message_id", "megadesk_domain_conversations_messages"],
  ["message_id", "megadesk_domain_conversations_messages"]
]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const SECRET_KEYS = new Set([
  "password", "password_hash", "passwordhash", "token", "token_hash", "api_token",
  "access_token", "refresh_token", "secret", "client_secret", "cookie", "session_data",
  "credential", "credentials", "credentials_json", "authorization", "api_key", "api_key_hash", "private_key",
]);
const RECEIPT_STATUS_RANK = Object.freeze({ pending: 1, sent: 2, delivered: 3, read: 4, played: 5, failed: 6 });
const JSON_PAYLOAD_COLUMNS = new Set(["provider_message_reference", "media_reference"]);

const isSecretKey = key => {
  const normalized = String(key).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return SECRET_KEYS.has(normalized)
    || /(?:^|_)(?:password|token|secret|credentials?|cookie|api_key|private_key)$/.test(normalized);
};

export class ReconciliationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ReconciliationError";
    this.code = code;
    this.details = details;
  }
}

export function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function assertStagingDatabaseName(name) {
  if (!/^megadesk_test_[a-z0-9_]+$/i.test(name)) {
    throw new ReconciliationError("NON_STAGING_DATABASE", `Database ${name} is not an approved disposable staging database.`);
  }
  return name;
}

export function assertStagingDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  if (parsed.protocol !== "mysql:") {
    throw new ReconciliationError("NON_MYSQL_STAGING_URL", "Staging URL must use mysql://.");
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new ReconciliationError("NON_LOCAL_STAGING_HOST", "Staging database must be reached through a loopback host.", { hostHash: sha256(parsed.hostname.toLowerCase()) });
  }
  return { parsed, database: assertStagingDatabaseName(decodeURIComponent(parsed.pathname.replace(/^\//, ""))) };
}

export function assertDistinctDatabaseNames(namedDatabases) {
  const entries = Object.entries(namedDatabases);
  const normalized = entries.map(([, database]) => String(database).toLowerCase());
  if (new Set(normalized).size !== entries.length) {
    throw new ReconciliationError("DATABASE_ROLE_COLLISION", "Source, baseline, and target staging databases must be distinct.", {
      roles: entries.map(([role]) => role).sort(compareText),
    });
  }
  return namedDatabases;
}

export function stableValue(value) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return { $binary: value.toString("hex") };
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export function payloadHash(row, forbiddenColumns = []) {
  const forbidden = new Set(forbiddenColumns.map(column => column.toLowerCase()));
  const safe = Object.fromEntries(Object.entries(row)
    .filter(([column]) => !forbidden.has(column.toLowerCase()) && !isSecretKey(column))
    .sort(([left], [right]) => compareText(left, right))
    .map(([column, value]) => [column, stableValue(value)]));
  return sha256(JSON.stringify(safe));
}

function secretPaths(value, path = []) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap((entry, index) => secretPaths(entry, [...path, String(index)]));
  if (typeof value !== "object") return [];
  const found = [];
  for (const [key, nested] of Object.entries(value)) {
    const fullPath = [...path, key].join(".");
    const providerPayloadSecret = key === "messageSecret"
      && /(?:^|\.)(?:providerMessageReference|provider_message_reference)\.message\.messageContextInfo\.messageSecret$/.test(fullPath);
    if (isSecretKey(key) && !providerPayloadSecret && nested != null && String(nested) !== "") found.push(fullPath);
    found.push(...secretPaths(nested, [...path, key]));
  }
  return found;
}

export function assertNoSecretMaterial(row) {
  const parsed = {};
  for (const [column, value] of Object.entries(row)) {
    parsed[column] = value;
    if (typeof value === "string" && (column.toLowerCase().endsWith("_json") || JSON_PAYLOAD_COLUMNS.has(column.toLowerCase()))) {
      try { parsed[column] = JSON.parse(value); } catch { /* opaque non-JSON metadata remains data, never executable */ }
    }
  }
  const paths = secretPaths(parsed);
  if (paths.length) {
    throw new ReconciliationError("SECRET_MATERIAL_BLOCKED", "Source row contains credential-bearing fields.", { fieldPathHashes: paths.map(sha256) });
  }
  return true;
}

export function assertPendingReceiptTtl(row) {
  const parseTimestamp = value => {
    const text = String(value);
    const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)
      ? `${text.replace(" ", "T")}Z`
      : text;
    return Date.parse(normalized);
  };
  const received = parseTimestamp(row.received_at);
  const expires = parseTimestamp(row.expires_at);
  if (!Number.isFinite(received) || !Number.isFinite(expires) || expires <= received) {
    throw new ReconciliationError("INVALID_PENDING_RECEIPT_TTL", "Pending receipt expiry must be later than its receipt time.");
  }
  return true;
}

export function classifyDuplicate(existingHash, incomingHash) {
  if (!existingHash) return "INSERT";
  return existingHash === incomingHash ? "REPLAY" : "CONFLICT";
}

export function classifyPendingReceipt(existing, incoming, forbiddenColumns = []) {
  const existingRank = Number(existing.status_rank);
  const incomingRank = Number(incoming.status_rank);
  if (RECEIPT_STATUS_RANK[existing.status] !== existingRank || RECEIPT_STATUS_RANK[incoming.status] !== incomingRank) return "CONFLICT";
  const replayRank = state => state === "replayed" ? 1 : state === "pending" ? 0 : -1;
  const existingReplayRank = replayRank(existing.replay_state);
  const incomingReplayRank = replayRank(incoming.replay_state);
  if (existingReplayRank < 0 || incomingReplayRank < 0) return "CONFLICT";
  if (existing.status === "failed") return "PRESERVE";
  if (incoming.status === "failed") return existingRank <= RECEIPT_STATUS_RANK.sent && incomingReplayRank >= existingReplayRank ? "ADVANCE" : "PRESERVE";
  if (incomingRank < existingRank) return "PRESERVE";
  if (incomingRank > existingRank) return incomingReplayRank < existingReplayRank ? "CONFLICT" : "ADVANCE";
  if (incomingReplayRank < existingReplayRank) return "PRESERVE";
  if (incomingReplayRank > existingReplayRank) return "ADVANCE";
  const technical = [...forbiddenColumns, "receipt_id", "client_id", "created_at", "updated_at", "received_at"];
  return payloadHash(existing, technical) === payloadHash(incoming, technical) ? "REPLAY" : "CONFLICT";
}

export function assertTenantSafe(sourceTenant, expectedSourceTenant, canonicalTenant) {
  if (String(sourceTenant) !== String(expectedSourceTenant)) {
    throw new ReconciliationError("CROSS_TENANT_SOURCE", "Source row belongs to an unmapped tenant.");
  }
  if (!canonicalTenant) throw new ReconciliationError("MISSING_TENANT_MAPPING", "Canonical tenant is missing.");
}

export function assertParentMapping(value, mapping, column) {
  if (value == null) return value;
  if (!mapping.has(String(value))) {
    throw new ReconciliationError("MISSING_PARENT", `Missing canonical mapping for ${column}.`, { column, sourceIdHash: sha256(value) });
  }
  return mapping.get(String(value));
}

function quote(identifier) {
  return `\`${String(identifier).replaceAll("`", "``")}\``;
}

async function query(connection, sql, values = []) {
  const [result] = await connection.execute(sql, values);
  return result;
}

async function tableMetadata(connection, schema, table) {
  const columns = await query(connection,
    `SELECT COLUMN_NAME name,DATA_TYPE type,COLUMN_KEY columnKey,EXTRA extra,IS_NULLABLE nullable
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`,
    [schema, table]);
  if (!columns.length) throw new ReconciliationError("MISSING_TABLE", `Required table ${table} is absent from ${schema}.`);
  const indexes = await query(connection,
    `SELECT INDEX_NAME name,NON_UNIQUE nonUnique,COLUMN_NAME columnName,SEQ_IN_INDEX sequence
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX`,
    [schema, table]);
  const primary = indexes.filter(index => index.name === "PRIMARY").map(index => index.columnName);
  const unique = new Map();
  for (const index of indexes.filter(index => index.name !== "PRIMARY" && Number(index.nonUnique) === 0)) {
    if (!unique.has(index.name)) unique.set(index.name, []);
    unique.get(index.name).push(index.columnName);
  }
  return { columns, primary, unique: [...unique.entries()].map(([name, fields]) => ({ name, fields })) };
}

function assertCompatibleImportSchema(table, sourceMeta, targetMeta) {
  const targetColumns = new Map(targetMeta.columns.map(column => [column.name, column]));
  const incompatible = sourceMeta.columns
    .filter(column => !targetColumns.has(column.name) || targetColumns.get(column.name).type !== column.type)
    .map(column => ({ name: column.name, sourceType: column.type, targetType: targetColumns.get(column.name)?.type ?? null }));
  if (incompatible.length) {
    throw new ReconciliationError("IMPORT_SCHEMA_MISMATCH", `Source columns for ${table} are absent or incompatible in the target.`, {
      columns: incompatible.map(column => ({ nameHash: sha256(column.name), sourceType: column.sourceType, targetType: column.targetType })),
    });
  }
}

function primaryObject(row, primary) {
  return Object.fromEntries(primary.map(column => [column, stableValue(row[column])]));
}

function sourceKey(row, primary) {
  return JSON.stringify(primaryObject(row, primary));
}

export function assertCanonicalMappingShape(canonical, primary) {
  if (!canonical || typeof canonical !== "object" || Array.isArray(canonical)) {
    throw new ReconciliationError("CORRUPT_MAPPING", "Canonical mapping must be an object.");
  }
  const actual = Object.keys(canonical).sort(compareText);
  const expected = [...primary].sort(compareText);
  if (JSON.stringify(actual) !== JSON.stringify(expected) || expected.some(field => canonical[field] == null)) {
    throw new ReconciliationError("CORRUPT_MAPPING", "Canonical mapping does not match the target primary key.", { expectedFields: expected, actualFields: actual });
  }
  return canonical;
}

export function assertRuntimeMapping(mapping) {
  const fields = ["sourceTenantSha256", "targetTenantSha256", "sourceAdminEmailSha256", "targetAdminEmailSha256"];
  const actual = Object.keys(mapping ?? {}).sort(compareText);
  if (JSON.stringify(actual) !== JSON.stringify([...fields].sort(compareText))
      || fields.some(field => !/^[a-f0-9]{64}$/.test(String(mapping[field])))) {
    throw new ReconciliationError("INVALID_RUNTIME_MAPPING", "Runtime mapping must contain exactly four lowercase SHA-256 fingerprints.");
  }
  return mapping;
}

async function createAuxiliaryTables(target) {
  await query(target, `CREATE TABLE IF NOT EXISTS _reconciliation_entity_map (
    entity_type varchar(120) NOT NULL,
    source_side enum('WINDOWS','ORACLE') NOT NULL,
    source_id_hash char(64) NOT NULL,
    source_id_json text NOT NULL,
    canonical_id_json text NOT NULL,
    source_payload_hash char(64) NOT NULL,
    target_payload_hash char(64) NOT NULL,
    mapping_reason varchar(180) NOT NULL,
    confidence enum('explicit','deterministic','generated') NOT NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(entity_type,source_side,source_id_hash)
  )`);
  await query(target, `CREATE TABLE IF NOT EXISTS _reconciliation_audit (
    id bigint NOT NULL AUTO_INCREMENT,
    run_id char(64) NOT NULL,
    entity_type varchar(120) NOT NULL,
    source_id_hash char(64) NOT NULL,
    canonical_id_hash char(64),
    action enum('mapped','inserted','updated','replayed','blocked','conflict') NOT NULL,
    reason varchar(255) NOT NULL,
    before_hash char(64),
    after_hash char(64),
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(id), INDEX idx_recon_run(run_id,entity_type,action)
  )`);
}

async function insertAudit(connection, event) {
  await query(connection,
    `INSERT INTO _reconciliation_audit(run_id,entity_type,source_id_hash,canonical_id_hash,action,reason,before_hash,after_hash)
     VALUES(?,?,?,?,?,?,?,?)`,
    [event.runId, event.table, event.sourceIdHash, event.canonicalIdHash ?? null, event.action, event.reason, event.beforeHash ?? null, event.afterHash ?? null]);
}

async function lookupMapping(connection, table, rawSourceKey) {
  const sourceIdHash = sha256(rawSourceKey);
  const rows = await query(connection,
    "SELECT source_id_hash sourceIdHash,source_id_json sourceIdJson,canonical_id_json canonicalIdJson,source_payload_hash sourcePayloadHash,target_payload_hash targetPayloadHash FROM _reconciliation_entity_map WHERE entity_type=? AND source_side='WINDOWS' AND source_id_hash=?",
    [table, sourceIdHash]);
  if (!rows.length) return null;
  if (rows.length !== 1 || rows[0].sourceIdHash !== sourceIdHash || sha256(rows[0].sourceIdJson) !== sourceIdHash || rows[0].sourceIdJson !== rawSourceKey) {
    throw new ReconciliationError("CORRUPT_MAPPING", `Stored source identity is inconsistent for ${table}.`, { sourceIdHash });
  }
  try {
    return { canonical: JSON.parse(rows[0].canonicalIdJson), sourcePayloadHash: rows[0].sourcePayloadHash, targetPayloadHash: rows[0].targetPayloadHash };
  } catch {
    throw new ReconciliationError("CORRUPT_MAPPING", `Stored canonical identity is invalid JSON for ${table}.`, { sourceIdHash });
  }
}

async function assertMappingTargetExists(connection, schema, table, metadata, mapping, expectedTenant) {
  const canonical = assertCanonicalMappingShape(mapping.canonical, metadata.primary);
  const where = metadata.primary.map(field => `${quote(field)} <=> ?`).join(" AND ");
  const rows = await query(connection, `SELECT * FROM ${quote(schema)}.${quote(table)} WHERE ${where} LIMIT 2`, metadata.primary.map(field => canonical[field]));
  if (rows.length !== 1) {
    throw new ReconciliationError("STALE_MAPPING_TARGET", `Canonical target for ${table} is absent or ambiguous.`, { canonicalIdHash: sha256(JSON.stringify(stableValue(canonical))), candidates: rows.length });
  }
  const tenantColumn = Object.hasOwn(rows[0], "client_id") ? "client_id" : Object.hasOwn(rows[0], "clientId") ? "clientId" : null;
  if (tenantColumn && expectedTenant != null && String(rows[0][tenantColumn]) !== String(expectedTenant)) {
    throw new ReconciliationError("CROSS_TENANT_MAPPING_TARGET", `Canonical target for ${table} belongs to another tenant.`, { canonicalIdHash: sha256(JSON.stringify(stableValue(canonical))) });
  }
  return rows[0];
}

async function storeMapping(connection, values) {
  await query(connection,
    `INSERT INTO _reconciliation_entity_map(entity_type,source_side,source_id_hash,source_id_json,canonical_id_json,source_payload_hash,target_payload_hash,mapping_reason,confidence)
     VALUES(?,'WINDOWS',?,?,?,?,?,?,?)`,
    [values.table, sha256(values.sourceKey), values.sourceKey, JSON.stringify(stableValue(values.canonical)), values.sourcePayloadHash, values.targetPayloadHash, values.reason, values.confidence]);
}

function assertTargetAttestation(mapping, targetRow, forbiddenColumns) {
  const currentHash = payloadHash(targetRow, forbiddenColumns);
  if (!mapping.targetPayloadHash || mapping.targetPayloadHash !== currentHash) {
    throw new ReconciliationError("MAPPING_TARGET_ATTESTATION_FAILED", "Stored mapping no longer identifies its attested canonical row.", {
      canonicalIdHash: sha256(JSON.stringify(stableValue(mapping.canonical))),
    });
  }
  return currentHash;
}

async function resolveByHash(connection, schema, table, column, expectedHash, whereSql = "1=1", whereValues = []) {
  const result = await query(connection,
    `SELECT * FROM ${quote(schema)}.${quote(table)} WHERE ${whereSql}`,
    whereValues);
  const matches = result.filter(row => sha256(String(row[column] ?? "").trim().toLowerCase()) === expectedHash);
  if (matches.length !== 1) {
    throw new ReconciliationError("AMBIGUOUS_MAPPING", `Expected exactly one ${table}.${column} mapping candidate.`, { candidates: matches.length });
  }
  return matches[0];
}

async function resolveExplicitMappings(source, target, sourceSchema, targetSchema, mapping, plan, runId) {
  const sourceTenants = await query(source, `SELECT * FROM ${quote(sourceSchema)}.megadesk_domain_clients`);
  const targetTenants = await query(target, `SELECT * FROM ${quote(targetSchema)}.megadesk_domain_clients`);
  const sourceTenantMatches = sourceTenants.filter(row => sha256(row.client_id) === mapping.sourceTenantSha256);
  const targetTenantMatches = targetTenants.filter(row => sha256(row.client_id) === mapping.targetTenantSha256);
  if (sourceTenantMatches.length !== 1 || targetTenantMatches.length !== 1) {
    throw new ReconciliationError("AMBIGUOUS_TENANT_MAPPING", "Explicit tenant fingerprints did not resolve uniquely.", { sourceCandidates: sourceTenantMatches.length, targetCandidates: targetTenantMatches.length });
  }
  const sourceTenant = sourceTenantMatches[0];
  const targetTenant = targetTenantMatches[0];
  const sourceUser = await resolveByHash(source, sourceSchema, "megadesk_domain_client_users", "email", mapping.sourceAdminEmailSha256, "client_id=?", [sourceTenant.client_id]);
  const targetUser = await resolveByHash(target, targetSchema, "megadesk_domain_client_users", "email", mapping.targetAdminEmailSha256, "client_id=?", [targetTenant.client_id]);
  if (String(sourceUser.role) !== String(targetUser.role) || String(sourceUser.status) !== String(targetUser.status)) {
    throw new ReconciliationError("USER_IDENTITY_MISMATCH", "Mapped users have incompatible role or status.");
  }
  const sourceTenantKey = JSON.stringify({ client_id: sourceTenant.client_id });
  const targetTenantKey = { client_id: targetTenant.client_id };
  const sourceUserKey = JSON.stringify({ user_id: sourceUser.user_id });
  const targetUserKey = { user_id: targetUser.user_id };
  const ensureExplicit = async ({ table, sourceKeyValue, targetKey, sourceRow, reason, auditReason, expectedTenant }) => {
    const previous = await lookupMapping(target, table, sourceKeyValue);
    const metadata = await tableMetadata(target, targetSchema, table);
    const sourcePayloadHash = payloadHash(sourceRow, plan.forbiddenColumns);
    if (previous) {
      assertCanonicalMappingShape(previous.canonical, metadata.primary);
      if (previous.sourcePayloadHash !== sourcePayloadHash || JSON.stringify(stableValue(previous.canonical)) !== JSON.stringify(stableValue(targetKey))) {
        throw new ReconciliationError("EXPLICIT_MAPPING_CONFLICT", `Stored explicit mapping disagrees with configuration for ${table}.`, { sourceIdHash: sha256(sourceKeyValue) });
      }
      const actual = await assertMappingTargetExists(target, targetSchema, table, metadata, previous, expectedTenant);
      assertTargetAttestation(previous, actual, plan.forbiddenColumns);
      return;
    }
    const targetRow = await assertMappingTargetExists(target, targetSchema, table, metadata, { canonical: targetKey }, expectedTenant);
    await storeMapping(target, { table, sourceKey: sourceKeyValue, canonical: targetKey, sourcePayloadHash, targetPayloadHash: payloadHash(targetRow, plan.forbiddenColumns), reason, confidence: "explicit" });
    await insertAudit(target, { runId, table, sourceIdHash: sha256(sourceKeyValue), canonicalIdHash: sha256(JSON.stringify(targetKey)), action: "mapped", reason: auditReason });
  };
  await target.beginTransaction();
  try {
    await ensureExplicit({ table: "megadesk_domain_clients", sourceKeyValue: sourceTenantKey, targetKey: targetTenantKey, sourceRow: sourceTenant, reason: "explicit_unique_admin_and_business_fingerprint", auditReason: "explicit tenant mapping", expectedTenant: targetTenant.client_id });
    await ensureExplicit({ table: "megadesk_domain_client_users", sourceKeyValue: sourceUserKey, targetKey: targetUserKey, sourceRow: sourceUser, reason: "explicit_normalized_email_hash_and_role", auditReason: "explicit user mapping without credentials", expectedTenant: targetTenant.client_id });
    await target.commit();
  } catch (error) {
    await target.rollback();
    throw error;
  }
  return { sourceTenant, targetTenant, sourceUser, targetUser };
}

async function mappingScalar(target, targetSchema, table, sourceColumn, value, expectedTenant, forbiddenColumns) {
  if (value == null) return value;
  const key = JSON.stringify({ [sourceColumn]: value });
  const mapping = await lookupMapping(target, table, key);
  if (!mapping) return null;
  const metadata = await tableMetadata(target, targetSchema, table);
  const targetRow = await assertMappingTargetExists(target, targetSchema, table, metadata, mapping, expectedTenant);
  assertTargetAttestation(mapping, targetRow, forbiddenColumns);
  const entries = Object.entries(mapping.canonical);
  return entries.length === 1 ? entries[0][1] : null;
}

async function transformRow(target, targetSchema, table, row, context, forbiddenColumns) {
  const transformed = { ...row };
  const tenantColumn = Object.hasOwn(row, "client_id") ? "client_id" : Object.hasOwn(row, "clientId") ? "clientId" : null;
  if (tenantColumn) {
    assertTenantSafe(row[tenantColumn], context.sourceTenant.client_id, context.targetTenant.client_id);
    transformed[tenantColumn] = context.targetTenant.client_id;
  }
  for (const column of Object.keys(transformed)) {
    if (transformed[column] == null) continue;
    if (USER_REFERENCE_COLUMNS.has(column)) {
      const mappedUser = await mappingScalar(target, targetSchema, "megadesk_domain_client_users", "user_id", transformed[column], context.targetTenant.client_id, forbiddenColumns);
      if (mappedUser == null) {
        throw new ReconciliationError("MISSING_USER_MAPPING", `Missing explicit user mapping for ${table}.${column}.`, { table, column, sourceIdHash: sha256(transformed[column]) });
      }
      transformed[column] = mappedUser;
    }
    const parent = DIRECT_REFERENCE_TABLES.get(column);
    if (parent) {
      // A column can be both an entity primary key and a foreign-key name in
      // child tables (for example contact_id and message_id).  Never attempt
      // to resolve an entity's own key before its mapping has been created.
      if (parent === table) continue;
      const mapped = await mappingScalar(target, targetSchema, parent, column === "anchor_message_id" || column === "reply_to_message_id" ? "message_id" : column, transformed[column], context.targetTenant.client_id, forbiddenColumns);
      if (mapped != null) transformed[column] = mapped;
      else {
        throw new ReconciliationError("MISSING_PARENT", `Missing ${parent} mapping for ${table}.${column}.`, { table, column, sourceIdHash: sha256(transformed[column]) });
      }
    }
  }
  return transformed;
}

async function findUniqueCollision(connection, schema, table, metadata, row) {
  const generatedFields = new Set(
    metadata.columns
      .filter(column => column.extra.includes("auto_increment"))
      .map(column => column.name),
  );
  const collisions = [];
  for (const index of metadata.unique) {
    // A source value for an auto-increment column is never copied.  Any index
    // containing that generated field therefore cannot identify a semantic
    // collision in the canonical target.
    if (index.fields.some(field => generatedFields.has(field))) continue;
    if (index.fields.some(field => row[field] == null)) continue;
    const where = index.fields.map(field => `${quote(field)} <=> ?`).join(" AND ");
    const matches = await query(connection, `SELECT * FROM ${quote(schema)}.${quote(table)} WHERE ${where} LIMIT 2`, index.fields.map(field => row[field]));
    if (matches.length > 1) throw new ReconciliationError("BROKEN_UNIQUE_INDEX", `Unique index ${index.name} returned multiple rows for ${table}.`);
    if (matches.length) collisions.push({ index: index.name, row: matches[0] });
  }
  if (metadata.primary.length
      && !metadata.primary.some(field => generatedFields.has(field))
      && metadata.primary.every(field => row[field] != null)) {
    const where = metadata.primary.map(field => `${quote(field)} <=> ?`).join(" AND ");
    const matches = await query(connection, `SELECT * FROM ${quote(schema)}.${quote(table)} WHERE ${where} LIMIT 1`, metadata.primary.map(field => row[field]));
    if (matches.length) collisions.push({ index: "PRIMARY", row: matches[0] });
  }
  if (!collisions.length) return null;
  const canonicalRows = new Map(collisions.map(collision => [JSON.stringify(stableValue(primaryObject(collision.row, metadata.primary))), collision]));
  if (canonicalRows.size !== 1) {
    throw new ReconciliationError("AMBIGUOUS_UNIQUE_COLLISION", `Different unique identities for ${table} point to different canonical rows.`, { indexes: collisions.map(collision => collision.index).sort(compareText) });
  }
  return collisions.sort((left, right) => compareText(left.index, right.index))[0];
}

async function attestExistingMapping(connection, schema, table, metadata, mapping, transformed, forbiddenColumns, expectedTenant) {
  const actual = await assertMappingTargetExists(connection, schema, table, metadata, mapping, expectedTenant);
  assertTargetAttestation(mapping, actual, forbiddenColumns);
  const expectedCanonical = JSON.stringify(stableValue(mapping.canonical));
  const collision = await findUniqueCollision(connection, schema, table, metadata, transformed);
  if (collision) {
    const collisionCanonical = JSON.stringify(stableValue(primaryObject(collision.row, metadata.primary)));
    if (collisionCanonical !== expectedCanonical) {
      throw new ReconciliationError("MAPPING_IDENTITY_CONFLICT", `Stored mapping for ${table} disagrees with its deterministic target identity.`, {
        storedCanonicalHash: sha256(expectedCanonical),
        identityCanonicalHash: sha256(collisionCanonical),
      });
    }
    return actual;
  }
  const generatedPrimary = metadata.columns
    .filter(column => metadata.primary.includes(column.name) && column.extra.includes("auto_increment"))
    .map(column => column.name);
  const excluded = [...forbiddenColumns, ...generatedPrimary];
  if (payloadHash(actual, excluded) !== payloadHash(transformed, excluded)) {
    throw new ReconciliationError("MAPPING_PAYLOAD_CONFLICT", `Stored mapping for ${table} points to an incompatible target payload.`, {
      storedCanonicalHash: sha256(expectedCanonical),
    });
  }
  return actual;
}

async function insertRow(connection, schema, table, metadata, row, forbidden) {
  const columns = metadata.columns
    .filter(column => !forbidden.has(column.name.toLowerCase()))
    .filter(column => !(column.extra.includes("auto_increment") && row[column.name] != null))
    .filter(column => Object.hasOwn(row, column.name));
  const names = columns.map(column => column.name);
  const sql = `INSERT INTO ${quote(schema)}.${quote(table)} (${names.map(quote).join(",")}) VALUES (${names.map(() => "?").join(",")})`;
  const result = await query(connection, sql, names.map(name => row[name]));
  const canonical = {};
  for (const field of metadata.primary) {
    const column = metadata.columns.find(candidate => candidate.name === field);
    canonical[field] = column?.extra.includes("auto_increment") ? result.insertId : row[field];
  }
  return canonical;
}

async function updateSettings(connection, schema, metadata, existing, incoming, forbidden) {
  const immutable = new Set([...metadata.primary, "client_id", "user_id", "created_at"]);
  const columns = metadata.columns.filter(column => !immutable.has(column.name) && !forbidden.has(column.name.toLowerCase()) && Object.hasOwn(incoming, column.name));
  const assignments = columns.map(column => `${quote(column.name)}=?`).join(",");
  const where = metadata.primary.map(field => `${quote(field)} <=> ?`).join(" AND ");
  await query(connection, `UPDATE ${quote(schema)}.megadesk_user_settings SET ${assignments} WHERE ${where}`, [...columns.map(column => incoming[column.name]), ...metadata.primary.map(field => existing[field])]);
  return primaryObject(existing, metadata.primary);
}

async function advancePendingReceipt(connection, schema, metadata, existing, incoming, forbidden) {
  const immutable = new Set([...metadata.primary, "client_id", "provider", "integration_id", "external_message_id", "received_at", "expires_at", "created_at"]);
  const columns = metadata.columns.filter(column => !immutable.has(column.name) && !forbidden.has(column.name.toLowerCase()) && Object.hasOwn(incoming, column.name));
  const assignments = columns.map(column => `${quote(column.name)}=?`).join(",");
  const where = metadata.primary.map(field => `${quote(field)} <=> ?`).join(" AND ");
  await query(connection, `UPDATE ${quote(schema)}.megadesk_conversation_pending_receipts SET ${assignments} WHERE ${where}`, [...columns.map(column => incoming[column.name]), ...metadata.primary.map(field => existing[field])]);
  return primaryObject(existing, metadata.primary);
}

function maybeInjectFailure(point, table, index) {
  const matchesTable = process.env.RECON_FAULT_TABLE === table;
  const matchesRow = Number(process.env.RECON_FAULT_AFTER ?? -1) === index + 1;
  const configuredPoint = process.env.RECON_FAULT_POINT;
  if (matchesTable && matchesRow && (configuredPoint === point || (!configuredPoint && point === "after_audit"))) {
    throw new ReconciliationError("INJECTED_FAILURE", `Injected rollback at ${point} after row ${index + 1} of ${table}.`);
  }
}

async function reconcileTable(source, target, sourceSchema, targetSchema, table, context, plan, report, runId) {
  const sourceMeta = await tableMetadata(source, sourceSchema, table);
  const targetMeta = await tableMetadata(target, targetSchema, table);
  if (!sourceMeta.primary.length || JSON.stringify(sourceMeta.primary) !== JSON.stringify(targetMeta.primary)) throw new ReconciliationError("PK_MISMATCH", `Primary key is absent or mismatched for ${table}.`);
  assertCompatibleImportSchema(table, sourceMeta, targetMeta);
  const tenantColumn = sourceMeta.columns.some(column => column.name === "client_id") ? "client_id" : sourceMeta.columns.some(column => column.name === "clientId") ? "clientId" : null;
  if (!tenantColumn) throw new ReconciliationError("MISSING_TENANT_KEY", `Import table ${table} has no tenant key.`);
  const sourceRows = await query(source, `SELECT * FROM ${quote(sourceSchema)}.${quote(table)} WHERE ${quote(tenantColumn)}=? ORDER BY ${sourceMeta.primary.map(quote).join(",")}`, [context.sourceTenant.client_id]);
  const forbidden = new Set(plan.forbiddenColumns.map(column => column.toLowerCase()));
  const stats = { source: sourceRows.length, inserted: 0, updated: 0, replayed: 0, conflicted: 0, blocked: 0, remapped: 0 };
  for (const [index, sourceRow] of sourceRows.entries()) {
      maybeInjectFailure("before_row", table, index);
      assertNoSecretMaterial(sourceRow);
      if (table === "megadesk_conversation_pending_receipts") assertPendingReceiptTtl(sourceRow);
      const key = sourceKey(sourceRow, sourceMeta.primary);
      const sourceHash = payloadHash(sourceRow, plan.forbiddenColumns);
      const previous = await lookupMapping(target, table, key);
      if (previous) {
        if (previous.sourcePayloadHash !== sourceHash) throw new ReconciliationError("IDEMPOTENCY_PAYLOAD_CONFLICT", `Source payload changed for ${table}.`, { sourceIdHash: sha256(key) });
        const transformed = await transformRow(target, targetSchema, table, sourceRow, context, plan.forbiddenColumns);
        await attestExistingMapping(target, targetSchema, table, targetMeta, previous, transformed, plan.forbiddenColumns, context.targetTenant.client_id);
        stats.replayed += 1;
        await insertAudit(target, { runId, table, sourceIdHash: sha256(key), canonicalIdHash: sha256(JSON.stringify(previous.canonical)), action: "replayed", reason: "existing deterministic mapping", afterHash: sourceHash });
        continue;
      }
      const transformed = await transformRow(target, targetSchema, table, sourceRow, context, plan.forbiddenColumns);
      const collision = await findUniqueCollision(target, targetSchema, table, targetMeta, transformed);
      let canonical;
      let action;
      let reason;
      let beforeHash = null;
      if (collision) {
        const collisionTenantColumn = Object.hasOwn(collision.row, "client_id") ? "client_id" : Object.hasOwn(collision.row, "clientId") ? "clientId" : null;
        if (collisionTenantColumn && String(collision.row[collisionTenantColumn]) !== String(context.targetTenant.client_id)) {
          throw new ReconciliationError("CROSS_TENANT_COLLISION", `Unique identity for ${table} resolves to another tenant.`, { table, index: collision.index });
        }
        if (table === "megadesk_conversation_pending_receipts" && collision.index === "uq_mdpr_external_scope") {
          const decision = classifyPendingReceipt(collision.row, transformed, plan.forbiddenColumns);
          if (decision === "CONFLICT") {
            stats.conflicted += 1;
            throw new ReconciliationError("PENDING_RECEIPT_PAYLOAD_CONFLICT", "Equal receipt scope has incompatible payload at the same status rank.", { sourceIdHash: sha256(key) });
          }
          if (decision === "ADVANCE") {
            beforeHash = payloadHash(collision.row, plan.forbiddenColumns);
            canonical = await advancePendingReceipt(target, targetSchema, targetMeta, collision.row, transformed, forbidden);
            stats.updated += 1;
            action = "updated";
            reason = "monotonic pending receipt status advance";
          } else {
            canonical = primaryObject(collision.row, targetMeta.primary);
            stats.replayed += 1;
            action = "replayed";
            reason = decision === "PRESERVE" ? "stale pending receipt status preserved" : "equal pending receipt replay";
          }
        } else if (table === "megadesk_conversation_contacts" && collision.index === "uq_mcc_identity") {
          // The schema-defined provider identity is the authoritative contact
          // identity after the explicit tenant mapping.  Preserve the Oracle
          // master attributes and map the Windows key so conversations cannot
          // be attached to a duplicate contact.
          canonical = primaryObject(collision.row, targetMeta.primary);
          stats.replayed += 1;
          action = "mapped";
          reason = "unique provider identity mapped to preserved Oracle contact master";
        } else if (table === "megadesk_user_settings" && collision.index !== "PRIMARY") {
          beforeHash = payloadHash(collision.row, plan.forbiddenColumns);
          canonical = await updateSettings(target, targetSchema, targetMeta, collision.row, transformed, forbidden);
          stats.updated += 1; action = "updated"; reason = `windows preference delta via ${collision.index}`;
        } else {
          const existingHash = payloadHash(collision.row, plan.forbiddenColumns);
          const incomingHash = payloadHash(transformed, plan.forbiddenColumns);
          if (classifyDuplicate(existingHash, incomingHash) !== "REPLAY") {
            stats.conflicted += 1;
            throw new ReconciliationError("UNIQUE_PAYLOAD_CONFLICT", `Incompatible ${table} payload for ${collision.index}.`, { table, index: collision.index, sourceIdHash: sha256(key) });
          }
          canonical = primaryObject(collision.row, targetMeta.primary);
          stats.replayed += 1; action = "replayed"; reason = `equal payload via ${collision.index}`;
        }
      } else {
        canonical = await insertRow(target, targetSchema, table, targetMeta, transformed, forbidden);
        stats.inserted += 1; action = "inserted"; reason = "windows-only deterministic delta";
      }
      maybeInjectFailure("after_domain", table, index);
      const targetRow = await assertMappingTargetExists(target, targetSchema, table, targetMeta, { canonical }, context.targetTenant.client_id);
      await storeMapping(target, { table, sourceKey: key, canonical, sourcePayloadHash: sourceHash, targetPayloadHash: payloadHash(targetRow, plan.forbiddenColumns), reason, confidence: action === "inserted" ? "generated" : "deterministic" });
      maybeInjectFailure("after_mapping", table, index);
      await insertAudit(target, { runId, table, sourceIdHash: sha256(key), canonicalIdHash: sha256(JSON.stringify(canonical)), action, reason, beforeHash, afterHash: payloadHash(transformed, plan.forbiddenColumns) });
      stats.remapped += Object.entries(transformed).filter(([column, value]) => value !== sourceRow[column]).length;
      maybeInjectFailure("after_audit", table, index);
  }
  report.tables[table] = stats;
  return stats;
}

function assertPlan(plan) {
  if (plan.defaultPolicy !== "BLOCK_FAIL_CLOSED") throw new ReconciliationError("UNSAFE_PLAN_DEFAULT", "Reconciliation plan must explicitly block unclassified tables.");
  const flattened = plan.transactionGroups.flat();
  if (JSON.stringify(flattened) !== JSON.stringify(plan.importOrder) || new Set(flattened).size !== flattened.length) {
    throw new ReconciliationError("INVALID_TRANSACTION_GROUPS", "Transaction groups must cover importOrder exactly once and in order.");
  }
  for (const table of plan.importOrder) {
    const entity = plan.entities[table];
    if (!entity || entity.authority === "DO_NOT_COPY" || plan.blockedTables.includes(table)) {
      throw new ReconciliationError("UNSAFE_IMPORT_PLAN", `Import table ${table} is absent or blocked.`);
    }
  }
  const blockedEntities = Object.entries(plan.entities)
    .filter(([, entity]) => entity.authority === "DO_NOT_COPY")
    .map(([table]) => table)
    .sort(compareText);
  const blockedTables = [...plan.blockedTables].sort(compareText);
  if (JSON.stringify(blockedEntities) !== JSON.stringify(blockedTables)) {
    throw new ReconciliationError("INVALID_BLOCKED_TABLES", "Every DO_NOT_COPY entity must be listed exactly once as blocked.");
  }
}

async function assertSourceCoverage(source, sourceSchema, sourceTenant, plan) {
  const tables = await query(source,
    `SELECT DISTINCT TABLE_NAME tableName FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=? AND COLUMN_NAME IN ('client_id','clientId') ORDER BY TABLE_NAME`,
    [sourceSchema]);
  const unclassified = [];
  for (const { tableName } of tables) {
    if (plan.entities[tableName]) continue;
    const meta = await tableMetadata(source, sourceSchema, tableName);
    const tenantColumn = meta.columns.some(column => column.name === "client_id") ? "client_id" : "clientId";
    const rows = await query(source, `SELECT COUNT(*) count FROM ${quote(sourceSchema)}.${quote(tableName)} WHERE ${quote(tenantColumn)}=?`, [sourceTenant.client_id]);
    if (Number(rows[0].count)) unclassified.push({ table: tableName, rows: Number(rows[0].count) });
  }
  if (unclassified.length) {
    throw new ReconciliationError("UNCLASSIFIED_SOURCE_DATA", "Tenant-scoped source data exists outside the fail-closed reconciliation plan.", { tables: unclassified });
  }
}

async function reconcileGroup(source, target, sourceSchema, targetSchema, tables, context, plan, report, runId) {
  await target.beginTransaction();
  try {
    for (const table of tables) await reconcileTable(source, target, sourceSchema, targetSchema, table, context, plan, report, runId);
    if (process.env.RECON_FAULT_POINT === "before_commit" && tables.includes(process.env.RECON_FAULT_TABLE)) {
      throw new ReconciliationError("INJECTED_FAILURE", `Injected rollback before commit of group containing ${process.env.RECON_FAULT_TABLE}.`);
    }
    await target.commit();
  } catch (error) {
    await target.rollback();
    throw error;
  }
}

async function blockedCounts(source, sourceSchema, context, plan) {
  const result = {};
  for (const table of plan.blockedTables) {
    const exists = await query(source, "SELECT COUNT(*) count FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?", [sourceSchema, table]);
    if (!Number(exists[0].count)) { result[table] = 0; continue; }
    const meta = await tableMetadata(source, sourceSchema, table);
    const tenantColumn = meta.columns.some(column => column.name === "client_id") ? "client_id" : meta.columns.some(column => column.name === "clientId") ? "clientId" : null;
    const countRows = tenantColumn
      ? await query(source, `SELECT COUNT(*) count FROM ${quote(sourceSchema)}.${quote(table)} WHERE ${quote(tenantColumn)}=?`, [context.sourceTenant.client_id])
      : await query(source, `SELECT COUNT(*) count FROM ${quote(sourceSchema)}.${quote(table)}`);
    result[table] = Number(countRows[0].count);
  }
  return result;
}

async function logicalFingerprint(connection, schema, plan) {
  const tables = await query(connection,
    "SELECT TABLE_NAME tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME", [schema]);
  const digest = createHash("sha256");
  for (const { tableName } of tables) {
    if (AUX_TABLES.has(tableName) || plan.blockedTables.includes(tableName)) continue;
    const meta = await tableMetadata(connection, schema, tableName);
    if (!meta.primary.length) throw new ReconciliationError("NONDETERMINISTIC_TABLE", `Cannot fingerprint ${tableName} without a primary key.`);
    const safeColumns = meta.columns.map(column => column.name).filter(column => !plan.forbiddenColumns.includes(column.toLowerCase()));
    const order = meta.primary.length ? ` ORDER BY ${meta.primary.map(quote).join(",")}` : "";
    const tableRows = await query(connection, `SELECT ${safeColumns.map(quote).join(",")} FROM ${quote(schema)}.${quote(tableName)}${order}`);
    digest.update(tableName);
    for (const row of tableRows) digest.update(JSON.stringify(stableValue(row)));
  }
  return digest.digest("hex");
}

async function assertMigrationState(target) {
  const rows = await query(target, "SELECT COUNT(*) count,MAX(created_at) lastCreatedAt FROM __drizzle_migrations");
  if (Number(rows[0].count) !== 37 || String(rows[0].lastCreatedAt) !== "1790786929102") {
    throw new ReconciliationError("TARGET_MIGRATION_MISMATCH", "Target staging must be exactly at 0036.", { count: Number(rows[0].count), lastCreatedAt: String(rows[0].lastCreatedAt) });
  }
}

export async function reconcile(options) {
  const plan = JSON.parse(await readFile(PLAN_URL, "utf8"));
  assertPlan(plan);
  const mapping = assertRuntimeMapping(JSON.parse(await readFile(options.mappingFile, "utf8")));
  const sourceSchema = assertStagingDatabaseUrl(options.sourceUrl).database;
  const targetSchema = assertStagingDatabaseUrl(options.targetUrl).database;
  assertDistinctDatabaseNames({ source: sourceSchema, target: targetSchema });
  const source = await mysql.createConnection({ uri: options.sourceUrl, timezone: "Z", dateStrings: true });
  const target = await mysql.createConnection({ uri: options.targetUrl, timezone: "Z", dateStrings: true });
  const runId = sha256(JSON.stringify(stableValue({ sourceSchema, targetSchema, mapping, planVersion: plan.version })));
  const report = { version: 1, runId, sourceSchema, targetSchema, startedAt: new Date().toISOString(), tables: {}, conflicts: [], blocked: {}, fingerprintBefore: null, fingerprintAfter: null };
  try {
    await assertMigrationState(target);
    await createAuxiliaryTables(target);
    report.fingerprintBefore = await logicalFingerprint(target, targetSchema, plan);
    const context = await resolveExplicitMappings(source, target, sourceSchema, targetSchema, mapping, plan, runId);
    await assertSourceCoverage(source, sourceSchema, context.sourceTenant, plan);
    report.mapping = {
      tenant: { sourceHash: sha256(context.sourceTenant.client_id), targetHash: sha256(context.targetTenant.client_id), result: "EXPLICIT_UNIQUE" },
      user: { sourceHash: sha256(context.sourceUser.user_id), targetHash: sha256(context.targetUser.user_id), result: "EXPLICIT_UNIQUE_ROLE_STATUS_MATCH" }
    };
    report.blocked = await blockedCounts(source, sourceSchema, context, plan);
    for (const group of plan.transactionGroups) await reconcileGroup(source, target, sourceSchema, targetSchema, group, context, plan, report, runId);
    report.fingerprintAfter = await logicalFingerprint(target, targetSchema, plan);
    report.finishedAt = new Date().toISOString();
    report.summary = Object.values(report.tables).reduce((sum, table) => {
      for (const key of ["source", "inserted", "updated", "replayed", "conflicted", "blocked", "remapped"]) sum[key] += table[key];
      return sum;
    }, { source: 0, inserted: 0, updated: 0, replayed: 0, conflicted: 0, blocked: Object.values(report.blocked).reduce((a, b) => a + b, 0), remapped: 0 });
    await writeFile(options.reportFile, JSON.stringify(report, null, 2), { encoding: "utf8", mode: 0o600 });
    return report;
  } finally {
    await source.end();
    await target.end();
  }
}

async function main() {
  const command = process.argv[2];
  if (command !== "reconcile") throw new Error("Use: node scripts/reconciliation/reconciler.mjs reconcile");
  const required = ["RECON_SOURCE_URL", "RECON_TARGET_URL", "RECON_MAPPING_FILE", "RECON_REPORT_FILE"];
  for (const name of required) if (!process.env[name]) throw new Error(`${name} is required.`);
  const report = await reconcile({
    sourceUrl: process.env.RECON_SOURCE_URL,
    targetUrl: process.env.RECON_TARGET_URL,
    mappingFile: process.env.RECON_MAPPING_FILE,
    reportFile: process.env.RECON_REPORT_FILE
  });
  process.stdout.write(`${JSON.stringify({ runId: report.runId, summary: report.summary, fingerprintAfter: report.fingerprintAfter })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ error: error.name, code: error.code ?? "UNEXPECTED", message: error.message, details: error.details ?? {} })}\n`);
    process.exitCode = 1;
  });
}
