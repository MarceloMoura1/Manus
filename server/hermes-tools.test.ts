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
      expect(result.message).toContain("Não localizei nenhum cliente com o nome 'Empresa Fantasma'");
      expect(result.message).toContain("Deseja cadastrá-lo primeiro");
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
});

