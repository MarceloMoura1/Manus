import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(path, "utf8");
const lifecycle = source("server/crm-client-lifecycle.ts");
const router = source("server/routers-crm.ts");
const conversations = source("server/routers-conversations.ts");
const clients = source("client/src/pages/ClientesPage.tsx");
const migration = source("drizzle/main-migrations/0015_mysterious_stephen_strange.sql");

describe("CRM client lifecycle contract", () => {
  it("keeps the commercial status separate from the additive lifecycle", () => {
    expect(migration).toContain("ADD `lifecycle_state` enum('active','inactive','archived') DEFAULT 'active' NOT NULL");
    expect(migration).toContain("ADD `pre_archive_state` enum('active','inactive')");
    expect(migration).toContain("ADD `lifecycle_version` int DEFAULT 1 NOT NULL");
    expect(migration).toContain("idx_mcc_tenant_lifecycle");
    expect(migration).not.toMatch(/DROP|DELETE|UPDATE|wa_/i);
  });

  it("uses tenant-scoped locking, optimistic versions and sanitized audit metadata", () => {
    expect(lifecycle).toContain("client_id = ? AND crm_client_id = ? FOR UPDATE");
    expect(lifecycle).toContain("lifecycle_version = ?");
    expect(lifecycle).toContain("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    expect(lifecycle).toContain("operator_user_id");
    expect(lifecycle).not.toContain("userEmail");
    expect(router).toContain("ctx.tenantId");
    expect(router).not.toContain("input.tenantId");
  });

  it.each(["megadesk_conversation_contacts", "megadesk_domain_conversations", "megadesk_domain_chamados", "megadesk_crm_timeline", "erp_sale_orders", "erp_financial_entries", "wa_conversations"])("blocks permanent deletion for %s dependencies", table => {
    expect(lifecycle).toContain(`FROM ${table}`);
  });

  it("restricts transitions to managers/admins and permanent deletion to admins", () => {
    expect(router).toContain('const CRM_ROLES = new Set(["admin", "manager"])');
    expect(router).toContain('ctx.operationalUserRole !== "admin"');
    expect(router).toContain("requireCrmAdmin(ctx)");
  });

  it("excludes non-active clients from new links and exposes lifecycle filters and safe confirmation", () => {
    expect(conversations.match(/lifecycle_state = 'active'/g)?.length).toBeGreaterThanOrEqual(3);
    for (const label of ["Ativos", "Inativos", "Arquivados", "Todos", "Zona de risco", "Inativar", "Reativar", "Arquivar", "Restaurar", "EXCLUIR"]) {
      expect(clients).toContain(label);
    }
    expect(clients).not.toContain('window.confirm("Excluir');
  });
});
