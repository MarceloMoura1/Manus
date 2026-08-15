/**
 * WhatsApp Module — Repository: WaConversation
 * Operações de banco para conversas WhatsApp.
 * Todas as queries filtram por clientId (isolamento multiempresa).
 */
import { getDb } from "../../../db";
import { waConversations } from "../../../../drizzle/schema";
import { eq, and, desc, like, or, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { WaConversationRecord, WaConversationStatus } from "../types";
import { parseDatabaseTimestamp } from "./timestamp";

const db = getDb();
type ConversationRow = typeof waConversations.$inferSelect;

function toConversationRecord(row: ConversationRow): WaConversationRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    accountId: row.accountId,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    lastMessage: row.lastMessage,
    lastMessageAt: parseDatabaseTimestamp(row.lastMessageAt, "wa_conversations.last_message_at"),
    unreadCount: row.unreadCount,
    status: row.status,
    assignedUserId: row.assignedUserId,
    crmClientId: row.crmClientId,
    metadataJson: row.metadataJson,
    createdAt: parseDatabaseTimestamp(row.createdAt, "wa_conversations.created_at"),
    updatedAt: parseDatabaseTimestamp(row.updatedAt, "wa_conversations.updated_at"),
  };
}

function databaseTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export async function findOrCreateConversation(
  clientId: string,
  accountId: string,
  customerPhone: string,
  customerName: string
): Promise<{ conversation: WaConversationRecord; isNew: boolean }> {
  // Buscar conversa aberta existente para este número
  const [existing] = await db
    .select()
    .from(waConversations)
    .where(
      and(
        eq(waConversations.clientId, clientId),
        eq(waConversations.accountId, accountId),
        eq(waConversations.customerPhone, customerPhone),
        eq(waConversations.status, "open")
      )
    )
    .limit(1);

  if (existing) {
    return { conversation: toConversationRecord(existing), isNew: false };
  }

  // Criar nova conversa
  const id = randomUUID();
  await db.insert(waConversations).values({
    id,
    clientId,
    accountId,
    customerPhone,
    customerName,
    status: "open",
    unreadCount: 0,
    lastMessageAt: databaseTimestamp(),
  });

  const [created] = await db
    .select()
    .from(waConversations)
    .where(and(eq(waConversations.id, id), eq(waConversations.clientId, clientId)));

  if (!created) throw new Error("Conversa recém-criada não foi encontrada.");
  return { conversation: toConversationRecord(created), isNew: true };
}

export async function listConversations(
  clientId: string,
  opts: {
    accountId?: string;
    status?: WaConversationStatus;
    search?: string;
    limit?: number;
    offset?: number;
  }
): Promise<WaConversationRecord[]> {
  const { accountId, status, search, limit = 50, offset = 0 } = opts;

  const conditions = [eq(waConversations.clientId, clientId)];
  if (accountId) conditions.push(eq(waConversations.accountId, accountId));
  if (status) conditions.push(eq(waConversations.status, status));
  if (search) {
    const searchCondition = or(
        like(waConversations.customerName, `%${search}%`),
        like(waConversations.customerPhone, `%${search}%`)
      );
    if (searchCondition) conditions.push(searchCondition);
  }

  const rows = await db
    .select()
    .from(waConversations)
    .where(and(...conditions))
    .orderBy(desc(waConversations.lastMessageAt))
    .limit(limit)
    .offset(offset);

  return rows.map(toConversationRecord);
}

export async function getConversationById(id: string, clientId: string): Promise<WaConversationRecord | null> {
  const [row] = await db
    .select()
    .from(waConversations)
    .where(and(eq(waConversations.id, id), eq(waConversations.clientId, clientId)));
  return row ? toConversationRecord(row) : null;
}

export async function updateConversationLastMessage(
  id: string,
  clientId: string,
  lastMessage: string,
  incrementUnread = false
): Promise<void> {
  await db.update(waConversations)
    .set({
      lastMessage,
      lastMessageAt: databaseTimestamp(),
      ...(incrementUnread ? { unreadCount: sql`${waConversations.unreadCount} + 1` } : {}),
      updatedAt: databaseTimestamp(),
    })
    .where(and(eq(waConversations.id, id), eq(waConversations.clientId, clientId)));
}

export async function markConversationRead(id: string, clientId: string): Promise<void> {
  await db.update(waConversations)
    .set({ unreadCount: 0, updatedAt: databaseTimestamp() })
    .where(and(eq(waConversations.id, id), eq(waConversations.clientId, clientId)));
}

export async function updateConversationStatus(
  id: string,
  clientId: string,
  status: WaConversationStatus
): Promise<void> {
  await db.update(waConversations)
    .set({ status, updatedAt: databaseTimestamp() })
    .where(and(eq(waConversations.id, id), eq(waConversations.clientId, clientId)));
}

export async function updateConversation(
  id: string,
  clientId: string,
  data: Partial<{
    status: WaConversationStatus;
    assignedUserId: string | null;
    customerName: string;
    crmClientId: string | null;
  }>
): Promise<void> {
  await db.update(waConversations)
    .set({ ...data, updatedAt: databaseTimestamp() })
    .where(and(eq(waConversations.id, id), eq(waConversations.clientId, clientId)));
}
