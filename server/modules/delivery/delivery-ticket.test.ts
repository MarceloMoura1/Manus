import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTenantEnabledModules } from "../../../shared/tenant-modules";
import { assertTenantModule, assertTenantNiche } from "../niche-guard";
import {
  acceptDeliveryOrder,
  assignMotoboyToOrder,
  buildStartRouteWhatsAppMessage,
  completeDeliveryOrder,
  createRestaurantOrderWithTicket,
  ensureRestaurantTicketStatuses,
  getDeliveryLiveOverview,
  getDeliveryOrderByTicket,
  getDeliveryPayoutReport,
  getMotoboyHistory,
  getMotoboyQueue,
  getPublicDeliveryTrackByToken,
  ingestExternalDeliveryOrder,
  resetDeliveryTableEnsuredState,
  RESTAURANT_TICKET_STATUSES,
  startDeliveryRoute,
  updateDeliveryStage,
  updateMotoboyLocation,
} from "./delivery.service";

type FakeClient = {
  client_id: string;
  niche_profile: string;
  enabled_modules: string | null;
  company?: string;
  logo_url?: string | null;
  whatsapp?: string | null;
};

type FakeOrderRow = {
  id: string;
  client_id: string;
  ticket_id: string;
  order_source: string;
  items_json: string | null;
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
  erp_sale_public_id: string | null;
  accepted_at: Date | null;
  started_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
};

type FakeProductRow = {
  id: number;
  public_id: string;
  client_id: string;
  name: string;
  sku: string;
  category: string | null;
  sale_price_cents: number;
  active: number;
};

type FakeCrmClientRow = {
  crm_client_id: string;
  client_id: string;
  company_name: string;
  responsible_name: string;
  cpf_cnpj: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string;
  city: string;
  state: string;
  cep: string;
  lifecycle_state: string;
};

type FakeErpSaleRow = {
  id: number;
  public_id: string;
  client_id: string;
  order_number: string;
  crm_client_id: string;
  customer_name_snapshot: string;
  status: string;
  commercial_status: string;
  current_stage: string;
  subtotal_cents: number;
  freight_cents: number;
  total_cents: number;
  payment_method_snapshot: string;
  notes: string;
};

