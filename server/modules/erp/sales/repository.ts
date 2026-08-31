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
  canTransitionSale,
  lineTotalCents,
  type SaleDraftInput,
  type SaleListInput,
  type SaleStatus,
} from "./contracts";

type OrderRow = RowDataPacket & {
  id: number;
  public_id: string;
  client_id: string;
  order_number: string;
  crm_client_id: string;
  customer_name_snapshot: string;
  status: SaleStatus;
  notes: string | null;
  expected_date: string | null;
  subtotal_cents: number;
  total_cents: number;
  confirmed_at: string | null;
  fulfilled_at: string | null;
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
  unit_price_cents: number;
  line_total_cents: number;
};
const integer = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.trunc(v)));
export class SaleRepository {
  constructor(private pool?: Pool) {}
  private db() {
    return (this.pool ??= getPool());
  }
  async options(clientId: string) {
    const [customers] = await this.db().execute<RowDataPacket[]>(
      "SELECT crm_client_id crmClientId,company_name customerName FROM megadesk_crm_clients WHERE client_id=? AND lifecycle_state='active' AND status NOT IN ('inativo','cancelado') ORDER BY company_name,crm_client_id LIMIT 100",
      [clientId]
    );
    const [products] = await this.db().execute<RowDataPacket[]>(
      "SELECT public_id productPublicId,name,sku,sale_price_cents salePriceCents FROM erp_products WHERE client_id=? AND active=1 ORDER BY name,public_id LIMIT 100",
      [clientId]
    );
    return {
      customers: customers.map(row => ({ crmClientId: String(row.crmClientId), customerName: String(row.customerName) })),
      products: products.map(row => ({ productPublicId: String(row.productPublicId), name: String(row.name), sku: String(row.sku), salePriceCents: Number(row.salePriceCents) })),
    };
  }
  async list(clientId: string, o: SaleListInput) {
    const limit = integer(o.pageSize, 1, 100),
      offset = (integer(o.page, 1, Number.MAX_SAFE_INTEGER) - 1) * limit;
    const where = ["o.client_id=?"],
      values: Array<string | number> = [clientId];
    if (o.search) {
      where.push("(o.order_number LIKE ? OR o.customer_name_snapshot LIKE ?)");
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
      `SELECT COUNT(*) total FROM erp_sale_orders o WHERE ${sqlWhere}`,
      values
    );
    const [rows] = await this.db().execute<OrderRow[]>(
      `SELECT o.* FROM erp_sale_orders o WHERE ${sqlWhere} ORDER BY ${order} ${o.direction === "asc" ? "ASC" : "DESC"},o.id DESC LIMIT ${limit} OFFSET ${offset}`,
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
      `SELECT o.* FROM erp_sale_orders o WHERE o.client_id=? AND o.public_id=? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, publicId]
    );
    const order = orders[0];
    if (!order) return null;
    const [expectedItems] = await connection.execute<RowDataPacket[]>(
      "SELECT COUNT(*) total FROM erp_sale_order_items i INNER JOIN erp_sale_orders item_order ON item_order.id=i.sale_order_id AND item_order.client_id=? WHERE i.sale_order_id=? AND item_order.public_id=?",
      [clientId, order.id, publicId]
    );
    const [items] = await connection.execute<ItemRow[]>(
      "SELECT i.*,p.public_id product_public_id FROM erp_sale_order_items i INNER JOIN erp_sale_orders item_order ON item_order.id=i.sale_order_id AND item_order.client_id=? INNER JOIN erp_products p ON p.id=i.product_id AND p.client_id=item_order.client_id WHERE i.sale_order_id=? AND item_order.public_id=? ORDER BY i.id",
      [clientId, order.id, publicId]
    );
    if (items.length !== Number(expectedItems[0]?.total ?? 0)) {
      throw new ErpDomainError(
        "CONFLICT",
        "Pedido contém itens inconsistentes."
      );
    }
    const [history] = await connection.execute<RowDataPacket[]>(
      "SELECT from_status fromStatus,to_status toStatus,reason,changed_by changedBy,created_at createdAt FROM erp_sale_order_history WHERE sale_order_id=? ORDER BY created_at,id",
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
        unitPriceCents: Number(i.unit_price_cents),
        lineTotalCents: Number(i.line_total_cents),
      })),
      history,
    };
  }
  private async validateReferences(
    c: PoolConnection,
    clientId: string,
    input: SaleDraftInput
  ) {
    const [customers] = await c.execute<RowDataPacket[]>(
      "SELECT crm_client_id,company_name,status FROM megadesk_crm_clients WHERE client_id=? AND crm_client_id=? AND lifecycle_state='active' AND status NOT IN ('inativo','cancelado') LIMIT 1",
      [clientId, input.crmClientId]
    );
    if (!customers[0])
      throw new ErpDomainError("NOT_FOUND", "Fornecedor ativo nÃ£o encontrado.");
    const products: Array<{
      id: number;
      name: string;
      sku: string;
      productPublicId: string;
      quantity: string;
      unitPriceCents: number;
      lineTotalCents: number;
    }> = [];
    for (const item of input.items) {
      const [rows] = await c.execute<RowDataPacket[]>(
        "SELECT id,public_id,name,sku,active FROM erp_products WHERE client_id=? AND public_id=? LIMIT 1",
        [clientId, item.productPublicId]
      );
      if (!rows[0])
        throw new ErpDomainError("NOT_FOUND", "Produto não encontrado.");
      if (Number(rows[0].active) !== 1)
        throw new ErpDomainError(
          "INACTIVE_PRODUCT",
          "Produto ativo nÃ£o encontrado."
        );
      products.push({
        id: Number(rows[0].id),
        name: String(rows[0].name),
        sku: String(rows[0].sku),
        ...item,
        lineTotalCents: lineTotalCents(item.quantity, item.unitPriceCents),
      });
    }
    return { customer: customers[0], products };
  }
  async save(
    clientId: string,
    userId: string,
    input: SaleDraftInput,
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
          throw new ErpDomainError("NOT_FOUND", "Pedido nÃ£o encontrado.");
        if (current.status !== "draft")
          throw new ErpDomainError(
            "CONFLICT",
            "Somente pedidos em rascunho podem ser editados."
          );
        const [rows] = await c.execute<RowDataPacket[]>(
          "SELECT id FROM erp_sale_orders WHERE client_id=? AND public_id=?",
          [clientId, publicId]
        );
        id = Number(rows[0].id);
        await c.execute(
          "DELETE FROM erp_sale_order_items WHERE sale_order_id=?",
          [id]
        );
      } else {
        const year = new Date().getUTCFullYear();
        await c.execute(
          "INSERT IGNORE INTO erp_sale_order_sequences(client_id,year,next_number) VALUES(?,?,1)",
          [clientId, year]
        );
        const [seq] = await c.execute<RowDataPacket[]>(
          "SELECT next_number FROM erp_sale_order_sequences WHERE client_id=? AND year=? FOR UPDATE",
          [clientId, year]
        );
        const n = Number(seq[0].next_number);
        await c.execute(
          "UPDATE erp_sale_order_sequences SET next_number=? WHERE client_id=? AND year=?",
          [n + 1, clientId, year]
        );
        const orderNumber = `SO-${year}-${String(n).padStart(6, "0")}`;
        const [result] = await c.execute<ResultSetHeader>(
          "INSERT INTO erp_sale_orders(public_id,client_id,order_number,crm_client_id,customer_name_snapshot,status,notes,expected_date,subtotal_cents,total_cents,created_by) VALUES(?,?,?,?,?,'draft',?,?,0,0,?)",
          [
            target,
            clientId,
            orderNumber,
            refs.customer.crm_client_id,
            refs.customer.company_name,
            input.notes,
            input.expectedDate,
            userId,
          ]
        );
        id = result.insertId;
        await c.execute(
          "INSERT INTO erp_sale_order_history(sale_order_id,from_status,to_status,changed_by) VALUES(?,NULL,'draft',?)",
          [id, userId]
        );
      }
      let total = 0;
      for (const p of refs.products) {
        total += p.lineTotalCents;
        await c.execute(
          "INSERT INTO erp_sale_order_items(public_id,sale_order_id,product_id,product_name_snapshot,sku_snapshot,quantity,unit_price_cents,line_total_cents) VALUES(?,?,?,?,?,?,?,?)",
          [
            randomUUID(),
            id,
            p.id,
            p.name,
            p.sku,
            p.quantity,
            p.unitPriceCents,
            p.lineTotalCents,
          ]
        );
      }
      await c.execute(
        "UPDATE erp_sale_orders SET crm_client_id=?,customer_name_snapshot=?,notes=?,expected_date=?,subtotal_cents=?,total_cents=? WHERE id=?",
        [
          refs.customer.crm_client_id,
          refs.customer.company_name,
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
    to: "confirmed" | "cancelled",
    reason?: string
  ) {
    const c = await this.db().getConnection();
    try {
      await c.beginTransaction();
      const order = await this.detail(clientId, publicId, c, true);
      if (!order)
        throw new ErpDomainError("NOT_FOUND", "Pedido nÃ£o encontrado.");
      if (!canTransitionSale(order.status, to))
        throw new ErpDomainError(
          "CONFLICT",
          "TransiÃ§Ã£o de status nÃ£o permitida."
        );
      const [ids] = await c.execute<RowDataPacket[]>(
        "SELECT id FROM erp_sale_orders WHERE client_id=? AND public_id=?",
        [clientId, publicId]
      );
      const orderId = Number(ids[0].id);
      if (to === "confirmed") {
        const [refs] = await c.execute<RowDataPacket[]>(
          "SELECT c.status customer_status,COUNT(i.id) item_count,SUM(p.active=0 OR p.client_id<>o.client_id) invalid_products FROM erp_sale_orders o INNER JOIN megadesk_crm_clients c ON c.crm_client_id=o.crm_client_id AND c.client_id=o.client_id LEFT JOIN erp_sale_order_items i ON i.sale_order_id=o.id LEFT JOIN erp_products p ON p.id=i.product_id WHERE o.id=? GROUP BY c.status",
          [orderId]
        );
        if (
          !refs[0] ||
          ['inativo', 'cancelado'].includes(String(refs[0].customer_status)) ||
          Number(refs[0].item_count) < 1 ||
          Number(refs[0].invalid_products) > 0
        )
          throw new ErpDomainError(
            "CONFLICT",
            "Fornecedor e produtos devem permanecer ativos para aprovaÃ§Ã£o."
          );
        await c.execute(
          "UPDATE erp_sale_orders SET status='confirmed',confirmed_by=?,confirmed_at=NOW() WHERE client_id=? AND public_id=?",
          [userId, clientId, publicId]
        );
      } else
        await c.execute(
          "UPDATE erp_sale_orders SET status='cancelled',cancelled_by=?,cancelled_at=NOW(),cancellation_reason=? WHERE client_id=? AND public_id=?",
          [userId, reason, clientId, publicId]
        );
      await c.execute(
        "INSERT INTO erp_sale_order_history(sale_order_id,from_status,to_status,reason,changed_by) VALUES(?,?,?,?,?)",
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
  async fulfill(
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
        "SELECT o.public_id FROM erp_sale_order_fulfillments f INNER JOIN erp_sale_orders o ON o.id=f.sale_order_id WHERE f.client_id=? AND f.idempotency_key=?",
        [clientId, key]
      );
      if (existing[0]) {
        if (existing[0].public_id !== publicId)
          throw new ErpDomainError(
            "IDEMPOTENCY_CONFLICT",
            "Chave idempotente jÃ¡ usada em outro pedido."
          );
        replay = true;
        await c.commit();
        return { order: await this.detail(clientId, publicId), replay };
      }
      const order = await this.detail(clientId, publicId, c, true);
      if (!order)
        throw new ErpDomainError("NOT_FOUND", "Pedido nÃ£o encontrado.");
      if (order.status !== "confirmed")
        throw new ErpDomainError(
          "CONFLICT",
          "Somente pedido aprovado pode ser recebido."
        );
      const [orderIds] = await c.execute<RowDataPacket[]>(
        "SELECT id FROM erp_sale_orders WHERE client_id=? AND public_id=?",
        [clientId, publicId]
      );
      const orderId = Number(orderIds[0].id);
      const [fulfillment] = await c.execute<ResultSetHeader>(
        "INSERT INTO erp_sale_order_fulfillments(public_id,client_id,sale_order_id,idempotency_key,fulfilled_by) VALUES(?,?,?,?,?)",
        [randomUUID(), clientId, orderId, key, userId]
      );
      const [items] = await c.execute<ItemRow[]>(
        "SELECT i.*,p.public_id product_public_id FROM erp_sale_order_items i INNER JOIN erp_products p ON p.id=i.product_id AND p.client_id=? WHERE i.sale_order_id=? ORDER BY i.product_id FOR UPDATE",
        [clientId, orderId]
      );
      if (items.length !== order.items.length)
        throw new ErpDomainError(
          "CONFLICT",
          "Todos os itens do pedido devem permanecer vinculados ao tenant."
        );
      const lockedBalances = new Map<number, bigint>();
      for (const item of items) {
        await c.execute(
          "INSERT IGNORE INTO erp_stock_balances(client_id,product_id,quantity,version) VALUES(?,?,0,0)",
          [clientId, item.product_id]
        );
        const [balances] = await c.execute<RowDataPacket[]>(
          "SELECT quantity FROM erp_stock_balances WHERE client_id=? AND product_id=? FOR UPDATE",
          [clientId, item.product_id]
        );
        const previous = quantityMillis(String(balances[0].quantity));
        if (previous < quantityMillis(item.quantity))
          throw new ErpDomainError("INSUFFICIENT_STOCK", "Estoque insuficiente para concluir a venda.");
        lockedBalances.set(item.id, previous);
      }
      for (const item of items) {
        const previous = lockedBalances.get(item.id)!;
        const result = previous - quantityMillis(item.quantity);
        const movementId = randomUUID(),
          itemKey = `${key}:${item.public_id}`,
          hash = createHash("sha256")
            .update(`${publicId}:${item.public_id}:${item.quantity}`)
            .digest("hex");
        const [movement] = await c.execute<ResultSetHeader>(
          "INSERT INTO erp_stock_movements(public_id,client_id,product_id,type,direction,quantity,previous_balance,resulting_balance,reason,reference_type,reference_id,idempotency_key,payload_hash,created_by) VALUES(?,?,?,'sale_out','out',?,?,?,'Conclusão integral de venda','sale',?,?,?,?)",
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
          "INSERT INTO erp_sale_order_fulfillment_items(fulfillment_id,sale_order_item_id,product_id,quantity,stock_movement_id) VALUES(?,?,?,?,?)",
          [
            fulfillment.insertId,
            item.id,
            item.product_id,
            item.quantity,
            movement.insertId,
          ]
        );
      }
      await c.execute(
        "UPDATE erp_sale_orders SET status='fulfilled',fulfilled_by=?,fulfilled_at=NOW() WHERE id=?",
        [userId, orderId]
      );
      await c.execute(
        "INSERT INTO erp_sale_order_history(sale_order_id,from_status,to_status,changed_by) VALUES(?,'confirmed','fulfilled',?)",
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
    crmClientId: r.crm_client_id,
    customerName: r.customer_name_snapshot,
    status: r.status,
    notes: r.notes,
    expectedDate: r.expected_date,
    subtotalCents: Number(r.subtotal_cents),
    totalCents: Number(r.total_cents),
    confirmedAt: r.confirmed_at,
    fulfilledAt: r.fulfilled_at,
    cancelledAt: r.cancelled_at,
    cancellationReason: r.cancellation_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
