import { describe, expect, it } from "vitest";
import {
  conversationFilterStorageKey,
  readConversationFilters,
  writeConversationFilters,
  type ConversationFilters,
} from "./conversationFilterPersistence";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

describe("conversation filter session persistence", () => {
  it.each<ConversationFilters>([
    { attendantScope: "all", inboxView: "open" },
    { attendantScope: "mine", inboxView: "open" },
    { attendantScope: "all", inboxView: "bot" },
    { attendantScope: "mine", inboxView: "bot" },
    { attendantScope: "mine", inboxView: "closed" },
  ])("round-trips allowlisted filter combination %#", filters => {
    const storage = memoryStorage();
    const key = conversationFilterStorageKey("tenant-a", "user-a");
    writeConversationFilters(storage, key, filters);
    expect(readConversationFilters("", storage, key)).toEqual(filters);
  });

  it("isolates tenant and user without exposing either identity in the key", () => {
    const keys = [
      conversationFilterStorageKey("tenant-a", "user-a@example.test"),
      conversationFilterStorageKey("tenant-b", "user-a@example.test"),
      conversationFilterStorageKey("tenant-a", "user-b@example.test"),
    ];
    expect(new Set(keys).size).toBe(3);
    expect(keys.join(" ")).not.toContain("tenant-a");
    expect(keys.join(" ")).not.toContain("example.test");
  });

  it.each(["not-json", "{}", '{"attendantScope":"other","inboxView":"bot"}', '{"attendantScope":"mine","inboxView":"open","token":"secret"}'])
    ("falls back safely for corrupt or non-allowlisted value %s", raw => {
      const storage = memoryStorage();
      const key = conversationFilterStorageKey("tenant-a", "user-a")!;
      storage.setItem(key, raw);
      expect(readConversationFilters("", storage, key)).toEqual({ attendantScope: "all", inboxView: "open" });
    });

  it("stores only the two allowlisted fields", () => {
    const storage = memoryStorage();
    const key = conversationFilterStorageKey("tenant-a", "user-a")!;
    writeConversationFilters(storage, key, { attendantScope: "mine", inboxView: "bot" });
    expect(JSON.parse(storage.values.get(key)!)).toEqual({ attendantScope: "mine", inboxView: "bot" });
    expect(storage.values.get(key)).not.toMatch(/phone|message|protocol|conversationId|token|permission|payload/i);
  });

  it("uses a valid explicit URL state and rejects a corrupt one", () => {
    const storage = memoryStorage();
    const key = conversationFilterStorageKey("tenant-a", "user-a")!;
    writeConversationFilters(storage, key, { attendantScope: "mine", inboxView: "bot" });
    expect(readConversationFilters("?conversationScope=all&conversationInbox=closed", storage, key))
      .toEqual({ attendantScope: "all", inboxView: "closed" });
    expect(readConversationFilters("?conversationScope=invalid&conversationInbox=bot", storage, key))
      .toEqual({ attendantScope: "all", inboxView: "open" });
  });
});
