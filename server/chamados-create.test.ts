/**
 * 5 Testes de abertura de chamados
 * Garante que:
 * 1. Chamado criado com sucesso quando tenantId é válido
 * 2. Chamado falha sem tenantId (isolamento multiempresa)
 * 3. Campos obrigatórios são validados (título vazio)
 * 4. ClientId correto é passado ao banco de dados
 * 5. Dois tenants diferentes não interferem entre si
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { chamadosRouter } from "./routers-chamados";
import { createCallerFactory } from "./_core/trpc";

// Mock do db-chamados para isolar os testes (sem DATABASE_URL)
vi.mock("./db-chamados", () => ({
  createChamado: vi.fn(async (clientId, customerId, customerName, company, title, observations, priority, assignedTo, _phone, _email, _cnpj, assignedToUserId) => ({
    id: `chamado-${Date.now()}`,
    number: 42,
    clientId,
    customerId: customerId || `cust-${Date.now()}`,
    customerName,
    company,
    title,
    observations: observations || "",
    priority: priority || "media",
    status: "open",
    assignedTo,
    assignedToUserId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    activities: [],
  })),
  listChamados: vi.fn(async () => []),
  countChamados: vi.fn(async () => 0),
  getStatusCounts: vi.fn(async () => ({ open: 0, in_progress: 0, waiting: 0, closed: 0 })),
  getChamadoWithActivities: vi.fn(async () => null),
  updateChamado: vi.fn(async () => ({})),
  addActivityToChamado: vi.fn(async () => ({})),
  editActivity: vi.fn(async () => ({})),
  getCollaborators: vi.fn(async () => []),
  addCollaborator: vi.fn(async () => ({})),
  removeCollaborator: vi.fn(async () => ({})),
  updateCollaborators: vi.fn(async () => ({})),
  registerActivity: vi.fn(async () => ({})),
  getActiveClientUser: vi.fn(async () => ({ userId: "operator-1", userName: "Marcelo Moura" })),
}));

const createCaller = createCallerFactory(chamadosRouter);

const crmMocks = vi.hoisted(() => ({
  listCrmClients: vi.fn(),
  getCrmClientById: vi.fn(),
}));

vi.mock("./db-crm", () => crmMocks);

// Contexto com tenantId válido (usuário MegaDesk logado)
function makeCtxWithTenant(tenantId: string) {
  return {
    user: null as any,
    tenantId,
    operationalUserId: "operator-1",
    operationalUserRole: "agent",
    userEmail: "marcelo@example.invalid",
    req: {} as any,
    res: {} as any,
  };
}

// Contexto sem tenantId (usuário não autenticado no MegaDesk)
function makeCtxWithoutTenant() {
  return {
    user: null as any,
    tenantId: undefined as any,
    req: {} as any,
    res: {} as any,
  };
}

describe("chamados.create — abertura de chamados", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crmMocks.getCrmClientById.mockImplementation(async (customerId: string, tenantId: string) => {
      if (customerId === "crm-other-tenant") return null;
      return {
        crmClientId: customerId,
        clientId: tenantId,
        customerType: "company",
        companyName: "Empresa Teste",
        responsibleName: "João Silva",
        cpfCnpj: "12345678000190",
        phone: "11999999999",
        email: "cliente@example.invalid",
        lifecycleState: "active",
      };
    });
    crmMocks.listCrmClients.mockResolvedValue([]);
  });

  // TESTE 1: Chamado criado com sucesso quando tenantId está presente
  it("deve criar chamado com sucesso quando tenantId é válido", async () => {
    const caller = createCaller(makeCtxWithTenant("cliente-001"));

    const result = await caller.create({
      customerId: "crm-001",
      title: "Problema com login",
      observations: "Usuário não consegue acessar o sistema",
      priority: "media",
    });

    expect(result.chamado).toBeDefined();
    expect(result.chamado.number).toBe(42);
    expect(result.chamado.customerId).toBe("crm-001");
    expect(result.chamado.customerName).toBe("João Silva");
    expect(result.chamado.company).toBe("Empresa Teste");
    expect(result.chamado.status).toBe("open");
    expect(result.chamado.assignedTo).toBe("Marcelo Moura");
    expect(result.message).toContain("42");
  });

  // TESTE 2: Chamado falha sem tenantId (isolamento multiempresa)
  it("deve falhar com UNAUTHORIZED quando tenantId não está presente", async () => {
    const caller = createCaller(makeCtxWithoutTenant());

    await expect(
      caller.create({
        customerId: "crm-001",
        title: "Problema com login",
      })
    ).rejects.toThrow(/UNAUTHORIZED|inválida/i);
  });

  // TESTE 3: Campos obrigatórios são validados (título vazio)
  it("deve falhar quando título está vazio", async () => {
    const caller = createCaller(makeCtxWithTenant("cliente-001"));

    await expect(
      caller.create({
        customerId: "crm-001",
        title: "", // título vazio
      })
    ).rejects.toThrow();
  });

  // TESTE 4: Isolamento de tenant — clientId correto é passado ao banco
  it("deve passar o clientId correto ao banco de dados", async () => {
    const dbModule = await import("./db-chamados");
    const caller = createCaller(makeCtxWithTenant("cliente-empresa-xyz"));

    await caller.create({
      customerId: "crm-xyz",
      title: "Suporte técnico urgente",
      priority: "alta",
    });

    expect(dbModule.createChamado).toHaveBeenCalledWith(
      "cliente-empresa-xyz", // clientId correto
      expect.any(String),    // customerId
      "João Silva",
      "Empresa Teste",
      "Suporte técnico urgente",
      "",
      "alta",
      "Marcelo Moura",
      "11999999999",
      "cliente@example.invalid",
      "12345678000190",
      "operator-1"
    );
  });

  // TESTE 5: Dois tenants diferentes não interferem entre si
  it("deve isolar chamados entre tenants diferentes", async () => {
    const dbModule = await import("./db-chamados");

    const callerA = createCaller(makeCtxWithTenant("tenant-a"));
    const callerB = createCaller(makeCtxWithTenant("tenant-b"));

    await callerA.create({
      customerId: "crm-a",
      title: "Chamado do Tenant A",
    });

    await callerB.create({
      customerId: "crm-b",
      title: "Chamado do Tenant B",
    });

    const calls = (dbModule.createChamado as any).mock.calls;
    expect(calls[0][0]).toBe("tenant-a");
    expect(calls[1][0]).toBe("tenant-b");
    expect(calls[0][0]).not.toBe(calls[1][0]); // tenants diferentes
  });

  it("rejeita customerId que não pertence ao tenant autenticado", async () => {
    const caller = createCaller(makeCtxWithTenant("tenant-a"));

    await expect(caller.create({
      customerId: "crm-other-tenant",
      title: "Tentativa entre tenants",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const dbModule = await import("./db-chamados");
    expect(dbModule.createChamado).not.toHaveBeenCalled();
  });

  it.each([
    ["nome", "Maria"],
    ["CPF/CNPJ", "52998224725"],
    ["telefone", "11999999999"],
  ])("busca cliente por %s na fonte canônica do tenant", async (_field, query) => {
    crmMocks.listCrmClients.mockResolvedValue([{
      crmClientId: "crm-found",
      customerType: "person",
      companyName: "Maria Souza",
      responsibleName: "",
      cpfCnpj: "52998224725",
      phone: "11999999999",
    }]);

    const result = await createCaller(makeCtxWithTenant("tenant-search")).searchCustomers({ query });

    expect(crmMocks.listCrmClients).toHaveBeenCalledWith("tenant-search", query, "active");
    expect(result.customers[0]).toMatchObject({ id: "crm-found", type: "person", name: "Maria Souza" });
  });

  it("retorna vazio sem criar uma fonte paralela", async () => {
    const result = await createCaller(makeCtxWithTenant("tenant-search")).searchCustomers({ query: "inexistente" });
    expect(result.customers).toEqual([]);
  });

  it("normaliza documento formatado para encontrar o valor canônico armazenado", async () => {
    crmMocks.listCrmClients.mockResolvedValueOnce([]).mockResolvedValueOnce([{
      crmClientId: "crm-formatted",
      customerType: "person",
      companyName: "Pessoa Formatada",
      responsibleName: "",
      cpfCnpj: "52998224725",
      phone: null,
    }]);

    const result = await createCaller(makeCtxWithTenant("tenant-search")).searchCustomers({ query: "529.982.247-25" });
    expect(crmMocks.listCrmClients).toHaveBeenNthCalledWith(1, "tenant-search", "529.982.247-25", "active");
    expect(crmMocks.listCrmClients).toHaveBeenNthCalledWith(2, "tenant-search", "52998224725", "active");
    expect(result.customers[0].id).toBe("crm-formatted");
  });

  it("reflete criação e atualização do ERP consultando novamente a mesma fonte", async () => {
    crmMocks.listCrmClients
      .mockResolvedValueOnce([{ crmClientId: "crm-existing", customerType: "company", companyName: "Nome antigo", responsibleName: "", cpfCnpj: null, phone: null }])
      .mockResolvedValueOnce([
        { crmClientId: "crm-existing", customerType: "company", companyName: "Nome atualizado", responsibleName: "", cpfCnpj: null, phone: null },
        { crmClientId: "crm-new", customerType: "person", companyName: "Cliente recém-criado", responsibleName: "", cpfCnpj: null, phone: null },
      ]);
    const caller = createCaller(makeCtxWithTenant("tenant-live-source"));

    const before = await caller.searchCustomers({ query: "Nome" });
    const after = await caller.searchCustomers({ query: "Cliente" });

    expect(before.customers.map(customer => customer.name)).toEqual(["Nome antigo"]);
    expect(after.customers.map(customer => customer.name)).toEqual(["Nome atualizado", "Cliente recém-criado"]);
    expect(crmMocks.listCrmClients).toHaveBeenCalledTimes(2);
  });

  it("não mistura resultados de busca entre tenants", async () => {
    crmMocks.listCrmClients.mockImplementation(async (tenantId: string) => tenantId === "tenant-a"
      ? [{ crmClientId: "crm-a", customerType: "person", companyName: "Cliente A", responsibleName: "", cpfCnpj: null, phone: null }]
      : [{ crmClientId: "crm-b", customerType: "company", companyName: "Cliente B", responsibleName: "", cpfCnpj: null, phone: null }]);

    const tenantA = await createCaller(makeCtxWithTenant("tenant-a")).searchCustomers({ query: "Cliente" });
    const tenantB = await createCaller(makeCtxWithTenant("tenant-b")).searchCustomers({ query: "Cliente" });

    expect(tenantA.customers.map(customer => customer.id)).toEqual(["crm-a"]);
    expect(tenantB.customers.map(customer => customer.id)).toEqual(["crm-b"]);
  });

  it("aceita PF e PJ e deriva os snapshots sem confiar no navegador", async () => {
    const caller = createCaller(makeCtxWithTenant("tenant-types"));
    crmMocks.getCrmClientById
      .mockResolvedValueOnce({ crmClientId: "pf-1", customerType: "person", companyName: "Ana Pessoa", responsibleName: "", phone: null, email: null, cpfCnpj: "52998224725", lifecycleState: "active" })
      .mockResolvedValueOnce({ crmClientId: "pj-1", customerType: "company", companyName: "ACME Ltda", responsibleName: "Bruno", phone: null, email: null, cpfCnpj: "12345678000190", lifecycleState: "active" });

    await caller.create({ customerId: "pf-1", title: "Chamado da pessoa" });
    await caller.create({ customerId: "pj-1", title: "Chamado da empresa" });

    const dbModule = await import("./db-chamados");
    expect(dbModule.createChamado).toHaveBeenNthCalledWith(1, "tenant-types", "pf-1", "Ana Pessoa", "Ana Pessoa", expect.anything(), "", "media", "Marcelo Moura", undefined, undefined, "52998224725", "operator-1");
    expect(dbModule.createChamado).toHaveBeenNthCalledWith(2, "tenant-types", "pj-1", "Bruno", "ACME Ltda", expect.anything(), "", "media", "Marcelo Moura", undefined, undefined, "12345678000190", "operator-1");
  });
});
