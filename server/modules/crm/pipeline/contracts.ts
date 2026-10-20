import { z } from "zod";

export const pipelinePublicIdSchema = z
  .string()
  .uuid("Identificador do funil deve ser um UUID válido.");

export const stagePublicIdSchema = z
  .string()
  .uuid("Identificador da etapa deve ser um UUID válido.");

export const pipelineNameSchema = z
  .string()
  .trim()
  .min(1, "Nome do funil é obrigatório.")
  .max(120, "Nome do funil não pode exceder 120 caracteres.");

export const stageNameSchema = z
  .string()
  .trim()
  .min(1, "Nome da etapa é obrigatório.")
  .max(120, "Nome da etapa não pode exceder 120 caracteres.");

export const stageProbabilityPctSchema = z
  .number()
  .int("Probabilidade deve ser um número inteiro.")
  .min(0, "Probabilidade mínima é 0%.")
  .max(100, "Probabilidade máxima é 100%.");

export const stageColorSchema = z
  .string()
  .trim()
  .regex(
    /^#(?:[0-9a-fA-F]{3}){1,2}$/,
    "Cor deve estar no formato hexadecimal (ex.: #6366F1)."
  )
  .max(20, "Código de cor inválido.");

export const stageSlaDaysSchema = z
  .number()
  .int("SLA deve ser um número inteiro de dias.")
  .min(1, "SLA mínimo é de 1 dia.")
  .max(365, "SLA máximo permitido é de 365 dias.")
  .optional()
  .nullable();

export const pipelineCreateInput = z.object({
  name: pipelineNameSchema,
  isDefault: z.boolean().optional().default(false),
  displayOrder: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export type PipelineCreateInput = z.infer<typeof pipelineCreateInput>;

export const pipelineUpdateInput = z.object({
  pipelinePublicId: pipelinePublicIdSchema,
  name: pipelineNameSchema.optional(),
  isDefault: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export type PipelineUpdateInput = z.infer<typeof pipelineUpdateInput>;

export const stageCreateInput = z.object({
  pipelinePublicId: pipelinePublicIdSchema,
  name: stageNameSchema,
  displayOrder: z.number().int().min(0).optional().default(0),
  probabilityPct: stageProbabilityPctSchema.optional().default(0),
  color: stageColorSchema.optional().default("#6366F1"),
  slaDays: stageSlaDaysSchema,
});

export type StageCreateInput = z.infer<typeof stageCreateInput>;

export const stageUpdateInput = z.object({
  stagePublicId: stagePublicIdSchema,
  name: stageNameSchema.optional(),
  displayOrder: z.number().int().min(0).optional(),
  probabilityPct: stageProbabilityPctSchema.optional(),
  color: stageColorSchema.optional(),
  slaDays: stageSlaDaysSchema,
});

export type StageUpdateInput = z.infer<typeof stageUpdateInput>;

export type StageView = {
  publicId: string;
  pipelinePublicId: string;
  name: string;
  displayOrder: number;
  probabilityPct: number;
  color: string;
  slaDays: number | null;
  createdAt: string;
  updatedAt: string;
};

export type PipelineView = {
  publicId: string;
  name: string;
  isDefault: boolean;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  stages?: StageView[];
};
