import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  leadCreateInputSchema,
  leadUpdateInputSchema,
  leadListInputSchema,
  leadConvertInputSchema,
} from "./modules/crm/leads/contracts";
import * as service from "./modules/crm/leads/service";
import * as repo from "./modules/crm/leads/repository";
import * as dbCrm from "./db-crm";
import {
  hasCrmLeadAccess,
  requireCrmLeadAccess,
} from "./crm-access";

vi.mock("./modules/crm/leads/repository", () => ({
  listLeads: vi.fn(),
  getLeadById: vi.fn(),
  createLead: vi.fn(),
  updateLead: vi.fn(),
  convertLeadToClient: vi.fn(),
  getLeadTimeline: vi.fn(),
  addLeadTimelineNote: vi.fn(),
}));

vi.mock("./db-crm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db-crm")>();
  return {
    ...actual,
    findDuplicateCrmClient: vi.fn(),
    addCrmTimeline: vi.fn(),
    listCrmTimeline: vi.fn(),
  };
});

describe("MegaDesk CRM — Etapa 2B.3: Contratos Zod do Módulo de Leads", () => {
  it("valida cadastro correto de lead B2B com equipe e contatos adicionais", () => {
    const input = {
      companyName: "Acme Logística e Transportes Ltda",
      customerType: "company" as const,
      responsibleName: "Marcos Souza",
      cpfCnpj: "11.222.333/0001-81",
      phone: "11988887777",
      whatsapp: "11988887777",
      email: "contato@acme.com.br",
      origin: "whatsapp" as const,
      internalResponsible: "Vendedor 1",
      observations: "Interesse em plano empresarial",
      contacts: [
        {
          name: "Juliana Santos",
          role: "Compradora",
          phone: "11977776666",
          whatsapp: "11977776666",
          email: "juliana@acme.com.br",
          description: "Decisora operacional",
        },
      ],
    };

    const parsed = leadCreateInputSchema.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  it("rejeita cadastro com companyName vazio ou ausente", () => {
    const parsed = leadCreateInputSchema.safeParse({
      companyName: "   ",
      origin: "site",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejeita e-mail malformado", () => {
    const parsed = leadCreateInputSchema.safeParse({
      companyName: "Empresa Teste",
      email: "email-invalido-sem-arroba",
    });
    expect(parsed.success).toBe(false);
  });

  it("aplica defaults adequados no filtro de listagem", () => {
    const parsed = leadListInputSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
    expect(parsed.status).toBe("lead");
  });

  it("valida filtros de data no formato AAAA-MM-DD e rejeita datas malformadas", () => {
    const valid = leadListInputSchema.safeParse({
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    });
    expect(valid.success).toBe(true);

    const invalid = leadListInputSchema.safeParse({
      dateFrom: "01/01/2026",
    });
    expect(invalid.success).toBe(false);
  });

  it("valida contrato de conversão exigindo crmClientId", () => {
    const valid = leadConvertInputSchema.safeParse({
      crmClientId: "crm-11111111-1111-4111-8111-111111111111",
      notes: "Contrato fechado com sucesso",
    });
    expect(valid.success).toBe(true);

    const invalid = leadConvertInputSchema.safeParse({
      crmClientId: "",
    });
    expect(invalid.success).toBe(false);
  });
});

describe("MegaDesk CRM — Etapa 2B.3: Regras de Negócio e Serviço de Leads", () => {
  const tenantId = "tenant-crm-leads-01";
  const actor = "Operador Teste";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cria lead com sucesso quando não há duplicidade de documento ou telefone", async () => {
    vi.mocked(dbCrm.findDuplicateCrmClient).mockResolvedValue(null);
    vi.mocked(repo.createLead).mockResolvedValue({ crmClientId: "crm-lead-novo" });

    const result = await service.createLead(
      tenantId,
      {
        companyName: "Nova Empresa",
        customerType: "company",
        phone: "11999998888",
        origin: "whatsapp",
        responsibleName: "Decisor",
        cpfCnpj: "",
        whatsapp: "",
        email: "",
        internalResponsible: "",
        tags: "",
        observations: "",
        contacts: [],
      },
      actor
    );

    expect(result.crmClientId).toBe("crm-lead-novo");
    expect(dbCrm.findDuplicateCrmClient).toHaveBeenCalledWith(tenantId, {
      cpfCnpj: "",
      phone: "11999998888",
    });
    expect(repo.createLead).toHaveBeenCalled();
  });

  it("bloqueia criação de lead se houver duplicidade cadastral", async () => {
    vi.mocked(dbCrm.findDuplicateCrmClient).mockResolvedValue({
      crmClientId: "crm-existente",
      companyName: "Empresa Já Cadastrada",
      cpfCnpj: null,
      phone: "11999998888",
    });

    await expect(
      service.createLead(
        tenantId,
        {
          companyName: "Tentativa Duplicada",
          customerType: "company",
          phone: "11999998888",
          origin: "site",
          responsibleName: "",
          cpfCnpj: "",
          whatsapp: "",
          email: "",
          internalResponsible: "",
          tags: "",
          observations: "",
          contacts: [],
        },
        actor
      )
    ).rejects.toThrowError("Já existe um cadastro (Empresa Já Cadastrada) com este telefone.");
  });

  it("rejeita CNPJ matematicamente inválido para leads pessoa jurídica", async () => {
    await expect(
      service.createLead(
        tenantId,
        {
          companyName: "Empresa CNPJ Ruim",
          customerType: "company",
          cpfCnpj: "11.111.111/1111-11", // CNPJ com dígitos verificadores inválidos
          origin: "site",
          responsibleName: "",
          phone: "",
          whatsapp: "",
          email: "",
          internalResponsible: "",
          tags: "",
          observations: "",
          contacts: [],
        },
        actor
      )
    ).rejects.toThrowError("CNPJ inválido.");
  });

  it("converte lead em cliente ativo com sucesso e registra auditoria", async () => {
    vi.mocked(repo.getLeadById).mockResolvedValue({
      crmClientId: "crm-lead-01",
      customerType: "company",
      companyName: "Lead em Qualificação",
      responsibleName: "Carlos",
      cpfCnpj: null,
      phone: "11988881111",
      whatsapp: "11988881111",
      email: "carlos@empresa.com",
      status: "lead",
      origin: "whatsapp",
      internalResponsible: "Vendedor",
      tags: "",
      observations: "",
      contacts: [],
      createdAt: "2026-10-19T10:00:00Z",
      updatedAt: "2026-10-19T10:00:00Z",
    });

    vi.mocked(dbCrm.findDuplicateCrmClient).mockResolvedValue(null);
    vi.mocked(repo.convertLeadToClient).mockResolvedValue({
      crmClientId: "crm-lead-01",
      companyName: "Lead em Qualificação",
    });

    const result = await service.convertLeadToClient(
      tenantId,
      {
        crmClientId: "crm-lead-01",
        notes: "Negociação finalizada",
      },
      actor
    );

    expect(result.crmClientId).toBe("crm-lead-01");
    expect(repo.convertLeadToClient).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ crmClientId: "crm-lead-01" }),
      actor
    );
  });

  it("bloqueia conversão se o registro já tiver status ativo (prevenção de retrabalho)", async () => {
    vi.mocked(repo.getLeadById).mockResolvedValue({
      crmClientId: "crm-lead-ja-ativo",
      customerType: "company",
      companyName: "Cliente Ativo",
      responsibleName: "Carlos",
      cpfCnpj: null,
      phone: "11988881111",
      whatsapp: "",
      email: null,
      status: "ativo",
      origin: "whatsapp",
      internalResponsible: "",
      tags: "",
      observations: "",
      contacts: [],
      createdAt: "2026-10-19T10:00:00Z",
      updatedAt: "2026-10-19T10:00:00Z",
    });

    await expect(
      service.convertLeadToClient(
        tenantId,
        {
          crmClientId: "crm-lead-ja-ativo",
        },
        actor
      )
    ).rejects.toThrowError("Este lead já foi convertido em cliente ativo.");
  });

  it("retorna NOT_FOUND para busca de lead inexistente ou pertencente a outro tenant", async () => {
    vi.mocked(repo.getLeadById).mockResolvedValue(null);

    await expect(service.getLeadById(tenantId, "crm-alien")).rejects.toThrowError(
      "Lead não encontrado."
    );
  });

  it("trata concorrência na conversão retornando conflito amigável sem retrabalho", async () => {
    vi.mocked(repo.getLeadById).mockResolvedValue({
      crmClientId: "crm-lead-race",
      customerType: "company",
      companyName: "Empresa Concorrente",
      responsibleName: "",
      cpfCnpj: null,
      phone: null,
      whatsapp: "",
      email: null,
      status: "lead",
      origin: "site",
      internalResponsible: "",
      tags: "",
      observations: "",
      contacts: [],
      createdAt: "2026-10-19T10:00:00Z",
      updatedAt: "2026-10-19T10:00:00Z",
    });
    vi.mocked(repo.convertLeadToClient).mockRejectedValue(
      new Error("Falha na conversão concorrente do lead. O status já foi alterado por outra requisição.")
    );

    const promise = service.convertLeadToClient(tenantId, { crmClientId: "crm-lead-race" }, actor);
    await expect(promise).rejects.toThrowError(TRPCError);
    await expect(promise).rejects.toThrowError(
      "Este lead foi alterado por outra requisição concorrente. Atualize a página e tente novamente."
    );
  });

  it("trata status incompatível na conversão retornando BAD_REQUEST explicativo", async () => {
    vi.mocked(repo.getLeadById).mockResolvedValue({
      crmClientId: "crm-lead-canc",
      customerType: "company",
      companyName: "Empresa Cancelada",
      responsibleName: "",
      cpfCnpj: null,
      phone: null,
      whatsapp: "",
      email: null,
      status: "lead",
      origin: "site",
      internalResponsible: "",
      tags: "",
      observations: "",
      contacts: [],
      createdAt: "2026-10-19T10:00:00Z",
      updatedAt: "2026-10-19T10:00:00Z",
    });
    vi.mocked(repo.convertLeadToClient).mockRejectedValue(
      new Error("Este lead não pode ser convertido pois está com status 'cancelado'.")
    );

    const promise = service.convertLeadToClient(tenantId, { crmClientId: "crm-lead-canc" }, actor);
    await expect(promise).rejects.toThrowError(TRPCError);
    await expect(promise).rejects.toThrowError(
      "Este lead não pode ser convertido pois está com status 'cancelado'."
    );
  });

  it("sanitiza erro técnico inesperado do banco na conversão sem vazar detalhes internos", async () => {
    vi.mocked(repo.getLeadById).mockResolvedValue({
      crmClientId: "crm-lead-db-fail",
      customerType: "company",
      companyName: "Empresa Falha Interna",
      responsibleName: "",
      cpfCnpj: null,
      phone: null,
      whatsapp: "",
      email: null,
      status: "lead",
      origin: "site",
      internalResponsible: "",
      tags: "",
      observations: "",
      contacts: [],
      createdAt: "2026-10-19T10:00:00Z",
      updatedAt: "2026-10-19T10:00:00Z",
    });
    vi.mocked(repo.convertLeadToClient).mockRejectedValue(
      new Error("ER_LOCK_DEADLOCK: Deadlock found when trying to get lock; try restarting transaction at Connection.execute")
    );

    const promise = service.convertLeadToClient(tenantId, { crmClientId: "crm-lead-db-fail" }, actor);
    await expect(promise).rejects.toThrowError(TRPCError);
    await expect(promise).rejects.toThrowError(
      "Não foi possível converter o lead. Tente novamente."
    );
  });

  it("sanitiza erro técnico inesperado do banco na criação de lead sem vazar detalhes internos", async () => {
    vi.mocked(dbCrm.findDuplicateCrmClient).mockResolvedValue(null);
    vi.mocked(repo.createLead).mockRejectedValue(
      new Error("ECONNRESET: Connection lost to MySQL server at 127.0.0.1:3308")
    );

    const promise = service.createLead(
      tenantId,
      {
        companyName: "Empresa Queda DB",
        customerType: "company",
        phone: "",
        origin: "site",
        responsibleName: "",
        cpfCnpj: "",
        whatsapp: "",
        email: "",
        internalResponsible: "",
        tags: "",
        observations: "",
        contacts: [],
      },
      actor
    );

    await expect(promise).rejects.toThrowError(TRPCError);
    await expect(promise).rejects.toThrowError(
      "Não foi possível cadastrar o lead. Tente novamente."
    );
  });

  it("sanitiza erro técnico inesperado do banco na atualização de lead sem vazar detalhes internos", async () => {
    vi.mocked(repo.getLeadById).mockResolvedValue({
      crmClientId: "crm-lead-upd-fail",
      customerType: "company",
      companyName: "Empresa Update",
      responsibleName: "",
      cpfCnpj: null,
      phone: null,
      whatsapp: "",
      email: null,
      status: "lead",
      origin: "site",
      internalResponsible: "",
      tags: "",
      observations: "",
      contacts: [],
      createdAt: "2026-10-19T10:00:00Z",
      updatedAt: "2026-10-19T10:00:00Z",
    });
    vi.mocked(repo.updateLead).mockRejectedValue(
      new Error("ER_SYNTAX_ERROR: You have an error in your SQL syntax near 'foo'")
    );

    const promise = service.updateLead(
      tenantId,
      {
        crmClientId: "crm-lead-upd-fail",
        companyName: "Empresa Update Alterada",
      },
      actor
    );

    await expect(promise).rejects.toThrowError(TRPCError);
    await expect(promise).rejects.toThrowError(
      "Não foi possível atualizar o lead. Tente novamente."
    );
  });
});

