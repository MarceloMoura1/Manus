import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

export type ProvisionedClient = {
  id: string;
  clientId: string;
  tenantDatabaseName: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  cnpj: string;
  plan: string;
  maxUsers: number;
  statusType: "active" | "test";
  status: "provisioning" | "active" | "setup" | "failed" | "paused";
  accessReleased: boolean;
  apiToken: string;
  modules: string[];
  integrations: Record<string, unknown>;
  users: Array<{ id: string; name: string; email: string; role: "admin"; status: "active" | "blocked"; permissions: string[]; passwordHash?: string }>;
};

export type ProvisionClientInput = {
  idempotencyKey: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  cnpj: string;
  plan: string;
  maxUsers: number;
  statusType: "active" | "test";
  passwordHash: string;
  permissions: string[];
  actorId: string;
};

type ProvisioningRow = RowDataPacket & { payloadHash: string; clientId: string };
type ClientRow = RowDataPacket & {
  id: string; clientId: string; tenantDatabaseName: string; company: string; contact: string;
  email: string | null; phone: string; cnpj: string | null; plan: string; maxUsers: number;
  statusType: "active" | "test"; status: ProvisionedClient["status"]; accessReleased: number;
  apiToken: string; modulesJson: string; integrationsJson: string;
};
type UserRow = RowDataPacket & {
  id: string; name: string; email: string; role: "admin"; status: "active" | "blocked";
  permissionsJson: string; passwordHash: string | null;
};

