import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const repository = readFileSync(
    "server/modules/erp/purchases/repository.ts",
    "utf8"
  ),
  service = readFileSync("server/modules/erp/purchases/service.ts", "utf8"),
  migration = readFileSync(
    "drizzle/main-migrations/0007_wide_tiger_shark.sql",
    "utf8"
  );
describe("purchase architecture", () => {
  it("scopes and locks receipt", () => {
    expect(repository).toContain("client_id=?");
    expect(repository).toContain("FOR UPDATE");
    expect(repository).toContain("beginTransaction");
    expect(repository).toContain("rollback");
    expect(repository).toContain("purchase_in");
  });
  it("idempotency and post-commit", () => {
    expect(migration).toContain("uq_erp_purchase_receipts_tenant_idempotency");
    expect(service).toContain("runPostCommitBestEffort");
    expect(service).toMatch(/if\s*\(!r\.replay\)/);
    expect(service).toContain('operation: "purchase_received"');
  });
  it("migration is additive", () => {
    expect(migration).not.toMatch(
      /(?:^|--> statement-breakpoint\s*)(?:DROP|TRUNCATE|DELETE|RENAME)\b/i
    );
    expect(migration).not.toContain("Evolution");
  });
});
