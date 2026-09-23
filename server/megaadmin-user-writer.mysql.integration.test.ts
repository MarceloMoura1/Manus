import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { megadeskDomainAuditLogs, megadeskDomainClientUsers, megadeskDomainClients, megadeskDomainMetrics } from "../drizzle/schema";
import { appRouter } from "./routers";
import {
  getDb,
  inMemoryState,
  loadMegaDeskStructuredState,
  persistMegaDeskClientUser,
  type MegaDeskClientUserPersistenceInput,
  type MegaDeskStructuredState,
} from "./db";
import { isTestDatabaseEnabled } from "./test-integration-gates";

const integration = describe.runIf(isTestDatabaseEnabled());
type CreateInput = Extract<MegaDeskClientUserPersistenceInput, { kind: "create" }>;
type UpdateInput = Extract<MegaDeskClientUserPersistenceInput, { kind: "update" }>;
type PasswordResetInput = Extract<MegaDeskClientUserPersistenceInput, { kind: "reset-password" }>;

let clientA = "";
let clientB = "";

const adminCaller = appRouter.createCaller({
  req: { headers: {}, cookies: {} } as any,
  res: { cookie: () => {}, clearCookie: () => {} } as any,
  user: { id: 1, email: "integration-admin@example.invalid", name: "Integration Admin", role: "admin" as const },
});

function audit(clientId: string, id = `audit-${randomUUID()}`) {
  return { id, clientId, platform: "MegaAdmin" as const, action: "synthetic user writer integration", success: true };
}

function createInput(clientId: string, userId: string, email: string, auditId?: string): CreateInput {
  return {
    kind: "create",
    clientId,
    userId,
    changes: {
      name: "Synthetic User",
      email,
      role: "agent",
      status: "active",
      permissions: ["tickets"],
      passwordHash: "synthetic-hash-created",
    },
    audit: audit(clientId, auditId),
  };
}

function updateInput(clientId: string, userId: string, changes: UpdateInput["changes"], auditId?: string): UpdateInput {
  return { kind: "update", clientId, userId, changes, audit: audit(clientId, auditId) };
}

function passwordResetInput(clientId: string, userId: string, passwordHash: string, auditId?: string): PasswordResetInput {
  return { kind: "reset-password", clientId, userId, changes: { passwordHash }, audit: audit(clientId, auditId) };
}

async function insertClient(clientId: string, maxUsers: number) {
  await getDb().insert(megadeskDomainClients).values({
    clientId,
    internalId: `internal-${clientId}`,
    tenantDatabaseName: `mdsk_${clientId.replace(/[^a-z0-9]/gi, "").slice(-24)}`,
    company: `Synthetic ${clientId}`,
    contact: "Synthetic Operator",
    email: `${clientId}@example.invalid`,
    phone: "5511999990000",
    plan: "Synthetic",
    maxUsers,
    status: "active",
    statusType: "test",
    accessReleased: 1,
    apiToken: `synthetic-${clientId}`,
    modulesJson: "[]",
    integrationsJson: "{}",
  });
}

async function insertUser(clientId: string, userId: string, email: string, passwordHash = "synthetic-hash-initial") {
  await getDb().insert(megadeskDomainClientUsers).values({
    userId,
    clientId,
    name: "Synthetic Existing User",
    email,
    role: "agent",
    status: "active",
    permissionsJson: "[\"tickets\"]",
    passwordHash,
  });
}

async function userRow(clientId: string, userId: string) {
  return (await getDb().select().from(megadeskDomainClientUsers)
    .where(and(eq(megadeskDomainClientUsers.clientId, clientId), eq(megadeskDomainClientUsers.userId, userId))).limit(1))[0];
}

async function usersFor(clientId: string) {
  return getDb().select().from(megadeskDomainClientUsers).where(eq(megadeskDomainClientUsers.clientId, clientId));
}

async function auditsFor(clientId: string) {
  return getDb().select().from(megadeskDomainAuditLogs).where(eq(megadeskDomainAuditLogs.clientId, clientId));
}

async function metricsFor(clientId: string) {
  return getDb().select().from(megadeskDomainMetrics).where(eq(megadeskDomainMetrics.clientId, clientId));
}

