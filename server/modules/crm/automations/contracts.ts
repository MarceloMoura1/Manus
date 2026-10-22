import { z } from "zod";

export const triggerTypes = [
  "lead.created",
  "lead.stage_changed",
  "opportunity.won",
  "opportunity.lost",
  "activity.overdue",
  "custom",
] as const;

export type TriggerType = (typeof triggerTypes)[number];

export const actionTypes = [
  "create_task",
  "assign_owner",
  "add_tag",
  "send_whatsapp",
  "ai_qualify",
  "call_webhook",
] as const;

export type ActionType = (typeof actionTypes)[number];

export const conditionOpSchema = z.enum(["eq", "neq", "contains"]);

export const ruleConditionSchema = z.object({
  field: z.string().trim().min(1, "Campo é obrigatório."),
  op: conditionOpSchema,
  value: z.string().default(""),
});

export type RuleConditionInput = z.infer<typeof ruleConditionSchema>;

export const ruleActionSchema = z.object({
  type: z.enum(actionTypes),
  config: z.record(z.string(), z.unknown()).default({}),
});

export type RuleActionInput = z.infer<typeof ruleActionSchema>;

export const ruleCreateInput = z.object({
  name: z.string().trim().min(1, "Nome da regra é obrigatório.").max(150),
  description: z.string().trim().max(1000).optional().nullable(),
  triggerType: z.enum(triggerTypes),
  conditions: z.array(ruleConditionSchema).default([]),
  actions: z.array(ruleActionSchema).min(1, "A regra deve conter pelo menos uma ação."),
  isActive: z.boolean().default(true),
});

export type RuleCreateInput = z.infer<typeof ruleCreateInput>;

export const ruleUpdateInput = z.object({
  publicId: z.string().uuid(),
  name: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  triggerType: z.enum(triggerTypes).optional(),
  conditions: z.array(ruleConditionSchema).optional(),
  actions: z.array(ruleActionSchema).min(1).optional(),
  isActive: z.boolean().optional(),
});

export type RuleUpdateInput = z.infer<typeof ruleUpdateInput>;

export const webhookSourceCreateInput = z.object({
  name: z.string().trim().min(1, "Nome da fonte de webhook é obrigatório.").max(120),
  defaultStageId: z.number().int().optional().nullable(),
  fieldMappings: z
    .object({
      name: z.string().default("name"),
      phone: z.string().default("phone"),
      email: z.string().default("email"),
      company: z.string().default("company"),
      notes: z.string().default("message"),
      origin: z.string().default("website"),
    })
    .default({
      name: "name",
      phone: "phone",
      email: "email",
      company: "company",
      notes: "message",
      origin: "website",
    }),
});

export type WebhookSourceCreateInput = z.infer<typeof webhookSourceCreateInput>;

export const webhookSourceUpdateInput = z.object({
  publicId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  defaultStageId: z.number().int().optional().nullable(),
  fieldMappings: z.record(z.string(), z.string()).optional(),
  isActive: z.boolean().optional(),
});

export type WebhookSourceUpdateInput = z.infer<typeof webhookSourceUpdateInput>;

export const aiSettingsUpdateInput = z.object({
  isEnabled: z.boolean().optional(),
  systemPrompt: z.string().trim().max(10000).optional().nullable(),
  qualificationCriteria: z.string().trim().max(10000).optional().nullable(),
  autoSuggestNextAction: z.boolean().optional(),
  modelName: z.string().trim().max(50).optional(),
});

export type AiSettingsUpdateInput = z.infer<typeof aiSettingsUpdateInput>;

export const aiSuggestNextActionInput = z.object({
  opportunityPublicId: z.string().uuid().optional(),
  crmClientId: z.string().optional(),
  contextNotes: z.string().trim().optional(),
});

export type AiSuggestNextActionInput = z.infer<typeof aiSuggestNextActionInput>;
