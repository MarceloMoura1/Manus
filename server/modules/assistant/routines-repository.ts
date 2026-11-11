import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "../../db";
import {
  megadeskAiRoutines,
  megadeskAiRoutineLogs,
  type MegadeskAiRoutine,
  type MegadeskAiRoutineLog,
} from "../../../drizzle/schema";
import type { UpsertRoutineInput } from "./contracts";

export class AssistantRoutinesRepository {
  async listRoutines(tenantId: string, userId?: string): Promise<MegadeskAiRoutine[]> {
    const db = getDb();
    const conditions = [eq(megadeskAiRoutines.tenantId, tenantId)];
    if (userId) {
      // Opcionalmente filtra por usuário, ou retorna todas do tenant
      // Para visibilidade da equipe/tenant ou isolamento por usuário
    }
    return db
      .select()
      .from(megadeskAiRoutines)
      .where(and(...conditions))
      .orderBy(desc(megadeskAiRoutines.createdAt));
  }

  async getRoutine(tenantId: string, id: string): Promise<MegadeskAiRoutine | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(megadeskAiRoutines)
      .where(
        and(
          eq(megadeskAiRoutines.id, id),
          eq(megadeskAiRoutines.tenantId, tenantId)
        )
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async upsertRoutine(
    tenantId: string,
    userId: string,
    data: UpsertRoutineInput
  ): Promise<MegadeskAiRoutine> {
    const db = getDb();
    if (data.id) {
      const existing = await this.getRoutine(tenantId, data.id);
      if (!existing) {
        throw new Error("Rotina não encontrada ou acesso não autorizado.");
      }

      await db
        .update(megadeskAiRoutines)
        .set({
          title: data.title.trim(),
          scheduleTime: data.scheduleTime,
          scheduleDays: data.scheduleDays,
          triggerType: data.triggerType,
          promptInstruction: data.promptInstruction.trim(),
          actionTarget: data.actionTarget,
          isActive: data.isActive,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(megadeskAiRoutines.id, data.id),
            eq(megadeskAiRoutines.tenantId, tenantId)
          )
        );

      const updated = await this.getRoutine(tenantId, data.id);
      if (!updated) {
        throw new Error("Falha ao atualizar rotina.");
      }
      return updated;
    }

    const newId = randomUUID();
    await db.insert(megadeskAiRoutines).values({
      id: newId,
      tenantId,
      userId,
      title: data.title.trim(),
      scheduleTime: data.scheduleTime,
      scheduleDays: data.scheduleDays,
      triggerType: data.triggerType,
      promptInstruction: data.promptInstruction.trim(),
      actionTarget: data.actionTarget,
      isActive: data.isActive,
    });

    const created = await this.getRoutine(tenantId, newId);
    if (!created) {
      throw new Error("Falha ao criar rotina.");
    }
    return created;
  }

  async toggleRoutineActive(
    tenantId: string,
    id: string,
    isActive: boolean
  ): Promise<MegadeskAiRoutine> {
    const db = getDb();
    const existing = await this.getRoutine(tenantId, id);
    if (!existing) {
      throw new Error("Rotina não encontrada ou acesso não autorizado.");
    }

    await db
      .update(megadeskAiRoutines)
      .set({
        isActive,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(megadeskAiRoutines.id, id),
          eq(megadeskAiRoutines.tenantId, tenantId)
        )
      );

    const updated = await this.getRoutine(tenantId, id);
    if (!updated) {
      throw new Error("Falha ao alternar status da rotina.");
    }
    return updated;
  }

  async deleteRoutine(
    tenantId: string,
    id: string
  ): Promise<{ success: boolean; id: string }> {
    const db = getDb();
    const existing = await this.getRoutine(tenantId, id);
    if (!existing) {
      throw new Error("Rotina não encontrada ou acesso não autorizado.");
    }

    await db
      .delete(megadeskAiRoutines)
      .where(
        and(
          eq(megadeskAiRoutines.id, id),
          eq(megadeskAiRoutines.tenantId, tenantId)
        )
      );

    return { success: true, id };
  }

  async updateLastRunAt(id: string, date: Date = new Date()): Promise<void> {
    const db = getDb();
    await db
      .update(megadeskAiRoutines)
      .set({
        lastRunAt: date,
        updatedAt: new Date(),
      })
      .where(eq(megadeskAiRoutines.id, id));
  }

  async createLog(data: {
    id?: string;
    routineId: string;
    tenantId: string;
    status: "success" | "warning" | "error";
    outputSummary: string;
  }): Promise<MegadeskAiRoutineLog> {
    const db = getDb();
    const logId = data.id || randomUUID();
    await db.insert(megadeskAiRoutineLogs).values({
      id: logId,
      routineId: data.routineId,
      tenantId: data.tenantId,
      status: data.status,
      outputSummary: data.outputSummary,
    });

    const rows = await db
      .select()
      .from(megadeskAiRoutineLogs)
      .where(eq(megadeskAiRoutineLogs.id, logId))
      .limit(1);

    if (!rows[0]) {
      throw new Error("Falha ao salvar log da rotina.");
    }
    return rows[0];
  }

  async listRecentLogs(tenantId: string, limit = 5): Promise<MegadeskAiRoutineLog[]> {
    const db = getDb();
    return db
      .select()
      .from(megadeskAiRoutineLogs)
      .where(eq(megadeskAiRoutineLogs.tenantId, tenantId))
      .orderBy(desc(megadeskAiRoutineLogs.createdAt))
      .limit(limit);
  }

  async listLogsByRoutine(
    tenantId: string,
    routineId: string,
    limit = 10
  ): Promise<MegadeskAiRoutineLog[]> {
    const db = getDb();
    return db
      .select()
      .from(megadeskAiRoutineLogs)
      .where(
        and(
          eq(megadeskAiRoutineLogs.tenantId, tenantId),
          eq(megadeskAiRoutineLogs.routineId, routineId)
        )
      )
      .orderBy(desc(megadeskAiRoutineLogs.createdAt))
      .limit(limit);
  }

  async getActiveRoutines(tenantId?: string): Promise<MegadeskAiRoutine[]> {
    const db = getDb();
    const conditions = [eq(megadeskAiRoutines.isActive, true)];
    if (tenantId) {
      conditions.push(eq(megadeskAiRoutines.tenantId, tenantId));
    }
    return db
      .select()
      .from(megadeskAiRoutines)
      .where(and(...conditions));
  }
}

export const assistantRoutinesRepository = new AssistantRoutinesRepository();

