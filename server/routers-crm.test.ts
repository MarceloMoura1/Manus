import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCrmClients: vi.fn(),
  getCrmClientById: vi.fn(),
  createCrmClient: vi.fn(),
  updateCrmClient: vi.fn(),
  findDuplicateCrmClient: vi.fn(),
  addCrmTimeline: vi.fn(),
  listCrmTimeline: vi.fn(),
  listCrmLifecycleTimeline: vi.fn(),
  permanentlyDeleteCrmClient: vi.fn(),
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
  listCrmLifecycleTimeline: mocks.listCrmLifecycleTimeline,
}));
vi.mock("./db", () => ({ getPool: () => ({ execute: mocks.execute }) }));
vi.mock("./crm-client-lifecycle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./crm-client-lifecycle")>()),
  permanentlyDeleteCrmClient: mocks.permanentlyDeleteCrmClient,
}));

import { crmRouter } from "./routers-crm";

function context(role: "admin" | "manager" | "agent" | "viewer", permissions: string[] = ["clients"]) {
  return {
    tenantId: "tenant-session",
    operationalUserId: `user-${role}`,
    operationalUserRole: role,
    operationalPermissions: permissions,
    userEmail: `${role}@example.invalid`,
    userName: role === "admin" ? "Marcelo Moura" : `${role} User`,
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

  it("allows only administrators to request permanent deletion", async () => {
    await expect(
      crmRouter.createCaller(context("manager")).deletePermanently({ crmClientId: "crm-public", expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Somente administradores podem excluir clientes definitivamente." });
  });

  it("calls the existing permanent-delete mutation with the session tenant for an administrator", async () => {
    mocks.permanentlyDeleteCrmClient.mockResolvedValue({ success: true });
    await expect(
      crmRouter.createCaller(context("admin")).deletePermanently({ crmClientId: "crm-public", expectedVersion: 2 }),
    ).resolves.toEqual({ success: true });
    expect(mocks.permanentlyDeleteCrmClient).toHaveBeenCalledWith({
      tenantId: "tenant-session",
      crmClientId: "crm-public",
      expectedVersion: 2,
      operatorUserId: "user-admin",
      operatorRole: "admin",
    });
  });

  it("merges tenant-scoped lifecycle evidence into the CRM timeline in chronological order", async () => {
    mocks.getCrmClientById.mockResolvedValue({ crmClientId: "crm-public" });
    mocks.listCrmTimeline.mockResolvedValue([{
      id: "manual-note",
      type: "note",
      description: "Nota manual",
      author: "admin@example.invalid",
      createdAt: "2026-09-25T09:00:00.000Z",
    }]);
    mocks.listCrmLifecycleTimeline.mockResolvedValue([{
      id: "audit-archive",
      type: "lifecycle_archive",
      description: "Estado operacional alterado de ativo para arquivado.",
      author: "operator-admin",
      createdAt: "2026-09-25T10:00:00.000Z",
    }]);

    const result = await crmRouter.createCaller(context("admin")).getTimeline({ crmClientId: "crm-public" });

    expect(mocks.listCrmTimeline).toHaveBeenCalledWith("crm-public", "tenant-session");
    expect(mocks.listCrmLifecycleTimeline).toHaveBeenCalledWith("crm-public", "tenant-session");
    expect(result.entries.map(entry => entry.id)).toEqual(["audit-archive", "manual-note"]);
  });

  it("records a persisted status event for future CRM timeline reads", async () => {
    mocks.getCrmClientById.mockResolvedValue({
      crmClientId: "crm-public",
      customerType: "company",
      companyName: "Cliente seguro",
      responsibleName: "",
      cpfCnpj: "",
      phone: "",
      whatsapp: "",
      email: "",
      address: "",
      city: "",
      state: "",
      cep: "",
      status: "lead",
      origin: "outro",
      internalResponsible: "",
      tags: "",
      observations: "",
    });
    mocks.updateCrmClient.mockResolvedValue(undefined);
    mocks.addCrmTimeline.mockResolvedValue(undefined);

    await expect(
      crmRouter.createCaller(context("admin")).update({ crmClientId: "crm-public", data: { status: "ativo" } }),
    ).resolves.toEqual({ success: true });

    expect(mocks.updateCrmClient).toHaveBeenCalledWith("crm-public", "tenant-session", { status: "ativo" });
    expect(mocks.addCrmTimeline).toHaveBeenCalledWith("crm-public", "tenant-session", expect.objectContaining({
      type: "status_change",
      description: "Status comercial alterado de lead para ativo por Marcelo Moura.",
      author: "Marcelo Moura",
    }));
  });

  it("uses the human session name for manual notes and safely falls back to email", async () => {
    mocks.getCrmClientById.mockResolvedValue({ crmClientId: "crm-public", lifecycleState: "active" });
    mocks.addCrmTimeline.mockResolvedValue(undefined);

    await crmRouter.createCaller(context("admin")).addTimelineEntry({ crmClientId: "crm-public", description: "Nome humano", type: "note" });
    expect(mocks.addCrmTimeline).toHaveBeenLastCalledWith("crm-public", "tenant-session", expect.objectContaining({ author: "Marcelo Moura" }));

    const fallbackContext = context("admin");
    fallbackContext.userName = "";
    await crmRouter.createCaller(fallbackContext).addTimelineEntry({ crmClientId: "crm-public", description: "Fallback", type: "note" });
    expect(mocks.addCrmTimeline).toHaveBeenLastCalledWith("crm-public", "tenant-session", expect.objectContaining({ author: "admin@example.invalid" }));
  });

  it("resolves duplicates inside the session tenant without exposing identity fields", async () => {
    mocks.findDuplicateCrmClient.mockResolvedValue({ crmClientId: "crm-existing", companyName: "Existente", cpfCnpj: "52998224725", phone: null });
    const result = await crmRouter.createCaller(context("admin")).findDuplicate({ cpfCnpj: "529.982.247-25", phone: "" });
    expect(mocks.findDuplicateCrmClient).toHaveBeenCalledWith("tenant-session", { cpfCnpj: "529.982.247-25", phone: "" });
    expect(result).toEqual({ crmClientId: "crm-existing", companyName: "Existente", matchedField: "cpfCnpj" });
    expect(JSON.stringify(result)).not.toContain("52998224725");
  });
});
