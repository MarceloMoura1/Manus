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
  createChamado: vi.fn(async (clientId, customerId, customerName, company, title, observations, priority) => ({
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
    assignedTo: null,
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
}));

const createCaller = createCallerFactory(chamadosRouter);

// Contexto com tenantId válido (usuário MegaDesk logado)
function makeCtxWithTenant(tenantId: string) {
  return {
    user: null as any,
    tenantId,
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
  });

  // TESTE 1: Chamado criado com sucesso quando tenantId está presente
  it("deve criar chamado com sucesso quando tenantId é válido", async () => {
    const caller = createCaller(makeCtxWithTenant("cliente-001"));

    const result = await caller.create({
      customerName: "João Silva",
      company: "Empresa Teste",
      title: "Problema com login",
      observations: "Usuário não consegue acessar o sistema",
      priority: "media",
    });

    expect(result.chamado).toBeDefined();
    expect(result.chamado.number).toBe(42);
    expect(result.chamado.customerName).toBe("João Silva");
    expect(result.chamado.company).toBe("Empresa Teste");
    expect(result.chamado.status).toBe("open");
    expect(result.message).toContain("42");
  });

  // TESTE 2: Chamado falha sem tenantId (isolamento multiempresa)
  it("deve falhar com UNAUTHORIZED quando tenantId não está presente", async () => {
    const caller = createCaller(makeCtxWithoutTenant());

    await expect(
      caller.create({
        customerName: "João Silva",
        company: "Empresa Teste",
        title: "Problema com login",
      })
    ).rejects.toThrow(/UNAUTHORIZED|inválida/i);
  });

  // TESTE 3: Campos obrigatórios são validados (título vazio)
  it("deve falhar quando título está vazio", async () => {
    const caller = createCaller(makeCtxWithTenant("cliente-001"));

    await expect(
      caller.create({
        customerName: "João Silva",
        company: "Empresa Teste",
        title: "", // título vazio
      })
    ).rejects.toThrow();
  });

  // TESTE 4: Isolamento de tenant — clientId correto é passado ao banco
  it("deve passar o clientId correto ao banco de dados", async () => {
    const dbModule = await import("./db-chamados");
    const caller = createCaller(makeCtxWithTenant("cliente-empresa-xyz"));

    await caller.create({
      customerName: "Maria Santos",
      company: "Empresa XYZ",
      title: "Suporte técnico urgente",
      priority: "alta",
    });

    expect(dbModule.createChamado).toHaveBeenCalledWith(
      "cliente-empresa-xyz", // clientId correto
      expect.any(String),    // customerId
      "Maria Santos",
      "Empresa XYZ",
      "Suporte técnico urgente",
      "",
      "alta",
      undefined
    );
  });

  // TESTE 5: Dois tenants diferentes não interferem entre si
  it("deve isolar chamados entre tenants diferentes", async () => {
    const dbModule = await import("./db-chamados");

    const callerA = createCaller(makeCtxWithTenant("tenant-a"));
    const callerB = createCaller(makeCtxWithTenant("tenant-b"));

    await callerA.create({
      customerName: "Cliente A",
      company: "Empresa A",
      title: "Chamado do Tenant A",
    });

    await callerB.create({
      customerName: "Cliente B",
      company: "Empresa B",
      title: "Chamado do Tenant B",
    });

    const calls = (dbModule.createChamado as any).mock.calls;
    expect(calls[0][0]).toBe("tenant-a");
    expect(calls[1][0]).toBe("tenant-b");
    expect(calls[0][0]).not.toBe(calls[1][0]); // tenants diferentes
  });
});
