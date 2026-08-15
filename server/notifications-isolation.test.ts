import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { notificationId: string; clientId: string; userId: string; title: string; message: string; type: "info"; isRead: boolean; actionUrl: string | null; createdAt: string; readAt: string | null };
type Predicate = { kind: "eq"; column: string; value: unknown } | { kind: "and"; parts: Predicate[] };
const state = vi.hoisted(() => ({ rows: [] as Row[] }));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return { ...original,
    eq: (column: { name: string }, value: unknown): Predicate => ({ kind: "eq", column: column.name, value }),
    and: (...parts: Predicate[]): Predicate => ({ kind: "and", parts }),
    desc: (column: { name: string }) => column,
  };
});

function matches(row: Row, predicate?: Predicate): boolean {
  if (!predicate) return true;
  if (predicate.kind === "and") return predicate.parts.every((part) => matches(row, part));
  const keys: Record<string, keyof Row> = { notification_id: "notificationId", client_id: "clientId", user_id: "userId", is_read: "isRead" };
  return row[keys[predicate.column]] === predicate.value;
}

function selectable() {
  let predicate: Predicate | undefined; let take = Infinity; let skip = 0;
  const builder = { from: () => builder, where: (value: Predicate) => { predicate = value; return builder; }, orderBy: () => builder,
    limit: (value: number) => { take = value; return builder; }, offset: (value: number) => { skip = value; return builder; },
    then: (resolve: (rows: Row[]) => void) => resolve(state.rows.filter((row) => matches(row, predicate)).slice(skip, skip + take)) };
  return builder;
}

const fakeDb = { select: () => selectable(),
  insert: () => ({ values: async (value: Row) => { state.rows.push({ ...value, actionUrl: value.actionUrl ?? null, readAt: value.readAt ?? null }); } }),
  update: () => ({ set: (updates: Partial<Row>) => ({ where: async (predicate: Predicate) => state.rows.filter((row) => matches(row, predicate)).forEach((row) => Object.assign(row, updates)) }) }),
  delete: () => ({ where: async (predicate: Predicate) => { state.rows = state.rows.filter((row) => !matches(row, predicate)); } }),
};
vi.mock("./db", () => ({ getDb: () => fakeDb }));

import { notificationsRouter } from "./routers-notifications";
const caller = (userId: string) => notificationsRouter.createCaller({ tenantId: "tenant-a", userEmail: `${userId}@example.invalid`, operationalUserId: userId, operationalUserRole: "agent", user: null, req: {}, res: {} } as never);

describe("notification user isolation", () => {
  beforeEach(() => { state.rows = [
    { notificationId: "own", clientId: "tenant-a", userId: "user-a", title: "Own", message: "A", type: "info", isRead: false, actionUrl: null, createdAt: "2026-08-15 12:00:00", readAt: null },
    { notificationId: "other-user", clientId: "tenant-a", userId: "user-b", title: "Private", message: "B", type: "info", isRead: false, actionUrl: null, createdAt: "2026-08-15 12:00:00", readAt: null },
    { notificationId: "other-tenant", clientId: "tenant-b", userId: "user-a", title: "Other", message: "C", type: "info", isRead: false, actionUrl: null, createdAt: "2026-08-15 12:00:00", readAt: null },
  ]; });

  it("lists only the authoritative operational user", async () => {
    const result = await caller("user-a").getNotifications({ clientId: "tenant-a", limit: 50, offset: 0, unreadOnly: false });
    expect(result.notifications.map((row) => row.notificationId)).toEqual(["own"]);
  });
  it("preserves NOT_FOUND and cannot mutate another user", async () => {
    await expect(caller("user-a").markAsRead({ clientId: "tenant-a", notificationId: "other-user" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.rows[1].isRead).toBe(false);
  });
  it("creates for the authoritative user with nullable actionUrl", async () => {
    const result = await caller("user-a").createNotification({ clientId: "tenant-a", title: "New", message: "Message", type: "info" });
    expect(state.rows.find((row) => row.notificationId === result.notificationId)).toMatchObject({ userId: "user-a", actionUrl: null });
  });
});
