import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import type mysql from "mysql2/promise";
import { getPool } from "../../db";
import { createChamadoWithActivity, type CanonicalTicketActor } from "../../chamados-domain";
import { evoSendText } from "../../evolution/client";
import { instanceNameFor } from "../../evolution/session-store";
import { emitOperationalTenantEvent } from "../whatsapp/socket/whatsapp.socket";
import { isTenantAdminRole } from "../ai-memory/tenant-ai-memory";
import { assertTenantNiche, getTenantNicheContext, type NicheQueryExecutor } from "../niche-guard";

export type DeliveryOrderSource = "site" | "whatsapp" | "manual";
export type DeliveryAddressType = "casa" | "apartamento" | "comercial" | "outro";
export type DeliveryOrderStatus = "pending" | "assigned" | "in_route" | "delivered" | "canceled";
export type MotoboyHistoryPeriod = "today" | "week" | "month" | "custom";

export interface DeliveryOrderItem {
  productPublicId?: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface RestaurantMenuItem {
  id: string;
  productId: number;
  name: string;
  sku: string;
  category: string | null;
  price: number;
  priceCents: number;
}

export const RESTAURANT_TICKET_STATUSES = [
  { name: "Novo Pedido", color: "#ef4444", order: 1 },
  { name: "Em Preparo", color: "#f59e0b", order: 2 },
  { name: "Pronto p/ Motoboy", color: "#8b5cf6", order: 3 },
  { name: "Em Rota com Motoboy", color: "#0ea5e9", order: 4 },
  { name: "Entregue", color: "#10b981", order: 5 },
] as const;

export type RestaurantStageLabel = (typeof RESTAURANT_TICKET_STATUSES)[number]["name"];

export interface DeliveryOrderRecord {
  id: string;
  clientId: string;
  ticketId: string;
  ticketNumber?: number | null;
  orderSource: DeliveryOrderSource;
  items: DeliveryOrderItem[];
  itemsSummary: string;
  orderTotal: number;
  deliveryFee: number;
  paymentMethod: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  addressType: DeliveryAddressType;
  addressComplement: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  currentLat: number | null;
  currentLng: number | null;
  locationUpdatedAt: string | null;
  motoboyUserId: string | null;
  routeSequence: number;
  deliveryCode: string;
  trackingToken: string;
  trackingUrl: string;
  trackingExpiresAt: string | null;
  deliveryStatus: DeliveryOrderStatus;
  stageLabel: string;
  erpSalePublicId: string | null;
  acceptedAt: string | null;
  startedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface DeliveryDependencies {
  pool?: NicheQueryExecutor;
  sendWhatsApp?: (input: { clientId: string; phone: string; message: string }) => Promise<unknown>;
  createTicket?: typeof createChamadoWithActivity;
}

export function normalizeDeliveryItems(
  rawItems?: Array<{
    productPublicId?: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
  }> | null
): DeliveryOrderItem[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return [];
  const result: DeliveryOrderItem[] = [];
  for (const item of rawItems) {
    const name = String(item?.name ?? "").trim();
    if (!name) continue;
    const quantity = Math.max(1, Number(item.quantity || 1));
    const unitPrice = Math.max(0, Number(item.unitPrice || 0));
    const subtotal = Number((quantity * unitPrice).toFixed(2));
    result.push({
      productPublicId: item.productPublicId ? String(item.productPublicId).trim() : null,
      name,
      quantity,
      unitPrice,
      subtotal,
    });
  }
  return result;
}

export function formatDeliveryItemsSummary(items: readonly DeliveryOrderItem[]): string {
  if (!items || items.length === 0) return "";
  return items
    .map((item) => {
      const qtyLabel = Number.isInteger(item.quantity) ? String(item.quantity) : item.quantity.toFixed(2);
      const priceStr = item.subtotal > 0 ? ` (R$ ${item.subtotal.toFixed(2).replace(".", ",")})` : "";
      return `${qtyLabel}x ${item.name}${priceStr}`;
    })
    .join(", ");
}

function parseItemsJson(raw: unknown): DeliveryOrderItem[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return normalizeDeliveryItems(parsed);
  } catch {
    return [];
  }
}

const ORDER_SOURCE_LABEL: Record<DeliveryOrderSource, string> = {
  whatsapp: "WhatsApp IA",
  site: "Site",
  manual: "Manual",
};

/**
 * Grava evento no Histórico do Ticket usando as colunas canônicas da tabela
 * `megadesk_domain_chamado_activities`.
 */
export async function recordDeliveryTicketActivity(
  pool: NicheQueryExecutor,
  input: {
    clientId: string;
    ticketId: string;
    actorUserId?: string | null;
    actorUserName?: string | null;
    actionType?: string;
    description: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const attendant = String(input.actorUserName || "Sistema Delivery").trim().slice(0, 180) || "Sistema Delivery";
  const actorUserId = String(input.actorUserId || "system").trim().slice(0, 80) || "system";
  const description = String(input.description || "Atualização de delivery.").trim().slice(0, 2000);
  const actionType = String(input.actionType || "status_changed").trim().slice(0, 64);

  await pool
    .execute(
      `INSERT INTO megadesk_domain_chamado_activities
       (activity_id, chamado_id, client_id, description, attendant, actor_user_id, action_type, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        `act-${randomUUID()}`,
        input.ticketId,
        input.clientId,
        description,
        attendant,
        actorUserId,
        actionType,
        JSON.stringify({ eventType: actionType, ...(input.metadata ?? {}) }),
      ]
    )
    .catch((err) => {
      console.warn("[DeliveryService] Falha ao gravar atividade no Histórico do Ticket:", err);
    });
}

let deliveryTableEnsured = false;

export function resetDeliveryTableEnsuredState(): void {
  deliveryTableEnsured = false;
}

export async function ensureDeliveryOrdersTable(
  pool: NicheQueryExecutor = getPool()
): Promise<void> {
  if (deliveryTableEnsured) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS megadesk_delivery_orders (
      id VARCHAR(64) PRIMARY KEY,
      client_id VARCHAR(80) NOT NULL,
      ticket_id VARCHAR(80) NOT NULL,
      order_source ENUM('site','whatsapp','manual') NOT NULL DEFAULT 'manual',
      items_json LONGTEXT NULL,
      items_summary TEXT NULL,
      order_total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      payment_method VARCHAR(80) NOT NULL DEFAULT 'A combinar',
      customer_name VARCHAR(180) NOT NULL,
      customer_phone VARCHAR(40) NOT NULL,
      delivery_address TEXT NOT NULL,
      address_type ENUM('casa','apartamento','comercial','outro') NOT NULL DEFAULT 'casa',
      address_complement VARCHAR(255) NULL,
      destination_lat DOUBLE NULL,
      destination_lng DOUBLE NULL,
      current_lat DOUBLE NULL,
      current_lng DOUBLE NULL,
      location_updated_at DATETIME NULL,
      motoboy_user_id VARCHAR(128) NULL,
      route_sequence INT NOT NULL DEFAULT 1,
      delivery_code VARCHAR(4) NOT NULL,
      tracking_token VARCHAR(64) NOT NULL,
      tracking_expires_at DATETIME NULL,
      delivery_status ENUM('pending','assigned','in_route','delivered','canceled') NOT NULL DEFAULT 'pending',
      stage_label VARCHAR(64) NOT NULL DEFAULT 'Novo Pedido',
      erp_sale_public_id VARCHAR(64) NULL,
      accepted_at DATETIME NULL,
      started_at DATETIME NULL,
      delivered_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_mdo_ticket (ticket_id),
      UNIQUE KEY uq_mdo_tracking_token (tracking_token),
      INDEX idx_mdo_client_status (client_id, delivery_status),
      INDEX idx_mdo_client_motoboy (client_id, motoboy_user_id, route_sequence)
    )
  `);

  const alterMigrations = [
    "ALTER TABLE megadesk_delivery_orders ADD COLUMN current_lat DOUBLE NULL",
    "ALTER TABLE megadesk_delivery_orders ADD COLUMN current_lng DOUBLE NULL",
    "ALTER TABLE megadesk_delivery_orders ADD COLUMN location_updated_at DATETIME NULL",
    "ALTER TABLE megadesk_delivery_orders ADD COLUMN items_json LONGTEXT NULL",
    "ALTER TABLE megadesk_delivery_orders ADD COLUMN erp_sale_public_id VARCHAR(64) NULL",
    "ALTER TABLE megadesk_delivery_orders ADD COLUMN accepted_at DATETIME NULL",
  ];
  for (const sql of alterMigrations) {
    try {
      await pool.execute(sql);
    } catch (err: any) {
      if (err?.code !== "ER_DUP_FIELDNAME") {
        // Ignora apenas erro de coluna já existente; falhas em fakes sem suporte a ALTER também são seguras
        if (err?.code) throw err;
      }
    }
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS megadesk_motoboy_locations (
      id VARCHAR(64) PRIMARY KEY,
      client_id VARCHAR(80) NOT NULL,
      motoboy_user_id VARCHAR(128) NOT NULL,
      active_order_id VARCHAR(64) NULL,
      lat DOUBLE NOT NULL,
      lng DOUBLE NOT NULL,
      speed DOUBLE NULL,
      heading DOUBLE NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_mml_client_motoboy (client_id, motoboy_user_id),
      INDEX idx_mml_client_updated (client_id, updated_at)
    )
  `);

  deliveryTableEnsured = true;
}

export function generateDeliveryCode(): string {
  return String(randomInt(1000, 10000));
}

export function generateTrackingToken(): string {
  return randomBytes(24).toString("hex");
}

export function buildDeliveryTrackingUrl(trackingToken: string): string {
  const base = (process.env.TRACKING_PUBLIC_BASE_URL || "https://app.megadesk.online")
    .trim()
    .replace(/\/+$/, "");
  return `${base}/r/${trackingToken}`;
}

export function buildStartRouteWhatsAppMessage(trackingUrl: string, deliveryCode: string): string {
  return `🛵 Seu pedido saiu para entrega! Acompanhe o trajeto ao vivo pelo link: ${trackingUrl}. Ao receber, informe o código de confirmação: *${deliveryCode}*.`;
}

function mapRowToDeliveryOrder(row: any): DeliveryOrderRecord {
  const trackingToken = String(row.tracking_token);
  const items = parseItemsJson(row.items_json);
  const summaryFromRow = String(row.items_summary ?? "").trim();
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    ticketId: String(row.ticket_id),
    ticketNumber: row.ticket_number != null ? Number(row.ticket_number) : null,
    orderSource: (row.order_source || "manual") as DeliveryOrderSource,
    items,
    itemsSummary: summaryFromRow || formatDeliveryItemsSummary(items),
    orderTotal: Number(row.order_total ?? 0),
    deliveryFee: Number(row.delivery_fee ?? 0),
    paymentMethod: String(row.payment_method ?? "A combinar"),
    customerName: String(row.customer_name ?? ""),
    customerPhone: String(row.customer_phone ?? ""),
    deliveryAddress: String(row.delivery_address ?? ""),
    addressType: (row.address_type || "casa") as DeliveryAddressType,
    addressComplement: row.address_complement ? String(row.address_complement) : null,
    destinationLat: row.destination_lat != null ? Number(row.destination_lat) : null,
    destinationLng: row.destination_lng != null ? Number(row.destination_lng) : null,
    currentLat: row.current_lat != null ? Number(row.current_lat) : null,
    currentLng: row.current_lng != null ? Number(row.current_lng) : null,
    locationUpdatedAt: row.location_updated_at ? new Date(row.location_updated_at).toISOString() : null,
    motoboyUserId: row.motoboy_user_id ? String(row.motoboy_user_id) : null,
    routeSequence: Number(row.route_sequence ?? 1),
    deliveryCode: String(row.delivery_code),
    trackingToken,
    trackingUrl: buildDeliveryTrackingUrl(trackingToken),
    trackingExpiresAt: row.tracking_expires_at ? new Date(row.tracking_expires_at).toISOString() : null,
    deliveryStatus: (row.delivery_status || "pending") as DeliveryOrderStatus,
    stageLabel: String(row.stage_label || "Novo Pedido"),
    erpSalePublicId: row.erp_sale_public_id ? String(row.erp_sale_public_id) : null,
    acceptedAt: row.accepted_at ? new Date(row.accepted_at).toISOString() : null,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
}

/**
 * Verifica se o usuário autenticado é motoboy ou administrador do tenant.
 */
export async function assertMotoboyOrAdmin(
  input: {
    clientId: string;
    userId?: string | null;
    role?: string | null;
    permissions?: readonly string[] | null;
  },
  pool: NicheQueryExecutor = getPool()
): Promise<{ isAdmin: boolean; isMotoboy: boolean; userId: string }> {
  const isAdmin = isTenantAdminRole(input.role);
  const perms = Array.isArray(input.permissions) ? input.permissions : [];
  let isMotoboy =
    String(input.role || "").trim().toLowerCase() === "motoboy" ||
    perms.some((p) => String(p).trim().toLowerCase() === "motoboy");

  const userId = String(input.userId || "").trim();
  if (!isAdmin && !isMotoboy && userId) {
    try {
      const [rows] = (await pool.execute(
        "SELECT role, permissions_json FROM megadesk_domain_client_users WHERE client_id = ? AND user_id = ? AND status = 'active' LIMIT 1",
        [input.clientId, userId]
      )) as any[];
      const row = rows?.[0];
      if (row) {
        if (String(row.role || "").toLowerCase() === "motoboy") isMotoboy = true;
        try {
          const dbPerms = JSON.parse(row.permissions_json || "[]");
          if (Array.isArray(dbPerms) && dbPerms.some((p) => String(p).toLowerCase() === "motoboy")) {
            isMotoboy = true;
          }
        } catch {}
      }
    } catch {}
  }

  if (!isAdmin && !isMotoboy) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Acesso restrito a motoboys ou administradores deste restaurante.",
    });
  }

  if (!userId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Identificador do usuário não encontrado na sessão.",
    });
  }

  return { isAdmin, isMotoboy, userId };
}

/**
 * Garante que os 5 status operacionais de delivery existam automaticamente
 * em `megadesk_ticket_statuses` apenas para tenants do nicho `restaurante`.
 */
export async function ensureRestaurantTicketStatuses(
  clientId: string,
  pool: NicheQueryExecutor = getPool()
): Promise<Array<{ statusId: string; name: string; color: string; order: number }>> {
  await assertTenantNiche(clientId, ["restaurante"], pool);

  const [existingRows] = (await pool.execute(
    "SELECT status_id, name, color, `order` FROM megadesk_ticket_statuses WHERE client_id = ? ORDER BY `order` ASC",
    [clientId]
  )) as any[];

  const existingNames = new Set(
    (existingRows || []).map((r: any) => String(r.name || "").trim().toLowerCase())
  );

  for (const st of RESTAURANT_TICKET_STATUSES) {
    if (!existingNames.has(st.name.toLowerCase())) {
      await pool.execute(
        "INSERT INTO megadesk_ticket_statuses (status_id, client_id, name, color, `order`, is_default) VALUES (?, ?, ?, ?, ?, true)",
        [randomUUID(), clientId, st.name, st.color, st.order]
      );
    }
  }

  const [rows] = (await pool.execute(
    "SELECT status_id, name, color, `order` FROM megadesk_ticket_statuses WHERE client_id = ? ORDER BY `order` ASC",
    [clientId]
  )) as any[];

  return (rows || []).map((r: any) => ({
    statusId: String(r.status_id),
    name: String(r.name),
    color: String(r.color),
    order: Number(r.order ?? 0),
  }));
}

/**
 * Lista produtos ativos do catálogo ERP > Produtos como cardápio do restaurante.
 */
export async function getRestaurantMenuCatalog(
  clientId: string,
  search?: string,
  pool: NicheQueryExecutor = getPool()
): Promise<RestaurantMenuItem[]> {
  await assertTenantNiche(clientId, ["restaurante"], pool);
  const term = String(search || "").trim();
  const [rows] = (term
    ? await pool.execute(
        `SELECT id, public_id, name, sku, category, sale_price_cents
         FROM erp_products
         WHERE client_id = ? AND active = 1
           AND (name LIKE ? OR sku LIKE ? OR COALESCE(category, '') LIKE ?)
         ORDER BY name ASC
         LIMIT 200`,
        [clientId, `%${term}%`, `%${term}%`, `%${term}%`]
      )
    : await pool.execute(
        `SELECT id, public_id, name, sku, category, sale_price_cents
         FROM erp_products
         WHERE client_id = ? AND active = 1
         ORDER BY name ASC
         LIMIT 200`,
        [clientId]
      )) as any[];

  return (rows || []).map((r: any) => {
    const priceCents = Math.max(0, Number(r.sale_price_cents ?? 0));
    return {
      id: String(r.public_id),
      productId: Number(r.id),
      name: String(r.name),
      sku: String(r.sku ?? ""),
      category: r.category ? String(r.category) : null,
      price: Number((priceCents / 100).toFixed(2)),
      priceCents,
    };
  });
}

/**
 * Sincroniza um pedido de delivery com `ERP > Vendas` (`erp_sale_orders` + `erp_sale_order_items`).
 * Resolve produtos do catálogo por `productPublicId` ou nome exato/aproximado e nunca bloqueia
 * a operação de restaurante por saldo de estoque zerado (já que o nicho restaurante oculta estoque).
 */
export async function syncDeliveryOrderToErpSale(
  input: {
    clientId: string;
    ticketId: string;
    ticketNumber?: number | null;
    customerId?: string | null;
    customerName: string;
    deliveryAddress: string;
    addressComplement?: string | null;
    orderSource: DeliveryOrderSource;
    paymentMethod: string;
    deliveryFee: number;
    items: readonly DeliveryOrderItem[];
    actorUserId?: string | null;
    actorUserName?: string | null;
  },
  pool: NicheQueryExecutor = getPool()
): Promise<{ publicId: string; orderNumber: string } | null> {
  if (!input.customerId || !input.items || input.items.length === 0) {
    return null;
  }

  try {
    // Resolve produtos cadastrados no ERP > Produtos
    const resolvedLines: Array<{
      productId: number;
      productName: string;
      sku: string;
      quantity: number;
      unitPriceCents: number;
      lineTotalCents: number;
    }> = [];

    for (const item of input.items) {
      let prodRow: any = null;
      if (item.productPublicId) {
        const [pRows] = (await pool.execute(
          "SELECT id, public_id, name, sku, sale_price_cents FROM erp_products WHERE client_id = ? AND public_id = ? LIMIT 1",
          [input.clientId, item.productPublicId]
        )) as any[];
        prodRow = pRows?.[0] ?? null;
      }
      if (!prodRow && item.name) {
        const [pRows] = (await pool.execute(
          "SELECT id, public_id, name, sku, sale_price_cents FROM erp_products WHERE client_id = ? AND active = 1 AND LOWER(name) = LOWER(?) LIMIT 1",
          [input.clientId, item.name.trim()]
        )) as any[];
        prodRow = pRows?.[0] ?? null;
      }
      if (!prodRow) continue;

      const qty = Math.max(1, Number(item.quantity || 1));
      const unitCents =
        item.unitPrice > 0
          ? Math.round(item.unitPrice * 100)
          : Math.max(0, Number(prodRow.sale_price_cents ?? 0));
      const lineTotalCents = Math.round(qty * unitCents);

      const existingIdx = resolvedLines.findIndex((l) => l.productId === Number(prodRow.id));
      if (existingIdx >= 0) {
        resolvedLines[existingIdx].quantity += qty;
        resolvedLines[existingIdx].lineTotalCents += lineTotalCents;
      } else {
        resolvedLines.push({
          productId: Number(prodRow.id),
          productName: String(prodRow.name),
          sku: String(prodRow.sku || `MENU-${prodRow.id}`),
          quantity: qty,
          unitPriceCents: unitCents,
          lineTotalCents,
        });
      }
    }

    if (resolvedLines.length === 0) {
      return null;
    }

    // Sequência canônica de vendas (`V-<n>`)
    await pool
      .execute(
        `INSERT INTO erp_sale_document_sequences (client_id, document_type, next_number)
         SELECT ?, 'sale', COALESCE(MAX(CAST(SUBSTRING(order_number, 3) AS UNSIGNED)), 0) + 1
         FROM erp_sale_orders
         WHERE client_id = ? AND document_type = 'sale' AND order_number REGEXP '^V-[0-9]+$'
         ON DUPLICATE KEY UPDATE next_number = next_number`,
        [input.clientId, input.clientId]
      )
      .catch(() => {});

    const [seqRows] = (await pool.execute(
      "SELECT next_number FROM erp_sale_document_sequences WHERE client_id = ? AND document_type = 'sale' LIMIT 1",
      [input.clientId]
    )) as any[];
    const nextNum = Math.max(1, Number(seqRows?.[0]?.next_number || 1));
    await pool
      .execute(
        "UPDATE erp_sale_document_sequences SET next_number = ? WHERE client_id = ? AND document_type = 'sale'",
        [nextNum + 1, input.clientId]
      )
      .catch(() => {});

    const orderNumber = `V-${nextNum}`;
    const salePublicId = randomUUID();
    const subtotalCents = resolvedLines.reduce((acc, l) => acc + l.lineTotalCents, 0);
    const freightCents = Math.max(0, Math.round(Number(input.deliveryFee || 0) * 100));
    const totalCents = subtotalCents + freightCents;
    const todayIso = new Date().toISOString().slice(0, 10);
    const actorUserId = String(input.actorUserId || "delivery-auto").slice(0, 80);
    const actorUserName = String(input.actorUserName || ORDER_SOURCE_LABEL[input.orderSource]).slice(0, 180);
    const ticketRef = input.ticketNumber ? `#${String(input.ticketNumber).padStart(4, "0")}` : input.ticketId;
    const shippingSnapshot = JSON.stringify({
      recipientName: input.customerName.trim(),
      street: input.deliveryAddress.trim(),
      complement: input.addressComplement?.trim() || "",
      number: "",
      district: "",
      city: "",
      state: "",
      postalCode: "",
    });

    const [insertRes] = (await pool.execute(
      `INSERT INTO erp_sale_orders (
        public_id, client_id, order_number, document_type, commercial_status, commercial_date,
        crm_client_id, customer_name_snapshot, seller_user_id, seller_name_snapshot,
        status, current_stage, shipping_address_snapshot, billing_address_snapshot,
        discount_cents, freight_cents, charges_cents, payment_method_snapshot,
        notes, subtotal_cents, total_cents, confirmed_by, confirmed_at, created_by
      ) VALUES (?, ?, ?, 'sale', 'active', ?, ?, ?, ?, ?, 'confirmed', 'confirmed', ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        salePublicId,
        input.clientId,
        orderNumber,
        todayIso,
        input.customerId,
        input.customerName.trim().slice(0, 255),
        actorUserId,
        actorUserName,
        shippingSnapshot,
        shippingSnapshot,
        freightCents,
        input.paymentMethod.trim().slice(0, 80),
        `Pedido Delivery (${ORDER_SOURCE_LABEL[input.orderSource]}) — Ticket ${ticketRef}`,
        subtotalCents,
        totalCents,
        actorUserId,
        actorUserId,
      ]
    )) as any[];

    let saleOrderId = Number(insertRes?.insertId ?? 0);
    if (!saleOrderId) {
      const [idRows] = (await pool.execute(
        "SELECT id FROM erp_sale_orders WHERE client_id = ? AND public_id = ? LIMIT 1",
        [input.clientId, salePublicId]
      )) as any[];
      saleOrderId = Number(idRows?.[0]?.id ?? 0);
    }

    if (saleOrderId > 0) {
      for (const line of resolvedLines) {
        await pool.execute(
          `INSERT INTO erp_sale_order_items (
            public_id, sale_order_id, product_id, inventory_item_id,
            product_name_snapshot, sku_snapshot, quantity, unit_price_cents,
            discount_cents, line_total_cents
          ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 0, ?)`,
          [
            randomUUID(),
            saleOrderId,
            line.productId,
            line.productName.slice(0, 180),
            line.sku.slice(0, 80),
            line.quantity.toFixed(3),
            line.unitPriceCents,
            line.lineTotalCents,
          ]
        );
      }
    }

    await pool
      .execute(
        "UPDATE megadesk_delivery_orders SET erp_sale_public_id = ? WHERE client_id = ? AND ticket_id = ?",
        [salePublicId, input.clientId, input.ticketId]
      )
      .catch(() => {});

    try {
      emitOperationalTenantEvent(input.clientId, "erp:sale.changed", {
        publicId: salePublicId,
        operation: "created",
        occurredAt: new Date().toISOString(),
      });
    } catch {}

    return { publicId: salePublicId, orderNumber };
  } catch (err) {
    console.warn("[DeliveryService] Falha ao sincronizar pedido com ERP > Vendas:", err);
    return null;
  }
}

/**
 * Atualiza o status da venda vinculada em `ERP > Vendas` quando o delivery é concluído ou cancelado.
 */
export async function updateErpSaleStatusForDelivery(
  input: {
    clientId: string;
    erpSalePublicId: string | null | undefined;
    targetStatus: "completed" | "cancelled";
    actorUserId?: string | null;
  },
  pool: NicheQueryExecutor = getPool()
): Promise<void> {
  if (!input.erpSalePublicId) return;
  const actorId = String(input.actorUserId || "delivery-auto").slice(0, 80);
  try {
    if (input.targetStatus === "completed") {
      await pool.execute(
        `UPDATE erp_sale_orders
         SET status = 'fulfilled',
             commercial_status = 'completed',
             current_stage = 'completed',
             fulfilled_by = ?,
             fulfilled_at = COALESCE(fulfilled_at, NOW())
         WHERE client_id = ? AND public_id = ? AND status <> 'cancelled'`,
        [actorId, input.clientId, input.erpSalePublicId]
      );
    } else {
      await pool.execute(
        `UPDATE erp_sale_orders
         SET status = 'cancelled',
             commercial_status = 'cancelled',
             cancelled_by = ?,
             cancelled_at = COALESCE(cancelled_at, NOW()),
             cancellation_reason = 'Pedido de delivery cancelado'
         WHERE client_id = ? AND public_id = ?`,
        [actorId, input.clientId, input.erpSalePublicId]
      );
    }

    try {
      emitOperationalTenantEvent(input.clientId, "erp:sale.changed", {
        publicId: input.erpSalePublicId,
        operation: input.targetStatus === "completed" ? "stage_changed" : "cancelled",
        occurredAt: new Date().toISOString(),
      });
    } catch {}
  } catch (err) {
    console.warn("[DeliveryService] Falha ao atualizar venda no ERP > Vendas:", err);
  }
}

export async function createDeliveryOrderForTicket(
  input: {
    clientId: string;
    ticketId: string;
    ticketNumber?: number | null;
    customerId?: string | null;
    orderSource?: DeliveryOrderSource;
    items?: Array<{
      productPublicId?: string | null;
      name: string;
      quantity: number;
      unitPrice: number;
    }>;
    itemsSummary?: string;
    orderTotal?: number;
    deliveryFee?: number;
    paymentMethod?: string;
    customerName: string;
    customerPhone: string;
    deliveryAddress: string;
    addressType?: DeliveryAddressType;
    addressComplement?: string | null;
    destinationLat?: number | null;
    destinationLng?: number | null;
    motoboyUserId?: string | null;
    routeSequence?: number;
    actorUserId?: string | null;
    actorUserName?: string | null;
  },
  deps: DeliveryDependencies = {}
): Promise<DeliveryOrderRecord> {
  const pool = deps.pool ?? getPool();
  await assertTenantNiche(input.clientId, ["restaurante"], pool);
  await ensureDeliveryOrdersTable(pool);

  const normalizedItems = normalizeDeliveryItems(input.items);
  const formattedSummary = formatDeliveryItemsSummary(normalizedItems);
  const finalItemsSummary = (input.itemsSummary ?? "").trim() || formattedSummary;
  const itemsSubtotal = normalizedItems.reduce((acc, it) => acc + it.subtotal, 0);
  const deliveryFee = Math.max(0, Number(input.deliveryFee ?? 0));
  const computedOrderTotal =
    input.orderTotal !== undefined && Number(input.orderTotal) > 0
      ? Number(input.orderTotal)
      : Number((itemsSubtotal + deliveryFee).toFixed(2));

  const id = `dlv-${randomUUID()}`;
  const deliveryCode = generateDeliveryCode();
  const trackingToken = generateTrackingToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const orderSource: DeliveryOrderSource = input.orderSource ?? "manual";
  const deliveryStatus: DeliveryOrderStatus = input.motoboyUserId ? "assigned" : "pending";
  const stageLabel: RestaurantStageLabel = input.motoboyUserId ? "Pronto p/ Motoboy" : "Novo Pedido";

  await pool.execute(
    `INSERT INTO megadesk_delivery_orders (
      id, client_id, ticket_id, order_source, items_json, items_summary, order_total, delivery_fee,
      payment_method, customer_name, customer_phone, delivery_address, address_type,
      address_complement, destination_lat, destination_lng, motoboy_user_id, route_sequence,
      delivery_code, tracking_token, tracking_expires_at, delivery_status, stage_label
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.clientId,
      input.ticketId,
      orderSource,
      normalizedItems.length > 0 ? JSON.stringify(normalizedItems) : null,
      finalItemsSummary,
      computedOrderTotal,
      deliveryFee,
      (input.paymentMethod ?? "A combinar").trim(),
      input.customerName.trim(),
      input.customerPhone.trim(),
      input.deliveryAddress.trim(),
      input.addressType ?? "casa",
      input.addressComplement?.trim() || null,
      input.destinationLat ?? null,
      input.destinationLng ?? null,
      input.motoboyUserId ?? null,
      Math.max(1, Number(input.routeSequence ?? 1)),
      deliveryCode,
      trackingToken,
      expiresAt,
      deliveryStatus,
      stageLabel,
    ]
  );

  // Resolve customerId do ticket caso não tenha sido passado diretamente
  let resolvedCustomerId = input.customerId ?? null;
  let resolvedTicketNumber = input.ticketNumber ?? null;
  if (!resolvedCustomerId || resolvedTicketNumber == null) {
    try {
      const [tRows] = (await pool.execute(
        "SELECT customerId, chamadoNumber FROM megadesk_domain_chamados WHERE clientId = ? AND chamadoId = ? LIMIT 1",
        [input.clientId, input.ticketId]
      )) as any[];
      if (tRows?.[0]) {
        if (!resolvedCustomerId && tRows[0].customerId) resolvedCustomerId = String(tRows[0].customerId);
        if (resolvedTicketNumber == null && tRows[0].chamadoNumber != null) {
          resolvedTicketNumber = Number(tRows[0].chamadoNumber);
        }
      }
    } catch {}
  }

  // Sincronização 100% automática com ERP > Vendas quando há itens do catálogo
  const syncedSale = await syncDeliveryOrderToErpSale(
    {
      clientId: input.clientId,
      ticketId: input.ticketId,
      ticketNumber: resolvedTicketNumber,
      customerId: resolvedCustomerId,
      customerName: input.customerName,
      deliveryAddress: input.deliveryAddress,
      addressComplement: input.addressComplement,
      orderSource,
      paymentMethod: input.paymentMethod ?? "A combinar",
      deliveryFee,
      items: normalizedItems,
      actorUserId: input.actorUserId,
      actorUserName: input.actorUserName,
    },
    pool
  );

  // Registro automático no Histórico do Ticket
  const totalFormatted = `R$ ${computedOrderTotal.toFixed(2).replace(".", ",")}`;
  const saleNote = syncedSale ? ` • Venda ${syncedSale.orderNumber} criada em ERP > Vendas.` : "";
  await recordDeliveryTicketActivity(pool, {
    clientId: input.clientId,
    ticketId: input.ticketId,
    actorUserId: input.actorUserId || "system",
    actorUserName: input.actorUserName || ORDER_SOURCE_LABEL[orderSource],
    actionType: "ticket_created",
    description: `Pedido de delivery criado (origem: ${ORDER_SOURCE_LABEL[orderSource]}) • Status: ${stageLabel} • Total: ${totalFormatted}${finalItemsSummary ? ` • Itens: ${finalItemsSummary}` : ""}.${saleNote}`,
    metadata: {
      eventType: "delivery_order_created",
      orderSource,
      stageLabel,
      orderTotal: computedOrderTotal,
      erpSalePublicId: syncedSale?.publicId ?? null,
    },
  });

  const [rows] = (await pool.execute(
    "SELECT * FROM megadesk_delivery_orders WHERE id = ? AND client_id = ? LIMIT 1",
    [id, input.clientId]
  )) as any[];

  return mapRowToDeliveryOrder(rows[0]);
}

export async function createRestaurantOrderWithTicket(
  input: {
    clientId: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    company?: string;
    title?: string;
    observations?: string;
    priority?: "baixa" | "media" | "alta" | "critica";
    actor: CanonicalTicketActor;
    orderSource: DeliveryOrderSource;
    items?: Array<{
      productPublicId?: string | null;
      name: string;
      quantity: number;
      unitPrice: number;
    }>;
    itemsSummary?: string;
    orderTotal?: number;
    deliveryFee: number;
    paymentMethod: string;
    deliveryAddress: string;
    addressType?: DeliveryAddressType;
    addressComplement?: string | null;
    destinationLat?: number | null;
    destinationLng?: number | null;
  },
  deps: DeliveryDependencies = {}
): Promise<{
  ticket: { id: string; number: number };
  deliveryOrder: DeliveryOrderRecord;
}> {
  const pool = deps.pool ?? getPool();
  await assertTenantNiche(input.clientId, ["restaurante"], pool);
  await ensureDeliveryOrdersTable(pool);
  await ensureRestaurantTicketStatuses(input.clientId, pool).catch(() => {});

  const normalizedItems = normalizeDeliveryItems(input.items);
  const summary = (input.itemsSummary ?? "").trim() || formatDeliveryItemsSummary(normalizedItems);
  const createTicketFn = deps.createTicket ?? createChamadoWithActivity;
  const ticketTitle =
    input.title?.trim() ||
    `Pedido Delivery — ${input.customerName.trim()} (${ORDER_SOURCE_LABEL[input.orderSource]})`;
  const obsParts = [
    input.observations?.trim(),
    summary ? `Itens: ${summary}` : "",
    `Endereço: ${input.deliveryAddress.trim()}${input.addressComplement ? ` (${input.addressComplement.trim()})` : ""}`,
    `Pagamento: ${input.paymentMethod.trim()}`,
  ].filter(Boolean);

  const ticket = await createTicketFn(
    {
      clientId: input.clientId,
      customerId: input.customerId,
      customerName: input.customerName.trim(),
      company: input.company?.trim() || input.customerName.trim(),
      title: ticketTitle,
      observations: obsParts.join("\n"),
      priority: input.priority ?? "media",
      customerPhone: input.customerPhone.trim(),
      actor: input.actor,
    },
    pool as mysql.Pool
  );

  const deliveryOrder = await createDeliveryOrderForTicket(
    {
      clientId: input.clientId,
      ticketId: ticket.id,
      ticketNumber: ticket.number,
      customerId: input.customerId,
      orderSource: input.orderSource,
      items: normalizedItems,
      itemsSummary: summary,
      orderTotal: input.orderTotal,
      deliveryFee: input.deliveryFee,
      paymentMethod: input.paymentMethod,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      deliveryAddress: input.deliveryAddress,
      addressType: input.addressType,
      addressComplement: input.addressComplement,
      destinationLat: input.destinationLat,
      destinationLng: input.destinationLng,
      actorUserId: input.actor.userId,
      actorUserName: input.actor.userName,
    },
    { pool }
  );

  return { ticket, deliveryOrder };
}

export async function getDeliveryOrderByTicket(
  clientId: string,
  ticketId: string,
  pool: NicheQueryExecutor = getPool()
): Promise<DeliveryOrderRecord | null> {
  await assertTenantNiche(clientId, ["restaurante"], pool);
  await ensureDeliveryOrdersTable(pool);
  const [rows] = (await pool.execute(
    "SELECT * FROM megadesk_delivery_orders WHERE client_id = ? AND ticket_id = ? LIMIT 1",
    [clientId, ticketId]
  )) as any[];
  if (!rows?.[0]) return null;
  return mapRowToDeliveryOrder(rows[0]);
}

export async function assignMotoboyToOrder(
  input: {
    clientId: string;
    ticketId: string;
    motoboyUserId: string | null;
    routeSequence?: number;
    deliveryFee?: number;
    actorUserId?: string | null;
    actorUserName?: string | null;
  },
  pool: NicheQueryExecutor = getPool()
): Promise<DeliveryOrderRecord> {
  await assertTenantNiche(input.clientId, ["restaurante"], pool);
  await ensureDeliveryOrdersTable(pool);

  const existing = await getDeliveryOrderByTicket(input.clientId, input.ticketId, pool);
  if (!existing) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Pedido de delivery não encontrado para este ticket." });
  }

  const nextStatus: DeliveryOrderStatus =
    existing.deliveryStatus === "in_route" || existing.deliveryStatus === "delivered"
      ? existing.deliveryStatus
      : input.motoboyUserId
        ? "assigned"
        : "pending";
  const nextStage =
    existing.deliveryStatus === "in_route" || existing.deliveryStatus === "delivered"
      ? existing.stageLabel
      : input.motoboyUserId
        ? "Pronto p/ Motoboy"
        : "Novo Pedido";

  const nextSeq = Math.max(1, Number(input.routeSequence ?? existing.routeSequence));
  const nextFee = input.deliveryFee !== undefined ? Number(input.deliveryFee) : existing.deliveryFee;

  await pool.execute(
    `UPDATE megadesk_delivery_orders
     SET motoboy_user_id = ?,
         route_sequence = ?,
         delivery_fee = ?,
         delivery_status = ?,
         stage_label = ?
     WHERE client_id = ? AND ticket_id = ?`,
    [
      input.motoboyUserId,
      nextSeq,
      nextFee,
      nextStatus,
      nextStage,
      input.clientId,
      input.ticketId,
    ]
  );

  if (nextStatus === "assigned") {
    await pool.execute(
      "UPDATE megadesk_domain_chamados SET status = 'waiting', updatedAt = NOW() WHERE clientId = ? AND chamadoId = ?",
      [input.clientId, input.ticketId]
    ).catch(() => {});
  }

  let motoboyName: string | null = null;
  if (input.motoboyUserId) {
    try {
      const [uRows] = (await pool.execute(
        "SELECT name FROM megadesk_domain_client_users WHERE client_id = ? AND user_id = ? LIMIT 1",
        [input.clientId, input.motoboyUserId]
      )) as any[];
      motoboyName = uRows?.[0]?.name ? String(uRows[0].name) : null;
    } catch {}
  }

  const feeStr = `R$ ${nextFee.toFixed(2).replace(".", ",")}`;
  await recordDeliveryTicketActivity(pool, {
    clientId: input.clientId,
    ticketId: input.ticketId,
    actorUserId: input.actorUserId || "system",
    actorUserName: input.actorUserName || "Operador",
    actionType: "status_changed",
    description: input.motoboyUserId
      ? `Motoboy ${motoboyName || input.motoboyUserId} atribuído à entrega (Fila #${nextSeq}, taxa ${feeStr}) • Status atualizado para ${nextStage}.`
      : `Atribuição de motoboy removida • Status atualizado para ${nextStage}.`,
    metadata: {
      eventType: "delivery_motoboy_assigned",
      motoboyUserId: input.motoboyUserId,
      motoboyName,
      routeSequence: nextSeq,
      deliveryFee: nextFee,
      stageLabel: nextStage,
    },
  });

  const updated = await getDeliveryOrderByTicket(input.clientId, input.ticketId, pool);
  return updated!;
}

/**
 * Motoboy aceita a corrida na fila mobile -> atualiza status automaticamente para `Pronto p/ Motoboy`
 * e grava evento no Histórico do Ticket.
 */
export async function acceptDeliveryOrder(
  input: {
    clientId: string;
    ticketId: string;
    motoboyUserId: string;
    actorUserName?: string | null;
    isAdmin?: boolean;
  },
  pool: NicheQueryExecutor = getPool()
): Promise<DeliveryOrderRecord> {
  await assertTenantNiche(input.clientId, ["restaurante"], pool);
  await ensureDeliveryOrdersTable(pool);

  const existing = await getDeliveryOrderByTicket(input.clientId, input.ticketId, pool);
  if (!existing) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Pedido de delivery não encontrado para este ticket." });
  }
  if (existing.deliveryStatus === "delivered" || existing.deliveryStatus === "canceled") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido já foi finalizado ou cancelado." });
  }
  if (!input.isAdmin && existing.motoboyUserId && existing.motoboyUserId !== input.motoboyUserId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Esta corrida já está atribuída a outro motoboy.",
    });
  }

  const nextStatus: DeliveryOrderStatus =
    existing.deliveryStatus === "in_route" ? "in_route" : "assigned";
  const nextStage =
    existing.deliveryStatus === "in_route" ? "Em Rota com Motoboy" : "Pronto p/ Motoboy";

  await pool.execute(
    `UPDATE megadesk_delivery_orders
     SET motoboy_user_id = ?,
         delivery_status = ?,
         stage_label = ?,
         accepted_at = COALESCE(accepted_at, NOW())
     WHERE client_id = ? AND ticket_id = ?`,
    [input.motoboyUserId, nextStatus, nextStage, input.clientId, input.ticketId]
  );

  if (nextStatus === "assigned") {
    await pool.execute(
      "UPDATE megadesk_domain_chamados SET status = 'waiting', updatedAt = NOW() WHERE clientId = ? AND chamadoId = ?",
      [input.clientId, input.ticketId]
    ).catch(() => {});
  }

  const motoboyLabel = input.actorUserName || "Motoboy";
  await recordDeliveryTicketActivity(pool, {
    clientId: input.clientId,
    ticketId: input.ticketId,
    actorUserId: input.motoboyUserId,
    actorUserName: motoboyLabel,
    actionType: "status_changed",
    description: `${motoboyLabel} aceitou a corrida de entrega • Status atualizado automaticamente para ${nextStage}.`,
    metadata: {
      eventType: "delivery_accepted",
      motoboyUserId: input.motoboyUserId,
      stageLabel: nextStage,
    },
  });

  const updated = await getDeliveryOrderByTicket(input.clientId, input.ticketId, pool);
  return updated!;
}

