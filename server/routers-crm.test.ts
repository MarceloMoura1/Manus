import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCrmClients: vi.fn(),
  getCrmClientById: vi.fn(),
  createCrmClient: vi.fn(),
  updateCrmClient: vi.fn(),
  findDuplicateCrmClient: vi.fn(),
  addCrmTimeline: vi.fn(),
  listCrmTimeline: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("./db-crm", () => ({
  listCrmClients: mocks.listCrmClients,
  getCrmClientById: mocks.getCrmClientById,
  createCrmClient: mocks.createCrmClient,
  updateCrmClient: mocks.updateCrmClient,
  findDuplicateCrmClient: mocks.findDuplicateCrmClient,
  addCrmTimeline: mocks.addCrmTimeline,
  listCrmTimeline: mocks.listCrmTimeline,
}));
vi.mock("./db", () => ({ getPool: () => ({ execute: mocks.execute }) }));

import { crmRouter } from "./routers-crm";

function context(role: "admin" | "manager" | "agent" | "viewer", permissions: string[] = ["clients"]) {
  return {
    tenantId: "tenant-session",
    operationalUserId: `user-${role}`,
    operationalUserRole: role,
    operationalPermissions: permissions,
    userEmail: `${role}@example.invalid`,
    req: { headers: {} },
  } as any;
}

describe("CRM tenant and authorization contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    mocks.listCrmClients.mockResolvedValue([{
      crmClientId: "crm-public",
      clientId: "tenant-session",
      companyName: "Cliente seguro",
    }]);
  });

  it.each(["admin", "manager"] as const)("allows %s and derives the tenant from the session", async (role) => {
    const result = await crmRouter.createCaller(context(role)).list({});
    expect(mocks.listCrmClients).toHaveBeenCalledWith("tenant-session", undefined, "active");
    expect(result.clients).toEqual([{ crmClientId: "crm-public", companyName: "Cliente seguro" }]);
    expect(JSON.stringify(result)).not.toContain("tenant-session");
  });

  it.each(["admin", "manager"] as const)("allows legacy %s ERP access without a separate clients permission", async (role) => {
    const result = await crmRouter.createCaller(context(role, ["erp"])).list({});
    expect(result.clients).toHaveLength(1);
    expect(mocks.listCrmClients).toHaveBeenCalledWith("tenant-session", undefined, "active");
  });

  it.each(["agent", "viewer"] as const)("refuses %s access", async (role) => {
    await expect(crmRouter.createCaller(context(role)).list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.listCrmClients).not.toHaveBeenCalled();
  });

  it("does not let a persisted permission enlarge the role matrix", async () => {
    await expect(crmRouter.createCaller(context("agent", ["clients"])).list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(crmRouter.createCaller(context("agent", ["erp"])).list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a public tenant field instead of silently accepting it", async () => {
    await expect(crmRouter.createCaller(context("admin")).list({ clientId: "other-tenant" } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("exposes only the guarded permanent delete procedure", () => {
    expect((crmRouter as any)._def.procedures.delete).toBeUndefined();
    expect((crmRouter as any)._def.procedures.deletePermanently).toBeDefined();
  });

  it("resolves duplicates inside the session tenant without exposing identity fields", async () => {
    mocks.findDuplicateCrmClient.mockResolvedValue({ crmClientId: "crm-existing", companyName: "Existente", cpfCnpj: "52998224725", phone: null });
    const result = await crmRouter.createCaller(context("admin")).findDuplicate({ cpfCnpj: "529.982.247-25", phone: "" });
    expect(mocks.findDuplicateCrmClient).toHaveBeenCalledWith("tenant-session", { cpfCnpj: "529.982.247-25", phone: "" });
    expect(result).toEqual({ crmClientId: "crm-existing", companyName: "Existente", matchedField: "cpfCnpj" });
    expect(JSON.stringify(result)).not.toContain("52998224725");
  });
});
