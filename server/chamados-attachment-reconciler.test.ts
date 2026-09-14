import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
}));

vi.mock("./chamados-attachments", () => ({
  reconcileTicketAttachmentStates: mocks.reconcile,
}));

import {
  DEFAULT_TICKET_ATTACHMENT_RECONCILE_INTERVAL_MS,
  parseTicketAttachmentReconcileIntervalMs,
} from "./_core/env";
import { startTicketAttachmentReconciler } from "./chamados-attachment-reconciler";

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("ticket attachment reconciler scheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    mocks.reconcile.mockReset();
  });

  it("starts reconciliation immediately and repeats it at the configured interval", async () => {
    vi.useFakeTimers();
    mocks.reconcile.mockResolvedValue({ markedPendingDelete: 0 });
    const scheduler = startTicketAttachmentReconciler({ intervalMs: 1_000, logger: { info: vi.fn(), error: vi.fn() } });

    await flushMicrotasks();
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("is started by the server bootstrap after the HTTP server is listening", () => {
    const bootstrap = readFileSync(fileURLToPath(new URL("./_core/index.ts", import.meta.url)), "utf8");
    expect(bootstrap).toContain("startTicketAttachmentReconciler();");
  });

  it("does not overlap executions in the same process", async () => {
    vi.useFakeTimers();
    let finish!: (value: { markedPendingDelete: number }) => void;
    mocks.reconcile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    mocks.reconcile.mockResolvedValue({ markedPendingDelete: 0 });
    const scheduler = startTicketAttachmentReconciler({ intervalMs: 1_000, logger: { info: vi.fn(), error: vi.fn() } });

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);

    finish({ markedPendingDelete: 0 });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("logs a failed cycle, releases the in-flight guard, and recovers on the next interval", async () => {
    vi.useFakeTimers();
    const logger = { info: vi.fn(), error: vi.fn() };
    mocks.reconcile
      .mockRejectedValueOnce(new Error("synthetic reconcile failure"))
      .mockResolvedValue({ markedPendingDelete: 0 });
    const scheduler = startTicketAttachmentReconciler({ intervalMs: 1_000, logger });

    await flushMicrotasks();
    expect(logger.error).toHaveBeenCalledWith("[Ticket Attachments] Reconciliation failed", expect.any(Error));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("uses a conservative default for missing, invalid, zero, and negative interval values", () => {
    expect(parseTicketAttachmentReconcileIntervalMs(undefined)).toBe(DEFAULT_TICKET_ATTACHMENT_RECONCILE_INTERVAL_MS);
    expect(parseTicketAttachmentReconcileIntervalMs("invalid")).toBe(DEFAULT_TICKET_ATTACHMENT_RECONCILE_INTERVAL_MS);
    expect(parseTicketAttachmentReconcileIntervalMs("0")).toBe(DEFAULT_TICKET_ATTACHMENT_RECONCILE_INTERVAL_MS);
    expect(parseTicketAttachmentReconcileIntervalMs("-1")).toBe(DEFAULT_TICKET_ATTACHMENT_RECONCILE_INTERVAL_MS);
    expect(parseTicketAttachmentReconcileIntervalMs("60000")).toBe(60_000);
  });
});
