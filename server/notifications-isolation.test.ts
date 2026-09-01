import { beforeEach, describe, expect, it, vi } from "vitest";

type NotificationType = "info" | "success" | "warning" | "error" | "system";
type Row = { notificationId: string; clientId: string; userId: string; title: string; message: string; type: NotificationType; isRead: boolean; actionUrl: string | null; createdAt: string; readAt: string | null };
type Predicate = { kind: "eq"; column: string; value: unknown } | { kind: "and"; parts: Predicate[] };
type Ordering = { kind: "desc"; column: string };
const state = vi.hoisted(() => ({ rows: [] as Row[] }));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return { ...original,
    eq: (column: { name: string }, value: unknown): Predicate => ({ kind: "eq", column: column.name, value }),
    and: (...parts: Predicate[]): Predicate => ({ kind: "and", parts }),
    desc: (column: { name: string }): Ordering => ({ kind: "desc", column: column.name }),
  };
});

function matches(row: Row, predicate?: Predicate): boolean {
  if (!predicate) return true;
  if (predicate.kind === "and") return predicate.parts.every((part) => matches(row, part));
  const keys: Record<string, keyof Row> = { notification_id: "notificationId", client_id: "clientId", user_id: "userId", is_read: "isRead", type: "type", created_at: "createdAt" };
  return row[keys[predicate.column]] === predicate.value;
}

function selectable(aggregate: boolean) {
  let predicate: Predicate | undefined; let take = Infinity; let skip = 0; let ordering: Ordering[] = [];
  const builder = { from: () => builder, where: (value: Predicate) => { predicate = value; return builder; }, orderBy: (...value: Ordering[]) => { ordering = value; return builder; },
    limit: (value: number) => { take = value; return builder; }, offset: (value: number) => { skip = value; return builder; },
    then: (resolve: (rows: Row[] | { value: number }[]) => void) => {
      const filtered = state.rows.filter((row) => matches(row, predicate));
      if (aggregate) return resolve([{ value: filtered.length }]);
      const sorted = [...filtered].sort((left, right) => {
        for (const item of ordering) {
          const keys: Record<string, keyof Row> = { created_at: "createdAt", notification_id: "notificationId" };
          const key = keys[item.column];
          const comparison = String(right[key]).localeCompare(String(left[key]));
          if (comparison) return comparison;
        }
        return 0;
      });
      resolve(sorted.slice(skip, skip + take));
    } };
  return builder;
}

const fakeDb = { select: (selection?: Record<string, unknown>) => selectable(Boolean(selection && "value" in selection)),
  insert: () => ({ values: async (value: Row) => { state.rows.push({ ...value, actionUrl: value.actionUrl ?? null, readAt: value.readAt ?? null }); } }),
  update: () => ({ set: (updates: Partial<Row>) => ({ where: async (predicate: Predicate) => state.rows.filter((row) => matches(row, predicate)).forEach((row) => Object.assign(row, updates)) }) }),
  delete: () => ({ where: async (predicate: Predicate) => { state.rows = state.rows.filter((row) => !matches(row, predicate)); } }),
};
vi.mock("./db", () => ({ getDb: () => fakeDb }));

