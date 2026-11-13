import { describe, expect, it, vi } from "vitest";
import { createSaleDocumentDownloadHandler } from "./documents-http";

const salePublicId = "11111111-1111-4111-8111-111111111111";
const documentPublicId = "22222222-2222-4222-8222-222222222222";

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

function session(permissions = ["erp"]) {
  return {
    tenantId: "tenant-session",
    userId: "viewer-a",
    role: "viewer" as const,
    permissions,
  };
}

describe("sale document authenticated download", () => {
  it("allows ERP read-only roles and resolves tenant identity server-side", async () => {
    const getForDownload = vi.fn().mockResolvedValue({
      bytes: Buffer.from("PDF"),
      mimeType: "application/pdf",
      fileName: "nota.pdf",
    });
    const handler = createSaleDocumentDownloadHandler(
      { getForDownload } as any,
      vi.fn(async () => session()) as any
    );
    const response = responseHarness();
    await handler({ params: { salePublicId, documentPublicId }, query: { preview: "1" }, headers: {} } as any, response);

    expect(getForDownload).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "tenant-session", role: "viewer" }),
      salePublicId,
      documentPublicId
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.headers["Cache-Control"]).toBe("private, no-store");
    expect(response.headers["Content-Disposition"]).toContain("inline");
  });

  it("denies sessions without ERP permission before document lookup", async () => {
    const getForDownload = vi.fn();
    const handler = createSaleDocumentDownloadHandler(
      { getForDownload } as any,
      vi.fn(async () => session(["clients"])) as any
    );
    const response = responseHarness();
    await handler({ params: { salePublicId, documentPublicId }, query: {}, headers: {} } as any, response);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(getForDownload).not.toHaveBeenCalled();
  });

  it("rejects malformed route ids before storage lookup", async () => {
    const getForDownload = vi.fn();
    const handler = createSaleDocumentDownloadHandler(
      { getForDownload } as any,
      vi.fn(async () => session()) as any
    );
    const response = responseHarness();
    await handler({ params: { salePublicId: "../other-tenant", documentPublicId }, query: {}, headers: {} } as any, response);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(getForDownload).not.toHaveBeenCalled();
  });

  it("serves quote PDF via direct download handler with order number resolution", async () => {
    const { createDirectSalePdfDownloadHandler } = await import("./documents-http");
    const getForDownload = vi.fn().mockResolvedValue({
      bytes: Buffer.from("PDF-BYTES"),
      mimeType: "application/pdf",
      fileName: "orcamento-O-21.pdf",
    });
    const list = vi.fn().mockResolvedValue([
      { documentType: "quote_pdf", state: "active", publicId: documentPublicId },
    ]);
    const handler = createDirectSalePdfDownloadHandler(
      { getForDownload, list } as any,
      vi.fn(async () => session(["crm"])) as any
    );
    const response = responseHarness();
    await handler({ params: { codeOrId: salePublicId }, query: {}, headers: {} } as any, response);

    expect(list).toHaveBeenCalled();
    expect(getForDownload).toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.headers["Content-Type"]).toBe("application/pdf");
    expect(response.headers["Content-Disposition"]).toContain("orcamento-O-21.pdf");
    expect(response.body).toEqual(Buffer.from("PDF-BYTES"));
  });
});
