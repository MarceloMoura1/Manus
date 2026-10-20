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
  activityDeleteInput,
  activityListInput,
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
    .input(activityListInput.optional())
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

  deleteActivity: megadeskProcedure
    .input(activityDeleteInput)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      return service.deleteActivity(tenantId, input.activityPublicId);
    }),

  radar: megadeskProcedure.query(async ({ ctx }) => {
    const tenantId = requireCrmOpportunityAccess(ctx);
    const pool = (await import("../../../db")).getPool();

    // 1. Stalled deals (abertos sem atualização há 7+ dias)
    const [stalledRows] = await pool.query<any[]>(
      `SELECT o.public_id, o.title, o.value_cents, c.company_name, s.name as stage_name,
              DATEDIFF(NOW(), o.updated_at) as days_stalled, o.internal_responsible, o.crm_client_id
       FROM megadesk_crm_opportunities o
       INNER JOIN megadesk_crm_stages s ON s.client_id = o.client_id AND s.id = o.stage_id
       LEFT JOIN megadesk_crm_clients c ON c.client_id = o.client_id AND c.crm_client_id = o.crm_client_id
       WHERE o.client_id = ? AND o.status = 'open' AND DATEDIFF(NOW(), o.updated_at) >= 7
       ORDER BY days_stalled DESC LIMIT 20`,
      [tenantId]
    );

    // 2. Overdue activities
    const [overdueRows] = await pool.query<any[]>(
      `SELECT a.public_id, a.title, a.type, a.due_at,
              DATEDIFF(NOW(), a.due_at) as days_overdue, a.assigned_to,
              c.company_name, o.title as opportunity_title, a.crm_client_id, o.public_id as opportunity_public_id
       FROM megadesk_crm_activities a
       LEFT JOIN megadesk_crm_opportunities o ON o.client_id = a.client_id AND o.id = a.opportunity_id
       LEFT JOIN megadesk_crm_clients c ON c.client_id = a.client_id AND c.crm_client_id = a.crm_client_id
       WHERE a.client_id = ? AND a.status = 'pending' AND a.due_at < NOW()
       ORDER BY a.due_at ASC LIMIT 20`,
      [tenantId]
    );

    // 3. Deals without next step
    const [noStepRows] = await pool.query<any[]>(
      `SELECT o.public_id, o.title, o.value_cents, c.company_name, s.name as stage_name, o.crm_client_id
       FROM megadesk_crm_opportunities o
       INNER JOIN megadesk_crm_stages s ON s.client_id = o.client_id AND s.id = o.stage_id
       LEFT JOIN megadesk_crm_clients c ON c.client_id = o.client_id AND c.crm_client_id = o.crm_client_id
       WHERE o.client_id = ? AND o.status = 'open'
         AND NOT EXISTS (
           SELECT 1 FROM megadesk_crm_activities a
           WHERE a.client_id = o.client_id AND a.opportunity_id = o.id AND a.status = 'pending'
         )
       ORDER BY o.updated_at ASC LIMIT 20`,
      [tenantId]
    );

    const stalledDeals = stalledRows.map(r => ({
      publicId: r.public_id,
      title: r.title,
      valueCents: Number(r.value_cents || 0),
      companyName: r.company_name || null,
      stageName: r.stage_name,
      daysStalled: Number(r.days_stalled || 0),
      internalResponsible: r.internal_responsible || "",
      crmClientId: r.crm_client_id || null,
    }));

    const overdueActivities = overdueRows.map(r => ({
      publicId: r.public_id,
      title: r.title,
      type: r.type,
      dueAt: r.due_at ? new Date(r.due_at).toISOString() : "",
      daysOverdue: Number(r.days_overdue || 0),
      assignedTo: r.assigned_to || "",
      companyName: r.company_name || null,
      opportunityTitle: r.opportunity_title || null,
      opportunityPublicId: r.opportunity_public_id || null,
      crmClientId: r.crm_client_id || null,
    }));

    const dealsWithoutNextStep = noStepRows.map(r => ({
      publicId: r.public_id,
      title: r.title,
      valueCents: Number(r.value_cents || 0),
      companyName: r.company_name || null,
      stageName: r.stage_name,
      crmClientId: r.crm_client_id || null,
    }));

    const totalAtRisk = stalledDeals.length + overdueActivities.length + dealsWithoutNextStep.length;

    return {
      stalledDeals,
      overdueActivities,
      dealsWithoutNextStep,
      totalAtRisk,
    };
  }),
});
