import { randomUUID } from "node:crypto";
import { getPool } from "../../db";

export type AiFeatureSource = "whatsapp_bot" | "assistant_chat" | "voice_shortcut" | "automation";

export interface RecordAiUsageInput {
  tenantId: string;
  userId?: string | null;
  featureSource: AiFeatureSource;
  conversationId?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  usage?: unknown;
}

export function extractAiTokens(usage: unknown): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  const u = (usage || {}) as Record<string, unknown>;
  const promptTokens = Number(u.promptTokens ?? u.inputTokens ?? 0);
  const completionTokens = Number(u.completionTokens ?? u.outputTokens ?? 0);
  let totalTokens = Number(u.totalTokens ?? 0);
  if (totalTokens === 0 && (promptTokens > 0 || completionTokens > 0)) {
    totalTokens = promptTokens + completionTokens;
  }
  return {
    promptTokens: isNaN(promptTokens) ? 0 : Math.max(0, Math.round(promptTokens)),
    completionTokens: isNaN(completionTokens) ? 0 : Math.max(0, Math.round(completionTokens)),
    totalTokens: isNaN(totalTokens) ? 0 : Math.max(0, Math.round(totalTokens)),
  };
}

export interface AiTokenUsageSummary {
  summary: {
    total_limit: number;
    total_used: number;
    remaining_tokens: number;
    percent_used: number;
    cycle_renewal_date: string;
    days_remaining: number;
  };
  by_source: Array<{
    source: AiFeatureSource;
    label: string;
    tokens: number;
    percentage: number;
  }>;
  by_operator: Array<{
    userId: string;
    name: string;
    email?: string;
    tokens: number;
    percentage: number;
  }>;
  recent_activity: Array<{
    id: string;
    createdAt: string;
    operatorName: string;
    featureSource: AiFeatureSource;
    featureLabel: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>;
}

const FEATURE_LABELS: Record<AiFeatureSource, string> = {
  assistant_chat: "Assistente IA",
  whatsapp_bot: "Bot WhatsApp",
  automation: "Automações",
  voice_shortcut: "Atalho por Voz",
};

let tableEnsured = false;

/**
 * Garante idempotentemente a existência da tabela megadesk_ai_usage_logs.
 */
export async function ensureAiUsageLogsTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    const pool = getPool();
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS \`megadesk_ai_usage_logs\` (
        \`id\` varchar(36) NOT NULL,
        \`tenant_id\` varchar(36) NOT NULL,
        \`user_id\` varchar(36),
        \`feature_source\` varchar(32) NOT NULL,
        \`conversation_id\` varchar(36),
        \`prompt_tokens\` int NOT NULL,
        \`completion_tokens\` int NOT NULL,
        \`total_tokens\` int NOT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_ai_usage_tenant_created\` (\`tenant_id\`, \`created_at\`),
        KEY \`idx_ai_usage_tenant_user\` (\`tenant_id\`, \`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    try {
      await pool.execute(`
        ALTER TABLE \`megadesk_domain_clients\`
        ADD COLUMN \`ai_monthly_token_limit\` int DEFAULT 1000000;
      `);
    } catch {
      // Coluna já existente ou permissão restrita
    }

    try {
      await pool.execute(`
        ALTER TABLE \`megadesk_domain_clients\`
        ADD COLUMN \`ai_cycle_renewal_date\` timestamp NULL;
      `);
    } catch {
      // Coluna já existente ou permissão restrita
    }

    tableEnsured = true;
  } catch (err) {
    console.warn("[AiUsageService] Aviso ao verificar tabela megadesk_ai_usage_logs:", err);
  }
}

/**
 * Registra o consumo de tokens de forma não-bloqueante e assíncrona.
 */
