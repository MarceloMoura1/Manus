import { describe, expect, it, vi } from "vitest";
import { upsertConversationStateSnapshot } from "./db";

type LifecycleStatus = "open" | "bot" | "closed";

type StoredConversation = {
  id: string;
  clientId: string;
  status: LifecycleStatus;
  closedAt: string | null;
  activeKey: string | null;
  reopenedAt: string | null;
  assignedUserId: string | null;
};

function snapshot(id: string, status: LifecycleStatus) {
  return {
    id,
    clientId: "tenant-a",
    name: "Contato",
    phone: "5511999999999",
    company: "",
    status,
    lastMessage: "snapshot legado",
    time: "12:00",
    messages: [],
  };
}

/**
 * Models the existing-row branch of MySQL's actual UPSERT. It deliberately
 * applies the SQL passed by upsertConversationStateSnapshot, so removing the
 * closed-status guard reproduces the production regression.
 */
function lifecycleStore(rows: StoredConversation[]) {
  const records = new Map(rows.map(row => [row.id, { ...row }]));
  const execute = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (!sql.includes("INSERT INTO megadesk_domain_conversations")) throw new Error("Unexpected SQL");
    const [id, clientId, _name, _phone, _company, incomingStatus] = values as [string, string, string, string, string, LifecycleStatus];
    const existing = records.get(id);
    if (!existing) {
      records.set(id, { id, clientId, status: incomingStatus, closedAt: null, activeKey: "active-key", reopenedAt: null, assignedUserId: "user-a" });
      return [{ affectedRows: 1 }];
    }
    const preservesClosed = sql.includes("status=CASE WHEN status = 'closed' THEN 'closed' ELSE VALUES(status) END");
    if (!(preservesClosed && existing.status === "closed")) existing.status = incomingStatus;
    return [{ affectedRows: 1 }];
  });

  return {
    connection: { execute },
    row: (id: string) => records.get(id),
    activeIds: () => [...records.values()]
      .filter(row => row.status === "open" && row.assignedUserId !== null)
      .map(row => row.id),
  };
}

async function sync(store: ReturnType<typeof lifecycleStore>, id: string, status: LifecycleStatus) {
  await upsertConversationStateSnapshot(store.connection as any, snapshot(id, status));
}

describe("legacy structured-state sync preserves authoritative conversation lifecycle", () => {
  it.each(["open", "bot", "closed"] as const)("keeps persisted closed when a stale snapshot says %s", async staleStatus => {
    const store = lifecycleStore([{
      id: "closed-a", clientId: "tenant-a", status: "closed", closedAt: "2026-09-09 21:29:30",
      activeKey: null, reopenedAt: null, assignedUserId: "user-a",
    }]);

    await sync(store, "closed-a", staleStatus);

    // The real regression changed this value to the stale snapshot status.
    expect(store.row("closed-a")).toMatchObject({
      status: "closed", closedAt: "2026-09-09 21:29:30", activeKey: null, reopenedAt: null, assignedUserId: "user-a",
    });
    expect(store.activeIds()).not.toContain("closed-a");
  });

  it.each([
    ["open", "open"], ["open", "bot"], ["bot", "open"], ["bot", "bot"],
  ] as const)("keeps the existing active snapshot semantics: DB %s + snapshot %s", async (persisted, staleStatus) => {
    const store = lifecycleStore([{
      id: "active-a", clientId: "tenant-a", status: persisted, closedAt: null,
      activeKey: "active-key", reopenedAt: null, assignedUserId: "user-a",
    }]);

    await sync(store, "active-a", staleStatus);
    expect(store.row("active-a")?.status).toBe(staleStatus);
  });

  it("does not resurrect multiple closed conversations into the active list", async () => {
    const store = lifecycleStore([
      { id: "closed-a", clientId: "tenant-a", status: "closed", closedAt: "2026-09-09 21:29:30", activeKey: null, reopenedAt: null, assignedUserId: "user-a" },
      { id: "closed-b", clientId: "tenant-a", status: "closed", closedAt: "2026-09-09 21:30:00", activeKey: null, reopenedAt: null, assignedUserId: "user-b" },
      { id: "open-a", clientId: "tenant-a", status: "open", closedAt: null, activeKey: "active-key", reopenedAt: null, assignedUserId: "user-a" },
    ]);

    await Promise.all([sync(store, "closed-a", "open"), sync(store, "closed-b", "open"), sync(store, "open-a", "open")]);

    expect(store.row("closed-a")?.status).toBe("closed");
    expect(store.row("closed-b")?.status).toBe("closed");
    expect(store.activeIds()).toEqual(["open-a"]);
  });
});
