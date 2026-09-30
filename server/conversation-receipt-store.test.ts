import { describe, expect, it, vi } from "vitest";
import {
  cleanupExpiredConversationReceipts,
  CONVERSATION_RECEIPT_STATUS_RANK,
  persistOrApplyConversationReceipt,
  reconcilePendingConversationReceipt,
  strongestConversationReceiptStatus,
  type ConversationReceiptInput,
  type ConversationReceiptStatus,
  type ReceiptSqlExecutor,
} from "./conversation-receipt-store";

type Message = { messageId: string; clientId: string; provider: string; integrationId: string; externalMessageId: string; status: ConversationReceiptStatus };
type Pending = ConversationReceiptInput & { receiptId: string; expiresAt: Date; replayState: "pending" | "replayed"; messageId: string | null };

class MemoryReceiptDatabase implements ReceiptSqlExecutor {
  messages: Message[] = [];
  receipts = new Map<string, Pending>();

  private key(value: { clientId: string; provider: string; integrationId: string; externalMessageId: string }) {
    return [value.clientId, value.provider, value.integrationId, value.externalMessageId].join("\0");
  }

  async execute(sql: string, values: unknown[] = []): Promise<[unknown, unknown?]> {
    if (sql.startsWith("DELETE FROM megadesk_conversation_pending_receipts")) {
      let deleted = 0;
      for (const [key, receipt] of this.receipts) {
        if (receipt.expiresAt <= new Date() && deleted < 100) { this.receipts.delete(key); deleted += 1; }
      }
      return [{ affectedRows: deleted }];
    }
    if (sql.startsWith("UPDATE megadesk_domain_conversations_messages")) {
      const [status, clientId, provider, integrationId, externalMessageId] = values as string[];
      const message = this.messages.find(row => row.clientId === clientId && row.provider === provider
        && row.integrationId === integrationId && row.externalMessageId === externalMessageId);
      if (!message || message.status === "failed") return [{ affectedRows: 0 }];
      const next = strongestConversationReceiptStatus(message.status, status as ConversationReceiptStatus);
      const canFail = status === "failed" && ["pending", "sent"].includes(message.status);
      if (next === message.status || (status === "failed" && !canFail)) return [{ affectedRows: 0 }];
      message.status = next;
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM megadesk_domain_conversations_messages")) {
      const [clientId, provider, integrationId, externalMessageId] = values as string[];
      const message = this.messages.find(row => row.clientId === clientId && row.provider === provider
        && row.integrationId === integrationId && row.externalMessageId === externalMessageId);
      return [[...(message ? [{ messageId: message.messageId, status: message.status }] : [])]];
    }
    if (sql.startsWith("INSERT INTO megadesk_conversation_pending_receipts")) {
      const [receiptId, clientId, provider, integrationId, externalMessageId, status, , providerEventAt, receivedAt, expiresAt] = values;
      const incoming = { clientId, provider, integrationId, externalMessageId } as ConversationReceiptInput;
      const key = this.key(incoming);
      const current = this.receipts.get(key);
      const incomingStatus = status as ConversationReceiptStatus;
      if (!current) {
        this.receipts.set(key, { ...incoming, receiptId: String(receiptId), status: incomingStatus,
          providerEventAt: providerEventAt instanceof Date ? providerEventAt.toISOString() : null,
          receivedAt: receivedAt as Date, expiresAt: expiresAt as Date, replayState: "pending", messageId: null });
      } else {
        current.status = strongestConversationReceiptStatus(current.status, incomingStatus);
        current.replayState = "pending";
        current.messageId = null;
      }
      return [{ affectedRows: current ? 2 : 1 }];
    }
    if (sql.includes("FROM megadesk_conversation_pending_receipts")) {
      const [clientId, provider, integrationId, externalMessageId] = values as string[];
      const receipt = this.receipts.get(this.key({ clientId, provider, integrationId, externalMessageId }));
      if (!receipt || (sql.includes("replay_state = 'pending'") && (receipt.replayState !== "pending" || receipt.expiresAt <= new Date()))) return [[]];
      return [[{ receiptId: receipt.receiptId, status: receipt.status }]];
    }
    if (sql.startsWith("UPDATE megadesk_conversation_pending_receipts")) {
      const [messageId, receiptId, clientId, provider, integrationId, externalMessageId] = values as string[];
      const receipt = this.receipts.get(this.key({ clientId, provider, integrationId, externalMessageId }));
      if (!receipt || receipt.receiptId !== receiptId || receipt.replayState !== "pending") return [{ affectedRows: 0 }];
      receipt.replayState = "replayed";
      receipt.messageId = messageId;
      return [{ affectedRows: 1 }];
    }
    throw new Error(`UNEXPECTED_SQL:${sql}`);
  }
}

const receipt = (overrides: Partial<ConversationReceiptInput> = {}): ConversationReceiptInput => ({
  clientId: "tenant-a",
  provider: "evolution",
  integrationId: "instance-a",
  externalMessageId: "provider-message-1",
  status: "delivered",
  providerEventAt: "2026-09-30T12:00:00.000Z",
  receivedAt: new Date(),
  ...overrides,
});

