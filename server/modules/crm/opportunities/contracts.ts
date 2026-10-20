import { z } from "zod";
import { crmClientIdSchema } from "../client-files/files-contracts";
import {
  pipelinePublicIdSchema,
  stagePublicIdSchema,
} from "../pipeline/contracts";

export const opportunityPublicIdSchema = z
  .string()
  .uuid("Identificador da oportunidade deve ser um UUID válido.");

export const activityPublicIdSchema = z
  .string()
  .uuid("Identificador da atividade deve ser um UUID válido.");

export const opportunityHistoryPublicIdSchema = z
  .string()
  .uuid("Identificador do histórico deve ser um UUID válido.");

export const opportunityTitleSchema = z
  .string()
  .trim()
  .min(1, "Título da oportunidade é obrigatório.")
  .max(255, "Título não pode exceder 255 caracteres.");

export const opportunityValueCentsSchema = z
  .number()
  .int("Valor monetário deve ser representado em centavos inteiros.")
  .min(0, "Valor monetário não pode ser negativo.");

export const opportunityCurrencySchema = z
  .string()
  .trim()
  .length(3, "Código de moeda deve ter exatamente 3 caracteres (ex.: BRL).")
  .default("BRL");

export const opportunityStatusValues = ["open", "won", "lost"] as const;
export type OpportunityStatus = (typeof opportunityStatusValues)[number];
export const opportunityStatusSchema = z.enum(opportunityStatusValues);

export const opportunityLossReasonSchema = z
  .string()
  .trim()
  .min(1, "Motivo de perda é obrigatório.")
  .max(255, "Motivo de perda não pode exceder 255 caracteres.");

export const opportunityExpectedCloseDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato AAAA-MM-DD.")
  .optional()
  .nullable();

export const activityTypeValues = [
  "task",
  "call",
  "meeting",
  "followup",
  "note",
] as const;
export type ActivityType = (typeof activityTypeValues)[number];
export const activityTypeSchema = z.enum(activityTypeValues);

export const activityStatusValues = [
  "pending",
  "completed",
  "cancelled",
] as const;
export type ActivityStatus = (typeof activityStatusValues)[number];
export const activityStatusSchema = z.enum(activityStatusValues);

export const opportunityCreateInput = z.object({
  pipelinePublicId: pipelinePublicIdSchema,
  stagePublicId: stagePublicIdSchema,
  crmClientId: crmClientIdSchema.optional().nullable(),
  title: opportunityTitleSchema,
  valueCents: opportunityValueCentsSchema.optional().default(0),
  currency: opportunityCurrencySchema.optional().default("BRL"),
  expectedCloseDate: opportunityExpectedCloseDateSchema,
  internalResponsible: z.string().trim().max(180).optional().default(""),
  observations: z.string().trim().max(5000).optional().nullable(),
  convertLead: z.boolean().optional().default(false),
});

export type OpportunityCreateInput = z.infer<typeof opportunityCreateInput>;

export const opportunityListInput = z.object({
  pipelinePublicId: pipelinePublicIdSchema.optional(),
  stagePublicId: stagePublicIdSchema.optional(),
  crmClientId: crmClientIdSchema.optional(),
  status: z.enum(["open", "won", "lost", "all"]).optional().default("all"),
  internalResponsible: z.string().trim().optional(),
  search: z.string().trim().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato AAAA-MM-DD.").optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato AAAA-MM-DD.").optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(200).optional().default(100),
});

export type OpportunityListInput = z.infer<typeof opportunityListInput>;

export const opportunityMetricsFilterInput = z.object({
  pipelinePublicId: pipelinePublicIdSchema.optional(),
  stagePublicId: stagePublicIdSchema.optional(),
  crmClientId: crmClientIdSchema.optional(),
  internalResponsible: z.string().trim().optional(),
  search: z.string().trim().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato AAAA-MM-DD.").optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato AAAA-MM-DD.").optional(),
});

export type OpportunityMetricsFilterInput = z.infer<typeof opportunityMetricsFilterInput>;

