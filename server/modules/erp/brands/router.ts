import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { megadeskProcedure, router } from "../../../_core/trpc";
import { ErpDomainError, erpTrpcCode } from "../errors";
import {
  brandInput,
  brandListInput,
  brandPublicId,
  brandUpdateInput,
} from "./contracts";
import { BrandService } from "./service";

const service = new BrandService();

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

export const brandsRouter = router({
  list: megadeskProcedure
    .input(brandListInput)
    .query(({ input, ctx }) => run(() => service.list(identity(ctx), input))),

  detail: megadeskProcedure
    .input(z.object({ publicId: brandPublicId }))
    .query(({ input, ctx }) =>
      run(() => service.detail(identity(ctx), input.publicId))
    ),

  create: megadeskProcedure
    .input(brandInput)
    .mutation(({ input, ctx }) =>
      run(() => service.create(identity(ctx), input))
    ),

  update: megadeskProcedure
    .input(brandUpdateInput.extend({ publicId: brandPublicId }))
    .mutation(({ input, ctx }) => {
      const { publicId, ...command } = input;
      return run(() => service.update(identity(ctx), publicId, command));
    }),

  setActive: megadeskProcedure
    .input(z.object({ publicId: brandPublicId, active: z.boolean() }))
    .mutation(({ input, ctx }) =>
      run(() => service.setActive(identity(ctx), input.publicId, input.active))
    ),

  delete: megadeskProcedure
    .input(z.object({ publicId: brandPublicId }))
    .mutation(({ input, ctx }) =>
      run(() => service.delete(identity(ctx), input.publicId))
    ),
});
