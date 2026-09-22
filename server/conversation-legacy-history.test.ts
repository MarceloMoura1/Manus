import { describe, expect, it } from "vitest";
import { readConversationHistory } from "./conversation-legacy-history";

const normalized = [{ id: "canonical-a", timestamp: "2026-09-02T10:00:00.000Z", text: "Canonical" }];

const privateMediaKeys = new Set(["mediaData", "base64", "dataUrl", "storageKey", "physicalPath", "filePath", "localPath"]);
const binaryDataUrl = /^data:(?:image|audio|video|application)\/[^;,]+;base64,[A-Za-z0-9+/=]+$/i;

function expectNoPrivateMedia(value: unknown): void {
  if (typeof value === "string") {
    expect(value).not.toMatch(binaryDataUrl);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(expectNoPrivateMedia);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      expect(privateMediaKeys.has(key)).toBe(false);
      expectNoPrivateMedia(nested);
    }
  }
}

describe("conversation legacy history reader", () => {
  it("keeps a normalized-only conversation unchanged", () => {
    expect(readConversationHistory(normalized, "[]", 200)).toEqual({
      messages: [{ ...normalized[0], chronology: "absolute" }], indeterminateHistory: [],
    });
  });

  it("keeps legacy-only timestamped messages on the chronological timeline", () => {
    const result = readConversationHistory([], JSON.stringify([{ id: "legacy-a", timestamp: "2026-09-02T09:00:00.000-03:00" }]), 200);
    expect(result.messages).toEqual([{ id: "legacy-a", timestamp: "2026-09-02T09:00:00.000-03:00", chronology: "absolute" }]);
    expect(result.indeterminateHistory).toEqual([]);
  });

  it("does not duplicate a legacy mirror with a strong normalized id match", () => {
    const result = readConversationHistory(normalized, JSON.stringify([{ id: "canonical-a", timestamp: "2026-09-02T10:00:00.000Z" }]), 200);
    expect(result.messages.map(message => message.id)).toEqual(["canonical-a"]);
  });

  it("preserves unmatched and id-less legacy messages", () => {
    const result = readConversationHistory(normalized, JSON.stringify([
      { id: "legacy-b", timestamp: "2026-09-02T11:00:00Z" },
      { text: "Historical without id", timestamp: "2026-09-02T12:00:00Z" },
    ]), 200);
    expect(result.messages.map(message => message.id)).toEqual(["canonical-a", "legacy-b", undefined]);
  });

  it("preserves timestamp-less legacy history separately without a fabricated time or order", () => {
    const result = readConversationHistory(normalized, JSON.stringify([{ id: "legacy-unknown", text: "Old" }]), 200);
    expect(result.messages.map(message => message.id)).toEqual(["canonical-a"]);
    expect(result.indeterminateHistory).toEqual([{ id: "legacy-unknown", text: "Old", chronology: "unknown" }]);
  });

  it("never returns a legacy V1 Data URL in history JSON", () => {
    const result = readConversationHistory([], JSON.stringify([
      { id: "legacy-media", type: "image", mimeType: "image/png", fileName: "old.png", mediaData: "data:image/png;base64,QQ==", timestamp: "2026-09-02T12:00:00Z" },
    ]), 200);
    expect(result.messages[0]).toMatchObject({ mimeType: "image/png", fileName: "old.png",
      mediaReference: { storage: "private", messageId: "legacy-media" } });
    expect(JSON.stringify(result.messages[0])).not.toMatch(/mediaData|base64|dataUrl|data:.*;base64/i);
  });

  it("deep-sanitizes nested legacy media while preserving public metadata and a private pointer", () => {
    const result = readConversationHistory([], JSON.stringify([{
      id: "legacy-nested", type: "image", mimeType: "image/png", fileName: "safe.png", byteSize: 7, fileSize: 7,
      caption: "Public caption", timestamp: "2026-09-02T12:00:00Z", sender: { id: "sender-a", name: "Public sender" },
      mediaData: "data:image/png;base64,QQ==", storageKey: "tenants/tenant-a/conversation-media/22/top-level.bin",
      mediaReference: { nested: { mediaData: "data:image/png;base64,QQ==" } },
      unexpected: { storageKey: "tenants/tenant-a/conversation-media/22/object.bin" },
      wrapper: { deeper: { dataUrl: "data:application/pdf;base64,QQ==" } },
      paths: { physicalPath: "/private/media.bin", filePath: "C:/private/media.bin", localPath: "storage/media.bin" },
      array: [{ mediaData: "data:image/jpeg;base64,QQ==" }, { retained: "value" }, [{ deeper: { base64: "QQ==" } }]],
      weirdImage: "data:image/png;base64,QQ==",
      weirdAudio: "data:audio/ogg;base64,QQ==",
      weirdVideo: "data:video/mp4;base64,QQ==",
      weirdApplication: "data:application/pdf;base64,QQ==",
      ordinaryDataWord: "data is ordinary text",
    }]), 200);
    expect(result.messages[0]).toMatchObject({
      id: "legacy-nested", type: "image", mimeType: "image/png", fileName: "safe.png", byteSize: 7, fileSize: 7,
      caption: "Public caption", timestamp: "2026-09-02T12:00:00Z", sender: { id: "sender-a", name: "Public sender" },
      ordinaryDataWord: "data is ordinary text", mediaReference: { storage: "private", messageId: "legacy-nested" },
    });
    expectNoPrivateMedia(result);
  });

  it("keeps ordinary nested legacy values semantically intact", () => {
    const legacy = { id: "legacy-ordinary", type: "text", timestamp: "2026-09-02T12:00:00Z",
      nested: { label: "data is not a payload", values: ["one", { two: 2 }] } };
    expect(readConversationHistory([], JSON.stringify([legacy]), 200).messages).toEqual([
      { ...legacy, chronology: "absolute" },
    ]);
  });

  it("preserves the V2 private pointer without its storage key", () => {
    const reference = { version: 2, storage: "local", storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin",
      mimeType: "application/pdf", fileName: "safe.pdf", byteSize: 1, sha256: "a".repeat(64) };
    const result = readConversationHistory([], JSON.stringify([{
      id: "legacy-v2", type: "document", timestamp: "2026-09-02T12:00:00Z", mediaReference: reference,
    }]), 200);
    expect(result.messages[0]).toMatchObject({ mimeType: "application/pdf", fileName: "safe.pdf", byteSize: 1,
      mediaReference: { storage: "private", messageId: "legacy-v2" } });
    expectNoPrivateMedia(result);
  });
});
