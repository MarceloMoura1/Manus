import { describe, it, expect, vi } from "vitest";
import { createHermesTools, resolveClientInCRM } from "./hermes-tools";

describe("Hermes Tools (Vercel AI SDK - hermes-tools.ts)", () => {
  function createMockPool(rows: unknown[] = [], tenantExpected = "tenant-test") {
    return {
      execute: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM megadesk_crm_clients")) {
          expect(params?.[0]).toBe(tenantExpected);
          return [rows];
        }
        return [[]];
      }),
    };
  }

  describe("resolveClientInCRM", () => {
    it("finds client by company name and preserves canonical display name", async () => {
      const pool = createMockPool([
        { crmClientId: "crm-1", companyName: "Tech Solutions LTDA", responsibleName: "Roberto", phone: "11999990000", status: "lead" },
      ]);
      const result = await resolveClientInCRM(pool, "tenant-test", "Tech Solutions");
      expect(result.status).toBe("found");
      if (result.status === "found") {
        expect(result.customerName).toBe("Tech Solutions LTDA");
      }
    });

    it("finds client by responsible name (PF)", async () => {
      const pool = createMockPool([
        { crmClientId: "crm-2", companyName: "", responsibleName: "Maria Souza", phone: "11988887777", status: "ativo" },
      ]);
      const result = await resolveClientInCRM(pool, "tenant-test", "Maria Souza");
      expect(result.status).toBe("found");
      if (result.status === "found") {
        expect(result.customerName).toBe("Maria Souza");
      }
    });

    it("returns missing when no client matches", async () => {
      const pool = createMockPool([]);
      const result = await resolveClientInCRM(pool, "tenant-test", "Inexistente");
      expect(result.status).toBe("missing");
    });

    it("returns ambiguous when multiple different clients match without exact unique match", async () => {
      const pool = createMockPool([
        { crmClientId: "crm-3", companyName: "Pedro Silva", responsibleName: "", status: "ativo" },
        { crmClientId: "crm-4", companyName: "Pedro Souza", responsibleName: "", status: "ativo" },
      ]);
      const result = await resolveClientInCRM(pool, "tenant-test", "Pedro");
      expect(result.status).toBe("ambiguous");
      if (result.status === "ambiguous") {
        expect(result.options).toEqual(["Pedro Silva", "Pedro Souza"]);
      }
    });
  });

  describe("solicitar_abertura_chamado tool", () => {
    it("prepares CREATE_TICKET pendingActionRequest for active client", async () => {
      const pool = createMockPool([
        { crmClientId: "crm-5", companyName: "Empresa Alpha", responsibleName: "", phone: "11999991111", status: "ativo" },
      ]);
      const tools = createHermesTools({ clientId: "tenant-test", userId: "op-1", pool });
      const result = await tools.solicitar_abertura_chamado.execute({
        termoCliente: "Empresa Alpha",
        assunto: "Falha de rede",
        descricaoDetalhada: "Servidor offline após pico de energia",
        prioridade: "urgente",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("preparado");
      expect(result.cliente).toBe("Empresa Alpha");
      expect(result.prioridade).toBe("urgent");
      expect(result.pendingActionRequest).toBeDefined();
      expect(result.pendingActionRequest?.actionType).toBe("CREATE_TICKET");
      expect(result.pendingActionRequest?.args).toMatchObject({
        customer: "Empresa Alpha",
        title: "Falha de rede",
        description: "Servidor offline após pico de energia",
        priority: "urgent",
      });
    });

    it("prepares CREATE_TICKET with default description when not provided", async () => {
      const pool = createMockPool([
        { crmClientId: "crm-6", companyName: "", responsibleName: "Pedro Ferrari", phone: "", status: "lead" },
      ]);
      const tools = createHermesTools({ clientId: "tenant-test", userId: "op-1", pool });
      const result = await tools.solicitar_abertura_chamado.execute({
        termoCliente: "Pedro Ferrari",
        assunto: "Problema no faturamento",
        prioridade: "media",
      });

      expect(result.success).toBe(true);
      expect(result.cliente).toBe("Pedro Ferrari");
      expect(result.descricao).toBe("Problema no faturamento");
      expect(result.prioridade).toBe("medium");
      expect(result.pendingActionRequest?.actionType).toBe("CREATE_TICKET");
    });

    it("returns friendly message and suggestion to register when client not found", async () => {
      const pool = createMockPool([]);
      const tools = createHermesTools({ clientId: "tenant-test", pool });
      const result = await tools.solicitar_abertura_chamado.execute({
        termoCliente: "Empresa Fantasma",
        assunto: "Qualquer assunto",
        prioridade: "baixa",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("cliente_nao_encontrado");
      expect(result.message).toContain("Não encontrei nenhum cliente ou lead chamado 'Empresa Fantasma' no CRM. Deseja cadastrá-lo?");
      expect(result.pendingActionRequest).toBeUndefined();
    });

    it("handles 'Abre um chamado para o Luiz com o assunto Falha na emissão de nota' gracefully when Luiz is missing", async () => {
      const pool = createMockPool([]);
      const tools = createHermesTools({ clientId: "tenant-test", pool });
      const result = await tools.solicitar_abertura_chamado.execute({
        termoCliente: "Luiz",
        assunto: "Falha na emissão de nota",
        prioridade: "media",
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe("Não encontrei nenhum cliente ou lead chamado 'Luiz' no CRM. Deseja cadastrá-lo?");
      expect(result.pendingActionRequest).toBeUndefined();
    });

    it("enforces tenant isolation parameter in database query", async () => {
      const pool = createMockPool([], "tenant-restricted");
      const tools = createHermesTools({ clientId: "tenant-restricted", pool });
      await tools.solicitar_abertura_chamado.execute({
        termoCliente: "Cliente Outro",
        assunto: "Assunto",
        prioridade: "media",
      });
      expect(pool.execute).toHaveBeenCalled();
    });
  });

  describe("consultar_crm tool", () => {
    it("returns formatted client records matching the query", async () => {
      const pool = createMockPool([
        {
          crmClientId: "crm-7",
          companyName: "Acme Corp",
          responsibleName: "John Doe",
          phone: "11988881234",
          status: "ativo",
          document: "12.345.678/0001-90",
          email: "contato@acme.com",
        },
      ]);
      const tools = createHermesTools({ clientId: "tenant-test", pool });
      const result = await tools.consultar_crm.execute({ busca: "Acme" });

      expect(result.success).toBe(true);
      expect(result.total).toBe(1);
      expect(result.resultados?.[0]).toMatchObject({
        id: "crm-7",
        nomeEmpresa: "Acme Corp",
        responsavel: "John Doe",
        status: "ativo",
      });
    });

    it("handles empty search results gracefully", async () => {
      const pool = createMockPool([]);
      const tools = createHermesTools({ clientId: "tenant-test", pool });
      const result = await tools.consultar_crm.execute({ busca: "Ninguem" });

      expect(result.success).toBe(true);
      expect(result.total).toBe(0);
      expect(result.resultados).toEqual([]);
      expect(result.message).toContain("Nenhum cliente ou lead encontrado");
    });
  });

  describe("consultar_vendas tool", () => {
    it("filters sales by specific month and year with structured JSON output", async () => {
      let executedSql = "";
      let executedParams: unknown[] = [];
      const pool = {
        execute: vi.fn(async (sql: string, params?: unknown[]) => {
          executedSql = sql;
          executedParams = params ?? [];
          if (sql.includes("COUNT(*) AS total")) {
            return [[{ total: 5, totalCents: 150000 }]];
          }
          if (sql.includes("SELECT id, order_number")) {
            return [[
              { id: 1, orderNumber: "PED-001", customerName: "Empresa XPTO", totalCents: 30000, createdAt: new Date("2026-10-15T10:00:00Z") },
            ]];
          }
          return [[]];
        }),
      };

      const tools = createHermesTools({ clientId: "tenant-test", pool });
      const result = await tools.consultar_vendas.execute({ mes: 10, ano: 2026 });

      expect(result.success).toBe(true);
      expect(result.periodoConsultado).toBe("outubro/2026");
      expect(result.quantidadePedidos).toBe(5);
      expect(result.faturamentoTotal).toContain("1.500,00");
      expect(result.ticketMedio).toContain("300,00");
      expect(result.pedidosRecentes).toHaveLength(1);
      expect(result.pedidosRecentes[0].cliente).toBe("Empresa XPTO");

      // Verifica se os parâmetros de data do SQL foram calculados corretamente para outubro/2026
      expect(executedParams).toContain("2026-10-01 00:00:00");
      expect(executedParams).toContain("2026-10-31 23:59:59");
    });

    it("falls back to current year when only month is specified", async () => {
      let executedParams: unknown[] = [];
      const pool = {
        execute: vi.fn(async (_sql: string, params?: unknown[]) => {
          executedParams = params ?? [];
          return [[{ total: 0, totalCents: 0 }]];
        }),
      };

      const anoCorrente = new Date().getFullYear();
      const tools = createHermesTools({ clientId: "tenant-test", pool });
      const result = await tools.consultar_vendas.execute({ mes: 5 });

      expect(result.success).toBe(true);
      expect(result.periodoConsultado).toBe(`maio/${anoCorrente}`);
      expect(executedParams).toContain(`${anoCorrente}-05-01 00:00:00`);
      expect(executedParams).toContain(`${anoCorrente}-05-31 23:59:59`);
    });
  });

  describe("consultar_chamados / get_tickets_overview tool", () => {
    it("returns open tickets in standardized structured JSON format", async () => {
      const mockChamados = [
        {
          id: "chk-1",
          numero: 101,
          assunto: "Falha de login no app",
          cliente: "Cliente Alpha",
          status: "open",
          prioridade: "high",
        },
        {
          id: "chk-2",
          numero: 102,
          assunto: "Dúvida tributária",
          cliente: "Cliente Beta",
          status: "closed",
          prioridade: "low",
        },
      ];

      const pool = {
        execute: vi.fn(async () => [mockChamados]),
      };

      const tools = createHermesTools({ clientId: "tenant-test", pool });
      const result = await tools.consultar_chamados.execute({});

      expect(result.success).toBe(true);
      // Apenas o chamado aberto deve entrar em totalAbertos
      expect(result.totalAbertos).toBe(1);
      expect(result.chamados).toHaveLength(1);
      expect(result.chamados[0]).toEqual({
        id: "chk-1",
        codigo: "#0101",
        assunto: "Falha de login no app",
        cliente: "Cliente Alpha",
        status: "open",
        prioridade: "high",
      });
    });
  });

  describe("get_system_metrics_summary tool", () => {
    it("returns system metrics summary for admin including ai token usage", async () => {
      const pool = {
        execute: vi.fn(async (sql: string) => {
          if (sql.includes("FROM megadesk_domain_conversations")) {
            return [[{ totalAbertas: 5, emTriagemBot: 2, emAtendimentoHumano: 2, filaEspera: 1 }]];
          }
          if (sql.includes("FROM megadesk_domain_chamados")) {
            return [[{ totalAtivos: 4, criticos: 1, novosAbertos: 2, emAndamento: 1, aguardando: 0 }]];
          }
          if (sql.includes("FROM megadesk_domain_operational_records")) {
            return [[{ total: 3 }]];
          }
          if (sql.includes("FROM megadesk_crm_clients")) {
            return [[{ totalLeads: 7 }]];
          }
          if (sql.includes("FROM megadesk_crm_opportunities")) {
            return [[{ totalOportunidades: 2, valorTotal: 15000 }]];
          }
          return [[]];
        }),
      };

      const tools = createHermesTools({ clientId: "tenant-test", userRole: "admin", pool });
      expect(tools.get_system_metrics_summary).toBeDefined();
      const result = await tools.get_system_metrics_summary.execute({ categoria: "todas" });

      expect(result.success).toBe(true);
      expect(result.atendimento?.totalAbertas).toBe(5);
      expect(result.chamados?.criticosUrgentes).toBe(1);
      expect(result.rastreamentos?.ativos).toBe(3);
      expect(result.crm?.leadsAtivos).toBe(7);
      expect(result.crm?.oportunidadesAbertas).toBe(2);
      expect(result.iaTokens).toBeDefined();
      expect(result.iaTokens.totalConsumido).toBeDefined();
    });

    it("restricts full ai token details for non-admin users", async () => {
      const pool = {
        execute: vi.fn(async () => [[{}]]),
      };

      const tools = createHermesTools({ clientId: "tenant-test", userRole: "agent", pool });
      const result = await tools.get_system_metrics_summary.execute({ categoria: "ia_tokens" });

      expect(result.success).toBe(true);
      expect(result.iaTokens?.saldoDisponivel).toBeUndefined();
      expect(result.iaTokens?.observacao).toContain("administradores");
    });
  });
});

