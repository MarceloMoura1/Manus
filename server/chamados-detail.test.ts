import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "./_core/trpc";

const ticketId = "11111111-1111-4111-8111-111111111111";

const dbMocks = vi.hoisted(() => ({
  getChamadoWithActivities: vi.fn(),
  updateChamado: vi.fn(),
}));

const crmMocks = vi.hoisted(() => ({
  getCrmClientById: vi.fn(),
}));

vi.mock("./db-chamados", () => ({
  createChamado: vi.fn(),
  getChamadoWithActivities: dbMocks.getChamadoWithActivities,
  listChamados: vi.fn(),
  countChamados: vi.fn(),
  getStatusCounts: vi.fn(),
  updateChamado: dbMocks.updateChamado,
  addActivityToChamado: vi.fn(),
  editActivity: vi.fn(),
  getCollaborators: vi.fn(),
  addCollaborator: vi.fn(),
  removeCollaborator: vi.fn(),
  updateCollaborators: vi.fn(),
  registerActivity: vi.fn(),
  addAttachment: vi.fn(),
  getAttachments: vi.fn(),
  getCustomerChamadoHistory: vi.fn(),
  getActiveClientUser: vi.fn(),
}));

vi.mock("./db-crm", () => ({
  getCrmClientById: crmMocks.getCrmClientById,
  listCrmClients: vi.fn(),
}));

import { chamadosRouter } from "./routers-chamados";

const createCaller = createCallerFactory(chamadosRouter);

function context(tenantId = "tenant-tickets") {
  return {
    user: null as any,
    tenantId,
    operationalUserId: "operator-1",
    operationalUserRole: "agent",
    operationalPermissions: ["chamados"],
    userEmail: "agent@example.invalid",
    req: {} as any,
    res: {} as any,
  };
}

function ticket(customerId: string | null = "crm-customer") {
  return {
    id: ticketId,
    number: 42,
    customerId,
    customerName: "Snapshot antigo",
    customerPhone: "1100000000",
    customerEmail: "snapshot@example.invalid",
    customerCNPJ: "00000000000",
    company: "Snapshot Empresa",
    title: "Falha de acesso",
    observations: "Mensagem inicial",
    status: "open",
    priority: "alta",
    assignedTo: "Agente Um",
    collaborators: [],
    createdAt: Date.now(),
    activities: [],
  };
}

describe("chamados.getDetail — cliente canônico", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getChamadoWithActivities.mockResolvedValue(ticket());
  });

  it.each([
    ["PF", "person", "Maria da Silva", "52998224725"],
    ["PJ", "company", "Empresa Exemplo Ltda", "12345678000190"],
  ])("resolve %s pelo customerId dentro do tenant da sessão", async (_label, customerType, companyName, cpfCnpj) => {
    crmMocks.getCrmClientById.mockResolvedValue({
      crmClientId: "crm-customer",
      customerType,
      companyName,
      responsibleName: customerType === "company" ? "Responsável" : "",
      cpfCnpj,
      phone: "11999999999",
      email: "cliente@example.invalid",
    });

    const result = await createCaller(context()).getDetail({ chamadoId: ticketId });

    expect(crmMocks.getCrmClientById).toHaveBeenCalledWith("crm-customer", "tenant-tickets");
    expect(result.chamado.customer).toEqual({
      id: "crm-customer",
      type: customerType,
      name: companyName,
      document: cpfCnpj,
      phone: "11999999999",
      email: "cliente@example.invalid",
      source: "erp",
    });
  });

  it("mantém ausências individuais sem apagar os demais dados canônicos", async () => {
    crmMocks.getCrmClientById.mockResolvedValue({
      crmClientId: "crm-customer",
      customerType: "person",
      companyName: "Cliente sem contato",
      responsibleName: "",
      cpfCnpj: "52998224725",
      phone: null,
      email: null,
    });

    const result = await createCaller(context()).getDetail({ chamadoId: ticketId });
    expect(result.chamado.customer).toMatchObject({
      name: "Cliente sem contato",
      document: "52998224725",
      phone: null,
      email: null,
      source: "erp",
    });
  });

  it("não retorna um cliente canônico de outro tenant para operador somente de Chamados", async () => {
    crmMocks.getCrmClientById.mockImplementation(async (_customerId: string, tenantId: string) => tenantId === "tenant-owner" ? {
      crmClientId: "crm-customer",
      customerType: "company",
      companyName: "Cliente secreto",
      cpfCnpj: "12345678000190",
      phone: "11911111111",
      email: "secret@example.invalid",
    } : null);

    const result = await createCaller(context("tenant-other")).getDetail({ chamadoId: ticketId });

    expect(crmMocks.getCrmClientById).toHaveBeenCalledWith("crm-customer", "tenant-other");
    expect(result.chamado.customer).not.toMatchObject({ name: "Cliente secreto", source: "erp" });
    expect(result.chamado.customer).toMatchObject({ name: "Snapshot antigo", source: "snapshot" });
  });

  it("preserva o snapshot seguro para chamado legado sem customerId", async () => {
    dbMocks.getChamadoWithActivities.mockResolvedValue(ticket(null));

    const result = await createCaller(context()).getDetail({ chamadoId: ticketId });

    expect(crmMocks.getCrmClientById).not.toHaveBeenCalled();
    expect(result.chamado.customer).toEqual({
      id: null,
      type: null,
      name: "Snapshot antigo",
      document: "00000000000",
      phone: "1100000000",
      email: "snapshot@example.invalid",
      source: "snapshot",
    });
  });

  it("não aceita tenant informado pelo frontend nem substitui uma sessão sem tenant", async () => {
    const missingTenant = { ...context(), tenantId: undefined as any };

    await expect(createCaller(missingTenant).getDetail({ chamadoId: ticketId }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(dbMocks.getChamadoWithActivities).not.toHaveBeenCalled();
    expect(crmMocks.getCrmClientById).not.toHaveBeenCalled();
  });
});

