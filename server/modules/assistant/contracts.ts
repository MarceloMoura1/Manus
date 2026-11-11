import { z } from "zod";

export const createThreadSchema = z.object({
  title: z.string().trim().max(255).optional(),
});

export type CreateThreadInput = z.infer<typeof createThreadSchema>;

export const deleteThreadSchema = z.object({
  threadId: z.string().trim().min(1, "threadId é obrigatório"),
});

export type DeleteThreadInput = z.infer<typeof deleteThreadSchema>;

export const renameThreadSchema = z.object({
  threadId: z.string().trim().min(1, "threadId é obrigatório"),
  title: z.string().trim().min(1, "Título não pode ser vazio").max(255, "Título muito longo"),
});

export type RenameThreadInput = z.infer<typeof renameThreadSchema>;

export const getThreadMessagesSchema = z.object({
  threadId: z.string().trim().min(1, "threadId é obrigatório"),
});

export type GetThreadMessagesInput = z.infer<typeof getThreadMessagesSchema>;

export const assistantSettingsSchema = z.object({
  tone: z.enum(["pratico", "formal", "direto"]).default("pratico"),
  hitlRequired: z.boolean().default(true),
  handsFreeAudio: z.boolean().default(false),
  autoTranscribe: z.boolean().default(true),
});

export type AssistantSettingsInput = z.infer<typeof assistantSettingsSchema>;

export const sendThreadMessageSchema = z.object({
  threadId: z.string().trim().min(1, "threadId é obrigatório"),
  content: z.string().trim().min(1, "Mensagem não pode ser vazia").max(10000, "Mensagem muito longa"),
  settings: assistantSettingsSchema.optional(),
});

export type SendThreadMessageInput = z.infer<typeof sendThreadMessageSchema>;

export const sendThreadAudioMessageSchema = z.object({
  threadId: z.string().trim().min(1, "threadId é obrigatório"),
  audioBase64: z.string().trim().min(1, "Áudio não pode ser vazio"),
  mimeType: z.string().trim().min(1, "mimeType é obrigatório").default("audio/webm"),
  settings: assistantSettingsSchema.optional(),
});

export type SendThreadAudioMessageInput = z.infer<typeof sendThreadAudioMessageSchema>;

export interface AssistantThreadItem {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssistantMessageItem {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolInvocations: unknown | null;
  createdAt: Date;
}

// ─── Rotinas Autônomas & Agendador ──────────────────────────────────────────

export const routineDaySchema = z.enum(["seg", "ter", "qua", "qui", "sex", "sab", "dom"]);
export type RoutineDay = z.infer<typeof routineDaySchema>;

export const triggerTypeSchema = z.enum(["morning_briefing", "stale_leads", "eod_summary", "custom"]);
export type TriggerType = z.infer<typeof triggerTypeSchema>;

export const actionTargetSchema = z.enum(["chat_thread", "internal_notification", "whatsapp"]);
export type ActionTarget = z.infer<typeof actionTargetSchema>;

export const upsertRoutineSchema = z.object({
  id: z.string().trim().optional(),
  title: z.string().trim().min(1, "Título é obrigatório").max(255),
  scheduleTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:MM)"),
  scheduleDays: z.array(z.string()).min(1, "Selecione ao menos um dia da semana"),
  triggerType: triggerTypeSchema,
  promptInstruction: z.string().trim().min(1, "Instrução não pode ser vazia"),
  actionTarget: actionTargetSchema.default("chat_thread"),
  isActive: z.boolean().default(true),
});

export type UpsertRoutineInput = z.infer<typeof upsertRoutineSchema>;

export const toggleRoutineActiveSchema = z.object({
  id: z.string().trim().min(1, "id é obrigatório"),
  isActive: z.boolean(),
});
export type ToggleRoutineActiveInput = z.infer<typeof toggleRoutineActiveSchema>;

export const deleteRoutineSchema = z.object({
  id: z.string().trim().min(1, "id é obrigatório"),
});
export type DeleteRoutineInput = z.infer<typeof deleteRoutineSchema>;

export const runRoutineNowSchema = z.object({
  id: z.string().trim().min(1, "id é obrigatório"),
});
export type RunRoutineNowInput = z.infer<typeof runRoutineNowSchema>;

export interface RoutinePreset {
  triggerType: TriggerType;
  title: string;
  description: string;
  scheduleTime: string;
  scheduleDays: string[];
  promptInstruction: string;
  actionTarget: ActionTarget;
}

export const DEFAULT_ROUTINE_PRESETS: RoutinePreset[] = [
  {
    triggerType: "morning_briefing",
    title: "📋 Briefing Matinal: O que tenho que fazer hoje?",
    description: "Varre chamados urgentes, leads sem retorno e orçamentos abertos para entregar a lista de prioridades do dia.",
    scheduleTime: "08:30",
    scheduleDays: ["seg", "ter", "qua", "qui", "sex"],
    promptInstruction: "Consulte os chamados em aberto com SLA prioritário, os clientes que enviaram mensagem e aguardam retorno há mais de 24h e as propostas em negociação pendentes. Monte um resumo executivo direto e acionável com o título '📋 O QUE TEMOS PARA HOJE' contendo prioridades, alertas urgentes e lista de ação imediata.",
    actionTarget: "chat_thread",
  },
  {
    triggerType: "stale_leads",
    title: "⏱️ Radar de Clientes Parados (Follow-up 48h)",
    description: "Identifica negociações e mensagens sem interação há 2 dias e lista quem precisa ser contatado hoje.",
    scheduleTime: "11:00",
    scheduleDays: ["seg", "ter", "qua", "qui", "sex"],
    promptInstruction: "Analise os contatos do CRM e conversas recentes. Identifique clientes, leads ou propostas sem interação recente (há mais de 48h) e gere uma lista priorizada com o título '⏱️ RADAR DE FOLLOW-UP (48H)' destacando quem precisa ser contatado hoje, telefone/canal e motivo do follow-up.",
    actionTarget: "chat_thread",
  },
  {
    triggerType: "eod_summary",
    title: "📊 Fechamento e Pendências do Dia",
    description: "Gera o balanço de faturamento, chamados concluídos e o que ficou acumulado para o próximo turno.",
    scheduleTime: "18:00",
    scheduleDays: ["seg", "ter", "qua", "qui", "sex"],
    promptInstruction: "Consulte o faturamento e vendas registradas no dia, os chamados fechados e os que continuam em andamento ou pendentes. Monte um relatório executivo com o título '📊 FECHAMENTO E PENDÊNCIAS DO DIA' contendo balanço geral, conquistas do turno e pendências prioritárias para amanhã.",
    actionTarget: "chat_thread",
  },
];

