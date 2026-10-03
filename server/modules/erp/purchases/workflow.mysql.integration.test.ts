import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { applyCanonicalMigrations, MAIN_MIGRATIONS_DIR } from "../../../_core/canonical-migrations";
import { getPool } from "../../../db";
import { getTestDatabaseUrl, isTestDatabaseEnabled } from "../../../test-integration-gates";
import { ErpRepository } from "../repository";
import { ErpService } from "../service";
import { SupplierRepository } from "../suppliers/repository";
import { SupplierService } from "../suppliers/service";
import { FinanceRepository } from "../finance/repository";
import { FinanceService } from "../finance/service";
import { PurchaseService } from "./service";
import { PurchaseWorkflowRepository } from "./workflow-repository";

const physical = describe.runIf(isTestDatabaseEnabled());
const adminA = { clientId: "purchase-workflow-a", userId: "admin-a", role: "admin" as const, userName: "Ana Compras" };
const adminB = { clientId: "purchase-workflow-b", userId: "admin-b", role: "admin" as const, userName: "Bruno Outro Tenant" };
const purchaseEvents = { publish: () => undefined };
const financeEvents = { publish: () => undefined };

async function cleanup() {
  const db = getPool();
  const clients = [adminA.clientId, adminB.clientId];
  const statements = [
    "DELETE FROM erp_purchase_document_links WHERE client_id IN (?,?)",
    "DELETE FROM erp_purchase_events WHERE client_id IN (?,?)",
    "DELETE l FROM erp_financial_ledger l WHERE l.client_id IN (?,?)",
    "DELETE s FROM erp_financial_settlements s WHERE s.client_id IN (?,?)",
    "DELETE FROM erp_purchase_order_installments WHERE client_id IN (?,?)",
    "DELETE FROM erp_financial_entries WHERE client_id IN (?,?)",
    "DELETE FROM erp_financial_accounts WHERE client_id IN (?,?)",
    "DELETE FROM erp_financial_categories WHERE client_id IN (?,?)",
    "DELETE ri FROM erp_purchase_order_receipt_items ri INNER JOIN erp_purchase_order_receipts r ON r.id=ri.receipt_id WHERE r.client_id IN (?,?)",
    "DELETE FROM erp_purchase_order_receipts WHERE client_id IN (?,?)",
    "DELETE FROM erp_purchase_approvals WHERE client_id IN (?,?)",
    "DELETE h FROM erp_purchase_order_history h INNER JOIN erp_purchase_orders o ON o.id=h.purchase_order_id WHERE o.client_id IN (?,?)",
    "DELETE i FROM erp_purchase_order_items i INNER JOIN erp_purchase_orders o ON o.id=i.purchase_order_id WHERE o.client_id IN (?,?)",
    "DELETE FROM erp_purchase_orders WHERE client_id IN (?,?)",
    "DELETE FROM erp_purchase_quote_proposal_items WHERE proposal_id IN (SELECT id FROM erp_purchase_quote_proposals WHERE client_id IN (?,?))",
    "DELETE FROM erp_purchase_quote_proposals WHERE client_id IN (?,?)",
    "DELETE FROM erp_purchase_quotes WHERE client_id IN (?,?)",
    "DELETE FROM erp_purchase_request_items WHERE client_id IN (?,?)",
    "DELETE FROM erp_purchase_requests WHERE client_id IN (?,?)",
    "DELETE FROM erp_purchase_workflow_sequences WHERE client_id IN (?,?)",
    "DELETE FROM erp_purchase_order_sequences WHERE client_id IN (?,?)",
    "DELETE FROM erp_stock_movements WHERE client_id IN (?,?)",
    "DELETE FROM erp_stock_balances WHERE client_id IN (?,?)",
    "DELETE FROM erp_product_suppliers WHERE client_id IN (?,?)",
    "DELETE FROM erp_product_audit_logs WHERE client_id IN (?,?)",
    "DELETE b FROM erp_inventory_item_balances b INNER JOIN erp_inventory_items i ON i.client_id=b.client_id AND i.id=b.inventory_item_id WHERE i.client_id IN (?,?)",
    "DELETE FROM erp_inventory_items WHERE client_id IN (?,?)",
    "DELETE FROM erp_products WHERE client_id IN (?,?)",
    "DELETE FROM erp_suppliers WHERE client_id IN (?,?)",
  ];
  for (const sql of statements) await db.execute(sql, clients);
}

