import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, megadeskProcedure } from "../../../_core/trpc";
import { requireCrmOpportunityAccess } from "../../../crm-access";
import { getPool } from "../../../db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import {
  ruleCreateInput,
  ruleUpdateInput,
  webhookSourceCreateInput,
  webhookSourceUpdateInput,
  aiSettingsUpdateInput,
  aiSuggestNextActionInput,
} from "./contracts";
import { executeAutomationRule } from "./engine";
import { generateAIResponse } from "../../../_core/gemini";

export const automationsRouter = router({
  // === Regras de Automação ===
  listRules: megadeskProcedure.query(async ({ ctx }) => {
    const tenantId = requireCrmOpportunityAccess(ctx);
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, public_id, name, description, trigger_type, conditions, actions,
              is_active, execution_count, last_executed_at, created_by, created_at, updated_at
       FROM megadesk_crm_automation_rules
       WHERE client_id = ?
       ORDER BY created_at DESC`,
      [tenantId]
    );

    return rows.map((r) => ({
      id: Number(r.id),
      publicId: r.public_id,
      name: r.name,
      description: r.description,
      triggerType: r.trigger_type,
      conditions: typeof r.conditions === "string" ? JSON.parse(r.conditions) : r.conditions,
      actions: typeof r.actions === "string" ? JSON.parse(r.actions) : r.actions,
      isActive: Boolean(r.is_active),
      executionCount: Number(r.execution_count || 0),
      lastExecutedAt: r.last_executed_at ? new Date(r.last_executed_at).toISOString() : null,
      createdBy: r.created_by,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }),

  createRule: megadeskProcedure
    .input(ruleCreateInput)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const actor = ctx.userName?.trim() || ctx.userEmail?.trim() || "Operador";
      const publicId = randomUUID();
      const pool = getPool();

      await pool.execute(
        `INSERT INTO megadesk_crm_automation_rules
         (public_id, client_id, name, description, trigger_type, conditions, actions, is_active, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          publicId,
          tenantId,
          input.name.trim(),
          input.description?.trim() || null,
          input.triggerType,
          JSON.stringify(input.conditions),
          JSON.stringify(input.actions),
          input.isActive ? 1 : 0,
          actor,
        ]
      );

      return { success: true, publicId };
    }),

  updateRule: megadeskProcedure
    .input(ruleUpdateInput)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const pool = getPool();

      const updates: string[] = [];
      const params: unknown[] = [];

      if (input.name !== undefined) {
        updates.push("name = ?");
        params.push(input.name.trim());
      }
      if (input.description !== undefined) {
        updates.push("description = ?");
        params.push(input.description?.trim() || null);
      }
      if (input.triggerType !== undefined) {
        updates.push("trigger_type = ?");
        params.push(input.triggerType);
      }
      if (input.conditions !== undefined) {
        updates.push("conditions = ?");
        params.push(JSON.stringify(input.conditions));
      }
      if (input.actions !== undefined) {
        updates.push("actions = ?");
        params.push(JSON.stringify(input.actions));
      }
      if (input.isActive !== undefined) {
        updates.push("is_active = ?");
        params.push(input.isActive ? 1 : 0);
      }

      if (updates.length > 0) {
        updates.push("updated_at = NOW()");
        params.push(tenantId, input.publicId);
        await pool.execute(
          `UPDATE megadesk_crm_automation_rules SET ${updates.join(", ")} WHERE client_id = ? AND public_id = ?`,
          params
        );
      }

      return { success: true };
    }),

  toggleRule: megadeskProcedure
    .input(z.object({ publicId: z.string().uuid(), isActive: z.boolean() }).strict())
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const pool = getPool();
      await pool.execute(
        `UPDATE megadesk_crm_automation_rules SET is_active = ?, updated_at = NOW() WHERE client_id = ? AND public_id = ?`,
        [input.isActive ? 1 : 0, tenantId, input.publicId]
      );
      return { success: true };
    }),

  deleteRule: megadeskProcedure
    .input(z.object({ publicId: z.string().uuid() }).strict())
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const pool = getPool();
      const [result] = await pool.execute<ResultSetHeader>(
        `DELETE FROM megadesk_crm_automation_rules WHERE client_id = ? AND public_id = ?`,
        [tenantId, input.publicId]
      );
      if (result.affectedRows === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Regra não encontrada." });
      }
      return { success: true };
    }),

  testRule: megadeskProcedure
    .input(
      z.object({
        publicId: z.string().uuid(),
        mockPayload: z.record(z.string(), z.unknown()).default({}),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const pool = getPool();
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, public_id, name, trigger_type, conditions, actions, is_active
         FROM megadesk_crm_automation_rules
         WHERE client_id = ? AND public_id = ? LIMIT 1`,
        [tenantId, input.publicId]
      );
      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Regra não encontrada." });
      }
      const r = rows[0];
      const result = await executeAutomationRule(
        tenantId,
        {
          id: Number(r.id),
          publicId: r.public_id,
          name: r.name,
          triggerType: r.trigger_type,
          conditions: r.conditions,
          actions: r.actions,
          isActive: true,
        },
        {
          eventType: r.trigger_type,
          payload: input.mockPayload,
        },
        "Teste Manual"
      );

      return result;
    }),

  // === Histórico de Execuções ===
  listRuns: megadeskProcedure
    .input(
      z
        .object({
          ruleId: z.number().int().optional(),
          status: z.enum(["success", "failed", "partial", "skipped"]).optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .default({ limit: 50 })
    )
    .query(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const pool = getPool();
      const where = ["client_id = ?"];
      const params: unknown[] = [tenantId];

      if (input.ruleId) {
        where.push("rule_id = ?");
        params.push(input.ruleId);
      }
      if (input.status) {
        where.push("status = ?");
        params.push(input.status);
      }

      params.push(input.limit);

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, public_id, rule_id, rule_name, event_type, status, trigger_payload,
                results, error_message, duration_ms, created_at
         FROM megadesk_crm_automation_runs
         WHERE ${where.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT ?`,
        params
      );

      return rows.map((r) => ({
        id: Number(r.id),
        publicId: r.public_id,
        ruleId: r.rule_id ? Number(r.rule_id) : null,
        ruleName: r.rule_name,
        eventType: r.event_type,
        status: r.status,
        triggerPayload: typeof r.trigger_payload === "string" ? JSON.parse(r.trigger_payload) : r.trigger_payload,
        results: typeof r.results === "string" ? JSON.parse(r.results) : r.results,
        errorMessage: r.error_message,
        durationMs: Number(r.duration_ms || 0),
        createdAt: new Date(r.created_at).toISOString(),
      }));
    }),

  // === Fontes de Webhook de Entrada ===
  listWebhookSources: megadeskProcedure.query(async ({ ctx }) => {
    const tenantId = requireCrmOpportunityAccess(ctx);
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, public_id, name, token, default_stage_id, field_mappings,
              is_active, total_received, last_received_at, created_at, updated_at
       FROM megadesk_crm_webhook_sources
       WHERE client_id = ?
       ORDER BY created_at DESC`,
      [tenantId]
    );

    return rows.map((r) => ({
      id: Number(r.id),
      publicId: r.public_id,
      name: r.name,
      token: r.token,
      defaultStageId: r.default_stage_id ? Number(r.default_stage_id) : null,
      fieldMappings: typeof r.field_mappings === "string" ? JSON.parse(r.field_mappings) : r.field_mappings,
      isActive: Boolean(r.is_active),
      totalReceived: Number(r.total_received || 0),
      lastReceivedAt: r.last_received_at ? new Date(r.last_received_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }),

  createWebhookSource: megadeskProcedure
    .input(webhookSourceCreateInput)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const publicId = randomUUID();
      const token = randomBytes(24).toString("hex");
      const pool = getPool();

      await pool.execute(
        `INSERT INTO megadesk_crm_webhook_sources
         (public_id, client_id, name, token, default_stage_id, field_mappings, is_active, total_received, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 0, NOW(), NOW())`,
        [
          publicId,
          tenantId,
          input.name.trim(),
          token,
          input.defaultStageId || null,
          JSON.stringify(input.fieldMappings),
        ]
      );

      return { success: true, publicId, token };
    }),

  updateWebhookSource: megadeskProcedure
    .input(webhookSourceUpdateInput)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const pool = getPool();
      const updates: string[] = [];
      const params: unknown[] = [];

      if (input.name !== undefined) {
        updates.push("name = ?");
        params.push(input.name.trim());
      }
      if (input.defaultStageId !== undefined) {
        updates.push("default_stage_id = ?");
        params.push(input.defaultStageId || null);
      }
      if (input.fieldMappings !== undefined) {
        updates.push("field_mappings = ?");
        params.push(JSON.stringify(input.fieldMappings));
      }
      if (input.isActive !== undefined) {
        updates.push("is_active = ?");
        params.push(input.isActive ? 1 : 0);
      }

      if (updates.length > 0) {
        updates.push("updated_at = NOW()");
        params.push(tenantId, input.publicId);
        await pool.execute(
          `UPDATE megadesk_crm_webhook_sources SET ${updates.join(", ")} WHERE client_id = ? AND public_id = ?`,
          params
        );
      }

      return { success: true };
    }),

  rotateWebhookToken: megadeskProcedure
    .input(z.object({ publicId: z.string().uuid() }).strict())
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const pool = getPool();
      const newToken = randomBytes(24).toString("hex");

      await pool.execute(
        `UPDATE megadesk_crm_webhook_sources SET token = ?, updated_at = NOW() WHERE client_id = ? AND public_id = ?`,
        [newToken, tenantId, input.publicId]
      );

      return { success: true, token: newToken };
    }),

  deleteWebhookSource: megadeskProcedure
    .input(z.object({ publicId: z.string().uuid() }).strict())
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const pool = getPool();
      const [result] = await pool.execute<ResultSetHeader>(
        `DELETE FROM megadesk_crm_webhook_sources WHERE client_id = ? AND public_id = ?`,
        [tenantId, input.publicId]
      );
      if (result.affectedRows === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Fonte de webhook não encontrada." });
      }
      return { success: true };
    }),

  // === Configurações de IA (Gemini) ===
  getAiSettings: megadeskProcedure.query(async ({ ctx }) => {
    const tenantId = requireCrmOpportunityAccess(ctx);
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT is_enabled, system_prompt, qualification_criteria, auto_suggest_next_action, model_name
       FROM megadesk_crm_ai_settings
       WHERE client_id = ? LIMIT 1`,
      [tenantId]
    );

    if (rows.length === 0) {
      return {
        isEnabled: true,
        systemPrompt: "Você é um copiloto comercial do MegaDesk CRM focado em acelerar vendas e manter relacionamentos consultivos com clientes.",
        qualificationCriteria: "Verifique: 1) Porte da empresa, 2) Necessidade ou urgência, 3) Decisor identificado, 4) Orçamento disponível.",
        autoSuggestNextAction: true,
        modelName: "gemini-1.5-flash",
      };
    }

    const r = rows[0];
    return {
      isEnabled: Boolean(r.is_enabled),
      systemPrompt: r.system_prompt || "",
      qualificationCriteria: r.qualification_criteria || "",
      autoSuggestNextAction: Boolean(r.auto_suggest_next_action),
      modelName: r.model_name || "gemini-1.5-flash",
    };
  }),

  updateAiSettings: megadeskProcedure
    .input(aiSettingsUpdateInput)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const pool = getPool();
      const publicId = randomUUID();

      await pool.execute(
        `INSERT INTO megadesk_crm_ai_settings
         (public_id, client_id, is_enabled, system_prompt, qualification_criteria, auto_suggest_next_action, model_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           is_enabled = COALESCE(?, is_enabled),
           system_prompt = COALESCE(?, system_prompt),
           qualification_criteria = COALESCE(?, qualification_criteria),
           auto_suggest_next_action = COALESCE(?, auto_suggest_next_action),
           model_name = COALESCE(?, model_name),
           updated_at = NOW()`,
        [
          publicId,
          tenantId,
          input.isEnabled ?? true ? 1 : 0,
          input.systemPrompt || null,
          input.qualificationCriteria || null,
          input.autoSuggestNextAction ?? true ? 1 : 0,
          input.modelName || "gemini-1.5-flash",
          // for on duplicate key update:
          input.isEnabled !== undefined ? (input.isEnabled ? 1 : 0) : null,
          input.systemPrompt !== undefined ? input.systemPrompt : null,
          input.qualificationCriteria !== undefined ? input.qualificationCriteria : null,
          input.autoSuggestNextAction !== undefined ? (input.autoSuggestNextAction ? 1 : 0) : null,
          input.modelName !== undefined ? input.modelName : null,
        ]
      );

      return { success: true };
    }),

  suggestNextAction: megadeskProcedure
    .input(aiSuggestNextActionInput)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireCrmOpportunityAccess(ctx);
      const pool = getPool();

      let dealContext = "";
      if (input.opportunityPublicId) {
        const [opps] = await pool.query<RowDataPacket[]>(
          `SELECT o.title, o.value_cents, o.status, o.loss_reason, s.name as stage_name, c.company_name
           FROM megadesk_crm_opportunities o
           LEFT JOIN megadesk_crm_stages s ON s.client_id = o.client_id AND s.id = o.stage_id
           LEFT JOIN megadesk_crm_clients c ON c.client_id = o.client_id AND c.crm_client_id = o.crm_client_id
           WHERE o.client_id = ? AND o.public_id = ? LIMIT 1`,
          [tenantId, input.opportunityPublicId]
        );
        if (opps.length > 0) {
          const opp = opps[0];
          dealContext += `Oportunidade: ${opp.title} | Estágio: ${opp.stage_name} | Valor: R$ ${(Number(opp.value_cents || 0) / 100).toFixed(2)} | Cliente: ${opp.company_name || "N/A"}\n`;
        }
      }

      if (input.crmClientId) {
        const [clients] = await pool.query<RowDataPacket[]>(
          `SELECT company_name, status, origin, observations FROM megadesk_crm_clients WHERE client_id = ? AND crm_client_id = ? LIMIT 1`,
          [tenantId, input.crmClientId]
        );
        if (clients.length > 0) {
          const c = clients[0];
          dealContext += `Cliente: ${c.company_name} | Status: ${c.status} | Origem: ${c.origin} | Notas: ${c.observations || "N/A"}\n`;
        }
      }

      if (input.contextNotes) {
        dealContext += `Notas do Operador: ${input.contextNotes}\n`;
      }

      const prompt = `Com base no contexto do negócio abaixo, recomende a Próxima Melhor Ação Comercial (Next Best Action):\n${dealContext}\nFormato de resposta:\n1. Ação Recomendada (ex: Enviar Follow-up WhatsApp, Agendar Reunião de Alinhamento)\n2. Justificativa Estratégica (1 frase)\n3. Rascunho de Mensagem ou Abordagem sugerida`;

      try {
        const suggestion = await generateAIResponse(
          [{ role: "user", content: prompt }],
          "Você é o copiloto comercial de alta performance do MegaDesk CRM."
        );
        return { suggestion };
      } catch (err: any) {
        return {
          suggestion: `Ação sugerida: Entrar em contato via WhatsApp para confirmar interesse na proposta.\nJustificativa: Manter proximidade e identificar possíveis objeções rapidamente.\nRascunho: "Olá! Tudo bem? Gostaria de saber se você teve a oportunidade de avaliar nossa proposta e se ficou alguma dúvida!"`,
        };
      }
    }),
});
