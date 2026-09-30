import { createHash, randomUUID } from "node:crypto";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { getPool } from "../../../db";
import { hasDuplicateResolvedInventoryItem, millisQuantity, quantityMillis } from "../contracts";
import { ErpDomainError } from "../errors";
import { InventoryRepository } from "../inventory/repository";
import {
  lineTotalCents,
  purchaseTotalCents,
  sumMoneyCents,
  type PurchaseDraftInput,
  type PurchaseListInput,
  type PurchaseRequestDraftInput,
  type PurchaseRequestListInput,
  type QuoteProposalInput,
  type QuoteToOrderInput,
  type ReceiveInput,
  type RequestToOrderInput,
} from "./domain-contracts";

export type PurchaseActor = {
  clientId: string;
  userId: string;
  role: "admin" | "manager" | "agent" | "viewer";
  userName?: string;
};

type EventEntity = {
  requestId?: number | null;
  quoteId?: number | null;
  orderId?: number | null;
  entityType: "request" | "quote" | "order" | "receipt" | "financial" | "stock" | "document";
  entityPublicId: string;
};
type EventInput = EventEntity & {
  action: string;
  summary: string;
  actor?: PurchaseActor | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  correlationId?: string | null;
};

const bounded = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.trunc(value)));
const parseJson = (value: unknown) => {
  if (value === null || value === undefined || typeof value === "object") return value ?? null;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
};
const dateOnly = (value: unknown) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null;
const isDuplicateKey = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
const safeMoneySum = (values: readonly number[]) => {
  try {
    return sumMoneyCents(values);
  } catch (error) {
    throw new ErpDomainError("VALIDATION", error instanceof Error ? error.message : "Total monetario invalido.");
  }
};
const safePurchaseTotal = (
  subtotalCents: number,
  discountCents: number,
  freightCents: number,
  otherExpensesCents: number
) => {
  try {
    return purchaseTotalCents(subtotalCents, discountCents, freightCents, otherExpensesCents);
  } catch (error) {
    throw new ErpDomainError("VALIDATION", error instanceof Error ? error.message : "Total monetario invalido.");
  }
};
const compactRequestSnapshot = (value: unknown) => {
  if (!value || typeof value !== "object") return value;
  const { timeline: _timeline, capabilities: _capabilities, replay: _replay, ...snapshot } = value as Record<string, unknown>;
  return snapshot;
};
const compactOrderSnapshot = (value: unknown) => {
  if (!value || typeof value !== "object") return value;
  const {
    timeline: _timeline,
    history: _history,
    documents: _documents,
    receipts: _receipts,
    payments: _payments,
    capabilities: _capabilities,
    canWrite: _canWrite,
    replay: _replay,
    ...snapshot
  } = value as Record<string, unknown>;
  return snapshot;
};

export class PurchaseWorkflowRepository {
  constructor(private pool?: Pool) {}
  private db() {
    return (this.pool ??= getPool());
  }
  private inventory() {
    return new InventoryRepository(this.db());
  }