export async function updateDeliveryStage(
  input: {
    clientId: string;
    ticketId: string;
    stageLabel: RestaurantStageLabel;
    actorUserId?: string | null;
    actorUserName?: string | null;
  },
  pool: NicheQueryExecutor = getPool()
): Promise<DeliveryOrderRecord> {
  await assertTenantNiche(input.clientId, ["restaurante"], pool);
  await ensureDeliveryOrdersTable(pool);

  const existing = await getDeliveryOrderByTicket(input.clientId, input.ticketId, pool);
  if (!existing) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Pedido de delivery não encontrado para este ticket." });
  }

  let deliveryStatus: DeliveryOrderStatus = existing.deliveryStatus;
  let ticketStatus: "open" | "in_progress" | "waiting" | "closed" = "open";

  switch (input.stageLabel) {
    case "Novo Pedido":
      deliveryStatus = "pending";
      ticketStatus = "open";
      break;
    case "Em Preparo":
      deliveryStatus = "pending";
      ticketStatus = "in_progress";
      break;
    case "Pronto p/ Motoboy":
      deliveryStatus = existing.motoboyUserId ? "assigned" : "pending";
      ticketStatus = "waiting";
      break;
    case "Em Rota com Motoboy":
      deliveryStatus = "in_route";
      ticketStatus = "in_progress";
      break;
    case "Entregue":
      deliveryStatus = "delivered";
      ticketStatus = "closed";
      break;
  }

  await pool.execute(
    `UPDATE megadesk_delivery_orders
     SET delivery_status = ?,
         stage_label = ?,
         delivered_at = CASE WHEN ? = 'delivered' THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END
     WHERE client_id = ? AND ticket_id = ?`,
    [deliveryStatus, input.stageLabel, deliveryStatus, input.clientId, input.ticketId]
  );

  await pool.execute(
    "UPDATE megadesk_domain_chamados SET status = ?, updatedAt = NOW() WHERE clientId = ? AND chamadoId = ?",
    [ticketStatus, input.clientId, input.ticketId]
  ).catch(() => {});

  if (deliveryStatus === "delivered") {
    await updateErpSaleStatusForDelivery(
      {
        clientId: input.clientId,
        erpSalePublicId: existing.erpSalePublicId,
        targetStatus: "completed",
        actorUserId: input.actorUserId,
      },
      pool
    );
  }

  await recordDeliveryTicketActivity(pool, {
    clientId: input.clientId,
    ticketId: input.ticketId,
    actorUserId: input.actorUserId || "system",
    actorUserName: input.actorUserName || "Operador",
    actionType: "status_changed",
    description: `Etapa do delivery alterada de "${existing.stageLabel}" para "${input.stageLabel}".`,
    metadata: {
      eventType: "delivery_stage_changed",
      fromStage: existing.stageLabel,
      toStage: input.stageLabel,
      toTicketStatus: ticketStatus,
    },
  });

  const updated = await getDeliveryOrderByTicket(input.clientId, input.ticketId, pool);
  return updated!;
}

