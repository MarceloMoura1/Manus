import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  selections: [] as Array<Record<string, unknown>>,
}));
const fakeDb = {
  insert: () => ({ values: async (value: Record<string, unknown>) => { state.inserts.push(value); } }),
  update: () => ({ set: (value: Record<string, unknown>) => { state.updates.push(value); return { where: async () => undefined }; } }),
  select: (fields: Record<string, unknown>) => {
    state.selections.push(fields);
    return { from: () => ({ where: async () => [] }) };
  },
};
vi.mock("./db", () => ({ getDb: () => fakeDb }));

import { createBotScript, getBotScripts, updateBotScript } from "./db-bot-scripts";
import { botScriptsRouter } from "./routers-bot-scripts";

describe("bot prompt canonical storage", () => {
  it("stores description and system prompt in separate columns", async () => {
    await createBotScript("tenant-a", { name: "Bot", description: "Public", systemPrompt: "Secret" });
    expect(state.inserts.at(-1)).toMatchObject({ description: "Public", systemPrompt: "Secret" });
  });

  it("updates description and system prompt independently", async () => {
    await updateBotScript("tenant-a", "script-a", { description: "Public", systemPrompt: "Secret" });
    expect(state.updates.at(-1)).toMatchObject({ description: "Public", systemPrompt: "Secret" });
  });

  it("does not expose systemPrompt in common listings", async () => {
    await getBotScripts("tenant-a");
    expect(Object.keys(state.selections.at(-1) ?? {})).toContain("description");
    expect(Object.keys(state.selections.at(-1) ?? {})).not.toContain("systemPrompt");
  });

  it("denies system prompt detail to an operational agent", async () => {
    const caller = botScriptsRouter.createCaller({
      tenantId: "tenant-a", userEmail: "agent@example.invalid", operationalUserId: "agent-1",
      operationalUserRole: "agent", user: null, req: {}, res: {},
    } as never);
    await expect(caller.get({ clientId: "tenant-a", scriptId: "script-a" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
