import { describe, expect, it, vi } from "vitest";
import { ErpDomainError } from "../../erp/errors";
import type { ClientFileService } from "./files-service";
import { createClientFileDownloadHandler } from "./files-router";

const canonicalId = "crm-11111111-1111-4111-8111-111111111111";
const filePublicId = "22222222-2222-4222-8222-222222222222";

function responseHarness() {
  const response: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined,
    status: vi.fn((code: number) => { response.statusCode = code; return response; }),
    setHeader: vi.fn((name: string, value: string) => { response.headers[name] = value; }),
    send: vi.fn((body: unknown) => { response.body = body; return response; }),
    end: vi.fn(() => response),
  };
  return response;
}

const sessionResolver = vi.fn(async () => ({
  tenantId: "tenant-a",
  userId: "admin-a",
  role: "admin" as const,
  permissions: ["clients"],
}));

describe("CRM client-files HTTP download", () => {
  it("accepts the real crm-<uuid> identity and serves the file", async () => {
    const getFileForDownload = vi.fn().mockResolvedValue({ bytes: Buffer.from("PDF"), mimeType: "application/pdf", fileName: "contrato.pdf" });
    const handler = createClientFileDownloadHandler({ getFileForDownload } as unknown as ClientFileService, sessionResolver as any);
    const response = responseHarness();

    await handler({ params: { crmClientId: canonicalId, filePublicId }, query: {}, headers: {} } as any, response);

    expect(getFileForDownload).toHaveBeenCalledWith({ clientId: "tenant-a", userId: "admin-a", role: "admin" }, canonicalId, filePublicId);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.body).toEqual(Buffer.from("PDF"));
  });

  it.each([
    { crmClientId: "x".repeat(81), filePublicId },
    { crmClientId: canonicalId, filePublicId: "not-a-uuid" },
  ])("returns 400 before storage lookup for invalid route identities", async params => {
    const getFileForDownload = vi.fn();
    const handler = createClientFileDownloadHandler({ getFileForDownload } as unknown as ClientFileService, sessionResolver as any);
    const response = responseHarness();
    await handler({ params, query: {}, headers: {} } as any, response);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(getFileForDownload).not.toHaveBeenCalled();
  });

  it("maps a tenant-scoped missing client or file to 404 without leaking ownership", async () => {
    const getFileForDownload = vi.fn().mockRejectedValue(new ErpDomainError("NOT_FOUND", "Cliente não encontrado."));
    const handler = createClientFileDownloadHandler({ getFileForDownload } as unknown as ClientFileService, sessionResolver as any);
    const response = responseHarness();
    await handler({ params: { crmClientId: canonicalId, filePublicId }, query: {}, headers: {} } as any, response);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.end).toHaveBeenCalled();
  });
});