  private async actorName(connection: PoolConnection, actor: PurchaseActor) {
    if (actor.userName?.trim()) return actor.userName.trim().slice(0, 180);
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT COALESCE(name,email) display_name FROM megadesk_domain_client_users WHERE client_id=? AND user_id=? LIMIT 1",
      [actor.clientId, actor.userId]
    );
    return String(rows[0]?.display_name ?? "Usuário indisponível").slice(0, 180);
  }

  private async event(connection: PoolConnection, input: EventInput) {
    const name = input.actor ? await this.actorName(connection, input.actor) : null;
    await connection.execute(
      `INSERT INTO erp_purchase_events
       (public_id,client_id,purchase_request_id,purchase_quote_id,purchase_order_id,entity_type,entity_public_id,action,actor_type,actor_user_id,actor_name_snapshot,actor_role,summary,before_json,after_json,metadata_json,correlation_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        randomUUID(),
        input.actor?.clientId ?? (input.metadata as { clientId?: string } | undefined)?.clientId,
        input.requestId ?? null,
        input.quoteId ?? null,
        input.orderId ?? null,
        input.entityType,
        input.entityPublicId,
        input.action,
        input.actor ? "human" : "system",
        input.actor?.userId ?? null,
        name,
        input.actor?.role ?? null,
        input.summary.slice(0, 500),
        input.before === undefined ? null : JSON.stringify(input.before),
        input.after === undefined ? null : JSON.stringify(input.after),
        input.metadata === undefined ? null : JSON.stringify(input.metadata),
        input.correlationId ?? null,
      ]
    );
  }

  private async nextNumber(
    connection: PoolConnection,
    clientId: string,
    entityType: "request" | "quote"
  ) {
    const year = new Date().getUTCFullYear();
    await connection.execute(
      "INSERT IGNORE INTO erp_purchase_workflow_sequences(client_id,entity_type,year,next_number) VALUES(?,?,?,1)",
      [clientId, entityType, year]
    );
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT next_number FROM erp_purchase_workflow_sequences WHERE client_id=? AND entity_type=? AND year=? FOR UPDATE",
      [clientId, entityType, year]
    );
    const next = Number(rows[0].next_number);
    await connection.execute(
      "UPDATE erp_purchase_workflow_sequences SET next_number=? WHERE client_id=? AND entity_type=? AND year=?",
      [next + 1, clientId, entityType, year]
    );
    return `${entityType === "request" ? "SC" : "CQ"}-${year}-${String(next).padStart(6, "0")}`;
  }

  private async nextOrderNumber(connection: PoolConnection, clientId: string) {
    const year = new Date().getUTCFullYear();
    await connection.execute(
      "INSERT IGNORE INTO erp_purchase_order_sequences(client_id,year,next_number) VALUES(?,?,1)",
      [clientId, year]
    );
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT next_number FROM erp_purchase_order_sequences WHERE client_id=? AND year=? FOR UPDATE",
      [clientId, year]
    );
    const next = Number(rows[0].next_number);
    await connection.execute(
      "UPDATE erp_purchase_order_sequences SET next_number=? WHERE client_id=? AND year=?",
      [next + 1, clientId, year]
    );
    return `PO-${year}-${String(next).padStart(6, "0")}`;
  }

  private async requestRow(
    executor: Pool | PoolConnection,
    clientId: string,
    publicId: string,
    lock = false
  ) {
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT r.*,
              COALESCE(u_requester.name,u_requester.email,'Usuário indisponível') requester_name,
              COALESCE(u_created.name,u_created.email,'Usuário indisponível') created_by_name,
              COALESCE(u_responsible.name,u_responsible.email) responsible_name
       FROM erp_purchase_requests r
       LEFT JOIN megadesk_domain_client_users u_requester ON u_requester.client_id=r.client_id AND u_requester.user_id=r.requester_user_id
       LEFT JOIN megadesk_domain_client_users u_created ON u_created.client_id=r.client_id AND u_created.user_id=r.created_by
       LEFT JOIN megadesk_domain_client_users u_responsible ON u_responsible.client_id=r.client_id AND u_responsible.user_id=r.responsible_user_id
       WHERE r.client_id=? AND r.public_id=? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, publicId]
    );
    return rows[0] ?? null;
  }

  private async assertOrderReplay(
    executor: Pool | PoolConnection,
    clientId: string,
    publicId: string,
    input: PurchaseDraftInput,
    sourceType: "direct" | "request" | "quote" = "direct"
  ) {
    const [orders] = await executor.execute<RowDataPacket[]>(
      `SELECT o.*,s.public_id supplier_public_id
       FROM erp_purchase_orders o
       INNER JOIN erp_suppliers s ON s.id=o.supplier_id AND s.client_id=o.client_id
       WHERE o.client_id=? AND o.public_id=? LIMIT 1`,
      [clientId, publicId]
    );
    const order = orders[0];
    if (!order) throw new ErpDomainError("NOT_FOUND", "Pedido idempotente nao encontrado.");
    const [items] = await executor.execute<RowDataPacket[]>(
      `SELECT p.public_id product_public_id,ii.public_id inventory_item_public_id,
              i.quantity,i.unit_cost_cents,i.discount_cents
       FROM erp_purchase_order_items i
       INNER JOIN erp_products p ON p.id=i.product_id AND p.client_id=?
       LEFT JOIN erp_inventory_items ii ON ii.id=i.inventory_item_id AND ii.client_id=?
       WHERE i.purchase_order_id=? ORDER BY i.id`,
      [clientId, clientId, order.id]
    );
    const [installments] = await executor.execute<RowDataPacket[]>(
      `SELECT due_date,amount_cents FROM erp_purchase_order_installments
       WHERE client_id=? AND purchase_order_id=? ORDER BY installment_number`,
      [clientId, order.id]
    );
    const sameHeader =
      String(order.source_type) === sourceType &&
      String(order.supplier_public_id) === input.supplierPublicId &&
      (order.responsible_user_id ? String(order.responsible_user_id) : null) === (input.responsibleUserId ?? null) &&
      (order.notes === null ? null : String(order.notes)) === (input.notes ?? null) &&
      dateOnly(order.expected_date) === (input.expectedDate ?? null) &&
      Number(order.discount_cents) === input.discountCents &&
      Number(order.freight_cents) === input.freightCents &&
      Number(order.other_expenses_cents) === input.otherExpensesCents &&
      (order.payment_terms === null ? null : String(order.payment_terms)) === (input.paymentTerms ?? null);
    const sameItems =
      items.length === input.items.length &&
      items.every((item, index) => {
        const requested = input.items[index];
        return (
          String(item.product_public_id) === requested.productPublicId &&
          (!requested.inventoryItemPublicId || String(item.inventory_item_public_id) === requested.inventoryItemPublicId) &&
          quantityMillis(String(item.quantity)) === quantityMillis(requested.quantity) &&
          Number(item.unit_cost_cents) === requested.unitCostCents &&
          Number(item.discount_cents) === requested.discountCents
        );
      });
    const sameInstallments =
      installments.length === input.installments.length &&
      installments.every((installment, index) =>
        dateOnly(installment.due_date) === input.installments[index].dueDate &&
        Number(installment.amount_cents) === input.installments[index].amountCents
      );
    if (!sameHeader || !sameItems || !sameInstallments) {
      throw new ErpDomainError(
        "IDEMPOTENCY_CONFLICT",
        "Chave idempotente ja usada com outro conteudo de pedido."
      );
    }
  }

  private async receiptReplay(
    executor: Pool | PoolConnection,
    clientId: string,
    input: ReceiveInput
  ) {
    const [receipts] = await executor.execute<RowDataPacket[]>(
      `SELECT r.id,r.notes,r.document_number,o.public_id order_public_id
       FROM erp_purchase_order_receipts r
       INNER JOIN erp_purchase_orders o ON o.id=r.purchase_order_id AND o.client_id=r.client_id
       WHERE r.client_id=? AND r.idempotency_key=? LIMIT 1`,
      [clientId, input.idempotencyKey]
    );
    const receipt = receipts[0];
    if (!receipt) return null;
    const [items] = await executor.execute<RowDataPacket[]>(
      `SELECT oi.public_id order_item_public_id,ri.quantity
       FROM erp_purchase_order_receipt_items ri
       INNER JOIN erp_purchase_order_items oi ON oi.id=ri.purchase_order_item_id
       WHERE ri.receipt_id=? ORDER BY oi.public_id`,
      [receipt.id]
    );
    const requested = [...input.items].sort((left, right) =>
      left.orderItemPublicId.localeCompare(right.orderItemPublicId)
    );
    const same =
      String(receipt.order_public_id) === input.publicId &&
      (receipt.notes === null ? null : String(receipt.notes)) === (input.notes ?? null) &&
      (receipt.document_number === null ? null : String(receipt.document_number)) === (input.documentNumber ?? null) &&
      items.length === requested.length &&
      items.every((item, index) =>
        String(item.order_item_public_id) === requested[index].orderItemPublicId &&
        quantityMillis(String(item.quantity)) === quantityMillis(requested[index].quantity)
      );
    if (!same) {
      throw new ErpDomainError(
        "IDEMPOTENCY_CONFLICT",
        "Chave idempotente ja usada com outro conteudo de recebimento."
      );
    }
    return String(receipt.order_public_id);
  }

  private requestPublic(row: RowDataPacket) {
    return {
      publicId: String(row.public_id),
      requestNumber: String(row.request_number),
      requesterUserId: String(row.requester_user_id),
      requesterName: String(row.requester_name ?? "Usuário indisponível"),
      responsibleUserId: row.responsible_user_id ? String(row.responsible_user_id) : null,
      responsibleName: row.responsible_name ? String(row.responsible_name) : null,
      department: row.department ? String(row.department) : null,
      priority: String(row.priority),
      reason: String(row.reason),
      status: String(row.status),
      approvalRequestedAt: row.approval_requested_at ?? null,
      decidedAt: row.decided_at ?? null,
      decisionReason: row.decision_reason ?? null,
      createdByName: String(row.created_by_name ?? "Usuário indisponível"),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listRequests(clientId: string, options: PurchaseRequestListInput) {
    const limit = bounded(options.pageSize, 1, 100);
    const offset = (bounded(options.page, 1, Number.MAX_SAFE_INTEGER) - 1) * limit;
    const where = ["r.client_id=?"];
    const values: Array<string | number> = [clientId];
    if (options.search) {
      where.push(`(r.request_number LIKE ? OR r.reason LIKE ? OR r.department LIKE ? OR
        EXISTS(SELECT 1 FROM erp_purchase_request_items ri WHERE ri.purchase_request_id=r.id AND (ri.description_snapshot LIKE ? OR ri.sku_snapshot LIKE ?)) OR
        EXISTS(SELECT 1 FROM megadesk_domain_client_users u WHERE u.client_id=r.client_id AND u.user_id IN (r.requester_user_id,r.created_by,r.responsible_user_id) AND (u.name LIKE ? OR u.email LIKE ?)))`);
      const search = `%${options.search}%`;
      values.push(search, search, search, search, search, search, search);
    }
    if (options.status) {
      where.push("r.status=?");
      values.push(options.status);
    }
    if (options.priority) {
      where.push("r.priority=?");
      values.push(options.priority);
    }
    if (options.from) {
      where.push("DATE(r.created_at)>=?");
      values.push(options.from);
    }
    if (options.to) {
      where.push("DATE(r.created_at)<=?");
      values.push(options.to);
    }
    const clause = where.join(" AND ");
    const [count] = await this.db().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_purchase_requests r WHERE ${clause}`,
      values
    );
    const [rows] = await this.db().execute<RowDataPacket[]>(
      `SELECT r.*,
              COALESCE(u_requester.name,u_requester.email,'Usuário indisponível') requester_name,
              COALESCE(u_created.name,u_created.email,'Usuário indisponível') created_by_name,
              COALESCE(u_responsible.name,u_responsible.email) responsible_name,
              (SELECT COUNT(*) FROM erp_purchase_request_items ri WHERE ri.purchase_request_id=r.id) item_count,
              EXISTS(SELECT 1 FROM erp_purchase_orders po WHERE po.purchase_request_id=r.id) converted_to_order,
              EXISTS(SELECT 1 FROM erp_purchase_quotes q WHERE q.purchase_request_id=r.id) has_quote
       FROM erp_purchase_requests r
       LEFT JOIN megadesk_domain_client_users u_requester ON u_requester.client_id=r.client_id AND u_requester.user_id=r.requester_user_id
       LEFT JOIN megadesk_domain_client_users u_created ON u_created.client_id=r.client_id AND u_created.user_id=r.created_by
       LEFT JOIN megadesk_domain_client_users u_responsible ON u_responsible.client_id=r.client_id AND u_responsible.user_id=r.responsible_user_id
       WHERE ${clause}
       ORDER BY r.created_at DESC,r.id DESC LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    return {
      items: rows.map(row => ({
        ...this.requestPublic(row),
        itemCount: Number(row.item_count),
        convertedToOrder: Boolean(row.converted_to_order),
        hasQuote: Boolean(row.has_quote),
      })),
      total: Number(count[0]?.total ?? 0),
    };
  }

  async requestDetail(clientId: string, publicId: string, executor: Pool | PoolConnection = this.db()) {
    const row = await this.requestRow(executor, clientId, publicId);
    if (!row) return null;
    const [items] = await executor.execute<RowDataPacket[]>(
      `SELECT ri.*,p.public_id product_public_id,ii.public_id inventory_item_public_id
       FROM erp_purchase_request_items ri
       LEFT JOIN erp_products p ON p.id=ri.product_id AND p.client_id=ri.client_id
       LEFT JOIN erp_inventory_items ii ON ii.id=ri.inventory_item_id AND ii.client_id=ri.client_id
       WHERE ri.client_id=? AND ri.purchase_request_id=? ORDER BY ri.id`,
      [clientId, row.id]
    );
    const [approvals] = await executor.execute<RowDataPacket[]>(
      `SELECT a.public_id publicId,a.status,a.justification,a.requested_at requestedAt,a.decided_at decidedAt,
              COALESCE(ur.name,ur.email,'Usuário indisponível') requestedByName,
              COALESCE(ud.name,ud.email) decidedByName
       FROM erp_purchase_approvals a
       LEFT JOIN megadesk_domain_client_users ur ON ur.client_id=a.client_id AND ur.user_id=a.requested_by
       LEFT JOIN megadesk_domain_client_users ud ON ud.client_id=a.client_id AND ud.user_id=a.decided_by
       WHERE a.client_id=? AND a.purchase_request_id=? ORDER BY a.created_at,a.id`,
      [clientId, row.id]
    );
    const quote = await this.quoteForRequest(executor, clientId, Number(row.id));
    const [orders] = await executor.execute<RowDataPacket[]>(
      "SELECT public_id FROM erp_purchase_orders WHERE client_id=? AND purchase_request_id=? LIMIT 1",
      [clientId, row.id]
    );
    const events = await this.timeline(executor, clientId, { requestId: Number(row.id) });
    return {
      ...this.requestPublic(row),
      convertedToOrder: Boolean(orders[0]),
      orderPublicId: orders[0] ? String(orders[0].public_id) : null,
      items: items.map(item => ({
        publicId: String(item.public_id),
        productPublicId: item.product_public_id ? String(item.product_public_id) : null,
        inventoryItemPublicId: item.inventory_item_public_id ? String(item.inventory_item_public_id) : null,
        description: String(item.description_snapshot),
        sku: item.sku_snapshot ? String(item.sku_snapshot) : null,
        unit: item.unit_snapshot ? String(item.unit_snapshot) : null,
        quantity: String(item.quantity),
        estimatedUnitCostCents: Number(item.estimated_unit_cost_cents),
      })),
      approvals,
      quote,
      timeline: events,
    };
  }

  private async resolveRequestItems(
    connection: PoolConnection,
    actor: PurchaseActor,
    items: PurchaseRequestDraftInput["items"]
  ) {
    const resolved: Array<Record<string, unknown>> = [];
    for (const item of items) {
      if (!item.productPublicId) {
        resolved.push({
          publicId: randomUUID(),
          productId: null,
          inventoryItemId: null,
          description: item.description!.trim(),
          sku: null,
          unit: item.unit?.trim() || null,
          quantity: millisQuantity(quantityMillis(item.quantity)),
          estimatedUnitCostCents: item.estimatedUnitCostCents,
        });
        continue;
      }
      const [products] = await connection.execute<RowDataPacket[]>(
        "SELECT id,name,sku,unit,minimum_stock FROM erp_products WHERE client_id=? AND public_id=? AND active=1 LIMIT 1",
        [actor.clientId, item.productPublicId]
      );
      if (!products[0]) throw new ErpDomainError("INACTIVE_PRODUCT", "Produto ativo não encontrado.");
      const inventoryItem = await this.inventory().resolveForOperation(connection, {
        clientId: actor.clientId,
        productId: Number(products[0].id),
        requestedPublicId: item.inventoryItemPublicId ?? null,
        userId: actor.userId,
        productMinimumStock: String(products[0].minimum_stock ?? "0.000"),
      });
      resolved.push({
        publicId: randomUUID(),
        productId: Number(products[0].id),
        inventoryItemId: inventoryItem.id,
        description: String(products[0].name),
        sku: String(products[0].sku),
        unit: String(products[0].unit),
        quantity: millisQuantity(quantityMillis(item.quantity)),
        estimatedUnitCostCents: item.estimatedUnitCostCents,
      });
    }
    const ids = resolved.filter(item => item.inventoryItemId).map(item => ({ inventoryItemId: Number(item.inventoryItemId) }));
    if (hasDuplicateResolvedInventoryItem(ids)) {
      throw new ErpDomainError("CONFLICT", "Inventory item duplicado na solicitação.");
    }
    return resolved;
  }

  async saveRequest(actor: PurchaseActor, input: PurchaseRequestDraftInput, publicId?: string) {
    const connection = await this.db().getConnection();
    const targetPublicId = publicId ?? randomUUID();
    try {
      await connection.beginTransaction();
      const resolved = await this.resolveRequestItems(connection, actor, input.items);
      let requestId: number;
      let before: unknown = null;
      if (publicId) {
        const current = await this.requestRow(connection, actor.clientId, publicId, true);
        if (!current) throw new ErpDomainError("NOT_FOUND", "Solicitação não encontrada.");
        if (current.status !== "draft") {
          throw new ErpDomainError("CONFLICT", "Somente solicitação em rascunho pode ser editada.");
        }
        requestId = Number(current.id);
        before = compactRequestSnapshot(await this.requestDetail(actor.clientId, publicId, connection));
        await connection.execute(
          "UPDATE erp_purchase_requests SET department=?,priority=?,reason=?,responsible_user_id=?,updated_by=? WHERE client_id=? AND id=?",
          [input.department, input.priority, input.reason, input.responsibleUserId, actor.userId, actor.clientId, requestId]
        );
        await connection.execute(
          "DELETE FROM erp_purchase_request_items WHERE client_id=? AND purchase_request_id=?",
          [actor.clientId, requestId]
        );
      } else {
        const number = await this.nextNumber(connection, actor.clientId, "request");
        const [inserted] = await connection.execute<ResultSetHeader>(
          `INSERT INTO erp_purchase_requests
           (public_id,client_id,request_number,requester_user_id,responsible_user_id,department,priority,reason,status,created_by,updated_by)
           VALUES(?,?,?,?,?,?,?,?,'draft',?,?)`,
          [targetPublicId, actor.clientId, number, actor.userId, input.responsibleUserId, input.department, input.priority, input.reason, actor.userId, actor.userId]
        );
        requestId = inserted.insertId;
      }
      for (const item of resolved) {
        await connection.execute(
          `INSERT INTO erp_purchase_request_items
           (public_id,client_id,purchase_request_id,product_id,inventory_item_id,description_snapshot,sku_snapshot,unit_snapshot,quantity,estimated_unit_cost_cents)
           VALUES(?,?,?,?,?,?,?,?,?,?)`,
          [item.publicId, actor.clientId, requestId, item.productId, item.inventoryItemId, item.description, item.sku, item.unit, item.quantity, item.estimatedUnitCostCents]
        );
      }
      const after = compactRequestSnapshot(await this.requestDetail(actor.clientId, targetPublicId, connection));
      await this.event(connection, {
        requestId,
        entityType: "request",
        entityPublicId: targetPublicId,
        action: publicId ? "request_updated" : "request_created",
        summary: publicId ? "Solicitação de compra atualizada." : "Solicitação de compra criada.",
        actor,
        before,
        after,
      });
      await connection.commit();
      return this.requestDetail(actor.clientId, targetPublicId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async closeOrderBalance(
    actor: PurchaseActor,
    input: {
      publicId: string;
      reason: string;
      discountCents: number;
      freightCents: number;
      otherExpensesCents: number;
    }
  ) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const order = await this.orderRow(connection, actor.clientId, input.publicId, true);
      if (!order) throw new ErpDomainError("NOT_FOUND", "Pedido nÃ£o encontrado.");
      if (order.status === "received") {
        await connection.commit();
        return { order: await this.orderDetail(actor.clientId, input.publicId), replay: true };
      }
      if (order.status !== "approved") {
        throw new ErpDomainError("CONFLICT", "Somente pedido confirmado e parcialmente recebido pode ter o saldo encerrado.");
      }
      const [items] = await connection.execute<RowDataPacket[]>(
        `SELECT i.*,COALESCE(SUM(ri.quantity),0) received_quantity
         FROM erp_purchase_order_items i
         LEFT JOIN erp_purchase_order_receipt_items ri ON ri.purchase_order_item_id=i.id
         WHERE i.purchase_order_id=? GROUP BY i.id ORDER BY i.id FOR UPDATE`,
        [order.id]
      );
      const receivedTotal = items.reduce(
        (sum, item) => sum + quantityMillis(String(item.received_quantity)),
        0n
      );
      const orderedTotal = items.reduce(
        (sum, item) => sum + quantityMillis(String(item.quantity)),
        0n
      );
      if (receivedTotal <= 0n || receivedTotal >= orderedTotal) {
        throw new ErpDomainError("CONFLICT", "O encerramento de saldo exige um recebimento parcial em aberto.");
      }

      let subtotalCents = 0;
      const adjustedItems: Array<{ publicId: string; quantity: string; lineTotalCents: number }> = [];
      for (const item of items) {
        const received = quantityMillis(String(item.received_quantity));
        if (received === 0n) {
          await connection.execute("DELETE FROM erp_purchase_order_items WHERE id=?", [item.id]);
          continue;
        }
        const gross = Number((received * BigInt(Number(item.unit_cost_cents)) + 500n) / 1_000n);
        const discount = Math.min(Number(item.discount_cents ?? 0), gross);
        const lineTotal = gross - discount;
        const normalized = millisQuantity(received);
        await connection.execute(
          "UPDATE erp_purchase_order_items SET quantity=?,discount_cents=?,line_total_cents=? WHERE id=?",
          [normalized, discount, lineTotal, item.id]
        );
        subtotalCents = safeMoneySum([subtotalCents, lineTotal]);
        adjustedItems.push({ publicId: String(item.public_id), quantity: normalized, lineTotalCents: lineTotal });
      }
      if (input.discountCents > subtotalCents) {
        throw new ErpDomainError("VALIDATION", "Desconto do pedido excede o subtotal recebido.");
      }
      const newTotalCents = safePurchaseTotal(
        subtotalCents,
        input.discountCents,
        input.freightCents,
        input.otherExpensesCents
      );
      const oldTotalCents = Number(order.total_cents);
      if (newTotalCents > oldTotalCents) {
        throw new ErpDomainError("VALIDATION", "Encerrar saldo nÃ£o pode aumentar o valor total do pedido.");
      }

      const [entries] = await connection.execute<RowDataPacket[]>(
        `SELECT e.*,COALESCE(SUM(s.amount_cents),0) paid_cents
         FROM erp_financial_entries e
         LEFT JOIN erp_financial_settlements s ON s.client_id=e.client_id AND s.financial_entry_id=e.id
         WHERE e.client_id=? AND e.source_type='purchase_order' AND e.source_public_id=?
         GROUP BY e.id ORDER BY e.source_installment,e.id FOR UPDATE`,
        [actor.clientId, input.publicId]
      );
      const paidCents = entries.reduce((sum, entry) => sum + Number(entry.paid_cents), 0);
      if (paidCents > newTotalCents) {
        throw new ErpDomainError(
          "CONFLICT",
          "O valor jÃ¡ pago excede o novo total; registre o estorno ou crÃ©dito antes de encerrar o saldo."
        );
      }
      let reduction = oldTotalCents - newTotalCents;
      const amounts = entries.map(entry => Number(entry.amount_cents));
      for (let index = entries.length - 1; index >= 0 && reduction > 0; index -= 1) {
        const paid = Number(entries[index].paid_cents);
        const reducible = Math.max(0, amounts[index] - paid);
        const applied = Math.min(reduction, reducible);
        amounts[index] -= applied;
        reduction -= applied;
      }
      if (entries.length > 0 && reduction !== 0) {
        throw new ErpDomainError("CONFLICT", "NÃ£o foi possÃ­vel ajustar as parcelas sem alterar valores pagos.");
      }
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const amount = amounts[index];
        const paid = Number(entry.paid_cents);
        const status = amount === 0 ? "cancelled" : paid >= amount ? "settled" : "open";
        await connection.execute(
          `UPDATE erp_financial_entries
           SET amount_cents=?,status=?,settled_at=CASE WHEN ?='settled' THEN COALESCE(settled_at,NOW()) ELSE NULL END,
               settled_by=CASE WHEN ?='settled' THEN COALESCE(settled_by,?) ELSE NULL END,
               cancelled_at=CASE WHEN ?='cancelled' THEN NOW() ELSE NULL END,
               cancelled_by=CASE WHEN ?='cancelled' THEN ? ELSE NULL END,
               cancellation_reason=CASE WHEN ?='cancelled' THEN ? ELSE NULL END
           WHERE client_id=? AND id=?`,
          [
            amount,
            status,
            status,
            status,
            actor.userId,
            status,
            status,
            actor.userId,
            status,
            status === "cancelled" ? `Saldo encerrado: ${input.reason}` : null,
            actor.clientId,
            entry.id,
          ]
        );
        await connection.execute(
          "UPDATE erp_purchase_order_installments SET amount_cents=? WHERE client_id=? AND financial_entry_id=?",
          [amount, actor.clientId, entry.id]
        );
      }
      await connection.execute(
        `UPDATE erp_purchase_orders
         SET status='received',subtotal_cents=?,discount_cents=?,freight_cents=?,other_expenses_cents=?,total_cents=?,received_by=?,received_at=NOW()
         WHERE client_id=? AND id=?`,
        [
          subtotalCents,
          input.discountCents,
          input.freightCents,
          input.otherExpensesCents,
          newTotalCents,
          actor.userId,
          actor.clientId,
          order.id,
        ]
      );
      await connection.execute(
        "INSERT INTO erp_purchase_order_history(purchase_order_id,from_status,to_status,reason,changed_by) VALUES(?,'approved','received',?,?)",
        [order.id, input.reason, actor.userId]
      );
      await this.event(connection, {
        requestId: order.purchase_request_id ? Number(order.purchase_request_id) : null,
        quoteId: order.purchase_quote_id ? Number(order.purchase_quote_id) : null,
        orderId: Number(order.id),
        entityType: "order",
        entityPublicId: input.publicId,
        action: "order_balance_closed",
        summary: `${actor.userName?.trim() || "UsuÃ¡rio"} encerrou o saldo pendente de ${order.order_number}.`,
        actor,
        before: { totalCents: oldTotalCents, orderedQuantity: millisQuantity(orderedTotal) },
        after: {
          totalCents: newTotalCents,
          receivedQuantity: millisQuantity(receivedTotal),
          reason: input.reason,
          items: adjustedItems,
        },
      });
      await connection.commit();
      return { order: await this.orderDetail(actor.clientId, input.publicId), replay: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async submitRequest(actor: PurchaseActor, publicId: string, correlationId: string) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const row = await this.requestRow(connection, actor.clientId, publicId, true);
      if (!row) throw new ErpDomainError("NOT_FOUND", "Solicitação não encontrada.");
      if (row.status === "pending_approval") {
        await connection.commit();
        return { request: await this.requestDetail(actor.clientId, publicId), replay: true };
      }
      if (row.status !== "draft" && row.status !== "rejected") {
        throw new ErpDomainError("CONFLICT", "Solicitação não pode ser enviada para aprovação neste estado.");
      }
      await connection.execute(
        "UPDATE erp_purchase_requests SET status='pending_approval',approval_requested_by=?,approval_requested_at=NOW(),decided_by=NULL,decided_at=NULL,decision_reason=NULL,updated_by=? WHERE client_id=? AND id=?",
        [actor.userId, actor.userId, actor.clientId, row.id]
      );
      await connection.execute(
        "INSERT INTO erp_purchase_approvals(public_id,client_id,purchase_request_id,status,requested_by) VALUES(?,?,?,'pending',?)",
        [randomUUID(), actor.clientId, row.id, actor.userId]
      );
      await this.event(connection, {
        requestId: Number(row.id),
        entityType: "request",
        entityPublicId: publicId,
        action: "approval_requested",
        summary: "Aprovação da solicitação foi requisitada.",
        actor,
        before: { status: row.status },
        after: { status: "pending_approval" },
        correlationId,
      });
      await connection.commit();
      return { request: await this.requestDetail(actor.clientId, publicId), replay: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async decideRequest(
    actor: PurchaseActor,
    publicId: string,
    decision: "approved" | "rejected",
    reason: string | null,
    correlationId: string
  ) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const row = await this.requestRow(connection, actor.clientId, publicId, true);
      if (!row) throw new ErpDomainError("NOT_FOUND", "Solicitação não encontrada.");
      if (row.status === decision) {
        await connection.commit();
        return { request: await this.requestDetail(actor.clientId, publicId), replay: true };
      }
      if (row.status !== "pending_approval") {
        throw new ErpDomainError("CONFLICT", "Solicitação não está aguardando aprovação.");
      }
      if (decision === "rejected" && !reason) {
        throw new ErpDomainError("VALIDATION", "Informe a justificativa da reprovação.");
      }
      await connection.execute(
        "UPDATE erp_purchase_requests SET status=?,decided_by=?,decided_at=NOW(),decision_reason=?,updated_by=? WHERE client_id=? AND id=?",
        [decision, actor.userId, reason, actor.userId, actor.clientId, row.id]
      );
      const [updated] = await connection.execute<ResultSetHeader>(
        "UPDATE erp_purchase_approvals SET status=?,decided_by=?,decided_at=NOW(),justification=? WHERE client_id=? AND purchase_request_id=? AND status='pending' ORDER BY id DESC LIMIT 1",
        [decision, actor.userId, reason, actor.clientId, row.id]
      );
      if (!updated.affectedRows) throw new ErpDomainError("CONFLICT", "Registro de aprovação pendente não encontrado.");
      await this.event(connection, {
        requestId: Number(row.id),
        entityType: "request",
        entityPublicId: publicId,
        action: decision === "approved" ? "request_approved" : "request_rejected",
        summary: decision === "approved" ? "Solicitação de compra aprovada." : "Solicitação de compra reprovada.",
        actor,
        before: { status: row.status },
        after: { status: decision, reason },
        correlationId,
      });
      await connection.commit();
      return { request: await this.requestDetail(actor.clientId, publicId), replay: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async cancelRequest(actor: PurchaseActor, publicId: string, reason: string) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const row = await this.requestRow(connection, actor.clientId, publicId, true);
      if (!row) throw new ErpDomainError("NOT_FOUND", "Solicitação não encontrada.");
      if (row.status === "cancelled") {
        await connection.commit();
        return { request: await this.requestDetail(actor.clientId, publicId), replay: true };
      }
      const [effects] = await connection.execute<RowDataPacket[]>(
        `SELECT EXISTS(SELECT 1 FROM erp_purchase_quotes q WHERE q.purchase_request_id=?) has_quote,
                EXISTS(SELECT 1 FROM erp_purchase_orders o WHERE o.purchase_request_id=?) has_order`,
        [row.id, row.id]
      );
      if (Number(effects[0]?.has_quote) || Number(effects[0]?.has_order)) {
        throw new ErpDomainError("CONFLICT", "Solicitação com cotação ou pedido vinculado não pode ser cancelada isoladamente.");
      }
      await connection.execute(
        "UPDATE erp_purchase_requests SET status='cancelled',cancelled_by=?,cancelled_at=NOW(),cancellation_reason=?,updated_by=? WHERE client_id=? AND id=?",
        [actor.userId, reason, actor.userId, actor.clientId, row.id]
      );
      await connection.execute(
        "UPDATE erp_purchase_approvals SET status='rejected',decided_by=?,decided_at=NOW(),justification=? WHERE client_id=? AND purchase_request_id=? AND status='pending'",
        [actor.userId, `Cancelada: ${reason}`, actor.clientId, row.id]
      );
      await this.event(connection, {
        requestId: Number(row.id),
        entityType: "request",
        entityPublicId: publicId,
        action: "request_cancelled",
        summary: "Solicitação de compra cancelada.",
        actor,
        before: { status: row.status },
        after: { status: "cancelled", reason },
      });
      await connection.commit();
      return { request: await this.requestDetail(actor.clientId, publicId), replay: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async quoteForRequest(
    executor: Pool | PoolConnection,
    clientId: string,
    requestId: number
  ) {
    const [rows] = await executor.execute<RowDataPacket[]>(
      "SELECT public_id FROM erp_purchase_quotes WHERE client_id=? AND purchase_request_id=? LIMIT 1",
      [clientId, requestId]
    );
    return rows[0] ? this.quoteDetail(clientId, String(rows[0].public_id), executor) : null;
  }

  async quoteDetail(
    clientId: string,
    publicId: string,
    executor: Pool | PoolConnection = this.db(),
    lock = false
  ) {
    const [quotes] = await executor.execute<RowDataPacket[]>(
      `SELECT q.*,r.public_id request_public_id,r.request_number
       FROM erp_purchase_quotes q
       INNER JOIN erp_purchase_requests r ON r.id=q.purchase_request_id AND r.client_id=q.client_id
       WHERE q.client_id=? AND q.public_id=? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, publicId]
    );
    const quote = quotes[0];
    if (!quote) return null;
    const [proposals] = await executor.execute<RowDataPacket[]>(
      `SELECT p.*,s.public_id supplier_public_id,f.public_id supplier_file_public_id
       FROM erp_purchase_quote_proposals p
       INNER JOIN erp_suppliers s ON s.id=p.supplier_id AND s.client_id=p.client_id
       LEFT JOIN erp_supplier_files f ON f.id=p.supplier_file_id AND f.client_id=p.client_id
       WHERE p.client_id=? AND p.quote_id=? ORDER BY p.total_cents,p.id`,
      [clientId, quote.id]
    );
    let proposalItems: RowDataPacket[] = [];
    if (proposals.length) {
      const placeholders = proposals.map(() => "?").join(",");
      [proposalItems] = await executor.execute<RowDataPacket[]>(
        `SELECT pi.*,ri.public_id request_item_public_id,ri.description_snapshot,ri.quantity
         FROM erp_purchase_quote_proposal_items pi
         INNER JOIN erp_purchase_request_items ri ON ri.id=pi.request_item_id
         WHERE pi.proposal_id IN (${placeholders}) ORDER BY pi.proposal_id,ri.id`,
        proposals.map(proposal => proposal.id)
      );
    }
    const proposalItemsById = new Map<number, RowDataPacket[]>();
    for (const item of proposalItems) {
      const proposalId = Number(item.proposal_id);
      const current = proposalItemsById.get(proposalId) ?? [];
      current.push(item);
      proposalItemsById.set(proposalId, current);
    }
    const result = [];
    for (const proposal of proposals) {
      const items = proposalItemsById.get(Number(proposal.id)) ?? [];
      result.push({
        publicId: String(proposal.public_id),
        supplierPublicId: String(proposal.supplier_public_id),
        supplierName: String(proposal.supplier_name_snapshot),
        subtotalCents: Number(proposal.subtotal_cents),
        freightCents: Number(proposal.freight_cents),
        totalCents: Number(proposal.total_cents),
        leadTimeDays: proposal.lead_time_days === null ? null : Number(proposal.lead_time_days),
        paymentTerms: proposal.payment_terms ?? null,
        notes: proposal.notes ?? null,
        supplierFilePublicId: proposal.supplier_file_public_id ?? null,
        selected: Number(quote.selected_proposal_id) === Number(proposal.id),
        items: items.map(item => ({
          requestItemPublicId: String(item.request_item_public_id),
          description: String(item.description_snapshot),
          quantity: String(item.quantity),
          unitCostCents: Number(item.unit_cost_cents),
          discountCents: Number(item.discount_cents),
          lineTotalCents: Number(item.line_total_cents),
        })),
      });
    }
    return {
      publicId: String(quote.public_id),
      quoteNumber: String(quote.quote_number),
      requestPublicId: String(quote.request_public_id),
      requestNumber: String(quote.request_number),
      status: String(quote.status),
      selectedProposalPublicId:
        result.find(item => item.selected)?.publicId ?? null,
      proposals: result,
      createdAt: quote.created_at,
      updatedAt: quote.updated_at,
    };
  }

  async createQuote(actor: PurchaseActor, requestPublicId: string) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const request = await this.requestRow(connection, actor.clientId, requestPublicId, true);
      if (!request) throw new ErpDomainError("NOT_FOUND", "Solicitação não encontrada.");
      if (request.status !== "approved") {
        throw new ErpDomainError("CONFLICT", "Somente solicitação aprovada pode originar cotação.");
      }
      const existing = await this.quoteForRequest(connection, actor.clientId, Number(request.id));
      if (existing) {
        await connection.commit();
        return { quote: existing, replay: true };
      }
      const [orders] = await connection.execute<RowDataPacket[]>(
        "SELECT public_id FROM erp_purchase_orders WHERE client_id=? AND purchase_request_id=? LIMIT 1",
        [actor.clientId, request.id]
      );
      if (orders[0]) {
        throw new ErpDomainError(
          "CONFLICT",
          "Solicitacao ja convertida em pedido nao pode originar uma nova cotacao."
        );
      }
      const publicId = randomUUID();
      const number = await this.nextNumber(connection, actor.clientId, "quote");
      const [inserted] = await connection.execute<ResultSetHeader>(
        "INSERT INTO erp_purchase_quotes(public_id,client_id,quote_number,purchase_request_id,status,created_by) VALUES(?,?,?,?,\'draft\',?)",
        [publicId, actor.clientId, number, request.id, actor.userId]
      );
      await this.event(connection, {
        requestId: Number(request.id),
        quoteId: inserted.insertId,
        entityType: "quote",
        entityPublicId: publicId,
        action: "quote_created",
        summary: `Cotação ${number} criada a partir da solicitação ${request.request_number}.`,
        actor,
        after: { status: "draft", quoteNumber: number },
      });
      await connection.commit();
      return { quote: await this.quoteDetail(actor.clientId, publicId), replay: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async addProposal(actor: PurchaseActor, input: QuoteProposalInput) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const quote = await this.quoteDetail(actor.clientId, input.quotePublicId, connection, true);
      if (!quote) throw new ErpDomainError("NOT_FOUND", "Cotação não encontrada.");
      if (quote.status === "selected" || quote.status === "cancelled") {
        throw new ErpDomainError("CONFLICT", "Cotação encerrada não aceita novas propostas.");
      }
      const [quoteIds] = await connection.execute<RowDataPacket[]>(
        "SELECT id,purchase_request_id FROM erp_purchase_quotes WHERE client_id=? AND public_id=?",
        [actor.clientId, input.quotePublicId]
      );
      const [suppliers] = await connection.execute<RowDataPacket[]>(
        "SELECT id,legal_name FROM erp_suppliers WHERE client_id=? AND public_id=? AND active=1 LIMIT 1",
        [actor.clientId, input.supplierPublicId]
      );
      if (!suppliers[0]) throw new ErpDomainError("NOT_FOUND", "Fornecedor ativo não encontrado.");
      let supplierFileId: number | null = null;
      if (input.supplierFilePublicId) {
        const [files] = await connection.execute<RowDataPacket[]>(
          "SELECT id FROM erp_supplier_files WHERE client_id=? AND supplier_id=? AND public_id=? AND state='active' LIMIT 1",
          [actor.clientId, suppliers[0].id, input.supplierFilePublicId]
        );
        if (!files[0]) throw new ErpDomainError("NOT_FOUND", "Documento do fornecedor não encontrado.");
        supplierFileId = Number(files[0].id);
      }
      const [requestItems] = await connection.execute<RowDataPacket[]>(
        "SELECT id,public_id,quantity FROM erp_purchase_request_items WHERE client_id=? AND purchase_request_id=? ORDER BY id FOR UPDATE",
        [actor.clientId, quoteIds[0].purchase_request_id]
      );
      const itemMap = new Map(requestItems.map(item => [String(item.public_id), item]));
      if (input.items.length !== requestItems.length || input.items.some(item => !itemMap.has(item.requestItemPublicId))) {
        throw new ErpDomainError("VALIDATION", "A proposta deve precificar todos os itens da solicitação exatamente uma vez.");
      }
      const seen = new Set<string>();
      let subtotal = 0;
      const resolved = input.items.map(item => {
        if (seen.has(item.requestItemPublicId)) {
          throw new ErpDomainError("VALIDATION", "Item repetido na proposta.");
        }
        seen.add(item.requestItemPublicId);
        const requestItem = itemMap.get(item.requestItemPublicId)!;
        const total = lineTotalCents(String(requestItem.quantity), item.unitCostCents, item.discountCents);
        subtotal = safeMoneySum([subtotal, total]);
        return { ...item, requestItemId: Number(requestItem.id), lineTotalCents: total };
      });
      const proposalPublicId = randomUUID();
      const total = safePurchaseTotal(subtotal, 0, input.freightCents, 0);
      const [inserted] = await connection.execute<ResultSetHeader>(
        `INSERT INTO erp_purchase_quote_proposals
         (public_id,client_id,quote_id,supplier_id,supplier_name_snapshot,subtotal_cents,freight_cents,total_cents,lead_time_days,payment_terms,notes,supplier_file_id,created_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [proposalPublicId, actor.clientId, quoteIds[0].id, suppliers[0].id, suppliers[0].legal_name, subtotal, input.freightCents, total, input.leadTimeDays, input.paymentTerms, input.notes, supplierFileId, actor.userId]
      );
      for (const item of resolved) {
        await connection.execute(
          "INSERT INTO erp_purchase_quote_proposal_items(proposal_id,request_item_id,unit_cost_cents,discount_cents,line_total_cents) VALUES(?,?,?,?,?)",
          [inserted.insertId, item.requestItemId, item.unitCostCents, item.discountCents, item.lineTotalCents]
        );
      }
      await connection.execute(
        "UPDATE erp_purchase_quotes SET status='collecting' WHERE client_id=? AND id=?",
        [actor.clientId, quoteIds[0].id]
      );
      await this.event(connection, {
        requestId: Number(quoteIds[0].purchase_request_id),
        quoteId: Number(quoteIds[0].id),
        entityType: "quote",
        entityPublicId: input.quotePublicId,
        action: "proposal_added",
        summary: `Proposta de ${suppliers[0].legal_name} adicionada à cotação.`,
        actor,
        after: { proposalPublicId, supplierPublicId: input.supplierPublicId, totalCents: total },
      });
      await connection.commit();
      return this.quoteDetail(actor.clientId, input.quotePublicId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async selectProposal(actor: PurchaseActor, quotePublicId: string, proposalPublicId: string) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const [quotes] = await connection.execute<RowDataPacket[]>(
        "SELECT * FROM erp_purchase_quotes WHERE client_id=? AND public_id=? LIMIT 1 FOR UPDATE",
        [actor.clientId, quotePublicId]
      );
      const quote = quotes[0];
      if (!quote) throw new ErpDomainError("NOT_FOUND", "Cotação não encontrada.");
      const [proposals] = await connection.execute<RowDataPacket[]>(
        "SELECT id,supplier_name_snapshot,total_cents FROM erp_purchase_quote_proposals WHERE client_id=? AND quote_id=? AND public_id=? LIMIT 1",
        [actor.clientId, quote.id, proposalPublicId]
      );
      if (!proposals[0]) throw new ErpDomainError("NOT_FOUND", "Proposta não encontrada nesta cotação.");
      if (quote.status === "selected" && Number(quote.selected_proposal_id) === Number(proposals[0].id)) {
        await connection.commit();
        return { quote: await this.quoteDetail(actor.clientId, quotePublicId), replay: true };
      }
      if (quote.status === "cancelled" || quote.status === "selected") {
        throw new ErpDomainError("CONFLICT", "Cotação já encerrada.");
      }
      await connection.execute(
        "UPDATE erp_purchase_quotes SET status='selected',selected_proposal_id=?,selected_by=?,selected_at=NOW() WHERE client_id=? AND id=?",
        [proposals[0].id, actor.userId, actor.clientId, quote.id]
      );
      await this.event(connection, {
        requestId: Number(quote.purchase_request_id),
        quoteId: Number(quote.id),
        entityType: "quote",
        entityPublicId: quotePublicId,
        action: "supplier_selected",
        summary: `Fornecedor ${proposals[0].supplier_name_snapshot} selecionado na cotação.`,
        actor,
        before: { status: quote.status, selectedProposalId: null },
        after: { status: "selected", proposalPublicId, totalCents: Number(proposals[0].total_cents) },
      });
      await connection.commit();
      return { quote: await this.quoteDetail(actor.clientId, quotePublicId), replay: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async listOrders(clientId: string, options: PurchaseListInput) {
    const limit = bounded(options.pageSize, 1, 100);
    const offset = (bounded(options.page, 1, Number.MAX_SAFE_INTEGER) - 1) * limit;
    const where = ["o.client_id=?"];
    const values: Array<string | number> = [clientId];
    if (options.search) {
      const search = `%${options.search}%`;
      where.push(`(o.order_number LIKE ? OR o.supplier_name_snapshot LIKE ? OR
        EXISTS(SELECT 1 FROM erp_purchase_order_items oi WHERE oi.purchase_order_id=o.id AND (oi.product_name_snapshot LIKE ? OR oi.sku_snapshot LIKE ?)) OR
        EXISTS(SELECT 1 FROM megadesk_domain_client_users u WHERE u.client_id=o.client_id AND u.user_id IN (o.created_by,o.responsible_user_id) AND (u.name LIKE ? OR u.email LIKE ?)))`);
      values.push(search, search, search, search, search, search);
    }
    if (options.status) {
      where.push("o.status=?");
      values.push(options.status);
    }
    if (options.supplierPublicId) {
      where.push("s.public_id=?");
      values.push(options.supplierPublicId);
    }
    if (options.from) {
      where.push("DATE(o.created_at)>=?");
      values.push(options.from);
    }
    if (options.to) {
      where.push("DATE(o.created_at)<=?");
      values.push(options.to);
    }
    if (options.view === "open") where.push("o.status NOT IN ('cancelled') AND COALESCE(rt.received_quantity,0)<it.ordered_quantity");
    if (options.view === "awaiting_receipt") where.push("o.status IN ('approved','received') AND COALESCE(rt.received_quantity,0)=0");
    if (options.view === "partial") where.push("COALESCE(rt.received_quantity,0)>0 AND COALESCE(rt.received_quantity,0)<it.ordered_quantity");
    if (options.view === "received") where.push("it.ordered_quantity>0 AND COALESCE(rt.received_quantity,0)>=it.ordered_quantity");
    if (options.view === "overdue") where.push("o.status<>'cancelled' AND o.expected_date<CURRENT_DATE AND COALESCE(rt.received_quantity,0)<it.ordered_quantity");
    if (options.view === "cancelled") where.push("o.status='cancelled'");
    const joins = `
      INNER JOIN erp_suppliers s ON s.id=o.supplier_id AND s.client_id=o.client_id
      INNER JOIN (SELECT purchase_order_id,SUM(quantity) ordered_quantity FROM erp_purchase_order_items GROUP BY purchase_order_id) it ON it.purchase_order_id=o.id
      LEFT JOIN (SELECT i.purchase_order_id,SUM(ri.quantity) received_quantity FROM erp_purchase_order_receipt_items ri INNER JOIN erp_purchase_order_items i ON i.id=ri.purchase_order_item_id GROUP BY i.purchase_order_id) rt ON rt.purchase_order_id=o.id
      LEFT JOIN (SELECT e.client_id,e.source_public_id,SUM(e.amount_cents) finance_total,SUM(COALESCE(x.paid_cents,0)) paid_cents,SUM(e.status='open' AND e.due_date<CURRENT_DATE)>0 has_overdue FROM erp_financial_entries e LEFT JOIN (SELECT financial_entry_id,SUM(amount_cents) paid_cents FROM erp_financial_settlements GROUP BY financial_entry_id) x ON x.financial_entry_id=e.id WHERE e.source_type='purchase_order' GROUP BY e.client_id,e.source_public_id) fin ON fin.client_id=o.client_id AND fin.source_public_id=o.public_id
      LEFT JOIN megadesk_domain_client_users uc ON uc.client_id=o.client_id AND uc.user_id=o.created_by
      LEFT JOIN megadesk_domain_client_users ur ON ur.client_id=o.client_id AND ur.user_id=o.responsible_user_id`;
    const clause = where.join(" AND ");
    const [count] = await this.db().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_purchase_orders o ${joins} WHERE ${clause}`,
      values
    );
    const sort = {
      orderNumber: "o.order_number",
      createdAt: "o.created_at",
      total: "o.total_cents",
      expectedDate: "o.expected_date",
    }[options.sort];
    const [rows] = await this.db().execute<RowDataPacket[]>(
      `SELECT o.*,s.public_id supplier_public_id,
              COALESCE(uc.name,uc.email,'Usuário indisponível') created_by_name,
              COALESCE(ur.name,ur.email) responsible_name,
              it.ordered_quantity,COALESCE(rt.received_quantity,0) received_quantity,
              COALESCE(fin.finance_total,0) finance_total,COALESCE(fin.paid_cents,0) paid_cents,COALESCE(fin.has_overdue,0) has_overdue
       FROM erp_purchase_orders o ${joins}
       WHERE ${clause}
       ORDER BY ${sort} ${options.direction === "asc" ? "ASC" : "DESC"},o.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    return { items: rows.map(row => this.orderPublic(row)), total: Number(count[0]?.total ?? 0) };
  }

  private orderPublic(row: RowDataPacket) {
    const ordered = Number(row.ordered_quantity ?? 0);
    const received = Number(row.received_quantity ?? 0);
    const financeTotal = Number(row.finance_total ?? 0);
    const paid = Number(row.paid_cents ?? 0);
    const receiptProgress = ordered > 0 ? Math.min(100, Math.round((received / ordered) * 100)) : 0;
    const financialProgress = financeTotal > 0 ? Math.min(100, Math.round((paid / financeTotal) * 100)) : 0;
    const receiptStatus = received <= 0 ? "awaiting" : received + 0.0005 < ordered ? "partial" : "received";
    const financialStatus = financeTotal <= 0
      ? "not_launched"
      : paid >= financeTotal
        ? "paid"
        : paid > 0
          ? "partially_paid"
          : Number(row.has_overdue) > 0
            ? "overdue"
            : "open";
    return {
      publicId: String(row.public_id),
      orderNumber: String(row.order_number),
      supplierPublicId: String(row.supplier_public_id),
      supplierName: String(row.supplier_name_snapshot),
      sourceType: String(row.source_type ?? "direct"),
      status: String(row.status),
      notes: row.notes ?? null,
      expectedDate: dateOnly(row.expected_date),
      responsibleUserId: row.responsible_user_id ?? null,
      responsibleName: row.responsible_name ?? null,
      createdByName: row.created_by_name ?? null,
      subtotalCents: Number(row.subtotal_cents),
      discountCents: Number(row.discount_cents ?? 0),
      freightCents: Number(row.freight_cents ?? 0),
      otherExpensesCents: Number(row.other_expenses_cents ?? 0),
      totalCents: Number(row.total_cents),
      paymentTerms: row.payment_terms ?? null,
      approvedAt: row.approved_at ?? null,
      receivedAt: row.received_at ?? null,
      cancelledAt: row.cancelled_at ?? null,
      cancellationReason: row.cancellation_reason ?? null,
      orderedQuantity: ordered.toFixed(3),
      receivedQuantity: received.toFixed(3),
      receiptProgress,
      receiptStatus,
      financeTotalCents: financeTotal,
      paidCents: paid,
      pendingCents: Math.max(0, financeTotal - paid),
      financialProgress,
      financialStatus,
      overdue: Boolean(row.expected_date && dateOnly(row.expected_date)! < new Date().toISOString().slice(0, 10) && receiptStatus !== "received" && row.status !== "cancelled"),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async orderRow(
    executor: Pool | PoolConnection,
    clientId: string,
    publicId: string,
    lock = false
  ) {
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT o.*,s.public_id supplier_public_id,
              COALESCE(uc.name,uc.email,'Usuário indisponível') created_by_name,
              COALESCE(ur.name,ur.email) responsible_name,
              (SELECT COALESCE(SUM(i.quantity),0) FROM erp_purchase_order_items i WHERE i.purchase_order_id=o.id) ordered_quantity,
              (SELECT COALESCE(SUM(ri.quantity),0) FROM erp_purchase_order_receipt_items ri INNER JOIN erp_purchase_order_items oi ON oi.id=ri.purchase_order_item_id WHERE oi.purchase_order_id=o.id) received_quantity,
              (SELECT COALESCE(SUM(e.amount_cents),0) FROM erp_financial_entries e WHERE e.client_id=o.client_id AND e.source_type='purchase_order' AND e.source_public_id=o.public_id AND e.status<>'cancelled') finance_total,
              (SELECT COALESCE(SUM(x.amount_cents),0) FROM erp_financial_settlements x INNER JOIN erp_financial_entries e ON e.id=x.financial_entry_id AND e.client_id=x.client_id WHERE e.client_id=o.client_id AND e.source_type='purchase_order' AND e.source_public_id=o.public_id) paid_cents,
              EXISTS(SELECT 1 FROM erp_financial_entries e WHERE e.client_id=o.client_id AND e.source_type='purchase_order' AND e.source_public_id=o.public_id AND e.status='open' AND e.due_date<CURRENT_DATE) has_overdue
       FROM erp_purchase_orders o
       INNER JOIN erp_suppliers s ON s.id=o.supplier_id AND s.client_id=o.client_id
       LEFT JOIN megadesk_domain_client_users uc ON uc.client_id=o.client_id AND uc.user_id=o.created_by
       LEFT JOIN megadesk_domain_client_users ur ON ur.client_id=o.client_id AND ur.user_id=o.responsible_user_id
       WHERE o.client_id=? AND o.public_id=? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, publicId]
    );
    return rows[0] ?? null;
  }

  async orderDetail(
    clientId: string,
    publicId: string,
    executor: Pool | PoolConnection = this.db(),
    lock = false
  ) {
    const row = await this.orderRow(executor, clientId, publicId, lock);
    if (!row) return null;
    const [items] = await executor.execute<RowDataPacket[]>(
      `SELECT i.*,p.public_id product_public_id,ii.public_id inventory_item_public_id,COALESCE(SUM(ri.quantity),0) received_quantity
       FROM erp_purchase_order_items i
       INNER JOIN erp_products p ON p.id=i.product_id AND p.client_id=?
       LEFT JOIN erp_inventory_items ii ON ii.id=i.inventory_item_id AND ii.client_id=?
       LEFT JOIN erp_purchase_order_receipt_items ri ON ri.purchase_order_item_id=i.id
       WHERE i.purchase_order_id=?
       GROUP BY i.id,p.public_id,ii.public_id ORDER BY i.id`,
      [clientId, clientId, row.id]
    );
    const [receipts] = await executor.execute<RowDataPacket[]>(
      `SELECT r.*,COALESCE(u.name,u.email,'Usuário indisponível') received_by_name
       FROM erp_purchase_order_receipts r
       LEFT JOIN megadesk_domain_client_users u ON u.client_id=r.client_id AND u.user_id=r.received_by
       WHERE r.client_id=? AND r.purchase_order_id=? ORDER BY r.receipt_number`,
      [clientId, row.id]
    );
    let allReceiptItems: RowDataPacket[] = [];
    if (receipts.length) {
      const placeholders = receipts.map(() => "?").join(",");
      [allReceiptItems] = await executor.execute<RowDataPacket[]>(
        `SELECT ri.receipt_id,ri.quantity,oi.public_id order_item_public_id,
                oi.product_name_snapshot,oi.sku_snapshot,m.public_id stock_movement_public_id
         FROM erp_purchase_order_receipt_items ri
         INNER JOIN erp_purchase_order_items oi ON oi.id=ri.purchase_order_item_id
         INNER JOIN erp_stock_movements m ON m.id=ri.stock_movement_id AND m.client_id=?
         WHERE ri.receipt_id IN (${placeholders}) ORDER BY ri.receipt_id,ri.id`,
        [clientId, ...receipts.map(receipt => receipt.id)]
      );
    }
    const receiptItemsById = new Map<number, RowDataPacket[]>();
    for (const item of allReceiptItems) {
      const receiptId = Number(item.receipt_id);
      const current = receiptItemsById.get(receiptId) ?? [];
      current.push(item);
      receiptItemsById.set(receiptId, current);
    }
    const receiptViews = [];
    for (const receipt of receipts) {
      const receiptItems = receiptItemsById.get(Number(receipt.id)) ?? [];
      receiptViews.push({
        publicId: String(receipt.public_id),
        receiptNumber: Number(receipt.receipt_number),
        notes: receipt.notes ?? null,
        documentNumber: receipt.document_number ?? null,
        receivedByName: String(receipt.received_by_name),
        receivedAt: receipt.received_at,
        items: receiptItems.map(item => ({
          orderItemPublicId: String(item.order_item_public_id),
          productName: String(item.product_name_snapshot),
          sku: String(item.sku_snapshot),
          quantity: String(item.quantity),
          stockMovementPublicId: String(item.stock_movement_public_id),
        })),
      });
    }
    const [payments] = await executor.execute<RowDataPacket[]>(
      `SELECT e.public_id,e.document_number,e.status,e.amount_cents,e.due_date,e.source_installment,
              COALESCE(SUM(s.amount_cents),0) paid_cents,MAX(s.settled_at) last_payment_at
       FROM erp_financial_entries e
       LEFT JOIN erp_financial_settlements s ON s.client_id=e.client_id AND s.financial_entry_id=e.id
       WHERE e.client_id=? AND e.source_type='purchase_order' AND e.source_public_id=?
       GROUP BY e.id ORDER BY e.source_installment,e.id`,
      [clientId, publicId]
    );
    const timeline = await this.timeline(executor, clientId, { orderId: Number(row.id) });
    const documents = await this.documents(executor, clientId, { orderId: Number(row.id) });
    return {
      ...this.orderPublic(row),
      requestPublicId: await this.sourcePublicId(executor, "erp_purchase_requests", row.purchase_request_id),
      quotePublicId: await this.sourcePublicId(executor, "erp_purchase_quotes", row.purchase_quote_id),
      items: items.map(item => {
        const ordered = quantityMillis(String(item.quantity));
        const received = quantityMillis(String(item.received_quantity));
        return {
          publicId: String(item.public_id),
          productPublicId: String(item.product_public_id),
          inventoryItemPublicId: item.inventory_item_public_id ? String(item.inventory_item_public_id) : null,
          productName: String(item.product_name_snapshot),
          sku: String(item.sku_snapshot),
          quantity: millisQuantity(ordered),
          receivedQuantity: millisQuantity(received),
          pendingQuantity: millisQuantity(ordered - received),
          unitCostCents: Number(item.unit_cost_cents),
          discountCents: Number(item.discount_cents ?? 0),
          lineTotalCents: Number(item.line_total_cents),
        };
      }),
      receipts: receiptViews,
      payments: payments.map(payment => {
        const amount = Number(payment.amount_cents);
        const paid = Number(payment.paid_cents);
        return {
          publicId: String(payment.public_id),
          documentNumber: String(payment.document_number),
          installmentNumber: Number(payment.source_installment),
          dueDate: dateOnly(payment.due_date),
          amountCents: amount,
          paidCents: paid,
          pendingCents: Math.max(0, amount - paid),
          status: payment.status === "cancelled" ? "cancelled" : paid >= amount ? "paid" : paid > 0 ? "partially_paid" : dateOnly(payment.due_date)! < new Date().toISOString().slice(0, 10) ? "overdue" : "open",
          lastPaymentAt: payment.last_payment_at ?? null,
        };
      }),
      timeline,
      history: timeline.map(event => ({
        fromStatus: (event.before as { status?: string } | null)?.status ?? null,
        toStatus: (event.after as { status?: string } | null)?.status ?? event.action,
        reason: (event.after as { reason?: string } | null)?.reason ?? null,
        createdAt: event.createdAt,
      })),
      documents,
    };
  }

  private async sourcePublicId(executor: Pool | PoolConnection, table: string, id: unknown) {
    if (!id) return null;
    if (!new Set(["erp_purchase_requests", "erp_purchase_quotes"]).has(table)) return null;
    const [rows] = await executor.execute<RowDataPacket[]>(`SELECT public_id FROM ${table} WHERE id=? LIMIT 1`, [id]);
    return rows[0] ? String(rows[0].public_id) : null;
  }

  private async timeline(
    executor: Pool | PoolConnection,
    clientId: string,
    target: { requestId?: number; orderId?: number }
  ) {
    const conditions = ["e.client_id=?"];
    const values: Array<string | number> = [clientId];
    if (target.orderId) {
      conditions.push("e.purchase_order_id=?");
      values.push(target.orderId);
    } else if (target.requestId) {
      conditions.push("e.purchase_request_id=?");
      values.push(target.requestId);
    }
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT e.* FROM erp_purchase_events e WHERE ${conditions.join(" AND ")} ORDER BY e.created_at,e.id LIMIT 500`,
      values
    );
    return rows.map(event => ({
      publicId: String(event.public_id),
      entityType: String(event.entity_type),
      entityPublicId: String(event.entity_public_id),
      action: String(event.action),
      actorType: String(event.actor_type),
      actorUserId: event.actor_user_id ?? null,
      actorName: event.actor_name_snapshot ?? (event.actor_type === "system" ? "Sistema" : "Usuário indisponível"),
      actorRole: event.actor_role ?? null,
      summary: String(event.summary),
      before: parseJson(event.before_json),
      after: parseJson(event.after_json),
      metadata: parseJson(event.metadata_json),
      correlationId: event.correlation_id ?? null,
      createdAt: event.created_at,
    }));
  }

  private async documents(
    executor: Pool | PoolConnection,
    clientId: string,
    target: { requestId?: number; quoteId?: number; orderId?: number }
  ) {
    const column = target.orderId ? "purchase_order_id" : target.quoteId ? "purchase_quote_id" : "purchase_request_id";
    const id = target.orderId ?? target.quoteId ?? target.requestId;
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT l.public_id,l.document_type,l.created_at,f.public_id supplier_file_public_id,f.file_name,f.category,f.mime_type,f.size_bytes,s.public_id supplier_public_id
       FROM erp_purchase_document_links l
       INNER JOIN erp_supplier_files f ON f.id=l.supplier_file_id AND f.client_id=l.client_id AND f.state='active'
       INNER JOIN erp_suppliers s ON s.id=f.supplier_id AND s.client_id=f.client_id
       WHERE l.client_id=? AND l.${column}=? ORDER BY l.created_at DESC,l.id DESC`,
      [clientId, id]
    );
    return rows.map(document => ({
      publicId: String(document.public_id),
      supplierFilePublicId: String(document.supplier_file_public_id),
      supplierPublicId: String(document.supplier_public_id),
      documentType: String(document.document_type),
      fileName: String(document.file_name),
      category: String(document.category),
      mimeType: String(document.mime_type),
      sizeBytes: Number(document.size_bytes),
      downloadUrl: `/api/erp/suppliers/${document.supplier_public_id}/files/${document.supplier_file_public_id}`,
      createdAt: document.created_at,
    }));
  }

  private async resolveOrderReferences(
    connection: PoolConnection,
    actor: PurchaseActor,
    input: PurchaseDraftInput
  ) {
    const [suppliers] = await connection.execute<RowDataPacket[]>(
      "SELECT id,public_id,legal_name FROM erp_suppliers WHERE client_id=? AND public_id=? AND active=1 LIMIT 1",
      [actor.clientId, input.supplierPublicId]
    );
    if (!suppliers[0]) throw new ErpDomainError("NOT_FOUND", "Fornecedor ativo não encontrado.");
    const products: Array<{
      id: number;
      name: string;
      sku: string;
      productPublicId: string;
      inventoryItemId: number;
      inventoryItemPublicId: string | null;
      quantity: string;
      unitCostCents: number;
      discountCents: number;
      lineTotalCents: number;
    }> = [];
    for (const item of input.items) {
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT id,public_id,name,sku,minimum_stock FROM erp_products WHERE client_id=? AND public_id=? AND active=1 LIMIT 1",
        [actor.clientId, item.productPublicId]
      );
      if (!rows[0]) throw new ErpDomainError("INACTIVE_PRODUCT", "Produto ativo não encontrado.");
      const inventoryItem = await this.inventory().resolveForOperation(connection, {
        clientId: actor.clientId,
        productId: Number(rows[0].id),
        requestedPublicId: item.inventoryItemPublicId ?? null,
        userId: actor.userId,
        productMinimumStock: String(rows[0].minimum_stock ?? "0.000"),
      });
      const normalizedQuantity = millisQuantity(quantityMillis(item.quantity));
      products.push({
        id: Number(rows[0].id),
        name: String(rows[0].name),
        sku: String(rows[0].sku),
        productPublicId: String(rows[0].public_id),
        inventoryItemId: inventoryItem.id,
        inventoryItemPublicId: inventoryItem.public_id ?? null,
        quantity: normalizedQuantity,
        unitCostCents: item.unitCostCents,
        discountCents: item.discountCents,
        lineTotalCents: lineTotalCents(normalizedQuantity, item.unitCostCents, item.discountCents),
      });
    }
    if (hasDuplicateResolvedInventoryItem(products)) {
      throw new ErpDomainError("CONFLICT", "Inventory item duplicado no pedido.");
    }
    const subtotal = safeMoneySum(products.map(product => product.lineTotalCents));
    if (input.discountCents > subtotal) {
      throw new ErpDomainError("VALIDATION", "Desconto geral excede o subtotal do pedido.");
    }
    const total = safePurchaseTotal(
      subtotal,
      input.discountCents,
      input.freightCents,
      input.otherExpensesCents
    );
    const installmentTotal = safeMoneySum(input.installments.map(installment => installment.amountCents));
    if (input.installments.length && installmentTotal !== total) {
      throw new ErpDomainError("VALIDATION", "A soma das parcelas deve ser exatamente igual ao total do pedido.");
    }
    return { supplier: suppliers[0], products, subtotal, total };
  }

  private async insertOrder(
    connection: PoolConnection,
    actor: PurchaseActor,
    input: PurchaseDraftInput,
    source: { type: "direct" | "request" | "quote"; requestId?: number | null; quoteId?: number | null }
  ) {
    const refs = await this.resolveOrderReferences(connection, actor, input);
    const publicId = randomUUID();
    const number = await this.nextOrderNumber(connection, actor.clientId);
    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO erp_purchase_orders
       (public_id,client_id,order_number,creation_idempotency_key,supplier_id,supplier_name_snapshot,source_type,purchase_request_id,purchase_quote_id,responsible_user_id,status,notes,expected_date,subtotal_cents,discount_cents,freight_cents,other_expenses_cents,total_cents,payment_terms,created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?)`,
      [
        publicId,
        actor.clientId,
        number,
        input.idempotencyKey ?? null,
        refs.supplier.id,
        refs.supplier.legal_name,
        source.type,
        source.requestId ?? null,
        source.quoteId ?? null,
        input.responsibleUserId ?? null,
        input.notes,
        input.expectedDate,
        refs.subtotal,
        input.discountCents,
        input.freightCents,
        input.otherExpensesCents,
        refs.total,
        input.paymentTerms,
        actor.userId,
      ]
    );
    for (const product of refs.products) {
      await connection.execute(
        `INSERT INTO erp_purchase_order_items
         (public_id,purchase_order_id,product_id,inventory_item_id,product_name_snapshot,sku_snapshot,quantity,unit_cost_cents,discount_cents,line_total_cents)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(), inserted.insertId, product.id, product.inventoryItemId, product.name, product.sku, product.quantity, product.unitCostCents, product.discountCents, product.lineTotalCents]
      );
    }
    for (const [index, installment] of input.installments.entries()) {
      await connection.execute(
        "INSERT INTO erp_purchase_order_installments(public_id,client_id,purchase_order_id,installment_number,due_date,amount_cents) VALUES(?,?,?,?,?,?)",
        [randomUUID(), actor.clientId, inserted.insertId, index + 1, installment.dueDate, installment.amountCents]
      );
    }
    await connection.execute(
      "INSERT INTO erp_purchase_order_history(purchase_order_id,from_status,to_status,changed_by) VALUES(?,NULL,'draft',?)",
      [inserted.insertId, actor.userId]
    );
    await this.event(connection, {
      requestId: source.requestId ?? null,
      quoteId: source.quoteId ?? null,
      orderId: inserted.insertId,
      entityType: "order",
      entityPublicId: publicId,
      action: "order_created",
      summary: `Pedido ${number} criado.`,
      actor,
      after: {
        orderNumber: number,
        sourceType: source.type,
        supplierPublicId: input.supplierPublicId,
        totalCents: refs.total,
        items: refs.products.map(product => ({
          productPublicId: product.productPublicId,
          inventoryItemPublicId: product.inventoryItemPublicId,
          quantity: product.quantity,
          unitCostCents: product.unitCostCents,
        })),
      },
    });
    return { publicId, orderId: inserted.insertId, orderNumber: number };
  }

  async createOrder(actor: PurchaseActor, input: PurchaseDraftInput) {
    const connection = await this.db().getConnection();
    const idempotencyLock = input.idempotencyKey
      ? `purchase:${createHash("sha256").update(`${actor.clientId}:${input.idempotencyKey}`).digest("hex").slice(0, 48)}`
      : null;
    try {
      if (idempotencyLock) {
        const [locks] = await connection.execute<RowDataPacket[]>("SELECT GET_LOCK(?,10) acquired", [idempotencyLock]);
        if (Number(locks[0]?.acquired) !== 1) {
          throw new ErpDomainError("CONFLICT", "Outra criacao com a mesma chave ainda esta em andamento.");
        }
      }
      await connection.beginTransaction();
      if (input.idempotencyKey) {
        const [existing] = await connection.execute<RowDataPacket[]>(
          "SELECT public_id FROM erp_purchase_orders WHERE client_id=? AND creation_idempotency_key=? LIMIT 1 FOR UPDATE",
          [actor.clientId, input.idempotencyKey]
        );
        if (existing[0]) {
          await this.assertOrderReplay(
            connection,
            actor.clientId,
            String(existing[0].public_id),
            input
          );
          await connection.commit();
          return { order: await this.orderDetail(actor.clientId, String(existing[0].public_id)), replay: true };
        }
      }
      const created = await this.insertOrder(connection, actor, input, { type: "direct" });
      await connection.commit();
      return { order: await this.orderDetail(actor.clientId, created.publicId), replay: false };
    } catch (error) {
      await connection.rollback();
      if (input.idempotencyKey && isDuplicateKey(error)) {
        const [existing] = await this.db().execute<RowDataPacket[]>(
          "SELECT public_id FROM erp_purchase_orders WHERE client_id=? AND creation_idempotency_key=? LIMIT 1",
          [actor.clientId, input.idempotencyKey]
        );
        if (existing[0]) {
          await this.assertOrderReplay(
            this.db(),
            actor.clientId,
            String(existing[0].public_id),
            input
          );
          return {
            order: await this.orderDetail(actor.clientId, String(existing[0].public_id)),
            replay: true,
          };
        }
      }
      throw error;
    } finally {
      if (idempotencyLock) {
        await connection.execute("SELECT RELEASE_LOCK(?)", [idempotencyLock]).catch(() => undefined);
      }
      connection.release();
    }
  }

  async updateOrder(actor: PurchaseActor, publicId: string, input: PurchaseDraftInput) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const row = await this.orderRow(connection, actor.clientId, publicId, true);
      if (!row) throw new ErpDomainError("NOT_FOUND", "Pedido não encontrado.");
      if (row.status !== "draft") throw new ErpDomainError("CONFLICT", "Somente pedido em rascunho pode ser editado.");
      const before = compactOrderSnapshot(await this.orderDetail(actor.clientId, publicId, connection));
      const refs = await this.resolveOrderReferences(connection, actor, input);
      await connection.execute("DELETE FROM erp_purchase_order_installments WHERE client_id=? AND purchase_order_id=?", [actor.clientId, row.id]);
      await connection.execute("DELETE FROM erp_purchase_order_items WHERE purchase_order_id=?", [row.id]);
      for (const product of refs.products) {
        await connection.execute(
          `INSERT INTO erp_purchase_order_items
           (public_id,purchase_order_id,product_id,inventory_item_id,product_name_snapshot,sku_snapshot,quantity,unit_cost_cents,discount_cents,line_total_cents)
           VALUES(?,?,?,?,?,?,?,?,?,?)`,
          [randomUUID(), row.id, product.id, product.inventoryItemId, product.name, product.sku, product.quantity, product.unitCostCents, product.discountCents, product.lineTotalCents]
        );
      }
      for (const [index, installment] of input.installments.entries()) {
        await connection.execute(
          "INSERT INTO erp_purchase_order_installments(public_id,client_id,purchase_order_id,installment_number,due_date,amount_cents) VALUES(?,?,?,?,?,?)",
          [randomUUID(), actor.clientId, row.id, index + 1, installment.dueDate, installment.amountCents]
        );
      }
      await connection.execute(
        `UPDATE erp_purchase_orders SET supplier_id=?,supplier_name_snapshot=?,responsible_user_id=?,notes=?,expected_date=?,subtotal_cents=?,discount_cents=?,freight_cents=?,other_expenses_cents=?,total_cents=?,payment_terms=? WHERE client_id=? AND id=?`,
        [refs.supplier.id, refs.supplier.legal_name, input.responsibleUserId, input.notes, input.expectedDate, refs.subtotal, input.discountCents, input.freightCents, input.otherExpensesCents, refs.total, input.paymentTerms, actor.clientId, row.id]
      );
      const after = compactOrderSnapshot(await this.orderDetail(actor.clientId, publicId, connection));
      await this.event(connection, {
        requestId: row.purchase_request_id ? Number(row.purchase_request_id) : null,
        quoteId: row.purchase_quote_id ? Number(row.purchase_quote_id) : null,
        orderId: Number(row.id),
        entityType: "order",
        entityPublicId: publicId,
        action: "order_updated",
        summary: `Pedido ${row.order_number} atualizado.`,
        actor,
        before,
        after,
      });
      await connection.commit();
      return this.orderDetail(actor.clientId, publicId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async createOrderFromRequest(actor: PurchaseActor, input: RequestToOrderInput) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const request = await this.requestRow(connection, actor.clientId, input.requestPublicId, true);
      if (!request) throw new ErpDomainError("NOT_FOUND", "Solicitação não encontrada.");
      if (request.status !== "approved") throw new ErpDomainError("CONFLICT", "Solicitação precisa estar aprovada.");
      const [existing] = await connection.execute<RowDataPacket[]>(
        "SELECT public_id,creation_idempotency_key FROM erp_purchase_orders WHERE client_id=? AND purchase_request_id=? LIMIT 1",
        [actor.clientId, request.id]
      );
      if (existing[0]) {
        if ((existing[0].creation_idempotency_key ? String(existing[0].creation_idempotency_key) : null) !== (input.idempotencyKey ?? null)) {
          throw new ErpDomainError("IDEMPOTENCY_CONFLICT", "Solicitacao ja convertida com outra chave idempotente.");
        }
        const { requestPublicId: _requestPublicId, ...draft } = input;
        await this.assertOrderReplay(connection, actor.clientId, String(existing[0].public_id), draft, "request");
        await connection.commit();
        return { order: await this.orderDetail(actor.clientId, String(existing[0].public_id)), replay: true };
      }
      const [quote] = await connection.execute<RowDataPacket[]>(
        "SELECT status FROM erp_purchase_quotes WHERE client_id=? AND purchase_request_id=? LIMIT 1",
        [actor.clientId, request.id]
      );
      if (quote[0]) throw new ErpDomainError("CONFLICT", "Solicitação com cotação deve ser convertida pelo fornecedor selecionado.");
      const { requestPublicId: _requestPublicId, ...draft } = input;
      const created = await this.insertOrder(connection, actor, draft, { type: "request", requestId: Number(request.id) });
      await connection.commit();
      return { order: await this.orderDetail(actor.clientId, created.publicId), replay: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async createOrderFromQuote(actor: PurchaseActor, input: QuoteToOrderInput) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const [quotes] = await connection.execute<RowDataPacket[]>(
        `SELECT q.*,s.public_id supplier_public_id,p.payment_terms,p.freight_cents
         FROM erp_purchase_quotes q
         INNER JOIN erp_purchase_quote_proposals p ON p.id=q.selected_proposal_id AND p.quote_id=q.id
         INNER JOIN erp_suppliers s ON s.id=p.supplier_id AND s.client_id=q.client_id
         WHERE q.client_id=? AND q.public_id=? LIMIT 1 FOR UPDATE`,
        [actor.clientId, input.quotePublicId]
      );
      const quote = quotes[0];
      if (!quote) throw new ErpDomainError("NOT_FOUND", "Cotação selecionada não encontrada.");
      if (quote.status !== "selected") throw new ErpDomainError("CONFLICT", "Selecione uma proposta antes de criar o pedido.");
      const [items] = await connection.execute<RowDataPacket[]>(
        `SELECT pr.public_id product_public_id,ii.public_id inventory_item_public_id,ri.quantity,pi.unit_cost_cents,pi.discount_cents
         FROM erp_purchase_quotes q
         INNER JOIN erp_purchase_quote_proposal_items pi ON pi.proposal_id=q.selected_proposal_id
         INNER JOIN erp_purchase_request_items ri ON ri.id=pi.request_item_id AND ri.purchase_request_id=q.purchase_request_id
         INNER JOIN erp_products pr ON pr.id=ri.product_id AND pr.client_id=?
         LEFT JOIN erp_inventory_items ii ON ii.id=ri.inventory_item_id AND ii.client_id=ri.client_id
         WHERE q.id=?
         ORDER BY ri.id`,
        [actor.clientId, quote.id]
      );
      const [requestItemCount] = await connection.execute<RowDataPacket[]>(
        "SELECT COUNT(*) total FROM erp_purchase_request_items WHERE client_id=? AND purchase_request_id=?",
        [actor.clientId, quote.purchase_request_id]
      );
      if (items.length !== Number(requestItemCount[0].total)) {
        throw new ErpDomainError("CONFLICT", "Itens não catalogados precisam ser cadastrados antes de gerar o pedido.");
      }
      const draft: PurchaseDraftInput = {
        supplierPublicId: String(quote.supplier_public_id),
        responsibleUserId: input.responsibleUserId,
        notes: input.notes,
        expectedDate: input.expectedDate,
        discountCents: input.discountCents,
        freightCents: Number(quote.freight_cents),
        otherExpensesCents: input.otherExpensesCents,
        paymentTerms: quote.payment_terms ? String(quote.payment_terms) : null,
        installments: input.installments,
        items: items.map(item => ({
          productPublicId: String(item.product_public_id),
          inventoryItemPublicId: item.inventory_item_public_id ? String(item.inventory_item_public_id) : null,
          quantity: String(item.quantity),
          unitCostCents: Number(item.unit_cost_cents),
          discountCents: Number(item.discount_cents),
        })),
      };
      const [existing] = await connection.execute<RowDataPacket[]>(
        "SELECT public_id FROM erp_purchase_orders WHERE client_id=? AND purchase_quote_id=? LIMIT 1",
        [actor.clientId, quote.id]
      );
      if (existing[0]) {
        await this.assertOrderReplay(connection, actor.clientId, String(existing[0].public_id), draft, "quote");
        await connection.commit();
        return { order: await this.orderDetail(actor.clientId, String(existing[0].public_id)), replay: true };
      }
      const created = await this.insertOrder(connection, actor, draft, {
        type: "quote",
        requestId: Number(quote.purchase_request_id),
        quoteId: Number(quote.id),
      });
      await connection.commit();
      return { order: await this.orderDetail(actor.clientId, created.publicId), replay: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async purchaseCategory(connection: PoolConnection, clientId: string) {
    await connection.execute(
      "INSERT IGNORE INTO erp_financial_categories(public_id,client_id,name,direction,active) VALUES(?,?,\'Compras (sistema)\',\'payable\',1)",
      [randomUUID(), clientId]
    );
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM erp_financial_categories WHERE client_id=? AND name='Compras (sistema)' AND active=1 AND direction IN ('payable','both') LIMIT 1",
      [clientId]
    );
    if (!rows[0]) throw new ErpDomainError("CONFLICT", "Categoria financeira de Compras está incompatível ou inativa.");
    return Number(rows[0].id);
  }

  async approveOrder(actor: PurchaseActor, publicId: string, correlationId: string) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const row = await this.orderRow(connection, actor.clientId, publicId, true);
      if (!row) throw new ErpDomainError("NOT_FOUND", "Pedido não encontrado.");
      if (row.status === "approved" || row.status === "received") {
        await connection.commit();
        return { order: await this.orderDetail(actor.clientId, publicId), replay: true };
      }
      if (row.status !== "draft") throw new ErpDomainError("CONFLICT", "Pedido não pode ser confirmado neste estado.");
      let [installments] = await connection.execute<RowDataPacket[]>(
        "SELECT * FROM erp_purchase_order_installments WHERE client_id=? AND purchase_order_id=? ORDER BY installment_number FOR UPDATE",
        [actor.clientId, row.id]
      );
      if (!installments.length) {
        await connection.execute(
          "INSERT INTO erp_purchase_order_installments(public_id,client_id,purchase_order_id,installment_number,due_date,amount_cents) VALUES(?,?,?,1,COALESCE(?,CURRENT_DATE),?)",
          [randomUUID(), actor.clientId, row.id, dateOnly(row.expected_date), row.total_cents]
        );
        [installments] = await connection.execute<RowDataPacket[]>(
          "SELECT * FROM erp_purchase_order_installments WHERE client_id=? AND purchase_order_id=? ORDER BY installment_number FOR UPDATE",
          [actor.clientId, row.id]
        );
      }
      if (safeMoneySum(installments.map(item => Number(item.amount_cents))) !== Number(row.total_cents)) {
        throw new ErpDomainError("CONFLICT", "Plano de pagamento diverge do total do pedido.");
      }
      const categoryId = await this.purchaseCategory(connection, actor.clientId);
      for (const installment of installments) {
        const [existing] = await connection.execute<RowDataPacket[]>(
          "SELECT id FROM erp_financial_entries WHERE client_id=? AND source_type='purchase_order' AND source_public_id=? AND source_installment=? LIMIT 1",
          [actor.clientId, publicId, installment.installment_number]
        );
        let financialEntryId: number;
        if (existing[0]) {
          financialEntryId = Number(existing[0].id);
        } else {
          const financialPublicId = randomUUID();
          const [created] = await connection.execute<ResultSetHeader>(
            `INSERT INTO erp_financial_entries
             (public_id,client_id,document_number,direction,status,description,amount_cents,due_date,issue_date,category_id,supplier_id,source_type,source_public_id,source_installment,party_name_snapshot,notes,created_by)
             VALUES(?,?,?,'payable','open',?,?,?,CURRENT_DATE,?,?,'purchase_order',?,?,?,NULL,?)`,
            [
              financialPublicId,
              actor.clientId,
              `${row.order_number}/${installment.installment_number}`,
              `Compra ${row.order_number} · parcela ${installment.installment_number}/${installments.length}`,
              installment.amount_cents,
              dateOnly(installment.due_date),
              categoryId,
              row.supplier_id,
              publicId,
              installment.installment_number,
              row.supplier_name_snapshot,
              actor.userId,
            ]
          );
          financialEntryId = created.insertId;
        }
        await connection.execute(
          "UPDATE erp_purchase_order_installments SET financial_entry_id=? WHERE client_id=? AND id=?",
          [financialEntryId, actor.clientId, installment.id]
        );
      }
      await connection.execute(
        "UPDATE erp_purchase_orders SET status='approved',approved_by=?,approved_at=NOW() WHERE client_id=? AND id=?",
        [actor.userId, actor.clientId, row.id]
      );
      await connection.execute(
        "INSERT INTO erp_purchase_order_history(purchase_order_id,from_status,to_status,changed_by) VALUES(?,'draft','approved',?)",
        [row.id, actor.userId]
      );
      await connection.execute(
        "INSERT INTO erp_purchase_approvals(public_id,client_id,purchase_order_id,status,requested_by,decided_by,decided_at,justification) VALUES(?,?,?,'approved',?,?,NOW(),'Confirmação do pedido')",
        [randomUUID(), actor.clientId, row.id, actor.userId, actor.userId]
      );
      await this.event(connection, {
        requestId: row.purchase_request_id ? Number(row.purchase_request_id) : null,
        quoteId: row.purchase_quote_id ? Number(row.purchase_quote_id) : null,
        orderId: Number(row.id),
        entityType: "order",
        entityPublicId: publicId,
        action: "order_confirmed",
        summary: `Pedido ${row.order_number} confirmado.`,
        actor,
        before: { status: row.status },
        after: { status: "approved" },
        correlationId,
      });
      await this.event(connection, {
        requestId: row.purchase_request_id ? Number(row.purchase_request_id) : null,
        quoteId: row.purchase_quote_id ? Number(row.purchase_quote_id) : null,
        orderId: Number(row.id),
        entityType: "financial",
        entityPublicId: publicId,
        action: "financial_entries_generated",
        summary: `Sistema gerou ${installments.length} parcela(s) no Contas a Pagar a partir de ${row.order_number}.`,
        actor: null,
        after: { installments: installments.map(item => ({ number: Number(item.installment_number), amountCents: Number(item.amount_cents), dueDate: dateOnly(item.due_date) })) },
        metadata: { clientId: actor.clientId, origin: "purchase_order_confirmation" },
        correlationId,
      });
      await connection.commit();
      return { order: await this.orderDetail(actor.clientId, publicId), replay: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async cancelOrder(actor: PurchaseActor, publicId: string, reason: string) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const [financialEntries] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM erp_financial_entries
         WHERE client_id=? AND source_type='purchase_order' AND source_public_id=?
         ORDER BY id FOR UPDATE`,
        [actor.clientId, publicId]
      );
      const row = await this.orderRow(connection, actor.clientId, publicId, true);
      if (!row) throw new ErpDomainError("NOT_FOUND", "Pedido não encontrado.");
      if (row.status === "cancelled") {
        await connection.commit();
        return { order: await this.orderDetail(actor.clientId, publicId), replay: true };
      }
      const [receipts] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM erp_purchase_order_receipts WHERE client_id=? AND purchase_order_id=? FOR UPDATE",
        [actor.clientId, row.id]
      );
      const financialEntryIds = financialEntries.map(entry => Number(entry.id));
      let settlements: RowDataPacket[] = [];
      if (financialEntryIds.length) {
        const placeholders = financialEntryIds.map(() => "?").join(",");
        [settlements] = await connection.execute<RowDataPacket[]>(
          `SELECT amount_cents FROM erp_financial_settlements
           WHERE client_id=? AND financial_entry_id IN (${placeholders}) FOR UPDATE`,
          [actor.clientId, ...financialEntryIds]
        );
      }
      const paidCents = settlements.reduce((sum, settlement) => sum + BigInt(String(settlement.amount_cents)), 0n);
      if (receipts.length > 0) {
        throw new ErpDomainError("CONFLICT", "Pedido com recebimento exige reversão explícita de estoque antes do cancelamento.");
      }
      if (paidCents > 0n) {
        throw new ErpDomainError("CONFLICT", "Pedido com pagamento exige estorno ou crédito financeiro antes do cancelamento.");
      }
      await connection.execute(
        "UPDATE erp_financial_entries SET status='cancelled',cancelled_at=NOW(),cancelled_by=?,cancellation_reason=? WHERE client_id=? AND source_type='purchase_order' AND source_public_id=? AND status='open'",
        [actor.userId, `Pedido cancelado: ${reason}`, actor.clientId, publicId]
      );
      await connection.execute(
        "UPDATE erp_purchase_orders SET status='cancelled',cancelled_by=?,cancelled_at=NOW(),cancellation_reason=? WHERE client_id=? AND id=?",
        [actor.userId, reason, actor.clientId, row.id]
      );
      await connection.execute(
        "INSERT INTO erp_purchase_order_history(purchase_order_id,from_status,to_status,reason,changed_by) VALUES(?,?,'cancelled',?,?)",
        [row.id, row.status, reason, actor.userId]
      );
      await this.event(connection, {
        requestId: row.purchase_request_id ? Number(row.purchase_request_id) : null,
        quoteId: row.purchase_quote_id ? Number(row.purchase_quote_id) : null,
        orderId: Number(row.id),
        entityType: "order",
        entityPublicId: publicId,
        action: "order_cancelled",
        summary: `Pedido ${row.order_number} cancelado.`,
        actor,
        before: { status: row.status },
        after: { status: "cancelled", reason },
      });
      await connection.commit();
      return { order: await this.orderDetail(actor.clientId, publicId), replay: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async linkDocument(
    actor: PurchaseActor,
    input: {
      entityType: "request" | "quote" | "order";
      entityPublicId: string;
      supplierFilePublicId: string;
      documentType: "proposal" | "budget" | "purchase_order" | "invoice" | "receipt" | "payment_proof" | "other";
    }
  ) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const entityTable = {
        request: "erp_purchase_requests",
        quote: "erp_purchase_quotes",
        order: "erp_purchase_orders",
      }[input.entityType];
      const [entities] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM ${entityTable} WHERE client_id=? AND public_id=? LIMIT 1 FOR UPDATE`,
        [actor.clientId, input.entityPublicId]
      );
      const entity = entities[0];
      if (!entity) throw new ErpDomainError("NOT_FOUND", "Registro de compras nao encontrado.");
      const [files] = await connection.execute<RowDataPacket[]>(
        `SELECT f.* FROM erp_supplier_files f
         WHERE f.client_id=? AND f.public_id=? AND f.state='active' LIMIT 1`,
        [actor.clientId, input.supplierFilePublicId]
      );
      const file = files[0];
      if (!file) throw new ErpDomainError("NOT_FOUND", "Arquivo ativo do fornecedor nao encontrado.");
      if (input.entityType === "order" && Number(entity.supplier_id) !== Number(file.supplier_id)) {
        throw new ErpDomainError("CONFLICT", "O arquivo deve pertencer ao fornecedor do pedido.");
      }
      if (input.entityType === "quote") {
        const [allowed] = await connection.execute<RowDataPacket[]>(
          "SELECT 1 allowed FROM erp_purchase_quote_proposals WHERE client_id=? AND quote_id=? AND supplier_id=? LIMIT 1",
          [actor.clientId, entity.id, file.supplier_id]
        );
        if (!allowed[0]) {
          throw new ErpDomainError("CONFLICT", "O arquivo deve pertencer a um fornecedor participante da cotacao.");
        }
      }
      const entityColumns = {
        request: ["purchase_request_id", Number(entity.id), Number(entity.id), null, null],
        quote: ["purchase_quote_id", Number(entity.id), null, Number(entity.id), null],
        order: ["purchase_order_id", Number(entity.id), null, null, Number(entity.id)],
      } as const;
      const [entityColumn, entityId, requestId, quoteId, orderId] = entityColumns[input.entityType];
      const [existing] = await connection.execute<RowDataPacket[]>(
        `SELECT public_id FROM erp_purchase_document_links
         WHERE client_id=? AND supplier_file_id=? AND ${entityColumn}=? LIMIT 1`,
        [actor.clientId, file.id, entityId]
      );
      if (existing[0]) {
        await connection.commit();
        return { publicId: String(existing[0].public_id), replay: true };
      }
      const publicId = randomUUID();
      await connection.execute(
        `INSERT INTO erp_purchase_document_links
         (public_id,client_id,purchase_request_id,purchase_quote_id,purchase_order_id,supplier_file_id,document_type,linked_by)
         VALUES(?,?,?,?,?,?,?,?)`,
        [publicId, actor.clientId, requestId, quoteId, orderId, file.id, input.documentType, actor.userId]
      );
      await this.event(connection, {
        requestId,
        quoteId,
        orderId,
        entityType: "document",
        entityPublicId: publicId,
        action: "document_linked",
        summary: `${actor.userName?.trim() || "Usuario"} vinculou o arquivo ${file.file_name}.`,
        actor,
        after: {
          documentType: input.documentType,
          supplierFilePublicId: input.supplierFilePublicId,
          fileName: String(file.file_name),
        },
      });
      await connection.commit();
      return { publicId, replay: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async summary(clientId: string) {
    const [rows] = await this.db().execute<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM erp_purchase_requests r WHERE r.client_id=? AND r.status='pending_approval') pending_approvals,
         (SELECT COUNT(*) FROM erp_purchase_orders o WHERE o.client_id=? AND o.status IN ('draft','approved')) open_orders,
         (SELECT COUNT(*) FROM erp_purchase_orders o WHERE o.client_id=? AND o.status='approved' AND COALESCE((SELECT SUM(ri.quantity) FROM erp_purchase_order_receipt_items ri INNER JOIN erp_purchase_order_items oi ON oi.id=ri.purchase_order_item_id WHERE oi.purchase_order_id=o.id),0) < (SELECT COALESCE(SUM(oi.quantity),0) FROM erp_purchase_order_items oi WHERE oi.purchase_order_id=o.id)) awaiting_receipt,
         (SELECT COUNT(*) FROM erp_purchase_orders o WHERE o.client_id=? AND o.status='approved' AND o.expected_date<CURRENT_DATE) overdue_orders,
         (SELECT COALESCE(SUM(o.total_cents),0) FROM erp_purchase_orders o WHERE o.client_id=? AND o.status<>'cancelled' AND o.created_at>=DATE_FORMAT(CURRENT_DATE,'%Y-%m-01')) purchased_month_cents,
         (SELECT COALESCE(SUM(e.amount_cents),0)-COALESCE(SUM((SELECT SUM(s.amount_cents) FROM erp_financial_settlements s WHERE s.client_id=e.client_id AND s.financial_entry_id=e.id)),0) FROM erp_financial_entries e WHERE e.client_id=? AND e.source_type='purchase_order' AND e.status='open') payable_pending_cents`,
      [clientId, clientId, clientId, clientId, clientId, clientId]
    );
    const row = rows[0] ?? {};
    return {
      pendingApprovals: Number(row.pending_approvals ?? 0),
      openOrders: Number(row.open_orders ?? 0),
      awaitingReceipt: Number(row.awaiting_receipt ?? 0),
      overdueOrders: Number(row.overdue_orders ?? 0),
      purchasedMonthCents: Number(row.purchased_month_cents ?? 0),
      payablePendingCents: Number(row.payable_pending_cents ?? 0),
    };
  }

  async supplierMetrics(clientId: string, supplierPublicId: string) {
    const [suppliers] = await this.db().execute<RowDataPacket[]>(
      "SELECT id,public_id,name FROM erp_suppliers WHERE client_id=? AND public_id=? LIMIT 1",
      [clientId, supplierPublicId]
    );
    const supplier = suppliers[0];
    if (!supplier) throw new ErpDomainError("NOT_FOUND", "Fornecedor nao encontrado.");
    const [metrics] = await this.db().execute<RowDataPacket[]>(
      `SELECT COUNT(*) order_count,COALESCE(SUM(o.total_cents),0) purchased_cents,
              COALESCE(AVG(CASE WHEN o.received_at IS NOT NULL THEN TIMESTAMPDIFF(DAY,o.created_at,o.received_at) END),0) average_lead_days,
              COALESCE(SUM(CASE WHEN o.received_at IS NOT NULL AND o.expected_date IS NOT NULL AND DATE(o.received_at)<=o.expected_date THEN 1 ELSE 0 END),0) on_time_count,
              COALESCE(SUM(CASE WHEN o.received_at IS NOT NULL AND o.expected_date IS NOT NULL THEN 1 ELSE 0 END),0) measured_count
       FROM erp_purchase_orders o WHERE o.client_id=? AND o.supplier_id=? AND o.status<>'cancelled'`,
      [clientId, supplier.id]
    );
    const [financial] = await this.db().execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(e.amount_cents),0) launched_cents,
              COALESCE(SUM((SELECT SUM(s.amount_cents) FROM erp_financial_settlements s WHERE s.client_id=e.client_id AND s.financial_entry_id=e.id)),0) paid_cents
       FROM erp_financial_entries e
       WHERE e.client_id=? AND e.supplier_id=? AND e.source_type='purchase_order' AND e.status<>'cancelled'`,
      [clientId, supplier.id]
    );
    const [orders] = await this.db().execute<RowDataPacket[]>(
      `SELECT o.public_id,o.order_number,o.status,o.total_cents,o.expected_date,o.received_at,o.created_at,
              COALESCE(SUM(ri.quantity),0) received_quantity,
              (SELECT COALESCE(SUM(i.quantity),0) FROM erp_purchase_order_items i WHERE i.purchase_order_id=o.id) ordered_quantity
       FROM erp_purchase_orders o
       LEFT JOIN erp_purchase_order_items oi ON oi.purchase_order_id=o.id
       LEFT JOIN erp_purchase_order_receipt_items ri ON ri.purchase_order_item_id=oi.id
       WHERE o.client_id=? AND o.supplier_id=?
       GROUP BY o.id ORDER BY o.created_at DESC,o.id DESC LIMIT 20`,
      [clientId, supplier.id]
    );
    const metric = metrics[0] ?? {};
    const finance = financial[0] ?? {};
    const measured = Number(metric.measured_count ?? 0);
    return {
      supplierPublicId: String(supplier.public_id),
      supplierName: String(supplier.name),
      orderCount: Number(metric.order_count ?? 0),
      purchasedCents: Number(metric.purchased_cents ?? 0),
      averageLeadDays: Number(Number(metric.average_lead_days ?? 0).toFixed(1)),
      onTimeRate: measured > 0 ? Math.round((Number(metric.on_time_count) / measured) * 100) : null,
      launchedCents: Number(finance.launched_cents ?? 0),
      paidCents: Number(finance.paid_cents ?? 0),
      pendingCents: Math.max(0, Number(finance.launched_cents ?? 0) - Number(finance.paid_cents ?? 0)),
      recentOrders: orders.map(order => ({
        publicId: String(order.public_id),
        orderNumber: String(order.order_number),
        status: String(order.status),
        totalCents: Number(order.total_cents),
        expectedDate: dateOnly(order.expected_date),
        receivedAt: order.received_at ?? null,
        receiptProgress:
          Number(order.ordered_quantity) > 0
            ? Math.min(100, Math.round((Number(order.received_quantity) / Number(order.ordered_quantity)) * 100))
            : 0,
        createdAt: order.created_at,
      })),
    };
  }

  async receiveOrder(actor: PurchaseActor, input: ReceiveInput) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const replayOrderPublicId = await this.receiptReplay(connection, actor.clientId, input);
      if (replayOrderPublicId) {
        await connection.commit();
        return { order: await this.orderDetail(actor.clientId, replayOrderPublicId), replay: true };
      }
      const [existing] = await connection.execute<RowDataPacket[]>(
        "SELECT o.public_id FROM erp_purchase_order_receipts r INNER JOIN erp_purchase_orders o ON o.id=r.purchase_order_id WHERE r.client_id=? AND r.idempotency_key=? LIMIT 1",
        [actor.clientId, input.idempotencyKey]
      );
      if (existing[0]) {
        if (String(existing[0].public_id) !== input.publicId) {
          throw new ErpDomainError("IDEMPOTENCY_CONFLICT", "Chave idempotente já usada em outro pedido.");
        }
        await connection.commit();
        return { order: await this.orderDetail(actor.clientId, input.publicId), replay: true };
      }
      const order = await this.orderRow(connection, actor.clientId, input.publicId, true);
      if (!order) throw new ErpDomainError("NOT_FOUND", "Pedido não encontrado.");
      if (order.status !== "approved" && order.status !== "received") {
        throw new ErpDomainError("CONFLICT", "Somente pedido confirmado pode ser recebido.");
      }
      const [items] = await connection.execute<RowDataPacket[]>(
        `SELECT i.*,p.public_id product_public_id,COALESCE(SUM(ri.quantity),0) received_quantity
         FROM erp_purchase_order_items i
         INNER JOIN erp_products p ON p.id=i.product_id AND p.client_id=?
         LEFT JOIN erp_purchase_order_receipt_items ri ON ri.purchase_order_item_id=i.id
         WHERE i.purchase_order_id=? GROUP BY i.id,p.public_id ORDER BY i.id`,
        [actor.clientId, order.id]
      );
      const byPublic = new Map(items.map(item => [String(item.public_id), item]));
      const requested = input.items.map(item => {
        const row = byPublic.get(item.orderItemPublicId);
        if (!row) throw new ErpDomainError("NOT_FOUND", "Item do pedido não encontrado.");
        const quantity = quantityMillis(item.quantity);
        const pending = quantityMillis(String(row.quantity)) - quantityMillis(String(row.received_quantity));
        if (quantity > pending) {
          throw new ErpDomainError("CONFLICT", `Quantidade recebida excede o saldo pendente de ${row.product_name_snapshot}.`);
        }
        if (row.inventory_item_id === null) {
          throw new ErpDomainError("CONFLICT", "Item de compra ainda não possui identidade de estoque preparada.");
        }
        return { row, quantity, normalized: millisQuantity(quantity) };
      });
      const [receiptCount] = await connection.execute<RowDataPacket[]>(
        "SELECT COUNT(*) total FROM erp_purchase_order_receipts WHERE client_id=? AND purchase_order_id=?",
        [actor.clientId, order.id]
      );
      const receiptPublicId = randomUUID();
      const receiptNumber = Number(receiptCount[0].total) + 1;
      const [receipt] = await connection.execute<ResultSetHeader>(
        "INSERT INTO erp_purchase_order_receipts(public_id,client_id,purchase_order_id,receipt_number,idempotency_key,notes,document_number,received_by) VALUES(?,?,?,?,?,?,?,?)",
        [receiptPublicId, actor.clientId, order.id, receiptNumber, input.idempotencyKey, input.notes, input.documentNumber, actor.userId]
      );
      const stockEvents: Array<{ productPublicId: string; quantity: string; movementPublicId: string }> = [];
      for (const item of requested) {
        await connection.execute(
          "INSERT IGNORE INTO erp_stock_balances(client_id,product_id,quantity,version) VALUES(?,?,0,0)",
          [actor.clientId, item.row.product_id]
        );
        const [balances] = await connection.execute<RowDataPacket[]>(
          "SELECT quantity FROM erp_stock_balances WHERE client_id=? AND product_id=? FOR UPDATE",
          [actor.clientId, item.row.product_id]
        );
        const previous = quantityMillis(String(balances[0].quantity));
        const resulting = previous + item.quantity;
        const itemPrevious = quantityMillis(await this.inventory().lockBalance(connection, actor.clientId, Number(item.row.inventory_item_id)));
        const itemResulting = itemPrevious + item.quantity;
        const movementPublicId = randomUUID();
        const itemKey = `${input.idempotencyKey}:${item.row.public_id}`;
        const payloadHash = createHash("sha256")
          .update(`${receiptPublicId}:${item.row.public_id}:${item.normalized}`)
          .digest("hex");
        const [movement] = await connection.execute<ResultSetHeader>(
          `INSERT INTO erp_stock_movements
           (public_id,client_id,product_id,inventory_item_id,type,direction,quantity,previous_balance,resulting_balance,inventory_previous_balance,inventory_resulting_balance,reason,reference_type,reference_id,idempotency_key,payload_hash,created_by)
           VALUES(?,?,?,?,'purchase_in','in',?,?,?,?,?,'Recebimento de pedido de compra','purchase',?,?,?,?)`,
          [movementPublicId, actor.clientId, item.row.product_id, item.row.inventory_item_id, item.normalized, millisQuantity(previous), millisQuantity(resulting), millisQuantity(itemPrevious), millisQuantity(itemResulting), receiptPublicId, itemKey, payloadHash, actor.userId]
        );
        await connection.execute(
          "UPDATE erp_stock_balances SET quantity=?,version=version+1 WHERE client_id=? AND product_id=?",
          [millisQuantity(resulting), actor.clientId, item.row.product_id]
        );
        await this.inventory().setBalance(connection, actor.clientId, Number(item.row.inventory_item_id), millisQuantity(itemResulting));
        await connection.execute(
          "INSERT INTO erp_purchase_order_receipt_items(receipt_id,purchase_order_item_id,product_id,inventory_item_id,quantity,stock_movement_id) VALUES(?,?,?,?,?,?)",
          [receipt.insertId, item.row.id, item.row.product_id, item.row.inventory_item_id, item.normalized, movement.insertId]
        );
        stockEvents.push({ productPublicId: String(item.row.product_public_id), quantity: item.normalized, movementPublicId });
      }
      const receivedAfter = items.reduce((sum, item) => sum + quantityMillis(String(item.received_quantity)), 0n) + requested.reduce((sum, item) => sum + item.quantity, 0n);
      const ordered = items.reduce((sum, item) => sum + quantityMillis(String(item.quantity)), 0n);
      if (receivedAfter === ordered) {
        await connection.execute(
          "UPDATE erp_purchase_orders SET status='received',received_by=?,received_at=NOW() WHERE client_id=? AND id=?",
          [actor.userId, actor.clientId, order.id]
        );
        if (order.status !== "received") {
          await connection.execute(
            "INSERT INTO erp_purchase_order_history(purchase_order_id,from_status,to_status,reason,changed_by) VALUES(?,?,'received','Recebimento integral',?)",
            [order.id, order.status, actor.userId]
          );
        }
      }
      await this.event(connection, {
        requestId: order.purchase_request_id ? Number(order.purchase_request_id) : null,
        quoteId: order.purchase_quote_id ? Number(order.purchase_quote_id) : null,
        orderId: Number(order.id),
        entityType: "receipt",
        entityPublicId: receiptPublicId,
        action: receivedAfter === ordered ? "receipt_completed" : "receipt_partial",
        summary: `${actor.userName?.trim() || "Usuário"} registrou o recebimento ${receiptNumber} de ${order.order_number}.`,
        actor,
        after: { receiptNumber, items: requested.map(item => ({ orderItemPublicId: String(item.row.public_id), quantity: item.normalized })) },
        correlationId: input.idempotencyKey,
      });
      await this.event(connection, {
        requestId: order.purchase_request_id ? Number(order.purchase_request_id) : null,
        quoteId: order.purchase_quote_id ? Number(order.purchase_quote_id) : null,
        orderId: Number(order.id),
        entityType: "stock",
        entityPublicId: receiptPublicId,
        action: "stock_entries_generated",
        summary: `Sistema gerou ${stockEvents.length} entrada(s) de estoque a partir do recebimento ${receiptNumber}.`,
        actor: null,
        after: { movements: stockEvents },
        metadata: { clientId: actor.clientId, origin: "purchase_receipt", receiptPublicId },
        correlationId: input.idempotencyKey,
      });
      await connection.commit();
      return { order: await this.orderDetail(actor.clientId, input.publicId), replay: false, stockProductPublicIds: stockEvents.map(event => event.productPublicId) };
    } catch (error) {
      await connection.rollback();
      if (isDuplicateKey(error)) {
        const replayOrderPublicId = await this.receiptReplay(this.db(), actor.clientId, input);
        if (replayOrderPublicId) {
          return { order: await this.orderDetail(actor.clientId, replayOrderPublicId), replay: true, stockProductPublicIds: [] };
        }
        const [existing] = await this.db().execute<RowDataPacket[]>(
          `SELECT o.public_id FROM erp_purchase_order_receipts r
           INNER JOIN erp_purchase_orders o ON o.id=r.purchase_order_id AND o.client_id=r.client_id
           WHERE r.client_id=? AND r.idempotency_key=? LIMIT 1`,
          [actor.clientId, input.idempotencyKey]
        );
        if (existing[0] && String(existing[0].public_id) === input.publicId) {
          return { order: await this.orderDetail(actor.clientId, input.publicId), replay: true, stockProductPublicIds: [] };
        }
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}
