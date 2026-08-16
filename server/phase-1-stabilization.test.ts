import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getEvolutionConfig } from "./evolution/config";
import { quarantineTenant, reactivateTenant, validateOperationalAccess, deleteTenant, type LifecycleTransaction } from "./_core/tenant-lifecycle";
import { deleteTenantDatabase } from "./_core/tenant-db-manager";
import { deleteClientFromDb } from "./db";
import { handleEvolutionWebhook } from "./evolution/webhook";

const root = resolve(import.meta.dirname, "..");
const originalEvolutionUrl = process.env.EVOLUTION_API_URL;
const originalEvolutionKey = process.env.EVOLUTION_API_KEY;
const originalEvolutionWebhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET;

afterEach(() => {
  if (originalEvolutionUrl === undefined) delete process.env.EVOLUTION_API_URL;
  else process.env.EVOLUTION_API_URL = originalEvolutionUrl;
  if (originalEvolutionKey === undefined) delete process.env.EVOLUTION_API_KEY;
  else process.env.EVOLUTION_API_KEY = originalEvolutionKey;
  if (originalEvolutionWebhookSecret === undefined) delete process.env.EVOLUTION_WEBHOOK_SECRET;
  else process.env.EVOLUTION_WEBHOOK_SECRET = originalEvolutionWebhookSecret;
});

