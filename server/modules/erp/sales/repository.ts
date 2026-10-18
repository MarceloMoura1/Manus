import { createHash, randomUUID } from "node:crypto";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { getPool } from "../../../db";
import {
  hasDuplicateResolvedInventoryItem,
  millisQuantity,
  quantityMillis,
} from "../contracts";
import { ErpDomainError } from "../errors";
import { InventoryRepository } from "../inventory/repository";
import {
  calculateSaleTotals,
  canCancelSaleAtStage,
  commercialCode,
  derivePaymentStatus,
  isStockExitTransition,
  legacySaleStage,
  lineTotalCents,
  saleTransitionKind,
  saleCommercialTransitionKind,
  type SaleAddressCorrectionInput,
  type SaleCommercialStatus,
  type SaleCommercialTransitionInput,
  type SaleConfirmationInput,
  type SaleDocumentType,
  type SaleDraftInput,
  type SaleListInput,
  type SaleStage,
  type SaleStatus,
  type SaleTransitionInput,
} from "./contracts";

const STAGE_SQL = `COALESCE(o.current_stage,CASE o.status
  WHEN 'draft' THEN 'created'
  WHEN 'fulfilled' THEN 'completed'
  ELSE 'confirmed' END)`;

const STATUS_SORT_SQL = `(CASE
  WHEN o.document_type='quote' THEN CASE o.commercial_status
    WHEN 'draft' THEN 10 WHEN 'negotiation' THEN 20 WHEN 'approved' THEN 30
    WHEN 'converted' THEN 40 WHEN 'active' THEN 50 WHEN 'completed' THEN 60
    WHEN 'lost' THEN 70 WHEN 'cancelled' THEN 80 ELSE 90 END
  WHEN o.cancelled_at IS NOT NULL OR o.status='cancelled' THEN 80
  ELSE CASE ${STAGE_SQL}
    WHEN 'created' THEN 10 WHEN 'confirmed' THEN 20 WHEN 'separation' THEN 30
    WHEN 'shipped' THEN 40 WHEN 'received' THEN 50 WHEN 'completed' THEN 60
    ELSE 90 END
END)`;

export function salesListOrderBy(sort: SaleListInput["sort"], direction: SaleListInput["direction"]) {
  const dir = direction === "asc" ? "ASC" : "DESC";
  const expressions: Record<SaleListInput["sort"], { values: string[]; nullable?: boolean }> = {
    orderNumber: {
      values: [
        "LOWER(SUBSTRING_INDEX(o.order_number,'-',1))",
        "CAST(SUBSTRING_INDEX(o.order_number,'-',-1) AS UNSIGNED)",
        "o.order_number",
      ],
    },
    customer: { values: ["NULLIF(LOWER(TRIM(o.customer_name_snapshot)),'')"], nullable: true },
    commercialDate: { values: ["COALESCE(o.commercial_date,DATE(o.created_at))"] },
    seller: { values: ["NULLIF(LOWER(TRIM(o.seller_name_snapshot)),'')"], nullable: true },
    status: { values: [STATUS_SORT_SQL] },
    createdAt: { values: ["o.created_at"] },
    total: { values: ["o.total_cents"] },
  };
  const selected = expressions[sort];
  const nullsLast = selected.nullable ? [`(${selected.values[0]} IS NULL) ASC`] : [];
  return [...nullsLast, ...selected.values.map(value => `${value} ${dir}`), `o.id ${dir}`].join(",");
}

type OrderRow = RowDataPacket & {
  id: number;
  public_id: string;
  client_id: string;
  order_number: string;
  document_type: SaleDocumentType;
  commercial_status: SaleCommercialStatus;
  commercial_date: string | null;
  crm_client_id: string;
  customer_name_snapshot: string;
  seller_name_snapshot: string | null;
  seller_user_id: string | null;
  status: SaleStatus;
  current_stage: SaleStage | null;
  notes: string | null;
  expected_date: string | null;
  shipping_address_snapshot: string | null;
  billing_address_snapshot: string | null;
  subtotal_cents: number;
  discount_cents: number;
  freight_cents: number;
  charges_cents: number;
  total_cents: number;
  payment_method_snapshot: string | null;
  payment_terms_snapshot: string | null;
  confirmation_idempotency_key: string | null;
  confirmation_payload_hash: string | null;
  source_quote_id: number | null;
  conversion_idempotency_key: string | null;
  duplicate_source_id: number | null;
  duplication_idempotency_key: string | null;
  confirmed_at: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  paid_cents?: number;
  title_count?: number;
  item_count?: number;
  total_quantity?: string;
  first_product_name?: string | null;
  first_product_public_id?: string | null;
  first_product_media_id?: string | null;
};

type ItemRow = RowDataPacket & {
  id: number;
  public_id: string;
  product_id: number;
  inventory_item_id: number | null;
  inventory_item_public_id: string | null;
  product_public_id: string;
  product_name_snapshot: string;
  sku_snapshot: string;
  quantity: string;
  unit_price_cents: number;
  discount_cents: number;
  line_total_cents: number;
  unit?: string;
  current_available?: string | null;
  stock_exited?: number;
  media_id?: string | null;
  variant_name?: string | null;
  variant_attributes?: string | null;
};

type Actor = { userId: string; name: string | null };
type Executor = Pool | PoolConnection;
type AddressSnapshot = {
  recipientName: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
};

const integer = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.trunc(value)));
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (value: unknown) => JSON.stringify(value);
const parseJson = <T>(value: string | null): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};
const dateOnly = (value: string | Date) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const isTransitionIdempotencyDuplicate = (error: unknown) => {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { code?: unknown; message?: unknown; sqlMessage?: unknown };
  const message = String(record.sqlMessage ?? record.message ?? "");
  return record.code === "ER_DUP_ENTRY" && message.includes("uq_erp_sale_events_tenant_key");
};

export class SaleRepository {
  constructor(private pool?: Pool) {}

  private db() {
    return (this.pool ??= getPool());
  }

  private inventory() {
    return new InventoryRepository(this.db());
  }

