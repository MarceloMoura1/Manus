import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { productFiscalProfileInput } from "./contracts";
import { FiscalRepository } from "./repository";
import { FiscalService, type FiscalEventPublisher } from "./service";
const physical = describe.runIf(isTestDatabaseEnabled()),
  tenantA = "fiscal-a",
  tenantB = "fiscal-b",
  admin = { clientId: tenantA, userId: "fiscal-admin", role: "admin" as const },
  manager = { ...admin, userId: "fiscal-manager", role: "manager" as const },
  viewer = { ...admin, userId: "fiscal-viewer", role: "viewer" as const },
  agent = { ...admin, userId: "fiscal-agent", role: "agent" as const };
let serial = 0;
async function clean() {
  const db = getPool();
  for (const sql of [
    "DELETE FROM erp_fiscal_operations WHERE client_id IN (?,?)",
    "DELETE FROM erp_fiscal_document_history WHERE client_id IN (?,?)",
    "DELETE FROM erp_fiscal_document_items WHERE client_id IN (?,?)",
    "DELETE FROM erp_fiscal_documents WHERE client_id IN (?,?)",
    "DELETE FROM erp_fiscal_document_sequences WHERE client_id IN (?,?)",
    "DELETE FROM erp_fiscal_settings_history WHERE client_id IN (?,?)",
    "DELETE FROM erp_fiscal_settings WHERE client_id IN (?,?)",
    "DELETE FROM erp_product_fiscal_profiles WHERE client_id IN (?,?)",
    "DELETE FROM erp_sale_order_items WHERE sale_order_id IN (SELECT id FROM erp_sale_orders WHERE client_id IN (?,?))",
    "DELETE FROM erp_sale_orders WHERE client_id IN (?,?)",
    "DELETE FROM erp_purchase_order_items WHERE purchase_order_id IN (SELECT id FROM erp_purchase_orders WHERE client_id IN (?,?))",
    "DELETE FROM erp_purchase_orders WHERE client_id IN (?,?)",
    "DELETE FROM erp_suppliers WHERE client_id IN (?,?)",
    "DELETE FROM erp_products WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_crm_clients WHERE client_id IN (?,?)",
  ])
    await db.execute(sql, [tenantA, tenantB]);
}
function isolated() {
  const events: Array<{
      clientId: string;
      event: string;
      payload: Record<string, string>;
    }> = [],
    publisher: FiscalEventPublisher = {
      publish: (clientId, event, payload) => {
        events.push({ clientId, event, payload });
      },
    },
    repository = new FiscalRepository(),
    service = new FiscalService(repository, publisher);
  return { events, repository, service };
}
const manual = (
  service: FiscalService,
  key = crypto.randomUUID(),
  party = "Parte A"
) =>
  service.createManual(admin, {
    internalIssueDate: "2026-08-24",
    partyName: party,
    partyDocument: null,
    internalNotes: null,
    idempotencyKey: key,
    items: [
      {
        productPublicId: null,
        name: "Item interno",
        sku: null,
        quantityMillis: 1250,
        unitAmountCents: 400,
      },
    ],
  });
