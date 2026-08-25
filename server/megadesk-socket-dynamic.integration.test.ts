import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Request, Response } from "express";
import {
  io as createClient,
  type Socket as ClientSocket,
} from "socket.io-client";
import { getPool } from "./db";
import {
  createOperationalSession,
  MEGADESK_SESSION_COOKIE,
  MysqlOperationalSessionRepository,
  revokeOperationalSession,
} from "./_core/megadesk-session";
import {
  emitMessageStatus,
  getSocketIO,
  initWhatsAppSocket,
} from "./modules/whatsapp/socket/whatsapp.socket";
import { ErpRepository } from "./modules/erp/repository";
import { ErpService } from "./modules/erp/service";
import { SupplierRepository } from "./modules/erp/suppliers/repository";
import { SupplierService } from "./modules/erp/suppliers/service";
import { SaleRepository } from "./modules/erp/sales/repository";
import { SaleService } from "./modules/erp/sales/service";
import { FinanceRepository } from "./modules/erp/finance/repository";
import { FinanceService } from "./modules/erp/finance/service";
import { FiscalRepository } from "./modules/erp/fiscal/repository";
import { FiscalService } from "./modules/erp/fiscal/service";
import { isTestDatabaseEnabled } from "./test-integration-gates";

const dynamic = describe.runIf(isTestDatabaseEnabled());
const repository = new MysqlOperationalSessionRepository();
let httpServer: HttpServer;
let socketUrl = "";
const clients = new Set<ClientSocket>();

function request(cookie?: string): Request {
  return Object.assign(Object.create(null), {
    headers: { cookie },
    secure: false,
  }) as Request;
}

function response(): Response {
  return Object.assign(Object.create(null), {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  }) as Response;
}

async function issueCookie(userId: string, clientId: string): Promise<string> {
  const res = response();
  await createOperationalSession(
    { userId, clientId },
    res,
    request(),
    repository
  );
  const token = vi.mocked(res.cookie).mock.calls[0][1] as string;
  return `${MEGADESK_SESSION_COOKIE}=${token}`;
}

function client(cookie?: string, declaredTenant?: string): ClientSocket {
  const socket = createClient(socketUrl, {
    path: "/api/ws/whatsapp",
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    extraHeaders: cookie ? { Cookie: cookie } : undefined,
    auth: declaredTenant ? { clientId: declaredTenant } : undefined,
  });
  clients.add(socket);
  return socket;
}

function connected(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function rejected(socket: ClientSocket): Promise<string> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve("TIMEOUT"), 1_500);
    socket.once("connect_error", error => {
      clearTimeout(timer);
      resolve(error.message);
    });
  });
}

