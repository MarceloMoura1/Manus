import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { appRouter } from "./routers";
import { getPool } from "./db";
import { createContext } from "./_core/context";
import {
  MEGADESK_SESSION_COOKIE,
  MysqlOperationalSessionRepository,
  clearOperationalSessionCookie,
  createOperationalSession,
  resolveOperationalSession,
  revokeOperationalSession,
} from "./_core/megadesk-session";
import { isTestDatabaseEnabled } from "./test-integration-gates";

const physical = describe.runIf(isTestDatabaseEnabled());
const repository = new MysqlOperationalSessionRepository();

function request(cookie?: string, headers: Record<string, string> = {}): Request {
  return Object.assign(Object.create(null), { headers: { ...headers, cookie }, secure: false, cookies: {} }) as Request;
}

function response(): Response {
  return Object.assign(Object.create(null), { cookie: vi.fn(), clearCookie: vi.fn() }) as Response;
}

async function session(userId: string, clientId: string) {
  const res = response();
  await createOperationalSession({ userId, clientId }, res, request(), repository);
  const token = vi.mocked(res.cookie).mock.calls[0][1] as string;
  return { token, req: request(`${MEGADESK_SESSION_COOKIE}=${token}`), res };
}

async function scalar(sql: string, values: readonly unknown[] = []): Promise<number> {
  const [rows] = await getPool().execute<RowDataPacket[]>(sql, [...values]);
  return Number(rows[0]?.value ?? 0);
}

async function resetFixtures() {
  await getPool().execute("DELETE FROM megadesk_operational_sessions WHERE client_id IN ('auth-tenant-a','auth-tenant-b')");
  await getPool().execute("DELETE FROM megadesk_domain_client_users WHERE client_id IN ('auth-tenant-a','auth-tenant-b')");
  await getPool().execute("DELETE FROM megadesk_domain_clients WHERE client_id IN ('auth-tenant-a','auth-tenant-b')");
  await getPool().execute(
    "INSERT INTO megadesk_domain_clients (client_id,internal_id,tenant_database_name,company,contact,phone,plan,status,status_type,access_released,api_token,modules_json,integrations_json) VALUES ('auth-tenant-a','auth-internal-a','auth_db_a','Fixture A','Fixture','00000000000','Test','active','test',1,'fixture-a','[]','{}'),('auth-tenant-b','auth-internal-b','auth_db_b','Fixture B','Fixture','00000000000','Test','active','test',1,'fixture-b','[]','{}')",
  );
  await getPool().execute(
    "INSERT INTO megadesk_domain_client_users (user_id,client_id,name,email,role,status,permissions_json) VALUES ('auth-user-a','auth-tenant-a','User A','shared-auth@example.invalid','agent','active','[]'),('auth-user-b','auth-tenant-b','User B','shared-auth@example.invalid','manager','active','[]')",
  );
}