export async function startDeliveryRoute(
  input: {
    clientId: string;
    ticketId: string;
    actorUserId?: string;
    actorUserName?: string;
    isAdmin?: boolean;
  },
  deps: DeliveryDependencies = {}
): Promise<{
  ok: true;
  deliveryOrder: DeliveryOrderRecord;
  trackingUrl: string;
  whatsappSent: boolean;
  whatsappMessage: string;
  whatsappError?: string;
}> {
  const pool = deps.pool ?? getPool();
  await assertTenantNiche(input.clientId, ["restaurante"], pool);
  await ensureDeliveryOrdersTable(pool);

  const order = await getDeliveryOrderByTicket(input.clientId, input.ticketId, pool);
  if (!order) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Pedido de delivery não encontrado para este ticket.",
    });
  }

  if (
    input.isAdmin === false &&
    order.motoboyUserId &&
    input.actorUserId &&
    order.motoboyUserId !== input.actorUserId
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Esta entrega está atribuída a outro motoboy.",
    });
  }

  if (order.deliveryStatus === "delivered" || order.deliveryStatus === "canceled") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Não é possível iniciar rota para um pedido já entregue ou cancelado.",
    });
  }

  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000);
  await pool.execute(
    `UPDATE megadesk_delivery_orders
     SET delivery_status = 'in_route',
         stage_label = 'Em Rota com Motoboy',
         started_at = COALESCE(started_at, NOW()),
         tracking_expires_at = ?
     WHERE client_id = ? AND ticket_id = ?`,
    [expiresAt, input.clientId, input.ticketId]
  );

  await pool.execute(
    `UPDATE megadesk_domain_chamados
     SET status = 'in_progress', updatedAt = NOW()
     WHERE clientId = ? AND chamadoId = ?`,
    [input.clientId, input.ticketId]
  );

  const updated = (await getDeliveryOrderByTicket(input.clientId, input.ticketId, pool))!;
  const trackingUrl = updated.trackingUrl;
  const whatsappMessage = buildStartRouteWhatsAppMessage(trackingUrl, updated.deliveryCode);

  const sendFn =
    deps.sendWhatsApp ??
    (async ({ clientId, phone, message }) => {
      const digits = phone.replace(/\D/g, "");
      if (!digits) throw new Error("Telefone do cliente não informado para disparo WhatsApp.");
      return evoSendText(instanceNameFor(clientId), digits, message);
    });

  let whatsappSent = false;
  let whatsappError: string | undefined;
  try {
    await sendFn({
      clientId: input.clientId,
      phone: updated.customerPhone,
      message: whatsappMessage,
    });
    whatsappSent = true;
  } catch (err: any) {
    whatsappError = err?.message || "Falha ao enviar notificação via WhatsApp.";
    console.warn("[DeliveryService] Falha no disparo WhatsApp de início de rota:", whatsappError);
  }

  const actorLabel = input.actorUserName || "Motoboy";
  await recordDeliveryTicketActivity(pool, {
    clientId: input.clientId,
    ticketId: input.ticketId,
    actorUserId: input.actorUserId || order.motoboyUserId || "system",
    actorUserName: actorLabel,
    actionType: "status_changed",
    description: whatsappSent
      ? `${actorLabel} iniciou a rota (Em Rota com Motoboy) • Link de rastreio e código de 4 dígitos enviados com sucesso no WhatsApp do cliente.`
      : `${actorLabel} iniciou a rota (Em Rota com Motoboy) • Aviso: disparo no WhatsApp não concluído (${whatsappError || "instância desconectada"}).`,
    metadata: {
      eventType: "delivery_route_started",
      stageLabel: "Em Rota com Motoboy",
      whatsappSent,
    },
  });

  return {
    ok: true,
    deliveryOrder: updated,
    trackingUrl,
    whatsappSent,
    whatsappMessage,
    ...(whatsappError ? { whatsappError } : {}),
  };
}

