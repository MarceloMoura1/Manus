import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TICKET_ATTACHMENT_READ_TIMEOUT_MS,
  parseTicketAttachmentReadTimeoutMs,
} from "./_core/env";
import { StorageReadError, storageGet } from "./storage";
import {
  TicketAttachmentReadError,
  logTicketAttachmentReadFailure,
  readTicketAttachment,
  ticketAttachmentReadHttpStatus,
} from "./chamados-attachments";

const attachmentId = "22222222-2222-4222-8222-222222222222";
const chamadoId = "11111111-1111-4111-8111-111111111111";
const clientId = "tenant-a";
const storageKey = `ticket-attachments/22/${attachmentId}`;
const storageConfig = { baseUrl: "https://forge.invalid", apiKey: "synthetic-key" };

function activePool(overrides: Record<string, unknown> = {}) {
  return {
    execute: vi.fn().mockResolvedValue([[{
      storageKey,
      fileName: "evidence.txt",
      mimeType: "text/plain",
      fileSize: 2,
      state: "active",
      ...overrides,
    }], []]),
  } as any;
}

function emptyPool() {
  return { execute: vi.fn().mockResolvedValue([[], []]) } as any;
}

function signedStorage() {
  return { putExact: vi.fn(), get: vi.fn().mockResolvedValue({ url: "https://signed.invalid/file" }) };
}

