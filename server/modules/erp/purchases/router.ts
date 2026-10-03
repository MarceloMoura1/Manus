import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { megadeskProcedure, router } from "../../../_core/trpc";
import { ErpDomainError, erpTrpcCode } from "../errors";
import {
  cancellationInput,
  closeBalanceInput,
  decisionInput,
  documentLinkInput,
  purchaseDraftInput,
  purchaseListInput,
  purchaseRequestDraftInput,
  purchaseRequestListInput,
  quoteCreateInput,
  quoteProposalInput,
  quoteSelectionInput,
  quoteToOrderInput,
  receiveInput,
  requestToOrderInput,
  supplierMetricsInput,
} from "./domain-contracts";
import { PurchaseService } from "./service";
const service = new PurchaseService();
type Context = {
  tenantId: string;
  operationalUserId: string;
  operationalUserRole: "admin" | "manager" | "agent" | "viewer";
  operationalPermissions?: string[];
  userName?: string;
};
const identity = (ctx: Context) => ({
  clientId: ctx.tenantId,
  userId: ctx.operationalUserId,
  role: ctx.operationalUserRole,
  userName: ctx.userName,
});
const purchaseProcedure = megadeskProcedure.use(async ({ ctx, next, path, type }) => {
  const trustedTestContext = process.env.NODE_ENV === "test" && !ctx.operationalSessionId;
  if (!trustedTestContext && !ctx.operationalPermissions?.includes("erp")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso ao modulo ERP indisponivel." });
  }
  if (type !== "mutation") return next({ ctx });

  const startedAt = Date.now();
  const correlationId = randomUUID();
  const result = await next({ ctx });
  const diagnostic = {
    correlationId,
    operation: path,
    tenant: ctx.tenantId,
    entity: path.split(".").at(-2) ?? "purchase",
    result: result.ok ? "success" : "failure",
    durationMs: Date.now() - startedAt,
    failureClass: result.ok ? null : result.error.code,
  };
  if (result.ok) console.info("[ERP Purchase] operation completed", diagnostic);
  else console.warn("[ERP Purchase] operation failed", diagnostic);
  return result;
});
export const PURCHASE_PUBLIC_ERROR_MESSAGE =
  "Não foi possível concluir a operação de compras.";

export function purchaseFailureDiagnostic(error: unknown) {
  if (!error || typeof error !== "object") {
    return { name: typeof error, code: null, errno: null, sqlState: null };
  }
  const candidate = error as Record<string, unknown>;
  return {
    name:
      typeof candidate.name === "string"
        ? candidate.name
        : error.constructor?.name ?? "UnknownError",
    code: typeof candidate.code === "string" ? candidate.code : null,
    errno: typeof candidate.errno === "number" ? candidate.errno : null,
    sqlState:
      typeof candidate.sqlState === "string" ? candidate.sqlState : null,
  };
}