/**
 * Fila ativa do motoboy logado (`assigned` e `in_route`), estritamente isolada por
 * tenant (`restaurante`) e por `motoboy_user_id`.
 */
export async function getMotoboyQueue(
  input: { clientId: string; motoboyUserId: string },
  pool: NicheQueryExecutor = getPool()
): Promise<DeliveryOrderRecord[]> {
  await assertTenantNiche(input.clientId, ["restaurante"], pool);
  await ensureDeliveryOrdersTable(pool);

  const [rows] = (await pool.execute(
    `SELECT d.*, c.chamadoNumber AS ticket_number
     FROM megadesk_delivery_orders d
     LEFT JOIN megadesk_domain_chamados c
       ON c.chamadoId = d.ticket_id AND c.clientId = d.client_id
     WHERE d.client_id = ?
       AND d.motoboy_user_id = ?
       AND d.delivery_status IN ('assigned', 'in_route')
     ORDER BY CASE WHEN d.delivery_status = 'in_route' THEN 0 ELSE 1 END ASC,
              d.route_sequence ASC,
              d.created_at ASC`,
    [input.clientId, input.motoboyUserId]
  )) as any[];

  return (rows || []).map(mapRowToDeliveryOrder);
}

export function resolveMotoboyHistoryRange(
  period: MotoboyHistoryPeriod,
  startDate?: string,
  endDate?: string,
  now: Date = new Date()
): { start: Date; end: Date } {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (period === "custom" && startDate) {
    const parsedStart = new Date(`${startDate}T00:00:00.000`);
    const parsedEnd = endDate ? new Date(`${endDate}T23:59:59.999`) : new Date(end);
    if (!Number.isNaN(parsedStart.getTime()) && !Number.isNaN(parsedEnd.getTime())) {
      return { start: parsedStart, end: parsedEnd };
    }
  }

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (period === "week") {
    const day = start.getDay(); // 0=Sun..6=Sat
    const diff = day === 0 ? 6 : day - 1; // Monday as start of week
    start.setDate(start.getDate() - diff);
  } else if (period === "month") {
    start.setDate(1);
  }

  return { start, end };
}

