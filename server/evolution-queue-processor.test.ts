import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvolutionFailedMessage } from "./db-evolution-queue";

const mocks = vi.hoisted(() => ({
  updateStatus: vi.fn(), increment: vi.fn(), record: vi.fn(), send: vi.fn(),
}));

vi.mock("./db-evolution-queue", () => ({
  addFailedMessage: vi.fn(), getPendingFailedMessages: vi.fn(), getQueueConfig: vi.fn(),
  cleanupOldMessages: vi.fn(), getQueueStats: vi.fn(),
  updateFailedMessageStatus: mocks.updateStatus,
  incrementRetryCount: mocks.increment,
  recordRetryAttempt: mocks.record,
}));
vi.mock("./evolution-manager", () => ({ getEvolutionAdapter: () => ({ sendMessage: mocks.send }) }));

import { retryMessage } from "./evolution-queue-processor";

const message = (changes: Partial<EvolutionFailedMessage> = {}): EvolutionFailedMessage => ({
  failedMessageId: "failed-a", clientId: "tenant-a", conversationId: "conversation-a",
  messageId: null, phoneNumber: "5511999999999", messageText: "Olá", agentName: null,
  status: "pending", retryCount: 0, maxRetries: 3, lastError: null, errorCode: null,
  createdAt: new Date(), updatedAt: new Date(), nextRetryAt: new Date(), sentAt: null,
  ...changes,
});

describe("Evolution retry processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateStatus.mockResolvedValue(undefined);
    mocks.record.mockResolvedValue(undefined);
  });

  it("retries one message and marks it sent", async () => {
    mocks.send.mockResolvedValue({ ok: true, messageId: "message-a" });
    await expect(retryMessage("tenant-a", message())).resolves.toEqual({ status: "sent" });
    expect(mocks.send).toHaveBeenCalledWith("tenant-a", "5511999999999", "Olá");
    expect(mocks.updateStatus).toHaveBeenLastCalledWith("failed-a", "sent", "message-a");
  });

  it("records resend failure and increments the retry", async () => {
    mocks.send.mockResolvedValue({ ok: false, error: "network" });
    mocks.increment.mockResolvedValue({ status: "retrying" });
    await expect(retryMessage("tenant-a", message())).resolves.toEqual({ status: "retrying" });
    expect(mocks.increment).toHaveBeenCalledWith("failed-a", "network", "network");
    expect(mocks.record).toHaveBeenCalledWith("failed-a", 1, "failed", "network", "network", expect.any(Number));
  });

  it("preserves the permanent failure returned at the maximum retry limit", async () => {
    mocks.send.mockResolvedValue({ ok: false, error: "timeout" });
    mocks.increment.mockResolvedValue({ status: "failed_permanent" });
    await expect(retryMessage("tenant-a", message({ retryCount: 2 }))).resolves.toEqual({ status: "failed_permanent" });
  });

  it("reports a missing queue message safely", async () => {
    mocks.send.mockResolvedValue({ ok: false, error: "not found" });
    mocks.increment.mockResolvedValue(undefined);
    await expect(retryMessage("tenant-a", message())).resolves.toEqual({ status: "not_found" });
  });

  it("rejects cross-tenant retries before sending", async () => {
    await expect(retryMessage("tenant-b", message())).rejects.toThrow("fora do escopo do tenant");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent retries by tenant and failed-message id", async () => {
    let release: ((value: { ok: true; messageId: string }) => void) | undefined;
    mocks.send.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const first = retryMessage("tenant-a", message());
    await expect(retryMessage("tenant-a", message())).resolves.toEqual({ status: "already_processing" });
    release?.({ ok: true, messageId: "message-a" });
    await expect(first).resolves.toEqual({ status: "sent" });
    expect(mocks.send).toHaveBeenCalledOnce();
  });
});
