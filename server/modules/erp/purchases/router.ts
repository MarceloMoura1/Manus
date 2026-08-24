import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { megadeskProcedure, router } from "../../../_core/trpc";
import { ErpDomainError, erpTrpcCode } from "../errors";
import {
  cancellationInput,
  purchaseDraftInput,
  purchaseListInput,
  receiveInput,
} from "./contracts";
import { PurchaseService } from "./service";
const service = new PurchaseService();
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
export const purchasesRouter = router({
  list: megadeskProcedure
    .input(purchaseListInput)
    .query(({ ctx, input }) => run(() => service.list(identity(ctx), input))),
  detail: megadeskProcedure
    .input(id)
    .query(({ ctx, input }) =>
      run(() => service.detail(identity(ctx), input.publicId))
    ),
  create: megadeskProcedure
    .input(purchaseDraftInput)
    .mutation(({ ctx, input }) =>
      run(() => service.create(identity(ctx), input))
    ),
  update: megadeskProcedure
    .input(purchaseDraftInput.and(id))
    .mutation(({ ctx, input }) => {
      const { publicId, ...draft } = input;
      return run(() => service.update(identity(ctx), publicId, draft));
    }),
  approve: megadeskProcedure
    .input(id)
    .mutation(({ ctx, input }) =>
      run(() => service.approve(identity(ctx), input.publicId))
    ),
  cancel: megadeskProcedure
    .input(cancellationInput)
    .mutation(({ ctx, input }) =>
      run(() => service.cancel(identity(ctx), input.publicId, input.reason))
    ),
  receive: megadeskProcedure
    .input(receiveInput)
    .mutation(({ ctx, input }) =>
      run(() =>
        service.receive(identity(ctx), input.publicId, input.idempotencyKey)
      )
    ),
});
