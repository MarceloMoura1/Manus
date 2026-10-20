import { z } from "zod";
import { router, megadeskProcedure } from "../../../_core/trpc";
import { requireCrmOpportunityAccess } from "../../../crm-access";
import { getPool } from "../../../db";
import type { RowDataPacket } from "mysql2";

export const reportsRouter = router({
  summary: megadeskProcedure
    .input(
      z
        .object({
          period: z.enum(["7d", "30d", "90d", "365d", "all"]).default("30d"),
        })
        .default({ period: "30d" })
    )
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const pool = getPool();

      let dateClause = "";
      if (input.period === "7d") dateClause = "AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
      else if (input.period === "30d") dateClause = "AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)";
      else if (input.period === "90d") dateClause = "AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)";
      else if (input.period === "365d") dateClause = "AND created_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)";

      // Leads count
      const [leadRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as total FROM megadesk_crm_clients WHERE client_id = ? AND status = 'lead' ${dateClause}`,
        [tenantId]
      );
      const leadsCount = Number(leadRows[0]?.total || 0);

      // Won opportunities
      const [wonRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as count, COALESCE(SUM(value_cents), 0) as total_cents,
                AVG(DATEDIFF(COALESCE(won_at, updated_at), created_at)) as avg_cycle_days
         FROM megadesk_crm_opportunities
         WHERE client_id = ? AND status = 'won' ${dateClause}`,
        [tenantId]
      );
      const wonCount = Number(wonRows[0]?.count || 0);
      const wonTotalCents = Number(wonRows[0]?.total_cents || 0);
      const avgCycleDays = Math.round(Number(wonRows[0]?.avg_cycle_days || 0));

      // Lost opportunities
      const [lostRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as count, COALESCE(SUM(value_cents), 0) as total_cents
         FROM megadesk_crm_opportunities
         WHERE client_id = ? AND status = 'lost' ${dateClause}`,
        [tenantId]
      );
      const lostCount = Number(lostRows[0]?.count || 0);
      const lostTotalCents = Number(lostRows[0]?.total_cents || 0);

      // Open opportunities (pipeline active)
      const [openRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as count, COALESCE(SUM(value_cents), 0) as total_cents
         FROM megadesk_crm_opportunities
         WHERE client_id = ? AND status = 'open'`,
        [tenantId]
      );
      const openCount = Number(openRows[0]?.count || 0);
      const openTotalCents = Number(openRows[0]?.total_cents || 0);

      // General Win Rate
      const totalDecided = wonCount + lostCount;
      const winRate = totalDecided > 0 ? Math.round((wonCount / totalDecided) * 100) : 0;
      const avgTicketCents = wonCount > 0 ? Math.round(wonTotalCents / wonCount) : 0;

      return {
        period: input.period,
        leadsCount,
        wonCount,
        wonTotalCents,
        lostCount,
        lostTotalCents,
        openCount,
        openTotalCents,
        winRate,
        avgTicketCents,
        avgCycleDays,
      };
    }),

  funnelStages: megadeskProcedure.query(async ({ ctx }) => {
    const tenantId = requireCrmOpportunityAccess(ctx);
    const pool = getPool();

    const [stages] = await pool.query<RowDataPacket[]>(
      `SELECT s.id, s.public_id, s.name, s.color, s.display_order, s.probability_pct,
              COUNT(o.id) as opp_count,
              COALESCE(SUM(o.value_cents), 0) as total_cents
       FROM megadesk_crm_stages s
       LEFT JOIN megadesk_crm_opportunities o ON o.client_id = s.client_id AND o.stage_id = s.id AND o.status = 'open'
       WHERE s.client_id = ?
       GROUP BY s.id, s.public_id, s.name, s.color, s.display_order, s.probability_pct
       ORDER BY s.display_order ASC`,
      [tenantId]
    );

    return stages.map((s) => ({
      id: Number(s.id),
      publicId: s.public_id,
      name: s.name,
      color: s.color || "#6366F1",
      displayOrder: Number(s.display_order || 0),
      probabilityPct: Number(s.probability_pct || 0),
      opportunityCount: Number(s.opp_count || 0),
      totalCents: Number(s.total_cents || 0),
    }));
  }),

  channels: megadeskProcedure.query(async ({ ctx }) => {
    const tenantId = requireCrmOpportunityAccess(ctx);
    const pool = getPool();

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.origin,
              COUNT(c.id) as total_leads,
              COUNT(CASE WHEN o.status = 'won' THEN 1 END) as won_count,
              COALESCE(SUM(CASE WHEN o.status = 'won' THEN o.value_cents ELSE 0 END), 0) as won_cents
       FROM megadesk_crm_clients c
       LEFT JOIN megadesk_crm_opportunities o ON o.client_id = c.client_id AND o.crm_client_id = c.crm_client_id
       WHERE c.client_id = ?
       GROUP BY c.origin
       ORDER BY total_leads DESC`,
      [tenantId]
    );

    return rows.map((r) => {
      const totalLeads = Number(r.total_leads || 0);
      const wonCount = Number(r.won_count || 0);
      const conversionRate = totalLeads > 0 ? Math.round((wonCount / totalLeads) * 100) : 0;
      return {
        origin: r.origin || "outro",
        totalLeads,
        wonCount,
        wonCents: Number(r.won_cents || 0),
        conversionRate,
      };
    });
  }),

  lossReasons: megadeskProcedure.query(async ({ ctx }) => {
    const tenantId = requireCrmOpportunityAccess(ctx);
    const pool = getPool();

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT loss_reason, COUNT(*) as count, COALESCE(SUM(value_cents), 0) as total_cents
       FROM megadesk_crm_opportunities
       WHERE client_id = ? AND status = 'lost' AND loss_reason IS NOT NULL AND TRIM(loss_reason) != ''
       GROUP BY loss_reason
       ORDER BY count DESC
       LIMIT 10`,
      [tenantId]
    );

    const totalLostCount = rows.reduce((acc, cur) => acc + Number(cur.count || 0), 0);

    return rows.map((r) => ({
      reason: r.loss_reason,
      count: Number(r.count || 0),
      totalCents: Number(r.total_cents || 0),
      percentage: totalLostCount > 0 ? Math.round((Number(r.count || 0) / totalLostCount) * 100) : 0,
    }));
  }),

  teamPerformance: megadeskProcedure.query(async ({ ctx }) => {
    const tenantId = requireCrmOpportunityAccess(ctx);
    const pool = getPool();

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT internal_responsible as seller,
              COUNT(id) as total_opps,
              COUNT(CASE WHEN status = 'won' THEN 1 END) as won_count,
              COUNT(CASE WHEN status = 'lost' THEN 1 END) as lost_count,
              COALESCE(SUM(CASE WHEN status = 'won' THEN value_cents ELSE 0 END), 0) as won_cents
       FROM megadesk_crm_opportunities
       WHERE client_id = ? AND internal_responsible IS NOT NULL AND TRIM(internal_responsible) != ''
       GROUP BY internal_responsible
       ORDER BY won_cents DESC`,
      [tenantId]
    );

    return rows.map((r) => {
      const won = Number(r.won_count || 0);
      const lost = Number(r.lost_count || 0);
      const decided = won + lost;
      return {
        seller: r.seller,
        totalOpps: Number(r.total_opps || 0),
        wonCount: won,
        lostCount: lost,
        wonCents: Number(r.won_cents || 0),
        conversionRate: decided > 0 ? Math.round((won / decided) * 100) : 0,
      };
    });
  }),
});
