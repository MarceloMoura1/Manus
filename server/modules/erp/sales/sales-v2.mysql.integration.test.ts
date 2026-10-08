import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  applyCanonicalMigrations,
  MAIN_MIGRATIONS_DIR,
} from "../../../_core/canonical-migrations";
import { getPool } from "../../../db";
import {
  getTestDatabaseUrl,
  isTestDatabaseEnabled,
} from "../../../test-integration-gates";
import { FinanceRepository } from "../finance/repository";
import { FinanceService } from "../finance/service";
import { ErpRepository } from "../repository";
import { ErpService } from "../service";
import {
  saleConfirmationInput,
  saleDraftInput,
  saleTransitionInput,
} from "./contracts";
import { SaleRepository } from "./repository";
import { SaleService, type SaleEventPublisher } from "./service";

const physical = describe.runIf(isTestDatabaseEnabled());
const adminA = {
  clientId: "sale-v2-a",
  userId: "admin-v2-a",
  userName: "Admin V2 A",
  role: "admin" as const,
};
const managerA = {
  ...adminA,
  userId: "manager-v2-a",
  userName: "Manager V2 A",
  role: "manager" as const,
};
const viewerA = {
  ...adminA,
  userId: "viewer-v2-a",
  userName: "Viewer V2 A",
  role: "viewer" as const,
};
const adminB = {
  clientId: "sale-v2-b",
  userId: "admin-v2-b",
  userName: "Admin V2 B",
  role: "admin" as const,
};
const tenants = [adminA.clientId, adminB.clientId];
const silent: SaleEventPublisher = { publish: () => undefined };
let serial = 0;

async function clean(): Promise<void> {
  const db = getPool();
  await db.query("DROP TRIGGER IF EXISTS trg_sales_v2_fail_second_installment");
  for (const sql of [
    "DELETE FROM erp_financial_ledger WHERE client_id IN (?,?)",
    "DELETE FROM erp_financial_settlements WHERE client_id IN (?,?)",
    "DELETE FROM erp_financial_entries WHERE client_id IN (?,?)",
    "DELETE FROM erp_sale_documents WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_crm_client_files WHERE client_id IN (?,?)",
    "DELETE FROM erp_sale_order_events WHERE client_id IN (?,?)",
    "DELETE fi FROM erp_sale_order_fulfillment_items fi INNER JOIN erp_sale_order_fulfillments f ON f.id=fi.fulfillment_id WHERE f.client_id IN (?,?)",
    "DELETE FROM erp_sale_order_fulfillments WHERE client_id IN (?,?)",
    "DELETE h FROM erp_sale_order_history h INNER JOIN erp_sale_orders o ON o.id=h.sale_order_id WHERE o.client_id IN (?,?)",
    "DELETE i FROM erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id WHERE o.client_id IN (?,?)",
    "DELETE FROM erp_sale_orders WHERE client_id IN (?,?)",
    "DELETE FROM erp_sale_order_sequences WHERE client_id IN (?,?)",
    "DELETE FROM erp_stock_movements WHERE client_id IN (?,?)",
    "DELETE FROM erp_stock_balances WHERE client_id IN (?,?)",
    "DELETE FROM erp_product_audit_logs WHERE client_id IN (?,?)",
    "DELETE FROM erp_inventory_item_balances WHERE client_id IN (?,?)",
    "DELETE FROM erp_inventory_items WHERE client_id IN (?,?)",
    "DELETE FROM erp_product_variant_attribute_values WHERE client_id IN (?,?)",
    "DELETE FROM erp_product_variants WHERE client_id IN (?,?)",
    "DELETE FROM erp_products WHERE client_id IN (?,?)",
    "DELETE FROM erp_financial_categories WHERE client_id IN (?,?)",
    "DELETE FROM erp_financial_accounts WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_crm_clients WHERE client_id IN (?,?)",
  ]) {
    await db.execute(sql, tenants);
  }
}

async function count(sql: string, args: unknown[] = []): Promise<number> {
  const [rows] = await getPool().execute<RowDataPacket[]>(sql, args);
  return Number(rows[0]?.total ?? 0);
}

