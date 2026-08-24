import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Request, Response } from "express";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { getPool } from "./db";
import { createOperationalSession, MEGADESK_SESSION_COOKIE, MysqlOperationalSessionRepository, revokeOperationalSession } from "./_core/megadesk-session";
import { emitMessageStatus, getSocketIO, initWhatsAppSocket } from "./modules/whatsapp/socket/whatsapp.socket";
import { ErpRepository } from "./modules/erp/repository";
import { ErpService } from "./modules/erp/service";
import { SupplierRepository } from "./modules/erp/suppliers/repository";
import { SupplierService } from "./modules/erp/suppliers/service";
import { SaleRepository } from "./modules/erp/sales/repository";
import { SaleService } from "./modules/erp/sales/service";
import { isTestDatabaseEnabled } from "./test-integration-gates";

const dynamic = describe.runIf(isTestDatabaseEnabled());
const repository = new MysqlOperationalSessionRepository();
let httpServer: HttpServer;
let socketUrl = "";
const clients = new Set<ClientSocket>();

function request(cookie?: string): Request {
  return Object.assign(Object.create(null), { headers: { cookie }, secure: false }) as Request;
}

function response(): Response {
  return Object.assign(Object.create(null), { cookie: vi.fn(), clearCookie: vi.fn() }) as Response;
}

async function issueCookie(userId: string, clientId: string): Promise<string> {
  const res = response();
  await createOperationalSession({ userId, clientId }, res, request(), repository);
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
    socket.once("connect_error", error => { clearTimeout(timer); resolve(error.message); });
  });
}

function event(socket: ClientSocket, name: string, timeoutMs = 800): Promise<unknown | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(name, payload => { clearTimeout(timer); resolve(payload); });
  });
}

function disconnected(socket: ClientSocket, timeoutMs = 1200): Promise<boolean> {
  if (!socket.connected) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    socket.once("disconnect", () => { clearTimeout(timer); resolve(true); });
  });
}

