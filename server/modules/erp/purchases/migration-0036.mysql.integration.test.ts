import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { applyCanonicalMigrations, MAIN_MIGRATIONS_DIR } from "../../../_core/canonical-migrations";
import { getPool } from "../../../db";
import { getTestDatabaseUrl, isTestDatabaseEnabled } from "../../../test-integration-gates";
import { ErpRepository } from "../repository";
import { ErpService } from "../service";
import { FinanceRepository } from "../finance/repository";
import { FinanceService } from "../finance/service";
import { SupplierRepository } from "../suppliers/repository";
import { SupplierService } from "../suppliers/service";
import { PurchaseRepository } from "./repository";
import { PurchaseService } from "./service";
import { PurchaseWorkflowRepository } from "./workflow-repository";

const physical = describe.runIf(isTestDatabaseEnabled());
const adminA = { clientId: "purchase-upgrade-a", userId: "upgrade-admin-a", role: "admin" as const };
const adminB = { clientId: "purchase-upgrade-b", userId: "upgrade-admin-b", role: "admin" as const };
const silent = { publish: () => undefined };

async function applyLegacyChain(databaseUrl: string): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), "megadesk-upgrade-0035-"));
  const metadata = join(temporary, "meta");
  const journalPath = join(MAIN_MIGRATIONS_DIR, "meta", "_journal.json");
  try {
    await mkdir(metadata);
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; tag: string }>;
    };
    const entries = journal.entries.filter(entry => entry.idx <= 35);
    await writeFile(join(metadata, "_journal.json"), JSON.stringify({ ...journal, entries }, null, 2));
    for (const entry of entries) {
      await copyFile(join(MAIN_MIGRATIONS_DIR, `${entry.tag}.sql`), join(temporary, `${entry.tag}.sql`));
    }
    const pool = mysql.createPool(databaseUrl);
    try {
      await migrate(drizzle(pool), { migrationsFolder: temporary });
    } finally {
      await pool.end();
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function businessFixture(identity: typeof adminA, suffix: string) {
  const supplier = await new SupplierService(new SupplierRepository(), silent).create(identity, {
    legalName: `Fornecedor upgrade ${suffix}`,
    tradeName: `Snapshot ${suffix}`,
    personType: "legal",
    taxId: "12345678000195",
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
  const product = await new ErpService(new ErpRepository()).createProduct(identity, {
    name: `Produto upgrade ${suffix}`,
    sku: "UPGRADE-SAME-SKU",
    barcode: null,
    description: null,
    category: "Upgrade",
    unit: "unit",
    costPriceCents: 0,
    salePriceCents: 0,
    minimumStock: "0",
  });
  const purchases = new PurchaseService(new PurchaseRepository(), silent);
  const order = await purchases.create(identity, {
    supplierPublicId: supplier.publicId,
    notes: `Pedido legado ${suffix}`,
    expectedDate: null,
    items: [{ productPublicId: product.publicId, quantity: "1.250", unitCostCents: 321 }],
  });
  await purchases.approve(identity, order.publicId);
  await purchases.receive(identity, order.publicId, `upgrade-receipt-${suffix}`);
  return { supplier, product, order };
}

physical.sequential("migration 0036 adversarial upgrade", () => {
  let fixtureA: Awaited<ReturnType<typeof businessFixture>>;
  let fixtureB: Awaited<ReturnType<typeof businessFixture>>;
  let financeEntryPublicId = "";
  let accountPublicId = "";
  let beforeCounts: Record<string, number> = {};

  beforeAll(async () => {
    const databaseUrl = getTestDatabaseUrl();
    await applyLegacyChain(databaseUrl);

    fixtureA = await businessFixture(adminA, "a");
    fixtureB = await businessFixture(adminB, "b");
    expect(fixtureA.order.orderNumber).toBe(fixtureB.order.orderNumber);

    const finance = new FinanceService(new FinanceRepository(), silent);
    const account = await finance.createAccount(adminA, {
      name: "Conta upgrade 0036",
      type: "bank",
      initialBalanceCents: 10_000,
      allowNegative: false,
    });
    const category = await finance.createCategory(adminA, { name: "Categoria upgrade 0036", direction: "payable" });
    const entry = await finance.createManual(adminA, {
      documentNumber: "UPGRADE-0036",
      direction: "payable",
      description: "Titulo legado liquidado",
      amountCents: 777,
      dueDate: "2030-01-15",
      issueDate: "2030-01-01",
      categoryPublicId: category.publicId,
      financialAccountPublicId: account.publicId,
      supplierPublicId: fixtureA.supplier.publicId,
      crmClientId: null,
      partyName: null,
      notes: null,
    });
    await finance.settle(adminA, entry.publicId, account.publicId, "upgrade-payment-a");
    financeEntryPublicId = entry.publicId;
    accountPublicId = account.publicId;

    const tables = [
      "erp_purchase_orders",
      "erp_purchase_order_receipts",
      "erp_purchase_order_receipt_items",
      "erp_stock_movements",
      "erp_financial_entries",
      "erp_financial_settlements",
      "erp_financial_ledger",
    ];
    for (const table of tables) {
      const [rows] = await getPool().execute<RowDataPacket[]>(`SELECT COUNT(*) total FROM ${table}`);
      beforeCounts[table] = Number(rows[0].total);
    }

    await applyCanonicalMigrations(databaseUrl, MAIN_MIGRATIONS_DIR);
  }, 120_000);

  afterAll(async () => {
    await getPool().end();
  });

  it("preserves legacy business rows, snapshots, stock and settled finance", async () => {
    for (const [table, expected] of Object.entries(beforeCounts)) {
      const [rows] = await getPool().execute<RowDataPacket[]>(`SELECT COUNT(*) total FROM ${table}`);
      expect(Number(rows[0].total), table).toBe(expected);
    }

    const purchases = new PurchaseService(new PurchaseWorkflowRepository(), silent);
    const order = await purchases.detail(adminA, fixtureA.order.publicId) as any;
    expect(order).toMatchObject({
      status: "received",
      supplierName: fixtureA.supplier.legalName,
      totalCents: 401,
      receiptStatus: "received",
    });
    expect(order.items[0]).toMatchObject({ sku: fixtureA.product.sku, quantity: "1.250" });

    const entry = await new FinanceService(new FinanceRepository(), silent).detail(adminA, financeEntryPublicId);
    expect(entry).toMatchObject({ status: "settled", amountCents: 777, paidCents: 777, pendingCents: 0 });
    const ledger = await new FinanceService(new FinanceRepository(), silent).ledger(adminA, accountPublicId);
    expect(ledger.filter(row => row.type === "payable_settlement")).toHaveLength(1);
  });

  it("backfills safe defaults and replaces only the three audited uniqueness invariants", async () => {
    const [defaults] = await getPool().execute<RowDataPacket[]>(
      `SELECT
         (SELECT MIN(receipt_number) FROM erp_purchase_order_receipts) receiptNumber,
         (SELECT MIN(source_installment) FROM erp_financial_entries) sourceInstallment`
    );
    expect(defaults[0]).toMatchObject({ receiptNumber: 1, sourceInstallment: 1 });

    const [indexes] = await getPool().execute<RowDataPacket[]>(
      `SELECT TABLE_NAME tableName, INDEX_NAME indexName, NON_UNIQUE nonUnique, COUNT(*) columnsCount
       FROM information_schema.statistics
       WHERE table_schema=DATABASE() AND INDEX_NAME IN (
         'uq_erp_fin_entries_tenant_source_installment',
         'idx_erp_fin_settlements_tenant_entry',
         'uq_erp_purchase_receipts_order_number'
       )
       GROUP BY TABLE_NAME,INDEX_NAME,NON_UNIQUE`
    );
    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ indexName: "uq_erp_fin_entries_tenant_source_installment", nonUnique: 0, columnsCount: 4 }),
      expect.objectContaining({ indexName: "idx_erp_fin_settlements_tenant_entry", nonUnique: 1, columnsCount: 2 }),
      expect.objectContaining({ indexName: "uq_erp_purchase_receipts_order_number", nonUnique: 0, columnsCount: 2 }),
    ]));
  });

  it("rejects cross-tenant relation injection at the database boundary", async () => {
    const [suppliers] = await getPool().execute<RowDataPacket[]>(
      "SELECT id,client_id FROM erp_suppliers WHERE public_id IN (?,?)",
      [fixtureA.supplier.publicId, fixtureB.supplier.publicId]
    );
    const supplierB = suppliers.find(row => row.client_id === adminB.clientId)!;
    await expect(
      getPool().execute(
        "UPDATE erp_purchase_orders SET supplier_id=? WHERE client_id=? AND public_id=?",
        [supplierB.id, adminA.clientId, fixtureA.order.publicId]
      )
    ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });

    await expect(
      getPool().execute(
        "UPDATE erp_purchase_order_receipts SET client_id=? WHERE client_id=? AND purchase_order_id=(SELECT id FROM erp_purchase_orders WHERE client_id=? AND public_id=?)",
        [adminB.clientId, adminA.clientId, adminA.clientId, fixtureA.order.publicId]
      )
    ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
  });

  it("reapplying the canonical chain is a no-op", async () => {
    await applyCanonicalMigrations(getTestDatabaseUrl(), MAIN_MIGRATIONS_DIR);
    const [rows] = await getPool().execute<RowDataPacket[]>(
      "SELECT COUNT(*) total FROM erp_purchase_orders WHERE client_id IN (?,?)",
      [adminA.clientId, adminB.clientId]
    );
    expect(Number(rows[0].total)).toBe(2);
  });
});
