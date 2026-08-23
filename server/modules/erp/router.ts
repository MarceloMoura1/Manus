import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { megadeskProcedure, router } from "../../_core/trpc";
import { productInput, productListInput, productPublicId, stockListInput, stockMovementInput } from "./contracts";
import { ErpDomainError } from "./errors";
import { ErpService } from "./service";

const service = new ErpService();
type ErpContext = { tenantId: string; operationalUserId: string; operationalUserRole: "admin" | "manager" | "agent" | "viewer" };
const identity = (ctx: ErpContext) => ({ clientId: ctx.tenantId, userId: ctx.operationalUserId, role: ctx.operationalUserRole });
function translate(error: unknown): never {
  if (!(error instanceof ErpDomainError)) throw error;
  const code = error.code === "NOT_FOUND" ? "NOT_FOUND" : error.code === "FORBIDDEN" ? "FORBIDDEN" : error.code === "CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT" || error.code === "ALREADY_REVERSED" ? "CONFLICT" : "BAD_REQUEST";
  throw new TRPCError({ code, message: error.message });
}
async function run<T>(operation: () => Promise<T>): Promise<T> { try { return await operation(); } catch (error) { return translate(error); } }

export const erpRouter = router({
  summary: megadeskProcedure.query(({ ctx }) => run(() => service.summary(identity(ctx)))),
  products: router({
    list: megadeskProcedure.input(productListInput).query(({ input, ctx }) => run(() => service.listProducts(identity(ctx), input))),
    detail: megadeskProcedure.input(z.object({ publicId: productPublicId })).query(({ input, ctx }) => run(() => service.getProduct(identity(ctx), input.publicId))),
    create: megadeskProcedure.input(productInput).mutation(({ input, ctx }) => run(() => service.createProduct(identity(ctx), input))),
    update: megadeskProcedure.input(productInput.extend({ publicId: productPublicId })).mutation(({ input, ctx }) => { const { publicId, ...command } = input; return run(() => service.updateProduct(identity(ctx), publicId, command)); }),
    setActive: megadeskProcedure.input(z.object({ publicId: productPublicId, active: z.boolean() })).mutation(({ input, ctx }) => run(() => service.setProductActive(identity(ctx), input.publicId, input.active))),
  }),
  stock: router({
    list: megadeskProcedure.input(stockListInput).query(({ input, ctx }) => run(() => service.listMovements(identity(ctx), input))),
    move: megadeskProcedure.input(stockMovementInput).mutation(({ input, ctx }) => run(() => service.moveStock(identity(ctx), input))),
    reverse: megadeskProcedure.input(z.object({ movementPublicId: z.string().uuid(), reason: z.string().trim().min(3).max(500), idempotencyKey: z.string().uuid() })).mutation(({ input, ctx }) => run(() => service.reverseMovement(identity(ctx), input.movementPublicId, input.reason, input.idempotencyKey))),
  }),
});
