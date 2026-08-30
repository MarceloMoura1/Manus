import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { saveIncomingMessage } from "./evolution/webhook";
import { conversationsRouter } from "./routers-conversations";
import { appRouter } from "./routers";
import { executeOutboundAttempt, OutboundAttemptAlreadyRecordedError, OutboundReconciliationError } from "./conversation-outbound";

const physical = describe.runIf(process.env.RUN_DATABASE_INTEGRATION === "1");
const tenantA = "audit-conversations-tenant-a";
const tenantB = "audit-conversations-tenant-b";
const integrationA = "audit-evolution-instance-a";
const integrationB = "audit-evolution-instance-b";
const phone = "5511999990001";
const concurrentPhone = "5511999990002";
const activePhone = "5511999990003";
const closedA = "conv-a-closed-fixture";
const closedB = "conv-b-closed-fixture";

function caller(tenantId: string, userId: string, role: "admin" | "manager" | "agent" | "viewer" = "agent",
  permissions = ["conversations", "active-attendance"]) {
  return conversationsRouter.createCaller({ tenantId, operationalUserId: userId, operationalUserRole: role,
    operationalPermissions: permissions, userEmail: `${userId}@example.invalid`, req: { headers: {} } } as any);
}

function appCaller(tenantId: string, userId: string) {
  return appRouter.createCaller({ tenantId, operationalUserId: userId, operationalUserRole: "agent",
    operationalPermissions: ["conversations", "active-attendance"], userEmail: `${userId}@example.invalid`,
    user: null, req: { headers: {} }, res: {} } as any);
}

async function rows(sql: string, values: unknown[] = []) {
  const [result] = await getPool().execute<RowDataPacket[]>(sql, values);
  return result;
}

async function scalar(sql: string, values: unknown[] = []) {
  return Number((await rows(sql, values))[0]?.value ?? 0);
}

async function fingerprints() {
  return {
    waAccounts: await scalar("SELECT COUNT(*) value FROM wa_accounts"),
    waConversations: await scalar("SELECT COUNT(*) value FROM wa_conversations"),
    waMessages: await scalar("SELECT COUNT(*) value FROM wa_messages"),
  };
}

async function reset() {
  const pool = getPool();
  await pool.execute("DELETE FROM megadesk_conversation_events WHERE client_id IN (?,?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_domain_conversations_messages WHERE client_id IN (?,?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_domain_conversations WHERE client_id IN (?,?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_conversation_contacts WHERE client_id IN (?,?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_domain_customers WHERE clientId IN (?,?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_evolution_sessions WHERE client_id IN (?,?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_domain_client_users WHERE client_id IN (?,?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_domain_clients WHERE client_id IN (?,?)", [tenantA, tenantB]);
}

