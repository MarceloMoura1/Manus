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
import { SupplierRepository } from "../suppliers/repository";
import { SupplierService } from "../suppliers/service";
import { PurchaseRepository } from "./repository";
import { PurchaseService, type PurchaseEventPublisher } from "./service";

const physical = describe.runIf(isTestDatabaseEnabled()),
  adminA = {
    clientId: "purchase-a",
    userId: "admin-a",
    role: "admin" as const,
  },
  viewerA = { ...adminA, userId: "viewer-a", role: "viewer" as const },
  adminB = {
    clientId: "purchase-b",
    userId: "admin-b",
    role: "admin" as const,
  };
const silent: PurchaseEventPublisher = { publish: () => undefined };
let serial = 0;
async function clean() {
  const db = getPool();
  for (const sql of [
    "DELETE ri FROM erp_purchase_order_receipt_items ri INNER JOIN erp_purchase_order_receipts r ON r.id=ri.receipt_id WHERE r.client_id IN (?,?)",
    "DELETE FROM erp_purchase_order_receipts WHERE client_id IN (?,?)",
    "DELETE h FROM erp_purchase_order_history h INNER JOIN erp_purchase_orders o ON o.id=h.purchase_order_id WHERE o.client_id IN (?,?)",
    "DELETE i FROM erp_purchase_order_items i INNER JOIN erp_purchase_orders o ON o.id=i.purchase_order_id WHERE o.client_id IN (?,?)",
    "DELETE FROM erp_purchase_orders WHERE client_id IN (?,?)",
    "DELETE FROM erp_purchase_order_sequences WHERE client_id IN (?,?)",
    "DELETE FROM erp_stock_movements WHERE client_id IN (?,?)",
    "DELETE FROM erp_stock_balances WHERE client_id IN (?,?)",
    "DELETE FROM erp_products WHERE client_id IN (?,?)",
    "DELETE FROM erp_suppliers WHERE client_id IN (?,?)",
  ])
    await db.execute(sql, [adminA.clientId, adminB.clientId]);
}
async function fixture(identity = adminA) {
  serial++;
  const supplier = await new SupplierService(new SupplierRepository(), {
    publish: () => undefined,
  }).create(identity, {
    legalName: `Fornecedor compra ${serial}`,
    tradeName: null,
    personType: "legal",
    taxId: `98765432${String(serial).padStart(6, "0")}`,
    stateRegistration: null,
    email: null,
    phone: null,
    contactName: null,
    postalCode: null,
    street: null,
    addressNumber: null,
    addressComplement: null,
    district: null,
    city: null,
    state: null,
    notes: null,
  });
  const product = await new ErpService(new ErpRepository()).createProduct(
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
  return { supplier, product };
}
const draft = (supplierPublicId: string, productPublicId: string) => ({
  supplierPublicId,
  notes: "Pedido físico",
  expectedDate: null,
  items: [{ productPublicId, quantity: "1.005", unitCostCents: 101 }],
});
async function count(sql: string, args: unknown[] = []) {
  const [rows] = await getPool().execute<RowDataPacket[]>(sql, args);
  return Number(rows[0]?.total ?? 0);
}

physical("ERP purchases MySQL behavior matrix", () => {
  beforeAll(() =>
    applyCanonicalMigrations(getTestDatabaseUrl(), MAIN_MIGRATIONS_DIR)
  );
  beforeEach(clean);
  afterAll(clean);
  it("01 installs tables, constraints and purchase_in", async () => {
    const [rows] = await getPool().execute<RowDataPacket[]>(
      "SHOW COLUMNS FROM erp_stock_movements LIKE 'type'"
    );
    expect(String(rows[0].Type)).toContain("purchase_in");
    expect(
      await count(
        "SELECT COUNT(*) total FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE 'erp_purchase_%'"
      )
    ).toBe(6);
  });
  it("02 creates draft with server totals and snapshots", async () => {
    const f = await fixture(),
      order = await new PurchaseService(
        new PurchaseRepository(),
        silent
      ).create(adminA, draft(f.supplier.publicId, f.product.publicId));
    expect(order).toMatchObject({
      status: "draft",
      subtotalCents: 102,
      totalCents: 102,
      supplierName: f.supplier.legalName,
    });
    expect(order.items[0]).toMatchObject({
      sku: f.product.sku,
      lineTotalCents: 102,
    });
    expect(order).not.toHaveProperty("clientId");
  });
  it("03 edits only draft and approves", async () => {
    const f = await fixture(),
      s = new PurchaseService(new PurchaseRepository(), silent),
      order = await s.create(
        adminA,
        draft(f.supplier.publicId, f.product.publicId)
      );
    await s.update(adminA, order.publicId, {
      ...draft(f.supplier.publicId, f.product.publicId),
      items: [
        {
          productPublicId: f.product.publicId,
          quantity: "2",
          unitCostCents: 100,
        },
      ],
    });
    const approved = await s.approve(adminA, order.publicId);
    expect(approved?.status).toBe("approved");
    await expect(
      s.update(
        adminA,
        order.publicId,
        draft(f.supplier.publicId, f.product.publicId)
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("04 cancels draft and approved but not received", async () => {
    const f = await fixture(),
      s = new PurchaseService(new PurchaseRepository(), silent),
      a = await s.create(
        adminA,
        draft(f.supplier.publicId, f.product.publicId)
      );
    expect(
      (await s.cancel(adminA, a.publicId, "Cancelamento físico"))?.status
    ).toBe("cancelled");
  });
  it("05 receives atomically into receipt ledger and balance", async () => {
    const f = await fixture(),
      s = new PurchaseService(new PurchaseRepository(), silent),
      order = await s.create(
        adminA,
        draft(f.supplier.publicId, f.product.publicId)
      );
    await s.approve(adminA, order.publicId);
    const received = await s.receive(
      adminA,
      order.publicId,
      crypto.randomUUID()
    );
    expect(received.status).toBe("received");
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_stock_movements WHERE client_id=? AND type='purchase_in'",
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
    ).toBe("1.005");
  });
  it("06 replays receipt without duplicate rows or events", async () => {
    const events: string[] = [];
    const publisher: PurchaseEventPublisher = {
        publish: (_c, event) => events.push(event),
      },
      f = await fixture(),
      s = new PurchaseService(new PurchaseRepository(), publisher),
      order = await s.create(
        adminA,
        draft(f.supplier.publicId, f.product.publicId)
      );
    await s.approve(adminA, order.publicId);
    const key = crypto.randomUUID();
    await s.receive(adminA, order.publicId, key);
    const before = events.length,
      replay = await s.receive(adminA, order.publicId, key);
    expect(replay.replay).toBe(true);
    expect(events).toHaveLength(before);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_purchase_order_receipts WHERE client_id=?",
        [adminA.clientId]
      )
    ).toBe(1);
  });
  it("07 isolates tenants and permits equal idempotency keys", async () => {
    const a = await fixture(adminA),
      b = await fixture(adminB),
      s = new PurchaseService(new PurchaseRepository(), silent),
      oa = await s.create(
        adminA,
        draft(a.supplier.publicId, a.product.publicId)
      ),
      ob = await s.create(
        adminB,
        draft(b.supplier.publicId, b.product.publicId)
      );
    await expect(s.detail(adminB, oa.publicId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await s.approve(adminA, oa.publicId);
    await s.approve(adminB, ob.publicId);
    const key = crypto.randomUUID();
    await s.receive(adminA, oa.publicId, key);
    await s.receive(adminB, ob.publicId, key);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_purchase_order_receipts WHERE idempotency_key=?",
        [key]
      )
    ).toBe(2);
  });
  it("08 allows read-only listing but rejects writes", async () => {
    const f = await fixture(),
      s = new PurchaseService(new PurchaseRepository(), silent);
    await s.create(adminA, draft(f.supplier.publicId, f.product.publicId));
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
      s.create(viewerA, draft(f.supplier.publicId, f.product.publicId))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("09 filters and paginates with normalized limits", async () => {
    const f = await fixture(),
      s = new PurchaseService(new PurchaseRepository(), silent);
    const order = await s.create(
      adminA,
      draft(f.supplier.publicId, f.product.publicId)
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
  it("10 rejects isolated reversal of purchase receipt", async () => {
    const f = await fixture(),
      p = new PurchaseService(new PurchaseRepository(), silent),
      order = await p.create(
        adminA,
        draft(f.supplier.publicId, f.product.publicId)
      );
    await p.approve(adminA, order.publicId);
    await p.receive(adminA, order.publicId, crypto.randomUUID());
    const [rows] = await getPool().execute<RowDataPacket[]>(
      "SELECT public_id FROM erp_stock_movements WHERE client_id=? AND type='purchase_in'",
      [adminA.clientId]
    );
    await expect(
      new ErpService(new ErpRepository()).reverseMovement(
        adminA,
        String(rows[0].public_id),
        "Reversão proibida",
        crypto.randomUUID()
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("11 serializes tenant numbering and concurrent receipt", async () => {
    const f = await fixture(),
      service = new PurchaseService(new PurchaseRepository(), silent);
    const created = await Promise.all([
      service.create(adminA, draft(f.supplier.publicId, f.product.publicId)),
      service.create(adminA, draft(f.supplier.publicId, f.product.publicId)),
    ]);
    expect(new Set(created.map(order => order.orderNumber)).size).toBe(2);
    await service.approve(adminA, created[0].publicId);
    const outcomes = await Promise.allSettled([
      service.receive(adminA, created[0].publicId, crypto.randomUUID()),
      service.receive(adminA, created[0].publicId, crypto.randomUUID()),
    ]);
    expect(
      outcomes.filter(outcome => outcome.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_purchase_order_receipts WHERE client_id=? AND purchase_order_id=(SELECT id FROM erp_purchase_orders WHERE public_id=?)",
        [adminA.clientId, created[0].publicId]
      )
    ).toBe(1);
  });
  it("12 rejects inactive supplier or product without partial order", async () => {
    const f = await fixture(),
      purchases = new PurchaseService(new PurchaseRepository(), silent),
      suppliers = new SupplierService(new SupplierRepository(), {
        publish: () => undefined,
      }),
      products = new ErpService(new ErpRepository());
    await suppliers.setActive(adminA, f.supplier.publicId, false);
    await expect(
      purchases.create(adminA, draft(f.supplier.publicId, f.product.publicId))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await suppliers.setActive(adminA, f.supplier.publicId, true);
    await products.setProductActive(adminA, f.product.publicId, false);
    await expect(
      purchases.create(adminA, draft(f.supplier.publicId, f.product.publicId))
    ).rejects.toMatchObject({ code: "INACTIVE_PRODUCT" });
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_purchase_orders WHERE client_id=?",
        [adminA.clientId]
      )
    ).toBe(0);
  });
  it("13 publishes all operations after commit with minimal purchase payload", async () => {
    const emitted: Array<{
        clientId: string;
        event: string;
        payload: Record<string, string>;
      }> = [],
      publisher: PurchaseEventPublisher = {
        publish: (clientId, event, payload) =>
          emitted.push({ clientId, event, payload }),
      },
      f = await fixture(),
      service = new PurchaseService(new PurchaseRepository(), publisher);
    const order = await service.create(
      adminA,
      draft(f.supplier.publicId, f.product.publicId)
    );
    await service.update(adminA, order.publicId, {
      ...draft(f.supplier.publicId, f.product.publicId),
      notes: "Atualizado",
    });
    await service.approve(adminA, order.publicId);
    await service.receive(adminA, order.publicId, crypto.randomUUID());
    const cancelled = await service.create(
      adminA,
      draft(f.supplier.publicId, f.product.publicId)
    );
    await service.cancel(adminA, cancelled.publicId, "Cancelamento físico");
    expect(
      emitted
        .filter(item => item.event === "erp:purchase.changed")
        .map(item => item.payload.operation)
    ).toEqual([
      "created",
      "updated",
      "approved",
      "received",
      "created",
      "cancelled",
    ]);
    for (const item of emitted.filter(
      item => item.event === "erp:purchase.changed"
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
      publisher: PurchaseEventPublisher = {
        publish: (_client, event) => events.push(event),
      },
      f = await fixture(),
      products = new ErpService(new ErpRepository()),
      second = await products.createProduct(adminA, {
        name: "Produto rollback intermediário",
        sku: `ROLL-${++serial}`,
        barcode: null,
        description: null,
        category: "Compras",
        unit: "unit",
        costPriceCents: 0,
        salePriceCents: 0,
        minimumStock: "0",
      }),
      service = new PurchaseService(new PurchaseRepository(), publisher);
    const order = await service.create(adminA, {
      supplierPublicId: f.supplier.publicId,
      notes: null,
      expectedDate: null,
      items: [
        {
          productPublicId: f.product.publicId,
          quantity: "1.000",
          unitCostCents: 100,
        },
        {
          productPublicId: second.publicId,
          quantity: "2.000",
          unitCostCents: 200,
        },
      ],
    });
    await service.approve(adminA, order.publicId);
    const key = crypto.randomUUID();
    const [items] = await getPool().execute<RowDataPacket[]>(
      "SELECT i.public_id,i.product_id FROM erp_purchase_order_items i INNER JOIN erp_purchase_orders o ON o.id=i.purchase_order_id WHERE o.client_id=? AND o.public_id=? ORDER BY i.id",
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
      service.receive(adminA, order.publicId, key)
    ).rejects.toBeTruthy();
    expect(events).toHaveLength(beforeEvents);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_purchase_order_receipts WHERE client_id=? AND purchase_order_id=(SELECT id FROM erp_purchase_orders WHERE public_id=?)",
        [adminA.clientId, order.publicId]
      )
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_stock_movements WHERE client_id=? AND reference_type='purchase' AND reference_id=?",
        [adminA.clientId, order.publicId]
      )
    ).toBe(0);
    const [balances] = await getPool().execute<RowDataPacket[]>(
      "SELECT b.quantity FROM erp_stock_balances b INNER JOIN erp_products p ON p.id=b.product_id WHERE b.client_id=? AND p.public_id IN (?,?) ORDER BY p.public_id",
      [adminA.clientId, f.product.publicId, second.publicId]
    );
    expect(balances.map(row => String(row.quantity))).toEqual([
      "0.000",
      "0.000",
    ]);
    expect((await service.detail(adminA, order.publicId)).status).toBe(
      "approved"
    );
  });
});
