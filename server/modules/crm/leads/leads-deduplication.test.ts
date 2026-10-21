import { describe, it, expect, vi, beforeEach } from "vitest";
import * as repo from "./repository";
import * as db from "../../../db";
import * as dbCrm from "../../../db-crm";

vi.mock("../../../db", () => ({
  getPool: vi.fn(),
}));

vi.mock("../../../db-crm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../db-crm")>();
  return {
    ...actual,
    addCrmTimeline: vi.fn(),
  };
});

describe("MegaDesk CRM — Deduplicação e Sincronização de Leads (megadesk_crm_clients)", () => {
  const clientId = "tenant-crm-dedup-test";
  const actor = "Operador Deduplicação";

  let mockConnection: {
    beginTransaction: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
    };

    vi.mocked(db.getPool).mockReturnValue({
      getConnection: vi.fn().mockResolvedValue(mockConnection),
      execute: vi.fn().mockResolvedValue([[]]),
    } as any);
  });

  it("não duplica registro em megadesk_crm_clients quando telefone já existe (reúso com UPDATE)", async () => {
    // 1. O findExistingLeadOrClient encontra cliente pré-existente pelo telefone
    const existingClient = {
      crm_client_id: "crm-cliente-existente-01",
      client_id: clientId,
      customer_type: "company",
      company_name: "Empresa Existente S/A",
      responsible_name: "Antigo Contato",
      cpf_cnpj: null,
      phone: "5511988887777",
      whatsapp: "",
      email: null,
      status: "lead",
      origin: "site",
      internal_responsible: null,
      tags: "antiga-tag",
      observations: "Primeira visita",
      contacts_json: JSON.stringify([{ name: "Contato 1", phone: "11988887777" }]),
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Primeira query do createLead é o findExistingLeadOrClient
    mockConnection.execute
      .mockResolvedValueOnce([[existingClient]]) // SELECT existente
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE existente

    vi.mocked(dbCrm.addCrmTimeline).mockResolvedValue(undefined as any);

    const result = await repo.createLead(
      clientId,
      {
        companyName: "Empresa Existente S/A (Nova tentativa)",
        customerType: "company",
        phone: "(11) 98888-7777", // Formato com máscara, deve normalizar e encontrar 5511988887777
        email: "novo.email@empresa.com",
        origin: "whatsapp",
        responsibleName: "Novo Responsável",
        cpfCnpj: "11222333000181",
        whatsapp: "11999990000",
        internalResponsible: "Vendedor 2",
        tags: "nova-tag",
        observations: "Novo contato de interesse",
        contacts: [{ name: "Contato 2", role: "Diretor", phone: "11977776666", whatsapp: "", email: "", description: "" }],
      },
      actor
    );

    // Deve retornar o crmClientId já existente e flag deduplicated = true
    expect(result.crmClientId).toBe("crm-cliente-existente-01");
    expect(result.deduplicated).toBe(true);

    // Garante que NENHUM INSERT foi executado na tabela de clientes
    const calls = mockConnection.execute.mock.calls;
    const insertCall = calls.find((c: any[]) =>
      typeof c[0] === "string" && c[0].includes("INSERT INTO megadesk_crm_clients")
    );
    expect(insertCall).toBeUndefined();

    // Garante que um UPDATE foi executado para complementar os dados
    const updateCall = calls.find((c: any[]) =>
      typeof c[0] === "string" && c[0].includes("UPDATE megadesk_crm_clients SET")
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).toContain("updated_at = NOW()");
    expect(updateCall![0]).toContain("cpf_cnpj = ?");
    expect(updateCall![0]).toContain("email = ?");
    expect(updateCall![0]).toContain("whatsapp = ?");

    // Timeline deve registrar vínculo com o cadastro existente
    expect(dbCrm.addCrmTimeline).toHaveBeenCalledWith(
      "crm-cliente-existente-01",
      clientId,
      expect.objectContaining({
        type: "note",
        description: expect.stringContaining("Dados complementares vinculados ao cadastro existente"),
      }),
      mockConnection
    );

    expect(mockConnection.commit).toHaveBeenCalledTimes(1);
    expect(mockConnection.rollback).not.toHaveBeenCalled();
    expect(mockConnection.release).toHaveBeenCalledTimes(1);
  });

  it("não duplica registro quando e-mail já existe", async () => {
    const existingClient = {
      crm_client_id: "crm-cliente-email-existente",
      client_id: clientId,
      customer_type: "company",
      company_name: "Empresa do E-mail",
      responsible_name: "Responsavel",
      cpf_cnpj: null,
      phone: null,
      whatsapp: "",
      email: "contato@empresaemail.com",
      status: "lead",
      origin: "site",
      internal_responsible: "",
      tags: "",
      observations: "",
      contacts_json: "",
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockConnection.execute
      .mockResolvedValueOnce([[existingClient]]) // SELECT findExisting
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE

    vi.mocked(dbCrm.addCrmTimeline).mockResolvedValue(undefined as any);

    const result = await repo.createLead(
      clientId,
      {
        companyName: "Empresa do E-mail",
        customerType: "company",
        phone: "11911112222",
        email: "CONTATO@EMPRESAEMAIL.COM", // maiúsculo, normalizado para minúsculo
        origin: "indicacao",
        responsibleName: "",
        cpfCnpj: "",
        whatsapp: "",
        internalResponsible: "",
        tags: "",
        observations: "",
        contacts: [],
      },
      actor
    );

    expect(result.crmClientId).toBe("crm-cliente-email-existente");
    expect(result.deduplicated).toBe(true);

    const calls = mockConnection.execute.mock.calls;
    const insertCall = calls.find((c: any[]) =>
      typeof c[0] === "string" && c[0].includes("INSERT INTO megadesk_crm_clients")
    );
    expect(insertCall).toBeUndefined();
  });

  it("não duplica registro quando CPF/CNPJ já existe", async () => {
    const existingClient = {
      crm_client_id: "crm-cliente-cnpj-existente",
      client_id: clientId,
      customer_type: "company",
      company_name: "Empresa com CNPJ",
      responsible_name: "",
      cpf_cnpj: "11222333000181",
      phone: null,
      whatsapp: "",
      email: null,
      status: "lead",
      origin: "site",
      internal_responsible: "",
      tags: "",
      observations: "",
      contacts_json: "",
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockConnection.execute
      .mockResolvedValueOnce([[existingClient]]) // SELECT findExisting
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE

    vi.mocked(dbCrm.addCrmTimeline).mockResolvedValue(undefined as any);

    const result = await repo.createLead(
      clientId,
      {
        companyName: "Empresa com CNPJ Filial",
        customerType: "company",
        phone: "11933334444",
        email: "filial@empresa.com",
        origin: "site",
        responsibleName: "Gerente",
        cpfCnpj: "11.222.333/0001-81", // com máscara
        whatsapp: "",
        internalResponsible: "",
        tags: "",
        observations: "",
        contacts: [],
      },
      actor
    );

    expect(result.crmClientId).toBe("crm-cliente-cnpj-existente");
    expect(result.deduplicated).toBe(true);
  });

  it("reativa cliente com status 'inativo' ou 'cancelado' para 'lead' quando um novo lead chega", async () => {
    const existingClient = {
      crm_client_id: "crm-cliente-inativo",
      client_id: clientId,
      customer_type: "company",
      company_name: "Cliente Inativo Retornando",
      responsible_name: "Antigo",
      cpf_cnpj: null,
      phone: "5511977778888",
      whatsapp: "",
      email: null,
      status: "inativo", // Estava inativo
      origin: "outro",
      internal_responsible: "",
      tags: "",
      observations: "",
      contacts_json: "",
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockConnection.execute
      .mockResolvedValueOnce([[existingClient]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    vi.mocked(dbCrm.addCrmTimeline).mockResolvedValue(undefined as any);

    const result = await repo.createLead(
      clientId,
      {
        companyName: "Cliente Inativo Retornando",
        customerType: "company",
        phone: "11977778888",
        origin: "whatsapp",
        responsibleName: "",
        cpfCnpj: "",
        whatsapp: "",
        email: "",
        internalResponsible: "",
        tags: "",
        observations: "Voltou a procurar",
        contacts: [],
      },
      actor
    );

    expect(result.crmClientId).toBe("crm-cliente-inativo");
    expect(result.deduplicated).toBe(true);
    expect(result.status).toBe("lead");

    const updateCall = mockConnection.execute.mock.calls.find((c: any[]) =>
      typeof c[0] === "string" && c[0].includes("UPDATE megadesk_crm_clients SET")
    );
    expect(updateCall![0]).toContain("status = 'lead'");
  });

  it("preserva status 'ativo' se o cliente já for cliente ativo e apenas adiciona histórico", async () => {
    const existingClient = {
      crm_client_id: "crm-cliente-ativo",
      client_id: clientId,
      customer_type: "company",
      company_name: "Cliente Ativo Fiel",
      responsible_name: "Comprador",
      cpf_cnpj: "11222333000181",
      phone: "5511999991111",
      whatsapp: "",
      email: null,
      status: "ativo", // Já é cliente ativo
      origin: "indicacao",
      internal_responsible: "Vendedor 1",
      tags: "vip",
      observations: "",
      contacts_json: "",
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockConnection.execute
      .mockResolvedValueOnce([[existingClient]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    vi.mocked(dbCrm.addCrmTimeline).mockResolvedValue(undefined as any);

    const result = await repo.createLead(
      clientId,
      {
        companyName: "Cliente Ativo Fiel",
        customerType: "company",
        phone: "11999991111",
        origin: "whatsapp",
        responsibleName: "",
        cpfCnpj: "",
        whatsapp: "",
        email: "novo@cliente.com",
        internalResponsible: "",
        tags: "recorrente",
        observations: "Nova demanda de prospecção",
        contacts: [],
      },
      actor
    );

    expect(result.crmClientId).toBe("crm-cliente-ativo");
    expect(result.deduplicated).toBe(true);
    expect(result.status).toBe("ativo"); // Permanece ativo
  });

  it("cria novo registro canônico com INSERT quando não há cliente pré-existente", async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[]]) // findExisting retorna vazio
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT

    vi.mocked(dbCrm.addCrmTimeline).mockResolvedValue(undefined as any);

    const result = await repo.createLead(
      clientId,
      {
        companyName: "Primeira Vez Aqui Ltda",
        customerType: "company",
        phone: "11955556666",
        origin: "site",
        responsibleName: "Fundador",
        cpfCnpj: "",
        whatsapp: "",
        email: "contato@primeiravez.com",
        internalResponsible: "Vendedor 1",
        tags: "lead-quente",
        observations: "Interesse urgente",
        contacts: [],
      },
      actor
    );

    expect(result.crmClientId).toMatch(/^crm-[0-9a-f-]+$/);
    expect(result.deduplicated).toBe(false);
    expect(result.status).toBe("lead");

    const insertCall = mockConnection.execute.mock.calls.find((c: any[]) =>
      typeof c[0] === "string" && c[0].includes("INSERT INTO megadesk_crm_clients")
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain("5511955556666"); // Telefone normalizado com DDI BR
  });

  it("retorna resumo estatístico de leads agrupados por status com getLeadsSummary", async () => {
    const mockExecute = vi.fn().mockResolvedValue([
      [
        {
          total: "15",
          activeLeads: "10",
          convertedLeads: "3",
          inactiveLeads: "1",
          cancelledLeads: "1",
        },
      ],
    ]);

    vi.mocked(db.getPool).mockReturnValue({
      execute: mockExecute,
    } as any);

    const summary = await repo.getLeadsSummary(clientId);

    expect(summary.total).toBe(15);
    expect(summary.activeLeads).toBe(10);
    expect(summary.convertedLeads).toBe(3);
    expect(summary.inactiveLeads).toBe(1);
    expect(summary.cancelledLeads).toBe(1);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("megadesk_crm_clients"),
      [clientId]
    );
  });
});
