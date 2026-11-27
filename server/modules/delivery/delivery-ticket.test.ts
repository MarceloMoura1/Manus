import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertTenantModule, assertTenantNiche } from "../niche-guard";
import {
  assignMotoboyToOrder,
  buildStartRouteWhatsAppMessage,
  completeDeliveryOrder,
  createRestaurantOrderWithTicket,
  ensureRestaurantTicketStatuses,
  getDeliveryOrderByTicket,
  getMotoboyHistory,
  getMotoboyQueue,
  resetDeliveryTableEnsuredState,
  RESTAURANT_TICKET_STATUSES,
  startDeliveryRoute,
  updateMotoboyLocation,
} from "./delivery.service";

type FakeClient = {
  client_id: string;
  niche_profile: string;
  enabled_modules: string | null;
};

type FakeOrderRow = {
  id: string;
  client_id: string;
  ticket_id: string;
  order_source: string;
  items_summary: string;
  order_total: number;
  delivery_fee: number;
  payment_method: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  address_type: string;
  address_complement: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  current_lat: number | null;
  current_lng: number | null;
  location_updated_at: Date | null;
  motoboy_user_id: string | null;
  route_sequence: number;
  delivery_code: string;
  tracking_token: string;
  tracking_expires_at: Date | null;
  delivery_status: string;
  stage_label: string;
  started_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
};

type FakeLocationRow = {
  id: string;
  client_id: string;
  motoboy_user_id: string;
  active_order_id: string | null;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  updated_at: Date;
};