  private async nextCommercialCode(
    connection: PoolConnection,
    clientId: string,
    documentType: SaleDocumentType
  ) {
    const prefix = documentType === "quote" ? "O" : "V";
    await connection.execute(
      `INSERT INTO erp_sale_document_sequences(client_id,document_type,next_number)
       SELECT ?,?,COALESCE(MAX(CAST(SUBSTRING(order_number,3) AS UNSIGNED)),0)+1
       FROM erp_sale_orders
       WHERE client_id=? AND document_type=? AND order_number REGEXP ?
       ON DUPLICATE KEY UPDATE next_number=next_number`,
      [clientId, documentType, clientId, documentType, `^${prefix}-[0-9]+$`]
    );
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT next_number FROM erp_sale_document_sequences
       WHERE client_id=? AND document_type=? FOR UPDATE`,
      [clientId, documentType]
    );
    const next = Number(rows[0]?.next_number);
    if (!Number.isSafeInteger(next) || next < 1) {
      throw new ErpDomainError("CONFLICT", "Sequência comercial inválida.");
    }
    await connection.execute(
      `UPDATE erp_sale_document_sequences SET next_number=?
       WHERE client_id=? AND document_type=?`,
      [next + 1, clientId, documentType]
    );
    return commercialCode(documentType, next);
  }

  private async resolveSeller(
    connection: PoolConnection,
    clientId: string,
    fallback: Actor,
    sellerUserId?: string | null
  ) {
    const publicId = sellerUserId || fallback.userId;
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT u.user_id publicId,COALESCE(NULLIF(u.name,''),u.user_id) name
       FROM megadesk_domain_client_users u
       WHERE u.client_id=? AND u.user_id=? LIMIT 1`,
      [clientId, publicId]
    );
    if (!rows[0]) {
      if (!sellerUserId) return { publicId: fallback.userId, name: fallback.name };
      throw new ErpDomainError("NOT_FOUND", "Vendedor não encontrado neste tenant.");
    }
    return { publicId: String(rows[0].publicId), name: String(rows[0].name) };
  }

  private canEditOrder(order: {
    documentType: SaleDocumentType;
    commercialStatus: SaleCommercialStatus;
    currentStage: SaleStage;
    cancelled: boolean;
    archivedAt: string | null;
  }) {
    if (order.cancelled || order.archivedAt) return false;
    if (order.documentType === "quote") {
      return !["converted", "lost", "cancelled"].includes(order.commercialStatus);
    }
    return ["created", "confirmed", "separation"].includes(order.currentStage);
  }

  private async insertEvent(
    connection: PoolConnection,
    input: {
      clientId: string;
      orderId: number;
      eventType:
        | "created"
        | "updated"
        | "confirmed"
        | "stage_transition"
        | "cancelled"
        | "address_corrected"
        | "payment_registered"
        | "duplicated"
        | "quote_status_changed"
        | "quote_converted"
        | "archived"
        | "financial_adjusted";
      actor: Actor;
      fromStage?: SaleStage | null;
      toStage?: SaleStage | null;
      reason?: string | null;
      before?: unknown;
      after?: unknown;
      idempotencyKey?: string | null;
      payloadHash?: string | null;
    }
  ) {
    await connection.execute(
      `INSERT INTO erp_sale_order_events
       (public_id,client_id,sale_order_id,event_type,from_stage,to_stage,reason,before_json,after_json,idempotency_key,payload_hash,changed_by,changed_by_name_snapshot)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        randomUUID(),
        input.clientId,
        input.orderId,
        input.eventType,
        input.fromStage ?? null,
        input.toStage ?? null,
        input.reason ?? null,
        input.before === undefined ? null : json(input.before),
        input.after === undefined ? null : json(input.after),
        input.idempotencyKey ?? null,
        input.payloadHash ?? null,
        input.actor.userId,
        input.actor.name,
      ]
    );
  }

  private async transitionEventByIdempotencyKey(
    connection: Executor,
    clientId: string,
    idempotencyKey: string
  ) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT o.public_id,e.payload_hash
       FROM erp_sale_order_events e
       INNER JOIN erp_sale_orders o ON o.client_id=e.client_id AND o.id=e.sale_order_id
       WHERE e.client_id=? AND e.idempotency_key=? LIMIT 1`,
      [clientId, idempotencyKey]
    );
    return rows[0] ?? null;
  }

  async options(clientId: string) {
    const [categories] = await this.db().execute<RowDataPacket[]>(
      `SELECT public_id publicId,name
       FROM erp_financial_categories
       WHERE client_id=? AND active=1 AND direction IN ('receivable','both')
       ORDER BY name`,
      [clientId]
    );
    const [accounts] = await this.db().execute<RowDataPacket[]>(
      `SELECT public_id publicId,name
       FROM erp_financial_accounts
       WHERE client_id=? AND active=1
       ORDER BY name`,
      [clientId]
    );
    const [sellers] = await this.db().execute<RowDataPacket[]>(
      `SELECT DISTINCT u.user_id publicId,COALESCE(NULLIF(u.name,''),u.user_id) name
       FROM megadesk_domain_client_users u
       WHERE u.client_id=?
       UNION
       SELECT DISTINCT COALESCE(o.seller_user_id,o.created_by) publicId,
              COALESCE(o.seller_name_snapshot,o.seller_user_id,o.created_by) name
       FROM erp_sale_orders o
       WHERE o.client_id=?
       ORDER BY name`,
      [clientId, clientId]
    );
    return {
      categories: categories.map(row => ({
        publicId: String(row.publicId),
        name: String(row.name),
      })),
      accounts: accounts.map(row => ({
        publicId: String(row.publicId),
        name: String(row.name),
      })),
      sellers: sellers.map(row => ({
        publicId: String(row.publicId),
        name: String(row.name),
      })),
      paymentMethods: ["Boleto bancário", "Cartão", "PIX", "Transferência", "Dinheiro"],
    };
  }

  async customers(clientId: string, search: string, page: number, pageSize: number) {
    const limit = integer(pageSize, 1, 50);
    const offset = (integer(page, 1, Number.MAX_SAFE_INTEGER) - 1) * limit;
    const like = `%${search}%`;
    const where = search
      ? "AND (company_name LIKE ? OR cpf_cnpj LIKE ? OR crm_client_id LIKE ?)"
      : "";
    const values: Array<string | number> = search
      ? [clientId, like, like, like]
      : [clientId];
    const [count] = await this.db().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM megadesk_crm_clients
       WHERE client_id=? AND lifecycle_state='active' AND status NOT IN ('inativo','cancelado') ${where}`,
      values
    );
    const [rows] = await this.db().execute<RowDataPacket[]>(
      `SELECT crm_client_id crmClientId,company_name customerName,cpf_cnpj document,
              responsible_name responsibleName,address,city,state,cep postalCode
       FROM megadesk_crm_clients
       WHERE client_id=? AND lifecycle_state='active' AND status NOT IN ('inativo','cancelado') ${where}
       ORDER BY company_name,crm_client_id LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    return {
      items: rows.map(row => ({
        crmClientId: String(row.crmClientId),
        customerName: String(row.customerName),
        document: row.document ? String(row.document) : null,
        responsibleName: String(row.responsibleName ?? ""),
        address: String(row.address ?? ""),
        city: String(row.city ?? ""),
        state: String(row.state ?? ""),
        postalCode: String(row.postalCode ?? ""),
      })),
      total: Number(count[0]?.total ?? 0),
      page,
      pageSize: limit,
    };
  }

  async catalog(clientId: string, search: string, page: number, pageSize: number) {
    const limit = integer(pageSize, 1, 50);
    const offset = (integer(page, 1, Number.MAX_SAFE_INTEGER) - 1) * limit;
    const like = `%${search}%`;
    const filter = search
      ? "AND (p.name LIKE ? OR p.sku LIKE ? OR v.sku LIKE ? OR v.name LIKE ? OR p.barcode LIKE ?)"
      : "";
    const values: Array<string | number> = search
      ? [clientId, like, like, like, like, like]
      : [clientId];
    const [count] = await this.db().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total
       FROM erp_inventory_items i
       INNER JOIN erp_products p ON p.client_id=i.client_id AND p.id=i.product_id
       LEFT JOIN erp_product_variants v ON v.client_id=i.client_id AND v.product_id=i.product_id AND v.id=i.variant_id
       WHERE i.client_id=? AND i.active=1 AND p.active=1
         AND i.kind<>'legacy_unallocated' AND (i.kind<>'variant' OR v.active=1) ${filter}`,
      values
    );
    const [rows] = await this.db().execute<RowDataPacket[]>(
      `SELECT i.public_id inventoryItemPublicId,p.public_id productPublicId,p.name,
              CASE WHEN i.kind='variant' THEN v.sku ELSE p.sku END sku,
              p.unit,COALESCE(v.sale_price_cents,p.sale_price_cents) salePriceCents,
              COALESCE(b.quantity,'0.000') availableQuantity,i.kind,
              v.public_id variantPublicId,v.name variantName,pm.media_id mediaId,
              GROUP_CONCAT(CONCAT(t.name, ': ',av.name) ORDER BY t.name SEPARATOR ' · ') variantAttributes
       FROM erp_inventory_items i
       INNER JOIN erp_products p ON p.client_id=i.client_id AND p.id=i.product_id
       LEFT JOIN erp_product_variants v ON v.client_id=i.client_id AND v.product_id=i.product_id AND v.id=i.variant_id
       LEFT JOIN erp_inventory_item_balances b ON b.client_id=i.client_id AND b.inventory_item_id=i.id
       LEFT JOIN erp_product_media pm ON pm.client_id=p.client_id AND pm.product_id=p.id AND pm.id=p.primary_media_id AND pm.state='active'
       LEFT JOIN erp_product_variant_attribute_values vv ON vv.client_id=i.client_id AND vv.variant_id=v.id
       LEFT JOIN erp_product_attribute_types t ON t.client_id=vv.client_id AND t.id=vv.attribute_type_id
       LEFT JOIN erp_product_attribute_values av ON av.client_id=vv.client_id AND av.id=vv.attribute_value_id
       WHERE i.client_id=? AND i.active=1 AND p.active=1
         AND i.kind<>'legacy_unallocated' AND (i.kind<>'variant' OR v.active=1) ${filter}
       GROUP BY i.id,p.id,v.id,pm.media_id,b.quantity
       ORDER BY p.name,v.sku,i.id LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    return {
      items: rows.map(row => ({
        inventoryItemPublicId: String(row.inventoryItemPublicId),
        productPublicId: String(row.productPublicId),
        name: String(row.name),
        sku: String(row.sku),
        unit: String(row.unit),
        availableQuantity: String(row.availableQuantity ?? "0.000"),
        kind: String(row.kind),
        variantPublicId: row.variantPublicId ? String(row.variantPublicId) : null,
        variantName: row.variantName ? String(row.variantName) : null,
        variantAttributes: row.variantAttributes ? String(row.variantAttributes) : null,
        salePriceCents: Number(row.salePriceCents),
        canonicalImage: row.mediaId
          ? {
              mediaId: String(row.mediaId),
              path: `/api/products/${row.productPublicId}/image`,
              thumbnailPath: `/api/products/${row.productPublicId}/image?variant=thumbnail`,
            }
          : null,
      })),
      total: Number(count[0]?.total ?? 0),
      page,
      pageSize: limit,
    };
  }

  async metrics(clientId: string, from?: string, to?: string) {
    const now = new Date();
    const start = from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const end = to ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const [rows] = await this.db().execute<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN o.status NOT IN ('draft','cancelled') THEN o.total_cents ELSE 0 END),0) salesCents,
         COALESCE(SUM(CASE WHEN o.status NOT IN ('draft','cancelled') THEN GREATEST(o.total_cents-COALESCE(fin.paid_cents,0),0) ELSE 0 END),0) receivableCents,
         SUM(CASE WHEN o.status NOT IN ('draft','cancelled') THEN 1 ELSE 0 END) orderCount,
         SUM(CASE WHEN o.status NOT IN ('cancelled','fulfilled') AND ${STAGE_SQL}<>'completed' THEN 1 ELSE 0 END) openOrders
       FROM erp_sale_orders o
       LEFT JOIN (
         SELECT e.client_id,e.source_public_id,COALESCE(SUM(s.paid_cents),0) paid_cents
         FROM erp_financial_entries e
         LEFT JOIN (
           SELECT client_id,financial_entry_id,SUM(amount_cents) paid_cents
           FROM erp_financial_settlements GROUP BY client_id,financial_entry_id
         ) s ON s.client_id=e.client_id AND s.financial_entry_id=e.id
         WHERE e.source_type='sales_order'
         GROUP BY e.client_id,e.source_public_id
       ) fin ON fin.client_id=o.client_id AND fin.source_public_id=o.public_id
       WHERE o.client_id=? AND o.document_type='sale' AND o.archived_at IS NULL
         AND DATE(COALESCE(o.commercial_date,o.created_at)) BETWEEN ? AND ?`,
      [clientId, start, end]
    );
    const value = rows[0] ?? {};
    const orderCount = Number(value.orderCount ?? 0);
    const salesCents = Number(value.salesCents ?? 0);
    return {
      period: { from: start, to: end, criterion: "data comercial (criação nos registros legados)" },
      salesCents,
      receivableCents: Number(value.receivableCents ?? 0),
      orderCount,
      averageTicketCents: orderCount ? Math.round(salesCents / orderCount) : 0,
      openOrders: Number(value.openOrders ?? 0),
      grossMarginPercent: null,
      grossMarginAvailable: false,
      grossMarginReason: "Custos históricos não foram registrados nos itens destas vendas.",
    };
  }

  async list(clientId: string, options: SaleListInput) {
    const limit = integer(options.pageSize, 1, 100);
    const offset = (integer(options.page, 1, Number.MAX_SAFE_INTEGER) - 1) * limit;
    const where = ["o.client_id=?"];
    const values: Array<string | number> = [clientId];
    if (options.kind === "quotes") where.push("o.document_type='quote'");
    if (options.kind === "orders") where.push("o.document_type='sale'");
    if (!options.includeArchived) where.push("o.archived_at IS NULL");
    if (options.search) {
      where.push(`(o.order_number LIKE ? OR o.customer_name_snapshot LIKE ? OR EXISTS(
        SELECT 1 FROM erp_sale_order_items si
        WHERE si.sale_order_id=o.id AND (si.product_name_snapshot LIKE ? OR si.sku_snapshot LIKE ?)
      ))`);
      const like = `%${options.search}%`;
      values.push(like, like, like, like);
    }
    if (options.crmClientId) {
      where.push("o.crm_client_id=?");
      values.push(options.crmClientId);
    }
    if (options.status) {
      where.push("o.status=?");
      values.push(options.status);
    }
    if (options.stage) {
      where.push(`${STAGE_SQL}=?`);
      values.push(options.stage);
    }
    if (options.commercialStatus) {
      where.push("o.commercial_status=?");
      values.push(options.commercialStatus);
    }
    if (options.paymentStatus) {
      where.push(
        options.paymentStatus === "pending"
          ? "COALESCE(fin.paid_cents,0)=0"
          : options.paymentStatus === "paid"
            ? "COALESCE(fin.paid_cents,0)>=o.total_cents"
            : "COALESCE(fin.paid_cents,0)>0 AND COALESCE(fin.paid_cents,0)<o.total_cents"
      );
    }
    if (options.paymentMethod) {
      where.push("o.payment_method_snapshot=?");
      values.push(options.paymentMethod);
    }
    if (options.sellerUserId) {
      where.push("COALESCE(o.seller_user_id,o.created_by)=?");
      values.push(options.sellerUserId);
    }
    if (options.from) {
      where.push("DATE(COALESCE(o.commercial_date,o.created_at))>=?");
      values.push(options.from);
    }
    if (options.to) {
      where.push("DATE(COALESCE(o.commercial_date,o.created_at))<=?");
      values.push(options.to);
    }
    const joins = `
      LEFT JOIN (
        SELECT e.client_id,e.source_public_id,COUNT(*) title_count,
               COALESCE(SUM(s.paid_cents),0) paid_cents
        FROM erp_financial_entries e
        LEFT JOIN (
          SELECT client_id,financial_entry_id,SUM(amount_cents) paid_cents
          FROM erp_financial_settlements GROUP BY client_id,financial_entry_id
        ) s ON s.client_id=e.client_id AND s.financial_entry_id=e.id
        WHERE e.source_type='sales_order'
        GROUP BY e.client_id,e.source_public_id
      ) fin ON fin.client_id=o.client_id AND fin.source_public_id=o.public_id
      LEFT JOIN (
        SELECT sale_order_id,COUNT(*) item_count,SUM(quantity) total_quantity,
               SUBSTRING_INDEX(GROUP_CONCAT(product_name_snapshot ORDER BY id SEPARATOR '\\n'),'\\n',1) first_product_name,
               SUBSTRING_INDEX(GROUP_CONCAT(product_id ORDER BY id SEPARATOR ','),',',1) first_product_id
        FROM erp_sale_order_items GROUP BY sale_order_id
      ) summary ON summary.sale_order_id=o.id
      LEFT JOIN erp_products first_product
        ON first_product.client_id=o.client_id AND first_product.id=summary.first_product_id
      LEFT JOIN erp_product_media first_media
        ON first_media.client_id=first_product.client_id
       AND first_media.product_id=first_product.id
       AND first_media.id=first_product.primary_media_id
       AND first_media.state='active'`;
    const sqlWhere = where.join(" AND ");
    const orderBy = salesListOrderBy(options.sort, options.direction);
    const [count] = await this.db().execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_sale_orders o ${joins} WHERE ${sqlWhere}`,
      values
    );
    const [rows] = await this.db().execute<OrderRow[]>(
      `SELECT o.*,COALESCE(fin.paid_cents,0) paid_cents,COALESCE(fin.title_count,0) title_count,
              COALESCE(summary.item_count,0) item_count,COALESCE(summary.total_quantity,'0.000') total_quantity,
              summary.first_product_name,first_product.public_id first_product_public_id,
              first_media.media_id first_product_media_id
       FROM erp_sale_orders o ${joins}
       WHERE ${sqlWhere}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    return { items: rows.map(publicOrder), total: Number(count[0]?.total ?? 0) };
  }

  async detail(
    clientId: string,
    publicId: string,
    connection: Executor = this.db(),
    lock = false
  ) {
    const [orders] = await connection.execute<OrderRow[]>(
      `SELECT o.* FROM erp_sale_orders o
       WHERE o.client_id=? AND o.public_id=? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [clientId, publicId]
    );
    const order = orders[0];
    if (!order) return null;
    const [expectedItems] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM erp_sale_order_items i
       INNER JOIN erp_sale_orders item_order
         ON item_order.id=i.sale_order_id AND item_order.client_id=?
       WHERE i.sale_order_id=? AND item_order.public_id=?`,
      [clientId, order.id, publicId]
    );
    const [items] = await connection.execute<ItemRow[]>(
      `SELECT i.*,p.public_id product_public_id,p.unit,
              ii.public_id inventory_item_public_id,
              CASE WHEN ii.id IS NULL THEN NULL ELSE COALESCE(ib.quantity,'0.000') END current_available,
              EXISTS(
                SELECT 1 FROM erp_sale_order_fulfillment_items fi
                INNER JOIN erp_sale_order_fulfillments f
                  ON f.id=fi.fulfillment_id AND f.client_id=?
                 AND f.sale_order_id=i.sale_order_id
                WHERE fi.sale_order_item_id=i.id
              ) stock_exited,
              pm.media_id,v.name variant_name,
              GROUP_CONCAT(CONCAT(t.name, ': ',av.name) ORDER BY t.name SEPARATOR ' · ') variant_attributes
       FROM erp_sale_order_items i
       INNER JOIN erp_sale_orders item_order
         ON item_order.id=i.sale_order_id AND item_order.client_id=?
       INNER JOIN erp_products p ON p.id=i.product_id AND p.client_id=item_order.client_id
       LEFT JOIN erp_inventory_items ii
         ON ii.id=i.inventory_item_id AND ii.product_id=i.product_id AND ii.client_id=item_order.client_id
       LEFT JOIN erp_inventory_item_balances ib
         ON ib.client_id=ii.client_id AND ib.inventory_item_id=ii.id
       LEFT JOIN erp_product_variants v
         ON v.client_id=ii.client_id AND v.product_id=ii.product_id AND v.id=ii.variant_id
       LEFT JOIN erp_product_media pm
         ON pm.client_id=p.client_id AND pm.product_id=p.id AND pm.id=p.primary_media_id AND pm.state='active'
       LEFT JOIN erp_product_variant_attribute_values vv ON vv.client_id=v.client_id AND vv.variant_id=v.id
       LEFT JOIN erp_product_attribute_types t ON t.client_id=vv.client_id AND t.id=vv.attribute_type_id
       LEFT JOIN erp_product_attribute_values av ON av.client_id=vv.client_id AND av.id=vv.attribute_value_id
       WHERE i.sale_order_id=? AND item_order.public_id=?
       GROUP BY i.id,p.id,ii.id,ib.quantity,v.id,pm.media_id
       ORDER BY i.id`,
      [clientId, clientId, order.id, publicId]
    );
    if (items.length !== Number(expectedItems[0]?.total ?? 0)) {
      throw new ErpDomainError("CONFLICT", "Pedido contém itens inconsistentes.");
    }
    const [entries] = await connection.execute<RowDataPacket[]>(
      `SELECT e.public_id publicId,e.source_installment installment,e.due_date dueDate,
              e.amount_cents amountCents,e.status,COALESCE(SUM(s.amount_cents),0) paidCents,
              e.financial_account_id accountId
       FROM erp_financial_entries e
       LEFT JOIN erp_financial_settlements s
         ON s.client_id=e.client_id AND s.financial_entry_id=e.id
       WHERE e.client_id=? AND e.source_type='sales_order' AND e.source_public_id=?
       GROUP BY e.id ORDER BY e.source_installment`,
      [clientId, publicId]
    );
    const [events] = await connection.execute<RowDataPacket[]>(
      `SELECT event_type eventType,from_stage fromStage,to_stage toStage,reason,
              before_json beforeJson,after_json afterJson,changed_by changedBy,
              changed_by_name_snapshot changedByName,created_at createdAt
       FROM erp_sale_order_events
       WHERE client_id=? AND sale_order_id=? ORDER BY created_at,id`,
      [clientId, order.id]
    );
    const [legacyHistory] = await connection.execute<RowDataPacket[]>(
      `SELECT h.from_status fromStatus,h.to_status toStatus,h.reason,h.changed_by changedBy,
              u.name changedByName,h.created_at createdAt
       FROM erp_sale_order_history h
       LEFT JOIN megadesk_domain_client_users u ON u.client_id=? AND u.user_id=h.changed_by
       WHERE h.sale_order_id=? ORDER BY h.created_at,h.id`,
      [clientId, order.id]
    );
    const [relations] = await connection.execute<RowDataPacket[]>(
      `SELECT 'source_quote' relation_type,public_id,order_number
       FROM erp_sale_orders WHERE client_id=? AND id=?
       UNION ALL
       SELECT 'converted_sale' relation_type,public_id,order_number
       FROM erp_sale_orders WHERE client_id=? AND source_quote_id=?`,
      [clientId, order.source_quote_id ?? 0, clientId, order.id]
    );
    const installments = entries.map(entry => ({
      publicId: String(entry.publicId),
      installment: Number(entry.installment),
      dueDate: dateOnly(entry.dueDate),
      amountCents: Number(entry.amountCents),
      paidCents: Number(entry.paidCents),
      status: String(entry.status),
      paymentStatus:
        String(entry.status) === "cancelled"
          ? "cancelled"
          : Number(entry.paidCents) >= Number(entry.amountCents)
            ? "paid"
            : Number(entry.paidCents) > 0
              ? "partial"
              : "pending",
    }));
    const paidCents = installments.reduce((sum, entry) => sum + entry.paidCents, 0);
    const currentStage = order.current_stage ?? legacySaleStage(order.status);
    return {
      ...publicOrder({ ...order, paid_cents: paidCents, title_count: entries.length }),
      items: items.map(entry => ({
        publicId: entry.public_id,
        productPublicId: entry.product_public_id,
        inventoryItemPublicId: entry.inventory_item_public_id ?? null,
        productName: entry.product_name_snapshot,
        variantName: entry.variant_attributes || entry.variant_name || null,
        sku: entry.sku_snapshot,
        unit: entry.unit ?? "unit",
        quantity: entry.quantity,
        unitPriceCents: Number(entry.unit_price_cents),
        discountCents: Number(entry.discount_cents),
        lineTotalCents: Number(entry.line_total_cents),
        currentAvailable: entry.current_available ?? null,
        stockExitRecorded: Boolean(entry.stock_exited),
        canonicalImage: entry.media_id
          ? {
              mediaId: entry.media_id,
              path: `/api/products/${entry.product_public_id}/image`,
              thumbnailPath: `/api/products/${entry.product_public_id}/image?variant=thumbnail`,
            }
          : null,
      })),
      installments,
      financialHistoryAvailable: entries.length > 0,
      historyComplete: events.length > 0,
      history: [
        ...legacyHistory.map(entry => ({
          source: "legacy" as const,
          eventType: String(entry.toStatus) === "fulfilled" ? "stage_transition" : String(entry.toStatus),
          fromStage: entry.fromStatus ? legacySaleStage(entry.fromStatus as SaleStatus) : null,
          toStage: legacySaleStage(entry.toStatus as SaleStatus),
          reason: entry.reason ? String(entry.reason) : null,
          changedBy: String(entry.changedBy),
          changedByName: entry.changedByName ? String(entry.changedByName) : null,
          createdAt: String(entry.createdAt),
          before: null,
          after: null,
        })),
        ...events.map(entry => ({
          source: "audit" as const,
          eventType: String(entry.eventType),
          fromStage: entry.fromStage ? String(entry.fromStage) : null,
          toStage: entry.toStage ? String(entry.toStage) : null,
          reason: entry.reason ? String(entry.reason) : null,
          changedBy: String(entry.changedBy),
          changedByName: entry.changedByName ? String(entry.changedByName) : null,
          createdAt: String(entry.createdAt),
          before: parseJson(entry.beforeJson ? String(entry.beforeJson) : null),
          after: parseJson(entry.afterJson ? String(entry.afterJson) : null),
        })),
      ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      sourceQuote: relations.find(row => row.relation_type === "source_quote")
        ? {
            publicId: String(relations.find(row => row.relation_type === "source_quote")!.public_id),
            orderNumber: String(relations.find(row => row.relation_type === "source_quote")!.order_number),
          }
        : null,
      convertedSale: relations.find(row => row.relation_type === "converted_sale")
        ? {
            publicId: String(relations.find(row => row.relation_type === "converted_sale")!.public_id),
            orderNumber: String(relations.find(row => row.relation_type === "converted_sale")!.order_number),
          }
        : null,
      currentStage,
    };
  }

  private async validateReferences(
    connection: PoolConnection,
    clientId: string,
    userId: string,
    input: SaleDraftInput,
    options: { enforceStock: boolean }
  ) {
    const [customers] = await connection.execute<RowDataPacket[]>(
      `SELECT crm_client_id,company_name,responsible_name,address,city,state,cep,status
       FROM megadesk_crm_clients
       WHERE client_id=? AND crm_client_id=? AND lifecycle_state='active'
         AND status NOT IN ('inativo','cancelado') LIMIT 1`,
      [clientId, input.crmClientId]
    );
    if (!customers[0]) throw new ErpDomainError("NOT_FOUND", "Cliente ativo não encontrado.");
    const products: Array<{
      id: number;
      name: string;
      sku: string;
      productPublicId: string;
      inventoryItemPublicId?: string | null;
      quantity: string;
      unitPriceCents: number;
      discountCents: number;
      lineTotalCents: number;
      inventoryItemId: number;
    }> = [];
    for (const requested of input.items) {
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id,public_id,name,sku,active,minimum_stock
         FROM erp_products WHERE client_id=? AND public_id=? LIMIT 1`,
        [clientId, requested.productPublicId]
      );
      if (!rows[0]) throw new ErpDomainError("NOT_FOUND", "Produto não encontrado.");
      if (Number(rows[0].active) !== 1) throw new ErpDomainError("INACTIVE_PRODUCT", "Produto inativo.");
      const inventoryItem = await this.inventory().resolveForOperation(connection, {
        clientId,
        productId: Number(rows[0].id),
        requestedPublicId: requested.inventoryItemPublicId ?? null,
        userId,
        productMinimumStock: String(rows[0].minimum_stock ?? "0.000"),
      });
      // Quotes are commercial proposals: they must reference an active, tenant-owned
      // inventory item, but do not reserve or consume stock. A real sale is still
      // validated while its balance is locked, so concurrent writes cannot oversell.
      if (options.enforceStock) {
        const availableQuantity = await this.inventory().lockBalance(
          connection,
          clientId,
          inventoryItem.id
        );
        if (quantityMillis(requested.quantity) > quantityMillis(availableQuantity)) {
          throw new ErpDomainError(
            "INSUFFICIENT_STOCK",
            `Estoque insuficiente para ${String(rows[0].name)}. Disponível: ${availableQuantity}. Solicitado: ${requested.quantity}.`
          );
        }
      }
      const [variant] = await connection.execute<RowDataPacket[]>(
        `SELECT v.sku,v.name,
                GROUP_CONCAT(CONCAT(t.name, ': ',av.name) ORDER BY t.name SEPARATOR ' · ') attributes
         FROM erp_inventory_items ii
         LEFT JOIN erp_product_variants v
           ON v.client_id=ii.client_id AND v.product_id=ii.product_id AND v.id=ii.variant_id
         LEFT JOIN erp_product_variant_attribute_values vv ON vv.client_id=v.client_id AND vv.variant_id=v.id
         LEFT JOIN erp_product_attribute_types t ON t.client_id=vv.client_id AND t.id=vv.attribute_type_id
         LEFT JOIN erp_product_attribute_values av ON av.client_id=vv.client_id AND av.id=vv.attribute_value_id
         WHERE ii.client_id=? AND ii.id=? GROUP BY ii.id,v.id`,
        [clientId, inventoryItem.id]
      );
      const variantLabel = variant[0]?.attributes || variant[0]?.name;
      products.push({
        id: Number(rows[0].id),
        name: variantLabel ? `${rows[0].name} · ${variantLabel}` : String(rows[0].name),
        sku: variant[0]?.sku ? String(variant[0].sku) : String(rows[0].sku),
        ...requested,
        lineTotalCents:
          lineTotalCents(requested.quantity, requested.unitPriceCents) - requested.discountCents,
        inventoryItemId: inventoryItem.id,
      });
    }
    if (hasDuplicateResolvedInventoryItem(products)) {
      throw new ErpDomainError("CONFLICT", "Item de estoque duplicado no pedido.");
    }
    return { customer: customers[0], products };
  }

  private async assertOrderStockAvailable(
    connection: PoolConnection,
    clientId: string,
    orderId: number
  ) {
    const [items] = await connection.execute<RowDataPacket[]>(
      `SELECT i.inventory_item_id,i.quantity,i.product_name_snapshot,
              ii.id resolved_inventory_item_id,ii.active inventory_item_active
       FROM erp_sale_order_items i
       LEFT JOIN erp_inventory_items ii
         ON ii.id=i.inventory_item_id AND ii.client_id=?
       WHERE i.sale_order_id=? ORDER BY i.inventory_item_id`,
      [clientId, orderId]
    );
    const unavailable: string[] = [];
    for (const item of items) {
      if (!item.resolved_inventory_item_id || !Number(item.inventory_item_active)) {
        unavailable.push(`${String(item.product_name_snapshot)} (item indisponível)`);
        continue;
      }
      const available = await this.inventory().lockBalance(
        connection,
        clientId,
        Number(item.inventory_item_id)
      );
      if (quantityMillis(String(item.quantity)) > quantityMillis(available)) {
        unavailable.push(
          `${String(item.product_name_snapshot)} (solicitado: ${String(item.quantity)}; disponível: ${available})`
        );
      }
    }
    if (unavailable.length) {
      throw new ErpDomainError(
        "INSUFFICIENT_STOCK",
        `Estoque insuficiente para concluir a venda: ${unavailable.join("; ")}.`
      );
    }
  }

  private async reconcileConfirmedTotal(
    connection: PoolConnection,
    clientId: string,
    actor: Actor,
    order: NonNullable<Awaited<ReturnType<SaleRepository["detail"]>>>,
    newTotalCents: number
  ) {
    const previousTotalCents = order.totalCents;
    if (previousTotalCents === newTotalCents || order.documentType !== "sale") return null;
    if (order.currentStage === "created") return null;
    const [entries] = await connection.execute<RowDataPacket[]>(
      `SELECT id,amount_cents,status,source_installment
       FROM erp_financial_entries
       WHERE client_id=? AND source_type='sales_order' AND source_public_id=?
       ORDER BY source_installment,id FOR UPDATE`,
      [clientId, order.publicId]
    );
    if (!entries.length) {
      throw new ErpDomainError(
        "CONFLICT",
        "A venda confirmada não possui títulos conciliáveis. Corrija o financeiro antes de editar o total."
      );
    }
    const enriched: Array<RowDataPacket & { paidCents: number }> = [];
    for (const entry of entries) {
      const [payments] = await connection.execute<RowDataPacket[]>(
        `SELECT amount_cents FROM erp_financial_settlements
         WHERE client_id=? AND financial_entry_id=? ORDER BY id FOR UPDATE`,
        [clientId, entry.id]
      );
      enriched.push({
        ...entry,
        paidCents: payments.reduce((sum, payment) => sum + Number(payment.amount_cents), 0),
      });
    }
    const paidCents = enriched.reduce((sum, entry) => sum + entry.paidCents, 0);
    const titleTotalCents = enriched.reduce((sum, entry) => sum + Number(entry.amount_cents), 0);
    if (titleTotalCents !== previousTotalCents) {
      throw new ErpDomainError(
        "CONFLICT",
        "Os títulos atuais não correspondem ao total da venda. Corrija o financeiro antes de editar valores."
      );
    }
    if (newTotalCents < paidCents) {
      throw new ErpDomainError(
        "CONFLICT",
        `O novo total não pode ser menor que o valor já recebido (${paidCents} centavos). Os recebimentos foram preservados.`
      );
    }
    let delta = newTotalCents - previousTotalCents;
    if (delta > 0) {
      const target = [...enriched].reverse().find(entry => entry.status !== "cancelled");
      if (!target) throw new ErpDomainError("CONFLICT", "Nenhum título pode receber o ajuste financeiro.");
      await connection.execute(
        `UPDATE erp_financial_entries
         SET amount_cents=amount_cents+?,status='open',settled_at=NULL,settled_by=NULL
         WHERE client_id=? AND id=?`,
        [delta, clientId, target.id]
      );
      delta = 0;
    } else if (delta < 0) {
      let reduction = Math.abs(delta);
      for (const entry of [...enriched].reverse()) {
        if (entry.status === "cancelled" || reduction <= 0) continue;
        const amountCents = Number(entry.amount_cents);
        const reducible = Math.max(0, amountCents - entry.paidCents);
        if (!reducible) continue;
        const applied = Math.min(reduction, reducible);
        const nextAmount = amountCents - applied;
        const nextStatus = nextAmount === 0 ? "cancelled" : nextAmount === entry.paidCents ? "settled" : "open";
        await connection.execute(
          `UPDATE erp_financial_entries SET amount_cents=?,status=?,
           cancelled_at=CASE WHEN ?='cancelled' THEN NOW() ELSE cancelled_at END,
           cancelled_by=CASE WHEN ?='cancelled' THEN ? ELSE cancelled_by END,
           cancellation_reason=CASE WHEN ?='cancelled' THEN 'Ajuste transacional da venda' ELSE cancellation_reason END,
           settled_at=CASE WHEN ?='settled' THEN COALESCE(settled_at,NOW()) ELSE NULL END,
           settled_by=CASE WHEN ?='settled' THEN COALESCE(settled_by,?) ELSE NULL END
           WHERE client_id=? AND id=?`,
          [
            nextAmount,
            nextStatus,
            nextStatus,
            nextStatus,
            actor.userId,
            nextStatus,
            nextStatus,
            nextStatus,
            actor.userId,
            clientId,
            entry.id,
          ]
        );
        reduction -= applied;
      }
      if (reduction > 0) {
        throw new ErpDomainError(
          "CONFLICT",
          "O total não pode ser reduzido sem reescrever recebimentos já registrados."
        );
      }
    }
    await this.insertEvent(connection, {
      clientId,
      orderId: order.id,
      eventType: "financial_adjusted",
      actor,
      fromStage: order.currentStage,
      toStage: order.currentStage,
      before: { totalCents: previousTotalCents, paidCents },
      after: { totalCents: newTotalCents, paidCents },
    });
    return { previousTotalCents, newTotalCents, paidCents };
  }

  async save(
    clientId: string,
    actor: Actor,
    input: SaleDraftInput,
    publicId?: string
  ) {
    const connection = await this.db().getConnection();
    let orderId = 0;
    const target = publicId ?? randomUUID();
    let financialAdjustment: { previousTotalCents: number; newTotalCents: number; paidCents: number } | null = null;
    try {
      await connection.beginTransaction();
      const refs = await this.validateReferences(connection, clientId, actor.userId, input, {
        enforceStock: input.documentType === "sale",
      });
      const totals = calculateSaleTotals(
        input.items,
        input.orderDiscountCents,
        input.freightCents,
        input.chargesCents
      );
      const customerAddress = {
        recipientName: String(refs.customer.responsible_name || refs.customer.company_name || ""),
        postalCode: String(refs.customer.cep || ""),
        street: String(refs.customer.address || ""),
        number: "",
        complement: "",
        district: "",
        city: String(refs.customer.city || ""),
        state: String(refs.customer.state || ""),
      };
      const shippingAddress = input.shippingAddress ?? customerAddress;
      const billingAddress = input.billingAddress ?? shippingAddress;
      let current: NonNullable<Awaited<ReturnType<SaleRepository["detail"]>>> | null = null;
      if (publicId) {
        current = await this.detail(clientId, publicId, connection, true);
        if (!current) throw new ErpDomainError("NOT_FOUND", "Pedido não encontrado.");
        if (!this.canEditOrder(current)) {
          throw new ErpDomainError(
            "CONFLICT",
            "Este documento não pode mais ser editado com segurança. Vendas enviadas e orçamentos encerrados são imutáveis."
          );
        }
        if (input.documentType !== current.documentType) {
          throw new ErpDomainError("CONFLICT", "O tipo comercial do documento não pode ser alterado.");
        }
        const [rows] = await connection.execute<RowDataPacket[]>(
          "SELECT id FROM erp_sale_orders WHERE client_id=? AND public_id=?",
          [clientId, publicId]
        );
        orderId = Number(rows[0].id);
        financialAdjustment = await this.reconcileConfirmedTotal(
          connection,
          clientId,
          actor,
          current,
          totals.totalCents
        );
      }
      const seller = current && input.sellerUserId === undefined
        ? { publicId: current.sellerUserId, name: current.sellerName }
        : await this.resolveSeller(connection, clientId, actor, input.sellerUserId);
      if (!publicId) {
        const orderNumber = await this.nextCommercialCode(connection, clientId, input.documentType);
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO erp_sale_orders
           (public_id,client_id,order_number,document_type,commercial_status,commercial_date,
            crm_client_id,customer_name_snapshot,seller_user_id,seller_name_snapshot,status,current_stage,
            notes,payment_terms_snapshot,payment_method_snapshot,expected_date,shipping_address_snapshot,
            billing_address_snapshot,subtotal_cents,discount_cents,freight_cents,charges_cents,total_cents,created_by)
           VALUES(?,?,?,?,?,?, ?,?,?,?,'draft','created', ?,?,?,?,?,?,0,0,0,0,0,?)`,
          [
            target,
            clientId,
            orderNumber,
            input.documentType,
            input.documentType === "quote" ? "draft" : "active",
            input.commercialDate ?? new Date().toISOString().slice(0, 10),
            refs.customer.crm_client_id,
            refs.customer.company_name,
            seller.publicId,
            seller.name,
            input.notes,
            input.paymentTerms,
            input.paymentMethod,
            input.expectedDate,
            json(shippingAddress),
            json(billingAddress),
            actor.userId,
          ]
        );
        orderId = result.insertId;
        await this.insertEvent(connection, {
          clientId,
          orderId,
          eventType: "created",
          actor,
          toStage: "created",
        });
      }
      const [existingItems] = await connection.execute<RowDataPacket[]>(
        `SELECT id,inventory_item_id FROM erp_sale_order_items
         WHERE sale_order_id=? ORDER BY id FOR UPDATE`,
        [orderId]
      );
      const existingByInventory = new Map(
        existingItems.map(entry => [Number(entry.inventory_item_id), Number(entry.id)])
      );
      const retainedItemIds: number[] = [];
      for (const product of refs.products) {
        const existingId = existingByInventory.get(product.inventoryItemId);
        if (existingId) {
          await connection.execute(
            `UPDATE erp_sale_order_items SET product_id=?,inventory_item_id=?,product_name_snapshot=?,
             sku_snapshot=?,quantity=?,unit_price_cents=?,discount_cents=?,line_total_cents=?
             WHERE sale_order_id=? AND id=?`,
            [
              product.id,
              product.inventoryItemId,
              product.name,
              product.sku,
              product.quantity,
              product.unitPriceCents,
              product.discountCents,
              product.lineTotalCents,
              orderId,
              existingId,
            ]
          );
          retainedItemIds.push(existingId);
        } else {
          const [created] = await connection.execute<ResultSetHeader>(
            `INSERT INTO erp_sale_order_items
             (public_id,sale_order_id,product_id,inventory_item_id,product_name_snapshot,sku_snapshot,quantity,unit_price_cents,discount_cents,line_total_cents)
             VALUES(?,?,?,?,?,?,?,?,?,?)`,
            [
              randomUUID(),
              orderId,
              product.id,
              product.inventoryItemId,
              product.name,
              product.sku,
              product.quantity,
              product.unitPriceCents,
              product.discountCents,
              product.lineTotalCents,
            ]
          );
          retainedItemIds.push(created.insertId);
        }
      }
      if (existingItems.length) {
        await connection.execute(
          `DELETE FROM erp_sale_order_items
           WHERE sale_order_id=? AND id NOT IN (${retainedItemIds.map(() => "?").join(",")})`,
          [orderId, ...retainedItemIds]
        );
      }
      await connection.execute(
        `UPDATE erp_sale_orders SET crm_client_id=?,customer_name_snapshot=?,seller_user_id=?,seller_name_snapshot=?,
         commercial_date=?,notes=?,payment_terms_snapshot=?,payment_method_snapshot=?,
         expected_date=?,shipping_address_snapshot=?,billing_address_snapshot=?,subtotal_cents=?,discount_cents=?,
         freight_cents=?,charges_cents=?,total_cents=?
         WHERE client_id=? AND id=?`,
        [
          refs.customer.crm_client_id,
          refs.customer.company_name,
          seller.publicId,
          seller.name,
          input.commercialDate ?? current?.commercialDate ?? new Date().toISOString().slice(0, 10),
          input.notes,
          input.paymentTerms,
          input.paymentMethod,
          input.expectedDate,
          json(shippingAddress),
          json(billingAddress),
          totals.subtotalCents,
          totals.itemDiscountCents + totals.orderDiscountCents,
          totals.freightCents,
          totals.chargesCents,
          totals.totalCents,
          clientId,
          orderId,
        ]
      );
      if (publicId) {
        await this.insertEvent(connection, {
          clientId,
          orderId,
          eventType: "updated",
          actor,
          fromStage: current!.currentStage,
          toStage: current!.currentStage,
          before: {
            customer: current!.customerName,
            seller: current!.sellerName,
            totalCents: current!.totalCents,
            itemCount: current!.items.length,
          },
          after: {
            customer: refs.customer.company_name,
            seller: seller.name,
            totalCents: totals.totalCents,
            itemCount: refs.products.length,
          },
        });
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    const order = await this.detail(clientId, target);
    return order ? { ...order, financialAdjustment } : order;
  }

  async confirm(clientId: string, actor: Actor, input: SaleConfirmationInput) {
    const connection = await this.db().getConnection();
    const payloadHash = hash({
      publicId: input.publicId,
      paymentMethod: input.paymentMethod,
      categoryPublicId: input.categoryPublicId,
      financialAccountPublicId: input.financialAccountPublicId ?? null,
      receivedCents: input.receivedCents,
      installments: input.installments,
    });
    let replay = false;
    try {
      await connection.beginTransaction();
      const order = await this.detail(clientId, input.publicId, connection, true);
      if (!order) throw new ErpDomainError("NOT_FOUND", "Venda não encontrada.");
      if (order.documentType !== "sale") {
        throw new ErpDomainError(
          "CONFLICT",
          "Orçamentos devem ser convertidos em venda antes da confirmação financeira."
        );
      }
      if (order.archivedAt) throw new ErpDomainError("CONFLICT", "Documento arquivado é imutável.");
      const [keyOwners] = await connection.execute<RowDataPacket[]>(
        `SELECT public_id,confirmation_payload_hash
         FROM erp_sale_orders
         WHERE client_id=? AND confirmation_idempotency_key=? LIMIT 1 FOR UPDATE`,
        [clientId, input.idempotencyKey]
      );
      if (keyOwners[0] && String(keyOwners[0].public_id) !== input.publicId) {
        throw new ErpDomainError(
          "IDEMPOTENCY_CONFLICT",
          "Chave idempotente já usada na confirmação de outra venda."
        );
      }
      if (order.confirmationIdempotencyKey) {
        if (
          order.confirmationIdempotencyKey === input.idempotencyKey &&
          order.confirmationPayloadHash === payloadHash
        ) {
          replay = true;
          await connection.commit();
          return { order: await this.detail(clientId, input.publicId), replay };
        }
        throw new ErpDomainError(
          "IDEMPOTENCY_CONFLICT",
          "A venda já foi confirmada com outra composição financeira."
        );
      }
      if (order.status !== "draft" || order.currentStage !== "created") {
        throw new ErpDomainError("CONFLICT", "Somente vendas na etapa Criada podem ser confirmadas.");
      }
      const installmentTotal = input.installments.reduce(
        (sum, installment) => sum + BigInt(installment.amountCents),
        0n
      );
      if (installmentTotal !== BigInt(order.totalCents)) {
        throw new ErpDomainError(
          "VALIDATION",
          "A soma das parcelas deve ser exatamente igual ao total da venda."
        );
      }
      if (input.receivedCents > order.totalCents) {
        throw new ErpDomainError(
          "VALIDATION",
          "O valor recebido não pode exceder o total da venda."
        );
      }
      if (input.receivedCents > 0 && !input.financialAccountPublicId) {
        throw new ErpDomainError(
          "VALIDATION",
          "Selecione a conta que recebeu o pagamento."
        );
      }
      const [references] = await connection.execute<RowDataPacket[]>(
        `SELECT c.id category_id,c.active category_active,c.direction,
                a.id account_id,a.active account_active,a.current_balance_cents
         FROM erp_financial_categories c
         LEFT JOIN erp_financial_accounts a
           ON a.client_id=c.client_id AND a.public_id=?
         WHERE c.client_id=? AND c.public_id=? LIMIT 1 FOR UPDATE`,
        [input.financialAccountPublicId ?? null, clientId, input.categoryPublicId]
      );
      if (!references[0] || !Number(references[0].category_active)) {
        throw new ErpDomainError("NOT_FOUND", "Categoria financeira de recebimento não encontrada.");
      }
      if (!["receivable", "both"].includes(String(references[0].direction))) {
        throw new ErpDomainError("CONFLICT", "A categoria selecionada não aceita títulos a receber.");
      }
      if (input.financialAccountPublicId && !Number(references[0].account_active)) {
        throw new ErpDomainError("CONFLICT", "Conta financeira não encontrada ou inativa.");
      }
      const [existingEntries] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM erp_financial_entries
         WHERE client_id=? AND source_type='sales_order' AND source_public_id=? FOR UPDATE`,
        [clientId, input.publicId]
      );
      if (existingEntries.length) {
        throw new ErpDomainError(
          "CONFLICT",
          "A venda já possui títulos financeiros e não pode ser confirmada novamente."
        );
      }
      const [activeReferences] = await connection.execute<RowDataPacket[]>(
        `SELECT c.status customer_status,COUNT(i.id) item_count,
                SUM(p.id IS NULL OR p.active=0) invalid_products
         FROM erp_sale_orders o
         INNER JOIN megadesk_crm_clients c ON c.crm_client_id=o.crm_client_id AND c.client_id=o.client_id
         LEFT JOIN erp_sale_order_items i ON i.sale_order_id=o.id
         LEFT JOIN erp_products p ON p.id=i.product_id AND p.client_id=o.client_id
         WHERE o.id=? GROUP BY c.status`,
        [order.id]
      );
      if (
        !activeReferences[0] ||
        ["inativo", "cancelado"].includes(String(activeReferences[0].customer_status)) ||
        Number(activeReferences[0].item_count) < 1 ||
        Number(activeReferences[0].invalid_products) > 0
      ) {
        throw new ErpDomainError(
          "CONFLICT",
          "Cliente e produtos devem permanecer ativos para a confirmação."
        );
      }
      await this.assertOrderStockAvailable(connection, clientId, order.id);
      let receiptRemaining = input.receivedCents;
      let accountBalance = Number(references[0].current_balance_cents ?? 0);
      for (const [index, installment] of input.installments.entries()) {
        const number = index + 1;
        const entryPublicId = randomUUID();
        const [entryResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO erp_financial_entries
           (public_id,client_id,document_number,direction,status,description,amount_cents,due_date,issue_date,category_id,financial_account_id,crm_client_id,source_type,source_public_id,source_installment,party_name_snapshot,created_by)
           VALUES(?,?,?,'receivable','open',?,?,?,CURRENT_DATE,?,?,?,'sales_order',?,?,?,?)`,
          [
            entryPublicId,
            clientId,
            `${order.orderNumber}-${String(number).padStart(2, "0")}/${String(input.installments.length).padStart(2, "0")}`,
            `Venda ${order.orderNumber} · parcela ${number}/${input.installments.length}`,
            installment.amountCents,
            installment.dueDate,
            references[0].category_id,
            references[0].account_id ?? null,
            order.crmClientId,
            input.publicId,
            number,
            order.customerName,
            actor.userId,
          ]
        );
        const receiptForInstallment = Math.min(receiptRemaining, installment.amountCents);
        if (receiptForInstallment > 0) {
          const resultingBalance = accountBalance + receiptForInstallment;
          const settlementPublicId = randomUUID();
          const [settlementResult] = await connection.execute<ResultSetHeader>(
            `INSERT INTO erp_financial_settlements
             (public_id,client_id,financial_entry_id,financial_account_id,idempotency_key,amount_cents,settled_by)
             VALUES(?,?,?,?,?,?,?)`,
            [
              settlementPublicId,
              clientId,
              entryResult.insertId,
              references[0].account_id,
              `${input.idempotencyKey}:initial:${number}`,
              receiptForInstallment,
              actor.userId,
            ]
          );
          await connection.execute(
            `INSERT INTO erp_financial_ledger
             (public_id,client_id,financial_account_id,financial_entry_id,settlement_id,type,amount_cents,previous_balance_cents,resulting_balance_cents,occurred_at,created_by,metadata)
             VALUES(?,?,?,?,?,'receivable_settlement',?,?,?,NOW(),?,?)`,
            [
              randomUUID(),
              clientId,
              references[0].account_id,
              entryResult.insertId,
              settlementResult.insertId,
              receiptForInstallment,
              accountBalance,
              resultingBalance,
              actor.userId,
              json({ kind: "sale_confirmation", partial: receiptForInstallment < installment.amountCents }),
            ]
          );
          const settled = receiptForInstallment === installment.amountCents;
          await connection.execute(
            `UPDATE erp_financial_entries
             SET status=?,settled_at=CASE WHEN ? THEN NOW() ELSE NULL END,
                 settled_by=CASE WHEN ? THEN ? ELSE NULL END
             WHERE client_id=? AND id=?`,
            [settled ? "settled" : "open", settled, settled, actor.userId, clientId, entryResult.insertId]
          );
          accountBalance = resultingBalance;
          receiptRemaining -= receiptForInstallment;
        }
      }
      if (input.receivedCents > 0) {
        await connection.execute(
          `UPDATE erp_financial_accounts SET current_balance_cents=?
           WHERE client_id=? AND id=?`,
          [accountBalance, clientId, references[0].account_id]
        );
      }
      await connection.execute(
        `UPDATE erp_sale_orders
         SET status='confirmed',current_stage='confirmed',commercial_status='active',confirmed_by=?,confirmed_at=NOW(),
             payment_method_snapshot=?,confirmation_idempotency_key=?,confirmation_payload_hash=?
         WHERE client_id=? AND id=?`,
        [
          actor.userId,
          input.paymentMethod,
          input.idempotencyKey,
          payloadHash,
          clientId,
          order.id,
        ]
      );
      await this.insertEvent(connection, {
        clientId,
        orderId: order.id,
        eventType: "confirmed",
        actor,
        fromStage: "created",
        toStage: "confirmed",
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        after: {
          paymentMethod: input.paymentMethod,
          installmentCount: input.installments.length,
           totalCents: order.totalCents,
           receivedCents: input.receivedCents,
           stockReserved: false,
         },
       });
      if (input.receivedCents > 0) {
        const paymentEvent = {
          amountCents: input.receivedCents,
          paidCents: input.receivedCents,
          pendingCents: order.totalCents - input.receivedCents,
        };
        await this.insertEvent(connection, {
          clientId,
          orderId: order.id,
          eventType: "payment_registered",
          actor,
          fromStage: "confirmed",
          toStage: "confirmed",
          idempotencyKey: `${input.idempotencyKey}:initial-payment`,
          payloadHash: hash(paymentEvent),
          after: paymentEvent,
        });
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return { order: await this.detail(clientId, input.publicId), replay };
  }

  private async applyStockExit(
    connection: PoolConnection,
    clientId: string,
    actor: Actor,
    order: NonNullable<Awaited<ReturnType<SaleRepository["detail"]>>>,
    key: string
  ) {
    const [existing] = await connection.execute<RowDataPacket[]>(
      `SELECT id,idempotency_key FROM erp_sale_order_fulfillments
       WHERE client_id=? AND sale_order_id=? LIMIT 1`,
      [clientId, order.id]
    );
    if (existing[0]) {
      throw new ErpDomainError(
        "CONFLICT",
        "A saída de estoque desta venda já foi registrada e não será repetida."
      );
    }
    const [items] = await connection.execute<ItemRow[]>(
      `SELECT i.*,p.public_id product_public_id,ii.public_id inventory_item_public_id
       FROM erp_sale_order_items i
       INNER JOIN erp_products p ON p.id=i.product_id AND p.client_id=?
       INNER JOIN erp_inventory_items ii
         ON ii.id=i.inventory_item_id AND ii.product_id=i.product_id AND ii.client_id=p.client_id
       WHERE i.sale_order_id=? ORDER BY i.product_id,i.inventory_item_id FOR UPDATE`,
      [clientId, order.id]
    );
    if (items.length !== order.items.length) {
      throw new ErpDomainError(
        "CONFLICT",
        "Todos os itens da venda devem permanecer vinculados ao tenant antes do envio."
      );
    }
    const productBalances = new Map<number, bigint>();
    const itemBalances = new Map<number, bigint>();
    const snapshots = new Map<number, { product: bigint; item: bigint; result: bigint; itemResult: bigint }>();
    for (const item of items) {
      if (item.inventory_item_id === null) {
        throw new ErpDomainError("CONFLICT", "Item sem identidade de estoque não pode ser enviado.");
      }
      let productBalance = productBalances.get(item.product_id);
      if (productBalance === undefined) {
        await connection.execute(
          "INSERT IGNORE INTO erp_stock_balances(client_id,product_id,quantity,version) VALUES(?,?,0,0)",
          [clientId, item.product_id]
        );
        const [balances] = await connection.execute<RowDataPacket[]>(
          "SELECT quantity FROM erp_stock_balances WHERE client_id=? AND product_id=? FOR UPDATE",
          [clientId, item.product_id]
        );
        productBalance = quantityMillis(String(balances[0]?.quantity ?? "0.000"));
      }
      let itemBalance = itemBalances.get(item.inventory_item_id);
      if (itemBalance === undefined) {
        itemBalance = quantityMillis(
          await this.inventory().lockBalance(connection, clientId, item.inventory_item_id)
        );
      }
      const amount = quantityMillis(item.quantity);
      if (productBalance < amount || itemBalance < amount) {
        throw new ErpDomainError(
          "INSUFFICIENT_STOCK",
          `Estoque insuficiente para enviar ${item.product_name_snapshot}.`
        );
      }
      const result = productBalance - amount;
      const itemResult = itemBalance - amount;
      snapshots.set(item.id, { product: productBalance, item: itemBalance, result, itemResult });
      productBalances.set(item.product_id, result);
      itemBalances.set(item.inventory_item_id, itemResult);
    }
    const [fulfillment] = await connection.execute<ResultSetHeader>(
      `INSERT INTO erp_sale_order_fulfillments
       (public_id,client_id,sale_order_id,idempotency_key,fulfilled_by)
       VALUES(?,?,?,?,?)`,
      [randomUUID(), clientId, order.id, key, actor.userId]
    );
    for (const item of items) {
      const balances = snapshots.get(item.id)!;
      const movementPublicId = randomUUID();
      const itemKey = `${key}:${item.public_id}`;
      const payloadHash = hash({
        salePublicId: order.publicId,
        itemPublicId: item.public_id,
        quantity: item.quantity,
      });
      const [movement] = await connection.execute<ResultSetHeader>(
        `INSERT INTO erp_stock_movements
         (public_id,client_id,product_id,inventory_item_id,type,direction,quantity,previous_balance,resulting_balance,inventory_previous_balance,inventory_resulting_balance,reason,reference_type,reference_id,idempotency_key,payload_hash,created_by)
         VALUES(?,?,?,?,'sale_out','out',?,?,?,?,?,'Envio da venda','sale',?,?,?,?)`,
        [
          movementPublicId,
          clientId,
          item.product_id,
          item.inventory_item_id,
          item.quantity,
          millisQuantity(balances.product),
          millisQuantity(balances.result),
          millisQuantity(balances.item),
          millisQuantity(balances.itemResult),
          order.publicId,
          itemKey,
          payloadHash,
          actor.userId,
        ]
      );
      await connection.execute(
        "UPDATE erp_stock_balances SET quantity=?,version=version+1 WHERE client_id=? AND product_id=?",
        [millisQuantity(balances.result), clientId, item.product_id]
      );
      await this.inventory().setBalance(
        connection,
        clientId,
        item.inventory_item_id!,
        millisQuantity(balances.itemResult)
      );
      await connection.execute(
        `INSERT INTO erp_sale_order_fulfillment_items
         (fulfillment_id,sale_order_item_id,product_id,inventory_item_id,quantity,stock_movement_id)
         VALUES(?,?,?,?,?,?)`,
        [
          fulfillment.insertId,
          item.id,
          item.product_id,
          item.inventory_item_id,
          item.quantity,
          movement.insertId,
        ]
      );
    }
  }

  async transition(clientId: string, actor: Actor, input: SaleTransitionInput) {
    const connection = await this.db().getConnection();
    const payloadHash = hash({ publicId: input.publicId, toStage: input.toStage, reason: input.reason ?? null });
    let replay = false;
    let stockChanged = false;
    try {
      await connection.beginTransaction();
      const order = await this.detail(clientId, input.publicId, connection, true);
      if (!order) throw new ErpDomainError("NOT_FOUND", "Venda não encontrada.");
      if (order.documentType !== "sale" || order.archivedAt) {
        throw new ErpDomainError("CONFLICT", "Somente vendas ativas mudam de etapa operacional.");
      }
      const oldEvent = await this.transitionEventByIdempotencyKey(
        connection,
        clientId,
        input.idempotencyKey
      );
      if (oldEvent) {
        if (
          String(oldEvent.public_id) !== input.publicId ||
          String(oldEvent.payload_hash) !== payloadHash
        ) {
          throw new ErpDomainError("IDEMPOTENCY_CONFLICT", "Chave idempotente já usada em outra transição.");
        }
        replay = true;
        await connection.commit();
        return { order: await this.detail(clientId, input.publicId), replay, stockChanged };
      }
      if (order.status === "cancelled") throw new ErpDomainError("CONFLICT", "Venda cancelada não muda de etapa.");
      const fromStage = order.currentStage;
      if (fromStage === "created") {
        throw new ErpDomainError(
          "CONFLICT",
          "A confirmação deve definir as parcelas e criar os títulos na mesma operação."
        );
      }
      const transitionKind = saleTransitionKind(fromStage, input.toStage);
      if (transitionKind === "blocked") {
        const message =
          fromStage === "shipped" && input.toStage === "separation"
            ? "Não é possível voltar de Enviado para Separação sem uma reversão específica de estoque."
            : "Transição de etapa não permitida.";
        throw new ErpDomainError("CONFLICT", message);
      }
      if (transitionKind === "correction" && !input.reason) {
        throw new ErpDomainError("VALIDATION", "Correções logísticas exigem um motivo para auditoria.");
      }
      stockChanged = isStockExitTransition(fromStage, input.toStage);
      if (stockChanged) {
        await this.applyStockExit(connection, clientId, actor, order, input.idempotencyKey);
      }
      await connection.execute(
        `UPDATE erp_sale_orders SET current_stage=?,
         status=CASE WHEN ?='completed' THEN 'fulfilled' ELSE 'confirmed' END,
         commercial_status=CASE WHEN ?='completed' THEN 'completed' ELSE commercial_status END,
         fulfilled_by=CASE WHEN ?='completed' THEN ? ELSE fulfilled_by END,
         fulfilled_at=CASE WHEN ?='completed' THEN NOW() ELSE fulfilled_at END
         WHERE client_id=? AND id=?`,
        [
          input.toStage,
          input.toStage,
          input.toStage,
          input.toStage,
          actor.userId,
          input.toStage,
          clientId,
          order.id,
        ]
      );
      await this.insertEvent(connection, {
        clientId,
        orderId: order.id,
        eventType: "stage_transition",
        actor,
        fromStage,
        toStage: input.toStage,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        after: { stockMovementCreated: stockChanged },
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (isTransitionIdempotencyDuplicate(error)) {
        const winner = await this.transitionEventByIdempotencyKey(
          connection,
          clientId,
          input.idempotencyKey
        );
        if (!winner) throw error;
        if (
          String(winner.public_id) !== input.publicId ||
          String(winner.payload_hash) !== payloadHash
        ) {
          throw new ErpDomainError("IDEMPOTENCY_CONFLICT", "Chave idempotente já usada em outra transição.");
        }
        replay = true;
        stockChanged = false;
        return {
          order: await this.detail(clientId, input.publicId, connection),
          replay,
          stockChanged,
        };
      }
      throw error;
    } finally {
      connection.release();
    }
    return { order: await this.detail(clientId, input.publicId), replay, stockChanged };
  }

  async cancel(clientId: string, actor: Actor, publicId: string, reason: string) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const order = await this.detail(clientId, publicId, connection, true);
      if (!order) throw new ErpDomainError("NOT_FOUND", "Venda não encontrada.");
      if (order.status === "cancelled") throw new ErpDomainError("CONFLICT", "Venda já cancelada.");
      if (!canCancelSaleAtStage(order.currentStage)) {
        throw new ErpDomainError(
          "CONFLICT",
          "Vendas enviadas não podem ser canceladas enquanto a reversão de estoque não estiver disponível."
        );
      }
      const [entries] = await connection.execute<RowDataPacket[]>(
        `SELECT id,status FROM erp_financial_entries
         WHERE client_id=? AND source_type='sales_order' AND source_public_id=?
         ORDER BY id FOR UPDATE`,
        [clientId, publicId]
      );
      let receivedCents = 0n;
      for (const entry of entries) {
        const [settlements] = await connection.execute<RowDataPacket[]>(
          `SELECT amount_cents FROM erp_financial_settlements
           WHERE client_id=? AND financial_entry_id=? FOR UPDATE`,
          [clientId, entry.id]
        );
        receivedCents += settlements.reduce(
          (sum, settlement) => sum + BigInt(String(settlement.amount_cents)),
          0n
        );
      }
      if (receivedCents > 0n) {
        throw new ErpDomainError(
          "CONFLICT",
          "Esta venda possui recebimentos e não pode ser cancelada porque o estorno financeiro ainda não está disponível."
        );
      }
      await connection.execute(
        `UPDATE erp_financial_entries
         SET status='cancelled',cancelled_at=NOW(),cancelled_by=?,cancellation_reason=?
         WHERE client_id=? AND source_type='sales_order' AND source_public_id=? AND status='open'`,
        [actor.userId, reason, clientId, publicId]
      );
      await connection.execute(
        `UPDATE erp_sale_orders SET status='cancelled',commercial_status='cancelled',current_stage=COALESCE(current_stage,?),
         cancelled_by=?,cancelled_at=NOW(),cancellation_reason=? WHERE client_id=? AND id=?`,
        [order.currentStage, actor.userId, reason, clientId, order.id]
      );
      await this.insertEvent(connection, {
        clientId,
        orderId: order.id,
        eventType: "cancelled",
        actor,
        fromStage: order.currentStage,
        toStage: order.currentStage,
        reason,
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.detail(clientId, publicId);
  }

  async correctAddress(clientId: string, actor: Actor, input: SaleAddressCorrectionInput) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const order = await this.detail(clientId, input.publicId, connection, true);
      if (!order) throw new ErpDomainError("NOT_FOUND", "Venda não encontrada.");
      if (order.status === "cancelled") throw new ErpDomainError("CONFLICT", "Venda cancelada não pode ter endereço alterado.");
      if (!["confirmed", "separation"].includes(order.currentStage)) {
        throw new ErpDomainError(
          "CONFLICT",
          "O endereço só pode ser corrigido após a confirmação e até a etapa Separação."
        );
      }
      const before = {
        shippingAddress: order.shippingAddress,
        billingAddress: order.billingAddress,
      };
      const after = {
        shippingAddress: input.shippingAddress,
        billingAddress: input.billingAddress,
      };
      await connection.execute(
        `UPDATE erp_sale_orders SET shipping_address_snapshot=?,billing_address_snapshot=?
         WHERE client_id=? AND id=?`,
        [json(input.shippingAddress), json(input.billingAddress), clientId, order.id]
      );
      await this.insertEvent(connection, {
        clientId,
        orderId: order.id,
        eventType: "address_corrected",
        actor,
        fromStage: order.currentStage,
        toStage: order.currentStage,
        reason: input.reason,
        before,
        after,
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.detail(clientId, input.publicId);
  }

  async duplicate(
    clientId: string,
    actor: Actor,
    publicId: string,
    idempotencyKey: string
  ) {
    const connection = await this.db().getConnection();
    let target = "";
    let replay = false;
    try {
      await connection.beginTransaction();
      const source = await this.detail(clientId, publicId, connection, true);
      if (!source) throw new ErpDomainError("NOT_FOUND", "Documento comercial não encontrado.");
      const [existing] = await connection.execute<RowDataPacket[]>(
        `SELECT public_id,duplicate_source_id FROM erp_sale_orders
         WHERE client_id=? AND duplication_idempotency_key=? LIMIT 1 FOR UPDATE`,
        [clientId, idempotencyKey]
      );
      if (existing[0]) {
        if (Number(existing[0].duplicate_source_id) !== source.id) {
          throw new ErpDomainError(
            "IDEMPOTENCY_CONFLICT",
            "Chave idempotente já usada para duplicar outro documento."
          );
        }
        target = String(existing[0].public_id);
        replay = true;
        await connection.commit();
        return { order: await this.detail(clientId, target), replay };
      }
      const orderNumber = await this.nextCommercialCode(connection, clientId, source.documentType);
      target = randomUUID();
      const [created] = await connection.execute<ResultSetHeader>(
        `INSERT INTO erp_sale_orders
         (public_id,client_id,order_number,document_type,commercial_status,commercial_date,
          crm_client_id,customer_name_snapshot,seller_user_id,seller_name_snapshot,status,current_stage,
          notes,payment_terms_snapshot,payment_method_snapshot,expected_date,shipping_address_snapshot,
          billing_address_snapshot,subtotal_cents,discount_cents,freight_cents,charges_cents,total_cents,
          duplicate_source_id,duplication_idempotency_key,created_by)
         SELECT ?,client_id,?,document_type,CASE WHEN document_type='quote' THEN 'draft' ELSE 'active' END,
          CURRENT_DATE,crm_client_id,customer_name_snapshot,seller_user_id,seller_name_snapshot,'draft','created',
          notes,payment_terms_snapshot,payment_method_snapshot,expected_date,shipping_address_snapshot,
          billing_address_snapshot,subtotal_cents,discount_cents,freight_cents,charges_cents,total_cents,
          id,?,?
         FROM erp_sale_orders WHERE client_id=? AND id=?`,
        [target, orderNumber, idempotencyKey, actor.userId, clientId, source.id]
      );
      await connection.execute(
        `INSERT INTO erp_sale_order_items
         (public_id,sale_order_id,product_id,inventory_item_id,product_name_snapshot,sku_snapshot,
          quantity,unit_price_cents,discount_cents,line_total_cents)
         SELECT UUID(),?,product_id,inventory_item_id,product_name_snapshot,sku_snapshot,
          quantity,unit_price_cents,discount_cents,line_total_cents
         FROM erp_sale_order_items WHERE sale_order_id=? ORDER BY id`,
        [created.insertId, source.id]
      );
      await this.insertEvent(connection, {
        clientId,
        orderId: created.insertId,
        eventType: "duplicated",
        actor,
        toStage: "created",
        idempotencyKey,
        payloadHash: hash({ sourcePublicId: publicId, documentType: source.documentType }),
        after: { sourcePublicId: publicId, sourceNumber: source.orderNumber },
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return { order: await this.detail(clientId, target), replay };
  }

  async commercialTransition(
    clientId: string,
    actor: Actor,
    input: SaleCommercialTransitionInput
  ) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const order = await this.detail(clientId, input.publicId, connection, true);
      if (!order) throw new ErpDomainError("NOT_FOUND", "Orçamento não encontrado.");
      if (order.documentType !== "quote" || order.archivedAt) {
        throw new ErpDomainError("CONFLICT", "Somente orçamentos ativos possuem fluxo comercial.");
      }
      const transitionKind = saleCommercialTransitionKind(order.commercialStatus, input.toStatus);
      if (transitionKind === "blocked") {
        throw new ErpDomainError("CONFLICT", "Transição comercial não permitida.");
      }
      if ((transitionKind === "correction" || input.toStatus === "lost") && !input.reason) {
        throw new ErpDomainError("VALIDATION", "Informe o motivo da correção comercial.");
      }
      await connection.execute(
        `UPDATE erp_sale_orders SET commercial_status=? WHERE client_id=? AND id=?`,
        [input.toStatus, clientId, order.id]
      );
      await this.insertEvent(connection, {
        clientId,
        orderId: order.id,
        eventType: "quote_status_changed",
        actor,
        fromStage: order.currentStage,
        toStage: order.currentStage,
        reason: input.reason,
        before: { commercialStatus: order.commercialStatus },
        after: { commercialStatus: input.toStatus },
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.detail(clientId, input.publicId);
  }

  async convertQuote(
    clientId: string,
    actor: Actor,
    publicId: string,
    idempotencyKey: string
  ) {
    const connection = await this.db().getConnection();
    let target = publicId;
    let replay = false;
    try {
      await connection.beginTransaction();
      const quote = await this.detail(clientId, publicId, connection, true);
      if (!quote) throw new ErpDomainError("NOT_FOUND", "Orçamento não encontrado.");
      const [legacyConversion] = await connection.execute<RowDataPacket[]>(
        `SELECT public_id,source_quote_id,conversion_idempotency_key FROM erp_sale_orders
         WHERE client_id=? AND source_quote_id=?
         LIMIT 1 FOR UPDATE`,
        [clientId, quote.id]
      );
      if (legacyConversion[0]) {
        target = String(legacyConversion[0].public_id);
        replay = true;
        await connection.commit();
        return { order: await this.detail(clientId, target), replay };
      }
      const [locked] = await connection.execute<RowDataPacket[]>(
        `SELECT id,public_id,document_type,commercial_status,archived_at,conversion_idempotency_key
         FROM erp_sale_orders WHERE client_id=? AND id=? LIMIT 1 FOR UPDATE`,
        [clientId, quote.id]
      );
      const row = locked[0];
      if (!row) throw new ErpDomainError("NOT_FOUND", "Orçamento não encontrado.");
      target = String(row.public_id);
      if (String(row.document_type) === "sale") {
        if (String(row.conversion_idempotency_key ?? "") !== idempotencyKey) {
          throw new ErpDomainError(
            "IDEMPOTENCY_CONFLICT",
            "Este orçamento já foi convertido em venda por outra solicitação."
          );
        }
        replay = true;
        await connection.commit();
        return { order: await this.detail(clientId, target), replay };
      }
      if (quote.documentType !== "quote" || quote.commercialStatus !== "approved" || quote.archivedAt) {
        throw new ErpDomainError(
          "CONFLICT",
          "Apenas um orçamento aprovado e ativo pode ser convertido em venda."
        );
      }
      const [keyOwner] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM erp_sale_orders WHERE client_id=? AND conversion_idempotency_key=? LIMIT 1 FOR UPDATE`,
        [clientId, idempotencyKey]
      );
      if (keyOwner[0] && Number(keyOwner[0].id) !== quote.id) {
        throw new ErpDomainError(
          "IDEMPOTENCY_CONFLICT",
          "Chave idempotente já usada para converter outro orçamento."
        );
      }
      await this.assertOrderStockAvailable(connection, clientId, quote.id);
      const orderNumber = await this.nextCommercialCode(connection, clientId, "sale");
      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE erp_sale_orders
         SET order_number=?,document_type='sale',commercial_status='active',commercial_date=CURRENT_DATE,
             status='draft',current_stage='created',source_quote_id=NULL,conversion_idempotency_key=?
         WHERE client_id=? AND id=? AND document_type='quote'`,
        [orderNumber, idempotencyKey, clientId, quote.id]
      );
      if (updated.affectedRows !== 1) {
        throw new ErpDomainError(
          "CONFLICT",
          "O orçamento mudou durante a conversão; atualize a tela e tente novamente."
        );
      }
      await this.insertEvent(connection, {
        clientId,
        orderId: quote.id,
        eventType: "quote_converted",
        actor,
        fromStage: quote.currentStage,
        toStage: quote.currentStage,
        idempotencyKey,
        payloadHash: hash({ quotePublicId: publicId, quoteId: quote.id }),
        after: {
          orderPublicId: target,
          orderId: quote.id,
          quoteNumber: quote.orderNumber,
          saleNumber: orderNumber,
        },
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return { order: await this.detail(clientId, target), replay };
  }

  async archive(clientId: string, actor: Actor, publicId: string, reason: string) {
    const connection = await this.db().getConnection();
    try {
      await connection.beginTransaction();
      const order = await this.detail(clientId, publicId, connection, true);
      if (!order) throw new ErpDomainError("NOT_FOUND", "Documento comercial não encontrado.");
      if (order.archivedAt) {
        await connection.commit();
        return order;
      }
      // The UI's "Excluir orçamento" is an auditable archive, never a physical
      // delete. Converted quotes are retained as part of the sale relationship.
      const terminal = order.documentType === "quote"
        ? order.commercialStatus !== "converted"
        : order.cancelled || order.currentStage === "completed";
      if (!terminal) {
        throw new ErpDomainError(
          "CONFLICT",
          "Somente documentos concluídos, convertidos, perdidos ou cancelados podem ser arquivados."
        );
      }
      await connection.execute(
        `UPDATE erp_sale_orders SET archived_by=?,archived_at=NOW() WHERE client_id=? AND id=?`,
        [actor.userId, clientId, order.id]
      );
      await this.insertEvent(connection, {
        clientId,
        orderId: order.id,
        eventType: "archived",
        actor,
        fromStage: order.currentStage,
        toStage: order.currentStage,
        reason,
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.detail(clientId, publicId);
  }

  async fulfill(clientId: string, actor: Actor, publicId: string, key: string) {
    return this.transition(clientId, actor, {
      publicId,
      toStage: "shipped",
      idempotencyKey: key,
      reason: null,
    });
  }
}

function publicOrder(row: OrderRow) {
  const currentStage = row.current_stage ?? legacySaleStage(row.status);
  const paidCents = Number(row.paid_cents ?? 0);
  const totalCents = Number(row.total_cents);
  const documentType = row.document_type ?? "sale";
  const commercialStatus = row.commercial_status ?? (documentType === "quote" ? "draft" : "active");
  const archivedAt = row.archived_at ?? null;
  const canEdit = !archivedAt && row.status !== "cancelled" && (
    documentType === "quote"
      ? !["converted", "lost", "cancelled"].includes(commercialStatus)
      : ["created", "confirmed", "separation"].includes(currentStage)
  );
  return {
    id: Number(row.id),
    publicId: row.public_id,
    orderNumber: row.order_number,
    documentType,
    commercialStatus,
    commercialDate: row.commercial_date ? dateOnly(row.commercial_date) : dateOnly(row.created_at),
    crmClientId: row.crm_client_id,
    customerName: row.customer_name_snapshot,
    sellerName: row.seller_name_snapshot,
    sellerUserId: row.seller_user_id,
    status: row.status,
    currentStage,
    cancelled: row.status === "cancelled",
    notes: row.notes,
    expectedDate: row.expected_date ? dateOnly(row.expected_date) : null,
    shippingAddress: parseJson<AddressSnapshot>(row.shipping_address_snapshot),
    billingAddress: parseJson<AddressSnapshot>(row.billing_address_snapshot),
    subtotalCents: Number(row.subtotal_cents),
    discountCents: Number(row.discount_cents),
    freightCents: Number(row.freight_cents),
    chargesCents: Number(row.charges_cents ?? 0),
    totalCents,
    paymentMethod: row.payment_method_snapshot,
    paymentTerms: row.payment_terms_snapshot,
    paidCents,
    balanceCents: Math.max(0, totalCents - paidCents),
    paymentStatus: derivePaymentStatus(totalCents, paidCents),
    titleCount: Number(row.title_count ?? 0),
    itemCount: Number(row.item_count ?? 0),
    totalQuantity: String(row.total_quantity ?? "0.000"),
    firstProductName: row.first_product_name ?? null,
    firstProductImage: row.first_product_public_id && row.first_product_media_id
      ? {
          productPublicId: row.first_product_public_id,
          path: `/api/products/${row.first_product_public_id}/image`,
          thumbnailPath: `/api/products/${row.first_product_public_id}/image?variant=thumbnail`,
        }
      : null,
    confirmationIdempotencyKey: row.confirmation_idempotency_key,
    confirmationPayloadHash: row.confirmation_payload_hash,
    confirmedAt: row.confirmed_at,
    fulfilledAt: row.fulfilled_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    sourceQuoteId: row.source_quote_id,
    archivedAt,
    canEdit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
