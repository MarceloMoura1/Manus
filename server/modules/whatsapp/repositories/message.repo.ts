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
import { parseDatabaseTimestamp } from "./timestamp";

const db = getDb();
type MessageRow = typeof waMessages.$inferSelect;

function toMessageRecord(row: MessageRow): WaMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    clientId: row.clientId,
    waMessageId: row.waMessageId,
    senderType: row.senderType,
    messageType: row.messageType,
    content: row.content,
    mediaUrl: row.mediaUrl,
    mediaId: row.mediaId,
    caption: row.caption,
    status: row.status,
    errorMessage: row.errorMessage,
    metadataJson: row.metadataJson,
    createdAt: parseDatabaseTimestamp(row.createdAt, "wa_messages.created_at"),
  };
}

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

  if (!row) throw new Error("Mensagem recém-criada não foi encontrada.");
  return toMessageRecord(row);
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
      .where(and(
        eq(waMessages.id, before),
        eq(waMessages.clientId, clientId),
        eq(waMessages.conversationId, conversationId),
      ));
    if (!cursor) throw new Error("MESSAGE_CURSOR_OUT_OF_SCOPE");
    conditions.push(lt(waMessages.createdAt, cursor.createdAt));
  }

  const rows = await db
    .select()
    .from(waMessages)
    .where(and(...conditions))
    .orderBy(desc(waMessages.createdAt))
    .limit(limit);

  // Retornar em ordem cronológica (mais antigas primeiro)
  return rows.map(toMessageRecord).reverse();
}

export async function updateMessageStatus(
  clientId: string,
  waMessageId: string,
  status: WaMessageStatus
): Promise<void> {
  await db
    .update(waMessages)
    .set({ status })
    .where(and(eq(waMessages.clientId, clientId), eq(waMessages.waMessageId, waMessageId)));
}

export async function updateMessageWaId(
  clientId: string,
  id: string,
  waMessageId: string,
  status: WaMessageStatus = "sent"
): Promise<void> {
  await db
    .update(waMessages)
    .set({ waMessageId, status })
    .where(and(eq(waMessages.clientId, clientId), eq(waMessages.id, id)));
}

export async function getMessageById(clientId: string, id: string): Promise<WaMessageRecord | null> {
  const [row] = await db.select().from(waMessages)
    .where(and(eq(waMessages.clientId, clientId), eq(waMessages.id, id)));
  return row ? toMessageRecord(row) : null;
}

export async function getMessageByWaId(clientId: string, waMessageId: string): Promise<WaMessageRecord | null> {
  const [row] = await db
    .select()
    .from(waMessages)
    .where(and(eq(waMessages.clientId, clientId), eq(waMessages.waMessageId, waMessageId)));
  return row ? toMessageRecord(row) : null;
}

export async function markMessageFailed(clientId: string, id: string, errorMessage: string): Promise<void> {
  await db
    .update(waMessages)
    .set({ status: "failed", errorMessage })
    .where(and(eq(waMessages.clientId, clientId), eq(waMessages.id, id)));
}