function event(
  socket: ClientSocket,
  name: string,
  timeoutMs = 800
): Promise<unknown | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(name, payload => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function disconnected(
  socket: ClientSocket,
  timeoutMs = 1200
): Promise<boolean> {
  if (!socket.connected) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    socket.once("disconnect", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function resetFixtures() {
  await getPool().execute(
    "DELETE FROM erp_fiscal_operations WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_fiscal_document_history WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_fiscal_document_items WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_fiscal_documents WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_fiscal_document_sequences WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_fiscal_settings_history WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_fiscal_settings WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_product_fiscal_profiles WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_financial_ledger WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_financial_settlements WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_financial_entries WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_financial_categories WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_financial_accounts WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_purchase_orders WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_purchase_order_sequences WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE fi FROM erp_sale_order_fulfillment_items fi INNER JOIN erp_sale_order_fulfillments f ON f.id=fi.fulfillment_id WHERE f.client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_sale_order_fulfillments WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE h FROM erp_sale_order_history h INNER JOIN erp_sale_orders o ON o.id=h.sale_order_id WHERE o.client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE i FROM erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id WHERE o.client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_sale_orders WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_sale_order_sequences WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_suppliers WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_stock_movements WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_stock_balances WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_products WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM megadesk_crm_clients WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM megadesk_operational_sessions WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM megadesk_domain_client_users WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM megadesk_domain_clients WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "INSERT INTO megadesk_domain_clients (client_id,internal_id,tenant_database_name,company,contact,phone,plan,status,status_type,access_released,api_token,modules_json,integrations_json) VALUES ('socket-tenant-a','socket-a','socket_db_a','Socket A','Fixture','00000000000','Test','active','test',1,'socket-a','[]','{}'),('socket-tenant-b','socket-b','socket_db_b','Socket B','Fixture','00000000000','Test','active','test',1,'socket-b','[]','{}')"
  );
  await getPool().execute(
    "INSERT INTO megadesk_domain_client_users (user_id,client_id,name,email,role,status,permissions_json) VALUES ('socket-user-a','socket-tenant-a','Socket Agent A','socket-agent-a@example.invalid','agent','active','[]'),('socket-admin-a','socket-tenant-a','Socket Admin A','socket-admin-a@example.invalid','admin','active','[]'),('socket-manager-a','socket-tenant-a','Socket Manager A','socket-manager-a@example.invalid','manager','active','[]'),('socket-viewer-a','socket-tenant-a','Socket Viewer A','socket-viewer-a@example.invalid','viewer','active','[]'),('socket-user-b','socket-tenant-b','Socket Manager B','socket-manager-b@example.invalid','manager','active','[]')"
  );
}

async function cleanFixtures() {
  await getPool().execute(
    "DELETE FROM erp_fiscal_operations WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_fiscal_document_history WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_fiscal_document_items WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_fiscal_documents WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_fiscal_document_sequences WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_fiscal_settings_history WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_fiscal_settings WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_product_fiscal_profiles WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_financial_ledger WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_financial_settlements WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_financial_entries WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_financial_categories WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_financial_accounts WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_purchase_orders WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_purchase_order_sequences WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE fi FROM erp_sale_order_fulfillment_items fi INNER JOIN erp_sale_order_fulfillments f ON f.id=fi.fulfillment_id WHERE f.client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_sale_order_fulfillments WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE h FROM erp_sale_order_history h INNER JOIN erp_sale_orders o ON o.id=h.sale_order_id WHERE o.client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE i FROM erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id WHERE o.client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_sale_orders WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_sale_order_sequences WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_suppliers WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_stock_movements WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_stock_balances WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM erp_products WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM megadesk_crm_clients WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM megadesk_operational_sessions WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM megadesk_domain_client_users WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
  await getPool().execute(
    "DELETE FROM megadesk_domain_clients WHERE client_id IN ('socket-tenant-a','socket-tenant-b')"
  );
}

async function saleFixture(clientId: string, userId: string) {
  const identity = { clientId, userId, role: "admin" as const },
    erp = new ErpService(new ErpRepository());
  const crmClientId = crypto.randomUUID();
  await getPool().execute(
    "INSERT INTO megadesk_crm_clients(crm_client_id,client_id,company_name,status) VALUES(?,?,?,'ativo')",
    [crmClientId, clientId, `Socket sale ${clientId}`]
  );
  const product = await erp.createProduct(identity, {
    name: `Socket sale ${clientId}`,
    sku: `SALE-${clientId}`,
    barcode: null,
    description: null,
    category: null,
    unit: "unit",
    costPriceCents: 0,
    salePriceCents: 100,
    minimumStock: "0",
  });
  await erp.moveStock(identity, {
    productPublicId: product.publicId,
    type: "manual_in",
    quantity: "2",
    reason: "Socket sale balance",
    idempotencyKey: crypto.randomUUID(),
  });
  return { identity, crmClientId, product };
}

const financeAdmin = {
  clientId: "socket-tenant-a",
  userId: "socket-admin-a",
  role: "admin" as const,
};
const financeManager = {
  clientId: "socket-tenant-a",
  userId: "socket-manager-a",
  role: "manager" as const,
};

async function financeFixture(
  service = new FinanceService(new FinanceRepository())
) {
  const account = await service.createAccount(financeAdmin, {
    name: `Socket account ${crypto.randomUUID()}`,
    type: "bank",
    initialBalanceCents: 10_000,
    allowNegative: false,
  });
  const category = await service.createCategory(financeAdmin, {
    name: `Socket category ${crypto.randomUUID()}`,
    direction: "both",
  });
  return {
    service,
    accountPublicId: account.publicId,
    categoryPublicId: category.publicId,
  };
}

async function financeManual(
  service: FinanceService,
  categoryPublicId: string,
  accountPublicId: string,
  direction: "payable" | "receivable" = "payable",
  amountCents = 2_500
) {
  return service.createManual(financeAdmin, {
    documentNumber: `SOCKET-${crypto.randomUUID()}`,
    direction,
    description: "Socket finance entry",
    amountCents,
    dueDate: "2026-09-10",
    issueDate: "2026-08-24",
    categoryPublicId,
    financialAccountPublicId: accountPublicId,
    supplierPublicId: null,
    crmClientId: null,
    partyName: "Socket party",
    notes: null,
  });
}

async function financeSource(kind: "purchase_order" | "sales_order") {
  const publicId = crypto.randomUUID();
  if (kind === "purchase_order") {
    const supplierPublicId = crypto.randomUUID();
    const [supplier] = await getPool().execute<any>(
      "INSERT INTO erp_suppliers(public_id,client_id,legal_name,person_type,tax_id,active,created_by,updated_by) VALUES(?,?,?,'legal',?,1,?,?)",
      [
        supplierPublicId,
        "socket-tenant-a",
        "Socket finance supplier",
        String(Date.now()).slice(-14).padStart(14, "1"),
        financeAdmin.userId,
        financeAdmin.userId,
      ]
    );
    await getPool().execute(
      "INSERT INTO erp_purchase_orders(public_id,client_id,order_number,supplier_id,supplier_name_snapshot,status,subtotal_cents,total_cents,created_by) VALUES(?,?,?,?,?,'received',?,?,?)",
      [
        publicId,
        "socket-tenant-a",
        `PO-${publicId.slice(0, 8)}`,
        supplier.insertId,
        "Socket finance supplier",
        7_300,
        7_300,
        financeAdmin.userId,
      ]
    );
  } else {
    const crmClientId = crypto.randomUUID();
    await getPool().execute(
      "INSERT INTO megadesk_crm_clients(crm_client_id,client_id,company_name,status) VALUES(?,?,?,'ativo')",
      [crmClientId, "socket-tenant-a", "Socket finance customer"]
    );
    await getPool().execute(
      "INSERT INTO erp_sale_orders(public_id,client_id,order_number,crm_client_id,customer_name_snapshot,status,subtotal_cents,total_cents,created_by) VALUES(?,?,?,?,?,'fulfilled',?,?,?)",
      [
        publicId,
        "socket-tenant-a",
        `SO-${publicId.slice(0, 8)}`,
        crmClientId,
        "Socket finance customer",
        9_100,
        9_100,
        financeAdmin.userId,
      ]
    );
  }
  return publicId;
}

dynamic("Socket.IO operational session isolation", () => {
  beforeAll(async () => {
    httpServer = createServer();
    initWhatsAppSocket(httpServer);
    await new Promise<void>(resolve =>
      httpServer.listen(0, "127.0.0.1", resolve)
    );
    socketUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  beforeEach(resetFixtures);
  afterEach(async () => {
    const connectedClients = [...clients].filter(socket => socket.connected);
    const closed = connectedClients.map(socket => disconnected(socket));
    for (const socket of connectedClients) socket.disconnect();
    expect(await Promise.all(closed)).not.toContain(false);
    for (const socket of clients) if (socket.connected) socket.disconnect();
    clients.clear();
  });

  afterAll(async () => {
    for (const socket of clients) socket.disconnect();
    await getSocketIO()?.close();
    if (httpServer.listening)
      await new Promise<void>(resolve => httpServer.close(() => resolve()));
    await cleanFixtures();
  });

  it("connects valid sessions for A and B and rejects absent, missing, tampered, revoked and expired cookies", async () => {
    const cookieA = await issueCookie("socket-user-a", "socket-tenant-a");
    const cookieB = await issueCookie("socket-user-b", "socket-tenant-b");
    await connected(client(cookieA));
    await connected(client(cookieB));
    expect(await rejected(client())).toBe("UNAUTHORIZED");
    expect(await rejected(client(`${MEGADESK_SESSION_COOKIE}=missing`))).toBe(
      "UNAUTHORIZED"
    );
    expect(
      await rejected(client(`${MEGADESK_SESSION_COOKIE}=${"z".repeat(43)}`))
    ).toBe("UNAUTHORIZED");
    const revokedCookie = await issueCookie("socket-user-a", "socket-tenant-a");
    await revokeOperationalSession(request(revokedCookie), repository);
    expect(await rejected(client(revokedCookie))).toBe("UNAUTHORIZED");
    const expiredCookie = await issueCookie("socket-user-a", "socket-tenant-a");
    await getPool().execute(
      "UPDATE megadesk_operational_sessions SET expires_at='2000-01-01 00:00:00' WHERE client_id='socket-tenant-a' AND revoked_at IS NULL"
    );
    expect(await rejected(client(expiredCookie))).toBe("UNAUTHORIZED");
  }, 15_000);

  it("does not let auth, query or join declarations replace the session tenant", async () => {
    const cookieA = await issueCookie("socket-user-a", "socket-tenant-a");
    expect(await rejected(client(cookieA, "socket-tenant-b"))).toBe(
      "FORBIDDEN"
    );
    const socket = client(cookieA);
    await connected(socket);
    const disconnect = disconnected(socket);
    socket.emit("wa:join_client", "socket-tenant-b");
    expect(await disconnect).toBe(true);
  });

  it("isolates rooms and never broadcasts status across tenants", async () => {
    const cookieA = await issueCookie("socket-user-a", "socket-tenant-a");
    const cookieB = await issueCookie("socket-user-b", "socket-tenant-b");
    const a1 = client(cookieA);
    const a2 = client(cookieA);
    const b = client(cookieB);
    await Promise.all([connected(a1), connected(a2), connected(b)]);
    const a1Event = event(a1, "wa:message_status");
    const a2Event = event(a2, "wa:message_status");
    const bEvent = event(b, "wa:message_status");
    emitMessageStatus("socket-tenant-a", "fixture-message", "read");
    expect(await a1Event).toMatchObject({
      waMessageId: "fixture-message",
      status: "read",
    });
    expect(await a2Event).toMatchObject({
      waMessageId: "fixture-message",
      status: "read",
    });
    expect(await bEvent).toBeNull();
    const bOnly = event(b, "wa:message_status");
    const aCross = event(a1, "wa:message_status");
    emitMessageStatus("socket-tenant-b", "fixture-message-b", "delivered");
    expect(await bOnly).toMatchObject({ waMessageId: "fixture-message-b" });
    expect(await aCross).toBeNull();
  });

  it("disconnects an established socket before delivery when user is blocked or tenant is paused", async () => {
    const cookieA = await issueCookie("socket-user-a", "socket-tenant-a");
    const blocked = client(cookieA);
    await connected(blocked);
    await getPool().execute(
      "UPDATE megadesk_domain_client_users SET status='blocked' WHERE user_id='socket-user-a'"
    );
    const blockedDisconnect = disconnected(blocked);
    emitMessageStatus("socket-tenant-a", "blocked-message", "read");
    expect(await blockedDisconnect).toBe(true);
    await getPool().execute(
      "UPDATE megadesk_domain_client_users SET status='active' WHERE user_id='socket-user-a'"
    );
    const freshCookie = await issueCookie("socket-user-a", "socket-tenant-a");
    const paused = client(freshCookie);
    await connected(paused);
    await getPool().execute(
      "UPDATE megadesk_domain_clients SET status='paused' WHERE client_id='socket-tenant-a'"
    );
    const pausedDisconnect = disconnected(paused);
    emitMessageStatus("socket-tenant-a", "paused-message", "read");
    expect(await pausedDisconnect).toBe(true);
    await getPool().execute(
      "UPDATE megadesk_domain_clients SET status='active' WHERE client_id='socket-tenant-a'"
    );
  });

  it("requires validation again on reconnect and revocation prevents reconnect", async () => {
    const cookieA = await issueCookie("socket-user-a", "socket-tenant-a");
    const first = client(cookieA);
    await connected(first);
    first.disconnect();
    await revokeOperationalSession(request(cookieA), repository);
    expect(await rejected(client(cookieA))).toBe("UNAUTHORIZED");
  });

  it("cleans listeners on disconnect and repeated handshakes do not accumulate server listeners", async () => {
    const cookieA = await issueCookie("socket-user-a", "socket-tenant-a");
    const baseline = getSocketIO()?.listenerCount("connection") ?? 0;
    for (let index = 0; index < 3; index += 1) {
      const socket = client(cookieA);
      await connected(socket);
      socket.disconnect();
    }
    expect(getSocketIO()?.listenerCount("connection")).toBe(baseline);
    expect([...clients].filter(socket => socket.connected)).toHaveLength(0);
  });

  it("delivers product creation to the authenticated tenant room", async () => {
    const a = client(await issueCookie("socket-user-a", "socket-tenant-a"));
    await connected(a);
    const received = event(a, "erp:product.changed");
    const service = new ErpService(new ErpRepository());
    const created = await service.createProduct(
      { clientId: "socket-tenant-a", userId: "socket-user-a", role: "admin" },
      {
        name: "Socket product",
        sku: "SOCKET-1",
        barcode: null,
        description: null,
        category: null,
        unit: "unit",
        costPriceCents: 100,
        salePriceCents: 200,
        minimumStock: "0",
      }
    );
    expect(await received).toMatchObject({
      productPublicId: created.publicId,
      operation: "created",
    });
  });

  it("delivers product update and deactivation events with safe payloads", async () => {
    const a = client(await issueCookie("socket-user-a", "socket-tenant-a"));
    await connected(a);
    const service = new ErpService(new ErpRepository());
    const identity = {
      clientId: "socket-tenant-a",
      userId: "socket-user-a",
      role: "admin" as const,
    };
    const command = {
      name: "Socket product",
      sku: "SOCKET-2",
      barcode: null,
      description: null,
      category: null,
      unit: "unit" as const,
      costPriceCents: 100,
      salePriceCents: 200,
      minimumStock: "0",
    };
    const createdEvent = event(a, "erp:product.changed");
    const created = await service.createProduct(identity, command);
    await createdEvent;
    const updatedEvent = event(a, "erp:product.changed");
    await service.updateProduct(identity, created.publicId, {
      ...command,
      name: "Updated",
    });
    expect(await updatedEvent).toMatchObject({ operation: "updated" });
    const inactiveEvent = event(a, "erp:product.changed");
    await service.setProductActive(identity, created.publicId, false);
    const payload = (await inactiveEvent) as Record<string, unknown>;
    expect(payload).toMatchObject({ operation: "deactivated" });
    expect(Object.keys(payload).sort()).toEqual([
      "occurredAt",
      "operation",
      "productPublicId",
    ]);
  });

  it("delivers input, output and reversal events after committed changes", async () => {
    const a = client(await issueCookie("socket-user-a", "socket-tenant-a"));
    await connected(a);
    const service = new ErpService(new ErpRepository());
    const identity = {
      clientId: "socket-tenant-a",
      userId: "socket-user-a",
      role: "admin" as const,
    };
    const item = await service.createProduct(identity, {
      name: "Stock socket",
      sku: "SOCKET-STOCK",
      barcode: null,
      description: null,
      category: null,
      unit: "unit",
      costPriceCents: 100,
      salePriceCents: 200,
      minimumStock: "0",
    });
    const inputEvent = event(a, "erp:stock.changed");
    const input = await service.moveStock(identity, {
      productPublicId: item.publicId,
      type: "manual_in",
      quantity: "3",
      reason: "Input",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(await inputEvent).toMatchObject({
      movementPublicId: input.publicId,
      operation: "movement_created",
    });
    const outputEvent = event(a, "erp:stock.changed");
    const output = await service.moveStock(identity, {
      productPublicId: item.publicId,
      type: "manual_out",
      quantity: "1",
      reason: "Output",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(await outputEvent).toMatchObject({ operation: "movement_created" });
    const reversalEvent = event(a, "erp:stock.changed");
    await service.reverseMovement(
      identity,
      output.publicId,
      "Correction",
      crypto.randomUUID()
    );
    const payload = (await reversalEvent) as Record<string, unknown>;
    expect(payload).toMatchObject({ operation: "movement_reversed" });
    expect(Object.keys(payload).sort()).toEqual([
      "movementPublicId",
      "occurredAt",
      "operation",
      "productPublicId",
    ]);
  });

  it("does not emit stock events for rollback, insufficient stock or idempotent replay", async () => {
    const a = client(await issueCookie("socket-user-a", "socket-tenant-a"));
    await connected(a);
    const service = new ErpService(new ErpRepository());
    const identity = {
      clientId: "socket-tenant-a",
      userId: "socket-user-a",
      role: "admin" as const,
    };
    const item = await service.createProduct(identity, {
      name: "No event",
      sku: "SOCKET-NO-EVENT",
      barcode: null,
      description: null,
      category: null,
      unit: "unit",
      costPriceCents: 0,
      salePriceCents: 0,
      minimumStock: "0",
    });
    const failedEvent = event(a, "erp:stock.changed", 300);
    await expect(
      service.moveStock(identity, {
        productPublicId: item.publicId,
        type: "manual_out",
        quantity: "1",
        reason: "Failure",
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toBeTruthy();
    expect(await failedEvent).toBeNull();
    const key = crypto.randomUUID();
    const createdEvent = event(a, "erp:stock.changed");
    await service.moveStock(identity, {
      productPublicId: item.publicId,
      type: "manual_in",
      quantity: "1",
      reason: "Input",
      idempotencyKey: key,
    });
    await createdEvent;
    const replayEvent = event(a, "erp:stock.changed", 300);
    await service.moveStock(identity, {
      productPublicId: item.publicId,
      type: "manual_in",
      quantity: "1",
      reason: "Input",
      idempotencyKey: key,
    });
    expect(await replayEvent).toBeNull();
  });

  it("delivers committed sale and stock events only to the sale tenant with minimal payloads", async () => {
    const a = client(await issueCookie("socket-user-a", "socket-tenant-a"));
    await connected(a);
    const b = client(await issueCookie("socket-user-b", "socket-tenant-b"));
    await connected(b);
    const f = await saleFixture("socket-tenant-a", "socket-user-a"),
      service = new SaleService(new SaleRepository());
    const createdA = event(a, "erp:sale.changed"),
      createdB = event(b, "erp:sale.changed", 300);
    const order = await service.create(f.identity, {
      crmClientId: f.crmClientId,
      notes: null,
      expectedDate: null,
      items: [
        {
          productPublicId: f.product.publicId,
          quantity: "1",
          unitPriceCents: 100,
        },
      ],
    });
    const created = (await createdA) as Record<string, unknown>;
    expect(created).toMatchObject({
      publicId: order.publicId,
      operation: "created",
    });
    expect(Object.keys(created).sort()).toEqual([
      "occurredAt",
      "operation",
      "publicId",
    ]);
    expect(await createdB).toBeNull();
    const confirmedEvent = event(a, "erp:sale.changed");
    await service.confirm(f.identity, order.publicId);
    expect(await confirmedEvent).toMatchObject({ operation: "confirmed" });
    const saleEvent = event(a, "erp:sale.changed"),
      stockEvent = event(a, "erp:stock.changed");
    const key = crypto.randomUUID();
    await service.fulfill(f.identity, order.publicId, key);
    expect(await saleEvent).toMatchObject({ operation: "fulfilled" });
    expect(await stockEvent).toMatchObject({
      operation: "sale_fulfilled",
      productPublicId: f.product.publicId,
    });
    const replaySale = event(a, "erp:sale.changed", 300),
      replayStock = event(a, "erp:stock.changed", 300);
    await service.fulfill(f.identity, order.publicId, key);
    expect(await replaySale).toBeNull();
    expect(await replayStock).toBeNull();
  });

  it("does not deliver rolled-back sales and disconnects revoked or blocked sale recipients", async () => {
    const cookie = await issueCookie("socket-user-a", "socket-tenant-a"),
      a = client(cookie);
    await connected(a);
    const f = await saleFixture("socket-tenant-a", "socket-user-a"),
      service = new SaleService(new SaleRepository());
    const createdEvent = event(a, "erp:sale.changed");
    const order = await service.create(f.identity, {
      crmClientId: f.crmClientId,
      notes: null,
      expectedDate: null,
      items: [
        {
          productPublicId: f.product.publicId,
          quantity: "3",
          unitPriceCents: 100,
        },
      ],
    });
    await createdEvent;
    const confirmedEvent = event(a, "erp:sale.changed");
    await service.confirm(f.identity, order.publicId);
    await confirmedEvent;
    const failedSale = event(a, "erp:sale.changed", 300),
      failedStock = event(a, "erp:stock.changed", 300);
    await expect(
      service.fulfill(f.identity, order.publicId, crypto.randomUUID())
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect(await failedSale).toBeNull();
    expect(await failedStock).toBeNull();
    await revokeOperationalSession(request(cookie), repository);
    const revokedDisconnect = disconnected(a);
    await service.create(f.identity, {
      crmClientId: f.crmClientId,
      notes: null,
      expectedDate: null,
      items: [
        {
          productPublicId: f.product.publicId,
          quantity: "1",
          unitPriceCents: 100,
        },
      ],
    });
    expect(await revokedDisconnect).toBe(true);
    const blockedCookie = await issueCookie("socket-user-b", "socket-tenant-b"),
      blocked = client(blockedCookie);
    await connected(blocked);
    const fb = await saleFixture("socket-tenant-b", "socket-user-b");
    await getPool().execute(
      "UPDATE megadesk_domain_clients SET access_released=0 WHERE client_id='socket-tenant-b'"
    );
    const blockedDisconnect = disconnected(blocked);
    await new SaleService(new SaleRepository()).create(fb.identity, {
      crmClientId: fb.crmClientId,
      notes: null,
      expectedDate: null,
      items: [
        {
          productPublicId: fb.product.publicId,
          quantity: "1",
          unitPriceCents: 100,
        },
      ],
    });
    expect(await blockedDisconnect).toBe(true);
  });

  it("delivers a minimal supplier event only to the authenticated tenant room", async () => {
    const a = client(await issueCookie("socket-user-a", "socket-tenant-a"));
    await connected(a);
    const b = client(await issueCookie("socket-user-b", "socket-tenant-b"));
    await connected(b);
    const receivedA = event(a, "erp:supplier.changed");
    const receivedB = event(b, "erp:supplier.changed", 300);
    const created = await new SupplierService(new SupplierRepository()).create(
      { clientId: "socket-tenant-a", userId: "socket-user-a", role: "admin" },
      {
        legalName: "Socket supplier",
        tradeName: null,
        personType: "legal",
        taxId: "12345678000190",
        stateRegistration: null,
        email: null,
        phone: null,
        contactName: null,
        postalCode: null,
        street: null,
        addressNumber: null,
        addressComplement: null,
        district: null,
        city: null,
        state: null,
        notes: null,
      }
    );
    const payload = (await receivedA) as Record<string, unknown>;
    expect(payload).toMatchObject({
      publicId: created.publicId,
      operation: "created",
    });
    expect(Object.keys(payload).sort()).toEqual([
      "occurredAt",
      "operation",
      "publicId",
    ]);
    expect(await receivedB).toBeNull();
  });

  it("disconnects revoked or blocked supplier event recipients", async () => {
    const revokedCookie = await issueCookie("socket-user-a", "socket-tenant-a");
    const revoked = client(revokedCookie);
    await connected(revoked);
    await revokeOperationalSession(request(revokedCookie), repository);
    const revokedDisconnect = disconnected(revoked);
    await new SupplierService(new SupplierRepository()).create(
      { clientId: "socket-tenant-a", userId: "socket-user-a", role: "admin" },
      {
        legalName: "Revoked event",
        tradeName: null,
        personType: "legal",
        taxId: "12345678000191",
        stateRegistration: null,
        email: null,
        phone: null,
        contactName: null,
        postalCode: null,
        street: null,
        addressNumber: null,
        addressComplement: null,
        district: null,
        city: null,
        state: null,
        notes: null,
      }
    );
    expect(await revokedDisconnect).toBe(true);
    const blockedCookie = await issueCookie("socket-user-b", "socket-tenant-b");
    const blocked = client(blockedCookie);
    await connected(blocked);
    await getPool().execute(
      "UPDATE megadesk_domain_clients SET access_released=0 WHERE client_id='socket-tenant-b'"
    );
    const blockedDisconnect = disconnected(blocked);
    await new SupplierService(new SupplierRepository()).create(
      { clientId: "socket-tenant-b", userId: "socket-user-b", role: "manager" },
      {
        legalName: "Blocked event",
        tradeName: null,
        personType: "legal",
        taxId: "12345678000192",
        stateRegistration: null,
        email: null,
        phone: null,
        contactName: null,
        postalCode: null,
        street: null,
        addressNumber: null,
        addressComplement: null,
        district: null,
        city: null,
        state: null,
        notes: null,
      }
    );
    expect(await blockedDisconnect).toBe(true);
  });

  it("delivers minimal finance account events to A readers but not its agent or tenant B", async () => {
    const admin = client(
      await issueCookie("socket-admin-a", "socket-tenant-a")
    );
    await connected(admin);
    const manager = client(
      await issueCookie("socket-manager-a", "socket-tenant-a")
    );
    await connected(manager);
    const viewer = client(
      await issueCookie("socket-viewer-a", "socket-tenant-a")
    );
    await connected(viewer);
    const agent = client(await issueCookie("socket-user-a", "socket-tenant-a"));
    await connected(agent);
    const tenantB = client(
      await issueCookie("socket-user-b", "socket-tenant-b")
    );
    await connected(tenantB);
    const received = [
        event(admin, "erp:finance.account.changed"),
        event(manager, "erp:finance.account.changed"),
        event(viewer, "erp:finance.account.changed"),
      ],
      agentEvent = event(agent, "erp:finance.account.changed", 300),
      crossTenant = event(tenantB, "erp:finance.account.changed", 300),
      service = new FinanceService(new FinanceRepository());
    const account = await service.createAccount(financeAdmin, {
      name: "Socket role account",
      type: "bank",
      initialBalanceCents: 10_000,
      allowNegative: false,
    });
    for (const promised of received) {
      const payload = (await promised) as Record<string, unknown>;
      expect(payload).toMatchObject({
        publicId: account.publicId,
        operation: "created",
      });
      expect(Object.keys(payload).sort()).toEqual([
        "occurredAt",
        "operation",
        "publicId",
      ]);
    }
    expect(await agentEvent).toBeNull();
    expect(await crossTenant).toBeNull();
    const deactivatedManager = event(manager, "erp:finance.account.changed"),
      deactivatedViewer = event(viewer, "erp:finance.account.changed");
    await service.setAccountActive(financeAdmin, account.publicId, false);
    for (const promised of [deactivatedManager, deactivatedViewer])
      expect(await promised).toMatchObject({
        publicId: account.publicId,
        operation: "deactivated",
      });
    const activated = event(viewer, "erp:finance.account.changed");
    await service.setAccountActive(financeManager, account.publicId, true);
    expect(await activated).toMatchObject({
      publicId: account.publicId,
      operation: "activated",
    });
  });

  it("publishes committed finance entry creation and open-title updates", async () => {
    const fixture = await financeFixture(),
      admin = client(await issueCookie("socket-admin-a", "socket-tenant-a"));
    await connected(admin);
    const manager = client(
      await issueCookie("socket-manager-a", "socket-tenant-a")
    );
    await connected(manager);
    const viewer = client(
      await issueCookie("socket-viewer-a", "socket-tenant-a")
    );
    await connected(viewer);
    const agent = client(await issueCookie("socket-user-a", "socket-tenant-a"));
    await connected(agent);
    const createdAdmin = event(admin, "erp:finance.entry.changed"),
      createdManager = event(manager, "erp:finance.entry.changed"),
      createdViewer = event(viewer, "erp:finance.entry.changed"),
      createdAgent = event(agent, "erp:finance.entry.changed", 300);
    const entry = await financeManual(
      fixture.service,
      fixture.categoryPublicId,
      fixture.accountPublicId
    );
    for (const promised of [createdAdmin, createdManager, createdViewer]) {
      const payload = (await promised) as Record<string, unknown>;
      expect(payload).toMatchObject({
        publicId: entry!.publicId,
        operation: "created",
      });
      expect(Object.keys(payload).sort()).toEqual([
        "occurredAt",
        "operation",
        "publicId",
      ]);
    }
    expect(await createdAgent).toBeNull();
    const updated = event(admin, "erp:finance.entry.changed");
    await fixture.service.update(financeManager, {
      publicId: entry!.publicId,
      description: "Socket finance updated",
      dueDate: "2026-09-11",
      categoryPublicId: fixture.categoryPublicId,
      financialAccountPublicId: fixture.accountPublicId,
      notes: null,
    });
    expect(await updated).toMatchObject({
      publicId: entry!.publicId,
      operation: "updated",
    });
  });

  it("publishes settlement exactly once and suppresses rollback, replay and cancel balance events", async () => {
    const fixture = await financeFixture(),
      admin = client(await issueCookie("socket-admin-a", "socket-tenant-a"));
    await connected(admin);
    const entryCreated = event(admin, "erp:finance.entry.changed"),
      entry = await financeManual(
        fixture.service,
        fixture.categoryPublicId,
        fixture.accountPublicId
      );
    await entryCreated;
    const settledEntry = event(admin, "erp:finance.entry.changed"),
      settledAccount = event(admin, "erp:finance.account.changed"),
      key = crypto.randomUUID();
    await fixture.service.settle(
      financeAdmin,
      entry!.publicId,
      fixture.accountPublicId,
      key
    );
    expect(await settledEntry).toMatchObject({
      publicId: entry!.publicId,
      operation: "settled",
    });
    expect(await settledAccount).toMatchObject({
      publicId: fixture.accountPublicId,
      operation: "updated",
    });
    const replayEntry = event(admin, "erp:finance.entry.changed", 300),
      replayAccount = event(admin, "erp:finance.account.changed", 300);
    await fixture.service.settle(
      financeAdmin,
      entry!.publicId,
      fixture.accountPublicId,
      key
    );
    expect(await replayEntry).toBeNull();
    expect(await replayAccount).toBeNull();
    const failingCreated = event(admin, "erp:finance.entry.changed"),
      failing = await financeManual(
        fixture.service,
        fixture.categoryPublicId,
        fixture.accountPublicId,
        "payable",
        20_000
      );
    await failingCreated;
    const rollbackEntry = event(admin, "erp:finance.entry.changed", 300),
      rollbackAccount = event(admin, "erp:finance.account.changed", 300);
    await expect(
      fixture.service.settle(
        financeAdmin,
        failing!.publicId,
        fixture.accountPublicId,
        crypto.randomUUID()
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await rollbackEntry).toBeNull();
    expect(await rollbackAccount).toBeNull();
    const cancellableCreated = event(admin, "erp:finance.entry.changed"),
      cancellable = await financeManual(
        fixture.service,
        fixture.categoryPublicId,
        fixture.accountPublicId
      );
    await cancellableCreated;
    const cancelled = event(admin, "erp:finance.entry.changed"),
      cancelAccount = event(admin, "erp:finance.account.changed", 300);
    await fixture.service.cancel(
      financeAdmin,
      cancellable!.publicId,
      "Socket cancellation"
    );
    expect(await cancelled).toMatchObject({
      publicId: cancellable!.publicId,
      operation: "cancelled",
    });
    expect(await cancelAccount).toBeNull();
  });

  it("publishes titles created by real purchase and sale source operations", async () => {
    const fixture = await financeFixture(),
      purchase = await financeSource("purchase_order"),
      sale = await financeSource("sales_order"),
      manager = client(
        await issueCookie("socket-manager-a", "socket-tenant-a")
      );
    await connected(manager);
    const purchaseEvent = event(manager, "erp:finance.entry.changed");
    const payable = await fixture.service.createFromSource(
      financeManager,
      "purchase_order",
      {
        sourcePublicId: purchase,
        dueDate: "2026-09-10",
        categoryPublicId: fixture.categoryPublicId,
        financialAccountPublicId: fixture.accountPublicId,
        notes: null,
      }
    );
    expect(await purchaseEvent).toMatchObject({
      publicId: payable.publicId,
      operation: "created",
    });
    const saleEvent = event(manager, "erp:finance.entry.changed");
    const receivable = await fixture.service.createFromSource(
      financeManager,
      "sales_order",
      {
        sourcePublicId: sale,
        dueDate: "2026-09-10",
        categoryPublicId: fixture.categoryPublicId,
        financialAccountPublicId: null,
        notes: null,
      }
    );
    expect(await saleEvent).toMatchObject({
      publicId: receivable.publicId,
      operation: "created",
    });
  });

  it("disconnects revoked and blocked finance recipients before event delivery", async () => {
    const fixture = await financeFixture(),
      revokedCookie = await issueCookie("socket-admin-a", "socket-tenant-a"),
      revoked = client(revokedCookie);
    await connected(revoked);
    await revokeOperationalSession(request(revokedCookie), repository);
    const revokedDisconnect = disconnected(revoked);
    await financeManual(
      fixture.service,
      fixture.categoryPublicId,
      fixture.accountPublicId
    );
    expect(await revokedDisconnect).toBe(true);
    const blockedCookie = await issueCookie(
        "socket-manager-a",
        "socket-tenant-a"
      ),
      blocked = client(blockedCookie);
    await connected(blocked);
    await getPool().execute(
      "UPDATE megadesk_domain_clients SET status='paused' WHERE client_id='socket-tenant-a'"
    );
    const blockedDisconnect = disconnected(blocked);
    await financeManual(
      fixture.service,
      fixture.categoryPublicId,
      fixture.accountPublicId,
      "receivable"
    );
    expect(await blockedDisconnect).toBe(true);
    await getPool().execute(
      "UPDATE megadesk_domain_clients SET status='active' WHERE client_id='socket-tenant-a'"
    );
  });

  it("delivers minimal fiscal settings and document events only to authorized tenant readers", async () => {
    const admin = client(
      await issueCookie("socket-admin-a", "socket-tenant-a")
    );
    await connected(admin);
    const viewer = client(
      await issueCookie("socket-viewer-a", "socket-tenant-a")
    );
    await connected(viewer);
    const agent = client(await issueCookie("socket-user-a", "socket-tenant-a"));
    await connected(agent);
    const tenantB = client(
      await issueCookie("socket-user-b", "socket-tenant-b")
    );
    await connected(tenantB);
    const service = new FiscalService(new FiscalRepository());
    const settingsAdmin = event(admin, "erp:fiscal.settings.changed"),
      settingsViewer = event(viewer, "erp:fiscal.settings.changed"),
      settingsAgent = event(agent, "erp:fiscal.settings.changed", 300),
      settingsCross = event(tenantB, "erp:fiscal.settings.changed", 300);
    const saved = await service.saveSettings(financeAdmin, {
      taxRegime: "simples_nacional",
      taxpayerIndicator: "non_taxpayer",
      stateRegistration: null,
      municipalRegistration: null,
      mainCnae: null,
      ibgeCityCode: null,
      environment: "homologation",
      provider: "none",
    });
    for (const promised of [settingsAdmin, settingsViewer]) {
      const payload = (await promised) as Record<string, unknown>;
      expect(payload).toMatchObject({
        publicId: saved.publicId,
        operation: "created",
      });
      expect(Object.keys(payload).sort()).toEqual([
        "occurredAt",
        "operation",
        "publicId",
      ]);
    }
    expect(await settingsAgent).toBeNull();
    expect(await settingsCross).toBeNull();
    const createdAdmin = event(admin, "erp:fiscal.document.changed"),
      createdViewer = event(viewer, "erp:fiscal.document.changed"),
      key = crypto.randomUUID();
    const document = await service.createManual(financeAdmin, {
      internalIssueDate: "2026-08-24",
      partyName: "Socket fiscal",
      partyDocument: null,
      internalNotes: null,
      idempotencyKey: key,
      items: [
        {
          productPublicId: null,
          name: "Item fiscal interno",
          sku: null,
          quantityMillis: 1000,
          unitAmountCents: 500,
        },
      ],
    });
    expect(await createdAdmin).toMatchObject({
      publicId: document.publicId,
      operation: "created",
    });
    expect(await createdViewer).toMatchObject({
      publicId: document.publicId,
      operation: "created",
    });
    const replay = event(admin, "erp:fiscal.document.changed", 300);
    await service.createManual(financeAdmin, {
      internalIssueDate: "2026-08-24",
      partyName: "Socket fiscal",
      partyDocument: null,
      internalNotes: null,
      idempotencyKey: key,
      items: [
        {
          productPublicId: null,
          name: "Item fiscal interno",
          sku: null,
          quantityMillis: 1000,
          unitAmountCents: 500,
        },
      ],
    });
    expect(await replay).toBeNull();
  });

  it("suppresses rolled-back fiscal events and disconnects revoked or paused recipients", async () => {
    const service = new FiscalService(new FiscalRepository()),
      cookie = await issueCookie("socket-admin-a", "socket-tenant-a"),
      revoked = client(cookie);
    await connected(revoked);
    const rollbackEvent = event(revoked, "erp:fiscal.document.changed", 300);
    await expect(
      service.ready(financeAdmin, crypto.randomUUID(), crypto.randomUUID())
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await rollbackEvent).toBeNull();
    await revokeOperationalSession(request(cookie), repository);
    const revokedDisconnect = disconnected(revoked);
    await service.createManual(financeAdmin, {
      internalIssueDate: "2026-08-24",
      partyName: "Revoked fiscal",
      partyDocument: null,
      internalNotes: null,
      idempotencyKey: crypto.randomUUID(),
      items: [
        {
          productPublicId: null,
          name: "Item",
          sku: null,
          quantityMillis: 1000,
          unitAmountCents: 100,
        },
      ],
    });
    expect(await revokedDisconnect).toBe(true);
    const blockedCookie = await issueCookie(
        "socket-manager-a",
        "socket-tenant-a"
      ),
      blocked = client(blockedCookie);
    await connected(blocked);
    await getPool().execute(
      "UPDATE megadesk_domain_clients SET status='paused' WHERE client_id='socket-tenant-a'"
    );
    const blockedDisconnect = disconnected(blocked);
    await service.createManual(financeManager, {
      internalIssueDate: "2026-08-24",
      partyName: "Paused fiscal",
      partyDocument: null,
      internalNotes: null,
      idempotencyKey: crypto.randomUUID(),
      items: [
        {
          productPublicId: null,
          name: "Item",
          sku: null,
          quantityMillis: 1000,
          unitAmountCents: 100,
        },
      ],
    });
    expect(await blockedDisconnect).toBe(true);
    await getPool().execute(
      "UPDATE megadesk_domain_clients SET status='active' WHERE client_id='socket-tenant-a'"
    );
  });
});
