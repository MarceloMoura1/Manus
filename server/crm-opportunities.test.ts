import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  hasCrmOpportunityAccess,
  requireCrmOpportunityAccess,
  hasCrmPipelineAdminAccess,
  requireCrmPipelineAdminAccess,
} from "./crm-access";
import * as pipelineService from "./modules/crm/pipeline/service";
import * as oppService from "./modules/crm/opportunities/service";
import * as oppRepo from "./modules/crm/opportunities/repository";
import * as pipelineRepo from "./modules/crm/pipeline/repository";

describe("MegaDesk CRM — Etapa 2B.4: Funil de Vendas e Oportunidades", () => {
  describe("1. Autorização dedicada CRM e isolamento multi-tenant", () => {
    it("permite acesso ordinário de oportunidades para usuário com permissão dedicada 'crm' e papel comercial", () => {
      const context = {
        tenantId: "tenant-alpha",
        operationalUserRole: "agent",
        operationalPermissions: ["crm", "tickets"],
      };
      expect(hasCrmOpportunityAccess(context)).toBe(true);
      expect(requireCrmOpportunityAccess(context)).toBe("tenant-alpha");
    });

    it("bloqueia acesso se possuir apenas permissões legadas ('erp' ou 'clients') sem 'crm'", () => {
      const contextErp = {
        tenantId: "tenant-alpha",
        operationalUserRole: "admin",
        operationalPermissions: ["erp", "clients"],
      };
      expect(hasCrmOpportunityAccess(contextErp)).toBe(false);
      expect(() => requireCrmOpportunityAccess(contextErp)).toThrow(TRPCError);
      expect(() => requireCrmOpportunityAccess(contextErp)).toThrow(/Acesso restrito ao módulo CRM/);
    });

    it("bloqueia acesso se tenantId for ausente, vazio ou apenas espaços", () => {
      expect(
        hasCrmOpportunityAccess({
          tenantId: "",
          operationalUserRole: "admin",
          operationalPermissions: ["crm"],
        })
      ).toBe(false);

      expect(() =>
        requireCrmOpportunityAccess({
          tenantId: "   ",
          operationalUserRole: "admin",
          operationalPermissions: ["crm"],
        })
      ).toThrow(/Sessão operacional sem empresa identificada/);
    });

    it("restringe operações administrativas de funil a papéis de gestão (admin/manager)", () => {
      const agentContext = {
        tenantId: "tenant-alpha",
        operationalUserRole: "agent",
        operationalPermissions: ["crm"],
      };
      expect(hasCrmPipelineAdminAccess(agentContext)).toBe(false);
      expect(() => requireCrmPipelineAdminAccess(agentContext)).toThrow(
        /Somente administradores e gerentes/
      );

      const managerContext = {
        tenantId: "tenant-alpha",
        operationalUserRole: "manager",
        operationalPermissions: ["crm"],
      };
      expect(hasCrmPipelineAdminAccess(managerContext)).toBe(true);
      expect(requireCrmPipelineAdminAccess(managerContext)).toBe("tenant-alpha");
    });
  });

  describe("2. Regras de Negócio e Serviços do Funil e Oportunidades", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("garante criação ou recuperação do funil de vendas padrão com 5 estágios estruturados", async () => {
      const mockPipeline = {
        publicId: "pipe-1111-2222",
        name: "Funil de Vendas Padrão",
        isDefault: true,
        displayOrder: 0,
        isActive: true,
        createdAt: "2026-10-19T10:00:00Z",
        updatedAt: "2026-10-19T10:00:00Z",
        stages: [
          { publicId: "s-1", pipelinePublicId: "pipe-1111-2222", name: "Qualificação", displayOrder: 0, probabilityPct: 20, color: "#3B82F6", slaDays: 3, createdAt: "", updatedAt: "" },
          { publicId: "s-2", pipelinePublicId: "pipe-1111-2222", name: "Contato / Apresentação", displayOrder: 1, probabilityPct: 40, color: "#8B5CF6", slaDays: 5, createdAt: "", updatedAt: "" },
          { publicId: "s-3", pipelinePublicId: "pipe-1111-2222", name: "Proposta Comercial", displayOrder: 2, probabilityPct: 70, color: "#F59E0B", slaDays: 7, createdAt: "", updatedAt: "" },
          { publicId: "s-4", pipelinePublicId: "pipe-1111-2222", name: "Fechado / Ganho", displayOrder: 3, probabilityPct: 100, color: "#10B981", slaDays: null, createdAt: "", updatedAt: "" },
          { publicId: "s-5", pipelinePublicId: "pipe-1111-2222", name: "Perdido", displayOrder: 4, probabilityPct: 0, color: "#EF4444", slaDays: null, createdAt: "", updatedAt: "" },
        ],
      };

      vi.spyOn(pipelineRepo, "ensureDefaultPipeline").mockResolvedValue(mockPipeline);

      const res = await pipelineService.getDefaultPipeline("tenant-alpha");
      expect(res.pipeline.name).toBe("Funil de Vendas Padrão");
      expect(res.pipeline.stages).toHaveLength(5);
      expect(res.pipeline.stages?.[3].probabilityPct).toBe(100);
      expect(res.pipeline.stages?.[4].probabilityPct).toBe(0);
    });

    it("rejeita transição de estágio quando o estágio não pertence ao funil da oportunidade", async () => {
      vi.spyOn(oppRepo, "transitionStage").mockRejectedValue(
        new Error("O estágio de destino não pertence ao funil desta oportunidade.")
      );

      await expect(
        oppService.transitionStage(
          "tenant-alpha",
          {
            opportunityPublicId: "opp-123",
            toStagePublicId: "stage-de-outro-funil",
          },
          "Operador"
        )
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "BAD_REQUEST",
          message: "O estágio de destino não pertence ao funil desta oportunidade.",
        })
      );
    });

    it("permite cadastrar múltiplas oportunidades independentes para o mesmo cliente", async () => {
      const createdOpps: any[] = [];
      vi.spyOn(oppRepo, "createOpportunity").mockImplementation(async (tenantId, input) => {
        const item = {
          publicId: `opp-${createdOpps.length + 1}`,
          pipelinePublicId: input.pipelinePublicId,
          stagePublicId: input.stagePublicId,
          crmClientId: input.crmClientId || null,
          title: input.title,
          valueCents: input.valueCents || 0,
          currency: "BRL",
          expectedCloseDate: null,
          status: "open" as const,
          lossReason: null,
          internalResponsible: "Vendedor 1",
          observations: null,
          wonAt: null,
          lostAt: null,
          closedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        createdOpps.push(item);
        return item;
      });

      const opp1 = await oppService.createOpportunity(
        "tenant-alpha",
        {
          pipelinePublicId: "pipe-1",
          stagePublicId: "stage-1",
          crmClientId: "crm-client-acme",
          title: "Venda de Licenças 2026",
          valueCents: 500000,
        },
        "Operador 1"
      );

      const opp2 = await oppService.createOpportunity(
        "tenant-alpha",
        {
          pipelinePublicId: "pipe-1",
          stagePublicId: "stage-2",
          crmClientId: "crm-client-acme",
          title: "Serviço de Treinamento",
          valueCents: 150000,
        },
        "Operador 1"
      );

      expect(opp1.opportunity.crmClientId).toBe("crm-client-acme");
      expect(opp2.opportunity.crmClientId).toBe("crm-client-acme");
      expect(opp1.opportunity.publicId).not.toBe(opp2.opportunity.publicId);
      expect(createdOpps).toHaveLength(2);
    });

    it("mantém regras de estado consistentes ao mover para estágio ganho, perdido e reaberto", async () => {
      const oppState = {
        publicId: "opp-xyz",
        pipelinePublicId: "pipe-1",
        stagePublicId: "stage-qualif",
        crmClientId: "client-1",
        title: "Projeto Alpha",
        valueCents: 1000000,
        currency: "BRL",
        expectedCloseDate: null,
        status: "open" as const,
        lossReason: null,
        internalResponsible: "Gestor",
        observations: null,
        wonAt: null,
        lostAt: null,
        closedAt: null,
        createdAt: "2026-10-19T10:00:00Z",
        updatedAt: "2026-10-19T10:00:00Z",
      };

      // 1. Ganho
      vi.spyOn(oppRepo, "transitionStage").mockResolvedValueOnce({
        ...oppState,
        stagePublicId: "stage-won",
        status: "won",
        wonAt: "2026-10-19T12:00:00Z",
        closedAt: "2026-10-19T12:00:00Z",
        lostAt: null,
      });

      const wonRes = await oppService.transitionStage(
        "tenant-alpha",
        { opportunityPublicId: "opp-xyz", toStagePublicId: "stage-won" },
        "Operador"
      );
      expect(wonRes.opportunity.status).toBe("won");
      expect(wonRes.opportunity.wonAt).not.toBeNull();
      expect(wonRes.opportunity.closedAt).not.toBeNull();
      expect(wonRes.opportunity.lostAt).toBeNull();

      // 2. Reaberto
      vi.spyOn(oppRepo, "updateOpportunity").mockResolvedValueOnce({
        ...oppState,
        stagePublicId: "stage-qualif",
        status: "open",
        wonAt: null,
        lostAt: null,
        closedAt: null,
        lossReason: null,
      });

      const reopenRes = await oppService.updateOpportunity(
        "tenant-alpha",
        { opportunityPublicId: "opp-xyz", status: "open" },
        "Operador"
      );
      expect(reopenRes.opportunity.status).toBe("open");
      expect(reopenRes.opportunity.wonAt).toBeNull();
      expect(reopenRes.opportunity.closedAt).toBeNull();

      // 3. Perdido com motivo
      vi.spyOn(oppRepo, "updateOpportunity").mockResolvedValueOnce({
        ...oppState,
        stagePublicId: "stage-lost",
        status: "lost",
        lossReason: "Orçamento cancelado pelo cliente.",
        lostAt: "2026-10-19T14:00:00Z",
        closedAt: "2026-10-19T14:00:00Z",
        wonAt: null,
      });

      const lostRes = await oppService.updateOpportunity(
        "tenant-alpha",
        {
          opportunityPublicId: "opp-xyz",
          status: "lost",
          lossReason: "Orçamento cancelado pelo cliente.",
        },
        "Operador"
      );
      expect(lostRes.opportunity.status).toBe("lost");
      expect(lostRes.opportunity.lossReason).toBe("Orçamento cancelado pelo cliente.");
      expect(lostRes.opportunity.lostAt).not.toBeNull();
      expect(lostRes.opportunity.wonAt).toBeNull();
    });

    it("sanitiza erro técnico inesperado do banco sem vazar SQL ou dados internos", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      vi.spyOn(oppRepo, "createOpportunity").mockRejectedValue(
        new Error("ER_LOCK_DEADLOCK: Deadlock found when trying to get lock; try restarting transaction")
      );

      await expect(
        oppService.createOpportunity(
          "tenant-alpha",
          {
            pipelinePublicId: "pipe-1",
            stagePublicId: "stage-1",
            title: "Oportunidade Deadlock",
          },
          "Operador"
        )
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "INTERNAL_SERVER_ERROR",
          message: "Não foi possível cadastrar a oportunidade comercial.",
        })
      );

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("retorna NOT_FOUND quando oportunidade não existe ao consultar histórico ou detalhes", async () => {
      vi.spyOn(oppRepo, "getOpportunityByPublicId").mockResolvedValue(null);

      await expect(
        oppService.getOpportunityById("tenant-alpha", "opp-inexistente")
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "NOT_FOUND",
          message: "Oportunidade comercial não encontrada.",
        })
      );
    });

    it("permite registrar e listar atividades vinculadas a oportunidades", async () => {
      const mockActivity = {
        publicId: "act-1",
        opportunityPublicId: "opp-1",
        crmClientId: null,
        type: "call" as const,
        title: "Ligar para decisor",
        description: "Alinhamento sobre proposta comercial",
        dueAt: "2026-10-25T14:00:00Z",
        completedAt: null,
        status: "pending" as const,
        assignedTo: "Vendedor 1",
        createdBy: "Operador",
        createdAt: "2026-10-19T10:00:00Z",
        updatedAt: "2026-10-19T10:00:00Z",
      };

      vi.spyOn(oppRepo, "createActivity").mockResolvedValue(mockActivity);
      vi.spyOn(oppRepo, "listActivities").mockResolvedValue([mockActivity]);

      const created = await oppService.createActivity(
        "tenant-alpha",
        {
          opportunityPublicId: "opp-1",
          type: "call",
          title: "Ligar para decisor",
          description: "Alinhamento sobre proposta comercial",
        },
        "Operador"
      );
      expect(created.activity.title).toBe("Ligar para decisor");

      const list = await oppService.listActivities("tenant-alpha", {
        opportunityPublicId: "opp-1",
      });
      expect(list.activities).toHaveLength(1);
      expect(list.activities[0].type).toBe("call");
    });

    it("repassa todos os filtros canônicos (busca, responsável, período) para cálculo das métricas", async () => {
      const mockMetrics = {
        openCount: 5,
        openValueCents: 500000,
        wonCount: 3,
        wonValueCents: 300000,
        lostCount: 2,
        lostValueCents: 200000,
        totalCount: 10,
        totalValueCents: 1000000,
      };

      const metricsSpy = vi.spyOn(oppRepo, "getOpportunityMetrics").mockResolvedValue(mockMetrics);

      const filter = {
        pipelinePublicId: "pipe-1",
        internalResponsible: "Vendedora Clara",
        search: "Projeto",
        dateFrom: "2026-10-01",
        dateTo: "2026-10-31",
      };

      const result = await oppService.getOpportunityMetrics("tenant-alpha", filter);

      expect(metricsSpy).toHaveBeenCalledWith("tenant-alpha", filter);
      expect(result.totalCount).toBe(10);
      expect(result.totalValueCents).toBe(1000000);
    });

    it("permite marcar como perdida através de transição de estágio com status e motivo explícitos", async () => {
      const oppState = {
        publicId: "opp-custom-lost",
        pipelinePublicId: "pipe-1",
        stagePublicId: "stage-cancelado",
        crmClientId: null,
        title: "Projeto Customizado",
        valueCents: 50000,
        currency: "BRL",
        expectedCloseDate: null,
        status: "lost" as const,
        lossReason: "Orçamento estourado pelo concorrente.",
        internalResponsible: "Consultor",
        observations: null,
        wonAt: null,
        lostAt: "2026-10-19T15:00:00Z",
        closedAt: "2026-10-19T15:00:00Z",
        createdAt: "2026-10-19T10:00:00Z",
        updatedAt: "2026-10-19T15:00:00Z",
      };

      const transitionSpy = vi.spyOn(oppRepo, "transitionStage").mockResolvedValue(oppState);

      const res = await oppService.transitionStage(
        "tenant-alpha",
        {
          opportunityPublicId: "opp-custom-lost",
          toStagePublicId: "stage-cancelado",
          status: "lost",
          lossReason: "Orçamento estourado pelo concorrente.",
        },
        "Operador"
      );

      expect(transitionSpy).toHaveBeenCalledWith(
        "tenant-alpha",
        {
          opportunityPublicId: "opp-custom-lost",
          toStagePublicId: "stage-cancelado",
          status: "lost",
          lossReason: "Orçamento estourado pelo concorrente.",
        },
        "Operador"
      );
      expect(res.opportunity.status).toBe("lost");
      expect(res.opportunity.lossReason).toBe("Orçamento estourado pelo concorrente.");
    });

    it("valida no contrato de entrada que 'lost' exige motivo e que 'won'/'open' rejeitam motivo de perda", async () => {
      const { opportunityStageTransitionInput, opportunityUpdateInput } = await import(
        "./modules/crm/opportunities/contracts"
      );

      const validOppId = "c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c";
      const validStageId = "d2e3f4a5-b6c7-4d8e-9f0a-1b2c3d4e5f6a";

      // 1. Transição para 'lost' sem motivo deve falhar
      const missingReasonResult = opportunityStageTransitionInput.safeParse({
        opportunityPublicId: validOppId,
        toStagePublicId: validStageId,
        status: "lost",
        lossReason: "  ",
      });
      expect(missingReasonResult.success).toBe(false);
      if (!missingReasonResult.success) {
        expect(missingReasonResult.error.issues[0].message).toContain("Motivo de perda é obrigatório");
      }

      // 2. Transição para 'won' com motivo de perda deve falhar
      const wonWithReasonResult = opportunityStageTransitionInput.safeParse({
        opportunityPublicId: validOppId,
        toStagePublicId: validStageId,
        status: "won",
        lossReason: "Motivo indevido",
      });
      expect(wonWithReasonResult.success).toBe(false);
      if (!wonWithReasonResult.success) {
        expect(wonWithReasonResult.error.issues[0].message).toContain("não pode ser informado para oportunidades ganhas ou abertas");
      }

      // 3. Atualização para 'open' com motivo de perda deve falhar
      const openWithReasonResult = opportunityUpdateInput.safeParse({
        opportunityPublicId: validOppId,
        status: "open",
        lossReason: "Motivo indevido",
      });
      expect(openWithReasonResult.success).toBe(false);

      // 4. Transição de estágio pura sem status (manter/reabrir aberto) deve ter sucesso
      const stageOnlyResult = opportunityStageTransitionInput.safeParse({
        opportunityPublicId: validOppId,
        toStagePublicId: validStageId,
      });
      expect(stageOnlyResult.success).toBe(true);
    });
  });
});