async function loadCache() {
  const state: MegaDeskStructuredState = { clients: [], conversations: [], tickets: [], botScripts: [], operationalRecords: [], auditLogs: [] };
  await loadMegaDeskStructuredState(state);
}

beforeEach(async () => {
  clientA = `user-writer-a-${randomUUID()}`;
  clientB = `user-writer-b-${randomUUID()}`;
  await insertClient(clientA, 2);
  await insertClient(clientB, 2);
});

afterEach(async () => {
  const clientIds = [clientA, clientB].filter(Boolean);
  if (!clientIds.length) return;
  await getDb().delete(megadeskDomainAuditLogs).where(inArray(megadeskDomainAuditLogs.clientId, clientIds));
  await getDb().delete(megadeskDomainMetrics).where(inArray(megadeskDomainMetrics.clientId, clientIds));
  await getDb().delete(megadeskDomainClientUsers).where(inArray(megadeskDomainClientUsers.clientId, clientIds));
  await getDb().delete(megadeskDomainClients).where(inArray(megadeskDomainClients.clientId, clientIds));
});

integration("MegaAdmin user writers [MySQL integration]", () => {
  it("returns sanitized add/update/reset responses through the real router", async () => {
    const userId = `user-${randomUUID()}`;
    await insertUser(clientA, userId, `${userId}@example.invalid`);
    const summary = await adminCaller.megaadmin.summary();
    const initialUser = summary.clients.find((client) => client.clientId === clientA)?.users.find((user) => user.id === userId);
    expect(initialUser).not.toHaveProperty("passwordHash");

    const added = await adminCaller.megaadmin.addClientUser({
      clientId: clientA, name: "Synthetic Added User", email: `added-${randomUUID()}@example.invalid`, role: "agent",
    });
    expect(added.user).not.toHaveProperty("passwordHash");
    const updated = await adminCaller.megaadmin.updateClientUser({ clientId: clientA, userId: added.user.id, status: "blocked" });
    expect(updated.user).not.toHaveProperty("passwordHash");
    const reset = await adminCaller.megaadmin.resetUserPassword({ clientId: clientA, userId: added.user.id, newPassword: "synthetic-password" });
    expect(reset).not.toHaveProperty("passwordHash");
  });

  it("preserves a reset hash when a stale non-password update follows", async () => {
    const userId = `user-${randomUUID()}`;
    await insertUser(clientA, userId, `${userId}@example.invalid`, "synthetic-hash-h1");
    await persistMegaDeskClientUser(passwordResetInput(clientA, userId, "synthetic-hash-h2"));
    await persistMegaDeskClientUser(updateInput(clientA, userId, { role: "manager" }));
    expect((await userRow(clientA, userId))?.passwordHash).toBe("synthetic-hash-h2");
  });

  it("serializes concurrent password resets without restoring the prior hash", async () => {
    const userId = `user-${randomUUID()}`;
    await insertUser(clientA, userId, `${userId}@example.invalid`, "synthetic-hash-h1");
    await Promise.all([
      persistMegaDeskClientUser(passwordResetInput(clientA, userId, "synthetic-hash-h2")),
      persistMegaDeskClientUser(passwordResetInput(clientA, userId, "synthetic-hash-h3")),
    ]);
    expect(["synthetic-hash-h2", "synthetic-hash-h3"]).toContain((await userRow(clientA, userId))?.passwordHash);
  });

  it("does not change another tenant user when its userId is supplied with client A", async () => {
    const userId = `user-${randomUUID()}`;
    await insertUser(clientB, userId, `${userId}@example.invalid`, "synthetic-hash-b");
    await expect(persistMegaDeskClientUser(updateInput(clientA, userId, { role: "manager" }))).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    expect((await userRow(clientB, userId))?.role).toBe("agent");
    expect(await auditsFor(clientA)).toHaveLength(0);
  });

  it("rejects cross-tenant audit binding before any mutation", async () => {
    const userId = `user-${randomUUID()}`;
    await insertUser(clientA, userId, `${userId}@example.invalid`);
    const input = updateInput(clientA, userId, { role: "manager" });
    input.audit.clientId = clientB;
    await expect(persistMegaDeskClientUser(input)).rejects.toMatchObject({ code: "AUDIT_CLIENT_MISMATCH" });
    expect((await userRow(clientA, userId))?.role).toBe("agent");
    expect(await auditsFor(clientB)).toHaveLength(0);
  });

  it("rolls back the user write when an audit ID collides in another tenant", async () => {
    const userId = `user-${randomUUID()}`;
    const collisionId = `audit-${randomUUID()}`;
    await insertUser(clientA, userId, `${userId}@example.invalid`, "synthetic-hash-h1");
    await getDb().insert(megadeskDomainAuditLogs).values({
      auditId: collisionId, platform: "MegaAdmin", action: "existing synthetic audit", clientId: clientB, success: 1,
    });
    await expect(persistMegaDeskClientUser(passwordResetInput(clientA, userId, "synthetic-hash-h2", collisionId))).rejects.toThrow();
    expect((await userRow(clientA, userId))?.passwordHash).toBe("synthetic-hash-h1");
    expect((await auditsFor(clientB)).find((entry) => entry.auditId === collisionId)?.clientId).toBe(clientB);
    expect(await auditsFor(clientA)).toHaveLength(0);
  });

  it("keeps cache unchanged on rollback and updates it only after a committed write", async () => {
    const userId = `user-${randomUUID()}`;
    const collisionId = `audit-${randomUUID()}`;
    await insertUser(clientA, userId, `${userId}@example.invalid`, "synthetic-hash-h1");
    await getDb().insert(megadeskDomainAuditLogs).values({
      auditId: collisionId, platform: "MegaAdmin", action: "existing synthetic audit", clientId: clientB, success: 1,
    });
    await loadCache();
    await expect(persistMegaDeskClientUser(updateInput(clientA, userId, { status: "blocked" }, collisionId))).rejects.toThrow();
    const cachedAfterRollback = inMemoryState?.clients.find((client) => client.clientId === clientA)?.users.find((user: { id: string }) => user.id === userId);
    expect(cachedAfterRollback?.status).toBe("active");

    await persistMegaDeskClientUser(updateInput(clientA, userId, { status: "blocked" }));
    const cachedAfterCommit = inMemoryState?.clients.find((client) => client.clientId === clientA)?.users.find((user: { id: string }) => user.id === userId);
    expect(cachedAfterCommit?.status).toBe("blocked");
  });

  it("does not invoke the global state writer for a single user mutation", async () => {
    const userId = `user-${randomUUID()}`;
    await insertUser(clientA, userId, `${userId}@example.invalid`);
    await persistMegaDeskClientUser(updateInput(clientA, userId, { status: "blocked" }));
    expect((await userRow(clientA, userId))?.status).toBe("blocked");
    expect(await auditsFor(clientA)).toHaveLength(1);
    expect(await metricsFor(clientA)).toHaveLength(0);
    expect(await metricsFor(clientB)).toHaveLength(0);
  });

  it("rolls back duplicate emails and admits at most one concurrent add into the final slot", async () => {
    const firstUser = `user-${randomUUID()}`;
    const duplicateUser = `user-${randomUUID()}`;
    const duplicateEmail = `duplicate-${randomUUID()}@example.invalid`;
    await persistMegaDeskClientUser(createInput(clientA, firstUser, duplicateEmail));
    await expect(persistMegaDeskClientUser(createInput(clientA, duplicateUser, duplicateEmail))).rejects.toThrow();
    expect(await usersFor(clientA)).toHaveLength(1);
    expect(await auditsFor(clientA)).toHaveLength(1);

    const oneExisting = (await usersFor(clientA))[0];
    const second = persistMegaDeskClientUser(createInput(clientA, `user-${randomUUID()}`, `one-${randomUUID()}@example.invalid`));
    const third = persistMegaDeskClientUser(createInput(clientA, `user-${randomUUID()}`, `two-${randomUUID()}@example.invalid`));
    const outcomes = await Promise.allSettled([second, third]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect((await usersFor(clientA)).map((user) => user.userId)).toContain(oneExisting.userId);
    expect(await usersFor(clientA)).toHaveLength(2);
  });
});
