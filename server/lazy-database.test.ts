import { describe, expect, it, vi } from "vitest";
import { createLazyDatabase } from "./db";

describe("lazy database initializer", () => {
  it("does not initialize on creation or symbol inspection", () => {
    const initialize = vi.fn(() => ({ value: 1 }));
    const lazy = createLazyDatabase(initialize);
    expect(initialize).not.toHaveBeenCalled();
    expect(lazy[Symbol.toStringTag]).toBeUndefined();
    expect(initialize).not.toHaveBeenCalled();
  });

  it("initializes once and reuses the same instance", () => {
    const initialize = vi.fn(() => ({ value: 1 }));
    const lazy = createLazyDatabase(initialize);
    expect(lazy.value).toBe(1);
    expect(lazy.value).toBe(1);
    expect(initialize).toHaveBeenCalledOnce();
  });

  it("retries after initialization failure without caching an invalid value", () => {
    const secret = "secret-value";
    const initialize = vi.fn()
      .mockImplementationOnce(() => { throw new Error("configuration unavailable"); })
      .mockImplementationOnce(() => ({ value: 2 }));
    const lazy = createLazyDatabase(initialize);
    let message = "";
    try { void lazy.value; } catch (error) { message = error instanceof Error ? error.message : ""; }
    expect(message).not.toContain(secret);
    expect(lazy.value).toBe(2);
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("preserves method receivers and does not skip operations", () => {
    const operation = vi.fn();
    const instance = { value: 3, run() { operation(this.value); } };
    const lazy = createLazyDatabase(() => instance);
    lazy.run();
    expect(operation).toHaveBeenCalledWith(3);
  });
});