import { notificationsRouter } from "./routers-notifications";
const caller = (userId: string, tenantId = "tenant-a") => notificationsRouter.createCaller({ tenantId, userEmail: `${userId}@example.invalid`, operationalUserId: userId, operationalUserRole: "agent", user: null, req: {}, res: {} } as never);

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
  it("retires the legacy mutation without changing another user", async () => {
    await expect(caller("user-a").markAsRead({ clientId: "tenant-a", notificationId: "other-user" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.rows[1].isRead).toBe(false);
  });
  it("blocks direct creation from the client contract", async () => {
    await expect(caller("user-a").createNotification({ clientId: "tenant-a", title: "New", message: "Message", type: "info" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.rows).toHaveLength(3);
  });

  it("derives the tenant for the paginated contract and counts unread rows globally", async () => {
    const result = await caller("user-a").listV2({ page: 1, pageSize: 10, unreadOnly: false });
    expect(result.items.map(row => row.notificationId)).toEqual(["own"]);
    expect(result).toMatchObject({ total: 1, unreadCount: 1, page: 1, totalPages: 1 });
  });

  it("sanitizes external deep links and scopes read mutations", async () => {
    state.rows[0].actionUrl = "https://malicious.invalid/collect";
    const listed = await caller("user-a").listV2({ page: 1, pageSize: 10, unreadOnly: false });
    expect(listed.items[0].actionUrl).toBeNull();
    await expect(caller("user-a").markAsReadV2({ notificationId: "other-user" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await caller("user-a").markAsReadV2({ notificationId: "own" });
    await caller("user-a").markAsReadV2({ notificationId: "own" });
    expect(state.rows[0].isRead).toBe(true);
    expect(state.rows[1].isRead).toBe(false);
  });

  it("paginates deterministically without duplicates while preserving isolation", async () => {
    state.rows.push(...Array.from({ length: 11 }, (_, index): Row => ({
      notificationId: `own-${String(index).padStart(2, "0")}`,
      clientId: "tenant-a",
      userId: "user-a",
      title: `Own ${index}`,
      message: "Page",
      type: "info",
      isRead: false,
      actionUrl: null,
      createdAt: `2026-08-${String(index + 1).padStart(2, "0")} 12:00:00`,
      readAt: null,
    })));
    const first = await caller("user-a").listV2({ page: 1, pageSize: 10, unreadOnly: false });
    const second = await caller("user-a").listV2({ page: 2, pageSize: 10, unreadOnly: false });
    expect(first).toMatchObject({ total: 12, totalPages: 2, page: 1, pageSize: 10 });
    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map(row => row.notificationId)).size).toBe(12);
    expect(first.items.map(row => row.createdAt)).toEqual([...first.items.map(row => row.createdAt)].sort().reverse());
    expect([...first.items, ...second.items].every(row => row.clientId === "tenant-a" && row.userId === "user-a")).toBe(true);
  });

  it("applies category and unread filters before pagination and rejects invalid categories", async () => {
    state.rows.push(
      { ...state.rows[0], notificationId: "warning-unread", type: "warning", isRead: false },
      { ...state.rows[0], notificationId: "warning-read", type: "warning", isRead: true },
      { ...state.rows[0], notificationId: "error-unread", type: "error", isRead: false },
    );
    expect((await caller("user-a").listV2({ page: 1, pageSize: 10, unreadOnly: false, category: "warning" })).items.map(row => row.notificationId).sort())
      .toEqual(["warning-read", "warning-unread"]);
    expect((await caller("user-a").listV2({ page: 1, pageSize: 10, unreadOnly: true, category: "warning" })).items.map(row => row.notificationId))
      .toEqual(["warning-unread"]);
    expect((await caller("user-a").listV2({ page: 1, pageSize: 10, unreadOnly: false, category: "system" })).items).toEqual([]);
    await expect(caller("user-a").listV2({ page: 1, pageSize: 10, unreadOnly: false, category: "invalid" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("marks all unread notifications only for the authoritative identity and is idempotent", async () => {
    state.rows.push({ ...state.rows[0], notificationId: "own-second" });
    await caller("user-a").markAllAsReadV2();
    await caller("user-a").markAllAsReadV2();
    expect(state.rows.filter(row => row.clientId === "tenant-a" && row.userId === "user-a").every(row => row.isRead && row.readAt)).toBe(true);
    expect(state.rows.find(row => row.notificationId === "other-user")?.isRead).toBe(false);
    expect(state.rows.find(row => row.notificationId === "other-tenant")?.isRead).toBe(false);
    const listed = await caller("user-a").listV2({ page: 1, pageSize: 10, unreadOnly: false });
    expect(listed.unreadCount).toBe(0);
    expect((await caller("user-a").listV2({ page: 1, pageSize: 10, unreadOnly: true })).items).toEqual([]);
  });

  it("rejects cross-user and cross-tenant notification ids before updating", async () => {
    await expect(caller("user-a").markAsReadV2({ notificationId: "other-user" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller("user-a").markAsReadV2({ notificationId: "other-tenant" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.rows.find(row => row.notificationId === "other-user")?.isRead).toBe(false);
    expect(state.rows.find(row => row.notificationId === "other-tenant")?.isRead).toBe(false);
  });

  it.each([
    ["/chamados?status=open", "/chamados?status=open"],
    ["chamados", null],
    ["https://externo.invalid", null],
    ["http://externo.invalid", null],
    ["//externo.invalid", null],
    ["javascript:alert(1)", null],
    ["data:text/html,unsafe", null],
    ["", null],
    [" /chamados", null],
    ["/%2F%2Fexterno.invalid", null],
  ])("sanitizes actionUrl %j", async (actionUrl, expected) => {
    state.rows[0].actionUrl = actionUrl;
    const listed = await caller("user-a").listV2({ page: 1, pageSize: 10, unreadOnly: false });
    expect(listed.items[0].actionUrl).toBe(expected);
  });
});
