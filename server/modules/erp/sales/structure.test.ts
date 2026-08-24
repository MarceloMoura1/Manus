import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const repository = readFileSync("server/modules/erp/sales/repository.ts", "utf8");
const service = readFileSync("server/modules/erp/sales/service.ts", "utf8");
const migration = readFileSync("drizzle/main-migrations/0008_greedy_roland_deschain.sql", "utf8");

describe("sales architecture", () => {
  it("scopes, locks and atomically fulfills sales", () => {
    expect(repository).toContain("client_id=?");
    expect(repository).toContain("ORDER BY i.product_id FOR UPDATE");
    expect(repository).toContain("beginTransaction");
    expect(repository).toContain("rollback");
    expect(repository).toContain("sale_out");
    expect(repository).toContain("INSUFFICIENT_STOCK");
    expect(repository).toContain("p.client_id=item_order.client_id");
    expect(repository).toContain("item_order.client_id=?");
    expect(repository).toContain(
      "items.length !== Number(expectedItems[0]?.total ?? 0)"
    );
  });
  it("keeps idempotency and events post-commit", () => {
    expect(migration).toContain("uq_erp_sale_fulfillments_tenant_idempotency");
    expect(service).toContain("runPostCommitBestEffort");
    expect(service).toMatch(/if\s*\(!r\.replay\)/);
    expect(service).toContain('operation: "sale_fulfilled"');
  });
  it("keeps migration additive", () => {
    expect(migration).not.toMatch(/(?:^|--> statement-breakpoint\s*)(?:DROP|TRUNCATE|DELETE|RENAME)\b/i);
    expect(migration).not.toContain("Evolution");
  });
});
