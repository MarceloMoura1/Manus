import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { appRouter, sanitizeClient } from "./routers";
import { applyMegaDeskClientUserMutationToState, inMemoryState, saveMegaDeskStructuredState, type MegaDeskStructuredState } from "./db";

const fixtureClient = {
  id: "fixture-internal-client-a",
  clientId: "fixture-client-a",
  tenantDatabaseName: "megadesk_test_fixture_a",
  company: "Fixture A",
  contact: "Fixture Operator",
  email: "operator-a@example.invalid",
  phone: "5511999990001",
  cnpj: "",
  plan: "Fixture",
  maxUsers: 5,
  statusType: "test" as const,
  status: "active" as const,
  accessReleased: true,
  apiToken: "synthetic-fixture-token",
  modules: ["tickets"],
  integrations: {},
  users: [{
    id: "fixture-user-a",
    name: "Fixture User A",
    email: "user-a@example.invalid",
    role: "admin" as const,
    status: "active" as const,
    permissions: ["tickets"],
    passwordHash: "fixture-only-private-field",
  }],
};

const fixtureClientB = {
  ...fixtureClient,
  id: "fixture-internal-client-b",
  clientId: "fixture-client-b",
  tenantDatabaseName: "megadesk_test_fixture_b",
  company: "Fixture B",
  email: "operator-b@example.invalid",
  users: [{
    ...fixtureClient.users[0],
    id: "fixture-user-b",
    email: "user-b@example.invalid",
  }],
};

const adminCaller = appRouter.createCaller({
  req: { headers: {}, cookies: {} } as any,
  res: { cookie: () => {}, clearCookie: () => {} } as any,
  user: { id: 1, email: "admin@example.invalid", name: "Fixture Admin", role: "admin" as const },
});

beforeAll(async () => {
  process.env.MEGADESK_STORAGE_MODE = "memory";
  const state: MegaDeskStructuredState = {
    clients: [fixtureClient, fixtureClientB],
    conversations: [],
    tickets: [],
    botScripts: [],
    operationalRecords: [],
    auditLogs: [],
  };
  await saveMegaDeskStructuredState(state);
});

describe("MegaAdmin user-response hardening", () => {
  it("does not expose the initial user's private hash from sanitized client responses", async () => {
    const client = sanitizeClient(fixtureClient);
    expect(client.users[0]).toMatchObject({
      id: "fixture-user-a",
      name: "Fixture User A",
      email: "user-a@example.invalid",
      role: "admin",
      status: "active",
    });
    expect(client.users[0]?.permissions).toContain("tickets");
    expect(client.users[0]).not.toHaveProperty("passwordHash");

    const summary = await adminCaller.megaadmin.summary();
    expect(summary.clients[0]?.users[0]).not.toHaveProperty("passwordHash");
  });

  it("keeps createClient on the canonical client sanitizer", () => {
    const routersSource = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    expect(routersSource).toContain("return { ok: true, client: sanitizeClient(client), integrationToken: client.apiToken, idempotentReplay: result.replay };");
  });

  it("returns functional, sanitized users from addClientUser and updateClientUser", async () => {
    const added = await adminCaller.megaadmin.addClientUser({
      clientId: fixtureClient.clientId,
      name: "Fixture Added User",
      email: "added@example.invalid",
      role: "agent",
    });
    expect(added.user).toMatchObject({
      name: "Fixture Added User",
      email: "added@example.invalid",
      role: "agent",
      status: "active",
    });
    expect(added.user.permissions).toContain("tickets");
    expect(added.user).not.toHaveProperty("passwordHash");

    const updated = await adminCaller.megaadmin.updateClientUser({
      clientId: fixtureClient.clientId,
      userId: added.user.id,
      role: "viewer",
      status: "blocked",
    });
    expect(updated.user).toMatchObject({
      id: added.user.id,
      name: "Fixture Added User",
      email: "added@example.invalid",
      role: "viewer",
      status: "blocked",
    });
    expect(updated.user.permissions).toContain("tickets");
    expect(updated.user).not.toHaveProperty("passwordHash");

    const userInfo = await adminCaller.megaadmin.updateUserInfo({
      clientId: fixtureClient.clientId,
      userId: added.user.id,
      name: "Fixture Renamed User",
      email: "renamed@example.invalid",
    });
    expect(userInfo.user).toMatchObject({
      id: added.user.id,
      name: "Fixture Renamed User",
      email: "renamed@example.invalid",
    });
    expect(userInfo.user).not.toHaveProperty("passwordHash");

    const permissions = await adminCaller.megaadmin.updateUserPermissions({
      clientId: fixtureClient.clientId,
      userId: added.user.id,
      permissions: ["tickets"],
    });
    expect(permissions.user.permissions).toContain("tickets");
    expect(permissions.user).not.toHaveProperty("passwordHash");
  });

  it("limits an in-memory user mutation and its audit record to the selected client", () => {
    const before = structuredClone(inMemoryState!);
    const after = applyMegaDeskClientUserMutationToState(before, {
      kind: "update",
      clientId: fixtureClient.clientId,
      userId: "fixture-user-a",
      changes: { name: "Updated Fixture User A" },
      audit: {
        id: "fixture-audit",
        platform: "MegaAdmin",
        action: "Fixture user updated",
        clientId: fixtureClient.clientId,
        success: true,
      },
    });
    const afterClientA = after.clients.find((client) => client.clientId === fixtureClient.clientId);
    const beforeClientB = before.clients.find((client) => client.clientId === fixtureClientB.clientId);
    const afterClientB = after.clients.find((client) => client.clientId === fixtureClientB.clientId);
    expect(afterClientA?.users.find((user: { id: string }) => user.id === "fixture-user-a")?.name).toBe("Updated Fixture User A");
    expect(afterClientA?.users.find((user: { id: string }) => user.id === "fixture-user-a")).toHaveProperty("passwordHash");
    expect(afterClientB).toEqual(beforeClientB);
    expect(after.auditLogs).toHaveLength(before.auditLogs.length + 1);
    expect(after.auditLogs[0]).toMatchObject({ clientId: fixtureClient.clientId, id: "fixture-audit" });
  });
});
