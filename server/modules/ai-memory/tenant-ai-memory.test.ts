import { beforeEach, describe, expect, it } from "vitest";
import {
  formatTenantMemoryForPrompt,
  getTenantAiMemory,
  normalizeKnowledgeTopic,
  resetTenantAiMemory,
  resetTenantAiMemoryTableEnsuredState,
  saveTenantPlaybook,
  upsertLearnedRoutine,
} from "./tenant-ai-memory";
import { buildSystemInstruction, getAllowedHermesTools } from "../../gemini-client";
import { deleteTestTenant } from "../../_core/tenant-lifecycle";

type MemoryRow = {
  client_id: string;
  company_playbook: string | null;
  learned_updates: string | null;
  source_filename: string | null;
  updated_by: string | null;
  updated_at: string;
};

function createFakePool() {
  const store = new Map<string, MemoryRow>();
  return {
    store,
    async execute(sql: string, params: unknown[] = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (normalized.startsWith("CREATE TABLE IF NOT EXISTS megadesk_tenant_ai_memory")) {
        return [[], []];
      }
      if (normalized.startsWith("SELECT client_id, company_playbook")) {
        const clientId = String(params[0]);
        const row = store.get(clientId);
        return [row ? [row] : [], []];
      }
      if (normalized.startsWith("INSERT INTO megadesk_tenant_ai_memory")) {
        const [clientId, playbook, learned, filename, updatedBy] = params as [
          string,
          string | null,
          string | null,
          string | null,
          string | null,
        ];
        const prev = store.get(clientId);
        if (normalized.includes("company_playbook = NULL")) {
          store.set(clientId, {
            client_id: clientId,
            company_playbook: null,
            learned_updates: "[]",
            source_filename: null,
            updated_by: updatedBy,
            updated_at: new Date().toISOString(),
          });
        } else if (normalized.includes("company_playbook = VALUES(company_playbook)")) {
          store.set(clientId, {
            client_id: clientId,
            company_playbook: playbook,
            learned_updates: prev?.learned_updates ?? learned ?? "[]",
            source_filename: filename,
            updated_by: updatedBy,
            updated_at: new Date().toISOString(),
          });
        } else {
          store.set(clientId, {
            client_id: clientId,
            company_playbook: prev?.company_playbook ?? playbook ?? null,
            learned_updates: learned ?? "[]",
            source_filename: prev?.source_filename ?? filename ?? null,
            updated_by: updatedBy,
            updated_at: new Date().toISOString(),
          });
        }
        return [{ affectedRows: 1 }, []];
      }
      return [[], []];
    },
  };
}

describe("tenant-ai-memory & neutral AI prompts", () => {
  beforeEach(() => {
    resetTenantAiMemoryTableEnsuredState();
  });

  it("gera prompt inicial 100% neutro e sem menção a FaYeRs/peças/autopeças/oficina", () => {
    const emptyMemoryBlock = formatTenantMemoryForPrompt("Clínica Horizonte", null);
    const tools = getAllowedHermesTools(["ai-assistant", "conversations"]);
    const prompt = buildSystemInstruction(tools, undefined, {
      companyName: "Clínica Horizonte",
      memoryBlock: emptyMemoryBlock,
    });

    const combined = `${emptyMemoryBlock}\n${prompt}`.toLowerCase();
    expect(combined).toContain("clínica horizonte");
    expect(combined).toContain("100% neutra");
    expect(combined).not.toContain("fayers");
    expect(combined).not.toContain("autopeça");
    expect(combined).not.toContain("oficina");
    expect(combined).not.toContain("senhor marcelo");
    expect(tools.some((t) => t.name === "upsert_company_knowledge")).toBe(true);
  });

  it("isola memória por tenant e consolida upload de bloco de notas .txt", async () => {
    const pool = createFakePool();

    await saveTenantPlaybook(
      {
        clientId: "tenant-a",
        companyPlaybook: "Empresa A: Restaurante italiano. Atendimento das 18h às 23h.",
        sourceFilename: "rotina-restaurante.txt",
        updatedBy: "ana@restaurante.com",
      },
      pool
    );

    const memA = await getTenantAiMemory("tenant-a", pool);
    const memB = await getTenantAiMemory("tenant-b", pool);

    expect(memA.companyPlaybook).toContain("Restaurante italiano");
    expect(memA.sourceFilename).toBe("rotina-restaurante.txt");
    expect(memB.companyPlaybook).toBe("");
    expect(memB.learnedUpdates).toEqual([]);

    const promptB = formatTenantMemoryForPrompt("Empresa B", memB);
    expect(promptB).not.toContain("Restaurante italiano");
  });

  it("atualiza e substitui rotinas via aprendizado contínuo sem manter contradições", async () => {
    const pool = createFakePool();
    expect(normalizeKnowledgeTopic("Horário de Entrega!")).toBe("horario_de_entrega");

    const first = await upsertLearnedRoutine(
      {
        clientId: "tenant-a",
        topic: "Horário de Entrega",
        summary: "Entregas acontecem das 09h às 17h.",
        author: "joao@empresa.com",
      },
      pool
    );
    expect(first.replaced).toBe(false);
    expect(first.memory.learnedUpdates).toHaveLength(1);

    const second = await upsertLearnedRoutine(
      {
        clientId: "tenant-a",
        topic: "horario de entrega",
        summary: "Mudamos o horário de entrega para 08h às 20h.",
        author: "maria@empresa.com",
      },
      pool
    );
    expect(second.replaced).toBe(true);
    expect(second.memory.learnedUpdates).toHaveLength(1);
    expect(second.entry.previousRule).toBe("Entregas acontecem das 09h às 17h.");
    expect(second.entry.summary).toBe("Mudamos o horário de entrega para 08h às 20h.");

    const prompt = formatTenantMemoryForPrompt("Empresa A", second.memory);
    expect(prompt).toContain("08h às 20h");
    expect(prompt).not.toContain("09h às 17h");

    const cleared = await resetTenantAiMemory("tenant-a", "admin@empresa.com", pool);
    expect(cleared.companyPlaybook).toBe("");
    expect(cleared.learnedUpdates).toEqual([]);
  });

  it("deleteTestTenant bloqueia exclusão de cliente ativo real e permite cliente de teste", async () => {
    const executed: string[] = [];
    const makeTx = (row: { client_id: string; company: string; status: string; status_type: string }) => ({
      async execute(sql: string) {
        executed.push(sql);
        if (sql.includes("FROM megadesk_domain_clients")) return [[row], []];
        if (sql.includes("FROM information_schema.COLUMNS")) {
          return [[{ TABLE_NAME: "megadesk_domain_client_users", COLUMN_NAME: "client_id" }], []];
        }
        return [[], []];
      },
      async commit() {},
      async rollback() {},
      release() {},
    });

    await expect(
      deleteTestTenant(
        { clientId: "cliente-real", operatorId: "admin:1" },
        { begin: async () => makeTx({ client_id: "cliente-real", company: "Olyver", status: "active", status_type: "active" }) }
      )
    ).rejects.toThrow(/apenas para clientes de teste/i);

    const res = await deleteTestTenant(
      { clientId: "cliente-test", operatorId: "admin:1" },
      { begin: async () => makeTx({ client_id: "cliente-test", company: "Synthetic Gate 02B test", status: "active", status_type: "test" }) }
    );
    expect(res.deleted).toBe(true);
    expect(executed.some((s) => s.includes("DELETE FROM megadesk_domain_clients"))).toBe(true);
  });
});

