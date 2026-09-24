import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  clients: [
    {
      id: "internal-a",
      clientId: "tenant-a",
      tenantDatabaseName: "tenant_a",
      company: "Tenant A",
      contact: "Admin A",
      email: "admin-a@example.invalid",
      phone: "5511000000001",
      cnpj: "",
      plan: "Test",
      maxUsers: 5,
      statusType: "test",
      status: "active",
      accessReleased: true,
      apiToken: "token-a",
      modules: ["Chamados"],
      integrations: {},
      users: [
        { id: "user-a-admin", name: "Admin A", email: "admin-a@example.invalid", role: "admin", status: "active" },
        { id: "user-a-blocked", name: "Blocked A", email: "blocked-a@example.invalid", role: "viewer", status: "blocked" },
      ],
    },
    {
      id: "internal-b",
      clientId: "tenant-b",
      tenantDatabaseName: "tenant_b",
      company: "Tenant B",
      contact: "Admin B",
      email: "admin-b@example.invalid",
      phone: "5511000000002",
      cnpj: "",
      plan: "Test",
      maxUsers: 5,
      statusType: "test",
      status: "active",
      accessReleased: true,
      apiToken: "token-b",
      modules: ["Chamados"],
      integrations: {},
      users: [
        { id: "user-b-admin", name: "Admin B", email: "admin-b@example.invalid", role: "admin", status: "active" },
        { id: "user-b-agent", name: "Agent B", email: "agent-b@example.invalid", role: "agent", status: "active" },
      ],
    },
  ],
  conversations: [],
  tickets: [],
  botScripts: [],
  operationalRecords: [],
  auditLogs: [],
};

const dbMocks = vi.hoisted(() => ({ loadMegaDeskStructuredState: vi.fn() }));
vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, loadMegaDeskStructuredState: dbMocks.loadMegaDeskStructuredState };
});

import { appRouter } from "./routers";

function callerFor(tenantId: "tenant-a" | "tenant-b", userEmail: string) {
  return appRouter.createCaller({
    req: { headers: {} } as any,
    res: {} as any,
    user: null,
    tenantId,
    userEmail,
    operationalUserId: `session-${tenantId}`,
    operationalUserRole: "admin",
  });
}

describe("MegaDesk tenant-bound user lists", () => {
  beforeEach(() => {
    dbMocks.loadMegaDeskStructuredState.mockResolvedValue(state);
  });

  it("returns only the authenticated tenant active users when clientId is omitted", async () => {
    const tenantAUsers = await callerFor("tenant-a", "admin-a@example.invalid").megadesk.getClientUsers({});
    const tenantBUsers = await callerFor("tenant-b", "admin-b@example.invalid").megadesk.getClientUsers({});

    expect(tenantAUsers.map(user => user.userId)).toEqual(["user-a-admin"]);
    expect(tenantBUsers.map(user => user.userId)).toEqual(["user-b-admin", "user-b-agent"]);
    expect(tenantAUsers.map(user => user.userId)).not.toContain("user-b-admin");
  });

  it("rejects a supplied clientId for a different tenant instead of falling back or disclosing users", async () => {
    const tenantA = callerFor("tenant-a", "admin-a@example.invalid");

    await expect(tenantA.megadesk.getClientUsers({ clientId: "tenant-b" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(tenantA.megadesk.getClientUsers({ clientId: "not-a-tenant" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows the legacy matching clientId without changing the session tenant selection", async () => {
    const users = await callerFor("tenant-a", "admin-a@example.invalid").megadesk.getClientUsers({ clientId: "tenant-a" });

    expect(users.map(user => user.userId)).toEqual(["user-a-admin"]);
  });
});
