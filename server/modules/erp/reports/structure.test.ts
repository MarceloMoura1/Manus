import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const source = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
describe("reports structure", () => {
  const repo = source("server/modules/erp/reports/repository.ts"),
    router = source("server/modules/erp/reports/router.ts"),
    ui = source("client/src/pages/erp/ReportsPage.tsx"),
    workspace = source("client/src/pages/erp/ERPWorkspace.tsx");
  it("derives tenant from context and scopes every operational query", () => {
    expect(router).toMatch(/clientId:\s*ctx\.tenantId/);
    expect(repo).not.toMatch(/client_id=\$\{/);
    expect(repo.match(/client_id=\?/g)?.length).toBeGreaterThan(10);
  });
  it("keeps reports bounded without BI or unsafe dynamic SQL", () => {
    expect(repo).toContain("LIMIT ? OFFSET ?");
    expect(repo).not.toMatch(
      /SELECT \*|eval\(|query builder|materialized|warehouse/i
    );
  });
  it("uses existing ERP events with coalesced invalidation and no report event", () => {
    expect(workspace).toContain("setTimeout(() => void utils.erp.reports.invalidate(), 250)");
    expect(workspace).not.toContain("setTimeout(() => void utils.erp.invalidate(), 250)");
    expect(workspace).not.toContain("erp:report.changed");
  });
  it("keeps Reports functional and Integrations disabled", () => {
    expect(workspace).toContain('label:"Relatórios"');
    expect(workspace).toContain('const planned = ["Integrações"]');
    expect(ui).toContain('aria-label="Seções de relatórios"');
  });
  it("contains no advanced BI, fiscal issuance, media or fragile waits", () => {
    expect(ui + repo).not.toMatch(
      /waitForTimeout|force:\s*true|screenshot|video|SEFAZ|DANFE|DRE|lucro líquido|forecast/i
    );
  });
});
