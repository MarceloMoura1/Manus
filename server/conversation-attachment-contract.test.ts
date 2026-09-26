import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { conversationAttachmentSendInput } from "./conversation-attachment-contract";

const base = {
  conversationId: "conversation-a",
  dataUrl: "data:audio/webm;base64,AQID",
  mimeType: "audio/webm",
  userEmail: "agent@example.test",
  clientAttemptId: randomUUID(),
};

describe("conversation attachment send contract", () => {
  it.each(["recording", "attachment"] as const)("accepts explicit audio source %s", mediaSource => {
    expect(conversationAttachmentSendInput.safeParse({ ...base, kind: "audio", mediaSource }).success).toBe(true);
  });

  it("rejects ambiguous audio before storage, persistence, normalization, or provider work", () => {
    const parsed = conversationAttachmentSendInput.safeParse({ ...base, kind: "audio" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["mediaSource"], message: "Audio source is required." }),
    ]));
  });

  it.each(["image", "video", "document", "sticker"] as const)("preserves %s without an audio source", kind => {
    expect(conversationAttachmentSendInput.safeParse({
      ...base,
      kind,
      dataUrl: "data:application/octet-stream;base64,AQID",
      mimeType: "application/octet-stream",
    }).success).toBe(true);
  });
});
