import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, megadeskProcedure } from "../../../_core/trpc";
import { requireCrmOpportunityAccess } from "../../../crm-access";
import { SaleService } from "../../erp/sales/service";
import { QuotePdfService } from "../../erp/sales/quote-pdf-service";
import { SaleDocumentService } from "../../erp/sales/documents-service";
import {
  saleDraftInput,
  saleCommercialStatuses,
} from "../../erp/sales/contracts";
import type { OperationalRole } from "../../erp/contracts";
import { ErpDomainError } from "../../erp/errors";

const saleService = new SaleService();
const quotePdfService = new QuotePdfService();
const documentService = new SaleDocumentService();

function resolveIdentity(ctx: {
  tenantId?: string;
  operationalUserId?: string;
  operationalUserRole?: string;
  operationalPermissions?: string[];
  userName?: string;
  userEmail?: string;
}) {
  const tenantId = requireCrmOpportunityAccess(ctx as any);
  const role: OperationalRole =
    ctx.operationalUserRole === "admin"
      ? "admin"
      : ctx.operationalUserRole === "viewer"
      ? "viewer"
      : ctx.operationalUserRole === "agent"
      ? "agent"
      : "manager";

  return {
    clientId: tenantId,
    userId: ctx.operationalUserId || "crm-operator",
    userName: ctx.userName?.trim() || ctx.userEmail?.trim() || "Operador CRM",
    role,
  };
}

export const proposalsRouter = router({
  list: megadeskProcedure
    .input(
      z
        .object({
          search: z.string().trim().default(""),
          crmClientId: z.string().trim().optional(),
          commercialStatus: z.enum(saleCommercialStatuses).optional(),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(50),
        })
        .default({
          search: "",
          page: 1,
          pageSize: 50,
        })
    )
    .query(async ({ input, ctx }) => {
      const identity = resolveIdentity(ctx);
      try {
        const result = await saleService.list(identity, {
          kind: "quotes",
          search: input.search,
          crmClientId: input.crmClientId,
          commercialStatus: input.commercialStatus,
          page: input.page,
          pageSize: input.pageSize,
          includeArchived: false,
          sort: "createdAt",
          direction: "desc",
        });
        return result;
      } catch (err: any) {
        if (err instanceof ErpDomainError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        console.error("[CRM Proposals] Erro ao listar propostas:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Não foi possível carregar as propostas comerciais.",
        });
      }
    }),

  detail: megadeskProcedure
    .input(z.object({ publicId: z.string().uuid() }).strict())
    .query(async ({ input, ctx }) => {
      const identity = resolveIdentity(ctx);
      try {
        const detail = await saleService.detail(identity, input.publicId);
        const documents = await documentService.list(identity, input.publicId);
        return {
          ...detail,
          documents,
        };
      } catch (err: any) {
        if (err instanceof ErpDomainError) {
          throw new TRPCError({
            code: err.code === "NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST",
            message: err.message,
          });
        }
        console.error("[CRM Proposals] Erro ao buscar detalhe da proposta:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Não foi possível carregar a proposta.",
        });
      }
    }),

  create: megadeskProcedure
    .input(saleDraftInput)
    .mutation(async ({ input, ctx }) => {
      const identity = resolveIdentity(ctx);
      try {
        const quote = await saleService.create(identity, {
          ...input,
          documentType: "quote",
        });
        return { quote };
      } catch (err: any) {
        if (err instanceof ErpDomainError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        console.error("[CRM Proposals] Erro ao criar proposta:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message || "Não foi possível criar a proposta.",
        });
      }
    }),

  update: megadeskProcedure
    .input(
      z.object({
        publicId: z.string().uuid(),
        data: saleDraftInput,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const identity = resolveIdentity(ctx);
      try {
        const quote = await saleService.update(identity, input.publicId, {
          ...input.data,
          documentType: "quote",
        });
        return { quote };
      } catch (err: any) {
        if (err instanceof ErpDomainError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        console.error("[CRM Proposals] Erro ao atualizar proposta:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message || "Não foi possível atualizar a proposta.",
        });
      }
    }),

  updateCommercialStatus: megadeskProcedure
    .input(
      z.object({
        publicId: z.string().uuid(),
        toStatus: z.enum(["negotiation", "approved", "lost"]),
        reason: z.string().trim().max(500).optional().nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const identity = resolveIdentity(ctx);
      try {
        const result = await saleService.commercialTransition(identity, {
          publicId: input.publicId,
          toStatus: input.toStatus,
          reason: input.reason || null,
        });
        return { success: true, result };
      } catch (err: any) {
        if (err instanceof ErpDomainError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        console.error("[CRM Proposals] Erro na transição comercial:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message || "Falha ao alterar status da proposta.",
        });
      }
    }),

  convertQuoteToSale: megadeskProcedure
    .input(
      z.object({
        publicId: z.string().uuid(),
        idempotencyKey: z.string().uuid().default(() => randomUUID()),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const identity = resolveIdentity(ctx);
      try {
        const sale = await saleService.convertQuote(
          identity,
          input.publicId,
          input.idempotencyKey
        );
        return { success: true, sale };
      } catch (err: any) {
        if (err instanceof ErpDomainError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        console.error("[CRM Proposals] Erro ao converter proposta em pedido:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message || "Não foi possível converter a proposta em pedido de venda.",
        });
      }
    }),

  generatePdf: megadeskProcedure
    .input(
      z.object({
        publicId: z.string().uuid(),
        idempotencyKey: z.string().uuid().default(() => randomUUID()),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const identity = resolveIdentity(ctx);
      try {
        const document = await quotePdfService.generate(identity, {
          salePublicId: input.publicId,
          idempotencyKey: input.idempotencyKey,
        });
        return { success: true, document };
      } catch (err: any) {
        if (err instanceof ErpDomainError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        console.error("[CRM Proposals] Erro ao gerar PDF da proposta:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message || "Não foi possível gerar o PDF da proposta.",
        });
      }
    }),

  catalog: megadeskProcedure
    .input(
      z
        .object({
          search: z.string().trim().default(""),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(50),
        })
        .default({
          search: "",
          page: 1,
          pageSize: 50,
        })
    )
    .query(async ({ input, ctx }) => {
      const identity = resolveIdentity(ctx);
      try {
        return await saleService.catalog(identity, {
          search: input.search,
          page: input.page,
          pageSize: input.pageSize,
        });
      } catch (err: any) {
        console.error("[CRM Proposals] Erro ao buscar catálogo:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Não foi possível carregar os produtos do catálogo.",
        });
      }
    }),
});
