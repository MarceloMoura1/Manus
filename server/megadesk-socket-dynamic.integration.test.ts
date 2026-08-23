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
  await getPool().execute("DELETE FROM erp_stock_movements WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_stock_balances WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_products WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM megadesk_operational_sessions WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM megadesk_domain_client_users WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM megadesk_domain_clients WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("INSERT INTO megadesk_domain_clients (client_id,internal_id,tenant_database_name,company,contact,phone,plan,status,status_type,access_released,api_token,modules_json,integrations_json) VALUES ('socket-tenant-a','socket-a','socket_db_a','Socket A','Fixture','00000000000','Test','active','test',1,'socket-a','[]','{}'),('socket-tenant-b','socket-b','socket_db_b','Socket B','Fixture','00000000000','Test','active','test',1,'socket-b','[]','{}')");
  await getPool().execute("INSERT INTO megadesk_domain_client_users (user_id,client_id,name,email,role,status,permissions_json) VALUES ('socket-user-a','socket-tenant-a','Socket A','socket-shared@example.invalid','agent','active','[]'),('socket-user-b','socket-tenant-b','Socket B','socket-shared@example.invalid','manager','active','[]')");
}

async function cleanFixtures() {
  await getPool().execute("DELETE FROM erp_stock_movements WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_stock_balances WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM erp_products WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM megadesk_operational_sessions WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM megadesk_domain_client_users WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
  await getPool().execute("DELETE FROM megadesk_domain_clients WHERE client_id IN ('socket-tenant-a','socket-tenant-b')");
}

dynamic("Socket.IO operational session isolation", () => {
  beforeAll(async () => {
    httpServer = createServer();
    initWhatsAppSocket(httpServer);
    await new Promise<void>(resolve => httpServer.listen(0, "127.0.0.1", resolve));
    socketUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  beforeEach(resetFixtures);
  afterEach(() => {
    for (const socket of clients) socket.disconnect();
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
});