describe("pending conversation receipt reconciliation", () => {
  it("CAUSAL persists zero-match durably and applies it after the external ID appears", async () => {
    const database = new MemoryReceiptDatabase();
    await expect(persistOrApplyConversationReceipt(database, receipt())).resolves.toMatchObject({ deferred: true, zeroMatch: true });
    const restartedProcess = database as ReceiptSqlExecutor;
    database.messages.push({ messageId: "local-1", ...receipt(), status: "sent" });
    await expect(reconcilePendingConversationReceipt(restartedProcess, receipt())).resolves.toMatchObject({ reconciled: true, applied: true, storedStatus: "delivered" });
    expect(database.messages[0].status).toBe("delivered");
    expect([...database.receipts.values()][0]).toMatchObject({ replayState: "replayed", messageId: "local-1" });
  });

  it("CAUSAL aggregates duplicate and out-of-order receipts monotonically", async () => {
    const database = new MemoryReceiptDatabase();
    for (const status of ["delivered", "read", "read", "delivered"] as const) {
      await persistOrApplyConversationReceipt(database, receipt({ status }));
    }
    expect(database.receipts.size).toBe(1);
    expect([...database.receipts.values()][0].status).toBe("read");
    database.messages.push({ messageId: "local-1", ...receipt(), status: "sent" });
    await reconcilePendingConversationReceipt(database, receipt());
    expect(database.messages[0].status).toBe("read");
  });

  it("CAUSAL keeps the original bounded expiry when duplicate receipts arrive", async () => {
    const database = new MemoryReceiptDatabase();
    const firstReceivedAt = new Date("2026-09-30T12:00:00.000Z");
    await persistOrApplyConversationReceipt(database, receipt({ receivedAt: firstReceivedAt }));
    const originalExpiry = [...database.receipts.values()][0].expiresAt.getTime();
    await persistOrApplyConversationReceipt(database, receipt({
      status: "read",
      receivedAt: new Date("2026-10-03T12:00:00.000Z"),
    }));
    expect([...database.receipts.values()][0].expiresAt.getTime()).toBe(originalExpiry);
  });

  it.each([
    ["read", "delivered", "read", false],
    ["played", "delivered", "played", false],
    ["read", "read", "read", false],
    ["delivered", "failed", "delivered", false],
    ["sent", "failed", "failed", true],
  ] as const)("CAUSAL does not regress %s with a late %s", async (initial, late, expected, applied) => {
    const database = new MemoryReceiptDatabase();
    database.messages.push({ messageId: "local-1", ...receipt(), status: initial });
    await expect(persistOrApplyConversationReceipt(database, receipt({ status: late }))).resolves.toMatchObject({ deferred: false, applied });
    expect(database.messages[0].status).toBe(expected);
  });

  it("CAUSAL isolates equal provider IDs between tenants and integrations", async () => {
    const database = new MemoryReceiptDatabase();
    await persistOrApplyConversationReceipt(database, receipt({ clientId: "tenant-a", integrationId: "instance-a", status: "read" }));
    database.messages.push(
      { messageId: "a", ...receipt(), clientId: "tenant-a", integrationId: "instance-a", status: "sent" },
      { messageId: "b", ...receipt(), clientId: "tenant-b", integrationId: "instance-a", status: "sent" },
      { messageId: "c", ...receipt(), clientId: "tenant-a", integrationId: "instance-b", status: "sent" },
    );
    await reconcilePendingConversationReceipt(database, receipt({ clientId: "tenant-a", integrationId: "instance-a" }));
    expect(database.messages.map(row => row.status)).toEqual(["read", "sent", "sent"]);
  });

  it("CAUSAL is idempotent when reconciliation executes twice", async () => {
    const database = new MemoryReceiptDatabase();
    await persistOrApplyConversationReceipt(database, receipt({ status: "read" }));
    database.messages.push({ messageId: "local-1", ...receipt(), status: "sent" });
    await expect(reconcilePendingConversationReceipt(database, receipt())).resolves.toMatchObject({ reconciled: true });
    await expect(reconcilePendingConversationReceipt(database, receipt())).resolves.toEqual({ reconciled: false, applied: false, messageId: null, storedStatus: null });
    expect(database.messages[0].status).toBe("read");
  });

  it("CAUSAL converges after a crash-like message update before the replay marker", async () => {
    const database = new MemoryReceiptDatabase();
    await persistOrApplyConversationReceipt(database, receipt({ status: "read" }));
    database.messages.push({ messageId: "local-1", ...receipt(), status: "read" });
    await expect(reconcilePendingConversationReceipt(database, receipt())).resolves.toMatchObject({ reconciled: true, applied: false, storedStatus: "read" });
    expect([...database.receipts.values()][0].replayState).toBe("replayed");
  });

  it("CAUSAL never applies an expired receipt and cleanup is bounded", async () => {
    const database = new MemoryReceiptDatabase();
    await persistOrApplyConversationReceipt(database, receipt({ status: "read" }));
    [...database.receipts.values()][0].expiresAt = new Date(0);
    database.messages.push({ messageId: "local-1", ...receipt(), status: "sent" });
    await expect(reconcilePendingConversationReceipt(database, receipt())).resolves.toMatchObject({ reconciled: false });
    expect(database.messages[0].status).toBe("sent");
    await expect(cleanupExpiredConversationReceipts(database, 10)).resolves.toBe(1);
  });

  it("CONTRACT defines the successful order and a terminal failure sentinel", () => {
    expect(CONVERSATION_RECEIPT_STATUS_RANK).toEqual({ pending: 1, sent: 2, delivered: 3, read: 4, played: 5, failed: 6 });
  });

  it("STRUCTURAL scopes every lookup and mutation by tenant, provider, integration and external ID", async () => {
    const database = new MemoryReceiptDatabase();
    const execute = vi.fn(database.execute.bind(database));
    await persistOrApplyConversationReceipt({ execute }, receipt()).catch(() => undefined);
    for (const [sql] of execute.mock.calls) {
      if (!String(sql).includes("megadesk_domain_conversations_messages") && !String(sql).includes("megadesk_conversation_pending_receipts")) continue;
      expect(String(sql)).toMatch(/client_id/);
      expect(String(sql)).toMatch(/provider/);
      expect(String(sql)).toMatch(/integration_id/);
      expect(String(sql)).toMatch(/external_message_id/);
    }
  });
});
