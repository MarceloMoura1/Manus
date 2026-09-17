import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { megadeskProcedure, router } from "../../../_core/trpc";
import { ErpDomainError, erpTrpcCode } from "../errors";
import {
  categoryInput,
  categoryListInput,
  categoryMoveInput,
  categoryPublicId,
  categoryUpdateInput,
} from "./contracts";
import { CategoryService } from "./service";

const service = new CategoryService();

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

export const categoriesRouter = router({
  list: megadeskProcedure
    .input(categoryListInput)
    .query(({ input, ctx }) => run(() => service.list(identity(ctx), input))),

  detail: megadeskProcedure
    .input(z.object({ publicId: categoryPublicId }))
    .query(({ input, ctx }) =>
      run(() => service.detail(identity(ctx), input.publicId))
    ),

  create: megadeskProcedure
    .input(categoryInput)
    .mutation(({ input, ctx }) =>
      run(() => service.create(identity(ctx), input))
    ),

  update: megadeskProcedure
    .input(categoryUpdateInput.extend({ publicId: categoryPublicId }))
    .mutation(({ input, ctx }) => {
      const { publicId, ...command } = input;
      return run(() => service.update(identity(ctx), publicId, command));
    }),

  move: megadeskProcedure
    .input(categoryMoveInput.extend({ publicId: categoryPublicId }))
    .mutation(({ input, ctx }) => {
      const { publicId, ...command } = input;
      return run(() => service.move(identity(ctx), publicId, command));
    }),

  setActive: megadeskProcedure
    .input(z.object({ publicId: categoryPublicId, active: z.boolean() }))
    .mutation(({ input, ctx }) =>
      run(() => service.setActive(identity(ctx), input.publicId, input.active))
    ),

  delete: megadeskProcedure
    .input(z.object({ publicId: categoryPublicId }))
    .mutation(({ input, ctx }) =>
      run(() => service.delete(identity(ctx), input.publicId))
    ),
});
