import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { megadeskProcedure, router } from "../../../_core/trpc";
import { ErpDomainError, erpTrpcCode } from "../errors";
import {
  serviceIdSchema,
  serviceInput,
  serviceListInput,
  serviceUpdateInput,
} from "./contracts";
import { ServiceService } from "./service";

const service = new ServiceService();

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

export const servicesRouter = router({
  list: megadeskProcedure
    .input(serviceListInput)
    .query(({ input, ctx }) => run(() => service.list(identity(ctx), input))),

  getById: megadeskProcedure
    .input(z.object({ id: serviceIdSchema }))
    .query(({ input, ctx }) => run(() => service.getById(identity(ctx), input.id))),

  create: megadeskProcedure
    .input(serviceInput)
    .mutation(({ input, ctx }) => run(() => service.create(identity(ctx), input))),

  update: megadeskProcedure
    .input(serviceUpdateInput)
    .mutation(({ input, ctx }) => {
      const { id, ...data } = input;
      return run(() => service.update(identity(ctx), id, data));
    }),

  toggleActive: megadeskProcedure
    .input(z.object({ id: serviceIdSchema }))
    .mutation(({ input, ctx }) => run(() => service.toggleActive(identity(ctx), input.id))),

  delete: megadeskProcedure
    .input(z.object({ id: serviceIdSchema }))
    .mutation(({ input, ctx }) => run(() => service.delete(identity(ctx), input.id))),

  categories: megadeskProcedure
    .query(({ ctx }) => run(() => service.listCategories(identity(ctx)))),
});
