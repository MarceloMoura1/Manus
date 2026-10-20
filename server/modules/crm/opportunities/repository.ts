import { getPool } from "../../../db";
import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type {
  OpportunityCreateInput,
  OpportunityUpdateInput,
  OpportunityStageTransitionInput,
  OpportunityListInput,
  OpportunityMetricsFilterInput,
  OpportunityStatus,
  ActivityCreateInput,
  ActivityUpdateInput,
  OpportunityView,
  ActivityView,
  OpportunityHistoryView,
} from "./contracts";
import { addCrmTimeline } from "../../../db-crm";

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function mapRowToOpportunityView(row: any): OpportunityView {
  return {
    publicId: row.public_id,
    pipelinePublicId: row.pipeline_public_id,
    stagePublicId: row.stage_public_id,
    crmClientId: row.crm_client_id ?? null,
    companyName: row.company_name ?? null,
    customerStatus: row.customer_status ?? null,
    stageName: row.stage_name ?? null,
    stageColor: row.stage_color ?? null,
    title: row.title,
    valueCents: Number(row.value_cents ?? 0),
    currency: row.currency || "BRL",
    expectedCloseDate: row.expected_close_date
      ? (row.expected_close_date instanceof Date
          ? row.expected_close_date.toISOString().slice(0, 10)
          : String(row.expected_close_date).slice(0, 10))
      : null,
    status: row.status,
    lossReason: row.loss_reason ?? null,
    internalResponsible: row.internal_responsible ?? "",
    observations: row.observations ?? null,
    wonAt: row.won_at instanceof Date ? row.won_at.toISOString() : (row.won_at ? String(row.won_at) : null),
    lostAt: row.lost_at instanceof Date ? row.lost_at.toISOString() : (row.lost_at ? String(row.lost_at) : null),
    closedAt: row.closed_at instanceof Date ? row.closed_at.toISOString() : (row.closed_at ? String(row.closed_at) : null),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export function buildOpportunityWhereClauses(
  clientId: string,
  filter: {
    pipelinePublicId?: string;
    stagePublicId?: string;
    crmClientId?: string;
    status?: string;
    internalResponsible?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }
): { whereSql: string; params: unknown[] } {
  const whereClauses: string[] = ["o.client_id = ?"];
  const params: unknown[] = [clientId];

  if (filter.pipelinePublicId) {
    whereClauses.push("p.public_id = ?");
    params.push(filter.pipelinePublicId);
  }

  if (filter.stagePublicId) {
    whereClauses.push("s.public_id = ?");
    params.push(filter.stagePublicId);
  }

  if (filter.crmClientId) {
    whereClauses.push("o.crm_client_id = ?");
    params.push(filter.crmClientId);
  }

  if (filter.status && filter.status !== "all") {
    whereClauses.push("o.status = ?");
    params.push(filter.status);
  }

  if (filter.internalResponsible && filter.internalResponsible.trim()) {
    whereClauses.push("o.internal_responsible = ?");
    params.push(filter.internalResponsible.trim());
  }

  if (filter.dateFrom) {
    whereClauses.push("DATE(o.created_at) >= ?");
    params.push(filter.dateFrom);
  }

  if (filter.dateTo) {
    whereClauses.push("DATE(o.created_at) <= ?");
    params.push(filter.dateTo);
  }

  if (filter.search && filter.search.trim()) {
    const term = `%${filter.search.trim()}%`;
    whereClauses.push("(o.title LIKE ? OR c.company_name LIKE ?)");
    params.push(term, term);
  }

  return { whereSql: whereClauses.join(" AND "), params };
}

export async function listOpportunities(
  clientId: string,
  input: OpportunityListInput
): Promise<{ opportunities: OpportunityView[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const pool = getPool();
  const { whereSql, params } = buildOpportunityWhereClauses(clientId, input);

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
     FROM megadesk_crm_opportunities o
     LEFT JOIN megadesk_crm_pipelines p ON p.client_id = o.client_id AND p.id = o.pipeline_id
     LEFT JOIN megadesk_crm_stages s ON s.client_id = o.client_id AND s.id = o.stage_id
     LEFT JOIN megadesk_crm_clients c ON c.client_id = o.client_id AND c.crm_client_id = o.crm_client_id
     WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total ?? 0);

  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, input.pageSize ?? 100));
  const offset = (page - 1) * pageSize;
  const totalPages = Math.ceil(total / pageSize);

  const queryParams = [...params, pageSize, offset];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       o.id,
       o.public_id,
       o.client_id,
       o.pipeline_id,
       o.stage_id,
       o.crm_client_id,
       o.title,
       o.value_cents,
       o.currency,
       o.expected_close_date,
       o.status,
       o.loss_reason,
       o.internal_responsible,
       o.observations,
       o.won_at,
       o.lost_at,
       o.closed_at,
       o.created_at,
       o.updated_at,
       p.public_id AS pipeline_public_id,
       s.public_id AS stage_public_id,
       s.name AS stage_name,
       s.color AS stage_color,
       c.company_name,
       c.status AS customer_status
     FROM megadesk_crm_opportunities o
     LEFT JOIN megadesk_crm_pipelines p ON p.client_id = o.client_id AND p.id = o.pipeline_id
     LEFT JOIN megadesk_crm_stages s ON s.client_id = o.client_id AND s.id = o.stage_id
     LEFT JOIN megadesk_crm_clients c ON c.client_id = o.client_id AND c.crm_client_id = o.crm_client_id
     WHERE ${whereSql}
     ORDER BY o.created_at DESC
     LIMIT ? OFFSET ?`,
    queryParams
  );

  return {
    opportunities: rows.map(mapRowToOpportunityView),
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function getOpportunityMetrics(
  clientId: string,
  filter?: OpportunityMetricsFilterInput
): Promise<{
  openCount: number;
  openValueCents: number;
  wonCount: number;
  wonValueCents: number;
  lostCount: number;
  lostValueCents: number;
  totalCount: number;
  totalValueCents: number;
}> {
  const pool = getPool();
  // Aggregate across all statuses matching the filter criteria
  const { whereSql, params } = buildOpportunityWhereClauses(clientId, filter ? { ...filter, status: undefined } : {});

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       o.status,
       COUNT(*) AS count,
       COALESCE(SUM(o.value_cents), 0) AS total_cents
     FROM megadesk_crm_opportunities o
     LEFT JOIN megadesk_crm_pipelines p ON p.client_id = o.client_id AND p.id = o.pipeline_id
     LEFT JOIN megadesk_crm_stages s ON s.client_id = o.client_id AND s.id = o.stage_id
     LEFT JOIN megadesk_crm_clients c ON c.client_id = o.client_id AND c.crm_client_id = o.crm_client_id
     WHERE ${whereSql}
     GROUP BY o.status`,
    params
  );

  let openCount = 0;
  let openValueCents = 0;
  let wonCount = 0;
  let wonValueCents = 0;
  let lostCount = 0;
  let lostValueCents = 0;

  for (const row of rows) {
    const count = Number(row.count ?? 0);
    const value = Number(row.total_cents ?? 0);
    if (row.status === "open") {
      openCount = count;
      openValueCents = value;
    } else if (row.status === "won") {
      wonCount = count;
      wonValueCents = value;
    } else if (row.status === "lost") {
      lostCount = count;
      lostValueCents = value;
    }
  }

  return {
    openCount,
    openValueCents,
    wonCount,
    wonValueCents,
    lostCount,
    lostValueCents,
    totalCount: openCount + wonCount + lostCount,
    totalValueCents: openValueCents + wonValueCents + lostValueCents,
  };
}

