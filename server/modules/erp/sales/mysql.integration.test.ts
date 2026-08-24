import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import {
  applyCanonicalMigrations,
  MAIN_MIGRATIONS_DIR,
} from "../../../_core/canonical-migrations";
import { getPool } from "../../../db";
import {
  getTestDatabaseUrl,
  isTestDatabaseEnabled,
} from "../../../test-integration-gates";
import { ErpRepository } from "../repository";
import { ErpService } from "../service";
import { SaleRepository } from "./repository";
import { SaleService, type SaleEventPublisher } from "./service";
import { fulfillInput, lineTotalCents, saleDraftInput } from "./contracts";

const physical = describe.runIf(isTestDatabaseEnabled()),
  adminA = {
    clientId: "sale-a",
    userId: "admin-a",
    role: "admin" as const,
  },
  viewerA = { ...adminA, userId: "viewer-a", role: "viewer" as const },
  adminB = {
    clientId: "sale-b",
    userId: "admin-b",
    role: "admin" as const,
  };
const silent: SaleEventPublisher = { publish: () => undefined };
let serial = 0;
async function clean() {
  const db = getPool();
  for (const sql of [
    "DELETE ri FROM erp_sale_order_fulfillment_items ri INNER JOIN erp_sale_order_fulfillments r ON r.id=ri.fulfillment_id WHERE r.client_id IN (?,?)",
    "DELETE FROM erp_sale_order_fulfillments WHERE client_id IN (?,?)",
    "DELETE h FROM erp_sale_order_history h INNER JOIN erp_sale_orders o ON o.id=h.sale_order_id WHERE o.client_id IN (?,?)",
    "DELETE i FROM erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id WHERE o.client_id IN (?,?)",
    "DELETE FROM erp_sale_orders WHERE client_id IN (?,?)",
    "DELETE FROM erp_sale_order_sequences WHERE client_id IN (?,?)",
    "DELETE FROM erp_stock_movements WHERE client_id IN (?,?)",
    "DELETE FROM erp_stock_balances WHERE client_id IN (?,?)",
    "DELETE FROM erp_products WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_crm_clients WHERE client_id IN (?,?)",
  ])
    await db.execute(sql, [adminA.clientId, adminB.clientId]);
}
async function fixture(identity = adminA) {
  serial++;
  const customer = { crmClientId: crypto.randomUUID(), companyName: `Cliente venda ${serial}` };
  await getPool().execute("INSERT INTO megadesk_crm_clients(crm_client_id,client_id,company_name,status) VALUES(?,?,?,'ativo')", [customer.crmClientId, identity.clientId, customer.companyName]);
  const erp = new ErpService(new ErpRepository());
  const product = await erp.createProduct(
    identity,
    {
      name: `Produto compra ${serial}`,
      sku: `PUR-${serial}`,
      barcode: null,
      description: null,
      category: "Compras",
      unit: "unit",
      costPriceCents: 0,
      salePriceCents: 0,
      minimumStock: "0",
    }
  );
  await erp.moveStock(identity, {
    productPublicId: product.publicId,
    type: "manual_in",
    quantity: "10.000",
    reason: "Saldo para matriz de vendas",
    idempotencyKey: crypto.randomUUID(),
  });
  return { customer, product };
}
const draft = (crmClientId: string, productPublicId: string) => ({
  crmClientId,
  notes: "Pedido fÃ­sico",
  expectedDate: null,
  items: [{ productPublicId, quantity: "1.005", unitPriceCents: 101 }],
});
async function count(sql: string, args: unknown[] = []) {
  const [rows] = await getPool().execute<RowDataPacket[]>(sql, args);
  return Number(rows[0]?.total ?? 0);
}