/**
 * Extrato de entregas concluídas e soma das taxas (`delivery_fee`) do motoboy logado.
 */
export async function getMotoboyHistory(
  input: {
    clientId: string;
    motoboyUserId: string;
    period: MotoboyHistoryPeriod;
    startDate?: string;
    endDate?: string;
  },
  pool: NicheQueryExecutor = getPool()
): Promise<{
  items: DeliveryOrderRecord[];
  summary: { totalDeliveries: number; totalEarnings: number };
  period: MotoboyHistoryPeriod;
  rangeStart: string;
  rangeEnd: string;
}> {
  await assertTenantNiche(input.clientId, ["restaurante"], pool);
  await ensureDeliveryOrdersTable(pool);

  const { start, end } = resolveMotoboyHistoryRange(input.period, input.startDate, input.endDate);

  const [rows] = (await pool.execute(
    `SELECT d.*, c.chamadoNumber AS ticket_number
     FROM megadesk_delivery_orders d
     LEFT JOIN megadesk_domain_chamados c
       ON c.chamadoId = d.ticket_id AND c.clientId = d.client_id
     WHERE d.client_id = ?
       AND d.motoboy_user_id = ?
       AND d.delivery_status = 'delivered'
       AND COALESCE(d.delivered_at, d.created_at) >= ?
       AND COALESCE(d.delivered_at, d.created_at) <= ?
     ORDER BY COALESCE(d.delivered_at, d.created_at) DESC`,
    [input.clientId, input.motoboyUserId, start, end]
  )) as any[];

  const items = (rows || []).map(mapRowToDeliveryOrder);
  const totalEarnings = Number(
    items.reduce((acc: number, item: DeliveryOrderRecord) => acc + Number(item.deliveryFee || 0), 0).toFixed(2)
  );

  return {
    items,
    summary: {
      totalDeliveries: items.length,
      totalEarnings,
    },
    period: input.period,
    rangeStart: start.toISOString(),
    rangeEnd: end.toISOString(),
  };
}

/**
 * Persiste telemetria GPS ao vivo do motoboy autenticado em `megadesk_motoboy_locations`
 * e reflete a última posição nos pedidos `in_route` atribuídos a ele.
 */
export async function updateMotoboyLocation(
  input: {
    clientId: string;
    motoboyUserId: string;
    lat: number;
    lng: number;
    speed?: number | null;
    heading?: number | null;
    activeOrderId?: string | null;
  },
  pool: NicheQueryExecutor = getPool()
): Promise<{ ok: true; motoboyUserId: string; lat: number; lng: number; updatedAt: string }> {
  await assertTenantNiche(input.clientId, ["restaurante"], pool);
  await ensureDeliveryOrdersTable(pool);

  const nowIso = new Date().toISOString();
  const locId = `loc-${randomUUID()}`;

  await pool.execute(
    `INSERT INTO megadesk_motoboy_locations (
      id, client_id, motoboy_user_id, active_order_id, lat, lng, speed, heading
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      active_order_id = VALUES(active_order_id),
      lat = VALUES(lat),
      lng = VALUES(lng),
      speed = VALUES(speed),
      heading = VALUES(heading),
      updated_at = CURRENT_TIMESTAMP`,
    [
      locId,
      input.clientId,
      input.motoboyUserId,
      input.activeOrderId ?? null,
      input.lat,
      input.lng,
      input.speed ?? null,
      input.heading ?? null,
    ]
  );

  await pool.execute(
    `UPDATE megadesk_delivery_orders
     SET current_lat = ?,
         current_lng = ?,
         location_updated_at = NOW()
     WHERE client_id = ?
       AND motoboy_user_id = ?
       AND delivery_status = 'in_route'`,
    [input.lat, input.lng, input.clientId, input.motoboyUserId]
  );

  return {
    ok: true,
    motoboyUserId: input.motoboyUserId,
    lat: input.lat,
    lng: input.lng,
    updatedAt: nowIso,
  };
}

/**
 * Conclui a entrega validando o código de 4 dígitos informado pelo cliente.
 * - Código incorreto → BAD_REQUEST.
 * - Código correto → `delivery_status = 'delivered'`, ticket fechado (`Entregue`),
 *   `tracking_expires_at = NOW() + 30 min`, e taxa contabilizada nos ganhos.
 */
export async function completeDeliveryOrder(
  input: {
    clientId: string;
    ticketId: string;
    deliveryCode: string;
    motoboyUserId: string;
    isAdmin?: boolean;
    actorUserName?: string;
  },
  pool: NicheQueryExecutor = getPool()
): Promise<{
  ok: true;
  deliveryOrder: DeliveryOrderRecord;
  deliveryFeeEarned: number;
}> {
  await assertTenantNiche(input.clientId, ["restaurante"], pool);
  await ensureDeliveryOrdersTable(pool);

  const order = await getDeliveryOrderByTicket(input.clientId, input.ticketId, pool);
  if (!order) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Pedido de delivery não encontrado para este ticket.",
    });
  }

  if (!input.isAdmin && order.motoboyUserId && order.motoboyUserId !== input.motoboyUserId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Você não pode finalizar uma entrega atribuída a outro motoboy.",
    });
  }

  if (order.deliveryStatus === "delivered" || order.deliveryStatus === "canceled") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Esta entrega já foi finalizada ou cancelada.",
    });
  }

  const submittedCode = String(input.deliveryCode || "").replace(/\D/g, "");
  if (submittedCode.length !== 4 || submittedCode !== order.deliveryCode) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Código de confirmação incorreto. Confira os 4 dígitos com o cliente.",
    });
  }

  const expiresIn30Min = new Date(Date.now() + 30 * 60 * 1000);
  await pool.execute(
    `UPDATE megadesk_delivery_orders
     SET delivery_status = 'delivered',
         stage_label = 'Entregue',
         delivered_at = NOW(),
         tracking_expires_at = ?
     WHERE client_id = ? AND ticket_id = ?`,
    [expiresIn30Min, input.clientId, input.ticketId]
  );

  await pool.execute(
    `UPDATE megadesk_domain_chamados
     SET status = 'closed', updatedAt = NOW()
     WHERE clientId = ? AND chamadoId = ?`,
    [input.clientId, input.ticketId]
  );

  await updateErpSaleStatusForDelivery(
    {
      clientId: input.clientId,
      erpSalePublicId: order.erpSalePublicId,
      targetStatus: "completed",
      actorUserId: input.motoboyUserId,
    },
    pool
  );

  const actorLabel = input.actorUserName || "Motoboy";
  await recordDeliveryTicketActivity(pool, {
    clientId: input.clientId,
    ticketId: input.ticketId,
    actorUserId: input.motoboyUserId,
    actorUserName: actorLabel,
    actionType: "status_changed",
    description: `${actorLabel} finalizou a entrega (Entregue) com código de 4 dígitos validado • Ticket encerrado${order.erpSalePublicId ? " e venda concluída no ERP > Vendas" : ""}.`,
    metadata: {
      eventType: "delivery_completed",
      stageLabel: "Entregue",
      erpSalePublicId: order.erpSalePublicId,
    },
  });

  await pool.execute(
    `UPDATE megadesk_motoboy_locations
     SET active_order_id = NULL
     WHERE client_id = ? AND motoboy_user_id = ? AND active_order_id = ?`,
    [input.clientId, input.motoboyUserId, order.id]
  ).catch(() => {});

  const updated = (await getDeliveryOrderByTicket(input.clientId, input.ticketId, pool))!;
  return {
    ok: true,
    deliveryOrder: updated,
    deliveryFeeEarned: updated.deliveryFee,
  };
}

