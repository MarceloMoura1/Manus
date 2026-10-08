import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const repository = readFileSync("server/modules/erp/sales/repository.ts", "utf8");
const service = readFileSync("server/modules/erp/sales/service.ts", "utf8");
const finance = readFileSync("server/modules/erp/finance/repository.ts", "utf8");
const inventory = readFileSync("server/modules/erp/inventory/repository.ts", "utf8");
const workspace = readFileSync("client/src/pages/erp/ERPWorkspace.tsx", "utf8");
const schema = readFileSync("drizzle/schema.ts", "utf8");
const migration = readFileSync(
  "drizzle/main-migrations/0037_spicy_wilson_fisk.sql",
  "utf8"
);

describe("sales B+C architecture", () => {
  it("keeps every product and inventory join tenant-scoped", () => {
    expect(repository).toContain("p.client_id=item_order.client_id");
    expect(repository).toContain("ii.client_id=item_order.client_id");
    expect(repository).toContain("item_order.client_id=?");
    expect(repository).toContain("requestedPublicId: requested.inventoryItemPublicId");
    expect(inventory).toContain("i.client_id=? AND i.product_id=? AND i.public_id=?");
    expect(repository).toContain(
      "items.length !== Number(expectedItems[0]?.total ?? 0)"
    );
  });

  it("confirms the sale and creates installments inside one database transaction", () => {
    const confirm = repository.slice(
      repository.indexOf("async confirm("),
      repository.indexOf("private async applyStockExit")
    );
    expect(confirm).toContain("beginTransaction");
    expect(confirm).toContain("erp_financial_entries");
    expect(confirm).toContain("source_installment");
    expect(confirm).toContain("installmentTotal !== BigInt(order.totalCents)");
    expect(confirm).toContain("confirmation_idempotency_key");
    expect(confirm).toContain("confirmation_payload_hash");
    expect(confirm).toContain("erp_financial_settlements");
    expect(confirm).toContain("erp_financial_ledger");
    expect(confirm).toContain("sale_confirmation");
    expect(confirm).toContain("receivedCents: input.receivedCents");
    expect(confirm).toContain("await connection.commit()");
    expect(confirm).toContain("await connection.rollback()");
    expect(confirm.indexOf("erp_financial_entries")).toBeLessThan(
      confirm.lastIndexOf("await connection.commit()")
    );
  });

  it("checks exact item balances before draft save and confirmation", () => {
    expect(repository).toContain("private async assertOrderStockAvailable");
    expect(repository).toContain("inventory_item_active");
    expect(repository.match(/Estoque insuficiente para/g)?.length).toBeGreaterThanOrEqual(2);
    expect(repository).toContain("await this.assertOrderStockAvailable(connection, clientId, order.id)");
  });

  it("loads the primary product thumbnail in the paginated query without N+1 calls", () => {
    const list = repository.slice(
      repository.indexOf("async list("),
      repository.indexOf("async detail(")
    );
    expect(list).toContain("first_product_id");
    expect(list).toContain("LEFT JOIN erp_product_media first_media");
    expect(list).toContain("first_media.media_id first_product_media_id");
    expect(repository).toContain("firstProductImage:");
  });

  it("makes confirmation replay-safe and rejects divergent retries", () => {
    expect(repository).toContain("order.confirmationIdempotencyKey === input.idempotencyKey");
    expect(repository).toContain("order.confirmationPayloadHash === payloadHash");
    expect(repository).toContain("IDEMPOTENCY_CONFLICT");
    expect(migration).toContain("uq_erp_sale_orders_tenant_confirmation_key");
    expect(schema).toContain("uq_erp_fin_entries_tenant_source_installment");
  });

  it("validates every balance before the first stock write and rolls back failures", () => {
    const stock = repository.slice(
      repository.indexOf("private async applyStockExit"),
      repository.indexOf("async transition(")
    );
    expect(stock).toContain("FOR UPDATE");
    expect(stock).toContain("INSUFFICIENT_STOCK");
    expect(stock).toContain("this.inventory().lockBalance");
    expect(stock).toContain("this.inventory().setBalance");
    expect(stock).toContain("erp_stock_balances");
    expect(stock.indexOf("INSUFFICIENT_STOCK")).toBeLessThan(
      stock.indexOf("INSERT INTO erp_sale_order_fulfillments")
    );
    const transition = repository.slice(
      repository.indexOf("async transition("),
      repository.indexOf("async cancel(")
    );
    expect(transition).toContain("isStockExitTransition");
    expect(transition).toContain("await connection.rollback()");
    expect(repository).toContain("transitionEventByIdempotencyKey");
    expect(repository).toContain("uq_erp_sale_events_tenant_key");
    expect(repository).toContain("isTransitionIdempotencyDuplicate");
    expect(repository).not.toMatch(
      /WHERE e\.client_id=\? AND e\.idempotency_key=\? LIMIT 1 FOR UPDATE/
    );
    expect(repository).not.toMatch(
      /WHERE client_id=\? AND sale_order_id=\? LIMIT 1 FOR UPDATE/
    );
  });

  it("does not move stock on completion or on audited logistical corrections", () => {
    expect(repository).toContain("stockChanged = isStockExitTransition(fromStage, input.toStage)");
    expect(repository).toContain("status=CASE WHEN ?='completed' THEN 'fulfilled' ELSE 'confirmed' END");
    expect(repository).toContain("Correções logísticas exigem um motivo");
    expect(repository).toContain("Não é possível voltar de Enviado para Separação");
    expect(repository.match(/sale_out/g)).toHaveLength(1);
  });

  it("locks finance entries and settlements before cancelling unpaid titles", () => {
    const cancel = repository.slice(
      repository.indexOf("async cancel("),
      repository.indexOf("async correctAddress(")
    );
    expect(cancel).toContain("erp_financial_entries");
    expect(cancel).toContain("ORDER BY id FOR UPDATE");
    expect(cancel).toContain("erp_financial_settlements");
    expect(cancel).toContain("financial_entry_id=? FOR UPDATE");
    expect(cancel).toContain("o estorno financeiro ainda não está disponível");
    expect(cancel).toContain("status='cancelled'");
    expect(cancel).toContain("await connection.rollback()");
  });

  it("uses existing finance titles and prevents the legacy fromSale path from duplicating them", () => {
    expect(finance).toContain(
      "WHERE client_id=? AND source_type=? AND source_public_id=? LIMIT 1"
    );
    expect(finance).toContain("return {entry:await this.detail(clientId,String(existing[0].public_id)),replay:true}");
    expect(repository).toContain("source_installment");
    expect(finance).toContain("payment_registered");
    expect(finance).toContain("erp_sale_order_events");
  });

  it("keeps financial totals aggregated before joining sales", () => {
    expect(repository).toContain(
      "SELECT client_id,financial_entry_id,SUM(amount_cents) paid_cents"
    );
    expect(repository).toContain("GROUP BY e.client_id,e.source_public_id");
    expect(repository).toContain("grossMarginAvailable: false");
    expect(repository).toContain("Custos históricos não foram registrados");
  });

  it("records before and after address snapshots and blocks edits after separation", () => {
    const correction = repository.slice(repository.indexOf("async correctAddress("));
    expect(correction).toContain('["confirmed", "separation"]');
    expect(correction).toContain("before,");
    expect(correction).toContain("after,");
    expect(correction).toContain('eventType: "address_corrected"');
  });

  it("refreshes Sales after realtime events, reconnect and browser return", () => {
    expect(workspace).toContain("utils.erp.invalidate()");
    expect(workspace).toContain('socket.on("connect", refresh)');
    expect(workspace).toContain('socket.on("erp:finance.entry.changed", refresh)');
    expect(workspace).toContain('window.addEventListener("focus", refresh)');
    expect(workspace).toContain('window.addEventListener("pageshow", refresh)');
    expect(workspace).toContain('document.addEventListener("visibilitychange", refreshWhenVisible)');
    expect(service).toContain('"erp:finance.entry.changed"');
  });

  it("keeps migration 0037 additive and isolated from external services", () => {
    expect(migration).toContain("CREATE TABLE `erp_sale_order_events`");
    expect(migration).toContain("ADD `current_stage`");
    expect(migration).toContain("ADD `shipping_address_snapshot`");
    expect(migration).not.toMatch(/(?:^|statement-breakpoint\s*)(?:DROP|TRUNCATE|DELETE|RENAME)\b/i);
    expect(migration).not.toContain("Evolution");
    expect(migration).not.toContain("Cloudflare");
  });
});
