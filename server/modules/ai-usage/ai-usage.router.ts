import { router, megadeskAdminProcedure } from "../../_core/trpc";
import { getAiTokenUsageSummary } from "./ai-usage.service";
import { TRPCError } from "@trpc/server";

export const aiUsageRouter = router({
  getSummary: megadeskAdminProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Identificação do tenant não informada.",
      });
    }
    return await getAiTokenUsageSummary(tenantId);
  }),
});