function payloadHash(input: ProvisionClientInput): string {
  const canonical = JSON.stringify({
    company: input.company, contact: input.contact, email: input.email, phone: input.phone,
    cnpj: input.cnpj, plan: input.plan, maxUsers: input.maxUsers, statusType: input.statusType,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
}

function parseObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

async function loadClient(connection: PoolConnection, clientId: string): Promise<ProvisionedClient> {
  const [clientRows] = await connection.execute<ClientRow[]>(
    "SELECT internal_id AS id, client_id AS clientId, tenant_database_name AS tenantDatabaseName, company, contact, email, phone, cnpj, plan, max_users AS maxUsers, status_type AS statusType, status, access_released AS accessReleased, api_token AS apiToken, modules_json AS modulesJson, integrations_json AS integrationsJson FROM megadesk_domain_clients WHERE client_id = ?",
    [clientId],
  );
  const row = clientRows[0];
  if (!row) throw new Error("PROVISIONED_CLIENT_NOT_FOUND");
  const [userRows] = await connection.execute<UserRow[]>(
    "SELECT user_id AS id, name, email, role, status, permissions_json AS permissionsJson, password_hash AS passwordHash FROM megadesk_domain_client_users WHERE client_id = ? ORDER BY created_at, user_id",
    [clientId],
  );
  return {
    id: row.id, clientId: row.clientId, tenantDatabaseName: row.tenantDatabaseName,
    company: row.company, contact: row.contact, email: row.email ?? "", phone: row.phone,
    cnpj: row.cnpj ?? "", plan: row.plan, maxUsers: row.maxUsers, statusType: row.statusType,
    status: row.status, accessReleased: Boolean(row.accessReleased), apiToken: row.apiToken,
    modules: parseStringArray(row.modulesJson), integrations: parseObject(row.integrationsJson),
    users: userRows.map((user) => ({
      id: user.id, name: user.name, email: user.email, role: "admin", status: user.status,
      permissions: parseStringArray(user.permissionsJson), ...(user.passwordHash ? { passwordHash: user.passwordHash } : {}),
    })),
  };
}

async function executeProvisioning(connection: PoolConnection, input: ProvisionClientInput): Promise<{ client: ProvisionedClient; replay: boolean }> {
  const hash = payloadHash(input);
  const [requestRows] = await connection.execute<ProvisioningRow[]>(
    "SELECT payload_hash AS payloadHash, client_id AS clientId FROM megadesk_tenant_provisioning_requests WHERE idempotency_key = ? FOR UPDATE",
    [input.idempotencyKey],
  );
  if (requestRows[0]) {
    if (requestRows[0].payloadHash !== hash) throw new Error("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
    return { client: await loadClient(connection, requestRows[0].clientId), replay: true };
  }

  const naturalSql = input.cnpj
    ? "SELECT email, cnpj FROM megadesk_domain_clients WHERE email = ? OR cnpj = ? FOR UPDATE"
    : "SELECT email, cnpj FROM megadesk_domain_clients WHERE email = ? FOR UPDATE";
  const [naturalRows] = await connection.execute<Array<RowDataPacket & { email: string | null; cnpj: string | null }>>(naturalSql, input.cnpj ? [input.email, input.cnpj] : [input.email]);
  if (naturalRows[0]) {
    if (naturalRows.some((row) => row.email === input.email)) throw new Error("COMPANY_EMAIL_ALREADY_EXISTS");
    throw new Error("COMPANY_DOCUMENT_ALREADY_EXISTS");
  }

  const clientId = `cliente-${randomUUID()}`;
  const client: ProvisionedClient = {
    id: `client-${randomUUID()}`, clientId, tenantDatabaseName: `tenant_${clientId.replaceAll("-", "_")}`,
    company: input.company, contact: input.contact, email: input.email, phone: input.phone, cnpj: input.cnpj,
    plan: input.plan, maxUsers: input.maxUsers, statusType: input.statusType, status: "provisioning",
    accessReleased: false, apiToken: `mdsk_live_${randomUUID()}`, modules: [], integrations: {},
    users: [{ id: `user-${randomUUID()}`, name: input.contact, email: input.email, role: "admin",
      status: "blocked", permissions: input.permissions, passwordHash: input.passwordHash }],
  };
  await connection.execute(
    "INSERT INTO megadesk_domain_clients (client_id, internal_id, tenant_database_name, company, contact, email, phone, cnpj, plan, max_users, status, status_type, access_released, api_token, modules_json, integrations_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
    [client.clientId, client.id, client.tenantDatabaseName, client.company, client.contact, client.email, client.phone, client.cnpj || null, client.plan, client.maxUsers, client.status, client.statusType, client.apiToken, "[]", "{}"],
  );
  const user = client.users[0];
  await connection.execute(
    "INSERT INTO megadesk_domain_client_users (user_id, client_id, name, email, role, status, permissions_json, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [user.id, client.clientId, user.name, user.email, user.role, user.status, JSON.stringify(user.permissions), user.passwordHash],
  );
  await connection.execute(
    "INSERT INTO megadesk_domain_audit_logs (audit_id, platform, action, client_id, success) VALUES (?, 'MegaAdmin', ?, ?, 1)",
    [`audit-${randomUUID()}`, `tenant_provisioned;operator=${input.actorId}`, client.clientId],
  );
  await connection.execute(
    "INSERT INTO megadesk_tenant_provisioning_requests (idempotency_key, payload_hash, client_id) VALUES (?, ?, ?)",
    [input.idempotencyKey, hash, client.clientId],
  );
  return { client, replay: false };
}

type MysqlTransactionError = {
  code?: unknown;
  sql?: unknown;
  sqlMessage?: unknown;
};

export type ProvisioningErrorClassification =
  | "retryable-lock"
  | "retryable-idempotency-race"
  | "duplicate-company-email"
  | "duplicate-company-document"
  | "duplicate-tenant-database"
  | "duplicate-unexpected"
  | "permanent";

export function classifyProvisioningError(error: unknown): ProvisioningErrorClassification {
  if (typeof error !== "object" || error === null) return "permanent";
  const mysqlError = error as MysqlTransactionError;
  if (mysqlError.code === "ER_LOCK_DEADLOCK" || mysqlError.code === "ER_LOCK_WAIT_TIMEOUT") return "retryable-lock";
  if (mysqlError.code !== "ER_DUP_ENTRY") return "permanent";

  const sql = typeof mysqlError.sql === "string" ? mysqlError.sql.toLowerCase() : "";
  const message = typeof mysqlError.sqlMessage === "string" ? mysqlError.sqlMessage.toLowerCase() : "";
  if (sql.includes("megadesk_tenant_provisioning_requests") && (message.includes("primary") || message.includes("idempotency_key"))) {
    return "retryable-idempotency-race";
  }
  if (message.includes("uq_mdc_company_email")) return "duplicate-company-email";
  if (message.includes("uq_mdc_company_document")) return "duplicate-company-document";
  if (message.includes("tenant_database_name")) return "duplicate-tenant-database";
  return "duplicate-unexpected";
}

export type ProvisioningRetryOptions = {
  wait?: (delayMs: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
};

export function provisioningBackoffMs(attempt: number, random: () => number = Math.random, baseDelayMs = 25, maxDelayMs = 400, jitterRatio = 0.25): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  const jitter = Math.floor(exponential * jitterRatio * Math.max(0, Math.min(1, random())));
  return Math.min(maxDelayMs, exponential + jitter);
}

function duplicateDomainError(classification: ProvisioningErrorClassification): Error {
  if (classification === "duplicate-company-email") return new Error("COMPANY_EMAIL_ALREADY_EXISTS");
  if (classification === "duplicate-company-document") return new Error("COMPANY_DOCUMENT_ALREADY_EXISTS");
  if (classification === "duplicate-tenant-database") return new Error("TENANT_DATABASE_IDENTITY_CONFLICT");
  return new Error("UNEXPECTED_UNIQUE_CONSTRAINT_CONFLICT");
}

export async function provisionClientAtomically(pool: Pool, input: ProvisionClientInput, options: ProvisioningRetryOptions = {}): Promise<{ client: ProvisionedClient; replay: boolean }> {
  const wait = options.wait ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const random = options.random ?? Math.random;
  const maxAttempts = options.maxAttempts ?? 4;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await executeProvisioning(connection, input);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      const classification = classifyProvisioningError(error);
      if ((classification === "retryable-lock" || classification === "retryable-idempotency-race") && attempt + 1 < maxAttempts) {
        await wait(provisioningBackoffMs(attempt, random, options.baseDelayMs, options.maxDelayMs, options.jitterRatio));
        continue;
      }
      if (classification.startsWith("duplicate-")) throw duplicateDomainError(classification);
      throw error;
    } finally {
      connection.release();
    }
  }
  throw new Error("TENANT_PROVISIONING_RETRY_EXHAUSTED");
}
