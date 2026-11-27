import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type mysql from "mysql2/promise";
import { getPool } from "../../db";
import { createChamadoWithActivity, type CanonicalTicketActor } from "../../chamados-domain";
import { evoSendText } from "../../evolution/client";
import { instanceNameFor } from "../../evolution/session-store";
import { assertTenantNiche, type NicheQueryExecutor } from "../niche-guard";

export type DeliveryOrderSource = "site" | "whatsapp" | "manual";
export type DeliveryAddressType = "casa" | "apartamento" | "comercial" | "outro";
export type DeliveryOrderStatus = "pending" | "assigned" | "in_route" | "delivered" | "canceled";

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

/**
 * Cria automaticamente Ticket + Pedido de Delivery para tenants `restaurante`
 * (origem: site, whatsapp/Bot IA ou criação manual).
 */
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

/**
 * Inicia a rota de UM ÚNICO ticket específico:
 * 1. Valida isolamento de nicho (`restaurante`).
 * 2. Atualiza apenas aquele pedido para `in_route` / `Em Rota com Motoboy` e o ticket correspondente.
 * 3. Dispara mensagem automática no WhatsApp do cliente contendo o link temporário e código de 4 dígitos.
 */
export async function startDeliveryRoute(
  input: {
    clientId: string;
    ticketId: string;
    actorUserId?: string;
    actorUserName?: string;
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
