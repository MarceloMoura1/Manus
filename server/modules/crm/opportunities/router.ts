import { z } from "zod";
import { router, megadeskProcedure } from "../../../_core/trpc";
import { requireCrmOpportunityAccess } from "../../../crm-access";
import {
  opportunityPublicIdSchema,
  opportunityCreateInput,
  opportunityUpdateInput,
  opportunityStageTransitionInput,
  opportunityListInput,
  opportunityMetricsFilterInput,
  activityCreateInput,
  activityUpdateInput,
} from "./contracts";
import * as service from "./service";

function actorName(ctx: { userName?: string; userEmail?: string }): string {
  return ctx.userName?.trim() || ctx.userEmail?.trim() || "Operador";
}

export const opportunitiesRouter = router({
  list: megadeskProcedure
    .input(opportunityListInput)
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      return service.listOpportunities(tenantId, input);
    }),

  metrics: megadeskProcedure
    .input(opportunityMetricsFilterInput.optional())
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      return service.getOpportunityMetrics(tenantId, input);
    }),

  getById: megadeskProcedure
    .input(z.object({ opportunityPublicId: opportunityPublicIdSchema }).strict())
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      return service.getOpportunityById(tenantId, input.opportunityPublicId);
    }),

  create: megadeskProcedure
    .input(opportunityCreateInput)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const actor = actorName(ctx);
      return service.createOpportunity(tenantId, input, actor);
    }),

  update: megadeskProcedure
    .input(opportunityUpdateInput)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const actor = actorName(ctx);
      return service.updateOpportunity(tenantId, input, actor);
    }),

  transitionStage: megadeskProcedure
    .input(opportunityStageTransitionInput)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const actor = actorName(ctx);
      return service.transitionStage(tenantId, input, actor);
    }),

  history: megadeskProcedure
    .input(z.object({ opportunityPublicId: opportunityPublicIdSchema }).strict())
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      return service.listOpportunityHistory(tenantId, input.opportunityPublicId);
    }),

  createActivity: megadeskProcedure
    .input(activityCreateInput)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const actor = actorName(ctx);
      return service.createActivity(tenantId, input, actor);
    }),

  listActivities: megadeskProcedure
    .input(
      z
        .object({
          opportunityPublicId: z.string().uuid().optional(),
          crmClientId: z.string().optional(),
          status: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      return service.listActivities(tenantId, input || {});
    }),

  updateActivity: megadeskProcedure
    .input(activityUpdateInput)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      return service.updateActivity(tenantId, input);
    }),
});
