import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  megadeskAdminHermesMessages,
  type MegadeskAdminHermesMessage,
} from "../../../../drizzle/schema";
import type { HermesMessageItem, HermesRole } from "./contracts";

export class HermesRepository {
  private formatMessage(row: MegadeskAdminHermesMessage): HermesMessageItem {
    return {
      id: Number(row.id),
      adminUserId: row.adminUserId,
      role: row.role as HermesRole,
      content: row.content,
      metadataJson: (row.metadataJson as Record<string, unknown> | null) ?? null,
      createdAt: String(row.createdAt),
    };
  }

  async getHistory(adminUserId: string): Promise<HermesMessageItem[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(megadeskAdminHermesMessages)
      .where(eq(megadeskAdminHermesMessages.adminUserId, adminUserId))
      .orderBy(asc(megadeskAdminHermesMessages.createdAt), asc(megadeskAdminHermesMessages.id));

    return rows.map((r) => this.formatMessage(r));
  }

  async saveMessage(
    adminUserId: string,
    role: HermesRole,
    content: string,
    metadataJson?: Record<string, unknown> | null
  ): Promise<HermesMessageItem> {
    const db = getDb();
    const [result] = await db.insert(megadeskAdminHermesMessages).values({
      adminUserId,
      role,
      content,
      metadataJson: metadataJson ?? null,
    });

    const insertId = result?.insertId ? Number(result.insertId) : 0;

    return {
      id: insertId,
      adminUserId,
      role,
      content,
      metadataJson: metadataJson ?? null,
      createdAt: new Date().toISOString(),
    };
  }

  async clearHistory(adminUserId: string): Promise<{ success: boolean; clearedCount: number }> {
    const db = getDb();
    const rows = await db
      .select({ id: megadeskAdminHermesMessages.id })
      .from(megadeskAdminHermesMessages)
      .where(eq(megadeskAdminHermesMessages.adminUserId, adminUserId));

    if (rows.length > 0) {
      await db
        .delete(megadeskAdminHermesMessages)
        .where(eq(megadeskAdminHermesMessages.adminUserId, adminUserId));
    }

    return {
      success: true,
      clearedCount: rows.length,
    };
  }
}

export const hermesRepository = new HermesRepository();
