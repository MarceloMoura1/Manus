import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, megadeskProcedure } from "../../../_core/trpc";
import { resolveOperationalSessionReadOnly } from "../../../_core/megadesk-session";
import { requireCrmOpportunityAccess } from "../../../crm-access";
import { readCrmClientFile } from "../client-files/files-storage";
import { SaleService } from "../../erp/sales/service";
import { QuotePdfService } from "../../erp/sales/quote-pdf-service";
import { SaleDocumentService } from "../../erp/sales/documents-service";
import {
  saleDraftInput,
  saleCommercialStatuses,
} from "../../erp/sales/contracts";
import type { OperationalRole } from "../../erp/contracts";
import { ErpDomainError } from "../../erp/errors";
import { QuoteTemplatesService } from "./quote-templates";

const saleService = new SaleService();
const quotePdfService = new QuotePdfService();
const documentService = new SaleDocumentService();
const quoteTemplatesService = new QuoteTemplatesService(saleService, quotePdfService, documentService);

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
        templatePublicId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const identity = resolveIdentity(ctx);
      try {
        const document = await quotePdfService.generate(identity, {
          salePublicId: input.publicId,
          idempotencyKey: input.idempotencyKey,
          templatePublicId: input.templatePublicId,
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

  listTemplates: megadeskProcedure.query(async ({ ctx }) => {
    const identity = resolveIdentity(ctx);
    try {
      return await quoteTemplatesService.listTemplates(identity);
    } catch (err: any) {
      console.error("[CRM Proposals] Erro ao listar templates:", err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Não foi possível carregar os templates de orçamento.",
      });
    }
  }),

  createTemplate: megadeskProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(150),
        niche: z.enum(["automotive", "services", "general"]).default("automotive"),
        backgroundImageUrl: z.string().trim().optional().nullable(),
        fileBase64: z.string().optional().nullable(),
        mimeType: z.string().optional().nullable(),
        layoutConfig: z.record(z.string(), z.unknown()).optional().nullable(),
        isDefault: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const identity = resolveIdentity(ctx);
      try {
        return await quoteTemplatesService.createTemplate(identity, input);
      } catch (err: any) {
        console.error("[CRM Proposals] Erro ao criar template:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message || "Não foi possível criar o template de orçamento.",
        });
      }
    }),

  deleteTemplate: megadeskProcedure
    .input(z.object({ publicId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const identity = resolveIdentity(ctx);
      try {
        return await quoteTemplatesService.deleteTemplate(identity, input.publicId);
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        console.error("[CRM Proposals] Erro ao remover template:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Não foi possível excluir o template de orçamento.",
        });
      }
    }),

  updateMetadata: megadeskProcedure
    .input(
      z.object({
        publicId: z.string().uuid(),
        documentCustomName: z.string().trim().max(255).optional().nullable(),
        serviceMetadata: z.record(z.string(), z.unknown()).optional().nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const identity = resolveIdentity(ctx);
      try {
        return await quoteTemplatesService.updateMetadata(identity, input);
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        console.error("[CRM Proposals] Erro ao atualizar metadados da proposta:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Não foi possível atualizar os dados do orçamento.",
        });
      }
    }),

  previewQuoteHtml: megadeskProcedure
    .input(
      z.object({
        salePublicId: z.string().uuid(),
        templatePublicId: z.string().uuid().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const identity = resolveIdentity(ctx);
      try {
        return await quoteTemplatesService.previewQuoteHtml(identity, input);
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        console.error("[CRM Proposals] Erro ao gerar preview HTML:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message || "Não foi possível gerar a prévia da proposta.",
        });
      }
    }),

  sendQuoteWhatsApp: megadeskProcedure
    .input(
      z.object({
        publicId: z.string().uuid(),
        phone: z.string().trim().optional(),
        customMessage: z.string().trim().optional(),
        templatePublicId: z.string().trim().optional(),
        idempotencyKey: z.string().uuid().default(() => randomUUID()),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const identity = resolveIdentity(ctx);
      try {
        return await quoteTemplatesService.sendQuoteWhatsApp(identity, input);
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        console.error("[CRM Proposals] Erro ao enviar proposta via WhatsApp:", err);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err?.message || "Não foi possível enviar o orçamento via WhatsApp.",
        });
      }
    }),
});

export function createTemplateImageDownloadHandler(
  sessionResolver: typeof resolveOperationalSessionReadOnly = resolveOperationalSessionReadOnly
) {
  return async (req: Request, res: Response): Promise<void> => {
    const session = await sessionResolver(req);
    if (!session) {
      res.status(401).end();
      return;
    }
    const publicId = req.params.publicId;
    if (!publicId) {
      res.status(400).end();
      return;
    }
    try {
      const bytes = await readCrmClientFile(session.tenantId, publicId);
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
      const mime = isJpeg ? "image/jpeg" : "image/png";
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.status(200).send(bytes);
    } catch {
      res.status(404).end();
    }
  };
}

export function registerProposalTemplateRoutes(app: Express): void {
  app.get("/api/crm/proposals/templates/:publicId/image", createTemplateImageDownloadHandler());
}

