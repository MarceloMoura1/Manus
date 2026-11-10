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

export const sendThreadMessageSchema = z.object({
  threadId: z.string().trim().min(1, "threadId é obrigatório"),
  content: z.string().trim().min(1, "Mensagem não pode ser vazia").max(10000, "Mensagem muito longa"),
});

export type SendThreadMessageInput = z.infer<typeof sendThreadMessageSchema>;

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
