import { describe, expect, it, vi } from "vitest";
import { canonicalMessageMirror, persistCanonicalMessage, type CanonicalMessageWrite } from "./conversation-message-store";
import { upsertConversationStateSnapshot } from "./db";

function statefulConnection() {
  let messagesJson = "[]";
  const execute = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("INSERT INTO megadesk_domain_conversations_messages")) return [{ affectedRows: 1 }];
    if (sql.includes("SELECT messages_json")) return [[{ messages_json: messagesJson }]];
    if (sql.includes("UPDATE megadesk_domain_conversations SET messages_json")) {
      messagesJson = String(values[0]);
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO megadesk_domain_conversations")) {
      // Simulates the existing-row side of the upsert. The old sync would have
      // replaced this value with values[8].
      if (sql.includes("messages_json=VALUES(messages_json)")) messagesJson = String(values[8]);
      return [{ affectedRows: 1 }];
    }
    return [{ affectedRows: 1 }];
  });
  return { connection: { execute }, messages: () => JSON.parse(messagesJson) as Record<string, unknown>[] };
}

async function persistThenSync(write: CanonicalMessageWrite, cache: Record<string, unknown>) {
  const state = statefulConnection();
  await expect(persistCanonicalMessage(state.connection as any, write)).resolves.toBe(true);
  const storedBeforeSync = state.messages();
  await upsertConversationStateSnapshot(state.connection as any, {
    id: write.conversationId,
    clientId: write.clientId,
    name: "Pessoa",
    phone: "5511999999999",
    company: "",
    status: "open",
    lastMessage: write.text,
    time: "12:00",
    messages: [cache],
  });
  return { state, storedBeforeSync };
}

describe("canonical message mirror through global sync", () => {
  it("keeps an outbound text mirror identified after a later state sync", async () => {
    const write: CanonicalMessageWrite = {
      messageId: "msg-text-1", clientAttemptId: "attempt-text-1", conversationId: "conv-1", clientId: "tenant-a",
      externalMessageId: null, provider: "evolution", integrationId: "instance-a", direction: "outbound",
      messageType: "text", sender: "agent", text: "Pedido recebido", status: "pending",
      timestamp: new Date("2026-09-02T15:00:00.000Z"), replyToMessageId: "original-1",
      legacyMessage: { from: "agent", text: "Pedido recebido", time: "12:00" },
    };
    const cache = canonicalMessageMirror({ ...write, externalMessageId: "provider-text-1", status: "sent" });
    const { state, storedBeforeSync } = await persistThenSync(write, cache);

    expect(storedBeforeSync).toEqual([expect.objectContaining({ id: "msg-text-1", clientAttemptId: "attempt-text-1",
      replyToMessageId: "original-1", direction: "outbound", timestamp: "2026-09-02T15:00:00.000Z" })]);
    expect(cache).toMatchObject({ id: "msg-text-1", externalMessageId: "provider-text-1", status: "sent" });
    expect(state.messages()).toEqual(storedBeforeSync);
    expect(state.messages()).toHaveLength(1);
    expect(state.messages()[0].id).toBe("msg-text-1");
  });

  it("keeps outbound media lightweight and identified through the same sync path", async () => {
    const heavy = `data:image/png;base64,${"A".repeat(20_000)}`;
    const write: CanonicalMessageWrite = {
      messageId: "msg-media-1", clientAttemptId: "attempt-media-1", conversationId: "conv-2", clientId: "tenant-a",
      externalMessageId: null, provider: "evolution", integrationId: "instance-a", direction: "outbound",
      messageType: "image", sender: "agent", text: "Foto", status: "pending",
      timestamp: new Date("2026-09-02T15:01:00.000Z"), replyToMessageId: "original-media-1",
      legacyMessage: { from: "agent", type: "image", text: "Foto", time: "12:01", mediaData: heavy, mimeType: "image/png" },
      mediaReference: { mediaData: heavy, mimeType: "image/png", fileName: "foto.png" },
      providerMessageReference: { key: { id: "provider-media-1" }, message: { imageMessage: { base64: heavy } } },
    };
    const cache = canonicalMessageMirror({ ...write, externalMessageId: "provider-media-1", status: "sent" });
    const { state, storedBeforeSync } = await persistThenSync(write, cache);

    expect(cache).toMatchObject({ id: "msg-media-1", externalMessageId: "provider-media-1",
      clientAttemptId: "attempt-media-1", replyToMessageId: "original-media-1",
      mediaReference: { storage: "normalized", messageId: "msg-media-1" } });
    expect(JSON.stringify(cache)).not.toContain("A".repeat(100));
    expect(state.messages()).toEqual(storedBeforeSync);
    expect(state.messages()).toHaveLength(1);
    expect(state.messages()[0]).toMatchObject({ id: "msg-media-1", replyToMessageId: "original-media-1",
      mediaReference: { storage: "normalized", messageId: "msg-media-1" } });
    expect(JSON.stringify(state.messages())).not.toContain("A".repeat(100));
  });
});
