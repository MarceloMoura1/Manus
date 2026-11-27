import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type mysql from "mysql2/promise";
import { getPool } from "../../db";
import { createChamadoWithActivity, type CanonicalTicketActor } from "../../chamados-domain";
import { evoSendText } from "../../evolution/client";
import { instanceNameFor } from "../../evolution/session-store";
import { isTenantAdminRole } from "../ai-memory/tenant-ai-memory";
import { assertTenantNiche, getTenantNicheContext, type NicheQueryExecutor } from "../niche-guard";

export type DeliveryOrderSource = "site" | "whatsapp" | "manual";
export type DeliveryAddressType = "casa" | "apartamento" | "comercial" | "outro";
export type DeliveryOrderStatus = "pending" | "assigned" | "in_route" | "delivered" | "canceled";
export type MotoboyHistoryPeriod = "today" | "week" | "month" | "custom";

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
  startedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface DeliveryDependencies {
  pool?: NicheQueryExecutor;
  sendWhatsApp?: (input: { clientId: string; phone: string; message: string }) => Promise<unknown>;
  createTicket?: typeof createChamadoWithActivity;
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
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    ticketId: String(row.ticket_id),
    ticketNumber: row.ticket_number != null ? Number(row.ticket_number) : null,
    orderSource: (row.order_source || "manual") as DeliveryOrderSource,
    itemsSummary: String(row.items_summary ?? ""),
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

export async function createDeliveryOrderForTicket(
  input: {
    clientId: string;
    ticketId: string;
    orderSource?: DeliveryOrderSource;
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
  },
  deps: DeliveryDependencies = {}
): Promise<DeliveryOrderRecord> {
  const pool = deps.pool ?? getPool();
  await assertTenantNiche(input.clientId, ["restaurante"], pool);
  await ensureDeliveryOrdersTable(pool);

  const id = `dlv-${randomUUID()}`;
  const deliveryCode = generateDeliveryCode();
  const trackingToken = generateTrackingToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const deliveryStatus: DeliveryOrderStatus = input.motoboyUserId ? "assigned" : "pending";
  const stageLabel: RestaurantStageLabel = input.motoboyUserId ? "Pronto p/ Motoboy" : "Novo Pedido";

  await pool.execute(
    `INSERT INTO megadesk_delivery_orders (
      id, client_id, ticket_id, order_source, items_summary, order_total, delivery_fee,
      payment_method, customer_name, customer_phone, delivery_address, address_type,
      address_complement, destination_lat, destination_lng, motoboy_user_id, route_sequence,
      delivery_code, tracking_token, tracking_expires_at, delivery_status, stage_label
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.clientId,
      input.ticketId,
      input.orderSource ?? "manual",
      (input.itemsSummary ?? "").trim(),
      Number(input.orderTotal ?? 0),
      Number(input.deliveryFee ?? 0),
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
    itemsSummary: string;
    orderTotal: number;
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

  const createTicketFn = deps.createTicket ?? createChamadoWithActivity;
  const ticketTitle =
    input.title?.trim() ||
    `Pedido Delivery — ${input.customerName.trim()} (${input.orderSource})`;
  const obsParts = [
    input.observations?.trim(),
    input.itemsSummary ? `Itens: ${input.itemsSummary.trim()}` : "",
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
      orderSource: input.orderSource,
      itemsSummary: input.itemsSummary,
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
      Math.max(1, Number(input.routeSequence ?? existing.routeSequence)),
      input.deliveryFee !== undefined ? Number(input.deliveryFee) : existing.deliveryFee,
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

  const updated = await getDeliveryOrderByTicket(input.clientId, input.ticketId, pool);
  return updated!;
}

export async function updateDeliveryStage(
  input: {
    clientId: string;
    ticketId: string;
    stageLabel: RestaurantStageLabel;
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

  await pool.execute(
    `INSERT INTO megadesk_domain_chamado_activities
     (activity_id, chamado_id, client_id, user_id, user_name, action_type, description, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, 'status_changed', ?, ?, NOW())`,
    [
      `act-${randomUUID()}`,
      input.ticketId,
      input.clientId,
      input.actorUserId || order.motoboyUserId || "system",
      input.actorUserName || "Motoboy",
      "Status alterado para Em Rota com Motoboy — notificação de rastreio enviada ao cliente.",
      JSON.stringify({ eventType: "delivery_route_started", stageLabel: "Em Rota com Motoboy" }),
    ]
  ).catch(() => {});

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

  await pool.execute(
    `INSERT INTO megadesk_domain_chamado_activities
     (activity_id, chamado_id, client_id, user_id, user_name, action_type, description, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, 'status_changed', ?, ?, NOW())`,
    [
      `act-${randomUUID()}`,
      input.ticketId,
      input.clientId,
      input.motoboyUserId,
      input.actorUserName || "Motoboy",
      "Entrega concluída (Entregue) com código de 4 dígitos validado.",
      JSON.stringify({ eventType: "delivery_completed", stageLabel: "Entregue" }),
    ]
  ).catch(() => {});

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
