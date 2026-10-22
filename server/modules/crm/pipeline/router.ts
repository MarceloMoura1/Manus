import { z } from "zod";
import { router, megadeskProcedure } from "../../../_core/trpc";
import {
  requireCrmOpportunityAccess,
  requireCrmPipelineAdminAccess,
} from "../../../crm-access";
import {
  pipelinePublicIdSchema,
  pipelineCreateInput,
  pipelineUpdateInput,
  stageCreateInput,
  stageUpdateInput,
} from "./contracts";
import * as service from "./service";

export const pipelinesRouter = router({
  list: megadeskProcedure.query(async ({ ctx }) => {
    const tenantId = requireCrmOpportunityAccess(ctx);
    return service.listPipelines(tenantId);
  }),

  getDefault: megadeskProcedure.query(async ({ ctx }) => {
    const tenantId = requireCrmOpportunityAccess(ctx);
    return service.getDefaultPipeline(tenantId);
  }),

  getById: megadeskProcedure
    .input(z.object({ pipelinePublicId: pipelinePublicIdSchema }).strict())
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      return service.getPipelineById(tenantId, input.pipelinePublicId);
    }),

  create: megadeskProcedure
    .input(pipelineCreateInput)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmPipelineAdminAccess(ctx);
      return service.createPipeline(tenantId, input);
    }),

  update: megadeskProcedure
    .input(pipelineUpdateInput)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmPipelineAdminAccess(ctx);
      return service.updatePipeline(tenantId, input);
    }),

  createStage: megadeskProcedure
    .input(stageCreateInput)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmPipelineAdminAccess(ctx);
      return service.createStage(tenantId, input);
    }),

  updateStage: megadeskProcedure
    .input(stageUpdateInput)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmPipelineAdminAccess(ctx);
      return service.updateStage(tenantId, input);
    }),
});
