import { and, asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "../../db";
import {
  megadeskAiThreads,
  megadeskAiMessages,
  type MegadeskAiThread,
  type MegadeskAiMessage,
} from "../../../drizzle/schema";

export class AssistantThreadsRepository {
  async listThreads(tenantId: string, userId: string): Promise<MegadeskAiThread[]> {
    const db = getDb();
    return db
      .select()
      .from(megadeskAiThreads)
      .where(
        and(
          eq(megadeskAiThreads.tenantId, tenantId),
          eq(megadeskAiThreads.userId, userId)
        )
      )
      .orderBy(desc(megadeskAiThreads.updatedAt));
  }

  async getThread(tenantId: string, userId: string, threadId: string): Promise<MegadeskAiThread | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(megadeskAiThreads)
      .where(
        and(
          eq(megadeskAiThreads.id, threadId),
          eq(megadeskAiThreads.tenantId, tenantId),
          eq(megadeskAiThreads.userId, userId)
        )
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async createThread(tenantId: string, userId: string, title?: string): Promise<MegadeskAiThread> {
    const db = getDb();
    const id = randomUUID();
    const finalTitle = title?.trim() || "Nova Conversa";

    await db.insert(megadeskAiThreads).values({
      id,
      tenantId,
      userId,
      title: finalTitle,
    });

    const thread = await this.getThread(tenantId, userId, id);
    if (!thread) {
      throw new Error("Falha ao recuperar a thread criada.");
    }
    return thread;
  }

  async renameThread(
    tenantId: string,
    userId: string,
    threadId: string,
    title: string
  ): Promise<MegadeskAiThread> {
    const db = getDb();
    const existing = await this.getThread(tenantId, userId, threadId);
    if (!existing) {
      throw new Error("Thread não encontrada ou acesso não autorizado.");
    }

    await db
      .update(megadeskAiThreads)
      .set({
        title: title.trim(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(megadeskAiThreads.id, threadId),
          eq(megadeskAiThreads.tenantId, tenantId),
          eq(megadeskAiThreads.userId, userId)
        )
      );

    const updated = await this.getThread(tenantId, userId, threadId);
    if (!updated) {
      throw new Error("Falha ao atualizar a thread.");
    }
    return updated;
  }

  async deleteThread(tenantId: string, userId: string, threadId: string): Promise<{ success: boolean; threadId: string }> {
    const db = getDb();
    const existing = await this.getThread(tenantId, userId, threadId);
    if (!existing) {
      throw new Error("Thread não encontrada ou acesso não autorizado.");
    }

    // Com onDelete: 'cascade', mensagens são removidas automaticamente,
    // mas fazemos delete explícito em lote para consistência e segurança.
    await db
      .delete(megadeskAiMessages)
      .where(eq(megadeskAiMessages.threadId, threadId));

    await db
      .delete(megadeskAiThreads)
      .where(
        and(
          eq(megadeskAiThreads.id, threadId),
          eq(megadeskAiThreads.tenantId, tenantId),
          eq(megadeskAiThreads.userId, userId)
        )
      );

    return { success: true, threadId };
  }

  async getThreadMessages(threadId: string): Promise<MegadeskAiMessage[]> {
    const db = getDb();
    return db
      .select()
      .from(megadeskAiMessages)
      .where(eq(megadeskAiMessages.threadId, threadId))
      .orderBy(asc(megadeskAiMessages.createdAt));
  }

  async saveMessage(
    threadId: string,
    role: "user" | "assistant" | "system",
    content: string,
    toolInvocations?: unknown
  ): Promise<MegadeskAiMessage> {
    const db = getDb();
    const id = randomUUID();

    await db.insert(megadeskAiMessages).values({
      id,
      threadId,
      role,
      content,
      toolInvocations: toolInvocations ?? null,
    });

    const rows = await db
      .select()
      .from(megadeskAiMessages)
      .where(eq(megadeskAiMessages.id, id))
      .limit(1);

    if (!rows[0]) {
      throw new Error("Falha ao salvar mensagem da thread.");
    }
    return rows[0];
  }

  async touchThread(threadId: string, newTitle?: string): Promise<void> {
    const db = getDb();
    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (newTitle) {
      updates.title = newTitle.trim();
    }
    await db
      .update(megadeskAiThreads)
      .set(updates)
      .where(eq(megadeskAiThreads.id, threadId));
  }

  async updateMessageContent(
    messageId: string,
    content: string,
    toolInvocations?: unknown
  ): Promise<MegadeskAiMessage | null> {
    const db = getDb();
    const updateData: Record<string, unknown> = { content };
    if (toolInvocations !== undefined) {
      updateData.toolInvocations = toolInvocations;
    }
    await db
      .update(megadeskAiMessages)
      .set(updateData)
      .where(eq(megadeskAiMessages.id, messageId));

    const rows = await db
      .select()
      .from(megadeskAiMessages)
      .where(eq(megadeskAiMessages.id, messageId))
      .limit(1);

    return rows[0] ?? null;
  }
}

export const assistantThreadsRepository = new AssistantThreadsRepository();