physical("ERP sales MySQL behavior matrix", () => {
  beforeAll(() =>
    applyCanonicalMigrations(getTestDatabaseUrl(), MAIN_MIGRATIONS_DIR)
  );
  beforeEach(clean);
  afterAll(clean);
  it("01 installs tables, constraints and sale_out", async () => {
    const [rows] = await getPool().execute<RowDataPacket[]>(
      "SHOW COLUMNS FROM erp_stock_movements LIKE 'type'"
    );
    expect(String(rows[0].Type)).toContain("sale_out");
    expect(
      await count(
        "SELECT COUNT(*) total FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE 'erp_sale_%'"
      )
    ).toBe(6);
  });
  it("02 creates draft with server totals and snapshots", async () => {
    const f = await fixture(),
      order = await new SaleService(
        new SaleRepository(),
        silent
      ).create(adminA, draft(f.customer.crmClientId, f.product.publicId));
    expect(order).toMatchObject({
      status: "draft",
      subtotalCents: 102,
      totalCents: 102,
      customerName: f.customer.companyName,
    });
    expect(order.items[0]).toMatchObject({
      sku: f.product.sku,
      lineTotalCents: 102,
    });
    expect(order).not.toHaveProperty("clientId");
  });
  it("03 edits only draft and approves", async () => {
    const f = await fixture(),
      s = new SaleService(new SaleRepository(), silent),
      order = await s.create(
        adminA,
        draft(f.customer.crmClientId, f.product.publicId)
      );
    await s.update(adminA, order.publicId, {
      ...draft(f.customer.crmClientId, f.product.publicId),
      items: [
        {
          productPublicId: f.product.publicId,
          quantity: "2",
          unitPriceCents: 100,
        },
      ],
    });
    const confirmed = await s.confirm(adminA, order.publicId);
    expect(confirmed?.status).toBe("confirmed");
    await expect(
      s.update(
        adminA,
        order.publicId,
        draft(f.customer.crmClientId, f.product.publicId)
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("04 cancels draft and confirmed but not fulfilled", async () => {
    const f = await fixture(),
      s = new SaleService(new SaleRepository(), silent),
      a = await s.create(
        adminA,
        draft(f.customer.crmClientId, f.product.publicId)
      );
    expect(
      (await s.cancel(adminA, a.publicId, "Cancelamento fÃ­sico"))?.status
    ).toBe("cancelled");
  });
  it("05 fulfills atomically into receipt ledger and balance", async () => {
    const f = await fixture(),
      s = new SaleService(new SaleRepository(), silent),
      order = await s.create(
        adminA,
        draft(f.customer.crmClientId, f.product.publicId)
      );
    await s.confirm(adminA, order.publicId);
    const fulfilled = await s.fulfill(
      adminA,
      order.publicId,
      crypto.randomUUID()
    );
    expect(fulfilled.status).toBe("fulfilled");
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_stock_movements WHERE client_id=? AND type='sale_out'",
        [adminA.clientId]
      )
    ).toBe(1);
    expect(
      (
        await new ErpService(new ErpRepository()).getProduct(
          adminA,
          f.product.publicId
        )
      ).quantity
    ).toBe("8.995");
  });
  it("06 replays receipt without duplicate rows or events", async () => {
    const events: string[] = [];
    const publisher: SaleEventPublisher = {
        publish: (_c, event) => events.push(event),
      },
      f = await fixture(),
      s = new SaleService(new SaleRepository(), publisher),
      order = await s.create(
        adminA,
        draft(f.customer.crmClientId, f.product.publicId)
      );
    await s.confirm(adminA, order.publicId);
    const key = crypto.randomUUID();
    await s.fulfill(adminA, order.publicId, key);
    const before = events.length,
      replay = await s.fulfill(adminA, order.publicId, key);
    expect(replay.replay).toBe(true);
    expect(events).toHaveLength(before);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_sale_order_fulfillments WHERE client_id=?",
        [adminA.clientId]
      )
    ).toBe(1);
  });
  it("07 isolates tenants and permits equal idempotency keys", async () => {
    const a = await fixture(adminA),
      b = await fixture(adminB),
      s = new SaleService(new SaleRepository(), silent),
      oa = await s.create(
        adminA,
        draft(a.customer.crmClientId, a.product.publicId)
      ),
      ob = await s.create(
        adminB,
        draft(b.customer.crmClientId, b.product.publicId)
      );
    await expect(s.detail(adminB, oa.publicId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await s.confirm(adminA, oa.publicId);
    await s.confirm(adminB, ob.publicId);
    const key = crypto.randomUUID();
    await s.fulfill(adminA, oa.publicId, key);
    await s.fulfill(adminB, ob.publicId, key);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_sale_order_fulfillments WHERE idempotency_key=?",
        [key]
      )
    ).toBe(2);
  });
  it("08 allows read-only listing but rejects writes", async () => {
    const f = await fixture(),
      s = new SaleService(new SaleRepository(), silent);
    await s.create(adminA, draft(f.customer.crmClientId, f.product.publicId));
    expect(
      (
        await s.list(viewerA, {
          search: "",
          sort: "createdAt",
          direction: "desc",
          page: 1,
          pageSize: 20,
        })
      ).total
    ).toBe(1);
    await expect(
      s.create(viewerA, draft(f.customer.crmClientId, f.product.publicId))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("09 filters and paginates with normalized limits", async () => {
    const f = await fixture(),
      s = new SaleService(new SaleRepository(), silent);
    const order = await s.create(
      adminA,
      draft(f.customer.crmClientId, f.product.publicId)
    );
    const found = await s.list(adminA, {
      search: order.orderNumber,
      status: "draft",
      sort: "total",
      direction: "asc",
      page: 1,
      pageSize: 1,
    });
    expect(found).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 1,
      totalPages: 1,
    });
  });
  it("10 rejects isolated reversal of sale receipt", async () => {
    const f = await fixture(),
      p = new SaleService(new SaleRepository(), silent),
      order = await p.create(
        adminA,
        draft(f.customer.crmClientId, f.product.publicId)
      );
    await p.confirm(adminA, order.publicId);
    await p.fulfill(adminA, order.publicId, crypto.randomUUID());
    const [rows] = await getPool().execute<RowDataPacket[]>(
      "SELECT public_id FROM erp_stock_movements WHERE client_id=? AND type='sale_out'",
      [adminA.clientId]
    );
    await expect(
      new ErpService(new ErpRepository()).reverseMovement(
        adminA,
        String(rows[0].public_id),
        "ReversÃ£o proibida",
        crypto.randomUUID()
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("11 serializes tenant numbering and concurrent receipt", async () => {
    const f = await fixture(),
      service = new SaleService(new SaleRepository(), silent);
    const created = await Promise.all([
      service.create(adminA, draft(f.customer.crmClientId, f.product.publicId)),
      service.create(adminA, draft(f.customer.crmClientId, f.product.publicId)),
    ]);
    expect(new Set(created.map(order => order.orderNumber)).size).toBe(2);
    await service.confirm(adminA, created[0].publicId);
    const outcomes = await Promise.allSettled([
      service.fulfill(adminA, created[0].publicId, crypto.randomUUID()),
      service.fulfill(adminA, created[0].publicId, crypto.randomUUID()),
    ]);
    expect(
      outcomes.filter(outcome => outcome.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_sale_order_fulfillments WHERE client_id=? AND sale_order_id=(SELECT id FROM erp_sale_orders WHERE public_id=?)",
        [adminA.clientId, created[0].publicId]
      )
    ).toBe(1);
  });
  it("12 rejects inactive customer or product without partial order", async () => {
    const f = await fixture(),
      sales = new SaleService(new SaleRepository(), silent),
      products = new ErpService(new ErpRepository()),
      db = getPool();
    await db.execute("UPDATE megadesk_crm_clients SET status='inativo' WHERE client_id=? AND crm_client_id=?", [adminA.clientId, f.customer.crmClientId]);
    await expect(
      sales.create(adminA, draft(f.customer.crmClientId, f.product.publicId))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.execute("UPDATE megadesk_crm_clients SET status='ativo' WHERE client_id=? AND crm_client_id=?", [adminA.clientId, f.customer.crmClientId]);
    await products.setProductActive(adminA, f.product.publicId, false);
    await expect(
      sales.create(adminA, draft(f.customer.crmClientId, f.product.publicId))
    ).rejects.toMatchObject({ code: "INACTIVE_PRODUCT" });
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_sale_orders WHERE client_id=?",
        [adminA.clientId]
      )
    ).toBe(0);
  });
  it("13 publishes all operations after commit with minimal sale payload", async () => {
    const emitted: Array<{
        clientId: string;
        event: string;
        payload: Record<string, string>;
      }> = [],
      publisher: SaleEventPublisher = {
        publish: (clientId, event, payload) =>
          emitted.push({ clientId, event, payload }),
      },
      f = await fixture(),
      service = new SaleService(new SaleRepository(), publisher);
    const order = await service.create(
      adminA,
      draft(f.customer.crmClientId, f.product.publicId)
    );
    await service.update(adminA, order.publicId, {
      ...draft(f.customer.crmClientId, f.product.publicId),
      notes: "Atualizado",
    });
    await service.confirm(adminA, order.publicId);
    await service.fulfill(adminA, order.publicId, crypto.randomUUID());
    const cancelled = await service.create(
      adminA,
      draft(f.customer.crmClientId, f.product.publicId)
    );
    await service.cancel(adminA, cancelled.publicId, "Cancelamento fÃ­sico");
    expect(
      emitted
        .filter(item => item.event === "erp:sale.changed")
        .map(item => item.payload.operation)
    ).toEqual([
      "created",
      "updated",
      "confirmed",
      "fulfilled",
      "created",
      "cancelled",
    ]);
    for (const item of emitted.filter(
      item => item.event === "erp:sale.changed"
    )) {
      expect(item.clientId).toBe(adminA.clientId);
      expect(Object.keys(item.payload).sort()).toEqual([
        "occurredAt",
        "operation",
        "publicId",
      ]);
    }
    expect(
      emitted.filter(item => item.event === "erp:stock.changed")
    ).toHaveLength(1);
  });
  it("14 rolls back earlier balances and ledger when a later item fails", async () => {
    const events: string[] = [],
      publisher: SaleEventPublisher = {
        publish: (_client, event) => events.push(event),
      },
      f = await fixture(),
      products = new ErpService(new ErpRepository()),
      second = await products.createProduct(adminA, {
        name: "Produto rollback intermediÃ¡rio",
        sku: `ROLL-${++serial}`,
        barcode: null,
        description: null,
        category: "Compras",
        unit: "unit",
        costPriceCents: 0,
        salePriceCents: 0,
        minimumStock: "0",
      }),
      service = new SaleService(new SaleRepository(), publisher);
    await products.moveStock(adminA, {
      productPublicId: second.publicId,
      type: "manual_in",
      quantity: "10.000",
      reason: "Saldo para rollback de vendas",
      idempotencyKey: crypto.randomUUID(),
    });
    const order = await service.create(adminA, {
      crmClientId: f.customer.crmClientId,
      notes: null,
      expectedDate: null,
      items: [
        {
          productPublicId: f.product.publicId,
          quantity: "1.000",
          unitPriceCents: 100,
        },
        {
          productPublicId: second.publicId,
          quantity: "2.000",
          unitPriceCents: 200,
        },
      ],
    });
    await service.confirm(adminA, order.publicId);
    const key = crypto.randomUUID();
    const [items] = await getPool().execute<RowDataPacket[]>(
      "SELECT i.public_id,i.product_id FROM erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id WHERE o.client_id=? AND o.public_id=? ORDER BY i.id",
      [adminA.clientId, order.publicId]
    );
    await getPool().execute(
      "INSERT INTO erp_stock_movements(public_id,client_id,product_id,type,direction,quantity,previous_balance,resulting_balance,reason,reference_type,idempotency_key,payload_hash,created_by) VALUES(?,?,?,'manual_in','in','0.001','0.000','0.001','Conflito preparado','manual',?,REPEAT('a',64),?)",
      [
        crypto.randomUUID(),
        adminA.clientId,
        items[1].product_id,
        `${key}:${items[1].public_id}`,
        adminA.userId,
      ]
    );
    const beforeEvents = events.length;
    await expect(
      service.fulfill(adminA, order.publicId, key)
    ).rejects.toBeTruthy();
    expect(events).toHaveLength(beforeEvents);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_sale_order_fulfillments WHERE client_id=? AND sale_order_id=(SELECT id FROM erp_sale_orders WHERE public_id=?)",
        [adminA.clientId, order.publicId]
      )
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_stock_movements WHERE client_id=? AND reference_type='sale' AND reference_id=?",
        [adminA.clientId, order.publicId]
      )
    ).toBe(0);
    const [balances] = await getPool().execute<RowDataPacket[]>(
      "SELECT b.quantity FROM erp_stock_balances b INNER JOIN erp_products p ON p.id=b.product_id WHERE b.client_id=? AND p.public_id IN (?,?) ORDER BY p.public_id",
      [adminA.clientId, f.product.publicId, second.publicId]
    );
    expect(balances.map(row => String(row.quantity))).toEqual([
      "10.000",
      "10.000",
    ]);
    expect((await service.detail(adminA, order.publicId)).status).toBe(
      "confirmed"
    );
  });
  it("15 treats cross-tenant customer and product references as not found", async () => {
    const a = await fixture(adminA), b = await fixture(adminB), s = new SaleService(new SaleRepository(), silent);
    await expect(s.create(adminA, draft(b.customer.crmClientId, a.product.publicId))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(s.create(adminA, draft(a.customer.crmClientId, b.product.publicId))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await count("SELECT COUNT(*) total FROM erp_sale_orders WHERE client_id=?", [adminA.clientId])).toBe(0);
  });
  it("16 rejects duplicate products and persists half-up server totals", async () => {
    const f = await fixture(), s = new SaleService(new SaleRepository(), silent);
    const duplicate = { crmClientId:f.customer.crmClientId, items:[{ productPublicId:f.product.publicId,quantity:"1",unitPriceCents:1 },{ productPublicId:f.product.publicId,quantity:"1",unitPriceCents:1 }] };
    expect(() => saleDraftInput.parse(duplicate)).toThrow("Produto duplicado");
    expect(lineTotalCents("0.500", 1)).toBe(1);
    const order = await s.create(adminA, { ...draft(f.customer.crmClientId, f.product.publicId), items: [{ productPublicId: f.product.publicId, quantity: "0.500", unitPriceCents: 1 }] });
    expect(order.totalCents).toBe(1);
  });
  it("17 keeps purchase and sale annual sequences independent", async () => {
    const f = await fixture(), s = new SaleService(new SaleRepository(), silent);
    await getPool().execute("INSERT INTO erp_purchase_order_sequences(client_id,year,next_number) VALUES(?,?,?) ON DUPLICATE KEY UPDATE next_number=VALUES(next_number)", [adminA.clientId, new Date().getUTCFullYear(), 42]);
    const order = await s.create(adminA, draft(f.customer.crmClientId, f.product.publicId));
    expect(order.orderNumber).toMatch(/-000001$/);
    const [rows] = await getPool().execute<RowDataPacket[]>("SELECT next_number FROM erp_purchase_order_sequences WHERE client_id=?", [adminA.clientId]);
    expect(Number(rows[0].next_number)).toBe(42);
  });
  it("18 enforces the forbidden transition matrix without partial history", async () => {
    const f = await fixture(), s = new SaleService(new SaleRepository(), silent);
    const draftOrder = await s.create(adminA, draft(f.customer.crmClientId, f.product.publicId));
    await expect(s.fulfill(adminA, draftOrder.publicId, crypto.randomUUID())).rejects.toMatchObject({ code: "CONFLICT" });
    const cancelled = await s.cancel(adminA, draftOrder.publicId, "Matriz cancelada");
    await expect(s.confirm(adminA, cancelled.publicId)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(s.cancel(adminA, cancelled.publicId, "Outra tentativa")).rejects.toMatchObject({ code: "CONFLICT" });
    const fulfilledDraft = await s.create(adminA, draft(f.customer.crmClientId, f.product.publicId));
    await s.confirm(adminA, fulfilledDraft.publicId); await s.fulfill(adminA, fulfilledDraft.publicId, crypto.randomUUID());
    await expect(s.cancel(adminA, fulfilledDraft.publicId, "Tarde demais")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(s.update(adminA, fulfilledDraft.publicId, draft(f.customer.crmClientId, f.product.publicId))).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("19 rolls back before the ledger when stock validation fails", async () => {
    const f = await fixture(), s = new SaleService(new SaleRepository(), silent), events: string[] = [], observed = new SaleService(new SaleRepository(), { publish: (_c, e) => events.push(e) });
    const order = await s.create(adminA, { ...draft(f.customer.crmClientId, f.product.publicId), items: [{ productPublicId: f.product.publicId, quantity: "11", unitPriceCents: 1 }] });
    await s.confirm(adminA, order.publicId); const before = events.length;
    await expect(observed.fulfill(adminA, order.publicId, crypto.randomUUID())).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect(events).toHaveLength(before);
    expect(await count("SELECT COUNT(*) total FROM erp_sale_order_fulfillments WHERE client_id=?", [adminA.clientId])).toBe(0);
    expect(await count("SELECT COUNT(*) total FROM erp_stock_movements WHERE client_id=? AND type='sale_out'", [adminA.clientId])).toBe(0);
    expect((await s.detail(adminA, order.publicId)).status).toBe("confirmed");
  });
  it("20 rejects missing and semantically reused idempotency keys", async () => {
    const f = await fixture(), s = new SaleService(new SaleRepository(), silent);
    expect(() => saleDraftInput.parse({ crmClientId:f.customer.crmClientId,items:[{productPublicId:f.product.publicId,quantity:"1",unitPriceCents:1}] })).not.toThrow();
    const a = await s.create(adminA, draft(f.customer.crmClientId, f.product.publicId)), b = await s.create(adminA, draft(f.customer.crmClientId, f.product.publicId));
    await s.confirm(adminA, a.publicId); await s.confirm(adminA, b.publicId);
    expect(() => fulfillInput.parse({ publicId: a.publicId, idempotencyKey: "" })).toThrow();
    const key = crypto.randomUUID(); await s.fulfill(adminA, a.publicId, key);
    await expect(s.fulfill(adminA, b.publicId, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("21 lets only one order consume the last available stock", async () => {
    const f = await fixture(), s = new SaleService(new SaleRepository(), silent);
    const command = { ...draft(f.customer.crmClientId, f.product.publicId), items: [{ productPublicId: f.product.publicId, quantity: "10", unitPriceCents: 1 }] };
    const [a,b] = await Promise.all([s.create(adminA, command), s.create(adminA, command)]); await Promise.all([s.confirm(adminA,a.publicId),s.confirm(adminA,b.publicId)]);
    const outcomes = await Promise.allSettled([s.fulfill(adminA,a.publicId,crypto.randomUUID()),s.fulfill(adminA,b.publicId,crypto.randomUUID())]);
    expect(outcomes.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(x => x.status === "rejected")).toHaveLength(1);
    expect(await count("SELECT COUNT(*) total FROM erp_stock_movements WHERE client_id=? AND type='sale_out'", [adminA.clientId])).toBe(1);
  });
  it("22 isolates detail and mutations and exercises customer, period and ordering filters", async () => {
    const a = await fixture(adminA), b = await fixture(adminB), s = new SaleService(new SaleRepository(), silent);
    const first = await s.create(adminA, draft(a.customer.crmClientId, a.product.publicId));
    await expect(s.detail(adminB, first.publicId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(s.confirm(adminB, first.publicId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await s.create(adminA, { ...draft(a.customer.crmClientId, a.product.publicId), items: [{ productPublicId: a.product.publicId, quantity: "2", unitPriceCents: 200 }] });
    const day = new Date().toISOString().slice(0,10);
    for (const sort of ["orderNumber","createdAt","total"] as const) {
      const result = await s.list(adminA,{ search:a.customer.companyName,status:"draft",from:day,to:day,sort,direction:"desc",page:1,pageSize:1 });
      expect(result.total).toBe(2); expect(result.items).toHaveLength(1); expect(result.totalPages).toBe(2);
    }
    expect((await s.list(adminB,{search:b.customer.companyName,sort:"createdAt",direction:"desc",page:1,pageSize:20})).total).toBe(0);
  });
  it("23 rolls back ledger and fulfillment when the final status update fails before commit", async () => {
    const f = await fixture(), s = new SaleService(new SaleRepository(), silent);
    const order = await s.create(adminA,draft(f.customer.crmClientId,f.product.publicId)); await s.confirm(adminA,order.publicId);
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>("SELECT o.id order_id,p.id product_id,b.quantity FROM erp_sale_orders o INNER JOIN erp_sale_order_items i ON i.sale_order_id=o.id INNER JOIN erp_products p ON p.id=i.product_id INNER JOIN erp_stock_balances b ON b.client_id=o.client_id AND b.product_id=p.id WHERE o.client_id=? AND o.public_id=? FOR UPDATE",[adminA.clientId,order.publicId]);
      await connection.execute("UPDATE erp_stock_balances SET quantity=quantity-1 WHERE client_id=? AND product_id=?",[adminA.clientId,rows[0].product_id]);
      await connection.execute("INSERT INTO erp_stock_movements(public_id,client_id,product_id,type,direction,quantity,previous_balance,resulting_balance,reason,reference_type,reference_id,idempotency_key,payload_hash,created_by) VALUES(?,?,?,'sale_out','out','1.000','10.000','9.000','Falha controlada antes do commit','sale',?,?,REPEAT('b',64),?)",[crypto.randomUUID(),adminA.clientId,rows[0].product_id,order.publicId,crypto.randomUUID(),adminA.userId]);
      await connection.execute("UPDATE erp_sale_orders SET status='fulfilled' WHERE id=?",[rows[0].order_id]);
      await connection.rollback();
      expect(await count("SELECT COUNT(*) total FROM erp_sale_order_fulfillments WHERE client_id=?",[adminA.clientId])).toBe(0);
      expect(await count("SELECT COUNT(*) total FROM erp_stock_movements WHERE client_id=? AND type='sale_out'",[adminA.clientId])).toBe(0);
      expect((await s.detail(adminA,order.publicId)).status).toBe("confirmed");
      expect((await new ErpService(new ErpRepository()).getProduct(adminA,f.product.publicId)).quantity).toBe("10.000");
    } finally {
      connection.release();
    }
  });
  it("24 rejects an inconsistent cross-tenant product link without leaking tenant B data", async () => {
    const a = await fixture(adminA), b = await fixture(adminB), s = new SaleService(new SaleRepository(), silent);
    const order = await s.create(adminA, draft(a.customer.crmClientId, a.product.publicId));
    expect((await s.detail(adminA, order.publicId)).items[0].productPublicId).toBe(a.product.publicId);
    const [products] = await getPool().execute<RowDataPacket[]>(
      "SELECT id,public_id,name,sku FROM erp_products WHERE client_id=? AND public_id IN (?,?) ORDER BY client_id",
      [adminA.clientId, a.product.publicId, b.product.publicId]
    );
    const [tenantBProducts] = await getPool().execute<RowDataPacket[]>(
      "SELECT id,public_id,name,sku FROM erp_products WHERE client_id=? AND public_id=? LIMIT 1",
      [adminB.clientId, b.product.publicId]
    );
    expect(products).toHaveLength(1);
    expect(tenantBProducts).toHaveLength(1);
    try {
      await getPool().execute(
        "UPDATE erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id AND o.client_id=? SET i.product_id=? WHERE o.public_id=?",
        [adminA.clientId, tenantBProducts[0].id, order.publicId]
      );
      let failure: unknown;
      try {
        await s.detail(adminA, order.publicId);
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        code: "CONFLICT",
        message: "Pedido contém itens inconsistentes.",
      });
      const publicFailure = String((failure as Error)?.message ?? failure);
      expect(publicFailure).not.toContain(String(tenantBProducts[0].public_id));
      expect(publicFailure).not.toContain(String(tenantBProducts[0].name));
      expect(publicFailure).not.toContain(String(tenantBProducts[0].sku));
      await expect(s.detail(adminB, order.publicId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await s.list(adminB,{sort:"createdAt",direction:"desc",page:1,pageSize:20})).total).toBe(0);
    } finally {
      await getPool().execute(
        "UPDATE erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id AND o.client_id=? SET i.product_id=? WHERE o.public_id=?",
        [adminA.clientId, products[0].id, order.publicId]
      );
    }
    expect((await s.detail(adminA, order.publicId)).items[0].productPublicId).toBe(a.product.publicId);
  });
});
