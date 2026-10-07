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
import { FinanceRepository } from "../finance/repository";
import { FinanceService } from "../finance/service";
import { ErpRepository } from "../repository";
import { ErpService } from "../service";
import { VariantService } from "../variants/service";
import {
  saleConfirmationInput,
  saleDraftInput,
} from "./contracts";
import { SaleRepository } from "./repository";
import { SaleService } from "./service";

const physical = describe.runIf(isTestDatabaseEnabled());
const identity = {
  clientId: "sales-ux-v3-physical",
  userId: "sales-ux-v3-manager",
  userName: "Gestora UX V3",
  role: "manager" as const,
};
const tenantB = "sales-ux-v3-other-tenant";
const silent = { publish: () => undefined };

async function clean() {
  const db = getPool();
  const tenants = [identity.clientId, tenantB];
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

physical.sequential("ERP sales UX v3 physical flow", () => {
  beforeAll(() =>
    applyCanonicalMigrations(getTestDatabaseUrl(), MAIN_MIGRATIONS_DIR)
  );
  beforeEach(clean);
  afterAll(clean);

  it("persists searched customer, selected variant, address, freight and financial confirmation", async () => {
    const db = getPool();
    const crmClientId = crypto.randomUUID();
    await db.execute(
      `INSERT INTO megadesk_crm_clients
        (crm_client_id,client_id,company_name,cpf_cnpj,responsible_name,address,city,state,cep,status)
       VALUES(?,?,?,?,?,?,?,?,?,'ativo')`,
      [
        crmClientId,
        identity.clientId,
        "Cliente UX Física",
        "12.345.678/0001-90",
        "Patrícia",
        "Rua Física",
        "São Paulo",
        "SP",
        "01001000",
      ]
    );

    const erp = new ErpService(
      new ErpRepository(),
      undefined,
      silent
    );
    const product = await erp.createProduct(identity, {
      name: "Monitor UX V3",
      sku: "MON-UX-V3",
      barcode: null,
      description: "Fixture física da nova experiência de Vendas",
      category: "Vendas",
      unit: "unit",
      costPriceCents: 75_000,
      salePriceCents: 120_000,
      minimumStock: "0",
    });
    const variant = await new VariantService(
      undefined,
      undefined,
      undefined,
      silent
    ).create(identity, {
      productPublicId: product.publicId,
      sku: "MON-UX-V3-PRETO",
      barcode: null,
      name: "Preto",
      costPriceCents: 76_000,
      salePriceCents: 120_000,
      attributeValuePublicIds: [],
      active: true,
    });
    const [inventoryRows] = await db.execute<RowDataPacket[]>(
      `SELECT i.public_id inventoryItemPublicId
       FROM erp_inventory_items i
       INNER JOIN erp_product_variants v
         ON v.client_id=i.client_id AND v.id=i.variant_id
       WHERE i.client_id=? AND v.public_id=?`,
      [identity.clientId, variant.publicId]
    );
    const inventoryItemPublicId = String(
      inventoryRows[0].inventoryItemPublicId
    );
    await erp.moveStock(identity, {
      productPublicId: product.publicId,
      inventoryItemPublicId,
      type: "manual_in",
      quantity: "10.000",
      reason: "Saldo sintético da jornada UX v3",
      idempotencyKey: crypto.randomUUID(),
    });

    const finance = new FinanceService(new FinanceRepository(), silent);
    const category = await finance.createCategory(identity, {
      name: "Receita UX v3",
      direction: "receivable",
    });
    const account = await finance.createAccount(identity, {
      name: "Banco UX v3",
      type: "bank",
      initialBalanceCents: 0,
      allowNegative: false,
    });
    const sales = new SaleService(new SaleRepository(), silent);

    const customerSearch = await sales.customers(identity, {
      search: "UX Física",
      page: 1,
      pageSize: 12,
    });
    expect(customerSearch.items).toHaveLength(1);
    expect(customerSearch.items[0].crmClientId).toBe(crmClientId);

    const catalogSearch = await sales.catalog(identity, {
      search: "MON-UX-V3-PRETO",
      page: 1,
      pageSize: 12,
    });
    expect(catalogSearch.items).toHaveLength(1);
    expect(catalogSearch.items[0]).toMatchObject({
      productPublicId: product.publicId,
      inventoryItemPublicId,
      variantName: "Preto",
      salePriceCents: 120_000,
    });

    const saleAddress = {
      recipientName: "Patrícia",
      postalCode: "01001000",
      street: "Rua Física",
      number: "125",
      complement: "Sala 9",
      district: "Centro",
      city: "São Paulo",
      state: "SP",
    };
    const order = await sales.create(
      identity,
      saleDraftInput.parse({
        crmClientId,
        notes: "Venda física UX v3",
        expectedDate: "2030-10-15",
        shippingAddress: saleAddress,
        billingAddress: saleAddress,
        orderDiscountCents: 1_000,
        freightCents: 12_590,
        items: [
          {
            productPublicId: product.publicId,
            inventoryItemPublicId,
            quantity: "2.000",
            unitPriceCents: 120_000,
            discountCents: 5_000,
          },
        ],
      })
    );
    expect(order).toMatchObject({
      customerName: "Cliente UX Física",
      subtotalCents: 240_000,
      discountCents: 6_000,
      freightCents: 12_590,
      totalCents: 246_590,
      currentStage: "created",
    });

    const filtered = await sales.list(identity, {
      search: "",
      crmClientId,
      sort: "createdAt",
      direction: "desc",
      page: 1,
      pageSize: 20,
    });
    expect(filtered.items.map(item => item.publicId)).toEqual([
      order.publicId,
    ]);
    const otherTenant = await sales.list(
      { ...identity, clientId: tenantB },
      {
        search: "",
        crmClientId,
        sort: "createdAt",
        direction: "desc",
        page: 1,
        pageSize: 20,
      }
    );
    expect(otherTenant.items).toEqual([]);

    const idempotencyKey = crypto.randomUUID();
    const confirmation = saleConfirmationInput.parse({
      publicId: order.publicId,
      idempotencyKey,
      paymentMethod: "Boleto bancário",
      categoryPublicId: category.publicId,
      financialAccountPublicId: account.publicId,
      installments: [
        { dueDate: "2030-10-15", amountCents: 123_295 },
        { dueDate: "2030-11-15", amountCents: 123_295 },
      ],
    });
    expect(await sales.confirm(identity, confirmation)).toMatchObject({
      currentStage: "confirmed",
      replay: false,
    });
    expect(await sales.confirm(identity, confirmation)).toMatchObject({
      currentStage: "confirmed",
      replay: true,
    });

    const detail = await sales.detail(identity, order.publicId);
    expect(detail).toMatchObject({
      freightCents: 12_590,
      discountCents: 6_000,
      totalCents: 246_590,
      paymentMethod: "Boleto bancário",
      titleCount: 2,
      shippingAddress: saleAddress,
      billingAddress: saleAddress,
    });
    expect(detail.items[0]).toMatchObject({
      productPublicId: product.publicId,
      inventoryItemPublicId,
      variantName: "Preto",
      quantity: "2.000",
    });
    expect(detail.installments.map(item => item.amountCents)).toEqual([
      123_295,
      123_295,
    ]);

    const [financialRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.source_installment,c.public_id categoryPublicId,
              a.public_id accountPublicId
       FROM erp_financial_entries e
       INNER JOIN erp_financial_categories c
         ON c.client_id=e.client_id AND c.id=e.category_id
       LEFT JOIN erp_financial_accounts a
         ON a.client_id=e.client_id AND a.id=e.financial_account_id
       WHERE e.client_id=? AND e.source_type='sales_order'
         AND e.source_public_id=?
       ORDER BY e.source_installment`,
      [identity.clientId, order.publicId]
    );
    expect(financialRows).toHaveLength(2);
    expect(financialRows).toEqual([
      expect.objectContaining({
        source_installment: 1,
        categoryPublicId: category.publicId,
        accountPublicId: account.publicId,
      }),
      expect.objectContaining({
        source_installment: 2,
        categoryPublicId: category.publicId,
        accountPublicId: account.publicId,
      }),
    ]);
  });
});
