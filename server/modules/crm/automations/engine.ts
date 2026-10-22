import { randomUUID } from "node:crypto";
import { getPool } from "../../../db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { evaluateConditions, evaluateConditionsDetailed, type RuleCondition, type ConditionEvaluationDetail } from "./conditions";
import { generateAIResponse } from "../../../_core/gemini";
import { addCrmTimeline } from "../../../db-crm";

export interface ActionResult {
  actionType: string;
  status: "success" | "failed" | "skipped";
  detail?: Record<string, unknown>;
  error?: string;
}

export interface AutomationExecutionResult {
  runPublicId: string;
  status: "success" | "failed" | "partial" | "skipped";
  conditionsMet: boolean;
  conditionEvaluations: ConditionEvaluationDetail[];
  actionsToTrigger: Array<{ type: string; config?: Record<string, any> }>;
  results: ActionResult[];
  durationMs: number;
  errorMessage?: string;
}

export function substituteVariables(
  template: string,
  context: Record<string, unknown>
): string {
  if (!template) return "";
  return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, key) => {
    let cur: any = context;
    for (const part of key.split(".")) {
      if (cur === null || typeof cur !== "object") return "";
      cur = cur[part];
    }
    return cur !== undefined && cur !== null ? String(cur) : "";
  });
}

