import { nanoid } from "nanoid";
import type mysql from "mysql2/promise";
import { getPool } from "../../db";

export interface LearnedRoutineUpdate {
  id: string;
  topic: string;
  summary: string;
  previousRule?: string;
  author: string;
  updatedAt: string;
}

export interface TenantAiMemory {
  clientId: string;
  companyPlaybook: string;
  learnedUpdates: LearnedRoutineUpdate[];
  sourceFilename: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

let aiMemoryTableEnsured = false;

export function resetTenantAiMemoryTableEnsuredState(): void {
  aiMemoryTableEnsured = false;
}

export async function ensureTenantAiMemoryTable(
  pool: Pick<mysql.Pool, "execute"> = getPool()
): Promise<void> {
  if (aiMemoryTableEnsured) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS megadesk_tenant_ai_memory (
      client_id VARCHAR(80) PRIMARY KEY,
      company_playbook LONGTEXT NULL,
      learned_updates JSON NULL,
      source_filename VARCHAR(255) NULL,
      updated_by VARCHAR(255) NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  aiMemoryTableEnsured = true;
}

export function normalizeKnowledgeTopic(topic: string): string {
  return topic
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "regra_geral";
}

function parseLearnedUpdates(raw: unknown): LearnedRoutineUpdate[] {
  if (!raw) return [];
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is LearnedRoutineUpdate =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as any).topic === "string" &&
      typeof (item as any).summary === "string"
  );
}

export async function getTenantCompanyName(
  clientId: string,
  pool?: Pick<mysql.Pool, "execute"> | null
): Promise<string> {
  try {
    const db = pool ?? getPool();
    const [rows] = (await db.execute(
      "SELECT company FROM megadesk_domain_clients WHERE client_id = ? LIMIT 1",
      [clientId]
    )) as any[];
    const name = rows?.[0]?.company;
    if (typeof name === "string" && name.trim()) {
      return name.trim();
    }
  } catch {
    // fallback neutro
  }
  return "Empresa";
}