export async function listTenantMotoboys(
  clientId: string,
  pool: NicheQueryExecutor = getPool()
): Promise<{
  motoboys: Array<{ userId: string; name: string; email: string; role: string }>;
  allUsers: Array<{ userId: string; name: string; email: string; role: string; isMotoboy: boolean }>;
}> {
  await assertTenantNiche(clientId, ["restaurante"], pool);
  const [rows] = (await pool.execute(
    "SELECT user_id, name, email, role, permissions_json FROM megadesk_domain_client_users WHERE client_id = ? AND status = 'active' ORDER BY name ASC",
    [clientId]
  )) as any[];

  const allUsers = (rows || []).map((r: any) => {
    let perms: string[] = [];
    try {
      const parsed = JSON.parse(r.permissions_json || "[]");
      if (Array.isArray(parsed)) perms = parsed.map(String);
    } catch {}
    const isMotoboy =
      String(r.role || "").toLowerCase() === "motoboy" ||
      perms.some((p) => p.toLowerCase() === "motoboy");
    return {
      userId: String(r.user_id),
      name: String(r.name),
      email: String(r.email),
      role: String(r.role),
      isMotoboy,
    };
  });

  return {
    motoboys: allUsers.filter((u: any) => u.isMotoboy),
    allUsers,
  };
}

export async function toggleUserMotoboyTag(
  input: { clientId: string; userId: string; enabled: boolean },
  pool: NicheQueryExecutor = getPool()
): Promise<{ ok: true; userId: string; isMotoboy: boolean }> {
  await assertTenantNiche(input.clientId, ["restaurante"], pool);
  const [rows] = (await pool.execute(
    "SELECT permissions_json FROM megadesk_domain_client_users WHERE client_id = ? AND user_id = ? LIMIT 1",
    [input.clientId, input.userId]
  )) as any[];
  if (!rows?.[0]) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Usuário da equipe não encontrado." });
  }
  let perms: string[] = [];
  try {
    const parsed = JSON.parse(rows[0].permissions_json || "[]");
    if (Array.isArray(parsed)) perms = parsed.map(String);
  } catch {}

  const withoutTag = perms.filter((p) => p.toLowerCase() !== "motoboy");
  const nextPerms = input.enabled ? [...withoutTag, "motoboy"] : withoutTag;

  await pool.execute(
    "UPDATE megadesk_domain_client_users SET permissions_json = ? WHERE client_id = ? AND user_id = ?",
    [JSON.stringify(nextPerms), input.clientId, input.userId]
  );

  return { ok: true, userId: input.userId, isMotoboy: input.enabled };
}

export interface LiveMotoboySnapshot {
  userId: string;
  name: string;
  email: string;
  status: "in_route" | "available";
  isOnline: boolean;
  location: {
    lat: number;
    lng: number;
    speed: number | null;
    heading: number | null;
    updatedAt: string;
  } | null;
  activeOrder: DeliveryOrderRecord | null;
  queuedCount: number;
}

export interface LiveOrderSnapshot extends DeliveryOrderRecord {
  motoboyName: string | null;
}

/**
 * Visão consolidada ao vivo para o Painel Master do Restaurante:
 * motoboys + GPS em tempo real, entregas ativas e fila pendente sem atribuição.
 */
export async function getDeliveryLiveOverview(
  clientId: string,
  pool: NicheQueryExecutor = getPool(),
  nowMs: number = Date.now()
): Promise<{
  motoboys: LiveMotoboySnapshot[];
  activeOrders: LiveOrderSnapshot[];
  unassignedOrders: DeliveryOrderRecord[];
  generatedAt: string;
}> {
  await assertTenantNiche(clientId, ["restaurante"], pool);
  await ensureDeliveryOrdersTable(pool);

  const { motoboys: taggedMotoboys, allUsers } = await listTenantMotoboys(clientId, pool);
  const userNameMap = new Map<string, { name: string; email: string }>(
    allUsers.map((u) => [u.userId, { name: u.name, email: u.email }])
  );

  const [locRows] = (await pool.execute(
    "SELECT * FROM megadesk_motoboy_locations WHERE client_id = ?",
    [clientId]
  )) as any[];

  const locMap = new Map<
    string,
    { lat: number; lng: number; speed: number | null; heading: number | null; updatedAt: string; updatedMs: number }
  >();
  for (const r of locRows || []) {
    const dt = r.updated_at ? new Date(r.updated_at) : new Date(nowMs);
    locMap.set(String(r.motoboy_user_id), {
      lat: Number(r.lat),
      lng: Number(r.lng),
      speed: r.speed != null ? Number(r.speed) : null,
      heading: r.heading != null ? Number(r.heading) : null,
      updatedAt: dt.toISOString(),
      updatedMs: dt.getTime(),
    });
  }

  const [orderRows] = (await pool.execute(
    `SELECT d.*, c.chamadoNumber AS ticket_number
     FROM megadesk_delivery_orders d
     LEFT JOIN megadesk_domain_chamados c
       ON c.chamadoId = d.ticket_id AND c.clientId = d.client_id
     WHERE d.client_id = ?
       AND d.delivery_status IN ('pending', 'assigned', 'in_route')
     ORDER BY d.route_sequence ASC, d.created_at ASC`,
    [clientId]
  )) as any[];

  const mappedOrders = (orderRows || []).map(mapRowToDeliveryOrder);

  const activeOrders: LiveOrderSnapshot[] = [];
  const unassignedOrders: DeliveryOrderRecord[] = [];
  const inRouteByMotoboy = new Map<string, DeliveryOrderRecord>();
  const queuedCountByMotoboy = new Map<string, number>();

  for (const order of mappedOrders) {
    if (order.deliveryStatus === "pending") {
      unassignedOrders.push(order);
    } else {
      const mName = order.motoboyUserId ? userNameMap.get(order.motoboyUserId)?.name ?? "Motoboy" : null;
      activeOrders.push({ ...order, motoboyName: mName });
      if (order.motoboyUserId) {
        if (order.deliveryStatus === "in_route") {
          inRouteByMotoboy.set(order.motoboyUserId, order);
        } else if (order.deliveryStatus === "assigned") {
          queuedCountByMotoboy.set(
            order.motoboyUserId,
            (queuedCountByMotoboy.get(order.motoboyUserId) ?? 0) + 1
          );
        }
      }
    }
  }

  unassignedOrders.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  // Garante inclusão de todos os motoboys marcados e de qualquer motoboy com localização ou pedido ativo
  const motoboyIds = new Set<string>(taggedMotoboys.map((m) => m.userId));
  for (const id of locMap.keys()) motoboyIds.add(id);
  for (const id of inRouteByMotoboy.keys()) motoboyIds.add(id);
  for (const id of queuedCountByMotoboy.keys()) motoboyIds.add(id);

  const THREE_MIN_MS = 3 * 60 * 1000;
  const motoboys: LiveMotoboySnapshot[] = [...motoboyIds].map((userId) => {
    const info = userNameMap.get(userId);
    const loc = locMap.get(userId) ?? null;
    const activeOrder = inRouteByMotoboy.get(userId) ?? null;
    const queuedCount = queuedCountByMotoboy.get(userId) ?? 0;
    const isOnline = Boolean(loc && nowMs - loc.updatedMs <= THREE_MIN_MS);

    return {
      userId,
      name: info?.name || "Motoboy",
      email: info?.email || "",
      status: activeOrder ? "in_route" : "available",
      isOnline,
      location: loc
        ? {
            lat: loc.lat,
            lng: loc.lng,
            speed: loc.speed,
            heading: loc.heading,
            updatedAt: loc.updatedAt,
          }
        : null,
      activeOrder,
      queuedCount,
    };
  });

  motoboys.sort((a, b) => {
    if (a.status !== b.status) return a.status === "in_route" ? -1 : 1;
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    motoboys,
    activeOrders,
    unassignedOrders,
    generatedAt: new Date(nowMs).toISOString(),
  };
}

export interface PayoutDeliveryItem {
  id: string;
  ticketId: string;
  ticketNumber: number | null;
  motoboyUserId: string | null;
  motoboyName: string;
  customerName: string;
  deliveryAddress: string;
  paymentMethod: string;
  orderSource: DeliveryOrderSource;
  startedAt: string | null;
  deliveredAt: string | null;
  orderTotal: number;
  deliveryFee: number;
}

export interface PayoutMotoboySummary {
  motoboyUserId: string;
  motoboyName: string;
  deliveriesCount: number;
  totalAmount: number;
}

/**
 * Relatório financeiro de fechamento e repasses de motoboys (apenas nicho restaurante).
 */
export async function getDeliveryPayoutReport(
  input: {
    clientId: string;
    motoboyUserId?: string;
    preset: MotoboyHistoryPeriod;
    startDate?: string;
    endDate?: string;
  },
  pool: NicheQueryExecutor = getPool()
): Promise<{
  summary: { totalDeliveries: number; totalPayout: number; averageFee: number };
  byMotoboy: PayoutMotoboySummary[];
  deliveries: PayoutDeliveryItem[];
  preset: MotoboyHistoryPeriod;
  rangeStart: string;
  rangeEnd: string;
}> {
  await assertTenantNiche(input.clientId, ["restaurante"], pool);
  await ensureDeliveryOrdersTable(pool);

  const { start, end } = resolveMotoboyHistoryRange(input.preset, input.startDate, input.endDate);

  const [userRows] = (await pool.execute(
    "SELECT user_id, name FROM megadesk_domain_client_users WHERE client_id = ?",
    [input.clientId]
  )) as any[];
  const userNameMap = new Map<string, string>(
    (userRows || []).map((u: any) => [String(u.user_id), String(u.name)])
  );

  const hasMotoboyFilter = Boolean(input.motoboyUserId && input.motoboyUserId !== "all");
  const sql = hasMotoboyFilter
    ? `SELECT d.*, c.chamadoNumber AS ticket_number
       FROM megadesk_delivery_orders d
       LEFT JOIN megadesk_domain_chamados c
         ON c.chamadoId = d.ticket_id AND c.clientId = d.client_id
       WHERE d.client_id = ?
         AND d.delivery_status = 'delivered'
         AND d.motoboy_user_id = ?
         AND COALESCE(d.delivered_at, d.created_at) >= ?
         AND COALESCE(d.delivered_at, d.created_at) <= ?
       ORDER BY COALESCE(d.delivered_at, d.created_at) DESC`
    : `SELECT d.*, c.chamadoNumber AS ticket_number
       FROM megadesk_delivery_orders d
       LEFT JOIN megadesk_domain_chamados c
         ON c.chamadoId = d.ticket_id AND c.clientId = d.client_id
       WHERE d.client_id = ?
         AND d.delivery_status = 'delivered'
         AND COALESCE(d.delivered_at, d.created_at) >= ?
         AND COALESCE(d.delivered_at, d.created_at) <= ?
       ORDER BY COALESCE(d.delivered_at, d.created_at) DESC`;

  const params = hasMotoboyFilter
    ? [input.clientId, input.motoboyUserId, start, end]
    : [input.clientId, start, end];

  const [rows] = (await pool.execute(sql, params)) as any[];
  const mapped = (rows || []).map(mapRowToDeliveryOrder);

  const deliveries: PayoutDeliveryItem[] = mapped.map((o: DeliveryOrderRecord) => ({
    id: o.id,
    ticketId: o.ticketId,
    ticketNumber: o.ticketNumber ?? null,
    motoboyUserId: o.motoboyUserId,
    motoboyName: o.motoboyUserId ? userNameMap.get(o.motoboyUserId) || "Motoboy" : "Sem motoboy",
    customerName: o.customerName,
    deliveryAddress: o.deliveryAddress,
    paymentMethod: o.paymentMethod,
    orderSource: o.orderSource,
    startedAt: o.startedAt,
    deliveredAt: o.deliveredAt,
    orderTotal: o.orderTotal,
    deliveryFee: o.deliveryFee,
  }));

  const grouped = new Map<string, PayoutMotoboySummary>();
  let totalPayoutRaw = 0;

  for (const item of deliveries) {
    totalPayoutRaw += item.deliveryFee;
    const key = item.motoboyUserId || "unassigned";
    const cur = grouped.get(key) ?? {
      motoboyUserId: key,
      motoboyName: item.motoboyName,
      deliveriesCount: 0,
      totalAmount: 0,
    };
    cur.deliveriesCount += 1;
    cur.totalAmount = Number((cur.totalAmount + item.deliveryFee).toFixed(2));
    grouped.set(key, cur);
  }

  const totalDeliveries = deliveries.length;
  const totalPayout = Number(totalPayoutRaw.toFixed(2));
  const averageFee = totalDeliveries > 0 ? Number((totalPayout / totalDeliveries).toFixed(2)) : 0;
  const byMotoboy = [...grouped.values()].sort((a, b) => b.totalAmount - a.totalAmount);

  return {
    summary: {
      totalDeliveries,
      totalPayout,
      averageFee,
    },
    byMotoboy,
    deliveries,
    preset: input.preset,
    rangeStart: start.toISOString(),
    rangeEnd: end.toISOString(),
  };
}

export type PublicTrackingState = "active" | "delivered_recent" | "expired" | "not_found";

export interface PublicDeliveryTrackingResponse {
  state: PublicTrackingState;
  restaurant: {
    name: string;
    logoUrl: string | null;
    primaryColor: string;
    whatsappPhone: string | null;
  } | null;
  order: {
    ticketNumber: number | null;
    stageLabel: string;
    deliveryStatus: "pending" | "assigned" | "in_route" | "delivered";
    itemsSummary: string;
    orderTotal: number;
    paymentMethod: string;
    deliveryAddressMasked: string;
    deliveryCode: string | null;
    motoboyFirstName: string | null;
    motoboyLocation: { lat: number; lng: number; updatedAt: string | null } | null;
    destinationLocation: { lat: number; lng: number } | null;
    estimatedMinutes: number | null;
    startedAt: string | null;
    deliveredAt: string | null;
  } | null;
}

export function extractFirstName(fullName?: string | null): string | null {
  const cleaned = String(fullName || "").trim();
  if (!cleaned) return null;
  return cleaned.split(/\s+/)[0] || null;
}

export function maskDeliveryAddress(rawAddress?: string | null): string {
  const cleaned = String(rawAddress || "")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "") // remove eventual CPF
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Endereço informado no pedido";
  // Mantém apenas logradouro/número/bairro (até 2 primeiros segmentos separados por vírgula ou 90 chars)
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  const compact = parts.length >= 2 ? parts.slice(0, 3).join(", ") : cleaned;
  return compact.length > 90 ? `${compact.slice(0, 87)}...` : compact;
}