describe("chamados.update — troca canônica de cliente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.updateChamado.mockResolvedValue(undefined);
    dbMocks.getChamadoWithActivities.mockResolvedValue({
      ...ticket("crm-new-customer"),
      customerName: "Responsável Novo",
      customerPhone: "11988887777",
      customerEmail: "novo@example.invalid",
      customerCNPJ: "98765432000110",
      company: "Empresa Nova Ltda",
      title: "Título atualizado",
      observations: "Observações atualizadas",
      status: "in_progress",
      priority: "critica",
    });
    crmMocks.getCrmClientById.mockResolvedValue({
      crmClientId: "crm-new-customer",
      customerType: "company",
      companyName: "Empresa Nova Ltda",
      responsibleName: "Responsável Novo",
      cpfCnpj: "98765432000110",
      phone: "11988887777",
      email: "novo@example.invalid",
      lifecycleState: "active",
    });
  });

  it("persiste o ID e snapshots canônicos e devolve o detalhe atualizado", async () => {
    const result = await createCaller(context()).update({
      chamadoId: ticketId,
      customerId: "crm-new-customer",
      title: "Título atualizado",
      observations: "Observações atualizadas",
      status: "in_progress",
      priority: "critica",
    });

    expect(crmMocks.getCrmClientById).toHaveBeenCalledWith("crm-new-customer", "tenant-tickets");
    expect(dbMocks.updateChamado).toHaveBeenCalledWith(ticketId, "tenant-tickets", expect.objectContaining({
      customerId: "crm-new-customer",
      customerName: "Responsável Novo",
      customerPhone: "11988887777",
      customerEmail: "novo@example.invalid",
      customerCNPJ: "98765432000110",
      company: "Empresa Nova Ltda",
      title: "Título atualizado",
      observations: "Observações atualizadas",
      status: "in_progress",
      priority: "critica",
    }));
    expect(result.chamado.customer).toEqual({
      id: "crm-new-customer",
      type: "company",
      name: "Empresa Nova Ltda",
      document: "98765432000110",
      phone: "11988887777",
      email: "novo@example.invalid",
      source: "erp",
    });
  });

  it.each([
    ["title", "Somente título"],
    ["observations", "Somente observações"],
    ["priority", "baixa"],
    ["status", "waiting"],
  ] as const)("mantém a edição isolada de %s", async (field, value) => {
    await createCaller(context()).update({ chamadoId: ticketId, [field]: value } as any);

    const persisted = dbMocks.updateChamado.mock.calls[0][2];
    expect(persisted).toMatchObject({ [field]: value });
    expect(persisted).not.toHaveProperty("customerId");
  });

  it("rejeita customerId de outro tenant antes de escrever", async () => {
    crmMocks.getCrmClientById.mockResolvedValue(null);

    await expect(createCaller(context("tenant-a")).update({
      chamadoId: ticketId,
      customerId: "crm-other-tenant",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(crmMocks.getCrmClientById).toHaveBeenCalledWith("crm-other-tenant", "tenant-a");
    expect(dbMocks.updateChamado).not.toHaveBeenCalled();
  });

  it("rejeita nome livre enviado pelo cliente", async () => {
    await expect(createCaller(context()).update({
      chamadoId: ticketId,
      clientName: "Nome digitado livremente",
    } as any)).rejects.toBeDefined();

    expect(crmMocks.getCrmClientById).not.toHaveBeenCalled();
    expect(dbMocks.updateChamado).not.toHaveBeenCalled();
  });

  it("não substitui uma sessão sem tenant por identidade do usuário", async () => {
    await expect(createCaller({ ...context(), tenantId: undefined as any }).update({
      chamadoId: ticketId,
      customerId: "crm-new-customer",
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(crmMocks.getCrmClientById).not.toHaveBeenCalled();
    expect(dbMocks.updateChamado).not.toHaveBeenCalled();
  });
});