physical.sequential("Conversations 0013 physical lifecycle", () => {
  let waBefore: Awaited<ReturnType<typeof fingerprints>>;
  let inboundA = "";
  let inboundCode = "";
  let outboundId = "";

  beforeAll(async () => {
    await reset();
    const pool = getPool();
    await pool.execute(
      `INSERT INTO megadesk_domain_clients
       (client_id,internal_id,tenant_database_name,company,contact,email,phone,plan,status,status_type,access_released,api_token,modules_json,integrations_json)
       VALUES (?,?,?,?,?,?,?,?, 'active','test',1,?,?,?), (?,?,?,?,?,?,?,?, 'active','test',1,?,?,?)`,
      [tenantA,"audit-internal-a","audit_db_a","Synthetic Tenant A","Synthetic","tenant-a@example.invalid","00000000001","audit","token-a",'["conversations","active-attendance"]','{}',
       tenantB,"audit-internal-b","audit_db_b","Synthetic Tenant B","Synthetic","tenant-b@example.invalid","00000000002","audit","token-b",'["conversations","active-attendance"]','{}'],
    );
    await pool.execute(
      `INSERT INTO megadesk_domain_client_users
       (user_id,client_id,name,email,role,status,permissions_json) VALUES
       ('audit-admin-a',?,'Synthetic Admin','admin-a@example.invalid','admin','active','["conversations","active-attendance"]'),
       ('audit-manager-a',?,'Synthetic Manager','manager-a@example.invalid','manager','active','["conversations","active-attendance"]'),
       ('audit-agent-a',?,'Synthetic Agent A','agent-a@example.invalid','agent','active','["conversations","active-attendance"]'),
       ('audit-agent-b',?,'Synthetic Agent B','agent-b@example.invalid','agent','active','["conversations","active-attendance"]'),
       ('audit-inactive-a',?,'Synthetic Inactive','inactive-a@example.invalid','agent','blocked','["conversations","active-attendance"]'),
       ('audit-viewer-a',?,'Synthetic Viewer','viewer-a@example.invalid','viewer','active','["conversations"]'),
       ('audit-admin-b',?,'Synthetic Admin B','admin-b@example.invalid','admin','active','["conversations","active-attendance"]')`,
      [tenantA,tenantA,tenantA,tenantA,tenantA,tenantA,tenantB],
    );
    await pool.execute(
      "INSERT INTO megadesk_evolution_sessions (client_id,instance_name,status) VALUES (?,?,'connected'),(?,?,'connected')",
      [tenantA,integrationA,tenantB,integrationB],
    );
    await pool.execute(
      `INSERT INTO megadesk_conversation_contacts
       (contact_id,client_id,display_name,canonical_phone,channel,provider,external_identity)
       VALUES ('contact-a',?,'Synthetic Person',?,'whatsapp','evolution',?),
              ('contact-b',?,'Synthetic Person B',?,'whatsapp','evolution',?)`,
      [tenantA,phone,phone,tenantB,phone,phone],
    );
    await pool.execute(
      `INSERT INTO megadesk_domain_conversations
       (conversation_id,client_id,public_code,contact_id,origin,channel,provider,integration_id,customer_name,phone,company,status,last_message,time_label,messages_json,closed_at)
       VALUES (?,?,'CV-260830000000-A001','contact-a','inbound','whatsapp','evolution',?,'Synthetic Person',?,'','closed','Closed fixture','','[]',NOW()),
              (?,?,'CV-260830000000-B001','contact-b','inbound','whatsapp','evolution',?,'Synthetic Person B',?,'','closed','Closed fixture','','[]',NOW())`,
      [closedA,tenantA,integrationA,phone,closedB,tenantB,integrationB,phone],
    );
    waBefore = await fingerprints();
  });

  afterAll(async () => {
    expect(await fingerprints()).toEqual(waBefore);
    await reset();
    await getPool().end();
  });

  it("creates a new unassigned bot after closed history and deduplicates the same event", async () => {
    expect(await saveIncomingMessage(tenantA,integrationA,"audit-event-1",[phone],"Synthetic Person","Synthetic inbound",new Date())).toBe("persisted");
    const active = await rows("SELECT conversation_id,public_code,status,assigned_user_id FROM megadesk_domain_conversations WHERE client_id=? AND phone=? AND status IN ('open','bot')",[tenantA,phone]);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ status: "bot", assigned_user_id: null });
    expect(active[0].conversation_id).not.toBe(closedA);
    expect(active[0].public_code).toMatch(/^CV-/);
    inboundA = active[0].conversation_id;
    inboundCode = active[0].public_code;
    expect(await scalar("SELECT COUNT(*) value FROM megadesk_domain_conversations_messages WHERE client_id=? AND external_message_id='audit-event-1'",[tenantA])).toBe(1);
    expect(await scalar("SELECT COUNT(*) value FROM megadesk_conversation_events WHERE client_id=? AND conversation_id=? AND event_type='created_inbound'",[tenantA,inboundA])).toBe(1);
    expect((await rows("SELECT status,last_message FROM megadesk_domain_conversations WHERE conversation_id=?",[closedA]))[0]).toMatchObject({ status: "closed", last_message: "Closed fixture" });
    expect(await saveIncomingMessage(tenantA,integrationA,"audit-event-1",[phone],"Synthetic Person","Synthetic inbound",new Date())).toBe("duplicate");
    expect(await scalar("SELECT COUNT(*) value FROM megadesk_domain_conversations WHERE client_id=? AND phone=? AND status IN ('open','bot')",[tenantA,phone])).toBe(1);
  });

  it("serializes two distinct simultaneous first events into one attendance", async () => {
    await getPool().execute(
      `INSERT INTO megadesk_conversation_contacts (contact_id,client_id,display_name,canonical_phone,channel,provider,external_identity)
       VALUES ('contact-concurrent',?,'Synthetic Concurrent',?,'whatsapp','evolution',?)`,[tenantA,concurrentPhone,concurrentPhone]);
    const results = await Promise.all([
      saveIncomingMessage(tenantA,integrationA,"audit-concurrent-1",[concurrentPhone],"Synthetic Concurrent","First",new Date()),
      saveIncomingMessage(tenantA,integrationA,"audit-concurrent-2",[concurrentPhone],"Synthetic Concurrent","Second",new Date()),
    ]);
    expect(results).toEqual(["persisted","persisted"]);
    expect(await scalar("SELECT COUNT(*) value FROM megadesk_domain_conversations WHERE client_id=? AND phone=? AND status IN ('open','bot')",[tenantA,concurrentPhone])).toBe(1);
    expect(await scalar("SELECT COUNT(*) value FROM megadesk_domain_conversations_messages WHERE client_id=? AND external_message_id IN ('audit-concurrent-1','audit-concurrent-2')",[tenantA])).toBe(2);
  });

  it("isolates the same canonical phone across tenants", async () => {
    await saveIncomingMessage(tenantB,integrationB,"audit-event-b",[phone],"Synthetic Person B","Tenant B inbound",new Date());
    const other = await rows("SELECT conversation_id,public_code,status FROM megadesk_domain_conversations WHERE client_id=? AND phone=? AND status IN ('open','bot')",[tenantB,phone]);
    expect(other).toHaveLength(1);
    expect(other[0].conversation_id).not.toBe(inboundA);
    expect(other[0].public_code).not.toBe(inboundCode);
    expect(await scalar("SELECT COUNT(*) value FROM megadesk_domain_conversations_messages WHERE client_id=? AND conversation_id=?",[tenantB,inboundA])).toBe(0);
  });

  it("allows only one claim winner and updates backend filters", async () => {
    const [a,b] = await Promise.allSettled([
      caller(tenantA,"audit-agent-a").claim({ conversationId: inboundA }),
      caller(tenantA,"audit-agent-b").claim({ conversationId: inboundA }),
    ]);
    expect([a,b].filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect([a,b].filter(result => result.status === "rejected")).toHaveLength(1);
    const owner = (await rows("SELECT assigned_user_id,status FROM megadesk_domain_conversations WHERE conversation_id=? AND client_id=?",[inboundA,tenantA]))[0];
    expect(owner.status).toBe("open");
    const mine = await caller(tenantA,owner.assigned_user_id).list({ viewMode:"mine",status:"active",search:"",limit:30,offset:0 });
    expect(mine.some(item => item.id === inboundA)).toBe(true);
    const waiting = await caller(tenantA,owner.assigned_user_id).list({ viewMode:"waiting",status:"active",search:"",limit:30,offset:0 });
    expect(waiting.some(item => item.id === inboundA)).toBe(false);
  });

  it("transfers atomically, rejects invalid targets and stale ownership", async () => {
    const current = (await rows("SELECT assigned_user_id FROM megadesk_domain_conversations WHERE conversation_id=?",[inboundA]))[0].assigned_user_id;
    const target = current === "audit-agent-a" ? "audit-agent-b" : "audit-agent-a";
    await expect(caller(tenantA,current).transfer({ conversationId:inboundA,targetUserId:"audit-inactive-a",expectedAssignedUserId:current })).rejects.toMatchObject({ code:"BAD_REQUEST" });
    await expect(caller(tenantA,current).transfer({ conversationId:inboundA,targetUserId:"audit-admin-b",expectedAssignedUserId:current })).rejects.toMatchObject({ code:"BAD_REQUEST" });
    await expect(caller(tenantA,current).transfer({ conversationId:inboundA,targetUserId:"audit-viewer-a",expectedAssignedUserId:current })).rejects.toMatchObject({ code:"BAD_REQUEST" });
    const moved = await caller(tenantA,current).transfer({ conversationId:inboundA,targetUserId:target,expectedAssignedUserId:current });
    expect(moved.assignedUserId).toBe(target);
    await expect(caller(tenantA,current).transfer({ conversationId:inboundA,targetUserId:current,expectedAssignedUserId:current })).rejects.toMatchObject({ code:"CONFLICT" });
    const self = await caller(tenantA,target).transfer({ conversationId:inboundA,targetUserId:target,expectedAssignedUserId:target });
    expect(self).toMatchObject({ unchanged:true,assignedUserId:target });
    expect((await caller(tenantA,current).list({ viewMode:"mine",status:"active",search:"",limit:30,offset:0 })).some(item=>item.id===inboundA)).toBe(false);
    expect((await caller(tenantA,target).list({ viewMode:"mine",status:"active",search:"",limit:30,offset:0 })).some(item=>item.id===inboundA)).toBe(true);
  });

  it("closes, creates a new inbound cycle, and explicitly protects reopen", async () => {
    const before = (await rows("SELECT public_code,assigned_user_id FROM megadesk_domain_conversations WHERE conversation_id=?",[inboundA]))[0];
    await caller(tenantA,before.assigned_user_id).close({ conversationId:inboundA,reason:"Synthetic close" });
    const closed = (await rows("SELECT conversation_id,public_code,status,closed_by_user_id,closed_at FROM megadesk_domain_conversations WHERE conversation_id=?",[inboundA]))[0];
    expect(closed).toMatchObject({ conversation_id:inboundA,public_code:inboundCode,status:"closed",closed_by_user_id:before.assigned_user_id });
    await saveIncomingMessage(tenantA,integrationA,"audit-event-after-close",[phone],"Synthetic Person","New cycle",new Date());
    const next = (await rows("SELECT conversation_id,public_code,status,assigned_user_id FROM megadesk_domain_conversations WHERE client_id=? AND phone=? AND status IN ('open','bot')",[tenantA,phone]))[0];
    expect(next.conversation_id).not.toBe(inboundA);
    expect(next.public_code).not.toBe(inboundCode);
    expect(next).toMatchObject({ status:"bot",assigned_user_id:null });
    expect(await scalar("SELECT COUNT(*) value FROM megadesk_domain_conversations_messages WHERE conversation_id=? AND external_message_id='audit-event-after-close'",[inboundA])).toBe(0);
    await expect(caller(tenantA,"audit-agent-a").reopen({ conversationId:inboundA })).rejects.toMatchObject({ code:"CONFLICT" });
    await caller(tenantA,"audit-agent-a").close({ conversationId:next.conversation_id });
    await caller(tenantA,"audit-agent-a").reopen({ conversationId:inboundA });
    expect((await rows("SELECT conversation_id,public_code,status,assigned_user_id FROM megadesk_domain_conversations WHERE conversation_id=?",[inboundA]))[0])
      .toMatchObject({ conversation_id:inboundA,public_code:inboundCode,status:"open",assigned_user_id:"audit-agent-a" });
  });

  it("starts outbound attendance once without automatically creating a message", async () => {
    await getPool().execute("INSERT INTO megadesk_domain_customers (customerId,clientId,name,phone,company) VALUES ('customer-active',?,'Synthetic Active',?,'Synthetic Company')",[tenantA,activePhone]);
    const input = { customerId:"customer-active",customerName:"Synthetic Active",phone:activePhone,company:"Synthetic Company",clientId:tenantA };
    const first = await appCaller(tenantA,"audit-agent-a").megadesk.createConversation(input);
    outboundId = first.conversationId;
    const second = await appCaller(tenantA,"audit-agent-a").megadesk.createConversation(input);
    expect(second.conversationId).toBe(first.conversationId);
    const created = (await rows("SELECT conversation_id,public_code,status,assigned_user_id FROM megadesk_domain_conversations WHERE conversation_id=? AND client_id=?",[first.conversationId,tenantA]))[0];
    expect(created).toMatchObject({ status:"open",assigned_user_id:"audit-agent-a" });
    expect(created.public_code).toMatch(/^CV-/);
    expect(await scalar("SELECT COUNT(*) value FROM megadesk_domain_conversations_messages WHERE client_id=? AND conversation_id=?",[tenantA,first.conversationId])).toBe(0);
  });

  it("tracks outbound provider outcomes physically without blind retry or cross-tenant attempts", async () => {
    const attempt = (suffix: string, clientId = tenantA, conversationId = outboundId) => ({
      messageId: `audit-out-${suffix}-${clientId}`, clientAttemptId: `audit-attempt-${suffix}`,
      conversationId, clientId, provider: "evolution", integrationId: clientId === tenantA ? integrationA : integrationB,
      messageType: "text", sender: "agent" as const, senderUserId: clientId === tenantA ? "audit-agent-a" : "audit-admin-b",
      senderNameSnapshot: "Synthetic Operator", text: "Synthetic outbound", timestamp: new Date(),
      legacyMessage: { from: "agent", text: "Synthetic outbound" },
    });
    const sent = attempt("sent");
    let pendingSeen = false;
    await executeOutboundAttempt(getPool(), sent, async () => {
      pendingSeen = (await rows("SELECT status FROM megadesk_domain_conversations_messages WHERE message_id=?", [sent.messageId]))[0]?.status === "pending";
      return { key: { id: "audit-provider-sent" } };
    });
    expect(pendingSeen).toBe(true);
    expect((await rows("SELECT status,external_message_id FROM megadesk_domain_conversations_messages WHERE message_id=?", [sent.messageId]))[0])
      .toMatchObject({ status: "sent", external_message_id: "audit-provider-sent" });
    let repeated = 0;
    await executeOutboundAttempt(getPool(), sent, async () => { repeated++; return { key: { id: "unexpected" } }; });
    expect(repeated).toBe(0);

    for (const [suffix, provider] of [
      ["missing-id", async () => ({ key: {} })],
      ["known-failure", async () => { throw new Error("synthetic provider 422"); }],
      ["timeout", async () => { throw new Error("synthetic timeout"); }],
    ] as const) {
      const input = attempt(suffix);
      await expect(executeOutboundAttempt(getPool(), input, provider as any)).rejects.toThrow();
      expect((await rows("SELECT status FROM megadesk_domain_conversations_messages WHERE message_id=?", [input.messageId]))[0]?.status).toBe("failed");
      await expect(executeOutboundAttempt(getPool(), input, async () => ({ key: { id: "blind-retry" } }))).rejects.toBeInstanceOf(OutboundAttemptAlreadyRecordedError);
    }

    const tenantBConversation = (await rows("SELECT conversation_id FROM megadesk_domain_conversations WHERE client_id=? AND status IN ('open','bot') LIMIT 1", [tenantB]))[0].conversation_id;
    const isolated = attempt("sent", tenantB, tenantBConversation);
    await expect(executeOutboundAttempt(getPool(), isolated, async () => ({ key: { id: "audit-provider-tenant-b" } }))).resolves.toMatchObject({ status: "sent" });

    const uncertain = attempt("uncertain");
    const realPool = getPool();
    const reconciliationPool = new Proxy(realPool as any, { get(target, property) {
      if (property === "execute") return async (sql: string, values: unknown[]) => {
        if (sql.includes("SET status = ?") && values[0] === "sent") throw new Error("synthetic reconciliation failure");
        return target.execute(sql, values);
      };
      const value = target[property]; return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(executeOutboundAttempt(reconciliationPool, uncertain, async () => ({ key: { id: "audit-provider-uncertain" } })))
      .rejects.toBeInstanceOf(OutboundReconciliationError);
    expect((await rows("SELECT status FROM megadesk_domain_conversations_messages WHERE message_id=?", [uncertain.messageId]))[0]?.status).toBe("pending");
  });

  it("finishes with zero physical collisions, cross-tenant rows, or orphans", async () => {
    expect(await scalar("SELECT COUNT(*) value FROM (SELECT public_code FROM megadesk_domain_conversations WHERE client_id IN (?,?) GROUP BY public_code HAVING COUNT(*)>1) duplicates",[tenantA,tenantB])).toBe(0);
    expect(await scalar("SELECT COUNT(*) value FROM (SELECT client_id,active_key FROM megadesk_domain_conversations WHERE client_id IN (?,?) AND active_key IS NOT NULL GROUP BY client_id,active_key HAVING COUNT(*)>1) duplicates",[tenantA,tenantB])).toBe(0);
    expect(await scalar("SELECT COUNT(*) value FROM (SELECT client_id,provider,integration_id,external_message_id FROM megadesk_domain_conversations_messages WHERE client_id IN (?,?) AND external_message_id IS NOT NULL GROUP BY client_id,provider,integration_id,external_message_id HAVING COUNT(*)>1) duplicates",[tenantA,tenantB])).toBe(0);
    expect(await scalar("SELECT COUNT(*) value FROM megadesk_domain_conversations_messages m LEFT JOIN megadesk_domain_conversations c ON c.client_id=m.client_id AND c.conversation_id=m.conversation_id WHERE m.client_id IN (?,?) AND c.conversation_id IS NULL",[tenantA,tenantB])).toBe(0);
    expect(await fingerprints()).toEqual(waBefore);
  });
});