type FakeErpSaleItemRow = {
  sale_order_id: number;
  product_id: number;
  product_name_snapshot: string;
  quantity: string;
  unit_price_cents: number;
  line_total_cents: number;
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

function createFakeDeliveryPool(
  clients: FakeClient[],
  users: Array<{ client_id: string; user_id: string; name: string; email: string; role: string; status: string; permissions_json: string }> = [],
  extras: {
    products?: FakeProductRow[];
    crmClients?: FakeCrmClientRow[];
  } = {}
) {
  const clientMap = new Map(clients.map((c) => [c.client_id, c]));
  const orders = new Map<string, FakeOrderRow>();
  const locations = new Map<string, FakeLocationRow>();
  const statuses: Array<{ status_id: string; client_id: string; name: string; color: string; order: number }> = [];
  const ticketUpdates: Array<{ clientId: string; ticketId: string; status: string }> = [];
  const activities: Array<{ ticketId: string; clientId: string; attendant: string; description: string }> = [];
  const products: FakeProductRow[] = [...(extras.products ?? [])];
  const crmClients: FakeCrmClientRow[] = [...(extras.crmClients ?? [])];
  const erpSales: FakeErpSaleRow[] = [];
  const erpSaleItems: FakeErpSaleItemRow[] = [];
  const financialEntries: Array<{
    id: number;
    client_id: string;
    source_public_id: string;
    amount_cents: number;
    status: string;
  }> = [];
  const financialSettlements: Array<{
    id: number;
    client_id: string;
    financial_entry_id: number;
    amount_cents: number;
  }> = [];
  const saleOrderEvents: Array<{
    client_id: string;
    sale_order_id: number;
    event_type: string;
    reason: string;
  }> = [];
  const conversations: Array<{
    conversation_id: string;
    client_id: string;
    customer_name: string;
    phone: string;
    status: string;
    last_message: string;
    last_message_from: string;
  }> = [];
  const conversationMessages: Array<{
    message_id: string;
    conversation_id: string;
    client_id: string;
    direction: string;
    sender: string;
    message: string;
  }> = [];
  let erpSaleSeq = 1;

  return {
    orders,
    locations,
    statuses,
    ticketUpdates,
    activities,
    products,
    crmClients,
    erpSales,
    erpSaleItems,
    financialEntries,
    financialSettlements,
    saleOrderEvents,
    conversations,
    conversationMessages,
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

      if (q.startsWith("SELECT company FROM megadesk_domain_clients WHERE client_id = ?")) {
        const row = clientMap.get(String(params[0]));
        return [row && row.company ? [{ company: row.company }] : [], []];
      }

      if (q.startsWith("SELECT company_name, logo_url, whatsapp, phone FROM megadesk_company_settings")) {
        const row = clientMap.get(String(params[0]));
        return [
          row
            ? [
                {
                  company_name: row.company ?? null,
                  logo_url: row.logo_url ?? null,
                  whatsapp: row.whatsapp ?? null,
                  phone: null,
                },
              ]
            : [],
          [],
        ];
      }

      if (q.startsWith("SELECT name FROM megadesk_domain_client_users WHERE client_id = ? AND user_id = ?")) {
        const cid = String(params[0]);
        const uid = String(params[1]);
        const match = users.find((u) => u.client_id === cid && u.user_id === uid);
        return [match ? [{ name: match.name }] : [], []];
      }

      if (q.startsWith("SELECT lat, lng, updated_at FROM megadesk_motoboy_locations WHERE client_id = ? AND motoboy_user_id = ?")) {
        const loc = locations.get(`${String(params[0])}:${String(params[1])}`);
        return [loc ? [{ lat: loc.lat, lng: loc.lng, updated_at: loc.updated_at }] : [], []];
      }

      if (q.includes("WHERE d.tracking_token = ?")) {
        const token = String(params[0]);
        const match = [...orders.values()].find((r) => r.tracking_token === token);
        return [match ? [match] : [], []];
      }

      if (q.startsWith("SELECT user_id, name, email, role, permissions_json FROM megadesk_domain_client_users")) {
        const cid = String(params[0]);
        return [users.filter((u) => u.client_id === cid && u.status === "active"), []];
      }

      if (q.startsWith("SELECT user_id, name FROM megadesk_domain_client_users")) {
        const cid = String(params[0]);
        return [users.filter((u) => u.client_id === cid), []];
      }

      if (q.startsWith("SELECT * FROM megadesk_motoboy_locations WHERE client_id = ?")) {
        const cid = String(params[0]);
        return [[...locations.values()].filter((l) => l.client_id === cid), []];
      }

      if (q.includes("AND d.delivery_status IN ('pending', 'assigned', 'in_route')")) {
        const cid = String(params[0]);
        const rows = [...orders.values()].filter(
          (r) =>
            r.client_id === cid &&
            (r.delivery_status === "pending" ||
              r.delivery_status === "assigned" ||
              r.delivery_status === "in_route")
        );
        return [rows, []];
      }

      // payoutReport (with or without motoboy filter)
      if (q.includes("AND d.delivery_status = 'delivered'") && !q.includes("AND d.motoboy_user_id = ?")) {
        const cid = String(params[0]);
        const start = params[1] instanceof Date ? params[1] : new Date(String(params[1]));
        const end = params[2] instanceof Date ? params[2] : new Date(String(params[2]));
        const rows = [...orders.values()]
          .filter((r) => {
            if (r.client_id !== cid || r.delivery_status !== "delivered") return false;
            const ts = (r.delivered_at ?? r.created_at).getTime();
            return ts >= start.getTime() && ts <= end.getTime();
          })
          .sort((a, b) => (b.delivered_at ?? b.created_at).getTime() - (a.delivered_at ?? a.created_at).getTime());
        return [rows, []];
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
          items_json: params[4] ? String(params[4]) : null,
          items_summary: String(params[5]),
          order_total: Number(params[6]),
          delivery_fee: Number(params[7]),
          payment_method: String(params[8]),
          customer_name: String(params[9]),
          customer_phone: String(params[10]),
          delivery_address: String(params[11]),
          address_type: String(params[12]),
          address_complement: params[13] ? String(params[13]) : null,
          destination_lat: params[14] != null ? Number(params[14]) : null,
          destination_lng: params[15] != null ? Number(params[15]) : null,
          current_lat: null,
          current_lng: null,
          location_updated_at: null,
          motoboy_user_id: params[16] ? String(params[16]) : null,
          route_sequence: Number(params[17]),
          delivery_code: String(params[18]),
          tracking_token: String(params[19]),
          tracking_expires_at: params[20] instanceof Date ? params[20] : null,
          delivery_status: String(params[21]),
          stage_label: String(params[22]),
          erp_sale_public_id: null,
          accepted_at: null,
          started_at: null,
          delivered_at: null,
          created_at: new Date(),
        };
        orders.set(`${row.client_id}:${row.ticket_id}`, row);
        return [{ affectedRows: 1 }, []];
      }

      if (q.startsWith("SELECT id, public_id, name, sku, category, sale_price_cents FROM erp_products")) {
        const cid = String(params[0]);
        return [products.filter((p) => p.client_id === cid && p.active === 1), []];
      }

      if (q.startsWith("SELECT id, public_id, name, sku, sale_price_cents FROM erp_products WHERE client_id = ? AND public_id = ?")) {
        const match = products.find((p) => p.client_id === String(params[0]) && p.public_id === String(params[1]));
        return [match ? [match] : [], []];
      }

      if (q.startsWith("SELECT id, public_id, name, sku, sale_price_cents FROM erp_products WHERE client_id = ? AND active = 1 AND LOWER(name) = LOWER(?)")) {
        const match = products.find(
          (p) => p.client_id === String(params[0]) && p.active === 1 && p.name.toLowerCase() === String(params[1]).toLowerCase()
        );
        return [match ? [match] : [], []];
      }

      if (q.startsWith("SELECT next_number FROM erp_sale_document_sequences")) {
        return [[{ next_number: erpSaleSeq }], []];
      }

      if (q.startsWith("UPDATE erp_sale_document_sequences SET next_number = ?")) {
        erpSaleSeq = Number(params[0]);
        return [{ affectedRows: 1 }, []];
      }

      if (q.startsWith("INSERT INTO erp_sale_orders")) {
        const newId = erpSales.length + 1;
        erpSales.push({
          id: newId,
          public_id: String(params[0]),
          client_id: String(params[1]),
          order_number: String(params[2]),
          crm_client_id: String(params[4]),
          customer_name_snapshot: String(params[5]),
          status: "confirmed",
          commercial_status: "active",
          current_stage: "confirmed",
          freight_cents: Number(params[10]),
          payment_method_snapshot: String(params[11]),
          notes: String(params[12]),
          subtotal_cents: Number(params[13]),
          total_cents: Number(params[14]),
        });
        return [{ insertId: newId, affectedRows: 1 }, []];
      }

      if (q.startsWith("INSERT INTO erp_sale_order_items")) {
        erpSaleItems.push({
          sale_order_id: Number(params[1]),
          product_id: Number(params[2]),
          product_name_snapshot: String(params[3]),
          quantity: String(params[5]),
          unit_price_cents: Number(params[6]),
          line_total_cents: Number(params[7]),
        });
        return [{ affectedRows: 1 }, []];
      }

      if (q.startsWith("UPDATE erp_sale_orders SET status = 'fulfilled'")) {
        const cid = String(params[1]);
        const pubId = String(params[2]);
        const sale = erpSales.find((s) => s.client_id === cid && s.public_id === pubId);
        if (sale) {
          sale.status = "fulfilled";
          sale.commercial_status = "completed";
          sale.current_stage = "completed";
        }
        return [{ affectedRows: sale ? 1 : 0 }, []];
      }

      if (q.startsWith("UPDATE erp_sale_orders SET status = 'cancelled'")) {
        const cid = String(params[1]);
        const pubId = String(params[2]);
        const sale = erpSales.find((s) => s.client_id === cid && s.public_id === pubId);
        if (sale) {
          sale.status = "cancelled";
          sale.commercial_status = "cancelled";
        }
        return [{ affectedRows: sale ? 1 : 0 }, []];
      }

      if (q.startsWith("SELECT id, order_number, crm_client_id, customer_name_snapshot, total_cents FROM erp_sale_orders")) {
        const cid = String(params[0]);
        const pubId = String(params[1]);
        const sale = erpSales.find((s) => s.client_id === cid && s.public_id === pubId);
        return [sale ? [sale] : [], []];
      }

      if (q.startsWith("SELECT id FROM erp_financial_categories")) {
        return [[{ id: 1 }], []];
      }

      if (q.startsWith("SELECT id, current_balance_cents FROM erp_financial_accounts")) {
        return [[{ id: 1, current_balance_cents: 0 }], []];
      }

      if (q.startsWith("SELECT id, amount_cents, status FROM erp_financial_entries")) {
        const cid = String(params[0]);
        const sourcePubId = String(params[1]);
        const entry = financialEntries.find(
          (e) => e.client_id === cid && e.source_public_id === sourcePubId && e.status !== "cancelled"
        );
        return [entry ? [entry] : [], []];
      }

      if (q.startsWith("INSERT INTO erp_financial_entries")) {
        const newId = financialEntries.length + 1;
        financialEntries.push({
          id: newId,
          client_id: String(params[1]),
          source_public_id: String(params[9]),
          amount_cents: Number(params[4]),
          status: "open",
        });
        return [{ insertId: newId, affectedRows: 1 }, []];
      }

      if (q.startsWith("SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents FROM erp_financial_settlements")) {
        const cid = String(params[0]);
        const entryId = Number(params[1]);
        const paid = financialSettlements
          .filter((s) => s.client_id === cid && s.financial_entry_id === entryId)
          .reduce((acc, s) => acc + s.amount_cents, 0);
        return [[{ paid_cents: paid }], []];
      }

      if (q.startsWith("INSERT INTO erp_financial_settlements")) {
        const newId = financialSettlements.length + 1;
        financialSettlements.push({
          id: newId,
          client_id: String(params[1]),
          financial_entry_id: Number(params[2]),
          amount_cents: Number(params[5]),
        });
        return [{ insertId: newId, affectedRows: 1 }, []];
      }

      if (q.startsWith("UPDATE erp_financial_entries SET status = 'settled'")) {
        const cid = String(params[1]);
        const entryId = Number(params[2]);
        const entry = financialEntries.find((e) => e.client_id === cid && e.id === entryId);
        if (entry) entry.status = "settled";
        return [{ affectedRows: entry ? 1 : 0 }, []];
      }

      if (q.startsWith("INSERT INTO erp_sale_order_events")) {
        saleOrderEvents.push({
          client_id: String(params[1]),
          sale_order_id: Number(params[2]),
          event_type: "payment_registered",
          reason: String(params[3]),
        });
        return [{ affectedRows: 1 }, []];
      }

      if (q.startsWith("SELECT conversation_id, status FROM megadesk_domain_conversations")) {
        const cid = String(params[0]);
        const tail = String(params[1]).replace(/^%|%$/g, "");
        const match = conversations.find(
          (c) => c.client_id === cid && c.phone.replace(/\D/g, "").endsWith(tail)
        );
        return [match ? [match] : [], []];
      }

      if (q.startsWith("INSERT INTO megadesk_domain_conversations (")) {
        conversations.push({
          conversation_id: String(params[0]),
          client_id: String(params[1]),
          customer_name: String(params[3]),
          phone: String(params[4]),
          status: "open",
          last_message: String(params[6]),
          last_message_from: "bot",
        });
        return [{ affectedRows: 1 }, []];
      }

      if (q.startsWith("UPDATE megadesk_domain_conversations SET last_message = ?")) {
        const conv = conversations.find(
          (c) => c.conversation_id === String(params[2]) && c.client_id === String(params[3])
        );
        if (conv) {
          conv.last_message = String(params[0]);
          conv.last_message_from = "bot";
        }
        return [{ affectedRows: conv ? 1 : 0 }, []];
      }

      if (q.startsWith("INSERT INTO megadesk_domain_conversations_messages")) {
        conversationMessages.push({
          message_id: String(params[0]),
          conversation_id: String(params[1]),
          client_id: String(params[2]),
          direction: "outbound",
          sender: "bot",
          message: String(params[6]),
        });
        return [{ affectedRows: 1 }, []];
      }

      if (q.startsWith("UPDATE megadesk_delivery_orders SET erp_sale_public_id = ?")) {
        const existing = orders.get(`${String(params[1])}:${String(params[2])}`);
        if (existing) existing.erp_sale_public_id = String(params[0]);
        return [{ affectedRows: existing ? 1 : 0 }, []];
      }

      if (q.startsWith("SELECT crm_client_id, company_name, responsible_name, phone, whatsapp, email, address, city, state, cep FROM megadesk_crm_clients")) {
        const cid = String(params[0]);
        const rest = params.slice(1).map((p) => String(p).replace(/^%|%$/g, "").toLowerCase());
        const found = crmClients.find((c) => {
          if (c.client_id !== cid || c.lifecycle_state !== "active") return false;
          const pDigits = (c.phone || "").replace(/\D/g, "");
          const wDigits = (c.whatsapp || "").replace(/\D/g, "");
          const cpfDigits = (c.cpf_cnpj || "").replace(/\D/g, "");
          const email = (c.email || "").toLowerCase();
          return rest.some(
            (term) =>
              (term && pDigits.endsWith(term)) ||
              (term && wDigits.endsWith(term)) ||
              (term && email === term) ||
              (term && cpfDigits === term)
          );
        });
        return [found ? [found] : [], []];
      }

      if (q.startsWith("INSERT INTO megadesk_crm_clients")) {
        crmClients.push({
          crm_client_id: String(params[0]),
          client_id: String(params[1]),
          company_name: String(params[2]),
          responsible_name: String(params[3]),
          cpf_cnpj: params[4] ? String(params[4]) : null,
          phone: params[5] ? String(params[5]) : null,
          whatsapp: params[6] ? String(params[6]) : null,
          email: params[7] ? String(params[7]) : null,
          address: String(params[8] || ""),
          city: "",
          state: "",
          cep: "",
          lifecycle_state: "active",
        });
        return [{ affectedRows: 1 }, []];
      }

      if (q.startsWith("UPDATE megadesk_delivery_orders SET motoboy_user_id = ?, delivery_status = ?, stage_label = ?, accepted_at =")) {
        const existing = orders.get(`${String(params[3])}:${String(params[4])}`);
        if (existing) {
          existing.motoboy_user_id = String(params[0]);
          existing.delivery_status = String(params[1]);
          existing.stage_label = String(params[2]);
          existing.accepted_at = existing.accepted_at ?? new Date();
        }
        return [{ affectedRows: existing ? 1 : 0 }, []];
      }

      if (q.startsWith("UPDATE megadesk_delivery_orders SET delivery_status = ?, stage_label = ?")) {
        const existing = orders.get(`${String(params[3])}:${String(params[4])}`);
        if (existing) {
          existing.delivery_status = String(params[0]);
          existing.stage_label = String(params[1]);
          if (existing.delivery_status === "delivered") {
            existing.delivered_at = existing.delivered_at ?? new Date();
          }
        }
        return [{ affectedRows: existing ? 1 : 0 }, []];
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
          description: String(params[3]),
          attendant: String(params[4]),
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

  it("liveOverview retorna motoboys, GPS online, pedidos ativos e fila sem atribuição (bloqueando outros nichos)", async () => {
    const pool = createFakeDeliveryPool(
      [
        { client_id: "tenant-rest", niche_profile: "restaurante", enabled_modules: null },
        { client_id: "tenant-ecom", niche_profile: "ecommerce", enabled_modules: null },
      ],
      [
        {
          client_id: "tenant-rest",
          user_id: "mb-1",
          name: "Carlos Moto",
          email: "carlos@rest.com",
          role: "agent",
          status: "active",
          permissions_json: JSON.stringify(["motoboy"]),
        },
        {
          client_id: "tenant-rest",
          user_id: "mb-2",
          name: "Lucas Moto",
          email: "lucas@rest.com",
          role: "agent",
          status: "active",
          permissions_json: JSON.stringify(["motoboy"]),
        },
      ]
    );

    await expect(getDeliveryLiveOverview("tenant-ecom", pool)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    let seq = 0;
    const createTicketMock = vi.fn().mockImplementation(async () => ({ id: `t-live-${++seq}`, number: 500 + seq }));
    const o1 = await createRestaurantOrderWithTicket(
      {
        clientId: "tenant-rest",
        customerId: "c1",
        customerName: "Ana",
        customerPhone: "5541999990001",
        actor: { userId: "admin", userName: "Admin" },
        orderSource: "site",
        itemsSummary: "1x Pizza",
        orderTotal: 70,
        deliveryFee: 10,
        paymentMethod: "Pago online",
        deliveryAddress: "Rua A, 10",
        destinationLat: -25.43,
        destinationLng: -49.27,
      },
      { pool, createTicket: createTicketMock as any }
    );
    const o2 = await createRestaurantOrderWithTicket(
      {
        clientId: "tenant-rest",
        customerId: "c2",
        customerName: "Bruno",
        customerPhone: "5541999990002",
        actor: { userId: "admin", userName: "Admin" },
        orderSource: "whatsapp",
        itemsSummary: "1x Burger",
        orderTotal: 45,
        deliveryFee: 8,
        paymentMethod: "Pix",
        deliveryAddress: "Rua B, 20",
      },
      { pool, createTicket: createTicketMock as any }
    );
    const oPending = await createRestaurantOrderWithTicket(
      {
        clientId: "tenant-rest",
        customerId: "c3",
        customerName: "Carla",
        customerPhone: "5541999990003",
        actor: { userId: "admin", userName: "Admin" },
        orderSource: "manual",
        itemsSummary: "2x Esfiha",
        orderTotal: 35,
        deliveryFee: 7,
        paymentMethod: "Dinheiro",
        deliveryAddress: "Rua C, 30",
      },
      { pool, createTicket: createTicketMock as any }
    );

    await assignMotoboyToOrder(
      { clientId: "tenant-rest", ticketId: o1.ticket.id, motoboyUserId: "mb-1", routeSequence: 1 },
      pool
    );
    await assignMotoboyToOrder(
      { clientId: "tenant-rest", ticketId: o2.ticket.id, motoboyUserId: "mb-1", routeSequence: 2 },
      pool
    );
    await startDeliveryRoute(
      { clientId: "tenant-rest", ticketId: o1.ticket.id, actorUserId: "mb-1" },
      { pool, sendWhatsApp: vi.fn().mockResolvedValue({ ok: true }) }
    );
    await updateMotoboyLocation(
      {
        clientId: "tenant-rest",
        motoboyUserId: "mb-1",
        lat: -25.429,
        lng: -49.271,
        speed: 10,
        activeOrderId: o1.deliveryOrder.id,
      },
      pool
    );

    const overview = await getDeliveryLiveOverview("tenant-rest", pool);
    expect(overview.motoboys).toHaveLength(2);
    const mb1 = overview.motoboys.find((m) => m.userId === "mb-1");
    const mb2 = overview.motoboys.find((m) => m.userId === "mb-2");

    expect(mb1?.status).toBe("in_route");
    expect(mb1?.isOnline).toBe(true);
    expect(mb1?.location?.lat).toBe(-25.429);
    expect(mb1?.activeOrder?.ticketId).toBe(o1.ticket.id);
    expect(mb1?.queuedCount).toBe(1);

    expect(mb2?.status).toBe("available");
    expect(mb2?.isOnline).toBe(false);

    expect(overview.activeOrders).toHaveLength(2);
    expect(overview.unassignedOrders.map((u) => u.ticketId)).toEqual([oPending.ticket.id]);
  });

  it("payoutReport filtra por motoboy e período e calcula totalPayout, averageFee e byMotoboy", async () => {
    const pool = createFakeDeliveryPool(
      [
        { client_id: "tenant-rest", niche_profile: "restaurante", enabled_modules: null },
        { client_id: "tenant-serv", niche_profile: "prestacao_servicos", enabled_modules: null },
      ],
      [
        {
          client_id: "tenant-rest",
          user_id: "mb-1",
          name: "Carlos Moto",
          email: "carlos@rest.com",
          role: "agent",
          status: "active",
          permissions_json: JSON.stringify(["motoboy"]),
        },
        {
          client_id: "tenant-rest",
          user_id: "mb-2",
          name: "Lucas Moto",
          email: "lucas@rest.com",
          role: "agent",
          status: "active",
          permissions_json: JSON.stringify(["motoboy"]),
        },
      ]
    );

    await expect(
      getDeliveryPayoutReport({ clientId: "tenant-serv", preset: "today" }, pool)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    let seq = 0;
    const createTicketMock = vi.fn().mockImplementation(async () => ({ id: `t-pay-${++seq}`, number: 600 + seq }));
    const d1 = await createRestaurantOrderWithTicket(
      {
        clientId: "tenant-rest",
        customerId: "c1",
        customerName: "Cliente 1",
        customerPhone: "5541999990001",
        actor: { userId: "admin", userName: "Admin" },
        orderSource: "site",
        itemsSummary: "Combo 1",
        orderTotal: 80,
        deliveryFee: 10,
        paymentMethod: "Pix",
        deliveryAddress: "Rua 1",
      },
      { pool, createTicket: createTicketMock as any }
    );
    const d2 = await createRestaurantOrderWithTicket(
      {
        clientId: "tenant-rest",
        customerId: "c2",
        customerName: "Cliente 2",
        customerPhone: "5541999990002",
        actor: { userId: "admin", userName: "Admin" },
        orderSource: "site",
        itemsSummary: "Combo 2",
        orderTotal: 100,
        deliveryFee: 14,
        paymentMethod: "Pago online",
        deliveryAddress: "Rua 2",
      },
      { pool, createTicket: createTicketMock as any }
    );
    const d3 = await createRestaurantOrderWithTicket(
      {
        clientId: "tenant-rest",
        customerId: "c3",
        customerName: "Cliente 3",
        customerPhone: "5541999990003",
        actor: { userId: "admin", userName: "Admin" },
        orderSource: "whatsapp",
        itemsSummary: "Combo 3",
        orderTotal: 60,
        deliveryFee: 12,
        paymentMethod: "Cartão",
        deliveryAddress: "Rua 3",
      },
      { pool, createTicket: createTicketMock as any }
    );

    await assignMotoboyToOrder({ clientId: "tenant-rest", ticketId: d1.ticket.id, motoboyUserId: "mb-1" }, pool);
    await assignMotoboyToOrder({ clientId: "tenant-rest", ticketId: d2.ticket.id, motoboyUserId: "mb-1" }, pool);
    await assignMotoboyToOrder({ clientId: "tenant-rest", ticketId: d3.ticket.id, motoboyUserId: "mb-2" }, pool);

    await completeDeliveryOrder(
      { clientId: "tenant-rest", ticketId: d1.ticket.id, deliveryCode: d1.deliveryOrder.deliveryCode, motoboyUserId: "mb-1" },
      pool
    );
    await completeDeliveryOrder(
      { clientId: "tenant-rest", ticketId: d2.ticket.id, deliveryCode: d2.deliveryOrder.deliveryCode, motoboyUserId: "mb-1" },
      pool
    );
    await completeDeliveryOrder(
      { clientId: "tenant-rest", ticketId: d3.ticket.id, deliveryCode: d3.deliveryOrder.deliveryCode, motoboyUserId: "mb-2" },
      pool
    );

    const allReport = await getDeliveryPayoutReport({ clientId: "tenant-rest", preset: "today" }, pool);
    expect(allReport.summary).toEqual({
      totalDeliveries: 3,
      totalPayout: 36,
      averageFee: 12,
    });
    expect(allReport.byMotoboy).toEqual([
      { motoboyUserId: "mb-1", motoboyName: "Carlos Moto", deliveriesCount: 2, totalAmount: 24 },
      { motoboyUserId: "mb-2", motoboyName: "Lucas Moto", deliveriesCount: 1, totalAmount: 12 },
    ]);

    const mb1Report = await getDeliveryPayoutReport(
      { clientId: "tenant-rest", motoboyUserId: "mb-1", preset: "today" },
      pool
    );
    expect(mb1Report.summary).toEqual({
      totalDeliveries: 2,
      totalPayout: 24,
      averageFee: 12,
    });
    expect(mb1Report.deliveries).toHaveLength(2);
  });

  it("publicTrackByToken aplica whitelist estrita, exibe GPS apenas em in_route, oculta dados após entrega e expira após 30 min", async () => {
    const pool = createFakeDeliveryPool(
      [
        {
          client_id: "tenant-rest-secret-id",
          niche_profile: "restaurante",
          enabled_modules: null,
          company: "Pizzaria Bella Napoli",
          logo_url: "https://cdn.example.com/bella.png",
          whatsapp: "5541999998888",
        },
        {
          client_id: "tenant-ecom",
          niche_profile: "ecommerce",
          enabled_modules: null,
          company: "Loja Virtual",
        },
      ],
      [
        {
          client_id: "tenant-rest-secret-id",
          user_id: "motoboy-secret-uid-42",
          name: "Carlos Eduardo Sobrenome",
          email: "carlos@bella.com",
          role: "motoboy",
          status: "active",
          permissions_json: JSON.stringify(["motoboy"]),
        },
      ]
    );

    const createTicketMock = vi.fn().mockResolvedValue({ id: "ticket-pub-1", number: 777 });
    const created = await createRestaurantOrderWithTicket(
      {
        clientId: "tenant-rest-secret-id",
        customerId: "crm-secret-1",
        customerName: "Cliente Privado",
        customerPhone: "5541977776666",
        actor: { userId: "admin", userName: "Admin" },
        orderSource: "whatsapp",
        itemsSummary: "1x Pizza Calabresa Grande, 1x Refrigerante 2L",
        orderTotal: 89.9,
        deliveryFee: 12.0,
        paymentMethod: "Pix",
        deliveryAddress: "Rua das Palmeiras, 450, Batel, CPF 123.456.789-00",
        destinationLat: -25.441,
        destinationLng: -49.285,
      },
      { pool, createTicket: createTicketMock as any }
    );

    await assignMotoboyToOrder(
      {
        clientId: "tenant-rest-secret-id",
        ticketId: created.ticket.id,
        motoboyUserId: "motoboy-secret-uid-42",
        routeSequence: 1,
      },
      pool
    );

    // 1) Antes de sair para rota (assigned): GPS deve ficar oculto, mas primeiro nome e código aparecem
    const assignedTrack = await getPublicDeliveryTrackByToken(created.deliveryOrder.trackingToken, pool);
    expect(assignedTrack.state).toBe("active");
    expect(assignedTrack.restaurant?.name).toBe("Pizzaria Bella Napoli");
    expect(assignedTrack.order?.deliveryStatus).toBe("assigned");
    expect(assignedTrack.order?.motoboyFirstName).toBe("Carlos");
    expect(assignedTrack.order?.motoboyLocation).toBeNull();
    expect(assignedTrack.order?.deliveryCode).toBe(created.deliveryOrder.deliveryCode);

    // 2) Em rota com GPS ativo: libera coordenadas, ETA, e ZERO vazamento de dados internos
    await startDeliveryRoute(
      {
        clientId: "tenant-rest-secret-id",
        ticketId: created.ticket.id,
        actorUserId: "motoboy-secret-uid-42",
      },
      { pool, sendWhatsApp: vi.fn().mockResolvedValue({ ok: true }) }
    );
    await updateMotoboyLocation(
      {
        clientId: "tenant-rest-secret-id",
        motoboyUserId: "motoboy-secret-uid-42",
        lat: -25.432,
        lng: -49.275,
        speed: 9.5,
        activeOrderId: created.deliveryOrder.id,
      },
      pool
    );

    const inRouteTrack = await getPublicDeliveryTrackByToken(created.deliveryOrder.trackingToken, pool);
    expect(inRouteTrack.state).toBe("active");
    expect(inRouteTrack.order?.deliveryStatus).toBe("in_route");
    expect(inRouteTrack.order?.motoboyFirstName).toBe("Carlos");
    expect(inRouteTrack.order?.motoboyLocation?.lat).toBe(-25.432);
    expect(inRouteTrack.order?.motoboyLocation?.lng).toBe(-49.275);
    expect(inRouteTrack.order?.estimatedMinutes).toBeGreaterThanOrEqual(2);

    const serialized = JSON.stringify(inRouteTrack);
    expect(serialized).not.toContain("tenant-rest-secret-id");
    expect(serialized).not.toContain("motoboy-secret-uid-42");
    expect(serialized).not.toContain("Sobrenome");
    expect(serialized).not.toContain("5541977776666");
    expect(serialized).not.toContain("123.456.789-00");
    expect(serialized).not.toContain(created.deliveryOrder.trackingToken);

    // 3) Concluída há poucos minutos: estado delivered_recent SEM GPS e SEM código de 4 dígitos
    await completeDeliveryOrder(
      {
        clientId: "tenant-rest-secret-id",
        ticketId: created.ticket.id,
        deliveryCode: created.deliveryOrder.deliveryCode,
        motoboyUserId: "motoboy-secret-uid-42",
      },
      pool
    );

    const recentDelivered = await getPublicDeliveryTrackByToken(
      created.deliveryOrder.trackingToken,
      pool,
      Date.now() + 5 * 60 * 1000
    );
    expect(recentDelivered.state).toBe("delivered_recent");
    expect(recentDelivered.order?.motoboyLocation).toBeNull();
    expect(recentDelivered.order?.deliveryCode).toBeNull();

    // 4) Após 31 minutos (expirado): state = expired e order = null
    const expiredTrack = await getPublicDeliveryTrackByToken(
      created.deliveryOrder.trackingToken,
      pool,
      Date.now() + 31 * 60 * 1000
    );
    expect(expiredTrack.state).toBe("expired");
    expect(expiredTrack.order).toBeNull();

    // 5) Token inválido/curto retorna not_found
    const invalidTrack = await getPublicDeliveryTrackByToken("token-curto", pool);
    expect(invalidTrack.state).toBe("not_found");
    expect(invalidTrack.order).toBeNull();

    // 6) Garantia estática: página pública /r/:token nunca menciona MegaDesk
    const publicPageSource = readFileSync(
      path.resolve(process.cwd(), "client/src/pages/PublicDeliveryTrackingPage.tsx"),
      "utf8"
    );
    expect(publicPageSource.toLowerCase()).not.toContain("megadesk");
  });

  it("criação com itens do cardápio sincroniza ERP > Vendas, auto-preenche cliente do site e registra todo ciclo no Histórico do Ticket", async () => {
    // 1) Verifica que o preset restaurante sempre libera Rastreamento (inclusive em listas salvas antes do fix)
    expect(resolveTenantEnabledModules("restaurante", null)).toContain("rastreamento");
    expect(resolveTenantEnabledModules("restaurante", ["atendimento", "chamados"])).toContain("rastreamento");

    const pool = createFakeDeliveryPool(
      [{ client_id: "tenant-rest", niche_profile: "restaurante", enabled_modules: null, company: "Burger House" }],
      [
        {
          client_id: "tenant-rest",
          user_id: "mb-1",
          name: "Marcos Motoboy",
          email: "marcos@burger.com",
          role: "agent",
          status: "active",
          permissions_json: JSON.stringify(["motoboy"]),
        },
      ],
      {
        products: [
          {
            id: 101,
            public_id: "11111111-1111-4111-8111-111111111111",
            client_id: "tenant-rest",
            name: "X-Bacon Artesanal",
            sku: "BURGER-01",
            category: "Lanches",
            sale_price_cents: 3500,
            active: 1,
          },
          {
            id: 102,
            public_id: "22222222-2222-4222-8222-222222222222",
            client_id: "tenant-rest",
            name: "Coca-Cola 2L",
            sku: "BEBIDA-01",
            category: "Bebidas",
            sale_price_cents: 1400,
            active: 1,
          },
        ],
        crmClients: [
          {
            crm_client_id: "crm-site-existing-1",
            client_id: "tenant-rest",
            company_name: "Fernanda Oliveira",
            responsible_name: "Fernanda Oliveira",
            cpf_cnpj: "12345678901",
            phone: "41998887766",
            whatsapp: "5541998887766",
            email: "fernanda@exemplo.com",
            address: "Av. Batel, 1500",
            city: "Curitiba",
            state: "PR",
            cep: "80420-090",
            lifecycle_state: "active",
          },
        ],
      }
    );

    const createTicketMock = vi.fn().mockResolvedValue({ id: "ticket-e2e-1", number: 7 });

    // 2) Pedido vindo do Site omitindo nome e endereço -> auto-preenche do CRM + resolve preços do ERP + cria venda ERP
    const ingested = await ingestExternalDeliveryOrder(
      {
        clientId: "tenant-rest",
        orderSource: "site",
        customerPhone: "(41) 99888-7766",
        paymentMethod: "Pago online",
        deliveryFee: 10,
        items: [
          { productPublicId: "11111111-1111-4111-8111-111111111111", name: "X-Bacon Artesanal", quantity: 2 },
          { name: "Coca-Cola 2L", quantity: 1 },
        ],
      },
      { pool, createTicket: createTicketMock as any }
    );

    expect(ingested.customer.reusedExisting).toBe(true);
    expect(ingested.customer.crmClientId).toBe("crm-site-existing-1");
    expect(ingested.deliveryOrder.customerName).toBe("Fernanda Oliveira");
    expect(ingested.deliveryOrder.deliveryAddress).toContain("Av. Batel, 1500");
    // 2x 35 + 1x 14 + 10 taxa = 94
    expect(ingested.deliveryOrder.orderTotal).toBe(94);
    expect(ingested.deliveryOrder.items).toHaveLength(2);
    expect(ingested.deliveryOrder.stageLabel).toBe("Novo Pedido");
    expect(ingested.deliveryOrder.erpSalePublicId).toBeTruthy();

    // Venda sincronizada automaticamente em ERP > Vendas
    expect(pool.erpSales).toHaveLength(1);
    expect(pool.erpSales[0].crm_client_id).toBe("crm-site-existing-1");
    expect(pool.erpSales[0].subtotal_cents).toBe(8400);
    expect(pool.erpSales[0].freight_cents).toBe(1000);
    expect(pool.erpSales[0].total_cents).toBe(9400);
    expect(pool.erpSales[0].status).toBe("confirmed");
    expect(pool.erpSaleItems).toHaveLength(2);

    // 3) Automação total de etapas + sincronização com status do ticket + Histórico do Ticket
    // Cozinha inicia preparo -> Em Preparo (ticket = in_progress)
    const prep = await updateDeliveryStage(
      {
        clientId: "tenant-rest",
        ticketId: "ticket-e2e-1",
        stageLabel: "Em Preparo",
        actorUserId: "chef-1",
        actorUserName: "Cozinha",
      },
      pool
    );
    expect(prep.stageLabel).toBe("Em Preparo");

    // Motoboy aceita corrida -> Pronto p/ Motoboy (ticket = waiting)
    const accepted = await acceptDeliveryOrder(
      {
        clientId: "tenant-rest",
        ticketId: "ticket-e2e-1",
        motoboyUserId: "mb-1",
        actorUserName: "Marcos Motoboy",
      },
      pool
    );
    expect(accepted.stageLabel).toBe("Pronto p/ Motoboy");
    expect(accepted.deliveryStatus).toBe("assigned");
    expect(accepted.acceptedAt).toBeTruthy();

    // Motoboy inicia rota -> Em Rota com Motoboy (ticket = in_progress) + WhatsApp enviado
    const started = await startDeliveryRoute(
      {
        clientId: "tenant-rest",
        ticketId: "ticket-e2e-1",
        actorUserId: "mb-1",
        actorUserName: "Marcos Motoboy",
      },
      { pool, sendWhatsApp: vi.fn().mockResolvedValue({ ok: true }) }
    );
    expect(started.deliveryOrder.stageLabel).toBe("Em Rota com Motoboy");
    expect(started.whatsappSent).toBe(true);

    // Motoboy finaliza com código 4D -> Entregue (ticket = closed) + Venda ERP concluída!
    const done = await completeDeliveryOrder(
      {
        clientId: "tenant-rest",
        ticketId: "ticket-e2e-1",
        deliveryCode: ingested.deliveryOrder.deliveryCode,
        motoboyUserId: "mb-1",
        actorUserName: "Marcos Motoboy",
      },
      pool
    );
    expect(done.deliveryOrder.stageLabel).toBe("Entregue");
    expect(done.deliveryOrder.deliveryStatus).toBe("delivered");
    expect(pool.erpSales[0].status).toBe("fulfilled");
    expect(pool.erpSales[0].commercial_status).toBe("completed");

    // Verifica sequência de status do ticket sincronizada
    expect(pool.ticketUpdates.filter((u) => u.ticketId === "ticket-e2e-1").map((u) => u.status)).toEqual([
      "in_progress",
      "waiting",
      "in_progress",
      "closed",
    ]);

    // Verifica eventos completos gravados no Histórico do Ticket
    const historyDescriptions = pool.activities
      .filter((a) => a.ticketId === "ticket-e2e-1")
      .map((a) => a.description);
    expect(historyDescriptions.length).toBeGreaterThanOrEqual(5);
    expect(historyDescriptions[0]).toContain("origem: Site");
    expect(historyDescriptions.some((d) => d.includes("Em Preparo"))).toBe(true);
    expect(historyDescriptions.some((d) => d.includes("aceitou a corrida"))).toBe(true);
    expect(historyDescriptions.some((d) => d.includes("iniciou a rota"))).toBe(true);
    expect(historyDescriptions.some((d) => d.includes("finalizou a entrega (Entregue)"))).toBe(true);
  });

  it("sincroniza mensagem automática no chat Atendimento, quita venda ERP (online e na entrega) e garante mapas sem API Key", async () => {
    const pool = createFakeDeliveryPool(
      [{ client_id: "tenant-rest", niche_profile: "restaurante", enabled_modules: null, company: "Pizzaria Central" }],
      [
        {
          client_id: "tenant-rest",
          user_id: "mb-1",
          name: "Pedro Motoboy",
          email: "pedro@pizza.com",
          role: "agent",
          status: "active",
          permissions_json: JSON.stringify(["motoboy"]),
        },
      ],
      {
        products: [
          {
            id: 201,
            public_id: "33333333-3333-4333-8333-333333333333",
            client_id: "tenant-rest",
            name: "Pizza Margherita",
            sku: "PIZ-01",
            category: "Pizzas",
            sale_price_cents: 6000,
            active: 1,
          },
        ],
        crmClients: [
          {
            crm_client_id: "crm-cli-1",
            client_id: "tenant-rest",
            company_name: "Lucas Andrade",
            responsible_name: "Lucas Andrade",
            cpf_cnpj: null,
            phone: "41991112222",
            whatsapp: "5541991112222",
            email: "lucas@teste.com",
            address: "Rua XV, 100",
            city: "Curitiba",
            state: "PR",
            cep: "80020-310",
            lifecycle_state: "active",
          },
        ],
      }
    );

    let seq = 0;
    const createTicketMock = vi.fn().mockImplementation(async () => ({ id: `t-fin-${++seq}`, number: 800 + seq }));

    // Caso A: Pedido pago online no Site -> já nasce QUITADO (Recebido = Total, status = settled)
    const onlineOrder = await ingestExternalDeliveryOrder(
      {
        clientId: "tenant-rest",
        orderSource: "site",
        customerPhone: "41991112222",
        paymentMethod: "Pago online (Cartão)",
        deliveryFee: 10,
        items: [{ productPublicId: "33333333-3333-4333-8333-333333333333", name: "Pizza Margherita", quantity: 1 }],
      },
      { pool, createTicket: createTicketMock as any }
    );

    expect(pool.financialEntries).toHaveLength(1);
    expect(pool.financialEntries[0].status).toBe("settled");
    expect(pool.financialSettlements).toHaveLength(1);
    expect(pool.financialSettlements[0].amount_cents).toBe(7000);
    expect(pool.saleOrderEvents).toHaveLength(1);

    // Caso B: Pedido com pagamento na entrega (WhatsApp) -> nasce open (pendente) e quita ao concluir entrega!
    const codOrder = await ingestExternalDeliveryOrder(
      {
        clientId: "tenant-rest",
        orderSource: "whatsapp",
        customerPhone: "41991112222",
        paymentMethod: "Cartão na entrega",
        deliveryFee: 12,
        items: [{ productPublicId: "33333333-3333-4333-8333-333333333333", name: "Pizza Margherita", quantity: 2 }],
      },
      { pool, createTicket: createTicketMock as any }
    );

    expect(pool.financialEntries).toHaveLength(2);
    expect(pool.financialEntries[1].status).toBe("open");
    expect(pool.financialSettlements).toHaveLength(1); // ainda não liquidado

    // Atribui motoboy e inicia rota -> grava mensagem automática no chat Atendimento > Cliente X
    await assignMotoboyToOrder(
      { clientId: "tenant-rest", ticketId: codOrder.ticket.id, motoboyUserId: "mb-1" },
      pool
    );
    await startDeliveryRoute(
      { clientId: "tenant-rest", ticketId: codOrder.ticket.id, actorUserId: "mb-1", actorUserName: "Pedro Motoboy" },
      { pool, sendWhatsApp: vi.fn().mockResolvedValue({ key: { id: "evo-msg-123" } }) }
    );

    expect(pool.conversations).toHaveLength(1);
    expect(pool.conversationMessages).toHaveLength(1);
    expect(pool.conversationMessages[0].direction).toBe("outbound");
    expect(pool.conversationMessages[0].message).toContain(codOrder.deliveryOrder.deliveryCode);
    expect(pool.conversationMessages[0].message).toContain(`/r/${codOrder.deliveryOrder.trackingToken}`);
    expect(pool.conversations[0].last_message).toContain("saiu para entrega");

    // Motoboy conclui entrega com código 4D -> liquida automaticamente no ERP > Vendas!
    await completeDeliveryOrder(
      {
        clientId: "tenant-rest",
        ticketId: codOrder.ticket.id,
        deliveryCode: codOrder.deliveryOrder.deliveryCode,
        motoboyUserId: "mb-1",
        actorUserName: "Pedro Motoboy",
      },
      pool
    );

    expect(pool.financialEntries[1].status).toBe("settled");
    expect(pool.financialSettlements).toHaveLength(2);
    expect(pool.financialSettlements[1].amount_cents).toBe(13200); // 2x 60 + 12 taxa = R$ 132,00
    expect(pool.saleOrderEvents).toHaveLength(2);

    // Garantia estática: nenhum mapa usa CARTO com API KEY REQUIRED
    for (const filePath of [
      "client/src/pages/PublicDeliveryTrackingPage.tsx",
      "client/src/pages/RestaurantTrackingWorkspace.tsx",
    ]) {
      const src = readFileSync(path.resolve(process.cwd(), filePath), "utf8");
      expect(src).not.toContain("carto.com/basemaps");
      expect(src).not.toContain("cartocdn.com");
      expect(src).not.toContain("apikey");
      expect(src).toContain("tile.openstreetmap.org");
    }
    expect(onlineOrder.deliveryOrder.erpSalePublicId).toBeTruthy();
  });
});