async function resetFixtures() {
  await getPool().execute("DELETE fi FROM erp_sale_order_fulfillment_items fi INNER JOIN erp_sale_order_fulfillments f ON f.id=fi.fulfillment_id WHERE f.client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_sale_order_fulfillments WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE h FROM erp_sale_order_history h INNER JOIN erp_sale_orders o ON o.id=h.sale_order_id WHERE o.client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE i FROM erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id WHERE o.client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_sale_orders WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_sale_order_sequences WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_suppliers WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_stock_movements WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_stock_balances WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_products WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM megadesk_crm_clients WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM megadesk_operational_sessions WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM megadesk_domain_client_users WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM megadesk_domain_clients WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("INSERT INTO megadesk_domain_clients (client_id,internal_id,tenant_database_name,company,contact,phone,plan,status,status_type,access_released,api_token,modules_json,integrations_json) VALUES ('socket-tenant-a','socket-a','socket_db_a','Socket A','Fixture','00000000000','Test','active','test',1,'socket-a','[]','{}'),('socket-tenant-b','socket-b','socket_db_b','Socket B','Fixture','00000000000','Test','active','test',1,'socket-b','[]','{}')");
  await getPool().execute("INSERT INTO megadesk_domain_client_users (user_id,client_id,name,email,role,status,permissions_json) VALUES ('socket-user-a','socket-tenant-a','Socket A','socket-shared@example.invalid','agent','active','[]'),('socket-user-b','socket-tenant-b','Socket B','socket-shared@example.invalid','manager','active','[]')");
}

async function cleanFixtures() {
  await getPool().execute("DELETE fi FROM erp_sale_order_fulfillment_items fi INNER JOIN erp_sale_order_fulfillments f ON f.id=fi.fulfillment_id WHERE f.client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_sale_order_fulfillments WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE h FROM erp_sale_order_history h INNER JOIN erp_sale_orders o ON o.id=h.sale_order_id WHERE o.client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE i FROM erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id WHERE o.client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_sale_orders WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_sale_order_sequences WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_suppliers WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_stock_movements WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_stock_balances WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_products WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM megadesk_crm_clients WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM megadesk_operational_sessions WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM megadesk_domain_client_users WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM megadesk_domain_clients WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
}

async function saleFixture(clientId: string, userId: string) {
  const identity={clientId,userId,role:"admin" as const}, erp=new ErpService(new ErpRepository());
  const crmClientId=crypto.randomUUID();
  await getPool().execute("INSERT INTO megadesk_crm_clients(crm_client_id,client_id,company_name,status) VALUES(?,?,?,'ativo')",[crmClientId,clientId,`Socket sale ${clientId}`]);
  const product=await erp.createProduct(identity,{name:`Socket sale ${clientId}`,sku:`SALE-${clientId}`,barcode:null,description:null,category:null,unit:"unit",costPriceCents:0,salePriceCents:100,minimumStock:"0"});
  await erp.moveStock(identity,{productPublicId:product.publicId,type:"manual_in",quantity:"2",reason:"Socket sale balance",idempotencyKey:crypto.randomUUID()});
  return {identity,crmClientId,product};
}

dynamic("Socket.IO operational session isolation", () => {
  beforeAll(async () => {
    httpServer = createServer();
    initWhatsAppSocket(httpServer);
    await new Promise<void>(resolve => httpServer.listen(0, "127.0.0.1", resolve));
    socketUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  beforeEach(resetFixtures);
  afterEach(async () => {
    const connectedClients=[...clients].filter(socket=>socket.connected);
    const closed=connectedClients.map(socket=>disconnected(socket));
    for (const socket of connectedClients) socket.disconnect();
    expect(await Promise.all(closed)).not.toContain(false);
    for (const socket of clients) if(socket.connected)socket.disconnect();
    clients.clear();
  });

  afterAll(async () => {
    for (const socket of clients) socket.disconnect();
    await getSocketIO()?.close();
    if (httpServer.listening) await new Promise<void>(resolve => httpServer.close(() => resolve()));
    await cleanFixtures();
  });

  it("connects valid sessions for A and B and rejects absent, missing, tampered, revoked and expired cookies", async () => {
    const cookieA = await issueCookie("socket-user-a", "socket-tenant-a");
    const cookieB = await issueCookie("socket-user-b", "socket-tenant-b");
    await connected(client(cookieA));
    await connected(client(cookieB));
    expect(await rejected(client())).toBe("UNAUTHORIZED");
    expect(await rejected(client(`${MEGADESK_SESSION_COOKIE}=missing`))).toBe("UNAUTHORIZED");
    expect(await rejected(client(`${MEGADESK_SESSION_COOKIE}=${"z".repeat(43)}`))).toBe("UNAUTHORIZED");
    const revokedCookie = await issueCookie("socket-user-a", "socket-tenant-a");
    await revokeOperationalSession(request(revokedCookie), repository);
    expect(await rejected(client(revokedCookie))).toBe("UNAUTHORIZED");
    const expiredCookie = await issueCookie("socket-user-a", "socket-tenant-a");
    await getPool().execute("UPDATE megadesk_operational_sessions SET expires_at='2000-01-01 00:00:00' WHERE client_id='socket-tenant-a' AND revoked_at IS NULL");
    expect(await rejected(client(expiredCookie))).toBe("UNAUTHORIZED");
  }, 15_000);

  it("does not let auth, query or join declarations replace the session tenant", async () => {
    const cookieA = await issueCookie("socket-user-a", "socket-tenant-a");
    expect(await rejected(client(cookieA, "socket-tenant-b"))).toBe("FORBIDDEN");
    const socket = client(cookieA);
    await connected(socket);
    const disconnect = disconnected(socket);
    socket.emit("wa:join_client", "socket-tenant-b");
    expect(await disconnect).toBe(true);
  });

  it("isolates rooms and never broadcasts status across tenants", async () => {
    const cookieA = await issueCookie("socket-user-a", "socket-tenant-a");
    const cookieB = await issueCookie("socket-user-b", "socket-tenant-b");
    const a1 = client(cookieA); const a2 = client(cookieA); const b = client(cookieB);
    await Promise.all([connected(a1), connected(a2), connected(b)]);
    const a1Event = event(a1, "wa:message_status");
    const a2Event = event(a2, "wa:message_status");
    const bEvent = event(b, "wa:message_status");
    emitMessageStatus("socket-tenant-a", "fixture-message", "read");
    expect(await a1Event).toMatchObject({ waMessageId: "fixture-message", status: "read" });
    expect(await a2Event).toMatchObject({ waMessageId: "fixture-message", status: "read" });
    expect(await bEvent).toBeNull();
    const bOnly = event(b, "wa:message_status");
    const aCross = event(a1, "wa:message_status");
    emitMessageStatus("socket-tenant-b", "fixture-message-b", "delivered");
    expect(await bOnly).toMatchObject({ waMessageId: "fixture-message-b" });
    expect(await aCross).toBeNull();
  });

  it("disconnects an established socket before delivery when user is blocked or tenant is paused", async () => {
    const cookieA = await issueCookie("socket-user-a", "socket-tenant-a");
    const blocked = client(cookieA); await connected(blocked);
    await getPool().execute("UPDATE megadesk_domain_client_users SET status='blocked' WHERE user_id='socket-user-a'");
    const blockedDisconnect = disconnected(blocked);
    emitMessageStatus("socket-tenant-a", "blocked-message", "read");
    expect(await blockedDisconnect).toBe(true);
    await getPool().execute("UPDATE megadesk_domain_client_users SET status='active' WHERE user_id='socket-user-a'");
    const freshCookie = await issueCookie("socket-user-a", "socket-tenant-a");
    const paused = client(freshCookie); await connected(paused);
    await getPool().execute("UPDATE megadesk_domain_clients SET status='paused' WHERE client_id='socket-tenant-a'");
    const pausedDisconnect = disconnected(paused);
    emitMessageStatus("socket-tenant-a", "paused-message", "read");
    expect(await pausedDisconnect).toBe(true);
    await getPool().execute("UPDATE megadesk_domain_clients SET status='active' WHERE client_id='socket-tenant-a'");
  });

  it("requires validation again on reconnect and revocation prevents reconnect", async () => {
    const cookieA = await issueCookie("socket-user-a", "socket-tenant-a");
    const first = client(cookieA); await connected(first); first.disconnect();
    await revokeOperationalSession(request(cookieA), repository);
    expect(await rejected(client(cookieA))).toBe("UNAUTHORIZED");
  });

  it("cleans listeners on disconnect and repeated handshakes do not accumulate server listeners", async () => {
    const cookieA = await issueCookie("socket-user-a", "socket-tenant-a");
    const baseline = getSocketIO()?.listenerCount("connection") ?? 0;
    for (let index = 0; index < 3; index += 1) {
      const socket = client(cookieA); await connected(socket); socket.disconnect();
    }
    expect(getSocketIO()?.listenerCount("connection")).toBe(baseline);
    expect([...clients].filter(socket => socket.connected)).toHaveLength(0);
  });

  it("delivers product creation to the authenticated tenant room", async () => {
    const a=client(await issueCookie("socket-user-a","socket-tenant-a")); await connected(a);
    const received=event(a,"erp:product.changed");
    const service=new ErpService(new ErpRepository()); const created=await service.createProduct({clientId:"socket-tenant-a",userId:"socket-user-a",role:"admin"},{name:"Socket product",sku:"SOCKET-1",barcode:null,description:null,category:null,unit:"unit",costPriceCents:100,salePriceCents:200,minimumStock:"0"});
    expect(await received).toMatchObject({productPublicId:created.publicId,operation:"created"});
  });

  it("delivers product update and deactivation events with safe payloads", async () => {
    const a=client(await issueCookie("socket-user-a","socket-tenant-a")); await connected(a); const service=new ErpService(new ErpRepository()); const identity={clientId:"socket-tenant-a",userId:"socket-user-a",role:"admin" as const}; const command={name:"Socket product",sku:"SOCKET-2",barcode:null,description:null,category:null,unit:"unit" as const,costPriceCents:100,salePriceCents:200,minimumStock:"0"}; const createdEvent=event(a,"erp:product.changed"); const created=await service.createProduct(identity,command); await createdEvent;
    const updatedEvent=event(a,"erp:product.changed"); await service.updateProduct(identity,created.publicId,{...command,name:"Updated"}); expect(await updatedEvent).toMatchObject({operation:"updated"});
    const inactiveEvent=event(a,"erp:product.changed"); await service.setProductActive(identity,created.publicId,false); const payload=await inactiveEvent as Record<string,unknown>; expect(payload).toMatchObject({operation:"deactivated"}); expect(Object.keys(payload).sort()).toEqual(["occurredAt","operation","productPublicId"]);
  });

  it("delivers input, output and reversal events after committed changes", async () => {
    const a=client(await issueCookie("socket-user-a","socket-tenant-a")); await connected(a); const service=new ErpService(new ErpRepository()); const identity={clientId:"socket-tenant-a",userId:"socket-user-a",role:"admin" as const}; const item=await service.createProduct(identity,{name:"Stock socket",sku:"SOCKET-STOCK",barcode:null,description:null,category:null,unit:"unit",costPriceCents:100,salePriceCents:200,minimumStock:"0"});
    const inputEvent=event(a,"erp:stock.changed"); const input=await service.moveStock(identity,{productPublicId:item.publicId,type:"manual_in",quantity:"3",reason:"Input",idempotencyKey:crypto.randomUUID()}); expect(await inputEvent).toMatchObject({movementPublicId:input.publicId,operation:"movement_created"});
    const outputEvent=event(a,"erp:stock.changed"); const output=await service.moveStock(identity,{productPublicId:item.publicId,type:"manual_out",quantity:"1",reason:"Output",idempotencyKey:crypto.randomUUID()}); expect(await outputEvent).toMatchObject({operation:"movement_created"});
    const reversalEvent=event(a,"erp:stock.changed"); await service.reverseMovement(identity,output.publicId,"Correction",crypto.randomUUID()); const payload=await reversalEvent as Record<string,unknown>; expect(payload).toMatchObject({operation:"movement_reversed"}); expect(Object.keys(payload).sort()).toEqual(["movementPublicId","occurredAt","operation","productPublicId"]);
  });

  it("does not emit stock events for rollback, insufficient stock or idempotent replay", async () => {
    const a=client(await issueCookie("socket-user-a","socket-tenant-a")); await connected(a); const service=new ErpService(new ErpRepository()); const identity={clientId:"socket-tenant-a",userId:"socket-user-a",role:"admin" as const}; const item=await service.createProduct(identity,{name:"No event",sku:"SOCKET-NO-EVENT",barcode:null,description:null,category:null,unit:"unit",costPriceCents:0,salePriceCents:0,minimumStock:"0"});
    const failedEvent=event(a,"erp:stock.changed",300); await expect(service.moveStock(identity,{productPublicId:item.publicId,type:"manual_out",quantity:"1",reason:"Failure",idempotencyKey:crypto.randomUUID()})).rejects.toBeTruthy(); expect(await failedEvent).toBeNull();
    const key=crypto.randomUUID(); const createdEvent=event(a,"erp:stock.changed"); await service.moveStock(identity,{productPublicId:item.publicId,type:"manual_in",quantity:"1",reason:"Input",idempotencyKey:key}); await createdEvent; const replayEvent=event(a,"erp:stock.changed",300); await service.moveStock(identity,{productPublicId:item.publicId,type:"manual_in",quantity:"1",reason:"Input",idempotencyKey:key}); expect(await replayEvent).toBeNull();
  });

  it("delivers committed sale and stock events only to the sale tenant with minimal payloads", async () => {
    const a=client(await issueCookie("socket-user-a","socket-tenant-a")); await connected(a); const b=client(await issueCookie("socket-user-b","socket-tenant-b")); await connected(b);
    const f=await saleFixture("socket-tenant-a","socket-user-a"), service=new SaleService(new SaleRepository());
    const createdA=event(a,"erp:sale.changed"), createdB=event(b,"erp:sale.changed",300);
    const order=await service.create(f.identity,{crmClientId:f.crmClientId,notes:null,expectedDate:null,items:[{productPublicId:f.product.publicId,quantity:"1",unitPriceCents:100}]});
    const created=await createdA as Record<string,unknown>; expect(created).toMatchObject({publicId:order.publicId,operation:"created"}); expect(Object.keys(created).sort()).toEqual(["occurredAt","operation","publicId"]); expect(await createdB).toBeNull();
    const confirmedEvent=event(a,"erp:sale.changed"); await service.confirm(f.identity,order.publicId); expect(await confirmedEvent).toMatchObject({operation:"confirmed"});
    const saleEvent=event(a,"erp:sale.changed"), stockEvent=event(a,"erp:stock.changed"); const key=crypto.randomUUID(); await service.fulfill(f.identity,order.publicId,key); expect(await saleEvent).toMatchObject({operation:"fulfilled"}); expect(await stockEvent).toMatchObject({operation:"sale_fulfilled",productPublicId:f.product.publicId});
    const replaySale=event(a,"erp:sale.changed",300), replayStock=event(a,"erp:stock.changed",300); await service.fulfill(f.identity,order.publicId,key); expect(await replaySale).toBeNull(); expect(await replayStock).toBeNull();
  });

  it("does not deliver rolled-back sales and disconnects revoked or blocked sale recipients", async () => {
    const cookie=await issueCookie("socket-user-a","socket-tenant-a"), a=client(cookie); await connected(a); const f=await saleFixture("socket-tenant-a","socket-user-a"), service=new SaleService(new SaleRepository());
    const createdEvent=event(a,"erp:sale.changed"); const order=await service.create(f.identity,{crmClientId:f.crmClientId,notes:null,expectedDate:null,items:[{productPublicId:f.product.publicId,quantity:"3",unitPriceCents:100}]}); await createdEvent; const confirmedEvent=event(a,"erp:sale.changed"); await service.confirm(f.identity,order.publicId); await confirmedEvent;
    const failedSale=event(a,"erp:sale.changed",300), failedStock=event(a,"erp:stock.changed",300); await expect(service.fulfill(f.identity,order.publicId,crypto.randomUUID())).rejects.toMatchObject({code:"INSUFFICIENT_STOCK"}); expect(await failedSale).toBeNull(); expect(await failedStock).toBeNull();
    await revokeOperationalSession(request(cookie),repository); const revokedDisconnect=disconnected(a); await service.create(f.identity,{crmClientId:f.crmClientId,notes:null,expectedDate:null,items:[{productPublicId:f.product.publicId,quantity:"1",unitPriceCents:100}]}); expect(await revokedDisconnect).toBe(true);
    const blockedCookie=await issueCookie("socket-user-b","socket-tenant-b"), blocked=client(blockedCookie); await connected(blocked); const fb=await saleFixture("socket-tenant-b","socket-user-b"); await getPool().execute("UPDATE megadesk_domain_clients SET access_released=0 WHERE client_id='socket-tenant-b'"); const blockedDisconnect=disconnected(blocked); await new SaleService(new SaleRepository()).create(fb.identity,{crmClientId:fb.crmClientId,notes:null,expectedDate:null,items:[{productPublicId:fb.product.publicId,quantity:"1",unitPriceCents:100}]}); expect(await blockedDisconnect).toBe(true);
  });

  it("delivers a minimal supplier event only to the authenticated tenant room", async () => {
    const a=client(await issueCookie("socket-user-a","socket-tenant-a")); await connected(a); const b=client(await issueCookie("socket-user-b","socket-tenant-b")); await connected(b);
    const receivedA=event(a,"erp:supplier.changed"); const receivedB=event(b,"erp:supplier.changed",300);
    const created=await new SupplierService(new SupplierRepository()).create({clientId:"socket-tenant-a",userId:"socket-user-a",role:"admin"},{legalName:"Socket supplier",tradeName:null,personType:"legal",taxId:"12345678000190",stateRegistration:null,email:null,phone:null,contactName:null,postalCode:null,street:null,addressNumber:null,addressComplement:null,district:null,city:null,state:null,notes:null});
    const payload=await receivedA as Record<string,unknown>; expect(payload).toMatchObject({publicId:created.publicId,operation:"created"}); expect(Object.keys(payload).sort()).toEqual(["occurredAt","operation","publicId"]); expect(await receivedB).toBeNull();
  });

  it("disconnects revoked or blocked supplier event recipients", async () => {
    const revokedCookie=await issueCookie("socket-user-a","socket-tenant-a"); const revoked=client(revokedCookie); await connected(revoked); await revokeOperationalSession(request(revokedCookie),repository); const revokedDisconnect=disconnected(revoked);
    await new SupplierService(new SupplierRepository()).create({clientId:"socket-tenant-a",userId:"socket-user-a",role:"admin"},{legalName:"Revoked event",tradeName:null,personType:"legal",taxId:"12345678000191",stateRegistration:null,email:null,phone:null,contactName:null,postalCode:null,street:null,addressNumber:null,addressComplement:null,district:null,city:null,state:null,notes:null}); expect(await revokedDisconnect).toBe(true);
    const blockedCookie=await issueCookie("socket-user-b","socket-tenant-b"); const blocked=client(blockedCookie); await connected(blocked); await getPool().execute("UPDATE megadesk_domain_clients SET access_released=0 WHERE client_id='socket-tenant-b'"); const blockedDisconnect=disconnected(blocked);
    await new SupplierService(new SupplierRepository()).create({clientId:"socket-tenant-b",userId:"socket-user-b",role:"manager"},{legalName:"Blocked event",tradeName:null,personType:"legal",taxId:"12345678000192",stateRegistration:null,email:null,phone:null,contactName:null,postalCode:null,street:null,addressNumber:null,addressComplement:null,district:null,city:null,state:null,notes:null}); expect(await blockedDisconnect).toBe(true);
  });
});
