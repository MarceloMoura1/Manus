import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { megadeskProcedure, router } from "../../../_core/trpc";
import { ErpDomainError, erpTrpcCode } from "../errors";
import {
  cancellationInput,
  saleAddressCorrectionInput,
  saleConfirmationInput,
  saleDraftInput,
  saleListInput,
  saleSearchInput,
  saleTransitionInput,
  fulfillInput,
} from "./contracts";
import { SaleService } from "./service";
import {
  customerSalesInput,
  saleDocumentDeleteInput,
  saleDocumentListInput,
  saleDocumentUploadInput,
} from "./documents-contracts";
import { SaleDocumentService } from "./documents-service";
const service = new SaleService();
const documentService = new SaleDocumentService();
type Context = {
  tenantId: string;
  operationalUserId: string;
  operationalUserRole: "admin" | "manager" | "agent" | "viewer";
  operationalPermissions?: string[];
  operationalSessionId?: string;
  userName?: string;
};
const identity = (ctx: Context) => ({
  clientId: ctx.tenantId,
  userId: ctx.operationalUserId,
  userName: ctx.userName?.trim() || null,
  role: ctx.operationalUserRole,
});
export const SALES_PUBLIC_ERROR_MESSAGE =
  "Não foi possível concluir a operação de vendas.";

export function hasSalesModuleAccess(ctx: {
  operationalPermissions?: string[];
}) {
  return ctx.operationalPermissions?.includes("erp") === true;
}

function safeDiagnosticValue(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^[a-z0-9_.-]{1,80}$/i.test(value)) {
    return value;
  }
  return null;
}

export function salesFailureDiagnostic(
  operation: string,
  error: unknown,
  correlationId = randomUUID()
) {
  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  return {
    correlationId,
    operation,
    failureClass: safeDiagnosticValue(record.name) ?? "UnknownError",
    code: safeDiagnosticValue(record.code),
    errno: safeDiagnosticValue(record.errno),
    sqlState: safeDiagnosticValue(record.sqlState),
  };
}

export async function runSalesOperation<T>(
  operation: string,
  fn: () => Promise<T>
) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ErpDomainError)
      throw new TRPCError({ code: erpTrpcCode(e), message: e.message });
    console.error(
      "[ERP Sales] unexpected operation failure",
      salesFailureDiagnostic(operation, e)
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: SALES_PUBLIC_ERROR_MESSAGE,
    });
  }
}
const salesProcedure = megadeskProcedure.use(({ ctx, next }) => {
  const trustedTestContext =
    process.env.NODE_ENV === "test" && !ctx.operationalSessionId;
  if (!trustedTestContext && !hasSalesModuleAccess(ctx)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Acesso ao módulo ERP indisponível.",
    });
  }
  return next({ ctx });
});
const id = z.object({ publicId: z.string().uuid() });
export const salesRouter = router({
  metrics: salesProcedure
    .input(z.object({ from: z.string().date().optional(), to: z.string().date().optional() }))
    .query(({ ctx, input }) =>
      runSalesOperation("sales.metrics", () =>
        service.metrics(identity(ctx), input)
      )
    ),
  options: salesProcedure.query(({ ctx }) =>
    runSalesOperation("sales.options", () => service.options(identity(ctx)))
  ),
  list: salesProcedure
    .input(saleListInput)
    .query(({ ctx, input }) =>
      runSalesOperation("sales.list", () => service.list(identity(ctx), input))
    ),
  customers: salesProcedure
    .input(saleSearchInput)
    .query(({ ctx, input }) =>
      runSalesOperation("sales.customers", () =>
        service.customers(identity(ctx), input)
      )
    ),
  catalog: salesProcedure
    .input(saleSearchInput)
    .query(({ ctx, input }) =>
      runSalesOperation("sales.catalog", () =>
        service.catalog(identity(ctx), input)
      )
    ),
  detail: salesProcedure
    .input(id)
    .query(({ ctx, input }) =>
      runSalesOperation("sales.detail", () =>
        service.detail(identity(ctx), input.publicId)
      )
    ),
  customerSales: salesProcedure
    .input(customerSalesInput)
    .query(({ ctx, input }) =>
      runSalesOperation("sales.customerSales", () =>
        documentService.customerSales(identity(ctx), input.crmClientId)
      )
    ),
  documents: router({
    list: salesProcedure
      .input(saleDocumentListInput)
      .query(({ ctx, input }) =>
        runSalesOperation("sales.documents.list", () =>
          documentService.list(identity(ctx), input.salePublicId)
        )
      ),
    upload: salesProcedure
      .input(saleDocumentUploadInput)
      .mutation(({ ctx, input }) =>
        runSalesOperation("sales.documents.upload", () =>
          documentService.upload(identity(ctx), input)
        )
      ),
    delete: salesProcedure
      .input(saleDocumentDeleteInput)
      .mutation(({ ctx, input }) =>
        runSalesOperation("sales.documents.delete", () =>
          documentService.delete(identity(ctx), input)
        )
      ),
  }),
  create: salesProcedure
    .input(saleDraftInput)
    .mutation(({ ctx, input }) =>
      runSalesOperation("sales.create", () =>
        service.create(identity(ctx), input)
      )
    ),
  update: salesProcedure
    .input(saleDraftInput.and(id))
    .mutation(({ ctx, input }) => {
      const { publicId, ...draft } = input;
      return runSalesOperation("sales.update", () =>
        service.update(identity(ctx), publicId, draft)
      );
    }),
  confirm: salesProcedure
    .input(saleConfirmationInput)
    .mutation(({ ctx, input }) =>
      runSalesOperation("sales.confirm", () =>
        service.confirm(identity(ctx), input)
      )
    ),
  transition: salesProcedure
    .input(saleTransitionInput)
    .mutation(({ ctx, input }) =>
      runSalesOperation("sales.transition", () =>
        service.transition(identity(ctx), input)
      )
    ),
  cancel: salesProcedure
    .input(cancellationInput)
    .mutation(({ ctx, input }) =>
      runSalesOperation("sales.cancel", () =>
        service.cancel(identity(ctx), input.publicId, input.reason)
      )
    ),
  correctAddress: salesProcedure
    .input(saleAddressCorrectionInput)
    .mutation(({ ctx, input }) =>
      runSalesOperation("sales.correctAddress", () =>
        service.correctAddress(identity(ctx), input)
      )
    ),
  fulfill: salesProcedure
    .input(fulfillInput)
    .mutation(({ ctx, input }) =>
      runSalesOperation("sales.fulfill", () =>
        service.fulfill(identity(ctx), input.publicId, input.idempotencyKey)
      )
    ),
});
