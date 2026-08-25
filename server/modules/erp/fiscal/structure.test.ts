import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const source = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
describe("fiscal structure", () => {
  const repo = source("server/modules/erp/fiscal/repository.ts"),
    service = source("server/modules/erp/fiscal/service.ts"),
    ui = source("client/src/pages/erp/FiscalPage.tsx"),
    workspace = source("client/src/pages/erp/ERPWorkspace.tsx"),
    sql = source("drizzle/main-migrations/0010_huge_tombstone.sql");
  it("keeps every domain query tenant-scoped and origins authoritative", () => {
    expect(repo).toContain("WHERE o.client_id=? AND o.public_id=?");
    expect(repo).toContain("o.total_cents");
    expect(repo).toContain("i.line_total_cents");
    expect(repo).toContain("items.length !== Number(expectedItems[0]?.total)");
    expect(repo).toContain("x.createdAt instanceof Date");
    expect(repo).not.toContain("input.totalCents");
  });
  it("locks sequence, source and document with rollback", () => {
    expect(repo).toContain("FOR UPDATE");
    expect(repo).toContain("beginTransaction");
    expect(repo).toContain("rollback");
    expect(sql).toContain("uq_erp_fiscal_operations_tenant_key");
  });
  it("publishes after repository completion and filters roles", () => {
    expect(service).toContain("runPostCommitBestEffort");
    expect(service).toMatch(/"admin",\s*"manager",\s*"viewer"/);
    expect(service).not.toContain('"agent"');
  });
  it("keeps UI responsive, accessible and honest", () => {
    expect(ui).toContain("Emissão fiscal eletrônica ainda não configurada.");
    expect(ui).toContain("lg:hidden");
    expect(ui).toContain("overflow-x-auto");
    expect(ui).toContain('aria-label="Seções fiscais"');
    expect(workspace).toContain("canAccessFiscal");
  });
  it("contains no real issuance, tax engine, media gate or destructive migration", () => {
    expect(ui + repo + service).not.toMatch(
      /SEFAZ|certificado digital|DANFE|chave de acesso|XML fiscal|ICMS-ST|DIFAL|SPED|SINTEGRA|screenshot|video/i
    );
    expect(sql).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE|RENAME)\b/im);
    expect(sql).not.toMatch(/evolution/i);
  });
});
