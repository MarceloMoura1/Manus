import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ updates: [] as Array<Record<string, unknown>> }));
const fakeDb = {
  update: () => ({ set: (value: Record<string, unknown>) => { state.updates.push(value); return { where: async () => undefined }; } }),
};
vi.mock("./db", () => ({ getDb: () => fakeDb }));

import { createBotScript, updateBotScript } from "./db-bot-scripts";

describe("bot prompt fail-closed storage", () => {
  it("refuses to store a system prompt in description", async () => {
    await expect(createBotScript("tenant-a", { name: "Bot", description: "Public", systemPrompt: "Secret" }))
      .rejects.toThrow("SYSTEM_PROMPT_STORAGE_UNAVAILABLE");
  });

  it("preserves description-only updates without accepting a prompt", async () => {
    await updateBotScript("tenant-a", "script-a", { description: "Public description" });
    expect(state.updates.at(-1)).toMatchObject({ description: "Public description" });
    await expect(updateBotScript("tenant-a", "script-a", { description: "Public", systemPrompt: "Secret" }))
      .rejects.toThrow("SYSTEM_PROMPT_STORAGE_UNAVAILABLE");
  });
});
