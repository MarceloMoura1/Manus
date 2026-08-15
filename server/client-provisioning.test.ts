import { describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { classifyProvisioningError, provisioningBackoffMs, provisionClientAtomically, type ProvisionClientInput } from "./_core/client-provisioning";
import { getPool } from "./db";
import { isTestDatabaseEnabled } from "./test-integration-gates";
import { runPostCommitBestEffort } from "./_core/post-commit";

const databaseIntegration = describe.runIf(isTestDatabaseEnabled());

describe("provisioning retry policy", () => {
  it.each(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"])("retries the transient error %s", (code) => {
    expect(classifyProvisioningError({ code })).toBe("retryable-lock");
  });

  it("retries only an idempotency-key duplicate race", () => {
    expect(classifyProvisioningError({ code: "ER_DUP_ENTRY", sql: "INSERT INTO megadesk_tenant_provisioning_requests", sqlMessage: "Duplicate entry for key 'PRIMARY'" })).toBe("retryable-idempotency-race");
    expect(classifyProvisioningError({ code: "ER_DUP_ENTRY", sqlMessage: "Duplicate entry for key 'uq_mdc_company_email'" })).toBe("duplicate-company-email");
    expect(classifyProvisioningError({ code: "ER_DUP_ENTRY", sqlMessage: "Duplicate entry for key 'uq_mdc_company_document'" })).toBe("duplicate-company-document");
    expect(classifyProvisioningError({ code: "ER_DUP_ENTRY", sqlMessage: "Duplicate entry for key 'tenant_database_name'" })).toBe("duplicate-tenant-database");
    expect(classifyProvisioningError({ code: "ER_DUP_ENTRY", sqlMessage: "Duplicate entry for key 'unknown_unique'" })).toBe("duplicate-unexpected");
  });

  it("uses bounded exponential delay and bounded jitter", () => {
    expect([0, 1, 2, 3, 4, 5].map((attempt) => provisioningBackoffMs(attempt, () => 0, 25, 200, 0.25))).toEqual([25, 50, 100, 200, 200, 200]);
    expect(provisioningBackoffMs(1, () => 1, 100, 1_000, 0.25)).toBe(250);
    expect(provisioningBackoffMs(20, () => 1, 25, 400, 0.25)).toBe(400);
  });

  function fakePool(failures: Array<Record<string, string>>) {
    const waits: number[] = [];
    let attempts = 0;
    const pool = {
      getConnection: async () => {
        attempts += 1;
        return {
          beginTransaction: async () => undefined,
          commit: async () => undefined,
          rollback: async () => undefined,
          release: () => undefined,
          execute: async (sql: string) => {
            if (sql.includes("megadesk_tenant_provisioning_requests") && sql.startsWith("SELECT")) {
              const failure = failures.shift();
              if (failure) throw failure;
              return [[]];
            }
            return [[]];
          },
        };
      },
    } as Pool;
    return { pool, waits, attempts: () => attempts, wait: async (delay: number) => { waits.push(delay); } };
  }

  it.each(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"])("waits and retries %s until the maximum", async (code) => {
    const fake = fakePool([{ code }, { code }, { code }, { code }]);
    await expect(provisionClientAtomically(fake.pool, input("retry", "provisioning-retry-policy-01"), { wait: fake.wait, random: () => 0 }))
      .rejects.toMatchObject({ code });
    expect(fake.attempts()).toBe(4);
    expect(fake.waits).toEqual([25, 50, 100]);
  });

  it("succeeds without retry", async () => {
    const fake = fakePool([]);
    await expect(provisionClientAtomically(fake.pool, input("success", "provisioning-success-01"), { wait: fake.wait })).resolves.toMatchObject({ replay: false });
    expect(fake.attempts()).toBe(1);
    expect(fake.waits).toEqual([]);
  });

  it.each(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"])("recovers after one transient %s", async (code) => {
    const fake = fakePool([{ code }]);
    await expect(provisionClientAtomically(fake.pool, input("recovery", `provisioning-${code.toLowerCase()}-01`), { wait: fake.wait, random: () => 0 })).resolves.toMatchObject({ replay: false });
    expect(fake.attempts()).toBe(2);
    expect(fake.waits).toEqual([25]);
  });

  it("fails a permanent duplicate immediately without waiting", async () => {
    const fake = fakePool([{ code: "ER_DUP_ENTRY", sqlMessage: "Duplicate entry for key 'uq_mdc_company_email'" }]);
    await expect(provisionClientAtomically(fake.pool, input("permanent", "provisioning-permanent-01"), { wait: fake.wait }))
      .rejects.toThrow("COMPANY_EMAIL_ALREADY_EXISTS");
    expect(fake.attempts()).toBe(1);
    expect(fake.waits).toEqual([]);
  });
});

