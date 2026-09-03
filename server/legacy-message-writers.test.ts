import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const messageWriter = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("./db-conversas", () => ({
  createConversation: vi.fn(),
  getConversationWithMessages: vi.fn(),
  listConversations: vi.fn(),
  updateConversation: vi.fn(),
  addMessageToConversation: messageWriter.add,
  searchConversationByPhone: vi.fn(),
}));

import { conversasRouter } from "./routers-conversas";
import { appRouter } from "./routers";

const context = () => ({
  tenantId: "tenant-a",
  userEmail: "agent@example.invalid",
  operationalUserId: "agent-a",
  operationalUserRole: "agent",
  operationalPermissions: ["conversations"],
  req: { headers: {} },
}) as any;

const adminContext = () => ({
  req: { headers: {}, cookies: {} },
  res: { cookie: vi.fn(), clearCookie: vi.fn() },
  user: { openId: "admin-a", name: "Admin", role: "admin" },
}) as any;

function procedure(source: string, name: string, nextName: string) {
  return source.slice(source.indexOf(`${name}:`), source.indexOf(`${nextName}:`));
}

describe("legacy conversation message writers", () => {
  it("blocks the legacy addMessage procedure before it can write JSON-only state", async () => {
    await expect(conversasRouter.createCaller(context()).addMessage({
      conversationId: "4e5391e6-b8b5-42e8-a334-0ab07a9fb417",
      from: "agent",
      text: "Mensagem que não pode ser persistida somente no JSON",
    })).rejects.toMatchObject({ code: "METHOD_NOT_SUPPORTED" });

    expect(messageWriter.add).not.toHaveBeenCalled();
  });

  it("removes the JSON-only helper so future routes cannot import it", () => {
    const source = readFileSync(new URL("./db-conversas.ts", import.meta.url), "utf8");

    expect(source).not.toContain("addMessageToConversation");
  });

  it("keeps customer registration separate from attendance-message creation", () => {
    const source = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    const createCustomer = procedure(source, "createCustomer", "createTicket");

    expect(createCustomer).not.toContain("conversations.push");
    expect(createCustomer).not.toContain("messages: [{");
    expect(createCustomer).not.toContain("persistSyncState()");
  });

  it("blocks administrative synthetic conversations instead of creating JSON-only messages", async () => {
    await expect(appRouter.createCaller(adminContext()).megaadmin.pushOperationalRecord({
      clientId: "tenant-a",
      type: "conversation",
      ownerPhone: "5511999999999",
      title: "Mensagem sintética bloqueada",
      status: "open",
    })).rejects.toMatchObject({ code: "METHOD_NOT_SUPPORTED" });

    const source = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    const operationalRecord = procedure(source, "pushOperationalRecord", "updateUserPermissions");

    expect(operationalRecord).toContain("METHOD_NOT_SUPPORTED");
    expect(operationalRecord).not.toContain("messages: [{");
  });
});