async function fixture(identity = adminA, stock = "10.000") {
  const current = ++serial;
  const customer = {
    crmClientId: crypto.randomUUID(),
    companyName: `Cliente venda ${current}`,
  };
  await getPool().execute(
    "INSERT INTO megadesk_crm_clients(crm_client_id,client_id,company_name,status) VALUES(?,?,?,'ativo')",
    [customer.crmClientId, identity.clientId, customer.companyName]
  );
  const erp = new ErpService(new ErpRepository());
  const product = await erp.createProduct(identity, {
    name: `Produto venda ${current}`,
    sku: `SALE-${identity.clientId}-${current}`,
    barcode: null,
    description: null,
    category: "Vendas",
    unit: "unit",
    costPriceCents: 123,
    salePriceCents: 1_234,
    minimumStock: "0",
  });
  if (stock !== "0.000") {
    await erp.moveStock(identity, {
      productPublicId: product.publicId,
      type: "manual_in",
      quantity: stock,
      reason: "Saldo sintético para validação física de Vendas",
      idempotencyKey: crypto.randomUUID(),
    });
  }
  const [items] = await getPool().execute<RowDataPacket[]>(
    `SELECT ii.public_id FROM erp_inventory_items ii
     INNER JOIN erp_products p ON p.client_id=ii.client_id AND p.id=ii.product_id
     WHERE p.client_id=? AND p.public_id=? AND ii.kind='simple' LIMIT 1`,
    [identity.clientId, product.publicId]
  );
  const finance = new FinanceService(new FinanceRepository(), {
    publish: () => undefined,
  });
  const category = await finance.createCategory(identity, {
    name: `Receita venda ${current}`,
    direction: "receivable",
  });
  const account = await finance.createAccount(identity, {
    name: `Conta venda ${current}`,
    type: "bank",
    initialBalanceCents: 0,
    allowNegative: false,
  });
  return {
    customer,
    product,
    inventoryItemPublicId: String(items[0].public_id),
    categoryPublicId: category.publicId,
    accountPublicId: account.publicId,
  };
}

function draft(
  crmClientId: string,
  productPublicId: string,
  inventoryItemPublicId: string,
  overrides: Record<string, unknown> = {}
) {
  return saleDraftInput.parse({
    crmClientId,
    notes: "Pedido físico sintético",
    shippingAddress: {
      recipientName: "Cliente sintético",
      postalCode: "01001000",
      street: "Rua de teste",
      number: "10",
      complement: "",
      district: "Centro",
      city: "São Paulo",
      state: "SP",
    },
    orderDiscountCents: 7,
    freightCents: 13,
    items: [
      {
        productPublicId,
        inventoryItemPublicId,
        quantity: "1.005",
        unitPriceCents: 101,
        discountCents: 3,
      },
    ],
    ...overrides,
  });
}

async function confirm(
  service: SaleService,
  identity: typeof adminA,
  order: { publicId: string; totalCents: number },
  categoryPublicId: string,
  idempotencyKey = crypto.randomUUID(),
  installmentAmounts = [order.totalCents]
) {
  return service.confirm(
    identity,
    saleConfirmationInput.parse({
      publicId: order.publicId,
      idempotencyKey,
      paymentMethod: "Boleto bancário",
      categoryPublicId,
      financialAccountPublicId: null,
      installments: installmentAmounts.map((amountCents, index) => ({
        dueDate: `2030-${String(index + 1).padStart(2, "0")}-10`,
        amountCents,
      })),
    })
  );
}

async function transition(
  service: SaleService,
  publicId: string,
  toStage: "separation" | "shipped" | "received" | "completed",
  idempotencyKey = crypto.randomUUID(),
  reason: string | null = null
) {
  return service.transition(
    adminA,
    saleTransitionInput.parse({
      publicId,
      toStage,
      idempotencyKey,
      ...(reason ? { reason } : {}),
    })
  );
}

