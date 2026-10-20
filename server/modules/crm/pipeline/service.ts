import { TRPCError } from "@trpc/server";
import type {
  PipelineCreateInput,
  PipelineUpdateInput,
  StageCreateInput,
  StageUpdateInput,
  PipelineView,
  StageView,
} from "./contracts";
import * as repository from "./repository";

export async function listPipelines(clientId: string): Promise<{ pipelines: PipelineView[] }> {
  try {
    const pipelines = await repository.listPipelines(clientId);
    return { pipelines };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[CRM Pipelines] Erro ao listar funis:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Falha ao consultar funis de venda.",
    });
  }
}

export async function getDefaultPipeline(clientId: string): Promise<{ pipeline: PipelineView }> {
  try {
    const pipeline = await repository.ensureDefaultPipeline(clientId);
    return { pipeline };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[CRM Pipelines] Erro ao obter funil padrão:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Falha ao obter configuração padrão do funil.",
    });
  }
}

export async function getPipelineById(
  clientId: string,
  pipelinePublicId: string
): Promise<{ pipeline: PipelineView }> {
  try {
    const pipeline = await repository.getPipelineByPublicId(clientId, pipelinePublicId);
    if (!pipeline) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Funil de vendas não encontrado.",
      });
    }
    return { pipeline };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[CRM Pipelines] Erro ao buscar funil por id:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Falha ao carregar dados do funil.",
    });
  }
}

export async function createPipeline(
  clientId: string,
  input: PipelineCreateInput
): Promise<{ pipeline: PipelineView }> {
  try {
    const pipeline = await repository.createPipeline(clientId, input);
    return { pipeline };
  } catch (error: any) {
    if (error instanceof TRPCError) throw error;
    if (error.code === "ER_DUP_ENTRY") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Já existe um funil padrão ou com esta configuração para este tenant.",
      });
    }
    console.error("[CRM Pipelines] Erro ao criar funil:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível criar o funil de vendas.",
    });
  }
}

export async function updatePipeline(
  clientId: string,
  input: PipelineUpdateInput
): Promise<{ pipeline: PipelineView }> {
  try {
    const pipeline = await repository.updatePipeline(clientId, input);
    return { pipeline };
  } catch (error: any) {
    if (error instanceof TRPCError) throw error;
    if (error.message?.includes("não encontrado")) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: error.message,
      });
    }
    console.error("[CRM Pipelines] Erro ao atualizar funil:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível atualizar o funil de vendas.",
    });
  }
}

export async function createStage(
  clientId: string,
  input: StageCreateInput
): Promise<{ stage: StageView }> {
  try {
    const stage = await repository.createStage(clientId, input);
    return { stage };
  } catch (error: any) {
    if (error instanceof TRPCError) throw error;
    if (error.message?.includes("não encontrado")) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: error.message,
      });
    }
    console.error("[CRM Pipelines] Erro ao criar estágio:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível adicionar o estágio ao funil.",
    });
  }
}

export async function updateStage(
  clientId: string,
  input: StageUpdateInput
): Promise<{ stage: StageView }> {
  try {
    const stage = await repository.updateStage(clientId, input);
    return { stage };
  } catch (error: any) {
    if (error instanceof TRPCError) throw error;
    if (error.message?.includes("não encontrado")) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: error.message,
      });
    }
    console.error("[CRM Pipelines] Erro ao atualizar estágio:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível atualizar o estágio do funil.",
    });
  }
}
