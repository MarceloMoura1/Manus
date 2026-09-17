import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { megadeskProcedure, router } from "../../../_core/trpc";
import { ErpDomainError, erpTrpcCode } from "../errors";
import {
  attributeTypeInput,
  attributeTypeListInput,
  attributeTypePublicId,
  attributeTypeUpdateInput,
  attributeValueInput,
  attributeValueListInput,
  attributeValuePublicId,
  attributeValueUpdateInput,
} from "./contracts";
import { AttributeService } from "./service";

const service = new AttributeService();

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

export const attributesRouter = router({
  types: router({
    list: megadeskProcedure
      .input(attributeTypeListInput)
      .query(({ input, ctx }) =>
        run(() => service.listTypes(identity(ctx), input))
      ),

    detail: megadeskProcedure
      .input(z.object({ publicId: attributeTypePublicId }))
      .query(({ input, ctx }) =>
        run(() => service.detailType(identity(ctx), input.publicId))
      ),

    create: megadeskProcedure
      .input(attributeTypeInput)
      .mutation(({ input, ctx }) =>
        run(() => service.createType(identity(ctx), input))
      ),

    update: megadeskProcedure
      .input(attributeTypeUpdateInput.extend({ publicId: attributeTypePublicId }))
      .mutation(({ input, ctx }) => {
        const { publicId, ...command } = input;
        return run(() => service.updateType(identity(ctx), publicId, command));
      }),

    setActive: megadeskProcedure
      .input(z.object({ publicId: attributeTypePublicId, active: z.boolean() }))
      .mutation(({ input, ctx }) =>
        run(() =>
          service.setTypeActive(identity(ctx), input.publicId, input.active)
        )
      ),

    delete: megadeskProcedure
      .input(z.object({ publicId: attributeTypePublicId }))
      .mutation(({ input, ctx }) =>
        run(() => service.deleteType(identity(ctx), input.publicId))
      ),
  }),

  values: router({
    list: megadeskProcedure
      .input(attributeValueListInput)
      .query(({ input, ctx }) =>
        run(() => service.listValues(identity(ctx), input))
      ),

    detail: megadeskProcedure
      .input(z.object({ publicId: attributeValuePublicId }))
      .query(({ input, ctx }) =>
        run(() => service.detailValue(identity(ctx), input.publicId))
      ),

    create: megadeskProcedure
      .input(attributeValueInput)
      .mutation(({ input, ctx }) =>
        run(() => service.createValue(identity(ctx), input))
      ),

    update: megadeskProcedure
      .input(attributeValueUpdateInput.extend({ publicId: attributeValuePublicId }))
      .mutation(({ input, ctx }) => {
        const { publicId, ...command } = input;
        return run(() => service.updateValue(identity(ctx), publicId, command));
      }),

    setActive: megadeskProcedure
      .input(z.object({ publicId: attributeValuePublicId, active: z.boolean() }))
      .mutation(({ input, ctx }) =>
        run(() =>
          service.setValueActive(identity(ctx), input.publicId, input.active)
        )
      ),

    delete: megadeskProcedure
      .input(z.object({ publicId: attributeValuePublicId }))
      .mutation(({ input, ctx }) =>
        run(() => service.deleteValue(identity(ctx), input.publicId))
      ),
  }),
});
