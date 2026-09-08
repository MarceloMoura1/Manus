import { describe, expect, it, vi } from "vitest";
import {
  CONVERSATION_TIMESTAMP_REPAIR_EXPECTED_COUNT,
  assertConversationTimestampRepairManifest,
  assertConversationTimestampRepairManifestMatchesDatabase,
  conversationTimestampRepairSelectorSql,
  createConversationTimestampRepairManifest,
  serializeConversationTimestampRepairManifest,
} from "./conversation-timestamp-repair";

function rows(count = CONVERSATION_TIMESTAMP_REPAIR_EXPECTED_COUNT) {
  return Array.from({ length: count }, (_, index) => ({
    clientId: "tenant-a",
    conversationId: `conv-${String(index).padStart(3, "0")}`,
    messageId: `msg-${String(index).padStart(3, "0")}`,
    oldTimestamp: "2026-09-07 20:28:05",
    legacyUtcTimestamp: "2026-09-07T23:28:05.220000Z",
  }));
}

describe("conversation timestamp repair manifest", () => {
  it("builds a deterministic, exportable manifest from the structural selector", async () => {
    const execute = vi.fn(async () => [rows()]);
    const manifest = await createConversationTimestampRepairManifest({ execute } as any);

    expect(execute).toHaveBeenCalledWith(conversationTimestampRepairSelectorSql);
    expect(manifest.entries).toHaveLength(CONVERSATION_TIMESTAMP_REPAIR_EXPECTED_COUNT);
    expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(serializeConversationTimestampRepairManifest(manifest)).toContain('"version": 1');
    assertConversationTimestampRepairManifest(manifest);
  });

  it("rejects a manifest with a changed row even when its count remains 101", async () => {
    const first = await createConversationTimestampRepairManifest({ execute: vi.fn(async () => [rows()]) } as any);
    const changedRows = rows();
    changedRows[0] = { ...changedRows[0], oldTimestamp: "2026-09-07 20:28:06" };
    const second = await createConversationTimestampRepairManifest({ execute: vi.fn(async () => [changedRows]) } as any);

    await expect(assertConversationTimestampRepairManifestMatchesDatabase(
      { execute: vi.fn(async () => [changedRows]) } as any,
      first,
    )).rejects.toThrow("CONVERSATION_TIMESTAMP_REPAIR_MANIFEST_MISMATCH");
    expect(second.sha256).not.toBe(first.sha256);
  });

  it("rejects incomplete or duplicate rollback manifests", async () => {
    for (const count of [1, 100, 102]) {
      const incomplete = await createConversationTimestampRepairManifest({ execute: vi.fn(async () => [rows(count)]) } as any);
      expect(() => assertConversationTimestampRepairManifest(incomplete)).toThrow("MANIFEST_COUNT_INVALID");
    }

    const duplicateRows = rows();
    duplicateRows[1] = {
      ...duplicateRows[1],
      conversationId: duplicateRows[0].conversationId,
      messageId: duplicateRows[0].messageId,
    };
    const duplicate = await createConversationTimestampRepairManifest({ execute: vi.fn(async () => [duplicateRows]) } as any);
    expect(() => assertConversationTimestampRepairManifest(duplicate)).toThrow("MANIFEST_DUPLICATE_IDENTITY");
  });
});
