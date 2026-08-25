import { readFileSync } from "node:fs";import { resolve } from "node:path";import { describe,expect,it } from "vitest";
const source=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
describe("finance structure",()=>{
 const repo=source("server/modules/erp/finance/repository.ts"),service=source("server/modules/erp/finance/service.ts"),ui=source("client/src/pages/erp/FinancePage.tsx"),workspace=source("client/src/pages/erp/ERPWorkspace.tsx"),sql=source("drizzle/main-migrations/0009_cool_proemial_gods.sql");
 it("locks title and account and commits before publishing",()=>{expect(repo).toContain("LIMIT 1 FOR UPDATE");expect(repo).toContain("await c.commit()");expect(service).toContain("runPostCommitBestEffort")});
 it("keeps authoritative purchase and sale values server-side",()=>{const sourceFlow=repo.slice(repo.indexOf("async createFromSource"),repo.indexOf("async list"));expect(sourceFlow).toContain("o.total_cents");expect(sourceFlow).toContain("status!==status");expect(sourceFlow).toContain("source_public_id");expect(sourceFlow).not.toContain("input.amountCents")});
 it("keeps immutable ledger and idempotency protections",()=>{expect(sql).toContain("erp_financial_ledger");expect(sql).toContain("uq_erp_fin_settlements_tenant_key");expect(sql).toContain("uq_erp_fin_entries_tenant_source");expect(repo).not.toMatch(/UPDATE erp_financial_ledger|DELETE FROM erp_financial_ledger/)});
 it("exposes responsive accessible UI and hides finance from agents",()=>{expect(ui).toContain("lg:hidden");expect(ui).toContain("overflow-x-auto");expect(ui).toContain('aria-label="Paginação"');expect(workspace).toContain("canAccessFinance")});
 it("contains no fiscal implementation or media gate",()=>{expect(ui+repo).not.toMatch(/screenshot|video|nota fiscal|tax ledger/i)});
});
