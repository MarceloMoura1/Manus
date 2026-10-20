import { TRPCError } from "@trpc/server";
import type {
  OpportunityCreateInput,
  OpportunityUpdateInput,
  OpportunityStageTransitionInput,
  OpportunityListInput,
  OpportunityMetricsFilterInput,
  ActivityCreateInput,
  ActivityUpdateInput,
  OpportunityView,
  ActivityView,
  OpportunityHistoryView,
} from "./contracts";
import * as repository from "./repository";

export async function listOpportunities(
  clientId: string,
  input: OpportunityListInput
): Promise<{
  opportunities: OpportunityView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  try {
    return await repository.listOpportunities(clientId, input);
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[CRM Opportunities] Erro ao listar oportunidades:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Falha ao consultar oportunidades comerciais.",
    });
  }
}

export async function getOpportunityMetrics(
  clientId: string,
  filter?: OpportunityMetricsFilterInput
) {
  try {
    return await repository.getOpportunityMetrics(clientId, filter);
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[CRM Opportunities] Erro ao calcular métricas:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Falha ao calcular indicadores do funil.",
    });
  }
}

export async function getOpportunityById(
  clientId: string,
  opportunityPublicId: string
): Promise<{ opportunity: OpportunityView }> {
  try {
    const opportunity = await repository.getOpportunityByPublicId(
      clientId,
      opportunityPublicId
    );
    if (!opportunity) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Oportunidade comercial não encontrada.",
      });
    }
    return { opportunity };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[CRM Opportunities] Erro ao buscar oportunidade por id:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Falha ao carregar dados da oportunidade.",
    });
  }
}

export async function createOpportunity(
  clientId: string,
  input: OpportunityCreateInput,
  actor: string
): Promise<{ opportunity: OpportunityView }> {
  try {
    const opportunity = await repository.createOpportunity(clientId, input, actor);
    return { opportunity };
  } catch (error: any) {
    if (error instanceof TRPCError) throw error;
    const msg = error.message || "";
    if (msg.includes("não encontrado") || msg.includes("não encontrada")) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: msg,
      });
    }
    if (error.code === "ER_DUP_ENTRY") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Oportunidade já cadastrada com este identificador.",
      });
    }
    console.error("[CRM Opportunities] Erro ao criar oportunidade:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível cadastrar a oportunidade comercial.",
    });
  }
}

export async function transitionStage(
  clientId: string,
  input: OpportunityStageTransitionInput,
  actor: string
): Promise<{ opportunity: OpportunityView }> {
  try {
    const opportunity = await repository.transitionStage(clientId, input, actor);
    return { opportunity };
  } catch (error: any) {
    if (error instanceof TRPCError) throw error;
    const msg = error.message || "";
    if (msg.includes("não encontrada") || msg.includes("não encontrado")) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: msg,
      });
    }
    if (msg.includes("não pertence ao funil")) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: msg,
      });
    }
    console.error("[CRM Opportunities] Erro na transição de estágio:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Falha ao mover oportunidade de estágio.",
    });
  }
}

export async function updateOpportunity(
  clientId: string,
  input: OpportunityUpdateInput,
  actor: string
): Promise<{ opportunity: OpportunityView }> {
  try {
    const opportunity = await repository.updateOpportunity(clientId, input, actor);
    return { opportunity };
  } catch (error: any) {
    if (error instanceof TRPCError) throw error;
    const msg = error.message || "";
    if (msg.includes("não encontrada") || msg.includes("não encontrado")) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: msg,
      });
    }
    if (msg.includes("não pertence ao funil")) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: msg,
      });
    }
    console.error("[CRM Opportunities] Erro ao atualizar oportunidade:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível atualizar os dados da oportunidade.",
    });
  }
}

export async function listOpportunityHistory(
  clientId: string,
  opportunityPublicId: string
): Promise<{ history: OpportunityHistoryView[] }> {
  try {
    const history = await repository.listOpportunityHistory(
      clientId,
      opportunityPublicId
    );
    return { history };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[CRM Opportunities] Erro ao consultar histórico:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Falha ao carregar histórico da oportunidade.",
    });
  }
}

export async function createActivity(
  clientId: string,
  input: ActivityCreateInput,
  actor: string
): Promise<{ activity: ActivityView }> {
  try {
    const activity = await repository.createActivity(clientId, input, actor);
    return { activity };
  } catch (error: any) {
    if (error instanceof TRPCError) throw error;
    const msg = error.message || "";
    if (msg.includes("não encontrada") || msg.includes("não encontrado")) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: msg,
      });
    }
    console.error("[CRM Opportunities] Erro ao criar atividade:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível registrar a atividade comercial.",
    });
  }
}

export async function listActivities(
  clientId: string,
  filter: { opportunityPublicId?: string; crmClientId?: string; status?: string }
): Promise<{ activities: ActivityView[] }> {
  try {
    const activities = await repository.listActivities(clientId, filter);
    return { activities };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[CRM Opportunities] Erro ao listar atividades:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Falha ao carregar atividades comerciais.",
    });
  }
}

export async function updateActivity(
  clientId: string,
  input: ActivityUpdateInput
): Promise<{ activity: ActivityView }> {
  try {
    const activity = await repository.updateActivity(clientId, input);
    return { activity };
  } catch (error: any) {
    if (error instanceof TRPCError) throw error;
    const msg = error.message || "";
    if (msg.includes("não encontrada")) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: msg,
      });
    }
    console.error("[CRM Opportunities] Erro ao atualizar atividade:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível atualizar a atividade.",
    });
  }
}
