import { describe, expect, it, vi } from "vitest";
import { ConversationReplyResolutionError, resolveConversationReplyReference } from "./conversation-reply-resolution";

const input = { clientId: "tenant-a", conversationId: "conv-a", integrationId: "instance-a", replyToMessageId: "message-a" };
const original = {
  message_id: "message-a", conversation_id: "conv-a", external_message_id: "external-a", provider: "evolution", integration_id: "instance-a",
  provider_message_reference: JSON.stringify({ key: { id: "external-a", remoteJid: "5541999999999@s.whatsapp.net", fromMe: false }, message: { conversation: "Original" } }),
};

function db(row: Record<string, unknown> | undefined) {
  return { execute: vi.fn(async () => [[row].filter(Boolean)]) };
}

describe("conversation reply resolution", () => {
  it("resolves only the provider reference stored for the canonical message", async () => {
    const connection = db(original);
    await expect(resolveConversationReplyReference(connection, input)).resolves.toMatchObject({ key: { id: "external-a" }, message: { conversation: "Original" } });
    expect(connection.execute.mock.calls[0][1]).toEqual(["tenant-a", "message-a"]);
  });

  it("does not expose a message from another tenant", async () => {
    await expect(resolveConversationReplyReference(db(undefined), { ...input, clientId: "tenant-b" }))
      .rejects.toMatchObject<Partial<ConversationReplyResolutionError>>({ code: "NOT_FOUND" });
  });

  it("rejects a message from another attendance in the same tenant", async () => {
    await expect(resolveConversationReplyReference(db({ ...original, conversation_id: "conv-other" }), input))
      .rejects.toMatchObject<Partial<ConversationReplyResolutionError>>({ code: "BAD_REQUEST" });
  });

  it("rejects a pending or historical original without a complete Evolution reference", async () => {
    await expect(resolveConversationReplyReference(db({ ...original, provider_message_reference: null }), input))
      .rejects.toMatchObject<Partial<ConversationReplyResolutionError>>({ code: "CONFLICT" });
  });
});
