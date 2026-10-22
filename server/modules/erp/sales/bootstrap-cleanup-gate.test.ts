import { describe, expect, it, vi } from "vitest";
import { createBootstrapCleanupGate } from "./bootstrap-cleanup-gate";

describe("Sales v2 physical bootstrap cleanup gate", () => {
  it("does not clean an incomplete schema after bootstrap fails", async () => {
    const cleanup = vi.fn(async () => undefined);
    const gate = createBootstrapCleanupGate(cleanup);
    const failure = new Error("migration failed");

    await expect(gate.run(async () => { throw failure; })).rejects.toBe(failure);
    await gate.clean();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("runs cleanup after a completed bootstrap", async () => {
    const cleanup = vi.fn(async () => undefined);
    const gate = createBootstrapCleanupGate(cleanup);

    await gate.run(async () => undefined);
    await gate.clean();
    await gate.clean();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("does not hide cleanup errors after a completed bootstrap", async () => {
    const failure = new Error("cleanup failed");
    const gate = createBootstrapCleanupGate(async () => { throw failure; });

    await gate.run(async () => undefined);
    await expect(gate.clean()).rejects.toBe(failure);
  });
});
