import { z } from "zod";
import { router, megadeskProcedure } from "../../../_core/trpc";
import { requireCrmLeadAccess } from "../../../crm-access";
import {
  leadListInputSchema,
  leadCreateInputSchema,
  leadUpdateInputSchema,
  leadConvertInputSchema,
} from "./contracts";
import * as service from "./service";

function actorName(ctx: { userName?: string; userEmail?: string }): string {
  return ctx.userName?.trim() || ctx.userEmail?.trim() || "Operador";
}

export const leadsRouter = router({
  list: megadeskProcedure
    .input(leadListInputSchema)
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmLeadAccess(ctx);
      return service.listLeads(tenantId, input);
    }),

  getById: megadeskProcedure
    .input(z.object({ crmClientId: z.string().min(1) }).strict())
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmLeadAccess(ctx);
      const lead = await service.getLeadById(tenantId, input.crmClientId);
      return { lead };
    }),

  create: megadeskProcedure
    .input(leadCreateInputSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmLeadAccess(ctx);
      const actor = actorName(ctx);
      return service.createLead(tenantId, input, actor);
    }),

  update: megadeskProcedure
    .input(leadUpdateInputSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmLeadAccess(ctx);
      const actor = actorName(ctx);
      return service.updateLead(tenantId, input, actor);
    }),

  convert: megadeskProcedure
    .input(leadConvertInputSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmLeadAccess(ctx);
      const actor = actorName(ctx);
      return service.convertLeadToClient(tenantId, input, actor);
    }),

  timeline: megadeskProcedure
    .input(z.object({ crmClientId: z.string().min(1) }).strict())
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmLeadAccess(ctx);
      const entries = await service.getLeadTimeline(tenantId, input.crmClientId);
      return { entries };
    }),

  addNote: megadeskProcedure
    .input(z.object({ crmClientId: z.string().min(1), note: z.string().min(1) }).strict())
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmLeadAccess(ctx);
      const actor = actorName(ctx);
      return service.addLeadTimelineNote(tenantId, input.crmClientId, input.note, actor);
    }),
});