function response(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function expectReadFailure(error: unknown, stage: string, kind: string, providerStatus?: number) {
  expect(error).toBeInstanceOf(TicketAttachmentReadError);
  expect(error).toMatchObject({ stage, kind, ...(providerStatus == null ? {} : { providerStatus }) });
}

function rejectWhenAborted(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) throw new Error("Expected an abort signal");
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ticket attachment read error taxonomy", () => {
  it("uses the safe read-timeout default for missing or invalid configuration", () => {
    expect(parseTicketAttachmentReadTimeoutMs(undefined)).toBe(DEFAULT_TICKET_ATTACHMENT_READ_TIMEOUT_MS);
    expect(parseTicketAttachmentReadTimeoutMs("invalid")).toBe(DEFAULT_TICKET_ATTACHMENT_READ_TIMEOUT_MS);
    expect(parseTicketAttachmentReadTimeoutMs("0")).toBe(DEFAULT_TICKET_ATTACHMENT_READ_TIMEOUT_MS);
    expect(parseTicketAttachmentReadTimeoutMs("-1")).toBe(DEFAULT_TICKET_ATTACHMENT_READ_TIMEOUT_MS);
    expect(parseTicketAttachmentReadTimeoutMs("1200")).toBe(1_200);
  });

  it("keeps a missing or inactive local attachment as a local 404 without storage access", async () => {
    const storage = signedStorage();
    await expect(readTicketAttachment(clientId, chamadoId, attachmentId, { pool: emptyPool(), storage }))
      .rejects.toSatisfy(error => {
        expectReadFailure(error, "local", "not_found");
        expect(ticketAttachmentReadHttpStatus(error)).toBe(404);
        return true;
      });
    await expect(readTicketAttachment(clientId, chamadoId, attachmentId, {
      pool: activePool({ state: "pending_delete" }),
      storage,
    }))
      .rejects.toSatisfy(error => {
        expectReadFailure(error, "local", "not_found");
        return true;
      });
    expect(storage.get).not.toHaveBeenCalled();
  });

  it.each([401, 403])("preserves downloadUrl %i as an auth failure", async status => {
    await expect(storageGet(storageKey, { config: storageConfig, fetch: vi.fn().mockResolvedValue(response(status)) as any }))
      .rejects.toMatchObject<StorageReadError>({ stage: "download_url", kind: "auth", providerStatus: status });
  });

  it("preserves downloadUrl rate-limit, server, transport, and invalid-response failures", async () => {
    await expect(storageGet(storageKey, { config: storageConfig, fetch: vi.fn().mockResolvedValue(response(429)) as any }))
      .rejects.toMatchObject<StorageReadError>({ stage: "download_url", kind: "rate_limit", providerStatus: 429 });
    await expect(storageGet(storageKey, { config: storageConfig, fetch: vi.fn().mockResolvedValue(response(503)) as any }))
      .rejects.toMatchObject<StorageReadError>({ stage: "download_url", kind: "server", providerStatus: 503 });
    await expect(storageGet(storageKey, { config: storageConfig, fetch: vi.fn().mockRejectedValue(new TypeError("network down")) as any }))
      .rejects.toMatchObject<StorageReadError>({ stage: "download_url", kind: "transport" });
    await expect(storageGet(storageKey, { config: storageConfig, fetch: vi.fn().mockResolvedValue(response(200, { url: "not a URL" })) as any }))
      .rejects.toMatchObject<StorageReadError>({ stage: "download_url", kind: "invalid_response" });
  });

  it("preserves storage configuration failures", async () => {
    await expect(storageGet(storageKey, { config: { baseUrl: "", apiKey: "" }, fetch: vi.fn() as any }))
      .rejects.toMatchObject<StorageReadError>({ stage: "storage_config", kind: "config" });
  });

  it("classifies a hanging downloadUrl request as a timeout and clears its timer", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_: URL, init?: RequestInit) => rejectWhenAborted(init?.signal));
    const result = storageGet(storageKey, { config: storageConfig, fetch: fetchMock as any, timeoutMs: 10 });
    const expectation = expect(result).rejects.toMatchObject<StorageReadError>({
      stage: "download_url",
      kind: "timeout",
      providerStatus: undefined,
    });

    await vi.advanceTimersByTimeAsync(10);
    await expectation;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the downloadUrl timer after a normal response and a provider failure", async () => {
    vi.useFakeTimers();
    await expect(storageGet(storageKey, {
      config: storageConfig,
      fetch: vi.fn().mockResolvedValue(response(200, { url: "https://signed.invalid/file" })) as any,
      timeoutMs: 10,
    })).resolves.toMatchObject({ key: storageKey });
    expect(vi.getTimerCount()).toBe(0);

    await expect(storageGet(storageKey, {
      config: storageConfig,
      fetch: vi.fn().mockResolvedValue(response(503)) as any,
      timeoutMs: 10,
    })).rejects.toMatchObject<StorageReadError>({ kind: "server", providerStatus: 503 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not treat an unrelated downloadUrl AbortError as a timeout", async () => {
    vi.useFakeTimers();
    await expect(storageGet(storageKey, {
      config: storageConfig,
      fetch: vi.fn().mockRejectedValue(new DOMException("aborted elsewhere", "AbortError")) as any,
      timeoutMs: 10,
    })).rejects.toMatchObject<StorageReadError>({ stage: "download_url", kind: "transport" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("carries a download-url failure through the private-read boundary", async () => {
    const storage = signedStorage();
    storage.get.mockRejectedValue(new StorageReadError({
      stage: "download_url",
      kind: "rate_limit",
      providerStatus: 429,
    }));

    await expect(readTicketAttachment(clientId, chamadoId, attachmentId, { pool: activePool(), storage }))
      .rejects.toSatisfy(error => {
        expectReadFailure(error, "download_url", "rate_limit", 429);
        expect(ticketAttachmentReadHttpStatus(error)).toBe(503);
        return true;
      });
  });

  it("carries a download-url timeout through the private-read boundary as a 503", async () => {
    const storage = signedStorage();
    storage.get.mockRejectedValue(new StorageReadError({
      stage: "download_url",
      kind: "timeout",
      cause: new DOMException("aborted", "AbortError"),
    }));

    await expect(readTicketAttachment(clientId, chamadoId, attachmentId, { pool: activePool(), storage }))
      .rejects.toSatisfy(error => {
        expectReadFailure(error, "download_url", "timeout");
        expect((error as TicketAttachmentReadError).providerStatus).toBeUndefined();
        expect(ticketAttachmentReadHttpStatus(error)).toBe(503);
        return true;
      });
  });

  it("preserves signed-fetch not-found, auth, rate-limit, and server statuses", async () => {
    for (const [status, kind] of [[404, "not_found"], [401, "auth"], [403, "auth"], [429, "rate_limit"], [503, "server"]] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(status)));
      await expect(readTicketAttachment(clientId, chamadoId, attachmentId, { pool: activePool(), storage: signedStorage() }))
        .rejects.toSatisfy(error => {
          expectReadFailure(error, "signed_fetch", kind, status);
          return true;
        });
      vi.unstubAllGlobals();
    }
  });

  it("preserves a signed-fetch transport failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    await expect(readTicketAttachment(clientId, chamadoId, attachmentId, { pool: activePool(), storage: signedStorage() }))
      .rejects.toSatisfy(error => {
        expectReadFailure(error, "signed_fetch", "transport");
        expect(ticketAttachmentReadHttpStatus(error)).toBe(503);
        return true;
      });
  });

  it("does not treat an unrelated AbortError as a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted elsewhere", "AbortError")));
    await expect(readTicketAttachment(clientId, chamadoId, attachmentId, {
      pool: activePool(),
      storage: signedStorage(),
      timeoutMs: 10,
    }))
      .rejects.toSatisfy(error => {
        expectReadFailure(error, "signed_fetch", "transport");
        return true;
      });
  });

  it("classifies a hanging signed fetch as a timeout without a provider status", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_: URL, init?: RequestInit) => rejectWhenAborted(init?.signal));
    vi.stubGlobal("fetch", fetchMock);
    const pool = activePool();
    const storage = signedStorage();
    const result = readTicketAttachment(clientId, chamadoId, attachmentId, {
      pool,
      storage,
      timeoutMs: 10,
    });
    const expectation = expect(result).rejects.toSatisfy(error => {
      expectReadFailure(error, "signed_fetch", "timeout");
      expect((error as TicketAttachmentReadError).providerStatus).toBeUndefined();
      expect(ticketAttachmentReadHttpStatus(error)).toBe(503);
      return true;
    });

    await vi.advanceTimersByTimeAsync(10);
    await expectation;
    expect(vi.getTimerCount()).toBe(0);
    expect(pool.execute).toHaveBeenCalledTimes(1);
    expect(String(pool.execute.mock.calls[0][0])).toContain("SELECT a.storage_key");
    expect(storage.putExact).not.toHaveBeenCalled();
  });

  it("keeps the signed-fetch timeout active while reading the response body", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_: URL, init?: RequestInit) => Promise.resolve({
      ok: true,
      status: 200,
      arrayBuffer: () => rejectWhenAborted(init?.signal),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = readTicketAttachment(clientId, chamadoId, attachmentId, {
      pool: activePool(),
      storage: signedStorage(),
      timeoutMs: 10,
    });
    const expectation = expect(result).rejects.toSatisfy(error => {
      expectReadFailure(error, "signed_fetch", "timeout");
      expect(ticketAttachmentReadHttpStatus(error)).toBe(503);
      return true;
    });

    await vi.advanceTimersByTimeAsync(10);
    await expectation;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps invalid bytes and MIME validation separate from provider failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>invalid</html>", { status: 200 })));
    await expect(readTicketAttachment(clientId, chamadoId, attachmentId, { pool: activePool({ fileSize: 20 }), storage: signedStorage() }))
      .rejects.toSatisfy(error => {
        expectReadFailure(error, "content_validation", "content_invalid");
        expect(ticketAttachmentReadHttpStatus(error)).toBe(502);
        return true;
      });
  });

  it("returns validated bytes on a successful private read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok", { status: 200 })));
    await expect(readTicketAttachment(clientId, chamadoId, attachmentId, { pool: activePool(), storage: signedStorage() }))
      .resolves.toMatchObject({ bytes: Buffer.from("ok"), fileName: "evidence.txt", mimeType: "text/plain" });
  });

  it("clears the signed-fetch timer after a successful read", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok", { status: 200 })));
    await expect(readTicketAttachment(clientId, chamadoId, attachmentId, {
      pool: activePool(),
      storage: signedStorage(),
      timeoutMs: 10,
    }))
      .resolves.toMatchObject({ bytes: Buffer.from("ok") });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("logs only safe structured metadata for a read failure, including a timeout", () => {
    const error = new TicketAttachmentReadError({
      stage: "signed_fetch",
      kind: "auth",
      providerStatus: 401,
      cause: new Error("https://signed.invalid/file?secret=do-not-log"),
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logTicketAttachmentReadFailure(error, { attachmentId, chamadoId, clientId });

    expect(log).toHaveBeenCalledWith("[Ticket Attachments]", expect.objectContaining({
      event: "ticket_attachment_read_failed",
      stage: "signed_fetch",
      kind: "auth",
      providerStatus: 401,
      attachmentId,
      chamadoId,
      clientId,
      cause: "Error",
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret=do-not-log");

    logTicketAttachmentReadFailure(
      new TicketAttachmentReadError({ stage: "download_url", kind: "timeout", cause: new DOMException("aborted", "AbortError") }),
      { attachmentId, chamadoId, clientId },
    );
    expect(log).toHaveBeenLastCalledWith("[Ticket Attachments]", expect.objectContaining({
      event: "ticket_attachment_read_failed",
      stage: "download_url",
      kind: "timeout",
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret=do-not-log");
  });
});