export async function getOpportunityByPublicId(
  clientId: string,
  publicId: string
): Promise<OpportunityView | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       o.id,
       o.public_id,
       o.client_id,
       o.pipeline_id,
       o.stage_id,
       o.crm_client_id,
       o.title,
       o.value_cents,
       o.currency,
       o.expected_close_date,
       o.status,
       o.loss_reason,
       o.internal_responsible,
       o.observations,
       o.won_at,
       o.lost_at,
       o.closed_at,
       o.created_at,
       o.updated_at,
       p.public_id AS pipeline_public_id,
       s.public_id AS stage_public_id,
       s.name AS stage_name,
       s.color AS stage_color,
       c.company_name,
       c.status AS customer_status
     FROM megadesk_crm_opportunities o
     LEFT JOIN megadesk_crm_pipelines p ON p.client_id = o.client_id AND p.id = o.pipeline_id
     LEFT JOIN megadesk_crm_stages s ON s.client_id = o.client_id AND s.id = o.stage_id
     LEFT JOIN megadesk_crm_clients c ON c.client_id = o.client_id AND c.crm_client_id = o.crm_client_id
     WHERE o.client_id = ? AND o.public_id = ?
     LIMIT 1`,
    [clientId, publicId]
  );

  if (!rows || rows.length === 0) return null;
  return mapRowToOpportunityView(rows[0]);
}

export async function createOpportunity(
  clientId: string,
  input: OpportunityCreateInput,
  actor: string
): Promise<OpportunityView> {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Resolve and validate Pipeline
    const [pipelineRows] = await connection.query<RowDataPacket[]>(
      `SELECT id, public_id, name FROM megadesk_crm_pipelines WHERE client_id = ? AND public_id = ? LIMIT 1`,
      [clientId, input.pipelinePublicId]
    );
    if (!pipelineRows || pipelineRows.length === 0) {
      throw new Error("Funil de vendas não encontrado para esta empresa.");
    }
    const pipelineId = Number(pipelineRows[0].id);

    // 2. Resolve and validate Stage
    const [stageRows] = await connection.query<RowDataPacket[]>(
      `SELECT id, public_id, name, probability_pct, color FROM megadesk_crm_stages
       WHERE client_id = ? AND pipeline_id = ? AND public_id = ? LIMIT 1`,
      [clientId, pipelineId, input.stagePublicId]
    );
    if (!stageRows || stageRows.length === 0) {
      throw new Error("Estágio de destino não encontrado no funil selecionado.");
    }
    const stageId = Number(stageRows[0].id);
    const stageProb = Number(stageRows[0].probability_pct ?? 0);
    const stageName = String(stageRows[0].name ?? "");

    // 3. Resolve Customer / Lead if crmClientId is provided
    let linkedClientName: string | null = null;
    if (input.crmClientId && input.crmClientId.trim()) {
      const [clientRows] = await connection.query<RowDataPacket[]>(
        `SELECT id, crm_client_id, status, company_name FROM megadesk_crm_clients
         WHERE client_id = ? AND crm_client_id = ? FOR UPDATE`,
        [clientId, input.crmClientId.trim()]
      );
      if (!clientRows || clientRows.length === 0) {
        throw new Error("Cliente ou Lead não encontrado para associação.");
      }
      const clientRow = clientRows[0];
      linkedClientName = clientRow.company_name;

      // Handle optional atomic lead conversion on opportunity creation
      if (input.convertLead && clientRow.status === "lead") {
        await connection.execute(
          `UPDATE megadesk_crm_clients
           SET status = 'ativo', converted_at = NOW(), updated_at = NOW()
           WHERE client_id = ? AND crm_client_id = ? AND status = 'lead'`,
          [clientId, input.crmClientId.trim()]
        );
        await addCrmTimeline(
          input.crmClientId.trim(),
          clientId,
          {
            type: "lead_converted",
            description: `Lead convertido em Cliente Ativo na abertura da oportunidade: "${input.title.trim()}"`,
            author: actor,
          },
          connection
        );
      }
    }

    // 4. Initial status is 'open' by default
    const status: "open" | "won" | "lost" = "open";
    const wonAt: string | null = null;
    const lostAt: string | null = null;
    const closedAt: string | null = null;

    const oppPublicId = randomUUID();
    const valueCents = Math.max(0, input.valueCents ?? 0);

    const [insertRes] = await connection.execute<ResultSetHeader>(
      `INSERT INTO megadesk_crm_opportunities
       (public_id, client_id, pipeline_id, stage_id, crm_client_id, title, value_cents, currency,
        expected_close_date, status, loss_reason, internal_responsible, observations,
        won_at, lost_at, closed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        oppPublicId,
        clientId,
        pipelineId,
        stageId,
        input.crmClientId?.trim() || null,
        input.title.trim(),
        valueCents,
        input.currency || "BRL",
        input.expectedCloseDate || null,
        status,
        input.internalResponsible?.trim() || "",
        input.observations?.trim() || null,
        wonAt,
        lostAt,
        closedAt,
      ]
    );
    const oppInternalId = insertRes.insertId;

    // 5. Insert initial opportunity history (append-only)
    const historyPublicId = randomUUID();
    await connection.execute(
      `INSERT INTO megadesk_crm_opportunity_history
       (public_id, client_id, opportunity_id, from_stage_id, to_stage_id, from_value_cents, to_value_cents, author, notes, created_at)
       VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, ?, NOW())`,
      [
        historyPublicId,
        clientId,
        oppInternalId,
        stageId,
        valueCents,
        actor,
        "Oportunidade cadastrada no funil comercial.",
      ]
    );

    // 6. Link to customer timeline if customer is attached
    if (input.crmClientId && input.crmClientId.trim()) {
      await addCrmTimeline(
        input.crmClientId.trim(),
        clientId,
        {
          type: "opportunity_created",
          description: `Nova oportunidade criada: "${input.title.trim()}" (${formatBrl(valueCents)}) no estágio "${stageName}".`,
          author: actor,
        },
        connection
      );
    }

    await connection.commit();

    const created = await getOpportunityByPublicId(clientId, oppPublicId);
    if (!created) throw new Error("Falha ao recuperar oportunidade recém-criada.");
    return created;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function transitionStage(
  clientId: string,
  input: OpportunityStageTransitionInput,
  actor: string
): Promise<OpportunityView> {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Lock opportunity row
    const [oppRows] = await connection.query<RowDataPacket[]>(
      `SELECT id, public_id, pipeline_id, stage_id, crm_client_id, title, value_cents, status
       FROM megadesk_crm_opportunities
       WHERE client_id = ? AND public_id = ?
       FOR UPDATE`,
      [clientId, input.opportunityPublicId]
    );

    if (!oppRows || oppRows.length === 0) {
      throw new Error("Oportunidade não encontrada.");
    }
    const opp = oppRows[0];
    const fromStageId = Number(opp.stage_id);

    // 2. Resolve destination stage
    const [stageRows] = await connection.query<RowDataPacket[]>(
      `SELECT id, pipeline_id, name, probability_pct FROM megadesk_crm_stages
       WHERE client_id = ? AND public_id = ?
       LIMIT 1`,
      [clientId, input.toStagePublicId]
    );

    if (!stageRows || stageRows.length === 0) {
      throw new Error("Estágio de destino não encontrado.");
    }
    const toStage = stageRows[0];
    const toStageId = Number(toStage.id);
    const toStagePipelineId = Number(toStage.pipeline_id);

    // 3. Validate stage belongs to the exact same pipeline and tenant
    if (toStagePipelineId !== Number(opp.pipeline_id)) {
      throw new Error("O estágio de destino não pertence ao funil desta oportunidade.");
    }

    // 4. Idempotency check: if already at the destination stage, return without redundant history
    if (fromStageId === toStageId) {
      await connection.commit();
      const existing = await getOpportunityByPublicId(clientId, input.opportunityPublicId);
      if (!existing) throw new Error("Oportunidade não encontrada.");
      return existing;
    }

    // 5. Determine new status and closure dates based on explicit commercial state rules
    const stageName = String(toStage.name ?? "");
    let newStatus: OpportunityStatus = "open";
    let wonAt: string | null = null;
    let lostAt: string | null = null;
    let closedAt: string | null = null;
    let lossReason: string | null = null;

    const requestedStatus = input.status;

    if (requestedStatus === "lost") {
      const reason = input.lossReason?.trim() || input.notes?.trim() || "";
      if (!reason) {
        throw new Error("Motivo de perda é obrigatório ao marcar a oportunidade como perdida.");
      }
      newStatus = "lost";
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      lostAt = now;
      closedAt = now;
      wonAt = null;
      lossReason = reason;
    } else if (requestedStatus === "won") {
      if (input.lossReason && input.lossReason.trim().length > 0) {
        throw new Error("Motivo de perda não pode ser informado para oportunidade ganha.");
      }
      newStatus = "won";
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      wonAt = now;
      closedAt = now;
      lostAt = null;
      lossReason = null;
    } else if (requestedStatus === "open") {
      if (input.lossReason && input.lossReason.trim().length > 0) {
        throw new Error("Motivo de perda não pode ser informado para oportunidade aberta.");
      }
      newStatus = "open";
      // Explicit reopening: clear terminal fields
      wonAt = null;
      lostAt = null;
      closedAt = null;
      lossReason = null;
    } else {
      // No explicit status passed:
      // Moving to ANY stage (whether 0%, 50%, or 100% probability) NEVER automatically closes the deal.
      // If previously closed (won/lost) and moved to another stage, restore to open state.
      newStatus = "open";
      wonAt = null;
      lostAt = null;
      closedAt = null;
      lossReason = null;
    }

    // 6. Update opportunity
    await connection.execute(
      `UPDATE megadesk_crm_opportunities
       SET stage_id = ?, status = ?, won_at = ?, lost_at = ?, closed_at = ?, loss_reason = ?, updated_at = NOW()
       WHERE client_id = ? AND public_id = ?`,
      [
        toStageId,
        newStatus,
        wonAt,
        lostAt,
        closedAt,
        lossReason,
        clientId,
        input.opportunityPublicId,
      ]
    );

    // 7. Insert audit history record (append-only)
    const historyPublicId = randomUUID();
    await connection.execute(
      `INSERT INTO megadesk_crm_opportunity_history
       (public_id, client_id, opportunity_id, from_stage_id, to_stage_id, from_value_cents, to_value_cents, author, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        historyPublicId,
        clientId,
        opp.id,
        fromStageId,
        toStageId,
        opp.value_cents,
        opp.value_cents,
        actor,
        input.notes?.trim() || `Transição para "${stageName}".`,
      ]
    );

    // 8. Log into customer timeline if linked
    if (opp.crm_client_id) {
      await addCrmTimeline(
        opp.crm_client_id,
        clientId,
        {
          type: "opportunity_stage_changed",
          description: `Oportunidade "${opp.title}" movida para o estágio "${stageName}".`,
          author: actor,
        },
        connection
      );
    }

    await connection.commit();

    const updated = await getOpportunityByPublicId(clientId, input.opportunityPublicId);
    if (!updated) throw new Error("Falha ao recuperar oportunidade atualizada.");
    return updated;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateOpportunity(
  clientId: string,
  input: OpportunityUpdateInput,
  actor: string
): Promise<OpportunityView> {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [oppRows] = await connection.query<RowDataPacket[]>(
      `SELECT id, public_id, pipeline_id, stage_id, crm_client_id, title, value_cents, status
       FROM megadesk_crm_opportunities
       WHERE client_id = ? AND public_id = ?
       FOR UPDATE`,
      [clientId, input.opportunityPublicId]
    );

    if (!oppRows || oppRows.length === 0) {
      throw new Error("Oportunidade não encontrada.");
    }
    const opp = oppRows[0];
    const prevStageId = Number(opp.stage_id);
    const prevValueCents = Number(opp.value_cents);

    let nextStageId = prevStageId;
    let stageChanged = false;

    if (input.stagePublicId) {
      const [stageRows] = await connection.query<RowDataPacket[]>(
        `SELECT id, pipeline_id, name, probability_pct FROM megadesk_crm_stages
         WHERE client_id = ? AND public_id = ? LIMIT 1`,
        [clientId, input.stagePublicId]
      );
      if (!stageRows || stageRows.length === 0) {
        throw new Error("Estágio informado não encontrado.");
      }
      if (Number(stageRows[0].pipeline_id) !== Number(opp.pipeline_id)) {
        throw new Error("O estágio informado não pertence ao funil desta oportunidade.");
      }
      nextStageId = Number(stageRows[0].id);
      if (nextStageId !== prevStageId) {
        stageChanged = true;
      }
    }

    const updates: string[] = [];
    const params: unknown[] = [];

    if (input.title !== undefined) {
      updates.push("title = ?");
      params.push(input.title.trim());
    }

    if (input.valueCents !== undefined) {
      updates.push("value_cents = ?");
      params.push(Math.max(0, input.valueCents));
    }

    if (input.currency !== undefined) {
      updates.push("currency = ?");
      params.push(input.currency.trim());
    }

    if (input.expectedCloseDate !== undefined) {
      updates.push("expected_close_date = ?");
      params.push(input.expectedCloseDate || null);
    }

    if (input.crmClientId !== undefined) {
      updates.push("crm_client_id = ?");
      params.push(input.crmClientId?.trim() || null);
    }

    if (input.internalResponsible !== undefined) {
      updates.push("internal_responsible = ?");
      params.push(input.internalResponsible.trim());
    }

    if (input.observations !== undefined) {
      updates.push("observations = ?");
      params.push(input.observations?.trim() || null);
    }

    if (stageChanged) {
      updates.push("stage_id = ?");
      params.push(nextStageId);
    }

    // Handle status changes with dates and reasons
    if (input.status !== undefined) {
      updates.push("status = ?");
      params.push(input.status);

      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      if (input.status === "won") {
        if (input.lossReason && input.lossReason.trim().length > 0) {
          throw new Error("Motivo de perda não pode ser informado para oportunidade ganha.");
        }
        updates.push("won_at = ?, closed_at = ?, lost_at = NULL, loss_reason = NULL");
        params.push(now, now);
      } else if (input.status === "lost") {
        if (!input.lossReason || input.lossReason.trim().length === 0) {
          throw new Error("Motivo de perda é obrigatório ao marcar a oportunidade como perdida.");
        }
        updates.push("lost_at = ?, closed_at = ?, won_at = NULL, loss_reason = ?");
        params.push(now, now, input.lossReason.trim());
      } else if (input.status === "open") {
        if (input.lossReason && input.lossReason.trim().length > 0) {
          throw new Error("Motivo de perda não pode ser informado para oportunidade aberta.");
        }
        // Reopen explicitly
        updates.push("won_at = NULL, lost_at = NULL, closed_at = NULL, loss_reason = NULL");
      }
    } else if (stageChanged) {
      // If moving stage without explicit status change:
      // Moving to a new stage restores 'open' state if it was closed
      const currentStatus = String(opp.status ?? "open");
      if (currentStatus !== "open") {
        updates.push("status = 'open', won_at = NULL, lost_at = NULL, closed_at = NULL, loss_reason = NULL");
      }
    }

    const nextValueCents = input.valueCents !== undefined ? Math.max(0, input.valueCents) : prevValueCents;

    if (updates.length > 0) {
      updates.push("updated_at = NOW()");
      params.push(clientId, input.opportunityPublicId);
      await connection.execute(
        `UPDATE megadesk_crm_opportunities SET ${updates.join(", ")} WHERE client_id = ? AND public_id = ?`,
        params
      );
    }

    // If stage or value changed, record history
    if (stageChanged || nextValueCents !== prevValueCents) {
      const historyPublicId = randomUUID();
      await connection.execute(
        `INSERT INTO megadesk_crm_opportunity_history
         (public_id, client_id, opportunity_id, from_stage_id, to_stage_id, from_value_cents, to_value_cents, author, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          historyPublicId,
          clientId,
          opp.id,
          prevStageId,
          nextStageId,
          prevValueCents,
          nextValueCents,
          actor,
          "Atualização cadastral da oportunidade.",
        ]
      );
    }

    await connection.commit();

    const updated = await getOpportunityByPublicId(clientId, input.opportunityPublicId);
    if (!updated) throw new Error("Falha ao recuperar oportunidade atualizada.");
    return updated;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listOpportunityHistory(
  clientId: string,
  opportunityPublicId: string
): Promise<OpportunityHistoryView[]> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       h.public_id,
       o.public_id AS opportunity_public_id,
       s_from.public_id AS from_stage_public_id,
       s_to.public_id AS to_stage_public_id,
       h.from_value_cents,
       h.to_value_cents,
       h.author,
       h.notes,
       h.created_at
     FROM megadesk_crm_opportunity_history h
     INNER JOIN megadesk_crm_opportunities o ON o.client_id = h.client_id AND o.id = h.opportunity_id
     LEFT JOIN megadesk_crm_stages s_from ON s_from.client_id = h.client_id AND s_from.id = h.from_stage_id
     INNER JOIN megadesk_crm_stages s_to ON s_to.client_id = h.client_id AND s_to.id = h.to_stage_id
     WHERE h.client_id = ? AND o.public_id = ?
     ORDER BY h.created_at DESC, h.id DESC`,
    [clientId, opportunityPublicId]
  );

  return rows.map(r => ({
    publicId: r.public_id,
    opportunityPublicId: r.opportunity_public_id,
    fromStagePublicId: r.from_stage_public_id ?? null,
    toStagePublicId: r.to_stage_public_id,
    fromValueCents: r.from_value_cents !== null ? Number(r.from_value_cents) : null,
    toValueCents: Number(r.to_value_cents ?? 0),
    author: r.author,
    notes: r.notes ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

export async function createActivity(
  clientId: string,
  input: ActivityCreateInput,
  actor: string
): Promise<ActivityView> {
  const pool = getPool();
  let opportunityId: number | null = null;

  if (input.opportunityPublicId) {
    const [oppRows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM megadesk_crm_opportunities WHERE client_id = ? AND public_id = ? LIMIT 1`,
      [clientId, input.opportunityPublicId]
    );
    if (!oppRows || oppRows.length === 0) {
      throw new Error("Oportunidade informada não encontrada.");
    }
    opportunityId = Number(oppRows[0].id);
  }

  if (input.crmClientId) {
    const [clientRows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM megadesk_crm_clients WHERE client_id = ? AND crm_client_id = ? LIMIT 1`,
      [clientId, input.crmClientId]
    );
    if (!clientRows || clientRows.length === 0) {
      throw new Error("Cliente informado não encontrado.");
    }
  }

  const publicId = randomUUID();
  await pool.execute(
    `INSERT INTO megadesk_crm_activities
     (public_id, client_id, opportunity_id, crm_client_id, type, title, description, due_at, status, assigned_to, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NOW(), NOW())`,
    [
      publicId,
      clientId,
      opportunityId,
      input.crmClientId?.trim() || null,
      input.type,
      input.title.trim(),
      input.description?.trim() || null,
      input.dueAt || null,
      input.assignedTo?.trim() || "",
      actor,
    ]
  );

  return {
    publicId,
    opportunityPublicId: input.opportunityPublicId ?? null,
    crmClientId: input.crmClientId ?? null,
    type: input.type,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    dueAt: input.dueAt ?? null,
    completedAt: null,
    status: "pending",
    assignedTo: input.assignedTo?.trim() || "",
    createdBy: actor,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function listActivities(
  clientId: string,
  filter: { opportunityPublicId?: string; crmClientId?: string; status?: string }
): Promise<ActivityView[]> {
  const pool = getPool();
  const whereClauses = ["a.client_id = ?"];
  const params: unknown[] = [clientId];

  if (filter.opportunityPublicId) {
    whereClauses.push("o.public_id = ?");
    params.push(filter.opportunityPublicId);
  }

  if (filter.crmClientId) {
    whereClauses.push("a.crm_client_id = ?");
    params.push(filter.crmClientId);
  }

  if (filter.status) {
    whereClauses.push("a.status = ?");
    params.push(filter.status);
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       a.public_id,
       o.public_id AS opportunity_public_id,
       a.crm_client_id,
       a.type,
       a.title,
       a.description,
       a.due_at,
       a.completed_at,
       a.status,
       a.assigned_to,
       a.created_by,
       a.created_at,
       a.updated_at
     FROM megadesk_crm_activities a
     LEFT JOIN megadesk_crm_opportunities o ON o.client_id = a.client_id AND o.id = a.opportunity_id
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY a.created_at DESC`,
    params
  );

  return rows.map(r => ({
    publicId: r.public_id,
    opportunityPublicId: r.opportunity_public_id ?? null,
    crmClientId: r.crm_client_id ?? null,
    type: r.type,
    title: r.title,
    description: r.description ?? null,
    dueAt: r.due_at instanceof Date ? r.due_at.toISOString() : (r.due_at ? String(r.due_at) : null),
    completedAt: r.completed_at instanceof Date ? r.completed_at.toISOString() : (r.completed_at ? String(r.completed_at) : null),
    status: r.status,
    assignedTo: r.assigned_to ?? "",
    createdBy: r.created_by,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  }));
}