function estimateEtaMinutes(
  from: { lat: number; lng: number } | null,
  to: { lat: number; lng: number } | null
): number | null {
  if (!from || !to) return null;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  const km = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  if (!Number.isFinite(km)) return null;
  // Velocidade média urbana de motoboy (~24 km/h), mínimo 2 minutos
  return Math.max(2, Math.min(90, Math.round((km / 24) * 60)));
}

/**
 * Endpoint público (/r/:token) com whitelist estrita de campos.
 * NUNCA retorna client_id, motoboy_user_id, telefones de clientes, tokens ou notas internas.
 */
export async function getPublicDeliveryTrackByToken(
  token: string,
  pool: NicheQueryExecutor = getPool(),
  nowMs: number = Date.now()
): Promise<PublicDeliveryTrackingResponse> {
  const normalizedToken = String(token || "").trim();
  if (normalizedToken.length < 16 || normalizedToken.length > 64) {
    return { state: "not_found", restaurant: null, order: null };
  }

  await ensureDeliveryOrdersTable(pool);

  const [rows] = (await pool.execute(
    `SELECT d.*, c.chamadoNumber AS ticket_number
     FROM megadesk_delivery_orders d
     LEFT JOIN megadesk_domain_chamados c
       ON c.chamadoId = d.ticket_id AND c.clientId = d.client_id
     WHERE d.tracking_token = ?
     LIMIT 1`,
    [normalizedToken]
  )) as any[];

  const row = rows?.[0];
  if (!row) {
    return { state: "not_found", restaurant: null, order: null };
  }

  const clientId = String(row.client_id);
  const nicheCtx = await getTenantNicheContext(clientId, pool);
  if (!nicheCtx || nicheCtx.nicheProfile !== "restaurante") {
    return { state: "not_found", restaurant: null, order: null };
  }

  // Carrega identidade pública do Restaurante (nome, logo, WhatsApp)
  let restaurantName = "Restaurante";
  let logoUrl: string | null = null;
  let whatsappPhone: string | null = null;
  try {
    const [clientRows] = (await pool.execute(
      "SELECT company FROM megadesk_domain_clients WHERE client_id = ? LIMIT 1",
      [clientId]
    )) as any[];
    if (clientRows?.[0]?.company?.trim()) {
      restaurantName = String(clientRows[0].company).trim();
    }
  } catch {}
  try {
    const [settingsRows] = (await pool.execute(
      "SELECT company_name, logo_url, whatsapp, phone FROM megadesk_company_settings WHERE client_id = ? LIMIT 1",
      [clientId]
    )) as any[];
    const st = settingsRows?.[0];
    if (st?.company_name?.trim()) restaurantName = String(st.company_name).trim();
    if (st?.logo_url?.trim()) logoUrl = String(st.logo_url).trim();
    if (st?.whatsapp?.trim()) whatsappPhone = String(st.whatsapp).trim();
    else if (st?.phone?.trim()) whatsappPhone = String(st.phone).trim();
  } catch {}

  const restaurant = {
    name: restaurantName,
    logoUrl,
    primaryColor: "#10b981",
    whatsappPhone,
  };

  const deliveryStatus = String(row.delivery_status || "pending") as DeliveryOrderStatus;
  if (deliveryStatus === "canceled") {
    return { state: "expired", restaurant, order: null };
  }

  const expiresAtMs = row.tracking_expires_at ? new Date(row.tracking_expires_at).getTime() : null;
  if (expiresAtMs != null && Number.isFinite(expiresAtMs) && nowMs > expiresAtMs) {
    return { state: "expired", restaurant, order: null };
  }

  // Primeiro nome do entregador (nunca ID nem sobrenome completo)
  let motoboyFirstName: string | null = null;
  if (row.motoboy_user_id) {
    try {
      const [uRows] = (await pool.execute(
        "SELECT name FROM megadesk_domain_client_users WHERE client_id = ? AND user_id = ? LIMIT 1",
        [clientId, String(row.motoboy_user_id)]
      )) as any[];
      motoboyFirstName = extractFirstName(uRows?.[0]?.name);
    } catch {}
  }

  // Entregue recentemente (dentro da janela de 30 min): sem GPS e sem código
  if (deliveryStatus === "delivered") {
    return {
      state: "delivered_recent",
      restaurant,
      order: {
        ticketNumber: row.ticket_number != null ? Number(row.ticket_number) : null,
        stageLabel: "Entregue",
        deliveryStatus: "delivered",
        itemsSummary: String(row.items_summary ?? ""),
        orderTotal: Number(row.order_total ?? 0),
        paymentMethod: String(row.payment_method ?? ""),
        deliveryAddressMasked: maskDeliveryAddress(row.delivery_address),
        deliveryCode: null,
        motoboyFirstName,
        motoboyLocation: null,
        destinationLocation: null,
        estimatedMinutes: null,
        startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
        deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : null,
      },
    };
  }

  // Pedido ativo: GPS apenas quando deliveryStatus === 'in_route'
  let motoboyLocation: { lat: number; lng: number; updatedAt: string | null } | null = null;
  if (deliveryStatus === "in_route") {
    if (row.motoboy_user_id) {
      try {
        const [locRows] = (await pool.execute(
          "SELECT lat, lng, updated_at FROM megadesk_motoboy_locations WHERE client_id = ? AND motoboy_user_id = ? LIMIT 1",
          [clientId, String(row.motoboy_user_id)]
        )) as any[];
        const loc = locRows?.[0];
        if (loc && loc.lat != null && loc.lng != null) {
          motoboyLocation = {
            lat: Number(loc.lat),
            lng: Number(loc.lng),
            updatedAt: loc.updated_at ? new Date(loc.updated_at).toISOString() : null,
          };
        }
      } catch {}
    }
    if (!motoboyLocation && row.current_lat != null && row.current_lng != null) {
      motoboyLocation = {
        lat: Number(row.current_lat),
        lng: Number(row.current_lng),
        updatedAt: row.location_updated_at ? new Date(row.location_updated_at).toISOString() : null,
      };
    }
  }

  const destinationLocation =
    row.destination_lat != null && row.destination_lng != null
      ? { lat: Number(row.destination_lat), lng: Number(row.destination_lng) }
      : null;

  return {
    state: "active",
    restaurant,
    order: {
      ticketNumber: row.ticket_number != null ? Number(row.ticket_number) : null,
      stageLabel: String(row.stage_label || "Novo Pedido"),
      deliveryStatus: deliveryStatus as "pending" | "assigned" | "in_route",
      itemsSummary: String(row.items_summary ?? ""),
      orderTotal: Number(row.order_total ?? 0),
      paymentMethod: String(row.payment_method ?? ""),
      deliveryAddressMasked: maskDeliveryAddress(row.delivery_address),
      deliveryCode: String(row.delivery_code),
      motoboyFirstName,
      motoboyLocation,
      destinationLocation,
      estimatedMinutes:
        deliveryStatus === "in_route" ? estimateEtaMinutes(motoboyLocation, destinationLocation) : null,
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
      deliveredAt: null,
    },
  };
}

/**
 * Cancela um pedido de delivery, sincronizando ticket (`closed`), ERP > Vendas (`cancelled`)
 * e Histórico do Ticket.
 */
export async function cancelDeliveryOrder(
  input: {
    clientId: string;
    ticketId: string;
    reason?: string;
    actorUserId?: string | null;
    actorUserName?: string | null;
  },
  pool: NicheQueryExecutor = getPool()
): Promise<DeliveryOrderRecord> {
  await assertTenantNiche(input.clientId, ["restaurante"], pool);
  await ensureDeliveryOrdersTable(pool);

  const existing = await getDeliveryOrderByTicket(input.clientId, input.ticketId, pool);
  if (!existing) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Pedido de delivery não encontrado." });
  }

  await pool.execute(
    `UPDATE megadesk_delivery_orders
     SET delivery_status = 'canceled',
         stage_label = 'Cancelado',
         tracking_expires_at = NOW()
     WHERE client_id = ? AND ticket_id = ?`,
    [input.clientId, input.ticketId]
  );

  await pool
    .execute(
      "UPDATE megadesk_domain_chamados SET status = 'closed', updatedAt = NOW() WHERE clientId = ? AND chamadoId = ?",
      [input.clientId, input.ticketId]
    )
    .catch(() => {});

  await updateErpSaleStatusForDelivery(
    {
      clientId: input.clientId,
      erpSalePublicId: existing.erpSalePublicId,
      targetStatus: "cancelled",
      actorUserId: input.actorUserId,
    },
    pool
  );

  await recordDeliveryTicketActivity(pool, {
    clientId: input.clientId,
    ticketId: input.ticketId,
    actorUserId: input.actorUserId || "system",
    actorUserName: input.actorUserName || "Operador",
    actionType: "status_changed",
    description: `Pedido de delivery cancelado${input.reason ? `: ${input.reason}` : ""}${existing.erpSalePublicId ? " • Venda cancelada em ERP > Vendas." : "."}`,
    metadata: { eventType: "delivery_canceled", reason: input.reason ?? null },
  });

  return (await getDeliveryOrderByTicket(input.clientId, input.ticketId, pool))!;
}

