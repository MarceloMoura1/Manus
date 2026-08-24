import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { megadeskProcedure, router } from "../../../_core/trpc";
import { ErpDomainError, erpTrpcCode } from "../errors";
import {
  cancellationInput,
  saleDraftInput,
  saleListInput,
  fulfillInput,
} from "./contracts";
import { SaleService } from "./service";
const service = new SaleService();
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
export const salesRouter = router({
  options: megadeskProcedure.query(({ ctx }) =>
    run(() => service.options(identity(ctx)))
  ),
  list: megadeskProcedure
    .input(saleListInput)
    .query(({ ctx, input }) => run(() => service.list(identity(ctx), input))),
  detail: megadeskProcedure
    .input(id)
    .query(({ ctx, input }) =>
      run(() => service.detail(identity(ctx), input.publicId))
    ),
  create: megadeskProcedure
    .input(saleDraftInput)
    .mutation(({ ctx, input }) =>
      run(() => service.create(identity(ctx), input))
    ),
  update: megadeskProcedure
    .input(saleDraftInput.and(id))
    .mutation(({ ctx, input }) => {
      const { publicId, ...draft } = input;
      return run(() => service.update(identity(ctx), publicId, draft));
    }),
  confirm: megadeskProcedure
    .input(id)
    .mutation(({ ctx, input }) =>
      run(() => service.confirm(identity(ctx), input.publicId))
    ),
  cancel: megadeskProcedure
    .input(cancellationInput)
    .mutation(({ ctx, input }) =>
      run(() => service.cancel(identity(ctx), input.publicId, input.reason))
    ),
  fulfill: megadeskProcedure
    .input(fulfillInput)
    .mutation(({ ctx, input }) =>
      run(() =>
        service.fulfill(identity(ctx), input.publicId, input.idempotencyKey)
      )
    ),
});
