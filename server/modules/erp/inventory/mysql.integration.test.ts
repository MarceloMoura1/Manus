import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAIN_MIGRATIONS_DIR } from "../../../_core/canonical-migrations";
import {
  getTestDatabaseUrl,
  isTestDatabaseEnabled,
} from "../../../test-integration-gates";
import { ErpRepository } from "../repository";
import { ErpService } from "../service";
import { PurchaseRepository } from "../purchases/repository";
import { SaleRepository } from "../sales/repository";
import {
  backfillInventoryItems,
  InventoryBackfillInterrupted,
  type InventoryBackfillCursor,
} from "./backfill";

const physical = describe.runIf(isTestDatabaseEnabled());
const tenantA = "stock-v3-a";
const tenantB = "stock-v3-b";
const adminA = { clientId: tenantA, userId: "stock-v3-admin-a", role: "admin" as const };
const adminB = { clientId: tenantB, userId: "stock-v3-admin-b", role: "admin" as const };

type Fixture = {
  products: Array<{ id: number; publicId: string }>;
  variants: Array<{ id: number; productId: number; active: boolean }>;
};

let pool: Pool;
let migrationFolder = "";
let fixture: Fixture;
let quantityBefore = "";
let movementCountBefore = 0;
let mismatchesBefore = 0;