/**
 * Busca ou cria cliente no CRM (`megadesk_crm_clients`) a partir de telefone, e-mail ou CPF/CNPJ,
 * reaproveitando nome e endereço salvos na conta quando não informados no pedido.
 */
export async function resolveOrCreateDeliveryCustomer(
  input: {
    clientId: string;
    customerName?: string | null;
    customerPhone?: string | null;
    customerEmail?: string | null;
    customerCpf?: string | null;
    deliveryAddress?: string | null;
    origin: "site" | "whatsapp" | "outro";
  },
  pool: NicheQueryExecutor = getPool()
): Promise<{
  crmClientId: string;
  customerName: string;
  customerPhone: string;
  resolvedAddress: string;
  reusedExisting: boolean;
}> {
  const digitsPhone = String(input.customerPhone || "").replace(/\D/g, "");
  const cleanEmail = String(input.customerEmail || "").trim().toLowerCase();
  const digitsCpf = String(input.customerCpf || "").replace(/\D/g, "");

  let matched: any = null;
  if (digitsPhone.length >= 8 || cleanEmail || digitsCpf.length >= 11) {
    const clauses: string[] = [];
    const params: unknown[] = [input.clientId];
    if (digitsPhone.length >= 8) {
      const tail = digitsPhone.slice(-8);
      clauses.push(
        "REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone, ''), '-', ''), ' ', ''), '(', ''), ')', '') LIKE ?",
        "REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(whatsapp, ''), '-', ''), ' ', ''), '(', ''), ')', '') LIKE ?"
      );
      params.push(`%${tail}`, `%${tail}`);
    }
    if (cleanEmail) {
      clauses.push("LOWER(COALESCE(email, '')) = ?");
      params.push(cleanEmail);
    }
    if (digitsCpf.length >= 11) {
      clauses.push(
        "REPLACE(REPLACE(REPLACE(COALESCE(cpf_cnpj, ''), '.', ''), '-', ''), '/', '') = ?"
      );
      params.push(digitsCpf);
    }

    const [rows] = (await pool.execute(
      `SELECT crm_client_id, company_name, responsible_name, phone, whatsapp, email, address, city, state, cep
       FROM megadesk_crm_clients
       WHERE client_id = ? AND lifecycle_state = 'active' AND (${clauses.join(" OR ")})
       LIMIT 1`,
      params
    )) as any[];
    matched = rows?.[0] ?? null;
  }

  if (matched) {
    const savedName =
      String(matched.company_name || "").trim() ||
      String(matched.responsible_name || "").trim() ||
      "Cliente";
    const savedPhone =
      String(matched.whatsapp || "").trim() || String(matched.phone || "").trim();
    const savedAddressParts = [
      String(matched.address || "").trim(),
      String(matched.city || "").trim(),
      String(matched.state || "").trim(),
      String(matched.cep || "").trim(),
    ].filter(Boolean);
    const savedAddress = savedAddressParts.join(", ");

    return {
      crmClientId: String(matched.crm_client_id),
      customerName: String(input.customerName || "").trim() || savedName,
      customerPhone: String(input.customerPhone || "").trim() || savedPhone || "0000000000",
      resolvedAddress: String(input.deliveryAddress || "").trim() || savedAddress,
      reusedExisting: true,
    };
  }

  const crmClientId = `crm-${randomUUID()}`;
  const finalName = String(input.customerName || "").trim() || "Cliente Delivery";
  const finalPhone = String(input.customerPhone || "").trim() || digitsPhone || "0000000000";
  const finalAddress = String(input.deliveryAddress || "").trim();

  await pool.execute(
    `INSERT INTO megadesk_crm_clients (
      crm_client_id, client_id, customer_type, company_name, responsible_name,
      cpf_cnpj, phone, whatsapp, email, address, status, lifecycle_state, origin,
      internal_responsible, tags, observations
    ) VALUES (?, ?, 'person', ?, ?, ?, ?, ?, ?, ?, 'ativo', 'active', ?, '', 'delivery', '')`,
    [
      crmClientId,
      input.clientId,
      finalName,
      finalName,
      digitsCpf || null,
      finalPhone,
      finalPhone,
      cleanEmail || null,
      finalAddress.slice(0, 255),
      input.origin,
    ]
  );

  return {
    crmClientId,
    customerName: finalName,
    customerPhone: finalPhone,
    resolvedAddress: finalAddress,
    reusedExisting: false,
  };
}

/**
 * Ingestão de pedido vindo do Site ou Bot IA com:
 * 1) Auto-preenchimento de cliente existente no CRM/ERP (por telefone, e-mail ou CPF)
 * 2) Resolução de itens contra o catálogo ERP > Produtos
 * 3) Criação automática de Ticket + Pedido Delivery (código 4D + token /r/:token) + Venda em ERP > Vendas.
 */
export async function ingestExternalDeliveryOrder(
  input: {
    clientId: string;
    orderSource: "site" | "whatsapp";
    customerName?: string | null;
    customerPhone?: string | null;
    customerEmail?: string | null;
    customerCpf?: string | null;
    deliveryAddress?: string | null;
    addressType?: DeliveryAddressType;
    addressComplement?: string | null;
    destinationLat?: number | null;
    destinationLng?: number | null;
    paymentMethod?: string;
    deliveryFee?: number;
    observations?: string;
    items: Array<{
      productPublicId?: string | null;
      sku?: string | null;
      name: string;
      quantity: number;
      unitPrice?: number;
    }>;
    actor?: CanonicalTicketActor;
  },
  deps: DeliveryDependencies = {}
): Promise<{
  ticket: { id: string; number: number };
  deliveryOrder: DeliveryOrderRecord;
  customer: { crmClientId: string; customerName: string; reusedExisting: boolean };
}> {
  const pool = deps.pool ?? getPool();
  await assertTenantNiche(input.clientId, ["restaurante"], pool);
  await ensureDeliveryOrdersTable(pool);

  const customer = await resolveOrCreateDeliveryCustomer(
    {
      clientId: input.clientId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerEmail: input.customerEmail,
      customerCpf: input.customerCpf,
      deliveryAddress: input.deliveryAddress,
      origin: input.orderSource === "site" ? "site" : "whatsapp",
    },
    pool
  );

  if (!customer.resolvedAddress || customer.resolvedAddress.length < 3) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Endereço de entrega não informado e não encontrado no cadastro do cliente.",
    });
  }

  // Resolve preços e productPublicId a partir do catálogo ERP > Produtos
  const catalog = await getRestaurantMenuCatalog(input.clientId, undefined, pool).catch(() => []);
  const resolvedItems: DeliveryOrderItem[] = [];
  for (const raw of input.items || []) {
    const matchedProd = catalog.find(
      (p) =>
        (raw.productPublicId && p.id === raw.productPublicId) ||
        (raw.sku && p.sku.toLowerCase() === raw.sku.trim().toLowerCase()) ||
        p.name.toLowerCase() === raw.name.trim().toLowerCase()
    );
    const qty = Math.max(1, Number(raw.quantity || 1));
    const unitPrice =
      raw.unitPrice !== undefined && Number(raw.unitPrice) > 0
        ? Number(raw.unitPrice)
        : matchedProd?.price ?? 0;
    resolvedItems.push({
      productPublicId: matchedProd?.id ?? raw.productPublicId ?? null,
      name: matchedProd?.name ?? raw.name.trim(),
      quantity: qty,
      unitPrice,
      subtotal: Number((qty * unitPrice).toFixed(2)),
    });
  }

  const deliveryFee = Math.max(0, Number(input.deliveryFee ?? 0));
  const itemsSubtotal = resolvedItems.reduce((acc, i) => acc + i.subtotal, 0);
  const orderTotal = Number((itemsSubtotal + deliveryFee).toFixed(2));
  const itemsSummary = formatDeliveryItemsSummary(resolvedItems);

  const actor: CanonicalTicketActor = input.actor ?? {
    userId: input.orderSource === "site" ? "site-integration" : "whatsapp-bot-ai",
    userName: input.orderSource === "site" ? "Pedido Site" : "Bot IA WhatsApp",
  };

  const created = await createRestaurantOrderWithTicket(
    {
      clientId: input.clientId,
      customerId: customer.crmClientId,
      customerName: customer.customerName,
      customerPhone: customer.customerPhone,
      orderSource: input.orderSource,
      items: resolvedItems,
      itemsSummary,
      orderTotal,
      deliveryFee,
      paymentMethod: (input.paymentMethod || "A combinar").trim(),
      deliveryAddress: customer.resolvedAddress,
      addressType: input.addressType ?? "casa",
      addressComplement: input.addressComplement ?? null,
      destinationLat: input.destinationLat ?? null,
      destinationLng: input.destinationLng ?? null,
      observations: input.observations,
      actor,
    },
    deps
  );

  return {
    ...created,
    customer: {
      crmClientId: customer.crmClientId,
      customerName: customer.customerName,
      reusedExisting: customer.reusedExisting,
    },
  };
}

/**
 * Cadastro rápido em 1 clique de novo login de Motoboy (nicho restaurante).
 */
export async function quickCreateTenantMotoboy(
  input: {
    clientId: string;
    name: string;
    email: string;
    password: string;
    phone?: string;
  },
  pool: NicheQueryExecutor = getPool()
): Promise<{ ok: true; userId: string; name: string; email: string }> {
  await assertTenantNiche(input.clientId, ["restaurante"], pool);

  const cleanEmail = input.email.trim().toLowerCase();
  const cleanName = input.name.trim();

  const [clientRows] = (await pool.execute(
    "SELECT max_users FROM megadesk_domain_clients WHERE client_id = ?",
    [input.clientId]
  )) as any[];
  const maxUsers = Number(clientRows?.[0]?.max_users ?? 20);

  const [countRows] = (await pool.execute(
    "SELECT COUNT(*) AS total FROM megadesk_domain_client_users WHERE client_id = ? AND status = 'active'",
    [input.clientId]
  )) as any[];
  const activeCount = Number(countRows?.[0]?.total ?? 0);
  if (activeCount >= maxUsers) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Limite de usuários ativos atingido (${maxUsers}). Aumente o limite no plano contratado.`,
    });
  }

  const [dupRows] = (await pool.execute(
    "SELECT user_id FROM megadesk_domain_client_users WHERE email = ? AND client_id = ? LIMIT 1",
    [cleanEmail, input.clientId]
  )) as any[];
  if ((dupRows || []).length > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Este e-mail já está cadastrado na equipe.",
    });
  }

  const userId = `user-${randomUUID()}`;
  const passwordHash = await bcrypt.hash(input.password, 10);
  const permissions = ["motoboy"];

  await pool.execute(
    `INSERT INTO megadesk_domain_client_users
      (user_id, client_id, name, email, role, status, permissions_json, password_hash)
     VALUES (?, ?, ?, ?, 'agent', 'active', ?, ?)`,
    [userId, input.clientId, cleanName, cleanEmail, JSON.stringify(permissions), passwordHash]
  );

  try {
    const { syncMegaDeskUserToMemory } = await import("../../routers");
    await syncMegaDeskUserToMemory(
      input.clientId,
      {
        id: userId,
        name: cleanName,
        email: cleanEmail,
        role: "agent",
        status: "active",
        permissions,
        passwordHash,
      },
      "upsert"
    );
  } catch {}

  return { ok: true, userId, name: cleanName, email: cleanEmail };
}
