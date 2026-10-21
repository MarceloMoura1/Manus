import { describe, expect, it, vi } from "vitest";
import { QuotePdfService } from "./quote-pdf-service";

const tenant = "tenant-a";
const salePublicId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "22222222-2222-4222-8222-222222222222";
const admin = { clientId: tenant, userId: "admin-a", userName: "Ana Admin", role: "admin" as const };

function quote(overrides: Record<string, unknown> = {}) {
  return {
    publicId: salePublicId,
    orderNumber: "O-1024",
    documentType: "quote",
    commercialStatus: "negotiation",
    commercialDate: "2026-10-16",
    customerName: "Cliente de Teste",
    paymentTerms: "30 dias",
    notes: "Entrega mediante disponibilidade.",
    archivedAt: null,
    subtotalCents: 25000,
    discountCents: 500,
    freightCents: 1000,
    chargesCents: 0,
    totalCents: 25500,
    items: [{
      productName: "Produto profissional",
      sku: "SKU-001",
      quantity: "2.000",
      unit: "un",
      unitPriceCents: 12500,
      discountCents: 500,
      lineTotalCents: 24500,
    }],
    ...overrides,
  };
}

function harness(detail: unknown = quote()) {
  const repository = { detail: vi.fn(async () => detail) };
  const documents = { storeGeneratedQuotePdf: vi.fn(async (_identity, input) => ({ publicId: "doc-a", ...input })) };
  const companySettings = vi.fn(async (clientId: string) => clientId === tenant ? {
    companyName: "MegaDesk Comércio",
    primaryEmail: "vendas@example.test",
    primaryPhone: "(11) 99999-0000",
    primaryWhatsapp: null,
    address: "Rua Exemplo, 100",
  } : null);
  return {
    repository,
    documents,
    companySettings,
    service: new QuotePdfService(repository as never, documents as never, companySettings as never),
  };
}

describe("quote PDF service", () => {
  it("renders from the tenant-scoped persisted quote and stores a private generated snapshot", async () => {
    const { service, repository, documents, companySettings } = harness();

    const result = await service.generate(admin, { salePublicId, idempotencyKey });

    expect(repository.detail).toHaveBeenCalledWith(tenant, salePublicId);
    expect(companySettings).toHaveBeenCalledWith(tenant);
    expect(documents.storeGeneratedQuotePdf).toHaveBeenCalledWith(admin, expect.objectContaining({
      salePublicId,
      idempotencyKey,
      fileName: "orcamento-O-1024.pdf",
      description: "PDF gerado a partir do orçamento O-1024.",
      bytes: expect.any(Buffer),
    }));
    expect(documents.storeGeneratedQuotePdf.mock.calls[0][1].bytes.subarray(0, 8).toString("ascii")).toBe("%PDF-1.4");
    expect(result).toMatchObject({ publicId: "doc-a", salePublicId });
  });

  it("strips diacritics from the custom file name instead of emitting underscores", async () => {
    const { service, documents } = harness(quote({ documentCustomName: "Orçamento - FaYers Company - 21-10-2026" }));

    await service.generate(admin, { salePublicId, idempotencyKey });

    expect(documents.storeGeneratedQuotePdf.mock.calls[0][1].fileName)
      .toBe("Orcamento - FaYers Company - 21-10-2026.pdf");
  });

  it("blocks a read-only role before resolving or storing a quote", async () => {
    const { service, repository, documents, companySettings } = harness();

    await expect(service.generate({ ...admin, role: "viewer" }, { salePublicId, idempotencyKey }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repository.detail).not.toHaveBeenCalled();
    expect(companySettings).not.toHaveBeenCalled();
    expect(documents.storeGeneratedQuotePdf).not.toHaveBeenCalled();
  });

  it("does not generate a PDF for a tenant-missing, non-quote, or archived order", async () => {
    for (const detail of [null, quote({ documentType: "sale" }), quote({ archivedAt: "2026-10-16T12:00:00.000Z" })]) {
      const { service, documents } = harness(detail);
      await expect(service.generate(admin, { salePublicId, idempotencyKey })).rejects.toMatchObject({
        code: detail && (detail as { archivedAt: string | null }).archivedAt ? "CONFLICT" : "NOT_FOUND",
      });
      expect(documents.storeGeneratedQuotePdf).not.toHaveBeenCalled();
    }
  });
});
