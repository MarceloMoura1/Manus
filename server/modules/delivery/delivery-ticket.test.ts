import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertTenantModule, assertTenantNiche } from "../niche-guard";
import {
  assignMotoboyToOrder,
  buildStartRouteWhatsAppMessage,
  createRestaurantOrderWithTicket,
  ensureRestaurantTicketStatuses,
  getDeliveryOrderByTicket,
  resetDeliveryTableEnsuredState,
  RESTAURANT_TICKET_STATUSES,
  startDeliveryRoute,
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

function createFakeDeliveryPool(clients: FakeClient[]) {
  const clientMap = new Map(clients.map((c) => [c.client_id, c]));
  const orders = new Map<string, FakeOrderRow>();
  const statuses: Array<{ status_id: string; client_id: string; name: string; color: string; order: number }> = [];
  const ticketUpdates: Array<{ clientId: string; ticketId: string; status: string }> = [];
  const activities: Array<{ ticketId: string; clientId: string; description: string }> = [];

  return {
    orders,
    statuses,
    ticketUpdates,
    activities,
    async execute(sql: string, params: unknown[] = []) {
      const q = sql.replace(/\s+/g, " ").trim();

      if (q.startsWith("CREATE TABLE IF NOT EXISTS megadesk_delivery_orders")) {
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

describe("niche-guard & restaurant delivery tickets", () => {
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

    // Motoboy recebe 2 pedidos na fila
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

    // Motoboy inicia rota SOMENTE do pedido 1
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

    // Disparo individual apenas para o cliente 1
    expect(sendWhatsAppMock).toHaveBeenCalledTimes(1);
    const sentArgs = sendWhatsAppMock.mock.calls[0][0];
    expect(sentArgs.clientId).toBe("tenant-rest");
    expect(sentArgs.phone).toBe("5541988881111");
    expect(sentArgs.message).toBe(
      buildStartRouteWhatsAppMessage(started.trackingUrl, order1.deliveryOrder.deliveryCode)
    );
    expect(sentArgs.message).toContain(started.trackingUrl);
    expect(sentArgs.message).toContain(`*${order1.deliveryOrder.deliveryCode}*`);

    // Pedido 2 na fila do mesmo motoboy permanece intocado (assigned / Pronto p/ Motoboy)
    const untouchedOrder2 = await getDeliveryOrderByTicket("tenant-rest", order2.ticket.id, pool);
    expect(untouchedOrder2?.deliveryStatus).toBe("assigned");
    expect(untouchedOrder2?.stageLabel).toBe("Pronto p/ Motoboy");
  });
});