export async function executeAutomationRule(
  clientId: string,
  rule: {
    id: number;
    publicId: string;
    name: string;
    triggerType: string;
    conditions: any;
    actions: any;
    isActive: boolean;
  },
  event: {
    eventType: string;
    payload: Record<string, unknown>;
  },
  actor = "Motor de Automações"
): Promise<AutomationExecutionResult> {
  const startTime = Date.now();
  const runPublicId = randomUUID();
  const pool = getPool();

  // Parse conditions & actions if stringified
  const conditions: RuleCondition[] =
    typeof rule.conditions === "string"
      ? JSON.parse(rule.conditions)
      : rule.conditions || [];
  const actions: Array<{ type: string; config?: Record<string, any> }> =
    typeof rule.actions === "string"
      ? JSON.parse(rule.actions)
      : rule.actions || [];

  // Evaluate conditions
  const { allMatched: conditionsMet, evaluations } = evaluateConditionsDetailed(conditions, event.payload);
  if (!conditionsMet) {
    const durationMs = Date.now() - startTime;
    const skipResults: ActionResult[] = [
      {
        actionType: "conditions_check",
        status: "skipped",
        detail: {
          reason: "Condições não atendidas para o evento.",
          evaluations,
        },
      },
    ];

    try {
      await pool.execute(
        `INSERT INTO megadesk_crm_automation_runs
         (public_id, client_id, rule_id, rule_name, event_type, status, trigger_payload, results, error_message, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          runPublicId,
          clientId,
          rule.id,
          rule.name,
          event.eventType,
          "skipped",
          JSON.stringify(event.payload),
          JSON.stringify(skipResults),
          "Condições não atendidas.",
          durationMs,
        ]
      );
    } catch (logErr) {
      console.error("[CRM Automations] Erro ao gravar execução pulada:", logErr);
    }

    return {
      runPublicId,
      status: "skipped",
      conditionsMet: false,
      conditionEvaluations: evaluations,
      actionsToTrigger: actions,
      results: skipResults,
      durationMs,
      errorMessage: "Condições não atendidas para o payload informado.",
    };
  }

  const results: ActionResult[] = [];
  let hasFailed = false;
  let hasSuccess = false;

  for (const action of actions) {
    const config = action.config || {};
    try {
      switch (action.type) {
        case "create_task": {
          const taskPublicId = randomUUID();
          const title = substituteVariables(
            config.title || "Tarefa Automática",
            event.payload
          );
          const description = substituteVariables(
            config.description || "",
            event.payload
          );
          const taskType = config.type || "task";
          const assignedTo = substituteVariables(
            config.assignedTo || "",
            event.payload
          );

          // Calculate due date if relative hours provided
          let dueAtIso: string | null = null;
          if (config.dueHours && Number(config.dueHours) > 0) {
            dueAtIso = new Date(
              Date.now() + Number(config.dueHours) * 3600 * 1000
            )
              .toISOString()
              .slice(0, 19)
              .replace("T", " ");
          }

          const opportunityPublicId =
            (event.payload.opportunity_public_id as string) ||
            (event.payload.opportunityPublicId as string) ||
            null;
          const crmClientId =
            (event.payload.crm_client_id as string) ||
            (event.payload.crmClientId as string) ||
            null;

          let opportunityId: number | null = null;
          if (opportunityPublicId) {
            const [oppRows] = await pool.query<RowDataPacket[]>(
              `SELECT id FROM megadesk_crm_opportunities WHERE client_id = ? AND public_id = ? LIMIT 1`,
              [clientId, opportunityPublicId]
            );
            if (oppRows.length > 0) opportunityId = Number(oppRows[0].id);
          }

          if (opportunityId || crmClientId) {
            await pool.execute(
              `INSERT INTO megadesk_crm_activities
               (public_id, client_id, opportunity_id, crm_client_id, type, title, description, due_at, status, assigned_to, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NOW(), NOW())`,
              [
                taskPublicId,
                clientId,
                opportunityId,
                crmClientId,
                taskType,
                title,
                description || null,
                dueAtIso,
                assignedTo,
                actor,
              ]
            );

            results.push({
              actionType: "create_task",
              status: "success",
              detail: { taskPublicId, title, taskType, dueAt: dueAtIso },
            });
            hasSuccess = true;
          } else {
            results.push({
              actionType: "create_task",
              status: "skipped",
              detail: { reason: "Nenhuma oportunidade ou cliente vinculado." },
            });
          }
          break;
        }

        case "assign_owner": {
          const newOwner = substituteVariables(config.owner || "", event.payload).trim();
          const crmClientId =
            (event.payload.crm_client_id as string) ||
            (event.payload.crmClientId as string) ||
            null;
          const opportunityPublicId =
            (event.payload.opportunity_public_id as string) ||
            (event.payload.opportunityPublicId as string) ||
            null;

          if (newOwner) {
            if (crmClientId) {
              await pool.execute(
                `UPDATE megadesk_crm_clients SET internal_responsible = ? WHERE client_id = ? AND crm_client_id = ?`,
                [newOwner, clientId, crmClientId]
              );
            }
            if (opportunityPublicId) {
              await pool.execute(
                `UPDATE megadesk_crm_opportunities SET internal_responsible = ? WHERE client_id = ? AND public_id = ?`,
                [newOwner, clientId, opportunityPublicId]
              );
            }

            results.push({
              actionType: "assign_owner",
              status: "success",
              detail: { newOwner, crmClientId, opportunityPublicId },
            });
            hasSuccess = true;
          }
          break;
        }

        case "add_tag": {
          const tagToAdd = substituteVariables(config.tag || "", event.payload).trim();
          const crmClientId =
            (event.payload.crm_client_id as string) ||
            (event.payload.crmClientId as string) ||
            null;

          if (tagToAdd && crmClientId) {
            const [rows] = await pool.query<RowDataPacket[]>(
              `SELECT tags FROM megadesk_crm_clients WHERE client_id = ? AND crm_client_id = ? LIMIT 1`,
              [clientId, crmClientId]
            );
            if (rows.length > 0) {
              const currentTags = String(rows[0].tags || "")
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean);
              if (!currentTags.includes(tagToAdd)) {
                currentTags.push(tagToAdd);
                await pool.execute(
                  `UPDATE megadesk_crm_clients SET tags = ? WHERE client_id = ? AND crm_client_id = ?`,
                  [currentTags.join(", "), clientId, crmClientId]
                );
              }
            }

            results.push({
              actionType: "add_tag",
              status: "success",
              detail: { tag: tagToAdd, crmClientId },
            });
            hasSuccess = true;
          }
          break;
        }

        case "send_whatsapp": {
          const messageTemplate = config.message || "";
          const message = substituteVariables(messageTemplate, event.payload);
          const rawPhone =
            (event.payload.phone as string) ||
            (event.payload.whatsapp as string) ||
            "";
          const cleanPhone = rawPhone.replace(/\D/g, "");

          const crmClientId =
            (event.payload.crm_client_id as string) ||
            (event.payload.crmClientId as string) ||
            null;

          // 1. Opt-out check
          if (crmClientId) {
            const [clientRows] = await pool.query<RowDataPacket[]>(
              `SELECT tags, phone, whatsapp, lifecycle FROM megadesk_crm_clients WHERE client_id = ? AND crm_client_id = ? LIMIT 1`,
              [clientId, crmClientId]
            );
            if (clientRows.length > 0) {
              const tags = String(clientRows[0].tags || "").toLowerCase();
              if (
                tags.includes("opt-out") ||
                tags.includes("nao-perturbe") ||
                tags.includes("bloqueado") ||
                clientRows[0].lifecycle === "archived"
              ) {
                results.push({
                  actionType: "send_whatsapp",
                  status: "skipped",
                  detail: { reason: "Cliente com opt-out/não-perturbe registrado ou arquivado." },
                });
                break;
              }
            }
          }

          if (!cleanPhone) {
            results.push({
              actionType: "send_whatsapp",
              status: "skipped",
              detail: { reason: "Telefone/WhatsApp de contato não informado." },
            });
            break;
          }

          // 2. Frequency limit (do not spam the same client in last 15 minutes)
          if (crmClientId) {
            const [recentRuns] = await pool.query<RowDataPacket[]>(
              `SELECT id FROM megadesk_crm_automation_runs
               WHERE client_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
                 AND results LIKE ? LIMIT 1`,
              [clientId, `%"actionType":"send_whatsapp"%"status":"success"%${cleanPhone}%`]
            );
            if (recentRuns.length > 0) {
              results.push({
                actionType: "send_whatsapp",
                status: "skipped",
                detail: { reason: "Controle de frequência ativo: mensagem já enviada recentemente nos últimos 15 min." },
              });
              break;
            }
          }

          // 3. Real WhatsApp Dispatch via Evolution Adapter (graceful fallback if offline)
          let dispatchStatus = "prepared";
          try {
            const { getEvolutionAdapter } = await import("../../../evolution-manager");
            const adapter = getEvolutionAdapter();
            const res = await adapter.sendMessage(clientId, cleanPhone, message);
            if (res.ok) {
              dispatchStatus = "sent";
            }
          } catch {
            // Evolution offline or not provisioned: falls back to queueing in CRM timeline
            dispatchStatus = "prepared";
          }

          if (crmClientId) {
            await addCrmTimeline(crmClientId, clientId, {
              type: "call",
              description: `[Automação] WhatsApp ${dispatchStatus === "sent" ? "enviado com sucesso" : "preparado para envio"}: "${message}"`,
              author: actor,
            });
          }

          results.push({
            actionType: "send_whatsapp",
            status: "success",
            detail: { phone: cleanPhone, message, dispatchStatus },
          });
          hasSuccess = true;
          break;
        }

        case "ai_qualify": {
          // Check tenant AI settings
          const [aiConfigRows] = await pool.query<RowDataPacket[]>(
            `SELECT is_enabled, system_prompt, qualification_criteria, model_name
             FROM megadesk_crm_ai_settings
             WHERE client_id = ? LIMIT 1`,
            [clientId]
          );

          if (aiConfigRows.length > 0 && !Boolean(aiConfigRows[0].is_enabled)) {
            results.push({
              actionType: "ai_qualify",
              status: "skipped",
              detail: { reason: "Módulo de IA desativado nas configurações do CRM." },
            });
            break;
          }

          const aiCfg = aiConfigRows[0] || {};
          const customPrompt = aiCfg.system_prompt?.trim() || "Você é um analista sênior de qualificação de leads comerciais do MegaDesk CRM.";
          const criteria = aiCfg.qualification_criteria?.trim() || "Avalie interesse comercial, clareza da demanda e adequação ao ERP.";

          const leadName = (event.payload.company_name as string) || (event.payload.name as string) || "";
          const leadNotes = (event.payload.observations as string) || (event.payload.message as string) || "";
          const crmClientId = (event.payload.crm_client_id as string) || null;

          let aiAnalysis = "";
          try {
            aiAnalysis = await generateAIResponse(
              [
                {
                  role: "user",
                  content: `Critérios de Qualificação:\n${criteria}\n\nDados do Lead:\nNome/Empresa: ${leadName}\nNotas/Mensagem: ${leadNotes}\n\nRetorne em 2 a 3 linhas: Score estimado (0-100), Perfil e Ação sugerida ao vendedor.`,
                },
              ],
              customPrompt
            );
          } catch (aiErr: any) {
            aiAnalysis = `Qualificação básica preliminar: Lead recebido com interesse comercial ativo. (IA offline: ${aiErr.message})`;
          }

          if (crmClientId) {
            await addCrmTimeline(crmClientId, clientId, {
              type: "note",
              description: `[Sugestão IA - Pendente de Validação Humana]\n${aiAnalysis}`,
              author: "Assistente IA (Sugestão)",
            });
          }

          results.push({
            actionType: "ai_qualify",
            status: "success",
            detail: { analysis: aiAnalysis, requiresHumanReview: true },
          });
          hasSuccess = true;
          break;
        }

        case "call_webhook": {
          const url = config.url;
          if (url && typeof url === "string" && url.startsWith("http")) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": "MegaDesk-CRM-Automations/1.0",
              },
              body: JSON.stringify({
                event: event.eventType,
                ruleName: rule.name,
                payload: event.payload,
                timestamp: new Date().toISOString(),
              }),
              signal: controller.signal,
            });
            clearTimeout(timeoutId);

            results.push({
              actionType: "call_webhook",
              status: res.ok ? "success" : "failed",
              detail: { url, httpStatus: res.status },
            });
            if (res.ok) hasSuccess = true;
            else hasFailed = true;
          }
          break;
        }

        default:
          results.push({
            actionType: action.type,
            status: "skipped",
            detail: { reason: `Tipo de ação desconhecido: ${action.type}` },
          });
      }
    } catch (actErr: any) {
      hasFailed = true;
      results.push({
        actionType: action.type,
        status: "failed",
        error: actErr?.message || "Erro desconhecido ao executar ação.",
      });
    }
  }

  const durationMs = Date.now() - startTime;
  const overallStatus =
    hasFailed && hasSuccess
      ? "partial"
      : hasFailed
      ? "failed"
      : hasSuccess
      ? "success"
      : "skipped";

  // Record Run Log in DB
  try {
    await pool.execute(
      `INSERT INTO megadesk_crm_automation_runs
       (public_id, client_id, rule_id, rule_name, event_type, status, trigger_payload, results, error_message, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        runPublicId,
        clientId,
        rule.id,
        rule.name,
        event.eventType,
        overallStatus,
        JSON.stringify(event.payload),
        JSON.stringify(results),
        hasFailed ? "Uma ou mais ações falharam." : null,
        durationMs,
      ]
    );

    // Update rule execution count
    await pool.execute(
      `UPDATE megadesk_crm_automation_rules
       SET execution_count = execution_count + 1, last_executed_at = NOW(), updated_at = NOW()
       WHERE client_id = ? AND id = ?`,
      [clientId, rule.id]
    );
  } catch (logErr) {
    console.error("[CRM Automations] Erro ao gravar histórico de execução:", logErr);
  }

  return {
    runPublicId,
    status: overallStatus,
    conditionsMet: true,
    conditionEvaluations: evaluations,
    actionsToTrigger: actions,
    results,
    durationMs,
  };
}

export async function dispatchCrmEvent(
  clientId: string,
  eventType: string,
  payload: Record<string, unknown>,
  actor = "Sistema CRM"
) {
  const pool = getPool();
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, public_id, name, trigger_type, conditions, actions, is_active
       FROM megadesk_crm_automation_rules
       WHERE client_id = ? AND trigger_type = ? AND is_active = 1`,
      [clientId, eventType]
    );

    for (const r of rows) {
      await executeAutomationRule(
        clientId,
        {
          id: Number(r.id),
          publicId: r.public_id,
          name: r.name,
          triggerType: r.trigger_type,
          conditions: r.conditions,
          actions: r.actions,
          isActive: Boolean(r.is_active),
        },
        { eventType, payload },
        actor
      );
    }
  } catch (err) {
    console.error(`[CRM Automations] Falha ao despachar evento ${eventType}:`, err);
  }
}