async function sourceFixture(
  type: "sale" | "purchase",
  clientId = tenantA,
  status?: string
) {
  const db = getPool(),
    productId = crypto.randomUUID();
  const [product] = await db.execute<any>(
    "INSERT INTO erp_products(public_id,client_id,name,sku,unit,cost_price_cents,sale_price_cents,minimum_stock,created_by,updated_by) VALUES(?,?,?,?, 'unit',100,200,0,'fixture','fixture')",
    [productId, clientId, `Produto ${++serial}`, `FIS-${serial}`]
  );
  const orderId = crypto.randomUUID();
  if (type === "sale") {
    const crm = crypto.randomUUID();
    await db.execute(
      "INSERT INTO megadesk_crm_clients(crm_client_id,client_id,company_name,status) VALUES(?,?,?,'ativo')",
      [crm, clientId, "Cliente origem"]
    );
    const [order] = await db.execute<any>(
      "INSERT INTO erp_sale_orders(public_id,client_id,order_number,crm_client_id,customer_name_snapshot,status,subtotal_cents,total_cents,created_by) VALUES(?,?,?,?,?,?,?,?,?)",
      [
        orderId,
        clientId,
        `SO-${serial}`,
        crm,
        "Cliente origem",
        status ?? "fulfilled",
        600,
        600,
        "fixture",
      ]
    );
    await db.execute(
      "INSERT INTO erp_sale_order_items(public_id,sale_order_id,product_id,product_name_snapshot,sku_snapshot,quantity,unit_price_cents,line_total_cents) VALUES(UUID(),?,?,?,?,'3.000',200,600)",
      [order.insertId, product.insertId, "Produto origem", `FIS-${serial}`]
    );
  } else {
    const supplierId = crypto.randomUUID();
    const [supplier] = await db.execute<any>(
      "INSERT INTO erp_suppliers(public_id,client_id,legal_name,person_type,tax_id,active,created_by,updated_by) VALUES(?,?,?,'legal',?,1,'fixture','fixture')",
      [
        supplierId,
        clientId,
        "Fornecedor origem",
        String(10000000000000 + serial),
      ]
    );
    const [order] = await db.execute<any>(
      "INSERT INTO erp_purchase_orders(public_id,client_id,order_number,supplier_id,supplier_name_snapshot,status,subtotal_cents,total_cents,created_by) VALUES(?,?,?,?,?,?,?,?,?)",
      [
        orderId,
        clientId,
        `PO-${serial}`,
        supplier.insertId,
        "Fornecedor origem",
        status ?? "received",
        300,
        300,
        "fixture",
      ]
    );
    await db.execute(
      "INSERT INTO erp_purchase_order_items(public_id,purchase_order_id,product_id,product_name_snapshot,sku_snapshot,quantity,unit_cost_cents,line_total_cents) VALUES(UUID(),?,?,?,?,'3.000',100,300)",
      [order.insertId, product.insertId, "Produto origem", `FIS-${serial}`]
    );
  }
  return orderId;
}
physical("fiscal MySQL conditional risk matrix", () => {
  beforeAll(async () => {
    await applyCanonicalMigrations(getTestDatabaseUrl(), MAIN_MIGRATIONS_DIR);
  }, 60_000);
  beforeEach(clean);
  it("01 isolates settings A/B and records non-sensitive history", async () => {
    const { service } = isolated();
    await service.saveSettings(admin, {
      taxRegime: "simples_nacional",
      taxpayerIndicator: "taxpayer",
      stateRegistration: null,
      municipalRegistration: null,
      mainCnae: "1234567",
      ibgeCityCode: "3550308",
      environment: "homologation",
      provider: "none",
    });
    expect(await service.settings(admin)).toMatchObject({
      status: "ready_for_integration",
    });
    expect(await service.settings({ ...admin, clientId: tenantB })).toBeNull();
  });
  it("02 enforces admin manager viewer and agent roles", async () => {
    const { service } = isolated();
    await expect(manual(service)).resolves.toMatchObject({ type: "manual" });
    await service.saveSettings(admin, {
      taxRegime: "simples_nacional",
      taxpayerIndicator: "non_taxpayer",
      stateRegistration: null,
      municipalRegistration: null,
      mainCnae: null,
      ibgeCityCode: null,
      environment: "homologation",
      provider: "none",
    });
    await expect(service.settings(viewer)).resolves.toMatchObject({
      canWrite: false,
    });
    await expect(service.createManual(viewer, {} as any)).rejects.toMatchObject(
      { code: "FORBIDDEN" }
    );
    await expect(service.summary(agent)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const productPublicId = crypto.randomUUID();
    await getPool().execute(
      "INSERT INTO erp_products(public_id,client_id,name,sku,unit,cost_price_cents,sale_price_cents,minimum_stock,created_by,updated_by) VALUES(?,?,?,?, 'unit',100,200,0,'fixture','fixture')",
      [productPublicId, tenantA, "Produto perfil", `PROFILE-${++serial}`]
    );
    const profile = productFiscalProfileInput.parse({
      productPublicId,
      ncm: "12.34.56-78",
      cest: null,
      defaultOutboundCfop: "5.102",
      defaultInboundCfop: "1.102",
      goodsOrigin: "0",
      fiscalUnit: " un ",
      gtin: null,
      serviceCode: null,
      operationNature: null,
      internalNotes: null,
    });
    await expect(service.saveProduct(manager, profile)).resolves.toMatchObject({
      productPublicId,
      completeness: "complete",
    });
    await expect(
      service.products(manager, {
        search: "Produto perfil",
        page: 1,
        pageSize: 20,
      })
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          productPublicId,
          ncm: "12345678",
          defaultOutboundCfop: "5102",
          fiscalUnit: "UN",
          completeness: "complete",
        }),
      ],
    });
    await expect(
      service.saveProduct({ ...admin, clientId: tenantB }, profile)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("03 creates authoritative sale and purchase snapshots", async () => {
    const { service } = isolated();
    for (const type of ["sale", "purchase"] as const) {
      const sourcePublicId = await sourceFixture(type),
        d = await service.createSource(manager, {
          type,
          sourcePublicId,
          internalIssueDate: "2026-08-24",
          internalNotes: null,
          idempotencyKey: crypto.randomUUID(),
        });
      expect(d).toMatchObject({
        type,
        totalCents: type === "sale" ? 600 : 300,
        partyName: type === "sale" ? "Cliente origem" : "Fornecedor origem",
      });
      expect(d.items).toHaveLength(1);
      await expect(
        service.createSource(manager, {
          type,
          sourcePublicId,
          internalIssueDate: "2026-08-24",
          internalNotes: null,
          idempotencyKey: crypto.randomUUID(),
        })
      ).rejects.toBeTruthy();
      const [duplicates] = await getPool().execute<RowDataPacket[]>(
        "SELECT COUNT(*) total FROM erp_fiscal_documents WHERE client_id=? AND type=? AND source_public_id=?",
        [tenantA, type, sourcePublicId]
      );
      expect(Number(duplicates[0].total)).toBe(1);
    }
  });
  it("04 treats invalid and cross-tenant origins as unavailable", async () => {
    const { service } = isolated(),
      invalid = await sourceFixture("sale", tenantA, "confirmed"),
      cross = await sourceFixture("purchase", tenantB);
    await expect(
      service.createSource(admin, {
        type: "sale",
        sourcePublicId: invalid,
        internalIssueDate: "2026-08-24",
        internalNotes: null,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      service.createSource(admin, {
        type: "purchase",
        sourcePublicId: cross,
        internalIssueDate: "2026-08-24",
        internalNotes: null,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const inconsistent = await sourceFixture("sale"),
      [productRows] = await getPool().execute<RowDataPacket[]>(
        "SELECT i.product_id FROM erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id WHERE o.client_id=? AND o.public_id=?",
        [tenantA, inconsistent]
      );
    await getPool().execute("UPDATE erp_products SET client_id=? WHERE id=?", [
      tenantB,
      productRows[0].product_id,
    ]);
    await expect(
      service.createSource(admin, {
        type: "sale",
        sourcePublicId: inconsistent,
        internalIssueDate: "2026-08-24",
        internalNotes: null,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Origem com itens inconsistentes.",
    });
  });
  it("05 serializes annual numbering without reuse", async () => {
    const { service } = isolated(),
      docs = await Promise.all(
        Array.from({ length: 4 }, () => manual(service))
      );
    expect(new Set(docs.map(x => x.internalNumber)).size).toBe(4);
    expect(docs.every(x => x.internalNumber.startsWith("FIS-2026-"))).toBe(
      true
    );
  });
  it("06 replays creation without duplicate document history or event", async () => {
    const { service, events } = isolated(),
      key = crypto.randomUUID(),
      first = await manual(service, key),
      second = await manual(service, key);
    expect(second).toMatchObject({ publicId: first.publicId, replay: true });
    expect(
      events.filter(x => x.event === "erp:fiscal.document.changed")
    ).toHaveLength(1);
    await expect(
      service.detail({ ...admin, clientId: tenantB }, first.publicId)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.updateDraft(
        { ...admin, clientId: tenantB },
        {
          publicId: first.publicId,
          internalIssueDate: "2026-08-25",
          internalNotes: null,
        }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("07 rejects semantic idempotency conflict", async () => {
    const { service } = isolated(),
      key = crypto.randomUUID();
    await manual(service, key, "Parte A");
    await expect(manual(service, key, "Parte B")).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });
  it("08 makes ready snapshots immutable and replay event-free", async () => {
    const { service, events } = isolated(),
      d = await manual(service),
      key = crypto.randomUUID(),
      ready = await service.ready(admin, d.publicId, key),
      count = events.length,
      replay = await service.ready(admin, d.publicId, key);
    expect(ready.status).toBe("ready_for_integration");
    expect(replay.replay).toBe(true);
    expect(events).toHaveLength(count);
    await expect(
      service.updateDraft(admin, {
        publicId: d.publicId,
        internalIssueDate: "2026-08-25",
        internalNotes: null,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("09 rolls back failed transition without partial history or event", async () => {
    const { service, events } = isolated(),
      before = events.length;
    await expect(
      service.ready(admin, crypto.randomUUID(), crypto.randomUUID())
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(events).toHaveLength(before);
  });
  it("10 cancels without touching source, stock or finance or exposing private payload", async () => {
    const { service, events } = isolated(),
      d = await manual(service);
    await service.cancel(admin, d.publicId, "Motivo administrativo");
    const last = events.at(-1)!;
    expect(last.payload).toMatchObject({
      publicId: d.publicId,
      operation: "cancelled",
    });
    expect(Object.keys(last.payload).sort()).toEqual([
      "occurredAt",
      "operation",
      "publicId",
    ]);
    const [rows] = await getPool().execute<RowDataPacket[]>(
      "SELECT COUNT(*) total FROM erp_financial_entries WHERE client_id=?",
      [tenantA]
    );
    expect(Number(rows[0].total)).toBe(0);
  });
});
