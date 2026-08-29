import { describe, expect, it, vi } from "vitest";
import { executeOutboundAttempt, OutboundAttemptAlreadyRecordedError, OutboundReconciliationError } from "./conversation-outbound";

const input = {
  messageId: "local-1", clientAttemptId: "attempt-1", conversationId: "conv-1", clientId: "tenant-a", provider: "evolution",
  integrationId: "instance-a", messageType: "text", sender: "agent" as const, text: "hello",
  timestamp: new Date("2026-08-29T12:00:00Z"), legacyMessage: { from: "agent", text: "hello" },
};

function pool(options: { insertError?: Error; reconciliationError?: Error; existing?: any } = {}) {
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined), commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
    execute: vi.fn(async (sql: string) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("client_attempt_id") && sql.includes("SELECT message_id")) return [[options.existing].filter(Boolean)];
      if (sql.includes("INSERT INTO megadesk_domain_conversations_messages") && options.insertError) throw options.insertError;
      if (sql.includes("SELECT messages_json")) return [[{ messages_json: "[]" }]];
      return [{ affectedRows: 1 }];
    }),
  };
  const execute = vi.fn(async () => {
    if (options.reconciliationError) throw options.reconciliationError;
    return [{ affectedRows: 1 }];
  });
  return { value: { getConnection: vi.fn(async () => connection), execute } as any, connection, execute };
}

describe("outbound tracked workflow", () => {
  it("commits pending before provider and reconciles the same row", async () => {
    const db = pool();
    const send = vi.fn(async () => {
      expect(db.connection.commit).toHaveBeenCalledOnce();
      return { key: { id: "provider-1" } };
    });
    await expect(executeOutboundAttempt(db.value, input, send)).resolves.toMatchObject({ status: "sent", externalMessageId: "provider-1" });
    expect(db.execute.mock.calls[0][1]).toEqual(["sent", "provider-1", "local-1", "conv-1", "tenant-a", "evolution", "instance-a"]);
  });

  it("never calls provider when initial persistence fails", async () => {
    const db = pool({ insertError: new Error("database unavailable") });
    const send = vi.fn();
    await expect(executeOutboundAttempt(db.value, input, send)).rejects.toThrow("database unavailable");
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the local row and marks failure when provider fails", async () => {
    const db = pool();
    await expect(executeOutboundAttempt(db.value, input, async () => { throw new Error("provider failed"); })).rejects.toThrow("provider failed");
    expect(db.connection.commit).toHaveBeenCalledOnce();
    expect(db.execute.mock.calls[0][1][0]).toBe("failed");
  });

  it("leaves a reconcilable pending row when post-provider update fails", async () => {
    const db = pool({ reconciliationError: new Error("update failed") });
    await expect(executeOutboundAttempt(db.value, input, async () => ({ key: { id: "provider-1" } })))
      .rejects.toBeInstanceOf(OutboundReconciliationError);
    expect(db.connection.commit).toHaveBeenCalledOnce();
  });

  it("returns an already-sent attempt without calling provider", async () => {
    const db = pool({ existing: { message_id: "stored-1", status: "sent", external_message_id: "provider-1" } });
    const send = vi.fn();
    await expect(executeOutboundAttempt(db.value, input, send)).resolves.toEqual({ messageId: "stored-1", externalMessageId: "provider-1", status: "sent" });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["pending", "failed"])("does not blindly resend an existing %s attempt", async (status) => {
    const db = pool({ existing: { message_id: "stored-1", status, external_message_id: null } });
    const send = vi.fn();
    await expect(executeOutboundAttempt(db.value, input, send)).rejects.toBeInstanceOf(OutboundAttemptAlreadyRecordedError);
    expect(send).not.toHaveBeenCalled();
  });
});
