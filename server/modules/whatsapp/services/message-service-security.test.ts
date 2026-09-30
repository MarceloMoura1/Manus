import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWaAccountById: vi.fn(), getConversationById: vi.fn(), createMessage: vi.fn(), updateMessageWaId: vi.fn(),
  markMessageFailed: vi.fn(), listMessages: vi.fn(), sendTextMessage: vi.fn(), sendImageMessage: vi.fn(),
  sendAudioMessage: vi.fn(), sendVideoMessage: vi.fn(), sendDocumentMessage: vi.fn(), sendTemplateMessage: vi.fn(),
  markMessageAsRead: vi.fn(), updateConversationLastMessage: vi.fn(), emitNewMessage: vi.fn(), emitConversationUpdated: vi.fn(),
}));

vi.mock("../repositories/whatsapp.repo", () => ({ getWaAccountById: mocks.getWaAccountById }));
vi.mock("../repositories/conversation.repo", () => ({ getConversationById: mocks.getConversationById,
  updateConversationLastMessage: mocks.updateConversationLastMessage }));
vi.mock("../repositories/message.repo", () => ({ createMessage: mocks.createMessage,
  updateMessageWaId: mocks.updateMessageWaId, markMessageFailed: mocks.markMessageFailed, listMessages: mocks.listMessages }));
vi.mock("../meta/graph-api", () => ({ sendTextMessage: mocks.sendTextMessage, sendImageMessage: mocks.sendImageMessage,
  sendAudioMessage: mocks.sendAudioMessage, sendVideoMessage: mocks.sendVideoMessage,
  sendDocumentMessage: mocks.sendDocumentMessage, sendTemplateMessage: mocks.sendTemplateMessage,
  markMessageAsRead: mocks.markMessageAsRead }));
vi.mock("../socket/whatsapp.socket", () => ({ emitNewMessage: mocks.emitNewMessage,
  emitConversationUpdated: mocks.emitConversationUpdated }));

import { sendText } from "./message.service";

describe("mounted WhatsApp message provider boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWaAccountById.mockResolvedValue({ id: "account-a", clientId: "tenant-a", phoneNumberId: "phone-a",
      accessToken: "provider-token" });
    mocks.getConversationById.mockResolvedValue({ id: "conversation-a", clientId: "tenant-a", customerPhone: "5511999999999" });
    mocks.createMessage.mockResolvedValue({ id: "message-a" });
  });

  it("never exposes or persists a raw provider error from the real send service", async () => {
    const secret = "Bearer private-token password=hunter2";
    mocks.sendTextMessage.mockRejectedValue(Object.assign(new Error(`provider body ${secret}`), {
      status: 401, response: { data: { authorization: secret } }, cause: new Error(secret),
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failure = await sendText({ clientId: "tenant-a", accountId: "account-a", conversationId: "conversation-a",
      text: "hello" }).then(() => null, error => error);
    const surfaces = JSON.stringify([failure?.message, mocks.markMessageFailed.mock.calls, warn.mock.calls]);
    expect(failure?.message).toContain("Referência:");
    expect(mocks.markMessageFailed).toHaveBeenCalledOnce();
    expect(surfaces).not.toContain("private-token");
    expect(surfaces).not.toContain("hunter2");
    warn.mockRestore();
  });
});