export const opportunityUpdateInput = z
  .object({
    opportunityPublicId: opportunityPublicIdSchema,
    stagePublicId: stagePublicIdSchema.optional(),
    crmClientId: crmClientIdSchema.optional().nullable(),
    title: opportunityTitleSchema.optional(),
    valueCents: opportunityValueCentsSchema.optional(),
    currency: opportunityCurrencySchema.optional(),
    expectedCloseDate: opportunityExpectedCloseDateSchema,
    status: opportunityStatusSchema.optional(),
    lossReason: opportunityLossReasonSchema.optional().nullable(),
    internalResponsible: z.string().trim().max(180).optional(),
    observations: z.string().trim().max(5000).optional().nullable(),
  })
  .refine(
    data => {
      if (data.status === "lost") {
        return !!data.lossReason && data.lossReason.trim().length > 0;
      }
      return true;
    },
    {
      message: "Motivo de perda é obrigatório ao marcar a oportunidade como perdida.",
      path: ["lossReason"],
    }
  )
  .refine(
    data => {
      if ((data.status === "won" || data.status === "open") && data.lossReason && data.lossReason.trim().length > 0) {
        return false;
      }
      return true;
    },
    {
      message: "Motivo de perda não pode ser informado para oportunidades ganhas ou abertas.",
      path: ["lossReason"],
    }
  );

export type OpportunityUpdateInput = z.infer<typeof opportunityUpdateInput>;

export const opportunityStageTransitionInput = z
  .object({
    opportunityPublicId: opportunityPublicIdSchema,
    toStagePublicId: stagePublicIdSchema,
    status: opportunityStatusSchema.optional(),
    lossReason: opportunityLossReasonSchema.optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .refine(
    data => {
      if (data.status === "lost") {
        return !!data.lossReason && data.lossReason.trim().length > 0;
      }
      return true;
    },
    {
      message: "Motivo de perda é obrigatório ao marcar a oportunidade como perdida.",
      path: ["lossReason"],
    }
  )
  .refine(
    data => {
      if ((data.status === "won" || data.status === "open") && data.lossReason && data.lossReason.trim().length > 0) {
        return false;
      }
      return true;
    },
    {
      message: "Motivo de perda não pode ser informado para oportunidades ganhas ou abertas.",
      path: ["lossReason"],
    }
  );

export type OpportunityStageTransitionInput = z.infer<
  typeof opportunityStageTransitionInput
>;

export const activityCreateInput = z
  .object({
    opportunityPublicId: opportunityPublicIdSchema.optional().nullable(),
    crmClientId: crmClientIdSchema.optional().nullable(),
    type: activityTypeSchema,
    title: z.string().trim().min(1, "Título da atividade é obrigatório.").max(255),
    description: z.string().trim().max(5000).optional().nullable(),
    dueAt: z.string().optional().nullable(),
    assignedTo: z.string().trim().max(180).optional().default(""),
  })
  .refine(
    data => !!data.opportunityPublicId || !!data.crmClientId,
    {
      message: "A atividade deve estar vinculada a pelo menos uma oportunidade ou cliente.",
      path: ["opportunityPublicId"],
    }
  );

export type ActivityCreateInput = z.infer<typeof activityCreateInput>;

export const activityUpdateInput = z.object({
  activityPublicId: activityPublicIdSchema,
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(5000).optional().nullable(),
  dueAt: z.string().optional().nullable(),
  completedAt: z.string().optional().nullable(),
  status: activityStatusSchema.optional(),
  assignedTo: z.string().trim().max(180).optional(),
});

export type ActivityUpdateInput = z.infer<typeof activityUpdateInput>;

export const activityDeleteInput = z.object({
  activityPublicId: activityPublicIdSchema,
});

export type ActivityDeleteInput = z.infer<typeof activityDeleteInput>;

export const activityListInput = z.object({
  opportunityPublicId: z.string().uuid().optional(),
  crmClientId: z.string().optional(),
  status: z.string().optional(),
  type: activityTypeSchema.optional(),
  search: z.string().trim().optional(),
});

export type ActivityListInput = z.infer<typeof activityListInput>;

export type OpportunityView = {
  publicId: string;
  pipelinePublicId: string;
  stagePublicId: string;
  crmClientId: string | null;
  companyName?: string | null;
  customerStatus?: string | null;
  stageName?: string | null;
  stageColor?: string | null;
  title: string;
  valueCents: number;
  currency: string;
  expectedCloseDate: string | null;
  status: OpportunityStatus;
  lossReason: string | null;
  internalResponsible: string;
  observations: string | null;
  wonAt: string | null;
  lostAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ActivityView = {
  publicId: string;
  opportunityPublicId: string | null;
  opportunityTitle?: string | null;
  crmClientId: string | null;
  clientName?: string | null;
  type: ActivityType;
  title: string;
  description: string | null;
  dueAt: string | null;
  completedAt: string | null;
  status: ActivityStatus;
  assignedTo: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type OpportunityHistoryView = {
  publicId: string;
  opportunityPublicId: string;
  fromStagePublicId: string | null;
  toStagePublicId: string;
  fromValueCents: number | null;
  toValueCents: number;
  author: string;
  notes: string | null;
  createdAt: string;
};