function createFakeDeliveryPool(clients: FakeClient[]) {
  const clientMap = new Map(clients.map((c) => [c.client_id, c]));
  const orders = new Map<string, FakeOrderRow>();
  const locations = new Map<string, FakeLocationRow>();
  const statuses: Array<{ status_id: string; client_id: string; name: string; color: string; order: number }> = [];
  const ticketUpdates: Array<{ clientId: string; ticketId: string; status: string }> = [];
  const activities: Array<{ ticketId: string; clientId: string; description: string }> = [];

  return {
    orders,
    locations,
    statuses,
    ticketUpdates,
    activities,
    async execute(sql: string, params: unknown[] = []) {
      const q = sql.replace(/\s+/g, " ").trim();

      if (
        q.startsWith("CREATE TABLE IF NOT EXISTS megadesk_delivery_orders") ||
        q.startsWith("CREATE TABLE IF NOT EXISTS megadesk_motoboy_locations") ||
        q.startsWith("ALTER TABLE megadesk_delivery_orders")
      ) {
        return [[], []];
      }

      if (q.startsWith("SELECT niche_profile, enabled_modules FROM megadesk_domain_clients")) {
        const row = clientMap.get(String(params[0]));
        return [row ? [row] : [], []];
      }

      if (q.startsWith("SELECT status_id, name, color, `order` FROM megadesk_ticket_statuses")) {
        const cid = String(params[0]);
        return [statuses.filter((s) => s.client_id === cid).sort((a, b) => a.order - b.order), []];
      }

      if (q.startsWith("INSERT INTO megadesk_ticket_statuses")) {
        statuses.push({
          status_id: String(params[0]),
          client_id: String(params[1]),
          name: String(params[2]),
          color: String(params[3]),
          order: Number(params[4]),
        });
        return [{ affectedRows: 1 }, []];
      }

      if (q.startsWith("INSERT INTO megadesk_delivery_orders")) {
        const row: FakeOrderRow = {
          id: String(params[0]),
          client_id: String(params[1]),
          ticket_id: String(params[2]),
          order_source: String(params[3]),
          items_summary: String(params[4]),
          order_total: Number(params[5]),
          delivery_fee: Number(params[6]),
          payment_method: String(params[7]),
          customer_name: String(params[8]),
          customer_phone: String(params[9]),
          delivery_address: String(params[10]),
          address_type: String(params[11]),
          address_complement: params[12] ? String(params[12]) : null,
          destination_lat: params[13] != null ? Number(params[13]) : null,
          destination_lng: params[14] != null ? Number(params[14]) : null,
          current_lat: null,
          current_lng: null,
          location_updated_at: null,
          motoboy_user_id: params[15] ? String(params[15]) : null,
          route_sequence: Number(params[16]),
          delivery_code: String(params[17]),
          tracking_token: String(params[18]),
          tracking_expires_at: params[19] instanceof Date ? params[19] : null,
          delivery_status: String(params[20]),
          stage_label: String(params[21]),
          started_at: null,
          delivered_at: null,
          created_at: new Date(),
        };
        orders.set(`${row.client_id}:${row.ticket_id}`, row);
        return [{ affectedRows: 1 }, []];
      }

      if (q.startsWith("SELECT * FROM megadesk_delivery_orders WHERE id = ?")) {
        const id = String(params[0]);
        const cid = String(params[1]);
        const match = [...orders.values()].find((r) => r.id === id && r.client_id === cid);
        return [match ? [match] : [], []];
      }

      if (q.startsWith("SELECT * FROM megadesk_delivery_orders WHERE client_id = ? AND ticket_id = ?")) {
        const match = orders.get(`${String(params[0])}:${String(params[1])}`);
        return [match ? [match] : [], []];
      }

      // myQueue
      if (q.includes("AND d.delivery_status IN ('assigned', 'in_route')")) {
        const cid = String(params[0]);
        const motoboyId = String(params[1]);
        const rows = [...orders.values()]
          .filter(
            (r) =>
              r.client_id === cid &&
              r.motoboy_user_id === motoboyId &&
              (r.delivery_status === "assigned" || r.delivery_status === "in_route")
          )
          .sort((a, b) => {
            const pa = a.delivery_status === "in_route" ? 0 : 1;
            const pb = b.delivery_status === "in_route" ? 0 : 1;
            if (pa !== pb) return pa - pb;
            return a.route_sequence - b.route_sequence;
          });
        return [rows, []];
      }

      // myHistory
      if (q.includes("AND d.delivery_status = 'delivered'")) {
        const cid = String(params[0]);
        const motoboyId = String(params[1]);
        const start = params[2] instanceof Date ? params[2] : new Date(String(params[2]));
        const end = params[3] instanceof Date ? params[3] : new Date(String(params[3]));
        const rows = [...orders.values()]
          .filter((r) => {
            if (r.client_id !== cid || r.motoboy_user_id !== motoboyId || r.delivery_status !== "delivered") {
              return false;
            }
            const ts = (r.delivered_at ?? r.created_at).getTime();
            return ts >= start.getTime() && ts <= end.getTime();
          })
          .sort((a, b) => (b.delivered_at ?? b.created_at).getTime() - (a.delivered_at ?? a.created_at).getTime());
        return [rows, []];
      }

      if (q.startsWith("UPDATE megadesk_delivery_orders SET motoboy_user_id = ?")) {
        const key = `${String(params[5])}:${String(params[6])}`;
        const existing = orders.get(key);
        if (existing) {
          existing.motoboy_user_id = params[0] ? String(params[0]) : null;
          existing.route_sequence = Number(params[1]);
          existing.delivery_fee = Number(params[2]);
          existing.delivery_status = String(params[3]);
          existing.stage_label = String(params[4]);
        }
        return [{ affectedRows: existing ? 1 : 0 }, []];
      }

      if (q.startsWith("UPDATE megadesk_delivery_orders SET delivery_status = 'in_route'")) {
        const key = `${String(params[1])}:${String(params[2])}`;
        const existing = orders.get(key);
        if (existing) {
          existing.delivery_status = "in_route";
          existing.stage_label = "Em Rota com Motoboy";
          existing.started_at = existing.started_at ?? new Date();
          existing.tracking_expires_at = params[0] instanceof Date ? params[0] : null;
        }
        return [{ affectedRows: existing ? 1 : 0 }, []];
      }

      if (q.startsWith("UPDATE megadesk_delivery_orders SET delivery_status = 'delivered'")) {
        const key = `${String(params[1])}:${String(params[2])}`;
        const existing = orders.get(key);
        if (existing) {
          existing.delivery_status = "delivered";
          existing.stage_label = "Entregue";
          existing.delivered_at = new Date();
          existing.tracking_expires_at = params[0] instanceof Date ? params[0] : null;
        }
        return [{ affectedRows: existing ? 1 : 0 }, []];
      }

      if (q.startsWith("UPDATE megadesk_delivery_orders SET current_lat = ?")) {
        const lat = Number(params[0]);
        const lng = Number(params[1]);
        const cid = String(params[2]);
        const motoboyId = String(params[3]);
        let count = 0;
        for (const r of orders.values()) {
          if (r.client_id === cid && r.motoboy_user_id === motoboyId && r.delivery_status === "in_route") {
            r.current_lat = lat;
            r.current_lng = lng;
            r.location_updated_at = new Date();
            count++;
          }
        }
        return [{ affectedRows: count }, []];
      }

      if (q.startsWith("INSERT INTO megadesk_motoboy_locations")) {
        const row: FakeLocationRow = {
          id: String(params[0]),
          client_id: String(params[1]),
          motoboy_user_id: String(params[2]),
          active_order_id: params[3] ? String(params[3]) : null,
          lat: Number(params[4]),
          lng: Number(params[5]),
          speed: params[6] != null ? Number(params[6]) : null,
          heading: params[7] != null ? Number(params[7]) : null,
          updated_at: new Date(),
        };
        locations.set(`${row.client_id}:${row.motoboy_user_id}`, row);
        return [{ affectedRows: 1 }, []];
      }

      if (q.startsWith("UPDATE megadesk_motoboy_locations SET active_order_id = NULL")) {
        const key = `${String(params[0])}:${String(params[1])}`;
        const loc = locations.get(key);
        if (loc && loc.active_order_id === String(params[2])) {
          loc.active_order_id = null;
        }
        return [{ affectedRows: 1 }, []];
      }

      if (q.startsWith("UPDATE megadesk_domain_chamados SET status =")) {
        if (q.includes("SET status = 'in_progress'")) {
          ticketUpdates.push({
            clientId: String(params[0]),
            ticketId: String(params[1]),
            status: "in_progress",
          });
        } else if (q.includes("SET status = 'waiting'")) {
          ticketUpdates.push({
            clientId: String(params[0]),
            ticketId: String(params[1]),
            status: "waiting",
          });
        } else if (q.includes("SET status = 'closed'")) {
          ticketUpdates.push({
            clientId: String(params[0]),
            ticketId: String(params[1]),
            status: "closed",
          });
        } else {
          ticketUpdates.push({
            status: String(params[0]),
            clientId: String(params[1]),
            ticketId: String(params[2]),
          });
        }
        return [{ affectedRows: 1 }, []];
      }

      if (q.startsWith("INSERT INTO megadesk_domain_chamado_activities")) {
        activities.push({
          ticketId: String(params[1]),
          clientId: String(params[2]),
          description: String(params[5]),
        });
        return [{ affectedRows: 1 }, []];
      }

      return [[], []];
    },
  };
}

