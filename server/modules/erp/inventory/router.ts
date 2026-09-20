import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { megadeskProcedure, router } from "../../../_core/trpc";
import { ErpDomainError, erpTrpcCode } from "../errors";
import { InventoryRepository } from "./repository";

const repository = new InventoryRepository();
async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ErpDomainError) {
      throw new TRPCError({ code: erpTrpcCode(error), message: error.message });
    }
    throw error;
  }
}

export const inventoryRouter = router({
  list: megadeskProcedure
    .input(
      z.object({
        productPublicId: z.string().uuid().optional(),
      })
    )
    .query(({ input, ctx }) =>
      run(() => repository.listForUi(ctx.tenantId, input.productPublicId))
    ),
});
