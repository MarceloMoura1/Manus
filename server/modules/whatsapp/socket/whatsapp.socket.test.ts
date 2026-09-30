import { describe, expect, it, vi } from "vitest";
import { deliverOperationalTenantEvent } from "./whatsapp.socket";

function recipient() {
  return {
    request: { headers: {} },
    rooms: new Set(["client:tenant-a"]),
    disconnect: vi.fn(),
    emit: vi.fn(),
  } as any;
}

function identity(tenantId = "tenant-a", role: "admin" | "manager" | "agent" | "viewer" = "agent") {
  return {
    sessionId: "session-a",
    userId: "user-a",
    tenantId,
    role,
    permissions: ["conversations"],
    userEmail: "agent-a@example.invalid",
    userName: "Agent A",
  };
}

describe("operational realtime recipient validation", () => {
  it("emits only after revalidating the current tenant session", async () => {
    const socket = recipient();
    const result = await deliverOperationalTenantEvent(
      [socket], "tenant-a", "conversation:receipt", { status: "read" }, undefined,
      vi.fn(async () => identity()),
    );

    expect(result).toEqual({ candidates: 1, emitted: 1, disconnected: 0, roleFiltered: 0 });
    expect(socket.emit).toHaveBeenCalledWith("conversation:receipt", { status: "read" });
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it.each([
    ["revoked or expired", async () => null],
    ["resolver failure", async () => { throw new Error("database unavailable"); }],
    ["different tenant", async () => identity("tenant-b")],
  ])("disconnects a %s recipient without leaking the event", async (_case, resolveSession) => {
    const socket = recipient();
    const result = await deliverOperationalTenantEvent(
      [socket], "tenant-a", "conversation:message", { private: true }, undefined, resolveSession as any,
    );

    expect(result).toEqual({ candidates: 1, emitted: 0, disconnected: 1, roleFiltered: 0 });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("filters unauthorized roles after session revalidation", async () => {
    const socket = recipient();
    const result = await deliverOperationalTenantEvent(
      [socket], "tenant-a", "erp:finance.entry.changed", { publicId: "entry-a" }, ["admin", "manager"],
      vi.fn(async () => identity("tenant-a", "agent")),
    );

    expect(result).toEqual({ candidates: 1, emitted: 0, disconnected: 0, roleFiltered: 1 });
    expect(socket.emit).not.toHaveBeenCalled();
    expect(socket.disconnect).not.toHaveBeenCalled();
  });
});
