import { describe, expect, it, vi } from "vitest";
import { runPostCommitBestEffort } from "./_core/post-commit";

describe("post-commit effects", () => {
  it("keeps the confirmed result when cache and metric updates fail", async () => {
    const completed = vi.fn();
    const log = vi.fn();
    await expect(runPostCommitBestEffort([
      () => { throw new Error("cache unavailable"); },
      async () => { throw new Error("metric unavailable"); },
      completed,
    ], log)).resolves.toBeUndefined();
    expect(completed).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.flat().join(" ")).not.toContain("cache unavailable");
  });
});
