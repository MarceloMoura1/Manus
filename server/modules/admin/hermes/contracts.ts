import { z } from "zod";

export const sendMessageSchema = z.object({
  message: z.string().trim().min(1, "A mensagem não pode ser vazia").max(10000, "Mensagem muito longa"),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export type HermesRole = "user" | "assistant" | "system";

export interface HermesMessageItem {
  id: number;
  adminUserId: string;
  role: HermesRole;
  content: string;
  metadataJson: Record<string, unknown> | null;
  createdAt: string;
}

export interface HermesQuickStats {
  uptimeSeconds: number;
  uptimeFormatted: string;
  memoryUsageMb: number;
  timestamp: string;
  services: Array<{
    name: string;
    key: string;
    status: "online" | "warning" | "offline";
    details: string;
  }>;
  skills: Array<{
    name: string;
    category: string;
    description: string;
    status: "active" | "ready";
  }>;
}
