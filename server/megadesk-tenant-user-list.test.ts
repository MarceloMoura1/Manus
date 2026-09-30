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
  conversations: [
    { id: "shared-customer-id", clientId: "tenant-a", name: "Tenant A customer", company: "A", messages: [] },
    { id: "shared-customer-id", clientId: "tenant-b", name: "Tenant B customer", company: "B", messages: [] },
  ],
  tickets: [],
  botScripts: [],
  operationalRecords: [],
  auditLogs: [],
};

const dbMocks = vi.hoisted(() => ({ loadMegaDeskStructuredState: vi.fn(), updateCustomer: vi.fn(), saveMegaDeskStructuredState: vi.fn() }));
vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, loadMegaDeskStructuredState: dbMocks.loadMegaDeskStructuredState,
    updateCustomer: dbMocks.updateCustomer, saveMegaDeskStructuredState: dbMocks.saveMegaDeskStructuredState };
});

import { appRouter, findTenantConversationSnapshot } from "./routers";

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
    dbMocks.updateCustomer.mockResolvedValue(undefined);
    dbMocks.saveMegaDeskStructuredState.mockResolvedValue(undefined);
  });

  it("returns only the authenticated tenant active users when clientId is omitted", async () => {
    const tenantAUsers = await callerFor("tenant-a", "admin-a@example.invalid").megadesk.getClientUsers({});
    const tenantBUsers = await callerFor("tenant-b", "admin-b@example.invalid").megadesk.getClientUsers({});

    expect(tenantAUsers.map(user => user.userId)).toEqual(["user-a-admin"]);
    expect(tenantBUsers.map(user => user.userId)).toEqual(["user-b-admin", "user-b-agent"]);
    expect(tenantAUsers.map(user => user.userId)).not.toContain("user-b-admin");
  });

  it("selects and mutates only the authenticated tenant snapshot when conversation IDs collide", () => {
    const snapshots = [
      { id: "shared-conversation-id", clientId: "tenant-a", name: "Tenant A customer", company: "A" },
      { id: "shared-conversation-id", clientId: "tenant-b", name: "Tenant B customer", company: "B" },
    ];

    const selected = findTenantConversationSnapshot(snapshots, "tenant-a", "shared-conversation-id");
    expect(selected).toBe(snapshots[0]);
    expect(selected).not.toBe(snapshots[1]);
    selected!.name = "Updated only for A";

    expect(snapshots[0].name).toBe("Updated only for A");
    expect(snapshots[1]).toEqual(expect.objectContaining({
      clientId: "tenant-b",
      name: "Tenant B customer",
      company: "B",
    }));
  });

  it("binds updateCustomerInfo to the caller tenant when customer IDs collide", async () => {
    const tenantB = state.conversations.find(item => item.clientId === "tenant-b" && item.id === "shared-customer-id")!;
    await expect(callerFor("tenant-a", "admin-a@example.invalid").megadesk.updateCustomerInfo({
      clientId: "tenant-a", customerId: "shared-customer-id", name: "Updated tenant A",
    })).resolves.toMatchObject({ ok: true, customerId: "shared-customer-id" });

    expect(dbMocks.updateCustomer).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "tenant-a", customerId: "shared-customer-id", name: "Updated tenant A",
    }));
    expect(tenantB).toMatchObject({ clientId: "tenant-b", name: "Tenant B customer", company: "B" });
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

  it("does not expose the legacy users.list endpoint without an operational session", async () => {
    const anonymous = appRouter.createCaller({
      req: { headers: {} } as any,
      res: {} as any,
      user: null,
    });

    await expect(anonymous.users.list({ clientId: "tenant-a" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("binds the legacy users.list endpoint to the authenticated tenant", async () => {
    const tenantA = callerFor("tenant-a", "admin-a@example.invalid");
    await expect(tenantA.users.list({ clientId: "tenant-b" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const ownUsers = await tenantA.users.list({ clientId: "tenant-a" });
    expect(ownUsers.map(user => user.id)).toEqual(["user-a-admin", "user-a-blocked"]);
    expect(ownUsers.map(user => user.id)).not.toContain("user-b-admin");
  });

  it("rejects same-tenant assistant history access for a different user identity", async () => {
    const tenantA = callerFor("tenant-a", "admin-a@example.invalid");

    await expect(tenantA.assistant.getHistory({ clientId: "tenant-a", userId: "agent-a@example.invalid" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(tenantA.assistant.clearHistory({ clientId: "tenant-a", userId: "agent-a@example.invalid" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(tenantA.assistant.clientChat({ clientId: "tenant-a", userId: "agent-a@example.invalid", message: "private" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not expose the paid assistant provider to anonymous or cross-platform callers", async () => {
    const anonymous = appRouter.createCaller({
      req: { headers: {} } as any,
      res: {} as any,
      user: null,
    });
    await expect(anonymous.assistant.chat({
      messages: [{ role: "user", content: "hello" }],
      platform: "megadesk",
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    await expect(callerFor("tenant-a", "admin-a@example.invalid").assistant.chat({
      messages: [{ role: "user", content: "hello" }],
      platform: "megaadmin",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