export async function recordAiUsageLog(input: RecordAiUsageInput): Promise<void> {
  const fromUsage = input.usage ? extractAiTokens(input.usage) : null;
  const promptTokens = Math.max(0, Math.round(input.promptTokens ?? fromUsage?.promptTokens ?? 0));
  const completionTokens = Math.max(0, Math.round(input.completionTokens ?? fromUsage?.completionTokens ?? 0));
  let totalTokens = Math.max(0, Math.round(input.totalTokens ?? fromUsage?.totalTokens ?? 0));

  if (totalTokens === 0 && (promptTokens > 0 || completionTokens > 0)) {
    totalTokens = promptTokens + completionTokens;
  }

  // Se não houve consumo de tokens nem valores informados, não grava log vazio
  if (totalTokens <= 0 && promptTokens <= 0 && completionTokens <= 0) {
    return;
  }

  try {
    await ensureAiUsageLogsTable();
    const pool = getPool();
    const id = randomUUID();

    await pool.execute(
      `INSERT INTO megadesk_ai_usage_logs
        (id, tenant_id, user_id, feature_source, conversation_id, prompt_tokens, completion_tokens, total_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        id,
        input.tenantId,
        input.userId || null,
        input.featureSource,
        input.conversationId || null,
        promptTokens,
        completionTokens,
        totalTokens,
      ]
    );
  } catch (err) {
    console.error("[AiUsageService] Erro ao registrar log de consumo de IA:", err);
  }
}

/**
 * Calcula as datas do ciclo mensal (início e término/renovação).
 */
export function calculateMonthlyBillingCycle(
  referenceDate = new Date(),
  billingDay = 1
): { cycleStart: Date; cycleEnd: Date; daysRemaining: number } {
  const now = new Date(referenceDate);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed
  const currentDay = now.getDate();

  let cycleStart: Date;
  let cycleEnd: Date;

  if (currentDay >= billingDay) {
    cycleStart = new Date(currentYear, currentMonth, billingDay, 0, 0, 0, 0);
    cycleEnd = new Date(currentYear, currentMonth + 1, billingDay, 23, 59, 59, 999);
  } else {
    cycleStart = new Date(currentYear, currentMonth - 1, billingDay, 0, 0, 0, 0);
    cycleEnd = new Date(currentYear, currentMonth, billingDay, 23, 59, 59, 999);
  }

  const diffMs = cycleEnd.getTime() - now.getTime();
  const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  return { cycleStart, cycleEnd, daysRemaining };
}

/**
 * Consulta e consolida os dados de consumo de tokens para a empresa/tenant.
 */
export async function getAiTokenUsageSummary(tenantId: string): Promise<AiTokenUsageSummary> {
  await ensureAiUsageLogsTable();
  const pool = getPool();

  // 1. Obtém cota e dados do cliente/tenant
  let monthlyLimit = 1_000_000;
  let billingDay = 1;

  try {
    const [clientRows] = await pool.execute(
      `SELECT ai_monthly_token_limit, ai_cycle_renewal_date, created_at
       FROM megadesk_domain_clients
       WHERE client_id = ?
       LIMIT 1`,
      [tenantId]
    ) as any[];

    if (clientRows?.[0]) {
      if (typeof clientRows[0].ai_monthly_token_limit === "number" && clientRows[0].ai_monthly_token_limit > 0) {
        monthlyLimit = clientRows[0].ai_monthly_token_limit;
      }
      if (clientRows[0].created_at) {
        const created = new Date(clientRows[0].created_at);
        if (!isNaN(created.getDate())) {
          billingDay = Math.min(28, created.getDate()); // Evita overflow de fevereiro
        }
      }
    }
  } catch (err) {
    console.warn("[AiUsageService] Aviso ao consultar limite do tenant em megadesk_domain_clients:", err);
  }

  const { cycleStart, cycleEnd, daysRemaining } = calculateMonthlyBillingCycle(new Date(), billingDay);

  // 2. Consulta o total consumido no ciclo atual
  let totalUsed = 0;
  try {
    const [totalRows] = await pool.execute(
      `SELECT COALESCE(SUM(total_tokens), 0) as total_used
       FROM megadesk_ai_usage_logs
       WHERE tenant_id = ? AND created_at >= ? AND created_at <= ?`,
      [tenantId, cycleStart, cycleEnd]
    ) as any[];

    if (totalRows?.[0]?.total_used) {
      totalUsed = Number(totalRows[0].total_used);
    }
  } catch (err) {
    console.error("[AiUsageService] Erro ao consultar total_tokens:", err);
  }

  const remainingTokens = Math.max(0, monthlyLimit - totalUsed);
  const percentUsed = monthlyLimit > 0 ? Math.min(100, Math.round(((totalUsed / monthlyLimit) * 100) * 10) / 10) : 0;

  // 3. Consumo agrupado por feature_source
  const sourceMap: Record<AiFeatureSource, number> = {
    assistant_chat: 0,
    whatsapp_bot: 0,
    automation: 0,
    voice_shortcut: 0,
  };

  try {
    const [sourceRows] = await pool.execute(
      `SELECT feature_source, COALESCE(SUM(total_tokens), 0) as tokens
       FROM megadesk_ai_usage_logs
       WHERE tenant_id = ? AND created_at >= ? AND created_at <= ?
       GROUP BY feature_source`,
      [tenantId, cycleStart, cycleEnd]
    ) as any[];

    for (const row of sourceRows || []) {
      const src = row.feature_source as AiFeatureSource;
      if (src in sourceMap) {
        sourceMap[src] = Number(row.tokens);
      }
    }
  } catch (err) {
    console.error("[AiUsageService] Erro ao agrupar por source:", err);
  }

  const bySource = (Object.keys(sourceMap) as AiFeatureSource[]).map((src) => {
    const tokens = sourceMap[src];
    const percentage = totalUsed > 0 ? Math.min(100, Math.round((tokens / totalUsed) * 100)) : 0;
    return {
      source: src,
      label: FEATURE_LABELS[src],
      tokens,
      percentage,
    };
  });

  // 4. Consumo agrupado por operador (user_id)
  const byOperator: Array<{
    userId: string;
    name: string;
    email?: string;
    tokens: number;
    percentage: number;
  }> = [];

  const userNameMap = new Map<string, { name: string; email?: string }>();

  try {
    const [operatorRows] = await pool.execute(
      `SELECT user_id, COALESCE(SUM(total_tokens), 0) as tokens
       FROM megadesk_ai_usage_logs
       WHERE tenant_id = ? AND created_at >= ? AND created_at <= ?
       GROUP BY user_id
       ORDER BY tokens DESC`,
      [tenantId, cycleStart, cycleEnd]
    ) as any[];

    // Tenta mapear nomes dos operadores em megadesk_domain_client_users ou users
    const [userNames] = await pool.execute(
      `SELECT user_id, name, email
       FROM megadesk_domain_client_users
       WHERE client_id = ?`,
      [tenantId]
    ) as any[];

    for (const u of userNames || []) {
      if (u.user_id) {
        userNameMap.set(String(u.user_id).toLowerCase(), {
          name: u.name || u.email || "Operador",
          email: u.email,
        });
      }
      if (u.email) {
        userNameMap.set(String(u.email).toLowerCase(), {
          name: u.name || u.email || "Operador",
          email: u.email,
        });
      }
    }

    for (const row of operatorRows || []) {
      const rawUserId = row.user_id ? String(row.user_id).trim() : null;
      const tokens = Number(row.tokens);
      const percentage = totalUsed > 0 ? Math.min(100, Math.round((tokens / totalUsed) * 100)) : 0;

      if (!rawUserId || rawUserId === "bot_system") {
        byOperator.push({
          userId: rawUserId || "system",
          name: "Robô / Automação Autônoma",
          tokens,
          percentage,
        });
      } else {
        const found = userNameMap.get(rawUserId.toLowerCase());
        byOperator.push({
          userId: rawUserId,
          name: found?.name || rawUserId,
          email: found?.email,
          tokens,
          percentage,
        });
      }
    }
  } catch (err) {
    console.error("[AiUsageService] Erro ao agrupar por operador:", err);
  }

  // Se não houver operador registrado ainda, insere placeholder elegante
  if (byOperator.length === 0) {
    byOperator.push({
      userId: "none",
      name: "Nenhum consumo registrado no ciclo",
      tokens: 0,
      percentage: 0,
    });
  }

  // 5. Últimas 10 atividades recentes
  const recentActivity: Array<{
    id: string;
    createdAt: string;
    operatorName: string;
    featureSource: AiFeatureSource;
    featureLabel: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }> = [];

  try {
    const [recentRows] = await pool.execute(
      `SELECT id, user_id, feature_source, prompt_tokens, completion_tokens, total_tokens, created_at
       FROM megadesk_ai_usage_logs
       WHERE tenant_id = ?
       ORDER BY created_at DESC
       LIMIT 10`,
      [tenantId]
    ) as any[];

    for (const row of recentRows || []) {
      const src = (row.feature_source as AiFeatureSource) in FEATURE_LABELS
        ? (row.feature_source as AiFeatureSource)
        : "assistant_chat";
      const opName = row.user_id
        ? (userNameMap.get(String(row.user_id).toLowerCase())?.name || String(row.user_id))
        : "Robô / Sistema";

      recentActivity.push({
        id: String(row.id),
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        operatorName: opName,
        featureSource: src,
        featureLabel: FEATURE_LABELS[src],
        promptTokens: Number(row.prompt_tokens || 0),
        completionTokens: Number(row.completion_tokens || 0),
        totalTokens: Number(row.total_tokens || 0),
      });
    }
  } catch (err) {
    console.error("[AiUsageService] Erro ao consultar atividades recentes:", err);
  }

  return {
    summary: {
      total_limit: monthlyLimit,
      total_used: totalUsed,
      remaining_tokens: remainingTokens,
      percent_used: percentUsed,
      cycle_renewal_date: cycleEnd.toISOString(),
      days_remaining: daysRemaining,
    },
    by_source: bySource,
    by_operator: byOperator,
    recent_activity: recentActivity,
  };
}