async function prepareMigrationFolder() {
  migrationFolder = await mkdtemp(join(tmpdir(), "megadesk-stock-v3-"));
  const meta = join(migrationFolder, "meta");
  await mkdir(meta, { recursive: true });
  const journal = JSON.parse(
    await readFile(join(MAIN_MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")
  ) as { version: string; dialect: string; entries: Array<{ idx: number; tag: string }> };
  for (const file of await readdir(MAIN_MIGRATIONS_DIR)) {
    if (file.endsWith(".sql")) {
      await copyFile(join(MAIN_MIGRATIONS_DIR, file), join(migrationFolder, file));
    }
  }
  await writeFile(
    join(meta, "_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.filter(entry => entry.idx <= 30) })
  );
  return journal;
}

async function insert(sql: string, values: unknown[]): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(sql, values);
  return result.insertId;
}

async function scalar(sql: string, values: unknown[] = []): Promise<string> {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, values);
  return String(Object.values(rows[0] ?? {})[0] ?? "0");
}

async function mismatchCount() {
  return Number(
    await scalar(
      `SELECT COUNT(*) total
       FROM erp_stock_balances b
       LEFT JOIN (
         SELECT m.client_id,m.product_id,m.resulting_balance
         FROM erp_stock_movements m
         INNER JOIN (
           SELECT client_id,product_id,MAX(id) id
           FROM erp_stock_movements GROUP BY client_id,product_id
         ) latest ON latest.id=m.id
       ) ledger ON ledger.client_id=b.client_id AND ledger.product_id=b.product_id
       WHERE b.client_id=? AND b.quantity<>COALESCE(ledger.resulting_balance,'0.000')`,
      [tenantA]
    )
  );
}

async function createBaselineFixture(): Promise<Fixture> {
  await pool.execute(
    `INSERT INTO megadesk_domain_client_users
       (user_id,client_id,name,email,role,status,permissions_json)
     VALUES(?,?,?,?,'admin','active','{}')`,
    [adminA.userId, tenantA, "Operador Estoque V3", "stock-v3-a@example.test"]
  );
  const products: Fixture["products"] = [];
  for (let index = 1; index <= 6; index += 1) {
    const publicId = randomUUID();
    const id = await insert(
      `INSERT INTO erp_products
        (public_id,client_id,name,sku,unit,cost_price_cents,sale_price_cents,minimum_stock,active,created_by)
       VALUES(?,?,?,?, 'unit',?,?,?,1,?)`,
      [
        publicId,
        tenantA,
        `Produto V3 ${index}`,
        `STOCK-V3-${index}`,
        1000 + index,
        2000 + index,
        `${index}.000`,
        adminA.userId,
      ]
    );
    products.push({ id, publicId });
  }

  const variants: Fixture["variants"] = [];
  for (const [productIndex, active, suffix] of [
    [4, true, "UNICA"],
    [5, true, "ATIVA"],
    [5, false, "INATIVA"],
  ] as const) {
    const product = products[productIndex];
    const id = await insert(
      `INSERT INTO erp_product_variants
        (public_id,client_id,product_id,sku,name,cost_price_cents,sale_price_cents,active,created_by)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [
        randomUUID(),
        tenantA,
        product.id,
        `STOCK-V3-${productIndex + 1}-${suffix}`,
        suffix,
        5000 + variants.length,
        7000 + variants.length,
        active ? 1 : 0,
        adminA.userId,
      ]
    );
    variants.push({ id, productId: product.id, active });
  }

  const balances = ["10.000", "0.000", "5.000", "2.000", "40.000", "60.000"];
  for (let index = 0; index < products.length; index += 1) {
    await pool.execute(
      "INSERT INTO erp_stock_balances(client_id,product_id,quantity,version) VALUES(?,?,?,0)",
      [tenantA, products[index].id, balances[index]]
    );
  }

  const addMovement = async (
    productId: number,
    sequence: number,
    quantity: string,
    previous: string,
    result: string
  ) => {
    await pool.execute(
      `INSERT INTO erp_stock_movements
        (public_id,client_id,product_id,type,direction,quantity,previous_balance,resulting_balance,reason,reference_type,idempotency_key,payload_hash,created_by)
       VALUES(?,?,?,'manual_in','in',?,?,?,'fixture ambÃ­gua','manual',?,REPEAT('a',64),?)`,
      [
        randomUUID(),
        tenantA,
        productId,
        quantity,
        previous,
        result,
        `baseline-${productId}-${sequence}`,
        adminA.userId,
      ]
    );
  };
  await addMovement(products[0].id, 1, "10.000", "0.000", "10.000");
  for (const [sequence, quantity, previous, result] of [
    [1, "10.000", "0.000", "10.000"],
    [2, "10.000", "10.000", "20.000"],
    [3, "10.000", "20.000", "30.000"],
    [4, "9.000", "30.000", "39.000"],
  ] as const) await addMovement(products[4].id, sequence, quantity, previous, result);
  for (const [sequence, quantity, previous, result] of [
    [1, "10.000", "0.000", "10.000"],
    [2, "10.000", "10.000", "20.000"],
    [3, "10.000", "20.000", "30.000"],
    [4, "10.000", "30.000", "40.000"],
    [5, "20.000", "40.000", "60.000"],
  ] as const) await addMovement(products[5].id, sequence, quantity, previous, result);

  return { products, variants };
}

async function semanticState() {
  const [items] = await pool.execute<RowDataPacket[]>(
    `SELECT i.public_id publicId,i.kind,p.public_id productPublicId,
            COALESCE(v.public_id,'') variantPublicId,b.quantity
     FROM erp_inventory_items i
     INNER JOIN erp_products p ON p.id=i.product_id AND p.client_id=i.client_id
     LEFT JOIN erp_product_variants v ON v.id=i.variant_id AND v.client_id=i.client_id
     INNER JOIN erp_inventory_item_balances b
       ON b.client_id=i.client_id AND b.inventory_item_id=i.id
     WHERE i.client_id=? ORDER BY p.public_id,i.kind,v.public_id`,
    [tenantA]
  );
  const [movements] = await pool.execute<RowDataPacket[]>(
    `SELECT m.public_id movementPublicId,i.public_id itemPublicId,i.kind
     FROM erp_stock_movements m
     INNER JOIN erp_inventory_items i
       ON i.client_id=m.client_id AND i.id=m.inventory_item_id
     WHERE m.client_id=? ORDER BY m.id`,
    [tenantA]
  );
  return { items: JSON.parse(JSON.stringify(items)), movements: JSON.parse(JSON.stringify(movements)) };
}

async function finishBackfill(after: InventoryBackfillCursor | undefined) {
  let cursor = after;
  for (;;) {
    const result = await backfillInventoryItems(pool, { after: cursor, limit: 2 });
    cursor = result.lastCursor ?? cursor;
    if (result.complete) return;
  }
}

physical("variant-aware inventory 0031 disposable rehearsal", () => {
  beforeAll(async () => {
    const url = getTestDatabaseUrl();
    pool = mysql.createPool({ uri: url, timezone: "Z", connectionLimit: 8 });
    const journal = await prepareMigrationFolder();
    await migrate(drizzle(pool), { migrationsFolder: migrationFolder });
    fixture = await createBaselineFixture();
    quantityBefore = await scalar(
      "SELECT COALESCE(SUM(quantity),'0.000') total FROM erp_stock_balances WHERE client_id=?",
      [tenantA]
    );
    movementCountBefore = Number(
      await scalar("SELECT COUNT(*) total FROM erp_stock_movements WHERE client_id=?", [tenantA])
    );
    mismatchesBefore = await mismatchCount();
    await writeFile(
      join(migrationFolder, "meta", "_journal.json"),
      JSON.stringify(journal)
    );
    await migrate(drizzle(pool), { migrationsFolder: migrationFolder });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (migrationFolder) await rm(migrationFolder, { recursive: true, force: true });
  });

  it("proves backfill, restart, dual-write and isolation invariants", async () => {
    expect(movementCountBefore).toBe(10);
    expect(mismatchesBefore).toBe(3);

    const first = await backfillInventoryItems(pool, { limit: 100 });
    expect(first).toMatchObject({
      processed: 6,
      simpleItems: 4,
      variantItems: 3,
      legacyItems: 2,
      complete: true,
    });
    expect(Number(await scalar("SELECT COUNT(*) total FROM erp_inventory_items WHERE client_id=?", [tenantA]))).toBe(9);
    expect(await scalar(
      `SELECT COALESCE(SUM(b.quantity),'0.000') total
       FROM erp_inventory_item_balances b
       INNER JOIN erp_inventory_items i ON i.client_id=b.client_id AND i.id=b.inventory_item_id
       WHERE i.client_id=? AND i.kind='legacy_unallocated'`,
      [tenantA]
    )).toBe("100.000");
    expect(await scalar(
      `SELECT COALESCE(SUM(b.quantity),'0.000') total
       FROM erp_inventory_item_balances b
       INNER JOIN erp_inventory_items i ON i.client_id=b.client_id AND i.id=b.inventory_item_id
       WHERE i.client_id=?`,
      [tenantA]
    )).toBe(quantityBefore);
    expect(Number(await scalar("SELECT COUNT(*) total FROM erp_stock_movements WHERE client_id=?", [tenantA]))).toBe(movementCountBefore);
    expect(Number(await scalar(
      `SELECT COUNT(*) total FROM erp_stock_movements m
       INNER JOIN erp_inventory_items i ON i.client_id=m.client_id AND i.id=m.inventory_item_id
       WHERE m.client_id=? AND i.kind='variant'`,
      [tenantA]
    ))).toBe(0);
    expect(await mismatchCount()).toBe(mismatchesBefore);

    const expected = await semanticState();
    const second = await backfillInventoryItems(pool, { limit: 100 });
    expect(second).toMatchObject({ processed: 6, complete: true });
    expect(await semanticState()).toEqual(expected);

    await pool.execute("UPDATE erp_stock_movements SET inventory_item_id=NULL,inventory_previous_balance=NULL,inventory_resulting_balance=NULL WHERE client_id=?", [tenantA]);
    await pool.execute("DELETE b FROM erp_inventory_item_balances b INNER JOIN erp_inventory_items i ON i.client_id=b.client_id AND i.id=b.inventory_item_id WHERE i.client_id=?", [tenantA]);
    await pool.execute("DELETE FROM erp_inventory_items WHERE client_id=?", [tenantA]);
    let checkpoint: InventoryBackfillCursor | undefined;
    try {
      await backfillInventoryItems(pool, { limit: 100, interruptAfter: 2 });
      throw new Error("Expected synthetic interruption");
    } catch (error) {
      expect(error).toBeInstanceOf(InventoryBackfillInterrupted);
      checkpoint = (error as InventoryBackfillInterrupted).cursor;
    }
    await finishBackfill(checkpoint);
    expect(await semanticState()).toEqual(expected);

    const service = new ErpService(new ErpRepository(pool));
    const [itemRows] = await pool.execute<RowDataPacket[]>(
      `SELECT i.id,i.public_id,i.kind,i.product_id,v.active variant_active
       FROM erp_inventory_items i
       LEFT JOIN erp_product_variants v ON v.id=i.variant_id AND v.client_id=i.client_id
       WHERE i.client_id=?`,
      [tenantA]
    );
    const simple = itemRows.find(row => Number(row.product_id) === fixture.products[0].id && row.kind === "simple")!;
    const singleVariant = itemRows.find(row => Number(row.product_id) === fixture.products[4].id && row.kind === "variant")!;
    const singleLegacy = itemRows.find(row => Number(row.product_id) === fixture.products[4].id && row.kind === "legacy_unallocated")!;
    const inactiveVariant = itemRows.find(row => Number(row.product_id) === fixture.products[5].id && row.kind === "variant" && Number(row.variant_active) === 0)!;

    const types = ["manual_in", "adjustment_in", "manual_out", "adjustment_out"] as const;
    for (const type of types) {
      await service.moveStock(adminA, {
        productPublicId: fixture.products[0].publicId,
        inventoryItemPublicId: String(simple.public_id),
        type,
        quantity: "1.000",
        reason: `rehearsal ${type}`,
        idempotencyKey: randomUUID(),
      });
    }

    const idempotencyKey = randomUUID();
    const movement = await service.moveStock(adminA, {
      productPublicId: fixture.products[4].publicId,
      type: "manual_in",
      quantity: "2.000",
      reason: "single active variant",
      idempotencyKey,
    });
    const replay = await service.moveStock(adminA, {
      productPublicId: fixture.products[4].publicId,
      type: "manual_in",
      quantity: "2.000",
      reason: "single active variant",
      idempotencyKey,
    });
    expect(replay.publicId).toBe(movement.publicId);
    expect(movement.inventoryItemPublicId).toBe(singleVariant.public_id);
    const reversal = await service.reverseMovement(
      adminA,
      movement.publicId,
      "reversal rehearsal",
      randomUUID()
    );
    expect(reversal.inventoryItemPublicId).toBe(movement.inventoryItemPublicId);
    await expect(
      service.reverseMovement(adminA, movement.publicId, "double reversal", randomUUID())
    ).rejects.toMatchObject({ code: "ALREADY_REVERSED" });

    await expect(service.moveStock(adminA, {
      productPublicId: fixture.products[0].publicId,
      inventoryItemPublicId: String(singleVariant.public_id),
      type: "manual_in",
      quantity: "1.000",
      reason: "cross product",
      idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.moveStock(adminA, {
      productPublicId: fixture.products[5].publicId,
      inventoryItemPublicId: String(inactiveVariant.public_id),
      type: "manual_in",
      quantity: "1.000",
      reason: "inactive variant",
      idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.moveStock(adminB, {
      productPublicId: fixture.products[4].publicId,
      inventoryItemPublicId: String(singleVariant.public_id),
      type: "manual_in",
      quantity: "1.000",
      reason: "cross tenant",
      idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const mismatchedVariantId = await insert(
      `INSERT INTO erp_product_variants
        (public_id,client_id,product_id,sku,name,cost_price_cents,active,created_by)
       VALUES(?,?,?,?,?,0,1,?)`,
      [
        randomUUID(),
        tenantA,
        fixture.products[1].id,
        "STOCK-V3-FK-MISMATCH",
        "Variante para prova de FK",
        adminA.userId,
      ]
    );
    await expect(pool.execute(
      `INSERT INTO erp_inventory_items
        (public_id,client_id,product_id,variant_id,kind,active,minimum_stock,created_by)
       VALUES(?,?,?,?,'variant',1,NULL,?)`,
      [randomUUID(), tenantA, fixture.products[0].id, mismatchedVariantId, adminA.userId]
    )).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
    await expect(pool.execute(
      "DELETE FROM erp_product_variants WHERE client_id=? AND id=?",
      [tenantA, fixture.variants[0].id]
    )).rejects.toMatchObject({ code: "ER_ROW_IS_REFERENCED_2" });
    await pool.execute(
      "DELETE FROM erp_product_variants WHERE client_id=? AND id=?",
      [tenantA, mismatchedVariantId]
    );

    const supplierPublicId = randomUUID();
    const supplierId = await insert(
      "INSERT INTO erp_suppliers(public_id,client_id,legal_name,person_type,active,created_by) VALUES(?,?,?,'legal',1,?)",
      [supplierPublicId, tenantA, "Fornecedor V3", adminA.userId]
    );
    const purchasePublicId = randomUUID();
    const purchaseId = await insert(
      `INSERT INTO erp_purchase_orders
        (public_id,client_id,order_number,supplier_id,supplier_name_snapshot,status,subtotal_cents,total_cents,approved_by,approved_at,created_by)
       VALUES(?,?,?,?,?,'approved',3000,3000,?,NOW(),?)`,
      [purchasePublicId, tenantA, "PO-V3-000001", supplierId, "Fornecedor V3", adminA.userId, adminA.userId]
    );
    await pool.execute(
      `INSERT INTO erp_purchase_order_items
        (public_id,purchase_order_id,product_id,inventory_item_id,product_name_snapshot,sku_snapshot,quantity,unit_cost_cents,line_total_cents)
       VALUES(?,?,?,?,?,?, '3.000',1000,3000)`,
      [randomUUID(), purchaseId, fixture.products[4].id, singleVariant.id, "Produto V3 5", "STOCK-V3-5-UNICA"]
    );
    const purchaseKey = randomUUID();
    const purchaseRepository = new PurchaseRepository(pool);
    expect((await purchaseRepository.receive(tenantA, adminA.userId, purchasePublicId, purchaseKey)).replay).toBe(false);
    expect((await purchaseRepository.receive(tenantA, adminA.userId, purchasePublicId, purchaseKey)).replay).toBe(true);
    const crmClientId = "stock-v3-customer-a";
    await pool.execute(
      "INSERT INTO megadesk_crm_clients(crm_client_id,client_id,company_name,status,lifecycle_state) VALUES(?,?,?,'ativo','active')",
      [crmClientId, tenantA, "Cliente V3"]
    );
    const salePublicId = randomUUID();
    const saleId = await insert(
      `INSERT INTO erp_sale_orders
        (public_id,client_id,order_number,crm_client_id,customer_name_snapshot,status,subtotal_cents,total_cents,confirmed_by,confirmed_at,created_by)
       VALUES(?,?,?,?,?,'confirmed',2000,2000,?,NOW(),?)`,
      [salePublicId, tenantA, "SO-V3-000001", crmClientId, "Cliente V3", adminA.userId, adminA.userId]
    );
    await pool.execute(
      `INSERT INTO erp_sale_order_items
        (public_id,sale_order_id,product_id,inventory_item_id,product_name_snapshot,sku_snapshot,quantity,unit_price_cents,line_total_cents)
       VALUES(?,?,?,?,?,?, '2.000',1000,2000)`,
      [randomUUID(), saleId, fixture.products[4].id, singleVariant.id, "Produto V3 5", "STOCK-V3-5-UNICA"]
    );
    const saleKey = randomUUID();
    const saleRepository = new SaleRepository(pool);
    expect((await saleRepository.fulfill(tenantA, adminA.userId, salePublicId, saleKey)).replay).toBe(false);
    expect((await saleRepository.fulfill(tenantA, adminA.userId, salePublicId, saleKey)).replay).toBe(true);
    const aggregateBeforeVariantSale = await scalar(
      "SELECT quantity FROM erp_stock_balances WHERE client_id=? AND product_id=?",
      [tenantA, fixture.products[4].id]
    );
    const variantBeforeVariantSale = await scalar(
      "SELECT quantity FROM erp_inventory_item_balances WHERE client_id=? AND inventory_item_id=?",
      [tenantA, singleVariant.id]
    );
    const legacyBeforeVariantSale = await scalar(
      "SELECT quantity FROM erp_inventory_item_balances WHERE client_id=? AND inventory_item_id=?",
      [tenantA, singleLegacy.id]
    );
    const multiItemSalePublicId = randomUUID();
    const multiItemSaleId = await insert(
      `INSERT INTO erp_sale_orders
        (public_id,client_id,order_number,crm_client_id,customer_name_snapshot,status,subtotal_cents,total_cents,confirmed_by,confirmed_at,created_by)
       VALUES(?,?,?,?,?,'confirmed',2000,2000,?,NOW(),?)`,
      [multiItemSalePublicId, tenantA, "SO-V3-000002", crmClientId, "Cliente V3", adminA.userId, adminA.userId]
    );
    await pool.execute(
      `INSERT INTO erp_sale_order_items
        (public_id,sale_order_id,product_id,inventory_item_id,product_name_snapshot,sku_snapshot,quantity,unit_price_cents,line_total_cents)
       VALUES
        (?,?,?,?,?,?, '1.000',1000,1000),
        (?,?,?,?,?,?, '1.000',1000,1000)`,
      [
        randomUUID(), multiItemSaleId, fixture.products[4].id, singleVariant.id, "Produto V3 5", "STOCK-V3-5-UNICA",
        randomUUID(), multiItemSaleId, fixture.products[4].id, singleLegacy.id, "Produto V3 5", "STOCK-V3-5-LEGACY",
      ]
    );
    await saleRepository.fulfill(tenantA, adminA.userId, multiItemSalePublicId, randomUUID());
    expect(await scalar(
      "SELECT quantity FROM erp_stock_balances WHERE client_id=? AND product_id=?",
      [tenantA, fixture.products[4].id]
    )).toBe((Number(aggregateBeforeVariantSale) - 2).toFixed(3));
    expect(await scalar(
      "SELECT quantity FROM erp_inventory_item_balances WHERE client_id=? AND inventory_item_id=?",
      [tenantA, singleVariant.id]
    )).toBe((Number(variantBeforeVariantSale) - 1).toFixed(3));
    expect(await scalar(
      "SELECT quantity FROM erp_inventory_item_balances WHERE client_id=? AND inventory_item_id=?",
      [tenantA, singleLegacy.id]
    )).toBe((Number(legacyBeforeVariantSale) - 1).toFixed(3));

    const postActivationState = await semanticState();
    await backfillInventoryItems(pool, { limit: 100 });
    expect(await semanticState()).toEqual(postActivationState);

    await Promise.all([
      service.moveStock(adminA, { productPublicId: fixture.products[0].publicId, inventoryItemPublicId: String(simple.public_id), type: "manual_in", quantity: "1.000", reason: "concurrent a", idempotencyKey: randomUUID() }),
      service.moveStock(adminA, { productPublicId: fixture.products[0].publicId, inventoryItemPublicId: String(simple.public_id), type: "manual_in", quantity: "1.000", reason: "concurrent b", idempotencyKey: randomUUID() }),
    ]);

    expect(Number(await scalar(
      "SELECT COUNT(*) total FROM erp_stock_movements WHERE client_id=? AND inventory_item_id IS NULL",
      [tenantA]
    ))).toBe(0);
    expect(Number(await scalar(
      `SELECT COUNT(*) total FROM (
         SELECT idempotency_key FROM erp_stock_movements WHERE client_id=?
         GROUP BY idempotency_key HAVING COUNT(*)>1
       ) duplicates`,
      [tenantA]
    ))).toBe(0);
    expect(Number(await scalar(
      `SELECT COUNT(*) total FROM erp_stock_movements m
       LEFT JOIN erp_inventory_items i ON i.client_id=m.client_id AND i.id=m.inventory_item_id
       WHERE m.client_id=? AND i.id IS NULL`,
      [tenantA]
    ))).toBe(0);

    console.info("STOCK_V3_REHEARSAL_METRICS", JSON.stringify({
      totalQuantityBefore: quantityBefore,
      totalQuantityAfterBackfill: quantityBefore,
      movementCountBefore,
      movementCountAfterBackfill: movementCountBefore,
      simpleItems: 4,
      variantItems: 3,
      legacyItems: 2,
      legacyQuantity: "100.000",
      mismatchesBefore,
      mismatchesAfterBackfill: mismatchesBefore,
      historicalVariantAssignments: 0,
    }));
  }, 120_000);
});
