import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTicketAttachmentFileHandler,
  TicketAttachmentReadError,
} from "./chamados-attachments";

const chamadoId = "11111111-1111-4111-8111-111111111111";
const attachmentId = "22222222-2222-4222-8222-222222222222";

function request() {
  return { params: { chamadoId, attachmentId }, headers: {} } as any;
}

function response() {
  const res: any = { status: vi.fn(), end: vi.fn(), send: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

const identity = async () => ({
  tenantId: "tenant-a",
  userId: "user-a",
  sessionId: "session-a",
  role: "agent" as const,
  permissions: [],
  userEmail: "operator@example.invalid",
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ticket attachment private HTTP route", () => {
  it("rejects an unauthenticated request before attempting a read", async () => {
    const read = vi.fn();
    const res = response();

    await createTicketAttachmentFileHandler(async () => null, read)(request(), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.end).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ["image/png", "captura segura.png", Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ["application/pdf", "relatório seguro\"\r\nInjected: yes.pdf", Buffer.from("%PDF-1.7\nfixture")],
  ] as const)("returns an authenticated inline %s with safe headers", async (mimeType, fileName, bytes) => {
    const read = vi.fn(async () => ({ bytes, fileName, mimeType, inline: true }));
    const res = response();

    await createTicketAttachmentFileHandler(identity, read as any)(request(), res);

    expect(read).toHaveBeenCalledWith("tenant-a", chamadoId, attachmentId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Security-Policy", "sandbox");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", mimeType);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Length", String(bytes.length));
    const disposition = res.setHeader.mock.calls.find((call: unknown[]) => call[0] === "Content-Disposition")?.[1] as string;
    expect(disposition).toMatch(/^inline; filename="[^"\r\n]+"; filename\*=UTF-8''(?:%[0-9A-F]{2})+$/);
    expect(res.send).toHaveBeenCalledWith(bytes);
  });

  it.each([
    [new TicketAttachmentReadError({ stage: "local", kind: "not_found" }), 404],
    [new TicketAttachmentReadError({ stage: "local_storage", kind: "internal", cause: new Error("synthetic missing file") }), 502],
  ] as const)("returns a controlled status when private read fails", async (failure, expectedStatus) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const read = vi.fn(async () => { throw failure; });
    const res = response();

    await createTicketAttachmentFileHandler(identity, read as any)(request(), res);

    expect(res.status).toHaveBeenCalledWith(expectedStatus);
    expect(res.end).toHaveBeenCalledOnce();
    expect(res.send).not.toHaveBeenCalled();
  });
});
