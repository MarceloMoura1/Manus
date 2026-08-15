import { beforeEach, describe, expect, it, vi } from "vitest";

type MessageRow = { id: string; clientId: string; conversationId: string; waMessageId: string; status: string; createdAt: string };
type Predicate = { kind: "eq"; column: string; value: unknown } | { kind: "and"; parts: Predicate[] };
const state = vi.hoisted(() => {
  const value = { messages: [] as MessageRow[], accounts: [] as unknown[] };
  const matches = (row: MessageRow, predicate: Predicate): boolean => predicate.kind === "and"
    ? predicate.parts.every((part) => matches(row, part))
    : row[({ id: "id", client_id: "clientId", conversation_id: "conversationId", wa_message_id: "waMessageId", status: "status" } as Record<string, keyof MessageRow>)[predicate.column]] === predicate.value;
  const db = {
    update: () => ({ set: (updates: Partial<MessageRow>) => ({ where: async (predicate: Predicate) => value.messages.filter((row) => matches(row, predicate)).forEach((row) => Object.assign(row, updates)) }) }),
    select: (selection?: unknown) => {
      if (selection) {
        let predicate: Predicate | undefined;
        const builder = { from: () => builder, where: (where: Predicate) => { predicate = where; return builder; },
          then: (resolve: (rows: Array<{ createdAt: string }>) => void) => resolve(value.messages.filter((row) => !predicate || matches(row, predicate)).map((row) => ({ createdAt: row.createdAt }))) };
        return builder;
      }
      const builder = { from: () => builder, where: () => builder, limit: async (count: number) => value.accounts.slice(0, count) }; return builder;
    },
  };
  return { ...value, db };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return { ...original,
    eq: (column: { name: string }, value: unknown): Predicate => ({ kind: "eq", column: column.name, value }),
    and: (...parts: Predicate[]): Predicate => ({ kind: "and", parts }),
  };
});

vi.mock("../../../db", () => ({ getDb: () => state.db }));

import { listMessages, updateMessageStatus } from "./message.repo";
import { getWaAccountByPhoneNumberId } from "./whatsapp.repo";

describe("WhatsApp tenant-aware repository behavior", () => {
  beforeEach(() => {
    state.messages.splice(0, state.messages.length,
      { id: "a", clientId: "tenant-a", conversationId: "conversation-a", waMessageId: "same-external-id", status: "sent", createdAt: "2026-08-15 10:00:00" },
      { id: "b", clientId: "tenant-b", conversationId: "conversation-b", waMessageId: "same-external-id", status: "sent", createdAt: "2026-08-15 11:00:00" },
    );
    state.accounts.splice(0);
  });

  it("updates only the requested tenant when external IDs collide", async () => {
    await updateMessageStatus("tenant-a", "same-external-id", "read");
    expect(state.messages).toEqual([
      expect.objectContaining({ clientId: "tenant-a", status: "read" }),
      expect.objectContaining({ clientId: "tenant-b", status: "sent" }),
    ]);
  });

  it("returns null for no account and rejects ambiguous phone_number_id", async () => {
    await expect(getWaAccountByPhoneNumberId("missing")).resolves.toBeNull();
    state.accounts.push({ id: "a" }, { id: "b" });
    await expect(getWaAccountByPhoneNumberId("duplicate")).rejects.toThrow("WA_ACCOUNT_RESOLUTION_AMBIGUOUS");
  });

  it("rejects a cursor outside the requested tenant and conversation", async () => {
    await expect(listMessages("conversation-a", "tenant-a", { before: "b" })).rejects.toThrow("MESSAGE_CURSOR_OUT_OF_SCOPE");
  });
});