export async function runPurchaseOperation<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ErpDomainError)
      throw new TRPCError({ code: erpTrpcCode(e), message: e.message });
    if (e instanceof TRPCError) throw e;
    console.error(
      "[ERP Purchase] unexpected operation failure",
      purchaseFailureDiagnostic(e)
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: PURCHASE_PUBLIC_ERROR_MESSAGE,
    });
  }
}
const run = runPurchaseOperation;
const id = z.object({ publicId: z.string().uuid() });
export const purchasesRouter = router({
  capabilities: purchaseProcedure.query(({ ctx }) => service.capabilities(identity(ctx))),
  summary: purchaseProcedure.query(({ ctx }) => run(() => service.summary(identity(ctx)))),
  list: purchaseProcedure
    .input(purchaseListInput)
    .query(({ ctx, input }) => run(() => service.list(identity(ctx), input))),
  detail: purchaseProcedure
    .input(id)
    .query(({ ctx, input }) =>
      run(() => service.detail(identity(ctx), input.publicId))
    ),
  create: purchaseProcedure
    .input(purchaseDraftInput)
    .mutation(({ ctx, input }) =>
      run(() => service.create(identity(ctx), input))
    ),
  update: purchaseProcedure
    .input(purchaseDraftInput.and(id))
    .mutation(({ ctx, input }) => {
      const { publicId, ...draft } = input;
      return run(() => service.update(identity(ctx), publicId, draft));
    }),
  approve: purchaseProcedure
    .input(id)
    .mutation(({ ctx, input }) =>
      run(() => service.approve(identity(ctx), input.publicId))
    ),
  cancel: purchaseProcedure
    .input(cancellationInput)
    .mutation(({ ctx, input }) =>
      run(() => service.cancel(identity(ctx), input.publicId, input.reason))
    ),
  receive: purchaseProcedure
    .input(receiveInput)
    .mutation(({ ctx, input }) =>
      run(() => service.receive(identity(ctx), input))
    ),
  closeBalance: purchaseProcedure
    .input(closeBalanceInput)
    .mutation(({ ctx, input }) => run(() => service.closeBalance(identity(ctx), input))),
  linkDocument: purchaseProcedure
    .input(documentLinkInput)
    .mutation(({ ctx, input }) => run(() => service.linkDocument(identity(ctx), input))),
  supplierMetrics: purchaseProcedure
    .input(supplierMetricsInput)
    .query(({ ctx, input }) =>
      run(() => service.supplierMetrics(identity(ctx), input.supplierPublicId))
    ),
  requests: router({
    list: purchaseProcedure
      .input(purchaseRequestListInput)
      .query(({ ctx, input }) => run(() => service.listRequests(identity(ctx), input))),
    detail: purchaseProcedure
      .input(id)
      .query(({ ctx, input }) => run(() => service.requestDetail(identity(ctx), input.publicId))),
    create: purchaseProcedure
      .input(purchaseRequestDraftInput)
      .mutation(({ ctx, input }) => run(() => service.saveRequest(identity(ctx), input))),
    update: purchaseProcedure
      .input(purchaseRequestDraftInput.and(id))
      .mutation(({ ctx, input }) => {
        const { publicId, ...draft } = input;
        return run(() => service.saveRequest(identity(ctx), draft, publicId));
      }),
    submit: purchaseProcedure
      .input(decisionInput)
      .mutation(({ ctx, input }) =>
        run(() => service.submitRequest(identity(ctx), input.publicId, input.idempotencyKey))
      ),
    decide: purchaseProcedure
      .input(decisionInput.extend({ decision: z.enum(["approved", "rejected"]) }))
      .mutation(({ ctx, input }) =>
        run(() =>
          service.decideRequest(
            identity(ctx),
            input.publicId,
            input.decision,
            input.reason,
            input.idempotencyKey
          )
        )
      ),
    cancel: purchaseProcedure
      .input(cancellationInput)
      .mutation(({ ctx, input }) =>
        run(() => service.cancelRequest(identity(ctx), input.publicId, input.reason))
      ),
    createOrder: purchaseProcedure
      .input(requestToOrderInput)
      .mutation(({ ctx, input }) => run(() => service.createFromRequest(identity(ctx), input))),
  }),
  quotes: router({
    detail: purchaseProcedure
      .input(id)
      .query(({ ctx, input }) => run(() => service.quoteDetail(identity(ctx), input.publicId))),
    create: purchaseProcedure
      .input(quoteCreateInput)
      .mutation(({ ctx, input }) => run(() => service.createQuote(identity(ctx), input.requestPublicId))),
    addProposal: purchaseProcedure
      .input(quoteProposalInput)
      .mutation(({ ctx, input }) => run(() => service.addProposal(identity(ctx), input))),
    selectProposal: purchaseProcedure
      .input(quoteSelectionInput)
      .mutation(({ ctx, input }) =>
        run(() => service.selectProposal(identity(ctx), input.quotePublicId, input.proposalPublicId))
      ),
    createOrder: purchaseProcedure
      .input(quoteToOrderInput)
      .mutation(({ ctx, input }) => run(() => service.createFromQuote(identity(ctx), input))),
  }),
});
