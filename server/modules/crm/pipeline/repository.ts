import { getPool } from "../../../db";
import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type {
  PipelineCreateInput,
  PipelineUpdateInput,
  StageCreateInput,
  StageUpdateInput,
  PipelineView,
  StageView,
} from "./contracts";

export interface PipelineRecord {
  id: number;
  publicId: string;
  clientId: string;
  name: string;
  isDefault: boolean;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StageRecord {
  id: number;
  publicId: string;
  clientId: string;
  pipelineId: number;
  name: string;
  displayOrder: number;
  probabilityPct: number;
  color: string;
  slaDays: number | null;
  createdAt: string;
  updatedAt: string;
}

function mapRowToStageView(row: any, pipelinePublicId: string): StageView {
  return {
    publicId: row.public_id,
    pipelinePublicId,
    name: row.name,
    displayOrder: Number(row.display_order ?? 0),
    probabilityPct: Number(row.probability_pct ?? 0),
    color: row.color || "#6366F1",
    slaDays: row.sla_days !== null && row.sla_days !== undefined ? Number(row.sla_days) : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function mapRowToPipelineView(row: any, stages?: StageView[]): PipelineView {
  return {
    publicId: row.public_id,
    name: row.name,
    isDefault: Boolean(row.is_default),
    displayOrder: Number(row.display_order ?? 0),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    stages,
  };
}

export async function listPipelines(clientId: string): Promise<PipelineView[]> {
  const pool = getPool();
  const [pipelineRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, public_id, name, is_default, display_order, is_active, created_at, updated_at
     FROM megadesk_crm_pipelines
     WHERE client_id = ? AND is_active = 1
     ORDER BY is_default DESC, display_order ASC, id ASC`,
    [clientId]
  );

  if (!pipelineRows || pipelineRows.length === 0) {
    return [];
  }

  const pipelineIds = pipelineRows.map(r => r.id);
  const [stageRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, public_id, pipeline_id, name, display_order, probability_pct, color, sla_days, created_at, updated_at
     FROM megadesk_crm_stages
     WHERE client_id = ? AND pipeline_id IN (?)
     ORDER BY display_order ASC, id ASC`,
    [clientId, pipelineIds]
  );

  const pipelineMap = new Map<number, { view: PipelineView; stages: StageView[] }>();
  for (const pRow of pipelineRows) {
    const view = mapRowToPipelineView(pRow, []);
    pipelineMap.set(pRow.id, { view, stages: [] });
  }

  for (const sRow of stageRows) {
    const entry = pipelineMap.get(sRow.pipeline_id);
    if (entry) {
      entry.stages.push(mapRowToStageView(sRow, entry.view.publicId));
    }
  }

  return Array.from(pipelineMap.values()).map(({ view, stages }) => ({
    ...view,
    stages,
  }));
}

export async function getPipelineByPublicId(
  clientId: string,
  publicId: string
): Promise<PipelineView | null> {
  const pool = getPool();
  const [pipelineRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, public_id, name, is_default, display_order, is_active, created_at, updated_at
     FROM megadesk_crm_pipelines
     WHERE client_id = ? AND public_id = ?
     LIMIT 1`,
    [clientId, publicId]
  );

  if (!pipelineRows || pipelineRows.length === 0) {
    return null;
  }

  const pRow = pipelineRows[0];
  const [stageRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, public_id, pipeline_id, name, display_order, probability_pct, color, sla_days, created_at, updated_at
     FROM megadesk_crm_stages
     WHERE client_id = ? AND pipeline_id = ?
     ORDER BY display_order ASC, id ASC`,
    [clientId, pRow.id]
  );

  const stages = stageRows.map(s => mapRowToStageView(s, pRow.public_id));
  return mapRowToPipelineView(pRow, stages);
}

export async function findInternalPipelineByPublicId(
  clientId: string,
  publicId: string
): Promise<{ id: number; publicId: string } | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, public_id FROM megadesk_crm_pipelines WHERE client_id = ? AND public_id = ? LIMIT 1`,
    [clientId, publicId]
  );
  if (!rows || rows.length === 0) return null;
  return { id: Number(rows[0].id), publicId: rows[0].public_id };
}

export async function findInternalStageByPublicId(
  clientId: string,
  publicId: string
): Promise<{ id: number; publicId: string; pipelineId: number; name: string; probabilityPct: number; color: string } | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, public_id, pipeline_id, name, probability_pct, color FROM megadesk_crm_stages WHERE client_id = ? AND public_id = ? LIMIT 1`,
    [clientId, publicId]
  );
  if (!rows || rows.length === 0) return null;
  return {
    id: Number(rows[0].id),
    publicId: rows[0].public_id,
    pipelineId: Number(rows[0].pipeline_id),
    name: rows[0].name,
    probabilityPct: Number(rows[0].probability_pct ?? 0),
    color: rows[0].color,
  };
}

export async function ensureDefaultPipeline(clientId: string): Promise<PipelineView> {
  const pool = getPool();

  // Fast check outside transaction
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id, public_id, name, is_default, display_order, is_active, created_at, updated_at
     FROM megadesk_crm_pipelines
     WHERE client_id = ? AND is_default = 1
     LIMIT 1`,
    [clientId]
  );

  if (existing && existing.length > 0) {
    const pRow = existing[0];
    const [stageRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, public_id, pipeline_id, name, display_order, probability_pct, color, sla_days, created_at, updated_at
       FROM megadesk_crm_stages
       WHERE client_id = ? AND pipeline_id = ?
       ORDER BY display_order ASC, id ASC`,
      [clientId, pRow.id]
    );
    const stages = stageRows.map(s => mapRowToStageView(s, pRow.public_id));
    return mapRowToPipelineView(pRow, stages);
  }

  // Safe transactional creation with concurrency control
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [locked] = await connection.query<RowDataPacket[]>(
      `SELECT id, public_id, name, is_default, display_order, is_active, created_at, updated_at
       FROM megadesk_crm_pipelines
       WHERE client_id = ? AND is_default = 1
       FOR UPDATE`,
      [clientId]
    );

    if (locked && locked.length > 0) {
      const pRow = locked[0];
      const [stageRows] = await connection.query<RowDataPacket[]>(
        `SELECT id, public_id, pipeline_id, name, display_order, probability_pct, color, sla_days, created_at, updated_at
         FROM megadesk_crm_stages
         WHERE client_id = ? AND pipeline_id = ?
         ORDER BY display_order ASC, id ASC`,
        [clientId, pRow.id]
      );
      await connection.commit();
      const stages = stageRows.map(s => mapRowToStageView(s, pRow.public_id));
      return mapRowToPipelineView(pRow, stages);
    }

    const pipelinePublicId = randomUUID();
    const [res] = await connection.execute<ResultSetHeader>(
      `INSERT INTO megadesk_crm_pipelines
       (public_id, client_id, name, is_default, display_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, 0, 1, NOW(), NOW())`,
      [pipelinePublicId, clientId, "Funil de Vendas Padrão"]
    );
    const pipelineId = res.insertId;

    const defaultStages = [
      { name: "Qualificação", order: 0, pct: 20, color: "#3B82F6", sla: 3 },
      { name: "Contato / Apresentação", order: 1, pct: 40, color: "#8B5CF6", sla: 5 },
      { name: "Proposta Comercial", order: 2, pct: 70, color: "#F59E0B", sla: 7 },
      { name: "Fechado / Ganho", order: 3, pct: 100, color: "#10B981", sla: null },
      { name: "Perdido", order: 4, pct: 0, color: "#EF4444", sla: null },
    ];

    const createdStages: StageView[] = [];
    const nowIso = new Date().toISOString();

    for (const s of defaultStages) {
      const stagePublicId = randomUUID();
      await connection.execute(
        `INSERT INTO megadesk_crm_stages
         (public_id, client_id, pipeline_id, name, display_order, probability_pct, color, sla_days, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [stagePublicId, clientId, pipelineId, s.name, s.order, s.pct, s.color, s.sla]
      );
      createdStages.push({
        publicId: stagePublicId,
        pipelinePublicId,
        name: s.name,
        displayOrder: s.order,
        probabilityPct: s.pct,
        color: s.color,
        slaDays: s.sla,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }

    await connection.commit();

    return {
      publicId: pipelinePublicId,
      name: "Funil de Vendas Padrão",
      isDefault: true,
      displayOrder: 0,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
      stages: createdStages,
    };
  } catch (error: any) {
    await connection.rollback();

    // Check if it's ER_DUP_ENTRY on the expected default pipeline unique constraint
    const isExpectedDuplicate =
      error?.code === "ER_DUP_ENTRY" &&
      (error?.message?.includes("uq_mcp_tenant_default") ||
        error?.message?.includes("default_marker") ||
        error?.sqlMessage?.includes("uq_mcp_tenant_default") ||
        error?.sqlMessage?.includes("default_marker"));

    if (isExpectedDuplicate) {
      // Another concurrent thread won the race and created the default pipeline.
      // Re-query the default pipeline created for this tenant.
      const [fallback] = await pool.query<RowDataPacket[]>(
        `SELECT id, public_id, name, is_default, display_order, is_active, created_at, updated_at
         FROM megadesk_crm_pipelines
         WHERE client_id = ? AND is_default = 1
         LIMIT 1`,
        [clientId]
      );
      if (fallback && fallback.length > 0) {
        const pRow = fallback[0];
        const [stageRows] = await pool.query<RowDataPacket[]>(
          `SELECT id, public_id, pipeline_id, name, display_order, probability_pct, color, sla_days, created_at, updated_at
           FROM megadesk_crm_stages
           WHERE client_id = ? AND pipeline_id = ?
           ORDER BY display_order ASC, id ASC`,
          [clientId, pRow.id]
        );
        const stages = stageRows.map(s => mapRowToStageView(s, pRow.public_id));
        return mapRowToPipelineView(pRow, stages);
      }
    }

    throw error;
  } finally {
    connection.release();
  }
}

export async function createPipeline(
  clientId: string,
  input: PipelineCreateInput
): Promise<PipelineView> {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (input.isDefault) {
      // Unset previous default
      await connection.execute(
        `UPDATE megadesk_crm_pipelines SET is_default = 0 WHERE client_id = ? AND is_default = 1`,
        [clientId]
      );
    }

    const publicId = randomUUID();
    await connection.execute<ResultSetHeader>(
      `INSERT INTO megadesk_crm_pipelines
       (public_id, client_id, name, is_default, display_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        publicId,
        clientId,
        input.name.trim(),
        input.isDefault ? 1 : 0,
        input.displayOrder ?? 0,
        input.isActive !== false ? 1 : 0,
      ]
    );

    await connection.commit();
    const created = await getPipelineByPublicId(clientId, publicId);
    if (!created) throw new Error("Falha ao recuperar funil recém-criado.");
    return created;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updatePipeline(
  clientId: string,
  input: PipelineUpdateInput
): Promise<PipelineView> {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [locked] = await connection.query<RowDataPacket[]>(
      `SELECT id, public_id, is_default FROM megadesk_crm_pipelines WHERE client_id = ? AND public_id = ? FOR UPDATE`,
      [clientId, input.pipelinePublicId]
    );

    if (!locked || locked.length === 0) {
      throw new Error("Funil não encontrado.");
    }

    if (input.isDefault) {
      await connection.execute(
        `UPDATE megadesk_crm_pipelines SET is_default = 0 WHERE client_id = ? AND is_default = 1 AND public_id != ?`,
        [clientId, input.pipelinePublicId]
      );
    }

    const updates: string[] = [];
    const params: unknown[] = [];

    if (input.name !== undefined) {
      updates.push("name = ?");
      params.push(input.name.trim());
    }
    if (input.isDefault !== undefined) {
      updates.push("is_default = ?");
      params.push(input.isDefault ? 1 : 0);
    }
    if (input.displayOrder !== undefined) {
      updates.push("display_order = ?");
      params.push(input.displayOrder);
    }
    if (input.isActive !== undefined) {
      updates.push("is_active = ?");
      params.push(input.isActive ? 1 : 0);
    }

    if (updates.length > 0) {
      updates.push("updated_at = NOW()");
      params.push(clientId, input.pipelinePublicId);
      await connection.execute(
        `UPDATE megadesk_crm_pipelines SET ${updates.join(", ")} WHERE client_id = ? AND public_id = ?`,
        params
      );
    }

    await connection.commit();
    const updated = await getPipelineByPublicId(clientId, input.pipelinePublicId);
    if (!updated) throw new Error("Falha ao recuperar funil atualizado.");
    return updated;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function createStage(
  clientId: string,
  input: StageCreateInput
): Promise<StageView> {
  const pool = getPool();
  const pipeline = await findInternalPipelineByPublicId(clientId, input.pipelinePublicId);
  if (!pipeline) {
    throw new Error("Funil de vendas não encontrado.");
  }

  const stagePublicId = randomUUID();
  await pool.execute(
    `INSERT INTO megadesk_crm_stages
     (public_id, client_id, pipeline_id, name, display_order, probability_pct, color, sla_days, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      stagePublicId,
      clientId,
      pipeline.id,
      input.name.trim(),
      input.displayOrder ?? 0,
      input.probabilityPct ?? 0,
      input.color ?? "#6366F1",
      input.slaDays ?? null,
    ]
  );

  const stage = await findInternalStageByPublicId(clientId, stagePublicId);
  if (!stage) throw new Error("Falha ao recuperar estágio criado.");

  return {
    publicId: stage.publicId,
    pipelinePublicId: input.pipelinePublicId,
    name: stage.name,
    displayOrder: input.displayOrder ?? 0,
    probabilityPct: stage.probabilityPct,
    color: stage.color,
    slaDays: input.slaDays ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function updateStage(
  clientId: string,
  input: StageUpdateInput
): Promise<StageView> {
  const pool = getPool();
  const stage = await findInternalStageByPublicId(clientId, input.stagePublicId);
  if (!stage) {
    throw new Error("Estágio não encontrado.");
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    updates.push("name = ?");
    params.push(input.name.trim());
  }
  if (input.displayOrder !== undefined) {
    updates.push("display_order = ?");
    params.push(input.displayOrder);
  }
  if (input.probabilityPct !== undefined) {
    updates.push("probability_pct = ?");
    params.push(input.probabilityPct);
  }
  if (input.color !== undefined) {
    updates.push("color = ?");
    params.push(input.color.trim());
  }
  if (input.slaDays !== undefined) {
    updates.push("sla_days = ?");
    params.push(input.slaDays ?? null);
  }

  if (updates.length > 0) {
    updates.push("updated_at = NOW()");
    params.push(clientId, input.stagePublicId);
    await pool.execute(
      `UPDATE megadesk_crm_stages SET ${updates.join(", ")} WHERE client_id = ? AND public_id = ?`,
      params
    );
  }

  const updatedStage = await findInternalStageByPublicId(clientId, input.stagePublicId);
  if (!updatedStage) throw new Error("Falha ao recuperar estágio atualizado.");

  const [pipelineRow] = await pool.query<RowDataPacket[]>(
    `SELECT public_id FROM megadesk_crm_pipelines WHERE client_id = ? AND id = ? LIMIT 1`,
    [clientId, updatedStage.pipelineId]
  );

  return {
    publicId: updatedStage.publicId,
    pipelinePublicId: pipelineRow && pipelineRow[0] ? pipelineRow[0].public_id : "",
    name: updatedStage.name,
    displayOrder: input.displayOrder ?? 0,
    probabilityPct: updatedStage.probabilityPct,
    color: updatedStage.color,
    slaDays: input.slaDays ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
