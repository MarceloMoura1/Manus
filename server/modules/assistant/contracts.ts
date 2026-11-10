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

