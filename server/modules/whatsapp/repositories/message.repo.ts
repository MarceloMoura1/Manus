/**
 * WhatsApp Module — Repository: WaMessage
 * Operações de banco para mensagens WhatsApp.
 * Todas as queries filtram por clientId (isolamento multiempresa).
 */
import { getDb } from "../../../db";
import { waMessages } from "../../../../drizzle/schema";
import { eq, and, desc, lt } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { WaMessageRecord, WaSenderType, WaMessageType, WaMessageStatus } from "../types";

const db = getDb();

export interface CreateMessageInput {
  conversationId: string;
  clientId: string;
  waMessageId?: string;
  senderType: WaSenderType;
  messageType: WaMessageType;
  content?: string;
  mediaUrl?: string;
  mediaId?: string;
  caption?: string;
  metadata?: Record<string, unknown>;
}

export async function createMessage(input: CreateMessageInput): Promise<WaMessageRecord> {
  const id = randomUUID();
  await db.insert(waMessages).values({
    id,
    conversationId: input.conversationId,
    clientId: input.clientId,
    waMessageId: input.waMessageId ?? null,
    senderType: input.senderType,
    messageType: input.messageType,
    content: input.content ?? "",
    mediaUrl: input.mediaUrl ?? null,
    mediaId: input.mediaId ?? null,
    caption: input.caption ?? null,
    status: input.senderType === "customer" ? "read" : "pending",
    metadataJson: JSON.stringify(input.metadata ?? {}),
  });

  const [row] = await db
    .select()
    .from(waMessages)
    .where(and(eq(waMessages.id, id), eq(waMessages.clientId, input.clientId)));

  return row as WaMessageRecord;
}

export async function listMessages(
  conversationId: string,
  clientId: string,
  opts: { limit?: number; before?: string } = {}
): Promise<WaMessageRecord[]> {
  const { limit = 50, before } = opts;

  const conditions = [
    eq(waMessages.conversationId, conversationId),
    eq(waMessages.clientId, clientId),
  ];

  if (before) {
    // Paginação por cursor: mensagens anteriores ao ID fornecido
    const [cursor] = await db
      .select({ createdAt: waMessages.createdAt })
      .from(waMessages)
      .where(eq(waMessages.id, before));
    if (cursor) {
      conditions.push(lt(waMessages.createdAt, cursor.createdAt));
    }
  }

  const rows = await db
    .select()
    .from(waMessages)
    .where(and(...conditions))
    .orderBy(desc(waMessages.createdAt))
    .limit(limit);

  // Retornar em ordem cronológica (mais antigas primeiro)
  return (rows as WaMessageRecord[]).reverse();
}

export async function updateMessageStatus(
  waMessageId: string,
  status: WaMessageStatus
): Promise<void> {
  await db
    .update(waMessages)
    .set({ status })
    .where(eq(waMessages.waMessageId, waMessageId));
}

export async function updateMessageWaId(
  id: string,
  waMessageId: string,
  status: WaMessageStatus = "sent"
): Promise<void> {
  await db
    .update(waMessages)
    .set({ waMessageId, status })
    .where(eq(waMessages.id, id));
}

export async function getMessageByWaId(waMessageId: string): Promise<WaMessageRecord | null> {
  const [row] = await db
    .select()
    .from(waMessages)
    .where(eq(waMessages.waMessageId, waMessageId));
  return (row as WaMessageRecord) ?? null;
}

export async function markMessageFailed(id: string, errorMessage: string): Promise<void> {
  await db
    .update(waMessages)
    .set({ status: "failed", errorMessage })
    .where(eq(waMessages.id, id));
}
