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
  promptText?: string | null;
  completionText?: string | null;
  fallbackPromptChars?: number | null;
  fallbackCompletionChars?: number | null;
}

export function extractAiTokens(usage: unknown): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  const u = (usage || {}) as Record<string, unknown>;
  const meta = (u.usageMetadata || {}) as Record<string, unknown>;

  const promptTokens = Number(
    u.promptTokens ??
      u.inputTokens ??
      u.promptTokenCount ??
      meta.promptTokenCount ??
      0
  );

  const completionTokens = Number(
    u.completionTokens ??
      u.outputTokens ??
      u.candidatesTokenCount ??
      meta.candidatesTokenCount ??
      0
  );

  let totalTokens = Number(
    u.totalTokens ??
      u.totalTokenCount ??
      meta.totalTokenCount ??
      0
  );

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
 * Garante idempotentemente a existência e o tamanho correto das colunas da tabela megadesk_ai_usage_logs.
 * Também sincroniza retroativamente registros legados de megadesk_ia_token_usage se existirem.
 */
export async function ensureAiUsageLogsTable(poolOverride?: any): Promise<void> {
  if (tableEnsured) return;
  try {
    let pool = poolOverride;
    if (!pool) {
      pool = getPool();
    }
    // Criação da tabela com colunas dimensionadas para IDs longos (ex: "cliente-uuid" = 44 chars)
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS \`megadesk_ai_usage_logs\` (
        \`id\` varchar(100) NOT NULL,
        \`tenant_id\` varchar(100) NOT NULL,
        \`user_id\` varchar(191),
        \`feature_source\` varchar(32) NOT NULL,
        \`conversation_id\` varchar(191),
        \`prompt_tokens\` int NOT NULL,
        \`completion_tokens\` int NOT NULL,
        \`total_tokens\` int NOT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_ai_usage_tenant_created\` (\`tenant_id\`, \`created_at\`),
        KEY \`idx_ai_usage_tenant_user\` (\`tenant_id\`, \`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Altera colunas existentes caso a tabela tenha sido criada anteriormente com varchar(36)
    try {
      await pool.execute(`
        ALTER TABLE \`megadesk_ai_usage_logs\`
        MODIFY \`id\` varchar(100) NOT NULL,
        MODIFY \`tenant_id\` varchar(100) NOT NULL,
        MODIFY \`user_id\` varchar(191) NULL,
        MODIFY \`conversation_id\` varchar(191) NULL;
      `);
    } catch {
      // Ignora erro se as colunas já estiverem no formato correto
    }

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

    // Migração transparente de dados legados de megadesk_ia_token_usage se existirem
    try {
      await pool.execute(`
        INSERT IGNORE INTO \`megadesk_ai_usage_logs\`
          (\`id\`, \`tenant_id\`, \`user_id\`, \`feature_source\`, \`conversation_id\`, \`prompt_tokens\`, \`completion_tokens\`, \`total_tokens\`, \`created_at\`)
        SELECT
          \`id\`,
          \`client_id\`,
          \`user_email\`,
          'assistant_chat',
          \`conversation_id\`,
          \`prompt_tokens\`,
          \`completion_tokens\`,
          \`total_tokens\`,
          FROM_UNIXTIME(\`created_at\` / 1000)
        FROM \`megadesk_ia_token_usage\`
        WHERE \`created_at\` > 0;
      `);
    } catch {
      // Tabela de origem pode não existir em outros ambientes
    }

    tableEnsured = true;
  } catch (err) {
    console.warn("[AiUsageService] Aviso ao verificar tabela megadesk_ai_usage_logs:", err);
  }
}

/**
 * Registra o consumo de tokens de forma persistente.
 * Suporta contagem real nativa e fallback seguro por estimativa de caracteres.
 */
