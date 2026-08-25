import { TRPCError } from "@trpc/server";
import { megadeskProcedure, router } from "../../../_core/trpc";
import { ErpDomainError, erpTrpcCode } from "../errors";
import { exportRequestInput, reportRequestInput } from "./contracts";
import { ReportsService } from "./service";
const service = new ReportsService();
type Context = {
  tenantId: string;
  operationalUserId: string;
  operationalUserRole: "admin" | "manager" | "agent" | "viewer";
};
const identity = (ctx: Context) => ({
  clientId: ctx.tenantId,
  userId: ctx.operationalUserId,
  role: ctx.operationalUserRole,
});
const run = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ErpDomainError)
      throw new TRPCError({ code: erpTrpcCode(e), message: e.message });
    throw e;
  }
};
export const reportsRouter = router({
  report: megadeskProcedure
    .input(reportRequestInput)
    .query(({ ctx, input }) => run(() => service.report(identity(ctx), input))),
  exportCsv: megadeskProcedure
    .input(exportRequestInput)
    .mutation(({ ctx, input }) =>
      run(() => service.exportCsv(identity(ctx), input))
    ),
});