physical("MegaDesk authentication against disposable MySQL", () => {
  beforeAll(resetFixtures);
  afterAll(async () => {
    await getPool().execute("DELETE FROM megadesk_operational_sessions WHERE client_id IN ('auth-tenant-a','auth-tenant-b')");
    await getPool().execute("DELETE FROM megadesk_domain_client_users WHERE client_id IN ('auth-tenant-a','auth-tenant-b')");
    await getPool().execute("DELETE FROM megadesk_domain_clients WHERE client_id IN ('auth-tenant-a','auth-tenant-b')");
  });

  it("persists only a 64-character SHA-256 hash with the correct binding and expiry", async () => {
    const created = await session("auth-user-a", "auth-tenant-a");
    const [rows] = await getPool().execute<RowDataPacket[]>("SELECT token_hash,user_id,client_id,expires_at,created_at FROM megadesk_operational_sessions WHERE client_id='auth-tenant-a' AND revoked_at IS NULL");
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].token_hash).not.toBe(created.token);
    expect(rows[0]).toMatchObject({ user_id: "auth-user-a", client_id: "auth-tenant-a" });
    const duration = new Date(rows[0].expires_at).getTime() - new Date(rows[0].created_at).getTime();
    expect(duration).toBe(8 * 60 * 60 * 1000);
  });

  it("rotates atomically and keeps exactly one valid session", async () => {
    await session("auth-user-a", "auth-tenant-a");
    await session("auth-user-a", "auth-tenant-a");
    expect(await scalar("SELECT COUNT(*) value FROM megadesk_operational_sessions WHERE client_id='auth-tenant-a' AND revoked_at IS NULL")).toBe(1);
    expect(await scalar("SELECT COUNT(*) value FROM megadesk_operational_sessions WHERE client_id='auth-tenant-a' AND revoked_at IS NOT NULL")).toBeGreaterThan(0);
  });

  it("rolls back revocation when the replacement insert fails", async () => {
    const fixedToken = "a".repeat(43);
    await createOperationalSession({ userId: "auth-user-a", clientId: "auth-tenant-a" }, response(), request(), repository, () => fixedToken);
    await expect(createOperationalSession(
      { userId: "auth-user-a", clientId: "auth-tenant-a" }, response(), request(), repository, () => fixedToken,
    )).rejects.toThrow();
    expect(await scalar("SELECT COUNT(*) value FROM megadesk_operational_sessions WHERE client_id='auth-tenant-a' AND revoked_at IS NULL")).toBe(1);
  });

  it("revalidates tenant, access, user, role, revocation and deletion on every lookup", async () => {
    const created = await session("auth-user-a", "auth-tenant-a");
    expect((await resolveOperationalSession(created.req, repository))?.role).toBe("agent");
    await getPool().execute("UPDATE megadesk_domain_client_users SET role='viewer' WHERE user_id='auth-user-a'");
    expect((await resolveOperationalSession(created.req, repository))?.role).toBe("viewer");
    await getPool().execute("UPDATE megadesk_domain_clients SET status='paused' WHERE client_id='auth-tenant-a'");
    expect(await resolveOperationalSession(created.req, repository)).toBeNull();
    await getPool().execute("UPDATE megadesk_domain_clients SET status='active',access_released=0 WHERE client_id='auth-tenant-a'");
    expect(await resolveOperationalSession(created.req, repository)).toBeNull();
    await getPool().execute("UPDATE megadesk_domain_clients SET access_released=1 WHERE client_id='auth-tenant-a'");
    await getPool().execute("UPDATE megadesk_domain_client_users SET status='blocked' WHERE user_id='auth-user-a'");
    expect(await resolveOperationalSession(created.req, repository)).toBeNull();
    await getPool().execute("UPDATE megadesk_domain_client_users SET status='active' WHERE user_id='auth-user-a'");
    expect(await revokeOperationalSession(created.req, repository)).toBe(true);
    expect(await resolveOperationalSession(created.req, repository)).toBeNull();
  });

  it("does not authenticate forged headers and rejects cross-tenant assertions", async () => {
    const forged = request(undefined, { "x-tenant-id": "auth-tenant-a", "x-user-email": "shared-auth@example.invalid", "x-user-role": "admin" });
    const ctx = await createContext({ req: forged, res: response() });
    expect(ctx.operationalSessionId).toBeUndefined();
    const created = await session("auth-user-a", "auth-tenant-a");
    const identity = await resolveOperationalSession(created.req, repository);
    if (!identity) throw new Error("fixture session was not resolved");
    const caller = appRouter.createCaller({
      req: request(`${MEGADESK_SESSION_COOKIE}=${created.token}`, { "x-tenant-id": "auth-tenant-b" }),
      res: response(), user: null, tenantId: identity.tenantId, userEmail: identity.userEmail,
      operationalUserId: identity.userId, operationalUserRole: identity.role, operationalSessionId: identity.sessionId,
    });
    await expect(caller.megadesk.getClientUsers({ clientId: "auth-tenant-b" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("logs out idempotently, preserves another tenant and clears only the MegaDesk cookie", async () => {
    const first = await session("auth-user-a", "auth-tenant-a");
    const other = await session("auth-user-b", "auth-tenant-b");
    expect(await revokeOperationalSession(first.req, repository)).toBe(true);
    expect(await revokeOperationalSession(first.req, repository)).toBe(false);
    expect(await resolveOperationalSession(first.req, repository)).toBeNull();
    expect(await resolveOperationalSession(other.req, repository)).not.toBeNull();
    const res = response();
    clearOperationalSessionCookie(res, first.req);
    expect(res.clearCookie).toHaveBeenCalledOnce();
    expect(vi.mocked(res.clearCookie).mock.calls[0][0]).toBe(MEGADESK_SESSION_COOKIE);
  });
});
