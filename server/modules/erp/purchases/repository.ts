import { createHash, randomUUID } from "node:crypto";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { getPool } from "../../../db";
import { millisQuantity, quantityMillis } from "../contracts";
import { ErpDomainError } from "../errors";
import {
  canTransitionPurchase,
  lineTotalCents,
  type PurchaseDraftInput,
  type PurchaseListInput,
  type PurchaseStatus,
} from "./contracts";

type OrderRow = RowDataPacket & {
  id: number;
  public_id: string;
  client_id: string;
  order_number: string;
  supplier_id: number;
  supplier_public_id: string;
  supplier_name_snapshot: string;
  status: PurchaseStatus;
  notes: string | null;
  expected_date: string | null;
  subtotal_cents: number;
  total_cents: number;
  approved_at: string | null;
  received_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
};
type ItemRow = RowDataPacket & {
  id: number;
  public_id: string;
  product_id: number;
  product_public_id: string;
  product_name_snapshot: string;
  sku_snapshot: string;
  quantity: string;
  unit_cost_cents: number;
  line_total_cents: number;
};
const integer = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.trunc(v)));
export class PurchaseRepository {
  constructor(private pool?: Pool) {}
  private db() {
    return (this.pool ??= getPool());
  }
  async list(clientId: string, o: PurchaseListInput) {
    const limit = integer(o.pageSize, 1, 100),
      offset = (integer(o.page, 1, Number.MAX_SAFE_INTEGER) - 1) * limit;
    const where = ["o.client_id=?"],
      values: Array<string | number> = [clientId];
    if (o.search) {
      where.push("(o.order_number LIKE ? OR o.supplier_name_snapshot LIKE ?)");
      values.push(`%${o.search}%`, `%${o.search}%`);
    }
    if (o.status) {
      where.push("o.status=?");
      values.push(o.status);
    }
    if (o.from) {
      where.push("DATE(o.created_at)>=?");
      values.push(o.from);
    }
    if (o.to) {
      where.push("DATE(o.created_at)<=?");
      values.push(o.to);
    }
    const sqlWhere = where.join(" AND "),
      order = {
        orderNumber: "o.order_number",
        createdAt: "o.created_at",
        total: "o.total_cents",
      }[o.sort];
    const [count] = await this.db().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_purchase_orders o WHERE ${sqlWhere}`,
      values
    );
    const [rows] = await this.db().execute<OrderRow[]>(
      `SELECT o.*,s.public_id supplier_public_id FROM erp_purchase_orders o INNER JOIN erp_suppliers s ON s.id=o.supplier_id AND s.client_id=o.client_id WHERE ${sqlWhere} ORDER BY ${order} ${o.direction === "asc" ? "ASC" : "DESC"},o.id DESC LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    return {
      items: rows.map(publicOrder),
      total: Number(count[0]?.total ?? 0),
    };
  }
  async detail(
    clientId: string,
    publicId: string,
    connection: Pool | PoolConnection = this.db(),
    lock = false
  ) {
    const [orders] = await connection.execute<OrderRow[]>(
      `SELECT o.*,s.public_id supplier_public_id FROM erp_purchase_orders o INNER JOIN erp_suppliers s ON s.id=o.supplier_id AND s.client_id=o.client_id WHERE o.client_id=? AND o.public_id=? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, publicId]
    );
    const order = orders[0];
    if (!order) return null;
    const [items] = await connection.execute<ItemRow[]>(
      "SELECT i.*,p.public_id product_public_id FROM erp_purchase_order_items i INNER JOIN erp_products p ON p.id=i.product_id WHERE i.purchase_order_id=? ORDER BY i.id",
      [order.id]
    );
    const [history] = await connection.execute<RowDataPacket[]>(
      "SELECT from_status fromStatus,to_status toStatus,reason,changed_by changedBy,created_at createdAt FROM erp_purchase_order_history WHERE purchase_order_id=? ORDER BY created_at,id",
      [order.id]
    );
    return {
      ...publicOrder(order),
      items: items.map(i => ({
        publicId: i.public_id,
        productPublicId: i.product_public_id,
        productName: i.product_name_snapshot,
        sku: i.sku_snapshot,
        quantity: i.quantity,
        unitCostCents: Number(i.unit_cost_cents),
        lineTotalCents: Number(i.line_total_cents),
      })),
      history,
    };
  }
  private async validateReferences(
    c: PoolConnection,
    clientId: string,
    input: PurchaseDraftInput
  ) {
    const [suppliers] = await c.execute<RowDataPacket[]>(
      "SELECT id,public_id,legal_name FROM erp_suppliers WHERE client_id=? AND public_id=? AND active=1 LIMIT 1",
      [clientId, input.supplierPublicId]
    );
    if (!suppliers[0])
      throw new ErpDomainError("NOT_FOUND", "Fornecedor ativo não encontrado.");
    const products: Array<{
      id: number;
      name: string;
      sku: string;
      productPublicId: string;
      quantity: string;
      unitCostCents: number;
      lineTotalCents: number;
    }> = [];
    for (const item of input.items) {
      const [rows] = await c.execute<RowDataPacket[]>(
        "SELECT id,public_id,name,sku FROM erp_products WHERE client_id=? AND public_id=? AND active=1 LIMIT 1",
        [clientId, item.productPublicId]
      );
      if (!rows[0])
        throw new ErpDomainError(
          "INACTIVE_PRODUCT",
          "Produto ativo não encontrado."
        );
      products.push({
        id: Number(rows[0].id),
        name: String(rows[0].name),
        sku: String(rows[0].sku),
        ...item,
        lineTotalCents: lineTotalCents(item.quantity, item.unitCostCents),
      });
    }
    return { supplier: suppliers[0], products };
  }
  async save(
    clientId: string,
    userId: string,
    input: PurchaseDraftInput,
    publicId?: string
  ) {
    const c = await this.db().getConnection();
    let id = 0;
    let target = publicId ?? randomUUID();
    try {
      await c.beginTransaction();
      const refs = await this.validateReferences(c, clientId, input);
      if (publicId) {
        const current = await this.detail(clientId, publicId, c, true);
        if (!current)
          throw new ErpDomainError("NOT_FOUND", "Pedido não encontrado.");
        if (current.status !== "draft")
          throw new ErpDomainError(
            "CONFLICT",
            "Somente pedidos em rascunho podem ser editados."
          );
        const [rows] = await c.execute<RowDataPacket[]>(
          "SELECT id FROM erp_purchase_orders WHERE client_id=? AND public_id=?",
          [clientId, publicId]
        );
        id = Number(rows[0].id);
        await c.execute(
          "DELETE FROM erp_purchase_order_items WHERE purchase_order_id=?",
          [id]
        );
      } else {
        const year = new Date().getUTCFullYear();
        await c.execute(
          "INSERT IGNORE INTO erp_purchase_order_sequences(client_id,year,next_number) VALUES(?,?,1)",
          [clientId, year]
        );
        const [seq] = await c.execute<RowDataPacket[]>(
          "SELECT next_number FROM erp_purchase_order_sequences WHERE client_id=? AND year=? FOR UPDATE",
          [clientId, year]
        );
        const n = Number(seq[0].next_number);
        await c.execute(
          "UPDATE erp_purchase_order_sequences SET next_number=? WHERE client_id=? AND year=?",
          [n + 1, clientId, year]
        );
        const orderNumber = `PO-${year}-${String(n).padStart(6, "0")}`;
        const [result] = await c.execute<ResultSetHeader>(
          "INSERT INTO erp_purchase_orders(public_id,client_id,order_number,supplier_id,supplier_name_snapshot,status,notes,expected_date,subtotal_cents,total_cents,created_by) VALUES(?,?,?,?,?,'draft',?,?,0,0,?)",
          [
            target,
            clientId,
            orderNumber,
            refs.supplier.id,
            refs.supplier.legal_name,
            input.notes,
            input.expectedDate,
            userId,
          ]
        );
        id = result.insertId;
        await c.execute(
          "INSERT INTO erp_purchase_order_history(purchase_order_id,from_status,to_status,changed_by) VALUES(?,NULL,'draft',?)",
          [id, userId]
        );
      }
      let total = 0;
      for (const p of refs.products) {
        total += p.lineTotalCents;
        await c.execute(
          "INSERT INTO erp_purchase_order_items(public_id,purchase_order_id,product_id,product_name_snapshot,sku_snapshot,quantity,unit_cost_cents,line_total_cents) VALUES(?,?,?,?,?,?,?,?)",
          [
            randomUUID(),
            id,
            p.id,
            p.name,
            p.sku,
            p.quantity,
            p.unitCostCents,
            p.lineTotalCents,
          ]
        );
      }
      await c.execute(
        "UPDATE erp_purchase_orders SET supplier_id=?,supplier_name_snapshot=?,notes=?,expected_date=?,subtotal_cents=?,total_cents=? WHERE id=?",
        [
          refs.supplier.id,
          refs.supplier.legal_name,
          input.notes,
          input.expectedDate,
          total,
          total,
          id,
        ]
      );
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
    return this.detail(clientId, target);
  }
  async transition(
    clientId: string,
    userId: string,
    publicId: string,
    to: "approved" | "cancelled",
    reason?: string
  ) {
    const c = await this.db().getConnection();
    try {
      await c.beginTransaction();
      const order = await this.detail(clientId, publicId, c, true);
      if (!order)
        throw new ErpDomainError("NOT_FOUND", "Pedido não encontrado.");
      if (!canTransitionPurchase(order.status, to))
        throw new ErpDomainError(
          "CONFLICT",
          "Transição de status não permitida."
        );
      const [ids] = await c.execute<RowDataPacket[]>(
        "SELECT id FROM erp_purchase_orders WHERE client_id=? AND public_id=?",
        [clientId, publicId]
      );
      const orderId = Number(ids[0].id);
      if (to === "approved") {
        const [refs] = await c.execute<RowDataPacket[]>(
          "SELECT s.active supplier_active,COUNT(i.id) item_count,SUM(p.active=0 OR p.client_id<>o.client_id) invalid_products FROM erp_purchase_orders o INNER JOIN erp_suppliers s ON s.id=o.supplier_id LEFT JOIN erp_purchase_order_items i ON i.purchase_order_id=o.id LEFT JOIN erp_products p ON p.id=i.product_id WHERE o.id=? GROUP BY s.active",
          [orderId]
        );
        if (
          !refs[0] ||
          Number(refs[0].supplier_active) !== 1 ||
          Number(refs[0].item_count) < 1 ||
          Number(refs[0].invalid_products) > 0
        )
          throw new ErpDomainError(
            "CONFLICT",
            "Fornecedor e produtos devem permanecer ativos para aprovação."
          );
        await c.execute(
          "UPDATE erp_purchase_orders SET status='approved',approved_by=?,approved_at=NOW() WHERE client_id=? AND public_id=?",
          [userId, clientId, publicId]
        );
      } else
        await c.execute(
          "UPDATE erp_purchase_orders SET status='cancelled',cancelled_by=?,cancelled_at=NOW(),cancellation_reason=? WHERE client_id=? AND public_id=?",
          [userId, reason, clientId, publicId]
        );
      await c.execute(
        "INSERT INTO erp_purchase_order_history(purchase_order_id,from_status,to_status,reason,changed_by) VALUES(?,?,?,?,?)",
        [orderId, order.status, to, reason ?? null, userId]
      );
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
    return this.detail(clientId, publicId);
  }
  async receive(
    clientId: string,
    userId: string,
    publicId: string,
    key: string
  ) {
    const c = await this.db().getConnection();
    let replay = false;
    try {
      await c.beginTransaction();
      const [existing] = await c.execute<RowDataPacket[]>(
        "SELECT o.public_id FROM erp_purchase_order_receipts r INNER JOIN erp_purchase_orders o ON o.id=r.purchase_order_id WHERE r.client_id=? AND r.idempotency_key=?",
        [clientId, key]
      );
      if (existing[0]) {
        if (existing[0].public_id !== publicId)
          throw new ErpDomainError(
            "IDEMPOTENCY_CONFLICT",
            "Chave idempotente já usada em outro pedido."
          );
        replay = true;
        await c.commit();
        return { order: await this.detail(clientId, publicId), replay };
      }
      const order = await this.detail(clientId, publicId, c, true);
      if (!order)
        throw new ErpDomainError("NOT_FOUND", "Pedido não encontrado.");
      if (order.status !== "approved")
        throw new ErpDomainError(
          "CONFLICT",
          "Somente pedido aprovado pode ser recebido."
        );
      const [orderIds] = await c.execute<RowDataPacket[]>(
        "SELECT id FROM erp_purchase_orders WHERE client_id=? AND public_id=?",
        [clientId, publicId]
      );
      const orderId = Number(orderIds[0].id);
      const [receipt] = await c.execute<ResultSetHeader>(
        "INSERT INTO erp_purchase_order_receipts(public_id,client_id,purchase_order_id,idempotency_key,received_by) VALUES(?,?,?,?,?)",
        [randomUUID(), clientId, orderId, key, userId]
      );
      const [items] = await c.execute<ItemRow[]>(
        "SELECT i.*,p.public_id product_public_id FROM erp_purchase_order_items i INNER JOIN erp_products p ON p.id=i.product_id AND p.client_id=? WHERE i.purchase_order_id=? FOR UPDATE",
        [clientId, orderId]
      );
      if (items.length !== order.items.length)
        throw new ErpDomainError(
          "CONFLICT",
          "Todos os itens do pedido devem permanecer vinculados ao tenant."
        );
      for (const item of items) {
        await c.execute(
          "INSERT IGNORE INTO erp_stock_balances(client_id,product_id,quantity,version) VALUES(?,?,0,0)",
          [clientId, item.product_id]
        );
        const [balances] = await c.execute<RowDataPacket[]>(
          "SELECT quantity FROM erp_stock_balances WHERE client_id=? AND product_id=? FOR UPDATE",
          [clientId, item.product_id]
        );
        const previous = quantityMillis(String(balances[0].quantity)),
          result = previous + quantityMillis(item.quantity);
        const movementId = randomUUID(),
          itemKey = `${key}:${item.public_id}`,
          hash = createHash("sha256")
            .update(`${publicId}:${item.public_id}:${item.quantity}`)
            .digest("hex");
        const [movement] = await c.execute<ResultSetHeader>(
          "INSERT INTO erp_stock_movements(public_id,client_id,product_id,type,direction,quantity,previous_balance,resulting_balance,reason,reference_type,reference_id,idempotency_key,payload_hash,created_by) VALUES(?,?,?,'purchase_in','in',?,?,?,'Recebimento integral de compra','purchase',?,?,?,?)",
          [
            movementId,
            clientId,
            item.product_id,
            item.quantity,
            millisQuantity(previous),
            millisQuantity(result),
            publicId,
            itemKey,
            hash,
            userId,
          ]
        );
        await c.execute(
          "UPDATE erp_stock_balances SET quantity=?,version=version+1 WHERE client_id=? AND product_id=?",
          [millisQuantity(result), clientId, item.product_id]
        );
        await c.execute(
          "INSERT INTO erp_purchase_order_receipt_items(receipt_id,purchase_order_item_id,product_id,quantity,stock_movement_id) VALUES(?,?,?,?,?)",
          [
            receipt.insertId,
            item.id,
            item.product_id,
            item.quantity,
            movement.insertId,
          ]
        );
      }
      await c.execute(
        "UPDATE erp_purchase_orders SET status='received',received_by=?,received_at=NOW() WHERE id=?",
        [userId, orderId]
      );
      await c.execute(
        "INSERT INTO erp_purchase_order_history(purchase_order_id,from_status,to_status,changed_by) VALUES(?,'approved','received',?)",
        [orderId, userId]
      );
      await c.commit();
      return { order: await this.detail(clientId, publicId), replay: false };
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
}
function publicOrder(r: OrderRow) {
  return {
    publicId: r.public_id,
    orderNumber: r.order_number,
    supplierPublicId: r.supplier_public_id,
    supplierName: r.supplier_name_snapshot,
    status: r.status,
    notes: r.notes,
    expectedDate: r.expected_date,
    subtotalCents: Number(r.subtotal_cents),
    totalCents: Number(r.total_cents),
    approvedAt: r.approved_at,
    receivedAt: r.received_at,
    cancelledAt: r.cancelled_at,
    cancellationReason: r.cancellation_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