describe("Fase 1 - configuração Evolution", () => {
  it("compose exige credenciais sem defaults sensíveis", () => {
    const compose = readFileSync(resolve(root, "docker-compose.evolution.yml"), "utf8");
    for (const name of ["EVOLUTION_API_KEY", "EVOLUTION_MYSQL_ROOT_PASSWORD", "EVOLUTION_MYSQL_DATABASE", "EVOLUTION_MYSQL_USER", "EVOLUTION_MYSQL_PASSWORD"]) {
      expect(compose).toContain(`\${${name}:?`);
    }
    expect(compose).not.toMatch(/(?:PASSWORD|API_KEY):\s*["']?[A-Za-z0-9_-]{8,}["']?\s*$/m);
    expect(compose).not.toMatch(/mysql:\/\/[^$\s]+:[^$\s]+@/);
  });

  it("falha claramente quando URL ou chave estão ausentes", () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    delete process.env.EVOLUTION_WEBHOOK_SECRET;
    expect(() => getEvolutionConfig()).toThrow("EVOLUTION_API_URL");
    process.env.EVOLUTION_API_URL = "http://evolution.invalid";
    expect(() => getEvolutionConfig()).toThrow("EVOLUTION_API_KEY");
  });

  it("aceita configuração fictícia válida e rejeita URL com userinfo", () => {
    process.env.EVOLUTION_API_URL = "https://evolution.invalid:8443/path?ignored=yes#fragment";
    process.env.EVOLUTION_API_KEY = "validation-only";
    expect(getEvolutionConfig()).toEqual({ apiUrl: "https://evolution.invalid:8443/path", apiKey: "validation-only" });
    process.env.EVOLUTION_API_URL = "https://user:password@evolution.invalid";
    expect(() => getEvolutionConfig()).toThrow(/não pode conter credenciais/);
  });

  it("não inclui credenciais na mensagem de erro", () => {
    process.env.EVOLUTION_API_KEY = "sensitive-test-value";
    delete process.env.EVOLUTION_API_URL;
    try { getEvolutionConfig(); } catch (error) { expect(String(error)).not.toContain("sensitive-test-value"); }
  });

  it("webhook falha fechado sem configuração e rejeita chave inválida", async () => {
    const response = () => {
      const res: any = { statusCode: 0, payload: undefined };
      res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
      res.json = vi.fn((payload: unknown) => { res.payload = payload; return res; });
      return res;
    };
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    const unavailable = response();
    await handleEvolutionWebhook({ headers: {}, body: {} } as any, unavailable);
    expect(unavailable.statusCode).toBe(503);

    process.env.EVOLUTION_API_URL = "https://evolution.invalid";
    process.env.EVOLUTION_API_KEY = "validation-only";
    process.env.EVOLUTION_WEBHOOK_SECRET = "validation-only-webhook-secret-32-characters";
    const unauthorized = response();
    await handleEvolutionWebhook({ headers: { "x-megadesk-webhook-secret": "wrong" }, body: {} } as any, unauthorized);
    expect(unauthorized.statusCode).toBe(401);
  });
});

describe("Fase 1 - quarentena de tenant", () => {
  function transaction(options: { failOnUpdate?: boolean } = {}) {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const tx: LifecycleTransaction = {
      execute: vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        if (sql.startsWith("SELECT")) return [[{ client_id: "tenant-a", status: "active", tenant_database_name: "tenant_a_db" }], []];
        if (options.failOnUpdate && sql.startsWith("UPDATE megadesk_domain_clients")) throw new Error("persistence failed");
        return [{ affectedRows: 1 }, []];
      }),
      commit: vi.fn(async () => undefined), rollback: vi.fn(async () => undefined), release: vi.fn(),
    };
    return { tx, calls, dependencies: { begin: vi.fn(async () => tx) } };
  }

  it("commita quarentena somente para o tenant alvo e preserva banco físico", async () => {
    const fake = transaction();
    const result = await quarantineTenant({ clientId: "tenant-a", operatorId: "admin:1", reason: "security" }, fake.dependencies);
    expect(result.databaseName).toBe("tenant_a_db");
    expect(fake.tx.commit).toHaveBeenCalledOnce();
    expect(fake.tx.rollback).not.toHaveBeenCalled();
    expect(fake.calls.filter(c => c.sql.startsWith("UPDATE"))).toHaveLength(2);
    expect(fake.calls.every(c => !c.params || c.params.includes("tenant-a") || c.sql.startsWith("INSERT"))).toBe(true);
    expect(fake.calls.map(c => c.sql).join(" ")).not.toMatch(/DROP DATABASE|DELETE FROM/);
  });

  it("faz rollback e propaga falha sem commit", async () => {
    const fake = transaction({ failOnUpdate: true });
    await expect(quarantineTenant({ clientId: "tenant-a", operatorId: "admin:1", reason: "security" }, fake.dependencies)).rejects.toThrow("persistence failed");
    expect(fake.tx.rollback).toHaveBeenCalledOnce();
    expect(fake.tx.commit).not.toHaveBeenCalled();
  });

  it("auditoria contém apenas campos controlados", async () => {
    const fake = transaction();
    await quarantineTenant({ clientId: "tenant-a", operatorId: "admin:1", reason: "customer_request" }, fake.dependencies);
    const audit = fake.calls.find(c => c.sql.startsWith("INSERT INTO megadesk_domain_audit_logs"));
    expect(audit?.params?.[1]).toBe("tenant_quarantined;operator=admin:1;reason=customer_request;from=active;to=paused");
  });

  it("reativação não atualiza usuários", async () => {
    const fake = transaction();
    await reactivateTenant({ clientId: "tenant-a", operatorId: "admin:1" }, fake.dependencies);
    expect(fake.calls.some(c => c.sql.includes("UPDATE megadesk_domain_client_users"))).toBe(false);
  });

  it("revalida tenant e usuário em consulta autoritativa", async () => {
    const allowed = { execute: vi.fn(async () => [[{ user_id: "user-a", role: "agent" }], []]) };
    await expect(validateOperationalAccess({ clientId: "tenant-a", userEmail: "USER@EXAMPLE.INVALID" }, allowed)).resolves.toEqual({ userId: "user-a", role: "agent" });
    expect(allowed.execute).toHaveBeenCalledWith(expect.stringContaining("c.status = 'active'"), ["tenant-a", "user@example.invalid"]);
    const denied = { execute: vi.fn(async () => [[], []]) };
    await expect(validateOperationalAccess({ clientId: "tenant-a", userEmail: "blocked@example.invalid" }, denied)).rejects.toThrow("OPERATIONAL_ACCESS_DENIED");
  });

  it("rejeita exclusão física antes de acessar banco", async () => {
    await expect(deleteTenantDatabase("tenant_a_db")).rejects.toThrow("bloqueada");
    await expect(deleteClientFromDb("tenant-a")).rejects.toThrow("bloqueada");
    await expect(deleteTenant()).rejects.toThrow("indisponível");
  });

  it("fluxo administrativo não remove tenant nem chama helper destrutivo", () => {
    const router = readFileSync(resolve(root, "server/routers.ts"), "utf8");
    const procedure = router.slice(router.indexOf("deleteClient: adminProcedure"), router.indexOf("// Backup Management"));
    expect(procedure).toContain("await quarantineTenant(");
    expect(procedure).not.toContain("deleteClientFromDb");
    expect(procedure).not.toContain("deleteTenantDatabase");
  });

  it("sincronização comum não contém exclusão implícita", () => {
    const db = readFileSync(resolve(root, "server/db.ts"), "utf8");
    const sync = db.slice(db.indexOf("export async function saveMegaDeskStructuredState"), db.indexOf("export async function recordMegaDeskMetric"));
    expect(sync).not.toContain("DELETE FROM");
  });
});