export async function getTenantAiMemory(
  clientId: string,
  pool?: Pick<mysql.Pool, "execute"> | null
): Promise<TenantAiMemory> {
  const db = pool ?? getPool();
  await ensureTenantAiMemoryTable(db);
  const [rows] = (await db.execute(
    "SELECT client_id, company_playbook, learned_updates, source_filename, updated_by, updated_at FROM megadesk_tenant_ai_memory WHERE client_id = ? LIMIT 1",
    [clientId]
  )) as any[];
  const row = rows?.[0];
  if (!row) {
    return {
      clientId,
      companyPlaybook: "",
      learnedUpdates: [],
      sourceFilename: null,
      updatedBy: null,
      updatedAt: null,
    };
  }
  return {
    clientId,
    companyPlaybook: typeof row.company_playbook === "string" ? row.company_playbook : "",
    learnedUpdates: parseLearnedUpdates(row.learned_updates),
    sourceFilename: typeof row.source_filename === "string" ? row.source_filename : null,
    updatedBy: typeof row.updated_by === "string" ? row.updated_by : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function saveTenantPlaybook(
  input: {
    clientId: string;
    companyPlaybook: string;
    sourceFilename?: string | null;
    updatedBy?: string | null;
  },
  pool?: Pick<mysql.Pool, "execute"> | null
): Promise<TenantAiMemory> {
  const db = pool ?? getPool();
  await ensureTenantAiMemoryTable(db);
  const existing = await getTenantAiMemory(input.clientId, db);
  const playbook = input.companyPlaybook.trim();
  const filename = input.sourceFilename !== undefined ? input.sourceFilename : existing.sourceFilename;
  const updatedBy = input.updatedBy ?? existing.updatedBy ?? "Sistema";

  await db.execute(
    `INSERT INTO megadesk_tenant_ai_memory (client_id, company_playbook, learned_updates, source_filename, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       company_playbook = VALUES(company_playbook),
       source_filename = VALUES(source_filename),
       updated_by = VALUES(updated_by)`,
    [
      input.clientId,
      playbook,
      JSON.stringify(existing.learnedUpdates),
      filename ?? null,
      updatedBy,
    ]
  );

  return getTenantAiMemory(input.clientId, db);
}

export async function upsertLearnedRoutine(
  input: {
    clientId: string;
    topic: string;
    summary: string;
    previousRule?: string;
    author: string;
  },
  pool?: Pick<mysql.Pool, "execute"> | null
): Promise<{ memory: TenantAiMemory; entry: LearnedRoutineUpdate; replaced: boolean }> {
  const db = pool ?? getPool();
  await ensureTenantAiMemoryTable(db);
  const existing = await getTenantAiMemory(input.clientId, db);
  const normalizedTopic = normalizeKnowledgeTopic(input.topic);
  const nowIso = new Date().toISOString();

  const currentList = [...existing.learnedUpdates];
  const matchIdx = currentList.findIndex(
    (item) => normalizeKnowledgeTopic(item.topic) === normalizedTopic
  );

  let replaced = false;
  let previousRule = input.previousRule?.trim() || undefined;
  if (matchIdx >= 0) {
    replaced = true;
    if (!previousRule) {
      previousRule = currentList[matchIdx].summary;
    }
    currentList.splice(matchIdx, 1);
  }

  const entry: LearnedRoutineUpdate = {
    id: `rule-${nanoid(10)}`,
    topic: normalizedTopic,
    summary: input.summary.trim(),
    ...(previousRule ? { previousRule } : {}),
    author: input.author.trim() || "Operador",
    updatedAt: nowIso,
  };
  currentList.push(entry);

  await db.execute(
    `INSERT INTO megadesk_tenant_ai_memory (client_id, company_playbook, learned_updates, source_filename, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       learned_updates = VALUES(learned_updates),
       updated_by = VALUES(updated_by)`,
    [
      input.clientId,
      existing.companyPlaybook || null,
      JSON.stringify(currentList),
      existing.sourceFilename ?? null,
      entry.author,
    ]
  );

  const memory = await getTenantAiMemory(input.clientId, db);
  return { memory, entry, replaced };
}

export async function resetTenantAiMemory(
  clientId: string,
  updatedBy?: string | null,
  pool?: Pick<mysql.Pool, "execute"> | null
): Promise<TenantAiMemory> {
  const db = pool ?? getPool();
  await ensureTenantAiMemoryTable(db);
  await db.execute(
    `INSERT INTO megadesk_tenant_ai_memory (client_id, company_playbook, learned_updates, source_filename, updated_by)
     VALUES (?, NULL, '[]', NULL, ?)
     ON DUPLICATE KEY UPDATE
       company_playbook = NULL,
       learned_updates = '[]',
       source_filename = NULL,
       updated_by = VALUES(updated_by)`,
    [clientId, updatedBy ?? "Operador"]
  );
  return getTenantAiMemory(clientId, db);
}

export function isTenantAiMemoryEmpty(memory: TenantAiMemory | null | undefined): boolean {
  if (!memory) return true;
  return !memory.companyPlaybook.trim() && memory.learnedUpdates.length === 0;
}

export function formatTenantMemoryForPrompt(
  companyName: string,
  memory: TenantAiMemory | null | undefined
): string {
  const safeName = companyName.trim() || "Empresa";
  if (isTenantAiMemoryEmpty(memory)) {
    return `BASE DE CONHECIMENTO DA EMPRESA ("${safeName}"):
- Nenhuma rotina, catálogo ou manual institucional foi carregado ainda para "${safeName}".
- Atue de forma 100% NEUTRA e agnóstica de segmento: NUNCA invente produtos, serviços, preços, horários, nomes de funcionários ou processos que não tenham sido informados pelo usuário ou retornados por ferramentas do sistema.`;
  }

  const parts: string[] = [`BASE DE CONHECIMENTO OFICIAL DA EMPRESA ("${safeName}"):`];
  if (memory!.companyPlaybook.trim()) {
    parts.push(`--- ROTEIRO / PLAYBOOK DA EMPRESA ---\n${memory!.companyPlaybook.trim()}`);
  }
  if (memory!.learnedUpdates.length > 0) {
    const rulesText = memory!.learnedUpdates
      .map((u) => `• [${u.topic}] ${u.summary} (atualizado em ${u.updatedAt.slice(0, 10)} por ${u.author})`)
      .join("\n");
    parts.push(
      `--- REGRAS E ROTINAS ATUALIZADAS (PREVALECEM SOBRE O ROTEIRO INICIAL EM CASO DE CONFLITO) ---\n${rulesText}`
    );
  }
  return parts.join("\n\n");
}

export function isTenantAdminRole(role?: string | null): boolean {
  return String(role ?? "").trim().toLowerCase() === "admin";
}