export async function recordAiUsageLog(input: RecordAiUsageInput, poolOverride?: any): Promise<void> {
  const fromUsage = input.usage ? extractAiTokens(input.usage) : null;
  let promptTokens = Math.max(0, Math.round(input.promptTokens ?? fromUsage?.promptTokens ?? 0));
  let completionTokens = Math.max(0, Math.round(input.completionTokens ?? fromUsage?.completionTokens ?? 0));
  let totalTokens = Math.max(0, Math.round(input.totalTokens ?? fromUsage?.totalTokens ?? 0));

  // Fallback seguro de estimativa (Math.ceil(chars / 4)) APENAS se o provedor não reportou tokens reais
  if (promptTokens === 0 && (input.promptText || input.fallbackPromptChars)) {
    const chars = input.promptText ? input.promptText.length : (input.fallbackPromptChars ?? 0);
    if (chars > 0) {
      promptTokens = Math.max(1, Math.ceil(chars / 4));
    }
  }

  if (completionTokens === 0 && (input.completionText || input.fallbackCompletionChars)) {
    const chars = input.completionText ? input.completionText.length : (input.fallbackCompletionChars ?? 0);
    if (chars > 0) {
      completionTokens = Math.max(1, Math.ceil(chars / 4));
    }
  }

  if (totalTokens === 0 && (promptTokens > 0 || completionTokens > 0)) {
    totalTokens = promptTokens + completionTokens;
  }

  // Se não houve consumo computável nem texto de fallback, não grava log
  if (totalTokens <= 0 && promptTokens <= 0 && completionTokens <= 0) {
    return;
  }

  const cleanTenantId = String(input.tenantId || "main").trim();

  try {
    await ensureAiUsageLogsTable(poolOverride);
    let pool = poolOverride;
    if (!pool) {
      pool = getPool();
    }
    if (!pool) return;

    const id = randomUUID();

    await pool.execute(
      `INSERT INTO megadesk_ai_usage_logs
        (id, tenant_id, user_id, feature_source, conversation_id, prompt_tokens, completion_tokens, total_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        id,
        cleanTenantId,
        input.userId || null,
        input.featureSource,
        input.conversationId || null,
        promptTokens,
        completionTokens,
        totalTokens,
      ]
    );

    // Gravação retrocompatível em megadesk_ia_token_usage (se existir a tabela)
    try {
      await pool.execute(
        `INSERT INTO megadesk_ia_token_usage
          (id, client_id, user_email, conversation_id, prompt_tokens, completion_tokens, total_tokens, model, function_calls_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `tu-${id.slice(0, 20)}`,
          cleanTenantId,
          input.userId || "",
          input.conversationId || "",
          promptTokens,
          completionTokens,
          totalTokens,
          "ai-model",
          0,
          Date.now(),
        ]
      );
    } catch {
      // Ignora falha na tabela legada
    }
  } catch (err) {
    console.error("[AiUsageService] Erro ao registrar log de consumo de IA:", err);
    throw err;
  }
}

/**
 * Calcula as datas do ciclo mensal (início e término/renovação).
 * Se houver renewalDate no futuro (ex: 24/11/2026), o início do ciclo é SEMPRE 1 mês antes (24/10/2026),
 * garantindo que registros de hoje nunca sejam descartados pelo WHERE.
 */
export function calculateMonthlyBillingCycle(
  referenceDate = new Date(),
  billingDay = 1,
  renewalDate?: Date | null
): { cycleStart: Date; cycleEnd: Date; daysRemaining: number } {
  const now = new Date(referenceDate);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed
  const currentDay = now.getDate();

  let cycleStart: Date;
  let cycleEnd: Date;

  if (renewalDate && !isNaN(renewalDate.getTime())) {
    const renTime = renewalDate.getTime();
    if (renTime > now.getTime()) {
      // Data de renovação contratual futura (ex: 24/11/2026)
      cycleEnd = new Date(renewalDate);
      // O início do ciclo é 1 mês antes da data de renovação
      cycleStart = new Date(renewalDate.getFullYear(), renewalDate.getMonth() - 1, renewalDate.getDate(), 0, 0, 0, 0);

      // Proteção de contingência: se cycleStart ainda estiver no futuro, fallback para o dia 1 do mês corrente
      if (cycleStart.getTime() > now.getTime()) {
        cycleStart = new Date(currentYear, currentMonth, 1, 0, 0, 0, 0);
      }
    } else {
      // Data de renovação informada já passou; calcula próximo vencimento com base no dia correspondente
      const renDay = Math.min(28, renewalDate.getDate());
      if (currentDay >= renDay) {
        cycleStart = new Date(currentYear, currentMonth, renDay, 0, 0, 0, 0);
        cycleEnd = new Date(currentYear, currentMonth + 1, renDay, 23, 59, 59, 999);
      } else {
        cycleStart = new Date(currentYear, currentMonth - 1, renDay, 0, 0, 0, 0);
        cycleEnd = new Date(currentYear, currentMonth, renDay, 23, 59, 59, 999);
      }
    }
  } else {
    // Sem data explícita de renovação: calcula a partir de billingDay (default: 1)
    if (currentDay >= billingDay) {
      cycleStart = new Date(currentYear, currentMonth, billingDay, 0, 0, 0, 0);
      cycleEnd = new Date(currentYear, currentMonth + 1, billingDay, 23, 59, 59, 999);
    } else {
      cycleStart = new Date(currentYear, currentMonth - 1, billingDay, 0, 0, 0, 0);
      cycleEnd = new Date(currentYear, currentMonth, billingDay, 23, 59, 59, 999);
    }
  }

  const diffMs = cycleEnd.getTime() - now.getTime();
  const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  return { cycleStart, cycleEnd, daysRemaining };
}