describe("niche-guard & restaurant delivery tickets (Entregas 1 e 2)", () => {
  beforeEach(() => {
    resetDeliveryTableEnsuredState();
  });

  it("assertTenantNiche bloqueia (FORBIDDEN) prestacao_servicos e ecommerce, permitindo apenas restaurante", async () => {
    const pool = createFakeDeliveryPool([
      { client_id: "tenant-rest", niche_profile: "restaurante", enabled_modules: null },
      { client_id: "tenant-serv", niche_profile: "prestacao_servicos", enabled_modules: null },
      { client_id: "tenant-ecom", niche_profile: "ecommerce", enabled_modules: null },
    ]);

    const ok = await assertTenantNiche("tenant-rest", ["restaurante"], pool);
    expect(ok.nicheProfile).toBe("restaurante");

    await expect(assertTenantNiche("tenant-serv", ["restaurante"], pool)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await expect(assertTenantNiche("tenant-ecom", ["restaurante"], pool)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await expect(assertTenantModule("tenant-serv", "rastreamento", pool)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("criação de pedido restaurante gera os 5 status automáticos, ticket, código de 4 dígitos e tracking_token", async () => {
    const pool = createFakeDeliveryPool([
      { client_id: "tenant-rest", niche_profile: "restaurante", enabled_modules: null },
    ]);

    const statuses = await ensureRestaurantTicketStatuses("tenant-rest", pool);
    expect(statuses.map((s) => s.name)).toEqual(RESTAURANT_TICKET_STATUSES.map((s) => s.name));

    const createTicketMock = vi.fn().mockResolvedValue({ id: "ticket-uuid-001", number: 101 });

    const created = await createRestaurantOrderWithTicket(
      {
        clientId: "tenant-rest",
        customerId: "crm-1",
        customerName: "João da Silva",
        customerPhone: "5541999990001",
        actor: { userId: "u1", userName: "Atendente" },
        orderSource: "whatsapp",
        itemsSummary: "2x Burger Artesanal, 1x Suco",
        orderTotal: 89.9,
        deliveryFee: 12.0,
        paymentMethod: "Pix",
        deliveryAddress: "Rua das Flores, 123 - Centro",
        addressType: "apartamento",
        addressComplement: "Bloco B, Apto 402",
      },
      { pool, createTicket: createTicketMock as any }
    );

    expect(createTicketMock).toHaveBeenCalledTimes(1);
    expect(created.ticket).toEqual({ id: "ticket-uuid-001", number: 101 });
    expect(created.deliveryOrder.deliveryCode).toMatch(/^\d{4}$/);
    expect(created.deliveryOrder.trackingToken.length).toBeGreaterThanOrEqual(32);
    expect(created.deliveryOrder.trackingUrl).toContain(`/r/${created.deliveryOrder.trackingToken}`);
    expect(created.deliveryOrder.addressType).toBe("apartamento");
    expect(created.deliveryOrder.addressComplement).toBe("Bloco B, Apto 402");
    expect(created.deliveryOrder.stageLabel).toBe("Novo Pedido");
  });

  it("startRoute atualiza status apenas daquele ticket e dispara WhatsApp individual com link e código de 4 dígitos", async () => {
    const pool = createFakeDeliveryPool([
      { client_id: "tenant-rest", niche_profile: "restaurante", enabled_modules: null },
    ]);

    let seq = 0;
    const createTicketMock = vi.fn().mockImplementation(async () => ({
      id: `ticket-uuid-${++seq}`,
      number: 200 + seq,
    }));

    const order1 = await createRestaurantOrderWithTicket(
      {
        clientId: "tenant-rest",
        customerId: "crm-1",
        customerName: "Maria Cliente 1",
        customerPhone: "5541988881111",
        actor: { userId: "u1", userName: "Caixa" },
        orderSource: "site",
        itemsSummary: "1x Pizza Grande",
        orderTotal: 75,
        deliveryFee: 10,
        paymentMethod: "Pago online",
        deliveryAddress: "Av. Paulista, 100",
        addressType: "casa",
      },
      { pool, createTicket: createTicketMock as any }
    );
    const order2 = await createRestaurantOrderWithTicket(
      {
        clientId: "tenant-rest",
        customerId: "crm-2",
        customerName: "Pedro Cliente 2",
        customerPhone: "5541988882222",
        actor: { userId: "u1", userName: "Caixa" },
        orderSource: "site",
        itemsSummary: "1x Combo Sushi",
        orderTotal: 110,
        deliveryFee: 14,
        paymentMethod: "Cartão na entrega",
        deliveryAddress: "Rua XV, 500",
        addressType: "apartamento",
        addressComplement: "Apto 12",
      },
      { pool, createTicket: createTicketMock as any }
    );

    await assignMotoboyToOrder(
      { clientId: "tenant-rest", ticketId: order1.ticket.id, motoboyUserId: "motoboy-1", routeSequence: 1 },
      pool
    );
    await assignMotoboyToOrder(
      { clientId: "tenant-rest", ticketId: order2.ticket.id, motoboyUserId: "motoboy-1", routeSequence: 2 },
      pool
    );

    const sendWhatsAppMock = vi.fn().mockResolvedValue({ ok: true });

    const started = await startDeliveryRoute(
      {
        clientId: "tenant-rest",
        ticketId: order1.ticket.id,
        actorUserId: "motoboy-1",
        actorUserName: "Carlos Motoboy",
      },
      { pool, sendWhatsApp: sendWhatsAppMock }
    );

    expect(started.ok).toBe(true);
    expect(started.whatsappSent).toBe(true);
    expect(started.deliveryOrder.deliveryStatus).toBe("in_route");
    expect(started.deliveryOrder.stageLabel).toBe("Em Rota com Motoboy");

    expect(sendWhatsAppMock).toHaveBeenCalledTimes(1);
    const sentArgs = sendWhatsAppMock.mock.calls[0][0];
    expect(sentArgs.clientId).toBe("tenant-rest");
    expect(sentArgs.phone).toBe("5541988881111");
    expect(sentArgs.message).toBe(
      buildStartRouteWhatsAppMessage(started.trackingUrl, order1.deliveryOrder.deliveryCode)
    );

    const untouchedOrder2 = await getDeliveryOrderByTicket("tenant-rest", order2.ticket.id, pool);
    expect(untouchedOrder2?.deliveryStatus).toBe("assigned");
    expect(untouchedOrder2?.stageLabel).toBe("Pronto p/ Motoboy");
  });

  it("isola myQueue e myHistory entre motoboys e bloqueia nichos não-restaurante", async () => {
    const pool = createFakeDeliveryPool([
      { client_id: "tenant-rest", niche_profile: "restaurante", enabled_modules: null },
      { client_id: "tenant-serv", niche_profile: "prestacao_servicos", enabled_modules: null },
    ]);

    await expect(
      getMotoboyQueue({ clientId: "tenant-serv", motoboyUserId: "motoboy-a" }, pool)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      getMotoboyHistory({ clientId: "tenant-serv", motoboyUserId: "motoboy-a", period: "today" }, pool)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    let seq = 0;
    const createTicketMock = vi.fn().mockImplementation(async () => ({ id: `t-${++seq}`, number: seq }));

    const oA1 = await createRestaurantOrderWithTicket(
      {
        clientId: "tenant-rest",
        customerId: "c1",
        customerName: "Cliente A1",
        customerPhone: "5541900001111",
        actor: { userId: "admin", userName: "Admin" },
        orderSource: "manual",
        itemsSummary: "Item A1",
        orderTotal: 50,
        deliveryFee: 8.5,
        paymentMethod: "Pix",
        deliveryAddress: "Rua A, 1",
      },
      { pool, createTicket: createTicketMock as any }
    );
    const oB1 = await createRestaurantOrderWithTicket(
      {
        clientId: "tenant-rest",
        customerId: "c2",
        customerName: "Cliente B1",
        customerPhone: "5541900002222",
        actor: { userId: "admin", userName: "Admin" },
        orderSource: "manual",
        itemsSummary: "Item B1",
        orderTotal: 60,
        deliveryFee: 11.0,
        paymentMethod: "Dinheiro",
        deliveryAddress: "Rua B, 2",
      },
      { pool, createTicket: createTicketMock as any }
    );

    await assignMotoboyToOrder(
      { clientId: "tenant-rest", ticketId: oA1.ticket.id, motoboyUserId: "motoboy-a", routeSequence: 1 },
      pool
    );
    await assignMotoboyToOrder(
      { clientId: "tenant-rest", ticketId: oB1.ticket.id, motoboyUserId: "motoboy-b", routeSequence: 1 },
      pool
    );

    const queueA = await getMotoboyQueue({ clientId: "tenant-rest", motoboyUserId: "motoboy-a" }, pool);
    const queueB = await getMotoboyQueue({ clientId: "tenant-rest", motoboyUserId: "motoboy-b" }, pool);

    expect(queueA.map((o) => o.ticketId)).toEqual([oA1.ticket.id]);
    expect(queueB.map((o) => o.ticketId)).toEqual([oB1.ticket.id]);
  });

  it("completeDelivery valida código de 4 dígitos, fecha ticket, expira link em 30 min e soma ganhos em myHistory", async () => {
    const pool = createFakeDeliveryPool([
      { client_id: "tenant-rest", niche_profile: "restaurante", enabled_modules: null },
    ]);

    const createTicketMock = vi.fn().mockResolvedValue({ id: "t-comp-1", number: 301 });
    const created = await createRestaurantOrderWithTicket(
      {
        clientId: "tenant-rest",
        customerId: "c1",
        customerName: "Cliente Final",
        customerPhone: "5541999993333",
        actor: { userId: "admin", userName: "Admin" },
        orderSource: "whatsapp",
        itemsSummary: "1x Lasanha",
        orderTotal: 68,
        deliveryFee: 15.5,
        paymentMethod: "Cartão na entrega",
        deliveryAddress: "Av. Brasil, 900",
      },
      { pool, createTicket: createTicketMock as any }
    );

    await assignMotoboyToOrder(
      { clientId: "tenant-rest", ticketId: created.ticket.id, motoboyUserId: "motoboy-a", routeSequence: 1 },
      pool
    );

    // Outro motoboy não pode concluir entrega do motoboy-a
    await expect(
      completeDeliveryOrder(
        {
          clientId: "tenant-rest",
          ticketId: created.ticket.id,
          deliveryCode: created.deliveryOrder.deliveryCode,
          motoboyUserId: "motoboy-b",
          isAdmin: false,
        },
        pool
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Código incorreto rejeitado
    const wrongCode = created.deliveryOrder.deliveryCode === "0000" ? "9999" : "0000";
    await expect(
      completeDeliveryOrder(
        {
          clientId: "tenant-rest",
          ticketId: created.ticket.id,
          deliveryCode: wrongCode,
          motoboyUserId: "motoboy-a",
        },
        pool
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Código correto conclui entrega + fecha ticket + expira link em ~30min
    const before = Date.now();
    const completed = await completeDeliveryOrder(
      {
        clientId: "tenant-rest",
        ticketId: created.ticket.id,
        deliveryCode: created.deliveryOrder.deliveryCode,
        motoboyUserId: "motoboy-a",
        actorUserName: "Motoboy A",
      },
      pool
    );

    expect(completed.ok).toBe(true);
    expect(completed.deliveryOrder.deliveryStatus).toBe("delivered");
    expect(completed.deliveryOrder.stageLabel).toBe("Entregue");
    expect(completed.deliveryFeeEarned).toBe(15.5);
    expect(pool.ticketUpdates.some((u) => u.ticketId === created.ticket.id && u.status === "closed")).toBe(true);

    const expMs = new Date(completed.deliveryOrder.trackingExpiresAt!).getTime();
    const diffMinutes = (expMs - before) / 60_000;
    expect(diffMinutes).toBeGreaterThanOrEqual(29);
    expect(diffMinutes).toBeLessThanOrEqual(31);

    // Aparece no extrato do motoboy-a e não no do motoboy-b
    const histA = await getMotoboyHistory(
      { clientId: "tenant-rest", motoboyUserId: "motoboy-a", period: "today" },
      pool
    );
    const histB = await getMotoboyHistory(
      { clientId: "tenant-rest", motoboyUserId: "motoboy-b", period: "today" },
      pool
    );
    expect(histA.summary).toEqual({ totalDeliveries: 1, totalEarnings: 15.5 });
    expect(histB.summary).toEqual({ totalDeliveries: 0, totalEarnings: 0 });
  });

  it("updateMotoboyLocation grava coordenadas apenas para o motoboy autenticado e pedidos em rota dele", async () => {
    const pool = createFakeDeliveryPool([
      { client_id: "tenant-rest", niche_profile: "restaurante", enabled_modules: null },
    ]);

    let seq = 0;
    const createTicketMock = vi.fn().mockImplementation(async () => ({ id: `t-gps-${++seq}`, number: 400 + seq }));
    const o1 = await createRestaurantOrderWithTicket(
      {
        clientId: "tenant-rest",
        customerId: "c1",
        customerName: "C1",
        customerPhone: "5541999991111",
        actor: { userId: "admin", userName: "Admin" },
        orderSource: "manual",
        itemsSummary: "Pizza",
        orderTotal: 50,
        deliveryFee: 10,
        paymentMethod: "Pix",
        deliveryAddress: "Rua 1",
      },
      { pool, createTicket: createTicketMock as any }
    );
    const o2 = await createRestaurantOrderWithTicket(
      {
        clientId: "tenant-rest",
        customerId: "c2",
        customerName: "C2",
        customerPhone: "5541999992222",
        actor: { userId: "admin", userName: "Admin" },
        orderSource: "manual",
        itemsSummary: "Esfiha",
        orderTotal: 40,
        deliveryFee: 9,
        paymentMethod: "Pix",
        deliveryAddress: "Rua 2",
      },
      { pool, createTicket: createTicketMock as any }
    );

    await assignMotoboyToOrder(
      { clientId: "tenant-rest", ticketId: o1.ticket.id, motoboyUserId: "motoboy-a", routeSequence: 1 },
      pool
    );
    await assignMotoboyToOrder(
      { clientId: "tenant-rest", ticketId: o2.ticket.id, motoboyUserId: "motoboy-b", routeSequence: 1 },
      pool
    );

    await startDeliveryRoute(
      { clientId: "tenant-rest", ticketId: o1.ticket.id, actorUserId: "motoboy-a" },
      { pool, sendWhatsApp: vi.fn().mockResolvedValue({ ok: true }) }
    );
    await startDeliveryRoute(
      { clientId: "tenant-rest", ticketId: o2.ticket.id, actorUserId: "motoboy-b" },
      { pool, sendWhatsApp: vi.fn().mockResolvedValue({ ok: true }) }
    );

    const gps = await updateMotoboyLocation(
      {
        clientId: "tenant-rest",
        motoboyUserId: "motoboy-a",
        lat: -25.4284,
        lng: -49.2733,
        speed: 11.2,
        heading: 180,
        activeOrderId: o1.deliveryOrder.id,
      },
      pool
    );

    expect(gps.ok).toBe(true);
    expect(pool.locations.get("tenant-rest:motoboy-a")?.lat).toBe(-25.4284);
    expect(pool.locations.get("tenant-rest:motoboy-b")).toBeUndefined();

    const updatedO1 = await getDeliveryOrderByTicket("tenant-rest", o1.ticket.id, pool);
    const untouchedO2 = await getDeliveryOrderByTicket("tenant-rest", o2.ticket.id, pool);
    expect(updatedO1?.currentLat).toBe(-25.4284);
    expect(updatedO1?.currentLng).toBe(-49.2733);
    expect(untouchedO2?.currentLat).toBeNull();
  });
});