async function fixture() {
  const supplier = await new SupplierService(new SupplierRepository(), purchaseEvents).create(adminA, {
    legalName: "Fornecedor Workflow Integrado",
    tradeName: "Workflow Integrado",
    personType: "legal",
    taxId: "12345678000195",
    stateRegistration: null,
    email: "compras@example.invalid",
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
  const product = await new ErpService(new ErpRepository()).createProduct(adminA, {
    name: "Produto Workflow Integrado",
    sku: `WF-${Date.now()}`,
    barcode: null,
    description: null,
    category: "Workflow",
    unit: "unit",
    costPriceCents: 0,
    salePriceCents: 0,
    minimumStock: "0",
  });
  return { supplier, product };
}

physical("ERP purchase workflow integration", () => {
  beforeAll(async () => {
    await applyCanonicalMigrations(getTestDatabaseUrl(), MAIN_MIGRATIONS_DIR);
    await cleanup();
  }, 120_000);
  afterAll(cleanup);

  it("runs request, approval, quote, order, AP, partial payments and partial receipts with audit", async () => {
    const { supplier, product } = await fixture();
    const purchases = new PurchaseService(new PurchaseWorkflowRepository(), purchaseEvents);
    const request = await purchases.saveRequest(adminA, {
      department: "Operacoes",
      priority: "high",
      reason: "Reposicao para operacao critica",
      responsibleUserId: null,
      items: [{ productPublicId: product.publicId, inventoryItemPublicId: null, quantity: "2.000", estimatedUnitCostCents: 1_000 }],
    });
    expect(request.requestNumber).toMatch(/^SC-\d{4}-\d{6}$/);
    await purchases.submitRequest(adminA, request.publicId, randomUUID());
    await purchases.decideRequest(adminA, request.publicId, "approved", "Necessidade confirmada", randomUUID());

    const quote = await purchases.createQuote(adminA, request.publicId);
    const withProposal = await purchases.addProposal(adminA, {
      quotePublicId: quote.publicId,
      supplierPublicId: supplier.publicId,
      freightCents: 100,
      leadTimeDays: 3,
      paymentTerms: "Duas parcelas",
      notes: null,
      supplierFilePublicId: null,
      items: [{ requestItemPublicId: request.items[0].publicId, unitCostCents: 1_000, discountCents: 0 }],
    });
    const proposal = withProposal.proposals[0];
    await purchases.selectProposal(adminA, quote.publicId, proposal.publicId);
    const order = await purchases.createFromQuote(adminA, {
      quotePublicId: quote.publicId,
      responsibleUserId: null,
      notes: "Pedido criado pela cotacao",
      expectedDate: "2030-01-10",
      discountCents: 0,
      otherExpensesCents: 0,
      installments: [
        { dueDate: "2030-01-15", amountCents: 1_050 },
        { dueDate: "2030-02-15", amountCents: 1_050 },
      ],
    });
    expect(order).toMatchObject({ sourceType: "quote", totalCents: 2_100, status: "draft" });
    const approved = await purchases.approve(adminA, order.publicId);
    expect(approved.payments).toHaveLength(2);
    expect(approved.financeTotalCents).toBe(2_100);

    const finance = new FinanceService(new FinanceRepository(), financeEvents);
    const account = await finance.createAccount(adminA, {
      name: "Conta teste workflow",
      type: "bank",
      initialBalanceCents: 10_000,
      allowNegative: false,
    });
    const firstPaymentKey = randomUUID();
    const partial = await finance.settlePartial(adminA, approved.payments[0].publicId, account.publicId, firstPaymentKey, 400);
    expect(partial).toMatchObject({ paidCents: 400, pendingCents: 650, paymentStatus: "partially_paid", replay: false });
    expect(await finance.summary(adminA, {})).toMatchObject({ openPayable: 1_700, settledPayable: 400 });
    await expect(finance.cancel(adminA, approved.payments[0].publicId, "Cancelar titulo parcialmente pago"))
      .rejects.toMatchObject({ code: "CONFLICT" });
    const replay = await finance.settlePartial(adminA, approved.payments[0].publicId, account.publicId, firstPaymentKey, 400);
    expect(replay.replay).toBe(true);
    await finance.settlePartial(adminA, approved.payments[0].publicId, account.publicId, randomUUID(), 650);

    const item = approved.items[0];
    const partialReceipt = await purchases.receive(adminA, {
      publicId: order.publicId,
      idempotencyKey: randomUUID(),
      notes: "Primeira entrega",
      documentNumber: "NF-1",
      items: [{ orderItemPublicId: item.publicId, quantity: "0.750" }],
    }) as any;
    expect(partialReceipt).toMatchObject({ receiptStatus: "partial", receiptProgress: 38 });
    const finalKey = randomUUID();
    const concurrent = await Promise.all([
      purchases.receive(adminA, { publicId: order.publicId, idempotencyKey: finalKey, notes: null, documentNumber: "NF-2", items: [{ orderItemPublicId: item.publicId, quantity: "1.250" }] }),
      purchases.receive(adminA, { publicId: order.publicId, idempotencyKey: finalKey, notes: null, documentNumber: "NF-2", items: [{ orderItemPublicId: item.publicId, quantity: "1.250" }] }),
    ]);
    expect(concurrent.map(result => (result as any).replay).sort()).toEqual([false, true]);
    await expect(
      purchases.receive(adminA, {
        publicId: order.publicId,
        idempotencyKey: finalKey,
        notes: null,
        documentNumber: "OUTRO-DOCUMENTO",
        items: [{ orderItemPublicId: item.publicId, quantity: "1.250" }],
      })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const detail = await purchases.detail(adminA, order.publicId) as any;
    expect(detail).toMatchObject({ status: "received", receiptStatus: "received", receiptProgress: 100 });
    expect(detail.timeline.filter((event: any) => event.action === "payment_registered")).toHaveLength(2);
    expect(detail.timeline.map((event: any) => event.action)).toEqual(expect.arrayContaining(["order_confirmed", "financial_entries_generated", "receipt_partial", "receipt_completed", "stock_entries_generated"]));
    await expect(purchases.detail(adminB, order.publicId)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const [stock] = await getPool().execute<RowDataPacket[]>(
      "SELECT quantity FROM erp_stock_balances b INNER JOIN erp_products p ON p.id=b.product_id AND p.client_id=b.client_id WHERE b.client_id=? AND p.public_id=?",
      [adminA.clientId, product.publicId]
    );
    expect(String(stock[0].quantity)).toBe("2.000");
  });

  it("deduplicates concurrent direct-order creation per tenant", async () => {
    const [supplier] = await getPool().execute<RowDataPacket[]>("SELECT public_id FROM erp_suppliers WHERE client_id=? LIMIT 1", [adminA.clientId]);
    const [product] = await getPool().execute<RowDataPacket[]>("SELECT public_id FROM erp_products WHERE client_id=? LIMIT 1", [adminA.clientId]);
    const service = new PurchaseService(new PurchaseWorkflowRepository(), purchaseEvents);
    const idempotencyKey = randomUUID();
    const command = {
      supplierPublicId: String(supplier[0].public_id),
      idempotencyKey,
      responsibleUserId: null,
      notes: null,
      expectedDate: null,
      discountCents: 0,
      freightCents: 0,
      otherExpensesCents: 0,
      paymentTerms: null,
      installments: [],
      items: [{ productPublicId: String(product[0].public_id), inventoryItemPublicId: null, quantity: "1.000", unitCostCents: 100, discountCents: 0 }],
    };
    const results = await Promise.all([service.create(adminA, command), service.create(adminA, command)]);
    expect(new Set(results.map(result => result.publicId)).size).toBe(1);
    expect(results.map(result => result.replay).sort()).toEqual([false, true]);
    await expect(
      service.create(adminA, {
        ...command,
        items: [{ ...command.items[0], unitCostCents: 101 }],
      })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("keeps a newly-created supplier draft in canonical history and opens draft and confirmed details", async () => {
    const suppliers = new SupplierService(new SupplierRepository(), purchaseEvents);
    const products = new ErpService(new ErpRepository());
    const supplier = await suppliers.create(adminA, {
      legalName: "Fornecedor Historico Draft",
      tradeName: "Historico Draft",
      personType: "legal",
      taxId: "42345678000195",
      stateRegistration: null,
      email: "historico@example.invalid",
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
    const product = await products.createProduct(adminA, {
      name: "Produto Historico Draft",
      sku: "WF-HISTORY-DRAFT",
      barcode: null,
      description: null,
      category: "Workflow",
      unit: "unit",
      costPriceCents: 7300,
      salePriceCents: 0,
      minimumStock: "0",
    });
    const purchases = new PurchaseService(
      new PurchaseWorkflowRepository(),
      purchaseEvents
    );
    const order = await purchases.create(adminA, {
      supplierPublicId: supplier.publicId,
      idempotencyKey: randomUUID(),
      responsibleUserId: null,
      notes: null,
      expectedDate: null,
      discountCents: 0,
      freightCents: 0,
      otherExpensesCents: 0,
      paymentTerms: null,
      installments: [{ dueDate: "2030-10-10", amountCents: 7300 }],
      items: [
        {
          productPublicId: product.publicId,
          inventoryItemPublicId: null,
          quantity: "1.000",
          unitCostCents: 7300,
          discountCents: 0,
        },
      ],
    });

    const history = await purchases.list(adminA, {
      search: "",
      supplierPublicId: supplier.publicId,
      sort: "createdAt",
      direction: "desc",
      page: 1,
      pageSize: 20,
    });
    expect(history.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ publicId: order.publicId, status: "draft" }),
      ])
    );
    expect(
      await purchases.list(adminB, {
        search: "",
        supplierPublicId: supplier.publicId,
        sort: "createdAt",
        direction: "desc",
        page: 1,
        pageSize: 20,
      })
    ).toMatchObject({ items: [], total: 0 });

    const draftDetail = (await purchases.detail(adminA, order.publicId)) as any;
    expect(draftDetail).toMatchObject({
      status: "draft",
      expectedDate: null,
      receiptStatus: "awaiting",
      financialStatus: "not_launched",
    });
    expect(draftDetail.items[0]).toMatchObject({
      productPublicId: product.publicId,
      unit: "unit",
      pendingQuantity: "1.000",
    });
    expect(draftDetail.receipts).toEqual([]);
    expect(draftDetail.payments).toEqual([]);
    expect(draftDetail.installments).toEqual([
      { installmentNumber: 1, dueDate: "2030-10-10", amountCents: 7300 },
    ]);
    await expect(purchases.detail(adminB, order.publicId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(purchases.detail(adminA, randomUUID())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const confirmed = (await purchases.approve(adminA, order.publicId)) as any;
    expect(confirmed).toMatchObject({ status: "approved" });
    expect(confirmed.items).toHaveLength(1);
    expect(confirmed.receipts).toEqual([]);
  });

  it("serializes concurrent approvals without duplicating the decision or audit", async () => {
    const [products] = await getPool().execute<RowDataPacket[]>(
      "SELECT public_id FROM erp_products WHERE client_id=? LIMIT 1",
      [adminA.clientId]
    );
    const service = new PurchaseService(new PurchaseWorkflowRepository(), purchaseEvents);
    const request = await service.saveRequest(adminA, {
      department: "Operacoes",
      priority: "normal",
      reason: "Validar aprovacao concorrente",
      responsibleUserId: null,
      items: [{
        productPublicId: String(products[0].public_id),
        inventoryItemPublicId: null,
        quantity: "1.000",
        estimatedUnitCostCents: 100,
      }],
    });
    await service.submitRequest(adminA, request.publicId, randomUUID());

    const results = await Promise.all([
      service.decideRequest(adminA, request.publicId, "approved", "Aprovado", randomUUID()),
      service.decideRequest(adminA, request.publicId, "approved", "Aprovado", randomUUID()),
    ]);
    expect(results.map(result => result.replay).sort()).toEqual([false, true]);

    const [approvals] = await getPool().execute<RowDataPacket[]>(
      "SELECT COUNT(*) total, SUM(status='approved') approved FROM erp_purchase_approvals WHERE client_id=? AND purchase_request_id=(SELECT id FROM erp_purchase_requests WHERE client_id=? AND public_id=?)",
      [adminA.clientId, adminA.clientId, request.publicId]
    );
    const [events] = await getPool().execute<RowDataPacket[]>(
      "SELECT COUNT(*) total FROM erp_purchase_events WHERE client_id=? AND entity_public_id=? AND action='request_approved'",
      [adminA.clientId, request.publicId]
    );
    expect(approvals[0]).toMatchObject({ total: 1, approved: "1" });
    expect(Number(events[0].total)).toBe(1);

    const [suppliers] = await getPool().execute<RowDataPacket[]>(
      "SELECT public_id FROM erp_suppliers WHERE client_id=? LIMIT 1",
      [adminA.clientId]
    );
    await service.createFromRequest(adminA, {
      requestPublicId: request.publicId,
      supplierPublicId: String(suppliers[0].public_id),
      idempotencyKey: randomUUID(),
      responsibleUserId: null,
      notes: null,
      expectedDate: null,
      discountCents: 0,
      freightCents: 0,
      otherExpensesCents: 0,
      paymentTerms: null,
      installments: [],
      items: [{
        productPublicId: String(products[0].public_id),
        inventoryItemPublicId: null,
        quantity: "1.000",
        unitCostCents: 100,
        discountCents: 0,
      }],
    });
    await expect(service.createQuote(adminA, request.publicId)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("persists rejected and cancelled request histories with tenant isolation", async () => {
    const [products] = await getPool().execute<RowDataPacket[]>(
      "SELECT public_id FROM erp_products WHERE client_id=? LIMIT 1",
      [adminA.clientId]
    );
    const service = new PurchaseService(new PurchaseWorkflowRepository(), purchaseEvents);
    const draft = {
      department: "Operacoes",
      priority: "normal" as const,
      reason: "Validar decisões auditáveis",
      responsibleUserId: null,
      items: [{
        productPublicId: String(products[0].public_id),
        inventoryItemPublicId: null,
        quantity: "1.000",
        estimatedUnitCostCents: 100,
      }],
    };

    const rejected = await service.saveRequest(adminA, draft);
    await service.submitRequest(adminA, rejected.publicId, randomUUID());
    const rejectedResult = await service.decideRequest(
      adminA,
      rejected.publicId,
      "rejected",
      "Compra não autorizada",
      randomUUID()
    );
    expect(rejectedResult.status).toBe("rejected");
    expect(rejectedResult.timeline.map((event: any) => event.action)).toContain("request_rejected");

    const cancelled = await service.saveRequest(adminA, { ...draft, reason: "Cancelar necessidade obsoleta" });
    const cancelledResult = await service.cancelRequest(adminA, cancelled.publicId, "Necessidade encerrada");
    expect(cancelledResult.status).toBe("cancelled");
    expect(cancelledResult.timeline.map((event: any) => event.action)).toContain("request_cancelled");
    await expect(service.requestDetail(adminB, cancelled.publicId)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const editable = await service.saveRequest(adminA, { ...draft, reason: "Snapshot compacto inicial" });
    await service.saveRequest(adminA, { ...draft, reason: "Snapshot compacto revisado" }, editable.publicId);
    const [snapshots] = await getPool().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total
       FROM erp_purchase_events
       WHERE client_id=? AND entity_public_id=? AND action='request_updated'
         AND (JSON_CONTAINS_PATH(before_json,'one','$.timeline') OR JSON_CONTAINS_PATH(after_json,'one','$.timeline'))`,
      [adminA.clientId, editable.publicId]
    );
    expect(Number(snapshots[0].total)).toBe(0);
  });

  it("cancels effect-free orders and blocks cancellation after payment or receipt", async () => {
    const [suppliers] = await getPool().execute<RowDataPacket[]>(
      "SELECT public_id FROM erp_suppliers WHERE client_id=? LIMIT 1",
      [adminA.clientId]
    );
    const [products] = await getPool().execute<RowDataPacket[]>(
      "SELECT public_id FROM erp_products WHERE client_id=? LIMIT 1",
      [adminA.clientId]
    );
    const [accounts] = await getPool().execute<RowDataPacket[]>(
      "SELECT public_id FROM erp_financial_accounts WHERE client_id=? LIMIT 1",
      [adminA.clientId]
    );
    const purchases = new PurchaseService(new PurchaseWorkflowRepository(), purchaseEvents);
    const finance = new FinanceService(new FinanceRepository(), financeEvents);
    const command = () => ({
      supplierPublicId: String(suppliers[0].public_id),
      idempotencyKey: randomUUID(),
      responsibleUserId: null,
      notes: null,
      expectedDate: null,
      discountCents: 0,
      freightCents: 0,
      otherExpensesCents: 0,
      paymentTerms: null,
      installments: [],
      items: [{
        productPublicId: String(products[0].public_id),
        inventoryItemPublicId: null,
        quantity: "1.000",
        unitCostCents: 100,
        discountCents: 0,
      }],
    });

    const effectFree = await purchases.create(adminA, command());
    const cancelled = await purchases.cancel(adminA, effectFree.publicId, "Pedido criado em duplicidade") as any;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.timeline.map((event: any) => event.action)).toContain("order_cancelled");

    const paid = await purchases.create(adminA, command());
    const paidApproved = await purchases.approve(adminA, paid.publicId) as any;
    await finance.settlePartial(
      adminA,
      paidApproved.payments[0].publicId,
      String(accounts[0].public_id),
      randomUUID(),
      50
    );
    await expect(purchases.cancel(adminA, paid.publicId, "Cancelar após pagamento"))
      .rejects.toMatchObject({ code: "CONFLICT" });

    const received = await purchases.create(adminA, command());
    const receivedApproved = await purchases.approve(adminA, received.publicId) as any;
    await purchases.receive(adminA, {
      publicId: received.publicId,
      idempotencyKey: randomUUID(),
      notes: null,
      documentNumber: null,
      items: [{ orderItemPublicId: receivedApproved.items[0].publicId, quantity: "1.000" }],
    });
    await expect(purchases.cancel(adminA, received.publicId, "Cancelar após recebimento"))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("closes an unreceived balance without rewriting stock or paid ledger", async () => {
    const [supplier] = await getPool().execute<RowDataPacket[]>("SELECT public_id FROM erp_suppliers WHERE client_id=? LIMIT 1", [adminA.clientId]);
    const [product] = await getPool().execute<RowDataPacket[]>("SELECT public_id FROM erp_products WHERE client_id=? LIMIT 1", [adminA.clientId]);
    const service = new PurchaseService(new PurchaseWorkflowRepository(), purchaseEvents);
    const order = await service.create(adminA, {
      supplierPublicId: String(supplier[0].public_id),
      idempotencyKey: randomUUID(),
      responsibleUserId: null,
      notes: "Encerramento parcial",
      expectedDate: "2030-03-10",
      discountCents: 0,
      freightCents: 0,
      otherExpensesCents: 0,
      paymentTerms: null,
      installments: [],
      items: [{ productPublicId: String(product[0].public_id), inventoryItemPublicId: null, quantity: "3.000", unitCostCents: 100, discountCents: 0 }],
    });
    const approved = await service.approve(adminA, order.publicId) as any;
    await service.receive(adminA, {
      publicId: order.publicId,
      idempotencyKey: randomUUID(),
      notes: null,
      documentNumber: null,
      items: [{ orderItemPublicId: approved.items[0].publicId, quantity: "1.000" }],
    });
    const closed = await service.closeBalance(adminA, {
      publicId: order.publicId,
      reason: "Fornecedor nao entregara o saldo",
      discountCents: 0,
      freightCents: 0,
      otherExpensesCents: 0,
    }) as any;
    expect(closed).toMatchObject({ status: "received", totalCents: 100, receiptProgress: 100 });
    expect(closed.items[0]).toMatchObject({ quantity: "1.000", receivedQuantity: "1.000", pendingQuantity: "0.000" });
    expect(closed.payments[0]).toMatchObject({ amountCents: 100, paidCents: 0 });
    expect(closed.timeline.map((event: any) => event.action)).toContain("order_balance_closed");
  });

  it("serializes concurrent request conversion into exactly one order", async () => {
    const [suppliers] = await getPool().execute<RowDataPacket[]>(
      "SELECT public_id FROM erp_suppliers WHERE client_id=? LIMIT 1",
      [adminA.clientId]
    );
    const [products] = await getPool().execute<RowDataPacket[]>(
      "SELECT public_id FROM erp_products WHERE client_id=? LIMIT 1",
      [adminA.clientId]
    );
    const supplierPublicId = String(suppliers[0].public_id);
    const productPublicId = String(products[0].public_id);
    const service = new PurchaseService(new PurchaseWorkflowRepository(), purchaseEvents);
    const request = await service.saveRequest(adminA, {
      department: "Operacoes",
      priority: "high",
      reason: "Conversao concorrente",
      responsibleUserId: null,
      items: [{ productPublicId, inventoryItemPublicId: null, quantity: "1.000", estimatedUnitCostCents: 100 }],
    });
    await service.submitRequest(adminA, request.publicId, randomUUID());
    await service.decideRequest(adminA, request.publicId, "approved", "Aprovado", randomUUID());
    const command = {
      requestPublicId: request.publicId,
      supplierPublicId,
      responsibleUserId: null,
      notes: null,
      expectedDate: null,
      discountCents: 0,
      freightCents: 0,
      otherExpensesCents: 0,
      paymentTerms: null,
      installments: [],
      items: [{ productPublicId, inventoryItemPublicId: null, quantity: "1.000", unitCostCents: 100, discountCents: 0 }],
    };
    const attempts = await Promise.allSettled([
      service.createFromRequest(adminA, { ...command, idempotencyKey: randomUUID() }),
      service.createFromRequest(adminA, { ...command, idempotencyKey: randomUUID() }),
    ]);
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(result => result.status === "rejected")).toHaveLength(1);
    const [orders] = await getPool().execute<RowDataPacket[]>(
      "SELECT COUNT(*) total FROM erp_purchase_orders WHERE client_id=? AND purchase_request_id=(SELECT id FROM erp_purchase_requests WHERE client_id=? AND public_id=?)",
      [adminA.clientId, adminA.clientId, request.publicId]
    );
    expect(Number(orders[0].total)).toBe(1);
  });

  it("serializes competing proposal selections", async () => {
    const [products] = await getPool().execute<RowDataPacket[]>(
      "SELECT public_id FROM erp_products WHERE client_id=? LIMIT 1",
      [adminA.clientId]
    );
    const productPublicId = String(products[0].public_id);
    const suppliers = new SupplierService(new SupplierRepository(), purchaseEvents);
    const supplierA = await suppliers.create(adminA, {
      legalName: "Fornecedor disputa A",
      tradeName: null,
      personType: "legal",
      taxId: "22345678000195",
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
    const supplierB = await suppliers.create(adminA, {
      legalName: "Fornecedor disputa B",
      tradeName: null,
      personType: "legal",
      taxId: "32345678000195",
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
    const service = new PurchaseService(new PurchaseWorkflowRepository(), purchaseEvents);
    const request = await service.saveRequest(adminA, {
      department: "Operacoes",
      priority: "normal",
      reason: "Selecao concorrente",
      responsibleUserId: null,
      items: [{ productPublicId, inventoryItemPublicId: null, quantity: "1.000", estimatedUnitCostCents: 100 }],
    });
    await service.submitRequest(adminA, request.publicId, randomUUID());
    await service.decideRequest(adminA, request.publicId, "approved", "Aprovado", randomUUID());
    const quote = await service.createQuote(adminA, request.publicId);
    const proposals = [];
    for (const [supplier, unitCostCents] of [[supplierA, 100], [supplierB, 101]] as const) {
      const detail = await service.addProposal(adminA, {
        quotePublicId: quote.publicId,
        supplierPublicId: supplier.publicId,
        freightCents: 0,
        leadTimeDays: 1,
        paymentTerms: null,
        notes: null,
        supplierFilePublicId: null,
        items: [{ requestItemPublicId: request.items[0].publicId, unitCostCents, discountCents: 0 }],
      });
      proposals.push(detail.proposals.find((proposal: any) => proposal.supplierPublicId === supplier.publicId));
    }
    const attempts = await Promise.allSettled([
      service.selectProposal(adminA, quote.publicId, proposals[0].publicId),
      service.selectProposal(adminA, quote.publicId, proposals[1].publicId),
    ]);
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(result => result.status === "rejected")).toHaveLength(1);
    const selected = await service.quoteDetail(adminA, quote.publicId);
    expect(selected.proposals.filter((proposal: any) => proposal.selected)).toHaveLength(1);
  });
});
