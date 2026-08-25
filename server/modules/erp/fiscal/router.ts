import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { megadeskProcedure, router } from "../../../_core/trpc";
import { ErpDomainError, erpTrpcCode } from "../errors";
import {
  cancelInput,
  fiscalListInput,
  fiscalSettingsInput,
  manualDocumentInput,
  productFiscalProfileInput,
  readyInput,
  sourceDocumentInput,
  updateDraftInput,
} from "./contracts";
import { FiscalService } from "./service";
const service = new FiscalService();
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
async function run<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ErpDomainError)
      throw new TRPCError({ code: erpTrpcCode(e), message: e.message });
    throw e;
  }
}
const id = z.object({ publicId: z.string().uuid() });
export const fiscalRouter = router({
  summary: megadeskProcedure.query(({ ctx }) =>
    run(() => service.summary(identity(ctx)))
  ),
  settings: router({
    get: megadeskProcedure.query(({ ctx }) =>
      run(() => service.settings(identity(ctx)))
    ),
    save: megadeskProcedure
      .input(fiscalSettingsInput)
      .mutation(({ ctx, input }) =>
        run(() => service.saveSettings(identity(ctx), input))
      ),
  }),
  products: router({
    list: megadeskProcedure
      .input(
        z.object({
          search: z.string().trim().max(180).default(""),
          incomplete: z.boolean().optional(),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(20),
        })
      )
      .query(({ ctx, input }) =>
        run(() => service.products(identity(ctx), input))
      ),
    save: megadeskProcedure
      .input(productFiscalProfileInput)
      .mutation(({ ctx, input }) =>
        run(() => service.saveProduct(identity(ctx), input))
      ),
  }),
  documents: router({
    list: megadeskProcedure
      .input(fiscalListInput)
      .query(({ ctx, input }) => run(() => service.list(identity(ctx), input))),
    detail: megadeskProcedure
      .input(id)
      .query(({ ctx, input }) =>
        run(() => service.detail(identity(ctx), input.publicId))
      ),
    createSource: megadeskProcedure
      .input(sourceDocumentInput)
      .mutation(({ ctx, input }) =>
        run(() => service.createSource(identity(ctx), input))
      ),
    createManual: megadeskProcedure
      .input(manualDocumentInput)
      .mutation(({ ctx, input }) =>
        run(() => service.createManual(identity(ctx), input))
      ),
    update: megadeskProcedure
      .input(updateDraftInput)
      .mutation(({ ctx, input }) =>
        run(() => service.updateDraft(identity(ctx), input))
      ),
    ready: megadeskProcedure
      .input(readyInput)
      .mutation(({ ctx, input }) =>
        run(() =>
          service.ready(identity(ctx), input.publicId, input.idempotencyKey)
        )
      ),
    cancel: megadeskProcedure
      .input(cancelInput)
      .mutation(({ ctx, input }) =>
        run(() => service.cancel(identity(ctx), input.publicId, input.reason))
      ),
  }),
});