physical.sequential("ERP sales v2 MySQL physical matrix", () => {
  beforeAll(() =>
    applyCanonicalMigrations(getTestDatabaseUrl(), MAIN_MIGRATIONS_DIR)
  );
  beforeEach(clean);
  afterAll(clean);

  it("persists tenant-safe draft snapshots, exact money and role gates", async () => {
    expect(
      await count(
        "SELECT COUNT(*) total FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('erp_sale_order_events','erp_sale_documents')"
      )
    ).toBe(2);
    const f = await fixture();
    const service = new SaleService(new SaleRepository(), silent);
    const order = await service.create(
      adminA,
      draft(
        f.customer.crmClientId,
        f.product.publicId,
        f.inventoryItemPublicId,
        { expectedDate: "2030-01-15" }
      )
    );
    expect(order).toMatchObject({
      status: "draft",
      currentStage: "created",
      subtotalCents: 102,
      discountCents: 10,
      freightCents: 13,
      totalCents: 105,
      expectedDate: "2030-01-15",
    });
    expect(order.items[0]).toMatchObject({
      productPublicId: f.product.publicId,
      inventoryItemPublicId: f.inventoryItemPublicId,
      sku: f.product.sku,
      discountCents: 3,
      lineTotalCents: 99,
    });
    expect(order.shippingAddress).toMatchObject({
      street: "Rua de teste",
      state: "SP",
    });
    expect(order.billingAddress).toEqual(order.shippingAddress);
    expect(
      (
        await service.list(viewerA, {
          search: "",
          sort: "createdAt",
          direction: "desc",
          page: 1,
          pageSize: 20,
        })
      ).total
    ).toBe(1);
    await expect(
      service.create(
        viewerA,
        draft(
          f.customer.crmClientId,
          f.product.publicId,
          f.inventoryItemPublicId
        )
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.detail(adminB, order.publicId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("preserves a selected variation identity and snapshots across edit/read", async () => {
    const f = await fixture();
    const [products] = await getPool().execute<RowDataPacket[]>(
      "SELECT id FROM erp_products WHERE client_id=? AND public_id=?",
      [adminA.clientId, f.product.publicId]
    );
    const productId = Number(products[0].id);
    const variantPublicId = crypto.randomUUID();
    const variantItemPublicId = crypto.randomUUID();
    const variantSku = `VAR-${serial}`;
    const [variant] = await getPool().execute<ResultSetHeader>(
      "INSERT INTO erp_product_variants(public_id,client_id,product_id,sku,name,sale_price_cents,active,created_by) VALUES(?,?,?,?,?,?,1,?)",
      [
        variantPublicId,
        adminA.clientId,
        productId,
        variantSku,
        "Azul / Grande",
        1_999,
        adminA.userId,
      ]
    );
    const [inventoryItem] = await getPool().execute<ResultSetHeader>(
      "INSERT INTO erp_inventory_items(public_id,client_id,product_id,variant_id,kind,active,created_by) VALUES(?,?,?,?,'variant',1,?)",
      [
        variantItemPublicId,
        adminA.clientId,
        productId,
        variant.insertId,
        adminA.userId,
      ]
    );
    await getPool().execute(
      "UPDATE erp_inventory_item_balances SET quantity=0 WHERE client_id=? AND inventory_item_id=(SELECT id FROM erp_inventory_items WHERE client_id=? AND public_id=?)",
      [adminA.clientId, adminA.clientId, f.inventoryItemPublicId]
    );
    await getPool().execute(
      "INSERT INTO erp_inventory_item_balances(client_id,inventory_item_id,quantity,version) VALUES(?,?,10,0)",
      [adminA.clientId, inventoryItem.insertId]
    );
    const service = new SaleService(new SaleRepository(), silent);
    const input = draft(
      f.customer.crmClientId,
      f.product.publicId,
      variantItemPublicId,
      {
        items: [
          {
            productPublicId: f.product.publicId,
            inventoryItemPublicId: variantItemPublicId,
            quantity: "2",
            unitPriceCents: 1_999,
            discountCents: 198,
          },
        ],
        orderDiscountCents: 100,
        freightCents: 75,
      }
    );
    const created = await service.create(adminA, input);
    const edited = await service.update(adminA, created.publicId, {
      ...input,
      notes: "Variação preservada",
    });
    expect(edited.items[0]).toMatchObject({
      inventoryItemPublicId: variantItemPublicId,
      sku: variantSku,
      quantity: "2.000",
      unitPriceCents: 1_999,
      discountCents: 198,
    });
    expect(edited).toMatchObject({
      subtotalCents: 3_998,
      discountCents: 298,
      freightCents: 75,
      totalCents: 3_775,
    });
  });

  it("confirms and creates titles atomically, idempotently and concurrently", async () => {
    const f = await fixture();
    const service = new SaleService(new SaleRepository(), silent);
    const order = await service.create(
      adminA,
      draft(
        f.customer.crmClientId,
        f.product.publicId,
        f.inventoryItemPublicId
      )
    );
    const key = crypto.randomUUID();
    const amounts = [52, 53];
    const outcomes = await Promise.all([
      confirm(service, adminA, order, f.categoryPublicId, key, amounts),
      confirm(service, adminA, order, f.categoryPublicId, key, amounts),
    ]);
    expect(outcomes.filter(result => result.replay)).toHaveLength(1);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_financial_entries WHERE client_id=? AND source_type='sales_order' AND source_public_id=?",
        [adminA.clientId, order.publicId]
      )
    ).toBe(2);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_sale_order_events WHERE client_id=? AND event_type='confirmed'",
        [adminA.clientId]
      )
    ).toBe(1);
    await expect(
      service.confirm(
        adminA,
        saleConfirmationInput.parse({
          publicId: order.publicId,
          idempotencyKey: key,
          paymentMethod: "Pix",
          categoryPublicId: f.categoryPublicId,
          financialAccountPublicId: null,
          installments: [{ dueDate: "2030-01-10", amountCents: 105 }],
        })
      )
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("rolls back order and every title when the second physical insert fails", async () => {
    const f = await fixture();
    const service = new SaleService(new SaleRepository(), silent);
    const order = await service.create(
      adminA,
      draft(
        f.customer.crmClientId,
        f.product.publicId,
        f.inventoryItemPublicId
      )
    );
    await getPool().query(
      `CREATE TRIGGER trg_sales_v2_fail_second_installment BEFORE INSERT ON erp_financial_entries FOR EACH ROW BEGIN IF NEW.source_type='sales_order' AND NEW.source_public_id='${order.publicId}' AND NEW.source_installment=2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='controlled second installment failure'; END IF; END`
    );
    try {
      await expect(
        confirm(
          service,
          adminA,
          order,
          f.categoryPublicId,
          crypto.randomUUID(),
          [52, 53]
        )
      ).rejects.toBeTruthy();
    } finally {
      await getPool().query(
        "DROP TRIGGER IF EXISTS trg_sales_v2_fail_second_installment"
      );
    }
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_financial_entries WHERE client_id=? AND source_public_id=?",
        [adminA.clientId, order.publicId]
      )
    ).toBe(0);
    expect(await service.detail(adminA, order.publicId)).toMatchObject({
      status: "draft",
      currentStage: "created",
      titleCount: 0,
    });
  });

  it("ships concurrently once and completes without a second stock exit", async () => {
    const f = await fixture();
    const service = new SaleService(new SaleRepository(), silent);
    const order = await service.create(
      adminA,
      draft(
        f.customer.crmClientId,
        f.product.publicId,
        f.inventoryItemPublicId
      )
    );
    await confirm(service, adminA, order, f.categoryPublicId);
    await transition(service, order.publicId, "separation");
    const shipKey = crypto.randomUUID();
    const shipped = await Promise.all([
      transition(service, order.publicId, "shipped", shipKey),
      transition(service, order.publicId, "shipped", shipKey),
    ]);
    expect(shipped.filter(result => result.replay)).toHaveLength(1);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_stock_movements WHERE client_id=? AND type='sale_out' AND reference_id=?",
        [adminA.clientId, order.publicId]
      )
    ).toBe(1);
    await expect(
      transition(
        service,
        order.publicId,
        "separation",
        crypto.randomUUID(),
        "Tentativa de retorno"
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await transition(service, order.publicId, "received");
    await transition(service, order.publicId, "completed");
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_stock_movements WHERE client_id=? AND type='sale_out' AND reference_id=?",
        [adminA.clientId, order.publicId]
      )
    ).toBe(1);
    expect(await service.detail(adminA, order.publicId)).toMatchObject({
      status: "fulfilled",
      currentStage: "completed",
    });
  });

  it("rolls back the shipment when one inventory item lacks stock", async () => {
    const first = await fixture(adminA, "10.000");
    const second = await fixture(adminA, "1.000");
    const service = new SaleService(new SaleRepository(), silent);
    const input = saleDraftInput.parse({
      crmClientId: first.customer.crmClientId,
      items: [
        {
          productPublicId: first.product.publicId,
          inventoryItemPublicId: first.inventoryItemPublicId,
          quantity: "1",
          unitPriceCents: 100,
          discountCents: 0,
        },
        {
          productPublicId: second.product.publicId,
          inventoryItemPublicId: second.inventoryItemPublicId,
          quantity: "1",
          unitPriceCents: 200,
          discountCents: 0,
        },
      ],
    });
    const order = await service.create(adminA, input);
    await confirm(service, adminA, order, first.categoryPublicId);
    await transition(service, order.publicId, "separation");
    await new ErpService(new ErpRepository()).moveStock(adminA, {
      productPublicId: second.product.publicId,
      inventoryItemPublicId: second.inventoryItemPublicId,
      type: "manual_out",
      quantity: "1.000",
      reason: "Consumo concorrente sintético antes do envio",
      idempotencyKey: crypto.randomUUID(),
    });
    await expect(
      transition(service, order.publicId, "shipped")
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_stock_movements WHERE client_id=? AND type='sale_out' AND reference_id=?",
        [adminA.clientId, order.publicId]
      )
    ).toBe(0);
    expect(
      (
        await new ErpService(new ErpRepository()).getProduct(
          adminA,
          first.product.publicId
        )
      ).quantity
    ).toBe("10.000");
    expect(await service.detail(adminA, order.publicId)).toMatchObject({
      currentStage: "separation",
    });
  });

  it("cancels titles atomically and serializes cancellation against receipt", async () => {
    const f = await fixture();
    const service = new SaleService(new SaleRepository(), silent);
    const cancellable = await service.create(
      adminA,
      draft(
        f.customer.crmClientId,
        f.product.publicId,
        f.inventoryItemPublicId
      )
    );
    await confirm(
      service,
      adminA,
      cancellable,
      f.categoryPublicId,
      crypto.randomUUID(),
      [52, 53]
    );
    await service.cancel(
      managerA,
      cancellable.publicId,
      "Cliente desistiu antes do envio"
    );
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_financial_entries WHERE client_id=? AND source_public_id=? AND status='cancelled'",
        [adminA.clientId, cancellable.publicId]
      )
    ).toBe(2);

    const racing = await service.create(
      adminA,
      draft(
        f.customer.crmClientId,
        f.product.publicId,
        f.inventoryItemPublicId
      )
    );
    await confirm(service, adminA, racing, f.categoryPublicId);
    const [entries] = await getPool().execute<RowDataPacket[]>(
      "SELECT public_id FROM erp_financial_entries WHERE client_id=? AND source_public_id=?",
      [adminA.clientId, racing.publicId]
    );
    const finance = new FinanceService(new FinanceRepository(), {
      publish: () => undefined,
    });
    const outcomes = await Promise.allSettled([
      finance.settlePartial(
        adminA,
        String(entries[0].public_id),
        f.accountPublicId,
        crypto.randomUUID(),
        50
      ),
      service.cancel(adminA, racing.publicId, "Corrida com recebimento"),
    ]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(
      1
    );
    const detail = await service.detail(adminA, racing.publicId);
    if (detail.status === "cancelled") {
      expect(
        await count(
          "SELECT COUNT(*) total FROM erp_financial_settlements WHERE client_id=?",
          [adminA.clientId]
        )
      ).toBe(0);
    } else {
      expect(detail).toMatchObject({ paymentStatus: "partial", paidCents: 50 });
      await expect(
        service.cancel(adminA, racing.publicId, "Estorno indisponível")
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }
  });

  it("derives pending, partial and paid from real settlements", async () => {
    const f = await fixture();
    const sales = new SaleService(new SaleRepository(), silent);
    const order = await sales.create(
      adminA,
      draft(
        f.customer.crmClientId,
        f.product.publicId,
        f.inventoryItemPublicId
      )
    );
    await confirm(sales, adminA, order, f.categoryPublicId);
    expect(await sales.detail(adminA, order.publicId)).toMatchObject({
      paymentStatus: "pending",
      paidCents: 0,
      balanceCents: 105,
    });
    const [entries] = await getPool().execute<RowDataPacket[]>(
      "SELECT public_id FROM erp_financial_entries WHERE client_id=? AND source_public_id=?",
      [adminA.clientId, order.publicId]
    );
    const finance = new FinanceService(new FinanceRepository(), {
      publish: () => undefined,
    });
    await finance.settlePartial(
      adminA,
      String(entries[0].public_id),
      f.accountPublicId,
      crypto.randomUUID(),
      50
    );
    expect(await sales.detail(adminA, order.publicId)).toMatchObject({
      paymentStatus: "partial",
      paidCents: 50,
      balanceCents: 55,
    });
    await finance.settlePartial(
      adminA,
      String(entries[0].public_id),
      f.accountPublicId,
      crypto.randomUUID(),
      55
    );
    expect(await sales.detail(adminA, order.publicId)).toMatchObject({
      paymentStatus: "paid",
      paidCents: 105,
      balanceCents: 0,
    });
  });

  it("audits address correction and blocks it after shipment", async () => {
    const f = await fixture();
    const service = new SaleService(new SaleRepository(), silent);
    const order = await service.create(
      adminA,
      draft(
        f.customer.crmClientId,
        f.product.publicId,
        f.inventoryItemPublicId
      )
    );
    await confirm(service, adminA, order, f.categoryPublicId);
    const address = {
      recipientName: "Destino corrigido",
      postalCode: "20040002",
      street: "Rua corrigida",
      number: "20",
      complement: "Sala 1",
      district: "Centro",
      city: "Rio de Janeiro",
      state: "RJ",
    };
    const corrected = await service.correctAddress(managerA, {
      publicId: order.publicId,
      shippingAddress: address,
      billingAddress: address,
      reason: "Cliente corrigiu o endereço",
    });
    expect(corrected.shippingAddress).toEqual(address);
    const [events] = await getPool().execute<RowDataPacket[]>(
      "SELECT before_json,after_json,reason FROM erp_sale_order_events WHERE client_id=? AND sale_order_id=? AND event_type='address_corrected'",
      [adminA.clientId, corrected.id]
    );
    expect(events).toHaveLength(1);
    expect(String(events[0].before_json)).toContain("Rua de teste");
    expect(String(events[0].after_json)).toContain("Rua corrigida");
    await transition(service, order.publicId, "separation");
    await transition(service, order.publicId, "shipped");
    await expect(
      service.correctAddress(managerA, {
        publicId: order.publicId,
        shippingAddress: address,
        billingAddress: address,
        reason: "Tentativa tardia",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keeps legacy sales readable without fabricated stage, title or event", async () => {
    const f = await fixture();
    const publicId = crypto.randomUUID();
    await getPool().execute(
      "INSERT INTO erp_sale_orders(public_id,client_id,order_number,crm_client_id,customer_name_snapshot,status,current_stage,subtotal_cents,total_cents,created_by) VALUES(?,?,?,?,?,'fulfilled',NULL,777,777,?)",
      [
        publicId,
        adminA.clientId,
        `LEG-${++serial}`,
        f.customer.crmClientId,
        f.customer.companyName,
        adminA.userId,
      ]
    );
    const detail = await new SaleService(
      new SaleRepository(),
      silent
    ).detail(adminA, publicId);
    expect(detail).toMatchObject({
      status: "fulfilled",
      currentStage: "completed",
      paymentStatus: "pending",
      titleCount: 0,
    });
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_sale_order_events WHERE client_id=? AND sale_order_id=?",
        [adminA.clientId, detail.id]
      )
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) total FROM erp_financial_entries WHERE client_id=? AND source_public_id=?",
        [adminA.clientId, publicId]
      )
    ).toBe(0);
  });
});
