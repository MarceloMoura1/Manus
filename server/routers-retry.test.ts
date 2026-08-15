import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const selectedRows: object[][] = [];
  const insertedValues = vi.fn();
  const updatedValues = vi.fn();

  return {
    selectedRows,
    insertedValues,
    updatedValues,
    db: {
      select: vi.fn(() => {
        const rows = selectedRows.shift() ?? [];
        const query = {
          then: (resolve: (value: object[]) => unknown) => Promise.resolve(resolve(rows)),
          limit: () => Promise.resolve(rows),
        };
        return { from: () => ({ where: () => query }) };
      }),
      insert: vi.fn(() => ({ values: insertedValues })),
      update: vi.fn(() => ({
        set: (values: object) => {
          updatedValues(values);
          return { where: () => Promise.resolve() };
        },
      })),
    },
  };
});

vi.mock("./db", () => ({ getDb: () => database.db }));

import {
  addFailedMessage,
  getPendingFailedMessages,
  incrementRetryCount,
  updateFailedMessageStatus,
} from "./db-evolution-queue";

describe("Evolution retry queue", () => {
  beforeEach(() => {
    database.selectedRows.length = 0;
    database.insertedValues.mockReset().mockResolvedValue(undefined);
    database.updatedValues.mockReset();
    vi.clearAllMocks();
  });

  it("persists a failed message with the tenant and safe initial state", async () => {
    const id = await addFailedMessage(
      "tenant-a",
      "conversation-a",
      "5511999999999",
      "Mensagem",
      "Agente",
      undefined,
      "Falha transitória",
      "TIMEOUT"
    );

    expect(id).toMatch(/^failed-/);
    expect(database.insertedValues).toHaveBeenCalledWith(
      expect.objectContaining({
        failedMessageId: id,
        clientId: "tenant-a",
        conversationId: "conversation-a",
        status: "pending",
        retryCount: 0,
        maxRetries: 3,
      })
    );
  });

  it("returns only the rows supplied by the tenant-scoped pending query", async () => {
    database.selectedRows.push([
      { failedMessageId: "failed-a", clientId: "tenant-a", status: "pending" },
    ]);

    await expect(getPendingFailedMessages("tenant-a")).resolves.toEqual([
      { failedMessageId: "failed-a", clientId: "tenant-a", status: "pending" },
    ]);
    expect(database.db.select).toHaveBeenCalledOnce();
  });

  it("applies exponential backoff and keeps retries below the configured limit", async () => {
    database.selectedRows.push(
      [{ failedMessageId: "failed-a", clientId: "tenant-a", retryCount: 0 }],
      [{ clientId: "tenant-a", maxRetries: 3, retryDelayMs: 1000, backoffMultiplier: 2, maxBackoffMs: 60000 }]
    );

    const result = await incrementRetryCount("failed-a", "timeout", "TIMEOUT");

    expect(result).toEqual(expect.objectContaining({ newRetryCount: 1, status: "retrying" }));
    expect(database.updatedValues).toHaveBeenCalledWith(
      expect.objectContaining({
        retryCount: 1,
        status: "retrying",
        lastError: "timeout",
        errorCode: "TIMEOUT",
      })
    );
  });

  it("marks a sent message and records its delivery timestamp", async () => {
    await updateFailedMessageStatus("failed-a", "sent", "message-a");

    expect(database.updatedValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "sent",
        messageId: "message-a",
        sentAt: expect.any(Date),
      })
    );
  });
});
