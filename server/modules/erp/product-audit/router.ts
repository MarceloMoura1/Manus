import { TRPCError } from "@trpc/server";
import { megadeskProcedure, router } from "../../../_core/trpc";
import { ErpDomainError, erpTrpcCode } from "../errors";
import {
  productAuditDetailInput,
  productAuditListInput,
} from "./contracts";
import { ProductAuditService, type ErpIdentity } from "./service";

const service = new ProductAuditService();

type Context = {
  tenantId: string;
  operationalUserId: string;
  operationalUserRole: "admin" | "manager" | "agent" | "viewer";
  user?: { name?: string | null } | null;
};

const identity = (ctx: Context): ErpIdentity => ({
  clientId: ctx.tenantId,
  userId: ctx.operationalUserId,
  role: ctx.operationalUserRole,
  userName: ctx.user?.name ?? undefined,
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
    if (error instanceof TRPCError) {
      throw error;
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Falha interna ao processar consulta de auditoria.",
    });
  }
}

export const productAuditRouter = router({
  list: megadeskProcedure
    .input(productAuditListInput)
    .query(({ input, ctx }) => run(() => service.list(identity(ctx), input))),

  detail: megadeskProcedure
    .input(productAuditDetailInput)
    .query(({ input, ctx }) => run(() => service.detail(identity(ctx), input))),
});
