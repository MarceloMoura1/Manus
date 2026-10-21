import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  commercialTransition: vi.fn(),
  convertQuote: vi.fn(),
  generatePdf: vi.fn(),
  documentsList: vi.fn(),
  catalog: vi.fn(),
}));

vi.mock("../../erp/sales/service", () => ({
  SaleService: vi.fn().mockImplementation(() => ({
    list: mocks.list,
    detail: mocks.detail,
    create: mocks.create,
    update: mocks.update,
    commercialTransition: mocks.commercialTransition,
    convertQuote: mocks.convertQuote,
    catalog: mocks.catalog,
  })),
}));

vi.mock("../../erp/sales/quote-pdf-service", () => ({
  QuotePdfService: vi.fn().mockImplementation(() => ({
    generate: mocks.generatePdf,
  })),
}));

vi.mock("../../erp/sales/documents-service", () => ({
  SaleDocumentService: vi.fn().mockImplementation(() => ({
    list: mocks.documentsList,
  })),
}));

import { proposalsRouter } from "./router";

function createCrmContext(
  role: "admin" | "manager" | "agent" | "viewer" = "admin",
  permissions: string[] = ["crm"]
) {
  return {
    tenantId: "tenant-crm-1",
    operationalUserId: `user-${role}`,
    operationalUserRole: role,
    operationalPermissions: permissions,
    userName: `CRM ${role}`,
    userEmail: `${role}@megadesk.test`,
  } as any;
}

describe("CRM Proposals tRPC Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exige permissão dedicada crm para acessar listagem de propostas", async () => {
    const caller = proposalsRouter.createCaller(
      createCrmContext("admin", ["clients"])
    );

    await expect(caller.list({})).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Acesso restrito ao módulo CRM.",
    });
  });

  it("lista propostas comerciais forçando kind='quotes'", async () => {
    mocks.list.mockResolvedValueOnce({
      items: [
        {
          publicId: "prop-1",
          orderNumber: "ORC-0001",
          documentType: "quote",
          customerName: "Empresa XPTO",
          totalCents: 150000,
        },
      ],
      total: 1,
      totalPages: 1,
      page: 1,
      pageSize: 50,
      canWrite: true,
    });

    const caller = proposalsRouter.createCaller(createCrmContext());
    const res = await caller.list({ search: "XPTO", page: 1, pageSize: 50 });

    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "tenant-crm-1",
        userId: "user-admin",
        role: "admin",
      }),
      expect.objectContaining({
        kind: "quotes",
        search: "XPTO",
        page: 1,
        pageSize: 50,
      })
    );
    expect(res.items).toHaveLength(1);
    expect(res.items[0].orderNumber).toBe("ORC-0001");
  });

  it("obtém detalhes da proposta e anexa documentos", async () => {
    const quotePublicId = "11111111-1111-4111-8111-111111111111";
    mocks.detail.mockResolvedValueOnce({
      publicId: quotePublicId,
      orderNumber: "ORC-0001",
      customerName: "Empresa XPTO",
      items: [],
    });
    mocks.documentsList.mockResolvedValueOnce([
      { publicId: "doc-1", fileName: "proposta.pdf" },
    ]);

    const caller = proposalsRouter.createCaller(createCrmContext());
    const res = await caller.detail({ publicId: quotePublicId });

    expect(mocks.detail).toHaveBeenCalledWith(
      expect.anything(),
      quotePublicId
    );
    expect(mocks.documentsList).toHaveBeenCalledWith(
      expect.anything(),
      quotePublicId
    );
    expect(res.publicId).toBe(quotePublicId);
    expect(res.documents).toHaveLength(1);
  });

  it("converte proposta comercial em venda chamando convertQuote", async () => {
    const quotePublicId = "11111111-1111-4111-8111-111111111111";
    mocks.convertQuote.mockResolvedValueOnce({
      publicId: quotePublicId,
      documentType: "quote",
      commercialStatus: "converted",
      orderNumber: "ORC-0001",
      linkedSalePublicId: "22222222-2222-4222-8222-222222222222",
    });

    const caller = proposalsRouter.createCaller(createCrmContext());
    const res = await caller.convertQuoteToSale({ publicId: quotePublicId });

    expect(mocks.convertQuote).toHaveBeenCalledWith(
      expect.anything(),
      quotePublicId,
      expect.any(String)
    );
    expect(res.success).toBe(true);
    expect(res.sale.commercialStatus).toBe("converted");
  });

  it("atualiza status comercial da proposta", async () => {
    const quotePublicId = "11111111-1111-4111-8111-111111111111";
    mocks.commercialTransition.mockResolvedValueOnce({
      publicId: quotePublicId,
      commercialStatus: "approved",
    });

    const caller = proposalsRouter.createCaller(createCrmContext());
    const res = await caller.updateCommercialStatus({
      publicId: quotePublicId,
      toStatus: "approved",
    });

    expect(mocks.commercialTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        publicId: quotePublicId,
        toStatus: "approved",
      })
    );
    expect(res.success).toBe(true);
  });
});