/**
 * Consulta e consolida os dados de consumo de tokens para a empresa/tenant.
 * Aceita tanto tenantId com prefixo "cliente-" quanto sem prefixo, unificando a busca.
 */
export async function getAiTokenUsageSummary(tenantId: string, poolOverride?: any): Promise<AiTokenUsageSummary> {
  const cleanTenantId = String(tenantId || "main").trim();
  const altTenantId = cleanTenantId.startsWith("cliente-")
    ? cleanTenantId.replace(/^cliente-/, "")
    : `cliente-${cleanTenantId}`;

  await ensureAiUsageLogsTable(poolOverride);
  let pool = poolOverride;
  if (!pool) {
    try {
      pool = getPool();
    } catch {
      // Sem banco de dados disponível (ex: testes unitários)
    }
  }

  if (!pool) {
    const fallbackCycle = calculateMonthlyBillingCycle(new Date(), 1);
    return {
      summary: {
        total_used: 0,
        total_limit: 1_000_000,
        remaining_tokens: 1_000_000,
        percent_used: 0,
        cycle_renewal_date: fallbackCycle.cycleEnd.toLocaleDateString("pt-BR"),
        days_remaining: fallbackCycle.daysRemaining,
      },
      by_source: [],
      by_operator: [],
      recent_activity: [],
    };
  }

  // 1. Obtém cota e dados do cliente/tenant
  let monthlyLimit = 1_000_000;
  let billingDay = 1;
  let cycleRenewalDate: Date | null = null;
  let canonicalClientId = cleanTenantId;
  let internalClientId = cleanTenantId;

  try {
    const [clientRows] = await pool.execute(
      `SELECT client_id, internal_id, ai_monthly_token_limit, ai_cycle_renewal_date, created_at
       FROM megadesk_domain_clients
       WHERE client_id IN (?, ?) OR internal_id IN (?, ?)
       LIMIT 1`,
      [cleanTenantId, altTenantId, cleanTenantId, altTenantId]
    ) as any[];

    if (clientRows?.[0]) {
      const client = clientRows[0];
      if (client.client_id) canonicalClientId = client.client_id;
      if (client.internal_id) internalClientId = client.internal_id;

      if (typeof client.ai_monthly_token_limit === "number" && client.ai_monthly_token_limit > 0) {
        monthlyLimit = client.ai_monthly_token_limit;
      }
      if (client.ai_cycle_renewal_date) {
        const ren = new Date(client.ai_cycle_renewal_date);
        if (!isNaN(ren.getTime())) {
          cycleRenewalDate = ren;
        }
      }
      if (client.created_at) {
        const created = new Date(client.created_at);
        if (!isNaN(created.getDate())) {
          billingDay = Math.min(28, created.getDate()); // Evita overflow de fevereiro
        }
      }
    }
  } catch (err) {
    console.warn("[AiUsageService] Aviso ao consultar limite do tenant em megadesk_domain_clients:", err);
  }

  const { cycleStart, cycleEnd, daysRemaining } = calculateMonthlyBillingCycle(
    new Date(),
    billingDay,
    cycleRenewalDate
  );

  // Lista normalizada de identificadores de tenant para consulta abrangente
  const tenantIds = Array.from(
    new Set([cleanTenantId, altTenantId, canonicalClientId, internalClientId].filter(Boolean))
  );
  const tenantPlaceholders = tenantIds.map(() => "?").join(", ");

  // 2. Consulta o total consumido no ciclo atual
  let totalUsed = 0;
  try {
    const [totalRows] = await pool.execute(
      `SELECT COALESCE(SUM(total_tokens), 0) as total_used
       FROM megadesk_ai_usage_logs
       WHERE tenant_id IN (${tenantPlaceholders}) AND created_at >= ? AND created_at <= ?`,
      [...tenantIds, cycleStart, cycleEnd]
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
       WHERE tenant_id IN (${tenantPlaceholders}) AND created_at >= ? AND created_at <= ?
       GROUP BY feature_source`,
      [...tenantIds, cycleStart, cycleEnd]
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
       WHERE tenant_id IN (${tenantPlaceholders}) AND created_at >= ? AND created_at <= ?
       GROUP BY user_id
       ORDER BY tokens DESC`,
      [...tenantIds, cycleStart, cycleEnd]
    ) as any[];

    // Tenta mapear nomes dos operadores em megadesk_domain_client_users
    try {
      const [userNames] = await pool.execute(
        `SELECT user_id, name, email
         FROM megadesk_domain_client_users
         WHERE client_id IN (${tenantPlaceholders})`,
        [...tenantIds]
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
    } catch {}

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
       WHERE tenant_id IN (${tenantPlaceholders})
       ORDER BY created_at DESC
       LIMIT 10`,
      [...tenantIds]
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
