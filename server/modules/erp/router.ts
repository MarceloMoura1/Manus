import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { megadeskProcedure, router } from "../../_core/trpc";
import { productInput, productListInput, productPublicId, stockListInput, stockMovementInput } from "./contracts";
import { ErpDomainError, erpTrpcCode } from "./errors";
import { ErpService } from "./service";
import { suppliersRouter } from "./suppliers/router";
import { purchasesRouter } from "./purchases/router";
import { salesRouter } from "./sales/router";
import { financeRouter } from "./finance/router";
import { fiscalRouter } from "./fiscal/router";
import { reportsRouter } from "./reports/router";

const service = new ErpService();
type ErpContext = { tenantId: string; operationalUserId: string; operationalUserRole: "admin" | "manager" | "agent" | "viewer" };
const identity = (ctx: ErpContext) => ({ clientId: ctx.tenantId, userId: ctx.operationalUserId, role: ctx.operationalUserRole });
export function translateErpError(error: unknown): never {
  if (!(error instanceof ErpDomainError)) throw error;
  throw new TRPCError({ code: erpTrpcCode(error), message: error.message });
}
export async function runErp<T>(operation: () => Promise<T>): Promise<T> { try { return await operation(); } catch (error) { return translateErpError(error); } }

export const erpRouter = router({
  summary: megadeskProcedure.query(({ ctx }) => runErp(() => service.summary(identity(ctx)))),
  suppliers: suppliersRouter,
  purchases: purchasesRouter,
  sales: salesRouter,
  finance: financeRouter,
  fiscal: fiscalRouter,
  reports: reportsRouter,
  products: router({
    list: megadeskProcedure.input(productListInput).query(({ input, ctx }) => runErp(() => service.listProducts(identity(ctx), input))),
    detail: megadeskProcedure.input(z.object({ publicId: productPublicId })).query(({ input, ctx }) => runErp(() => service.getProduct(identity(ctx), input.publicId))),
    create: megadeskProcedure.input(productInput).mutation(({ input, ctx }) => runErp(() => service.createProduct(identity(ctx), input))),
    update: megadeskProcedure.input(productInput.extend({ publicId: productPublicId })).mutation(({ input, ctx }) => { const { publicId, ...command } = input; return runErp(() => service.updateProduct(identity(ctx), publicId, command)); }),
    setActive: megadeskProcedure.input(z.object({ publicId: productPublicId, active: z.boolean() })).mutation(({ input, ctx }) => runErp(() => service.setProductActive(identity(ctx), input.publicId, input.active))),
  }),
  stock: router({
    list: megadeskProcedure.input(stockListInput).query(({ input, ctx }) => runErp(() => service.listMovements(identity(ctx), input))),
    move: megadeskProcedure.input(stockMovementInput).mutation(({ input, ctx }) => runErp(() => service.moveStock(identity(ctx), input))),
    reverse: megadeskProcedure.input(z.object({ movementPublicId: z.string().uuid(), reason: z.string().trim().min(3).max(500), idempotencyKey: z.string().uuid() })).mutation(({ input, ctx }) => runErp(() => service.reverseMovement(identity(ctx), input.movementPublicId, input.reason, input.idempotencyKey))),
  }),
});