export async function updateActivity(
  clientId: string,
  input: ActivityUpdateInput
): Promise<ActivityView> {
  const pool = getPool();
  const updates: string[] = [];
  const params: unknown[] = [];

  if (input.title !== undefined) {
    updates.push("title = ?");
    params.push(input.title.trim());
  }
  if (input.description !== undefined) {
    updates.push("description = ?");
    params.push(input.description?.trim() || null);
  }
  if (input.dueAt !== undefined) {
    updates.push("due_at = ?");
    params.push(input.dueAt || null);
  }
  if (input.status !== undefined) {
    updates.push("status = ?");
    params.push(input.status);
    if (input.status === "completed") {
      updates.push("completed_at = NOW()");
    } else {
      updates.push("completed_at = NULL");
    }
  }
  if (input.assignedTo !== undefined) {
    updates.push("assigned_to = ?");
    params.push(input.assignedTo.trim());
  }

  if (updates.length > 0) {
    updates.push("updated_at = NOW()");
    params.push(clientId, input.activityPublicId);
    await pool.execute(
      `UPDATE megadesk_crm_activities SET ${updates.join(", ")} WHERE client_id = ? AND public_id = ?`,
      params
    );
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       a.public_id,
       o.public_id AS opportunity_public_id,
       a.crm_client_id,
       a.type,
       a.title,
       a.description,
       a.due_at,
       a.completed_at,
       a.status,
       a.assigned_to,
       a.created_by,
       a.created_at,
       a.updated_at
     FROM megadesk_crm_activities a
     LEFT JOIN megadesk_crm_opportunities o ON o.client_id = a.client_id AND o.id = a.opportunity_id
     WHERE a.client_id = ? AND a.public_id = ?
     LIMIT 1`,
    [clientId, input.activityPublicId]
  );

  if (!rows || rows.length === 0) {
    throw new Error("Atividade não encontrada.");
  }

  const r = rows[0];
  return {
    publicId: r.public_id,
    opportunityPublicId: r.opportunity_public_id ?? null,
    crmClientId: r.crm_client_id ?? null,
    type: r.type,
    title: r.title,
    description: r.description ?? null,
    dueAt: r.due_at instanceof Date ? r.due_at.toISOString() : (r.due_at ? String(r.due_at) : null),
    completedAt: r.completed_at instanceof Date ? r.completed_at.toISOString() : (r.completed_at ? String(r.completed_at) : null),
    status: r.status,
    assignedTo: r.assigned_to ?? "",
    createdBy: r.created_by,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}