function input(suffix: string, idempotencyKey: string): ProvisionClientInput {
  return {
    idempotencyKey,
    company: `Provisioning ${suffix}`,
    contact: "Provisioning Test",
    email: `provisioning-${suffix}@example.invalid`,
    phone: "5511999999999",
    cnpj: "",
    plan: "Test",
    maxUsers: 5,
    statusType: "test",
    passwordHash: "test-only-hash",
    permissions: ["home"],
    actorId: "integration-test",
  };
}

databaseIntegration("Transactional client provisioning [database integration]", () => {
  it("coalesces concurrent requests with the same persistent key", async () => {
    const request = input("same-key", "provisioning-same-key-0001");
    const [first, second] = await Promise.all([
      provisionClientAtomically(getPool(), request),
      provisionClientAtomically(getPool(), request),
    ]);
    expect(second.client.clientId).toBe(first.client.clientId);
    expect([first.replay, second.replay].filter(Boolean)).toHaveLength(1);
  });

  it("rejects reuse of a key with a different payload", async () => {
    const request = input("payload-a", "provisioning-payload-key-0001");
    await provisionClientAtomically(getPool(), request);
    await expect(provisionClientAtomically(getPool(), { ...request, company: "Different company" }))
      .rejects.toThrow("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
  });

  it("rejects the losing concurrent key for one natural identity without multiplying data", async () => {
    const firstRequest = input("natural-key", "provisioning-natural-key-0001");
    const secondRequest = { ...firstRequest, idempotencyKey: "provisioning-natural-key-0002" };
    const results = await Promise.allSettled([
      provisionClientAtomically(getPool(), firstRequest),
      provisionClientAtomically(getPool(), secondRequest),
    ]);
    const fulfilled = results.find((result) => result.status === "fulfilled");
    const rejected = results.find((result) => result.status === "rejected");
    expect(fulfilled?.status).toBe("fulfilled");
    expect(rejected?.status).toBe("rejected");
    if (fulfilled?.status !== "fulfilled") throw new Error("expected one successful provisioning");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({ message: "COMPANY_EMAIL_ALREADY_EXISTS" });
    const first = fulfilled.value;

    const [rows] = await getPool().execute<Array<RowDataPacket & { clients: number; users: number; audits: number; requests: number }>>(
      `SELECT
        (SELECT COUNT(*) FROM megadesk_domain_clients WHERE email = ?) AS clients,
        (SELECT COUNT(*) FROM megadesk_domain_client_users WHERE client_id = ?) AS users,
        (SELECT COUNT(*) FROM megadesk_domain_audit_logs WHERE client_id = ? AND action LIKE 'tenant_provisioned;%') AS audits,
        (SELECT COUNT(*) FROM megadesk_tenant_provisioning_requests WHERE client_id = ?) AS requests`,
      [firstRequest.email, first.client.clientId, first.client.clientId, first.client.clientId],
    );
    expect(rows[0]).toMatchObject({ clients: 1, users: 1, audits: 1, requests: 1 });
  });

  it("rolls back client, user, audit and idempotency when a pre-commit write fails", async () => {
    const request = { ...input("rollback", "provisioning-rollback-0001"), actorId: "x".repeat(1_000) };
    await expect(provisionClientAtomically(getPool(), request)).rejects.toThrow();
    const [rows] = await getPool().execute<Array<RowDataPacket & { clients: number; users: number; audits: number; requests: number }>>(
      `SELECT
        (SELECT COUNT(*) FROM megadesk_domain_clients WHERE email = ?) AS clients,
        (SELECT COUNT(*) FROM megadesk_domain_client_users WHERE email = ?) AS users,
        (SELECT COUNT(*) FROM megadesk_domain_audit_logs WHERE action LIKE 'tenant_provisioned;%') AS audits,
        (SELECT COUNT(*) FROM megadesk_tenant_provisioning_requests WHERE idempotency_key = ?) AS requests`,
      [request.email, request.email, request.idempotencyKey],
    );
    expect(rows[0]).toMatchObject({ clients: 0, users: 0, requests: 0 });
  });

  it("keeps a committed client recoverable when post-commit effects fail", async () => {
    const request = input("post-commit", "provisioning-post-commit-0001");
    const first = await provisionClientAtomically(getPool(), request);
    await expect(runPostCommitBestEffort([
      () => { throw new Error("cache failed"); },
      async () => { throw new Error("metric failed"); },
    ], () => undefined)).resolves.toBeUndefined();
    const replay = await provisionClientAtomically(getPool(), request);
    expect(replay).toMatchObject({ replay: true, client: { clientId: first.client.clientId } });
  });
});
