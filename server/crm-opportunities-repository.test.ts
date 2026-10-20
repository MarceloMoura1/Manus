import { describe, it, expect, vi, beforeEach } from "vitest";
import * as oppRepo from "./modules/crm/opportunities/repository";
import * as db from "./db";
import * as dbCrm from "./db-crm";

vi.mock("./db", () => ({
  getPool: vi.fn(),
}));

vi.mock("./db-crm", async importOriginal => {
  const actual = await importOriginal<typeof import("./db-crm")>();
  return {
    ...actual,
    addCrmTimeline: vi.fn(),
  };
});

describe("MegaDesk CRM — Etapa 2B.4: Concorrência e Transacionalidade do Repositório de Oportunidades", () => {
  const clientId = "tenant-opp-test";
  const actor = "Operador Teste";

  let mockConnection: {
    beginTransaction: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };

  let mockPool: {
    getConnection: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue([{ insertId: 100, affectedRows: 1 }]),
      query: vi.fn().mockResolvedValue([[]]),
    };

    mockPool = {
      getConnection: vi.fn().mockResolvedValue(mockConnection),
      execute: vi.fn().mockResolvedValue([[]]),
      query: vi.fn().mockResolvedValue([[]]),
    };

    vi.mocked(db.getPool).mockReturnValue(mockPool as any);
  });

  describe("createOpportunity com integridade transacional", () => {
    it("executa inserção da oportunidade, histórico e timeline na mesma transação", async () => {
      // 1. Pipeline query inside transaction
      mockConnection.query.mockResolvedValueOnce([[{ id: 10, public_id: "pipe-1", name: "Funil Vendas" }]]);
      // 2. Stage query inside transaction
      mockConnection.query.mockResolvedValueOnce([
        [{ id: 20, public_id: "stage-1", name: "Qualificação", probability_pct: 20, color: "#3B82F6" }],
      ]);
      // 3. Client query (linked client)
      mockConnection.query.mockResolvedValueOnce([
        [{ id: 50, crm_client_id: "client-123", status: "lead", company_name: "Lead Acme" }],
      ]);
      // 4. getOpportunityByPublicId lookup after commit
      mockPool.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-new",
            client_id: clientId,
            pipeline_id: 10,
            stage_id: 20,
            crm_client_id: "client-123",
            title: "Oportunidade Transacional",
            value_cents: 250000,
            currency: "BRL",
            status: "open",
            internal_responsible: "Vendedor",
            created_at: new Date(),
            updated_at: new Date(),
            pipeline_public_id: "pipe-1",
            stage_public_id: "stage-1",
            stage_name: "Qualificação",
            stage_color: "#3B82F6",
            company_name: "Lead Acme",
          },
        ],
      ]);

      const opp = await oppRepo.createOpportunity(
        clientId,
        {
          pipelinePublicId: "pipe-1",
          stagePublicId: "stage-1",
          crmClientId: "client-123",
          convertLead: true,
          title: "Oportunidade Transacional",
          valueCents: 250000,
        },
        actor
      );

      expect(mockConnection.beginTransaction).toHaveBeenCalledTimes(1);
      // Lead conversion update executed inside connection
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE megadesk_crm_clients"),
        expect.any(Array)
      );
      // Opportunity insert executed
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO megadesk_crm_opportunities"),
        expect.any(Array)
      );
      // History insert executed
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO megadesk_crm_opportunity_history"),
        expect.any(Array)
      );
      expect(mockConnection.commit).toHaveBeenCalledTimes(1);
      expect(mockConnection.rollback).not.toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
      expect(opp.title).toBe("Oportunidade Transacional");
    });

    it("executa rollback e libera conexão se a gravação do histórico falhar", async () => {
      mockConnection.query.mockResolvedValueOnce([[{ id: 10, public_id: "pipe-1", name: "Funil Vendas" }]]);
      mockConnection.query.mockResolvedValueOnce([
        [{ id: 20, public_id: "stage-1", name: "Qualificação", probability_pct: 20 }],
      ]);

      // Opportunity insert succeeds, but history insert fails
      mockConnection.execute
        .mockResolvedValueOnce([{ insertId: 100, affectedRows: 1 }]) // Opp insert
        .mockRejectedValueOnce(new Error("History table constraint failure")); // History insert fails

      await expect(
        oppRepo.createOpportunity(
          clientId,
          {
            pipelinePublicId: "pipe-1",
            stagePublicId: "stage-1",
            title: "Oportunidade Falha Histórico",
          },
          actor
        )
      ).rejects.toThrow("History table constraint failure");

      expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
    });
  });

  describe("transitionStage com concorrência e histórico", () => {
    it("faz lock FOR UPDATE, valida pertencimento de funil e registra histórico na transação", async () => {
      // 1. SELECT FOR UPDATE on opportunity
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-123",
            pipeline_id: 10,
            stage_id: 20, // current stage
            crm_client_id: "client-1",
            title: "Projeto A",
            value_cents: 100000,
            status: "open",
          },
        ],
      ]);

      // 2. Target stage lookup
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 30, // new stage
            pipeline_id: 10, // same pipeline!
            name: "Proposta",
            probability_pct: 70,
          },
        ],
      ]);

      // 3. getOpportunityByPublicId lookup after commit
      mockPool.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-123",
            client_id: clientId,
            pipeline_id: 10,
            stage_id: 30,
            crm_client_id: "client-1",
            title: "Projeto A",
            value_cents: 100000,
            currency: "BRL",
            status: "open",
            created_at: new Date(),
            updated_at: new Date(),
            pipeline_public_id: "pipe-1",
            stage_public_id: "stage-proposta",
            stage_name: "Proposta",
          },
        ],
      ]);

      const updated = await oppRepo.transitionStage(
        clientId,
        {
          opportunityPublicId: "opp-123",
          toStagePublicId: "stage-proposta",
          notes: "Enviada proposta comercial",
        },
        actor
      );

      expect(mockConnection.beginTransaction).toHaveBeenCalledTimes(1);
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE megadesk_crm_opportunities"),
        expect.any(Array)
      );
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO megadesk_crm_opportunity_history"),
        expect.any(Array)
      );
      expect(mockConnection.commit).toHaveBeenCalledTimes(1);
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
      expect(updated.stagePublicId).toBe("stage-proposta");
    });

    it("retorna idempotentemente sem criar histórico duplicado se oportunidade já estiver no estágio destino", async () => {
      // 1. SELECT FOR UPDATE on opportunity (already in stage 20)
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-123",
            pipeline_id: 10,
            stage_id: 20,
            crm_client_id: "client-1",
            title: "Projeto A",
            value_cents: 100000,
            status: "open",
          },
        ],
      ]);

      // 2. Target stage lookup returns id 20 (exact same stage)
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 20,
            pipeline_id: 10,
            name: "Qualificação",
            probability_pct: 20,
          },
        ],
      ]);

      // 3. Pool lookup for existing view
      mockPool.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-123",
            client_id: clientId,
            pipeline_id: 10,
            stage_id: 20,
            title: "Projeto A",
            value_cents: 100000,
            currency: "BRL",
            status: "open",
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      ]);

      await oppRepo.transitionStage(
        clientId,
        {
          opportunityPublicId: "opp-123",
          toStagePublicId: "stage-qualif",
        },
        actor
      );

      // Verify that NO update or history insertion was executed
      expect(mockConnection.execute).not.toHaveBeenCalled();
      expect(mockConnection.commit).toHaveBeenCalledTimes(1);
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
    });

    it("rejeita transição se o estágio pertencer a pipeline diferente e faz rollback", async () => {
      // 1. SELECT FOR UPDATE on opportunity (pipeline 10)
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-123",
            pipeline_id: 10,
            stage_id: 20,
            title: "Projeto A",
          },
        ],
      ]);

      // 2. Target stage belongs to pipeline 999 (mismatch!)
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 88,
            pipeline_id: 999,
            name: "Outro Funil",
            probability_pct: 50,
          },
        ],
      ]);

      await expect(
        oppRepo.transitionStage(
          clientId,
          {
            opportunityPublicId: "opp-123",
            toStagePublicId: "stage-outro-funil",
          },
          actor
        )
      ).rejects.toThrow("O estágio de destino não pertence ao funil desta oportunidade.");

      expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
    });

    it("marca como perdida em estágio customizado sem a palavra 'perdid' exigindo motivo explícito", async () => {
      // 1. Opportunity in open stage
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-123",
            pipeline_id: 10,
            stage_id: 20,
            crm_client_id: "client-1",
            title: "Projeto A",
            value_cents: 100000,
            status: "open",
          },
        ],
      ]);

      // 2. Target stage with custom name without 'perdid' (e.g. "Desistência / Inviável")
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 45,
            pipeline_id: 10,
            name: "Desistência / Inviável",
            probability_pct: 0,
          },
        ],
      ]);

      // 3. Pool lookup for updated view
      mockPool.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-123",
            client_id: clientId,
            pipeline_id: 10,
            stage_id: 45,
            crm_client_id: "client-1",
            title: "Projeto A",
            value_cents: 100000,
            currency: "BRL",
            status: "lost",
            loss_reason: "Cliente optou por solução interna.",
            lost_at: new Date(),
            closed_at: new Date(),
            won_at: null,
            created_at: new Date(),
            updated_at: new Date(),
            pipeline_public_id: "pipe-1",
            stage_public_id: "stage-inviavel",
            stage_name: "Desistência / Inviável",
          },
        ],
      ]);

      const result = await oppRepo.transitionStage(
        clientId,
        {
          opportunityPublicId: "opp-123",
          toStagePublicId: "stage-inviavel",
          status: "lost",
          lossReason: "Cliente optou por solução interna.",
        },
        actor
      );

      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE megadesk_crm_opportunities"),
        expect.arrayContaining(["lost", "Cliente optou por solução interna."])
      );
      expect(result.status).toBe("lost");
      expect(result.lossReason).toBe("Cliente optou por solução interna.");
      expect(mockConnection.commit).toHaveBeenCalledTimes(1);
    });

    it("rejeita transição para 'lost' se o motivo de perda for ausente ou em branco e faz rollback", async () => {
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-123",
            pipeline_id: 10,
            stage_id: 20,
            crm_client_id: "client-1",
            title: "Projeto A",
            value_cents: 100000,
            status: "open",
          },
        ],
      ]);

      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 45,
            pipeline_id: 10,
            name: "Desistência",
            probability_pct: 0,
          },
        ],
      ]);

      await expect(
        oppRepo.transitionStage(
          clientId,
          {
            opportunityPublicId: "opp-123",
            toStagePublicId: "stage-desistencia",
            status: "lost",
            lossReason: "   ",
          },
          actor
        )
      ).rejects.toThrow("Motivo de perda é obrigatório ao marcar a oportunidade como perdida.");

      expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
      expect(mockConnection.commit).not.toHaveBeenCalled();
    });

    it("reabre uma oportunidade previamente fechada limpando campos terminais de forma consistente", async () => {
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-closed",
            pipeline_id: 10,
            stage_id: 45,
            crm_client_id: "client-1",
            title: "Projeto Reaberto",
            value_cents: 100000,
            status: "lost",
          },
        ],
      ]);

      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 20,
            pipeline_id: 10,
            name: "Qualificação",
            probability_pct: 20,
          },
        ],
      ]);

      mockPool.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-closed",
            client_id: clientId,
            pipeline_id: 10,
            stage_id: 20,
            title: "Projeto Reaberto",
            value_cents: 100000,
            currency: "BRL",
            status: "open",
            loss_reason: null,
            lost_at: null,
            closed_at: null,
            won_at: null,
            created_at: new Date(),
            updated_at: new Date(),
            pipeline_public_id: "pipe-1",
            stage_public_id: "stage-qualif",
            stage_name: "Qualificação",
          },
        ],
      ]);

      const result = await oppRepo.transitionStage(
        clientId,
        {
          opportunityPublicId: "opp-closed",
          toStagePublicId: "stage-qualif",
          status: "open",
        },
        actor
      );

      // Verify that status is 'open' and terminal fields are set to null
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE megadesk_crm_opportunities"),
        expect.arrayContaining([20, "open", null, null, null, null])
      );
      expect(result.status).toBe("open");
      expect(result.lossReason).toBeNull();
      expect(mockConnection.commit).toHaveBeenCalledTimes(1);
    });

    it("movimenta para estágio com probabilidade 0% sem encerrar automaticamente como perdida", async () => {
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-open",
            pipeline_id: 10,
            stage_id: 20,
            crm_client_id: "client-1",
            title: "Projeto Em Andamento",
            value_cents: 100000,
            status: "open",
          },
        ],
      ]);

      // Stage with 0% probability
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 45,
            pipeline_id: 10,
            name: "Triagem ou Desistência",
            probability_pct: 0,
          },
        ],
      ]);

      mockPool.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-open",
            client_id: clientId,
            pipeline_id: 10,
            stage_id: 45,
            title: "Projeto Em Andamento",
            value_cents: 100000,
            currency: "BRL",
            status: "open",
            loss_reason: null,
            lost_at: null,
            closed_at: null,
            won_at: null,
            created_at: new Date(),
            updated_at: new Date(),
            pipeline_public_id: "pipe-1",
            stage_public_id: "stage-0pct",
            stage_name: "Triagem ou Desistência",
          },
        ],
      ]);

      // Move without passing explicit status
      const result = await oppRepo.transitionStage(
        clientId,
        {
          opportunityPublicId: "opp-open",
          toStagePublicId: "stage-0pct",
        },
        actor
      );

      // Status must remain 'open', terminal fields null
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE megadesk_crm_opportunities"),
        expect.arrayContaining([45, "open", null, null, null, null])
      );
      expect(result.status).toBe("open");
      expect(result.lossReason).toBeNull();
      expect(result.lostAt).toBeNull();
    });

    it("movimenta para estágio com probabilidade 100% sem encerrar automaticamente como ganha", async () => {
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-open",
            pipeline_id: 10,
            stage_id: 20,
            crm_client_id: "client-1",
            title: "Projeto Em Andamento",
            value_cents: 100000,
            status: "open",
          },
        ],
      ]);

      // Stage with 100% probability
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 50,
            pipeline_id: 10,
            name: "Entrega Final",
            probability_pct: 100,
          },
        ],
      ]);

      mockPool.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-open",
            client_id: clientId,
            pipeline_id: 10,
            stage_id: 50,
            title: "Projeto Em Andamento",
            value_cents: 100000,
            currency: "BRL",
            status: "open",
            loss_reason: null,
            lost_at: null,
            closed_at: null,
            won_at: null,
            created_at: new Date(),
            updated_at: new Date(),
            pipeline_public_id: "pipe-1",
            stage_public_id: "stage-100pct",
            stage_name: "Entrega Final",
          },
        ],
      ]);

      // Move without passing explicit status
      const result = await oppRepo.transitionStage(
        clientId,
        {
          opportunityPublicId: "opp-open",
          toStagePublicId: "stage-100pct",
        },
        actor
      );

      // Status must remain 'open', won_at and closed_at must NOT be automatically set
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE megadesk_crm_opportunities"),
        expect.arrayContaining([50, "open", null, null, null, null])
      );
      expect(result.status).toBe("open");
      expect(result.wonAt).toBeNull();
      expect(result.closedAt).toBeNull();
    });

    it("executa ação explícita de marcar como ganha definindo won_at e closed_at", async () => {
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-open",
            pipeline_id: 10,
            stage_id: 20,
            crm_client_id: "client-1",
            title: "Projeto Ganho",
            value_cents: 200000,
            status: "open",
          },
        ],
      ]);

      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 50,
            pipeline_id: 10,
            name: "Fechado / Ganho",
            probability_pct: 100,
          },
        ],
      ]);

      mockPool.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-open",
            client_id: clientId,
            pipeline_id: 10,
            stage_id: 50,
            title: "Projeto Ganho",
            value_cents: 200000,
            currency: "BRL",
            status: "won",
            loss_reason: null,
            lost_at: null,
            won_at: new Date(),
            closed_at: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
            pipeline_public_id: "pipe-1",
            stage_public_id: "stage-won",
            stage_name: "Fechado / Ganho",
          },
        ],
      ]);

      const result = await oppRepo.transitionStage(
        clientId,
        {
          opportunityPublicId: "opp-open",
          toStagePublicId: "stage-won",
          status: "won",
        },
        actor
      );

      expect(result.status).toBe("won");
      expect(result.wonAt).not.toBeNull();
      expect(result.closedAt).not.toBeNull();
      expect(result.lossReason).toBeNull();
      expect(mockConnection.commit).toHaveBeenCalledTimes(1);
    });

    it("rejeita combinação inválida de status 'won' com motivo de perda e faz rollback", async () => {
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-open",
            pipeline_id: 10,
            stage_id: 20,
            crm_client_id: "client-1",
            title: "Projeto Invalido",
            value_cents: 100000,
            status: "open",
          },
        ],
      ]);

      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 50,
            pipeline_id: 10,
            name: "Fechado / Ganho",
            probability_pct: 100,
          },
        ],
      ]);

      await expect(
        oppRepo.transitionStage(
          clientId,
          {
            opportunityPublicId: "opp-open",
            toStagePublicId: "stage-won",
            status: "won",
            lossReason: "Motivo descabido para vitória",
          },
          actor
        )
      ).rejects.toThrow("Motivo de perda não pode ser informado para oportunidade ganha.");

      expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
      expect(mockConnection.commit).not.toHaveBeenCalled();
    });

    it("rejeita combinação inválida de status 'open' com motivo de perda e faz rollback", async () => {
      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 100,
            public_id: "opp-open",
            pipeline_id: 10,
            stage_id: 20,
            crm_client_id: "client-1",
            title: "Projeto Invalido",
            value_cents: 100000,
            status: "open",
          },
        ],
      ]);

      mockConnection.query.mockResolvedValueOnce([
        [
          {
            id: 25,
            pipeline_id: 10,
            name: "Proposta",
            probability_pct: 60,
          },
        ],
      ]);

      await expect(
        oppRepo.transitionStage(
          clientId,
          {
            opportunityPublicId: "opp-open",
            toStagePublicId: "stage-proposta",
            status: "open",
            lossReason: "Motivo descabido para aberto",
          },
          actor
        )
      ).rejects.toThrow("Motivo de perda não pode ser informado para oportunidade aberta.");

      expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
      expect(mockConnection.commit).not.toHaveBeenCalled();
    });
  });

  describe("getOpportunityMetrics alinhado aos filtros canônicos", () => {
    it("aplica filtros de busca, responsável e período agregando no banco por status", async () => {
      mockPool.query.mockResolvedValueOnce([
        [
          { status: "open", count: 4, total_cents: 400000 },
          { status: "won", count: 2, total_cents: 350000 },
          { status: "lost", count: 1, total_cents: 100000 },
        ],
      ]);

      const metrics = await oppRepo.getOpportunityMetrics(clientId, {
        pipelinePublicId: "11111111-1111-1111-1111-111111111111",
        internalResponsible: "Vendedora Maria",
        search: "Sistema",
        dateFrom: "2026-10-01",
        dateTo: "2026-10-31",
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("GROUP BY o.status"),
        expect.arrayContaining([
          clientId,
          "11111111-1111-1111-1111-111111111111",
          "Vendedora Maria",
          "2026-10-01",
          "2026-10-31",
          "%Sistema%",
        ])
      );

      expect(metrics.openCount).toBe(4);
      expect(metrics.openValueCents).toBe(400000);
      expect(metrics.wonCount).toBe(2);
      expect(metrics.wonValueCents).toBe(350000);
      expect(metrics.lostCount).toBe(1);
      expect(metrics.lostValueCents).toBe(100000);
      expect(metrics.totalCount).toBe(7);
      expect(metrics.totalValueCents).toBe(850000);
    });

    it("retorna zeros quando não houver correspondência para os filtros informados", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      const metrics = await oppRepo.getOpportunityMetrics(clientId, {
        search: "TermoInexistente999",
      });

      expect(metrics.openCount).toBe(0);
      expect(metrics.openValueCents).toBe(0);
      expect(metrics.wonCount).toBe(0);
      expect(metrics.wonValueCents).toBe(0);
      expect(metrics.lostCount).toBe(0);
      expect(metrics.lostValueCents).toBe(0);
      expect(metrics.totalCount).toBe(0);
      expect(metrics.totalValueCents).toBe(0);
    });
  });
});