describe("MegaDesk CRM — Etapa 2B.3: Autorização e Isolamento Multi-Tenant de Leads", () => {
  const tenantId = "tenant-crm-autenticado";

  it("autoriza acesso comercial de leads para operador com permissão dedicada 'crm'", () => {
    const ctx = {
      tenantId,
      operationalUserId: "user-crm-01",
      operationalUserRole: "agent" as const,
      operationalPermissions: ["crm"],
    };

    expect(hasCrmLeadAccess(ctx)).toBe(true);
    expect(requireCrmLeadAccess(ctx)).toBe(tenantId);
  });

  it("nega acesso a leads para usuário que NÃO possui a permissão 'crm', mesmo que tenha 'clients'", () => {
    const ctx = {
      tenantId,
      operationalUserId: "user-sem-crm",
      operationalUserRole: "agent" as const,
      operationalPermissions: ["clients"], // apenas permissão legada clients
    };

    expect(hasCrmLeadAccess(ctx)).toBe(false);
    expect(() => requireCrmLeadAccess(ctx)).toThrowError(TRPCError);
    expect(() => requireCrmLeadAccess(ctx)).toThrowError(
      "Acesso restrito ao módulo CRM."
    );
  });

  it("nega acesso a leads para usuário que tem apenas 'erp'", () => {
    const ctx = {
      tenantId,
      operationalUserId: "user-erp-only",
      operationalUserRole: "agent" as const,
      operationalPermissions: ["erp"],
    };

    expect(hasCrmLeadAccess(ctx)).toBe(false);
    expect(() => requireCrmLeadAccess(ctx)).toThrowError(
      "Acesso restrito ao módulo CRM."
    );
  });

  it("nega acesso se a sessão não possuir tenantId definido", () => {
    const ctx = {
      tenantId: undefined,
      operationalUserId: "user-sem-tenant",
      operationalUserRole: "admin" as const,
      operationalPermissions: ["crm"],
    };

    expect(hasCrmLeadAccess(ctx)).toBe(false);
    expect(() => requireCrmLeadAccess(ctx)).toThrowError(
      "Sessão operacional sem empresa identificada."
    );
  });
});
