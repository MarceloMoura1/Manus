import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ticket attachment read error taxonomy", () => {
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

  it("logs only safe structured metadata for a read failure", () => {
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
  });
});
