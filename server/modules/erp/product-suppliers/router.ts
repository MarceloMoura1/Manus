import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { megadeskProcedure, router } from "../../../_core/trpc";
import { ErpDomainError, erpTrpcCode } from "../errors";
import {
  productSupplierInput,
  productSupplierListInput,
  productSupplierPublicId,
  productSupplierSetPreferredInput,
  productSupplierUpdateInput,
} from "./contracts";
import { ProductSupplierService } from "./service";

const service = new ProductSupplierService();

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

async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ErpDomainError) {
      throw new TRPCError({
        code: erpTrpcCode(error),
        message: error.message,
      });
    }
    throw error;
  }
}

export const productSuppliersRouter = router({
  list: megadeskProcedure
    .input(productSupplierListInput)
    .query(({ input, ctx }) => run(() => service.list(identity(ctx), input))),

  detail: megadeskProcedure
    .input(z.object({ publicId: productSupplierPublicId }))
    .query(({ input, ctx }) =>
      run(() => service.detail(identity(ctx), input.publicId))
    ),

  create: megadeskProcedure
    .input(productSupplierInput)
    .mutation(({ input, ctx }) =>
      run(() => service.create(identity(ctx), input))
    ),

  update: megadeskProcedure
    .input(
      productSupplierUpdateInput.extend({
        publicId: productSupplierPublicId,
      })
    )
    .mutation(({ input, ctx }) => {
      const { publicId, ...command } = input;
      return run(() => service.update(identity(ctx), publicId, command));
    }),

  setPreferred: megadeskProcedure
    .input(productSupplierSetPreferredInput)
    .mutation(({ input, ctx }) =>
      run(() =>
        service.setPreferred(identity(ctx), input.publicId, input.isPreferred)
      )
    ),

  delete: megadeskProcedure
    .input(z.object({ publicId: productSupplierPublicId }))
    .mutation(({ input, ctx }) =>
      run(() => service.delete(identity(ctx), input.publicId))
    ),
});
