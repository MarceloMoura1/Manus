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
  listTemplates: vi.fn(),
  createTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  updateMetadata: vi.fn(),
  previewQuoteHtml: vi.fn(),
  sendQuoteWhatsApp: vi.fn(),
}));

vi.mock("./quote-templates", () => ({
  QuoteTemplatesService: vi.fn().mockImplementation(() => ({
    listTemplates: mocks.listTemplates,
    createTemplate: mocks.createTemplate,
    deleteTemplate: mocks.deleteTemplate,
    updateMetadata: mocks.updateMetadata,
    previewQuoteHtml: mocks.previewQuoteHtml,
    sendQuoteWhatsApp: mocks.sendQuoteWhatsApp,
  })),
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

  it("lista templates de orçamento filtrados pelo tenant", async () => {
    mocks.listTemplates.mockResolvedValueOnce([
      {
        publicId: "tpl-1",
        name: "Modelo Oficina",
        niche: "automotive",
        isDefault: true,
      },
    ]);

    const caller = proposalsRouter.createCaller(createCrmContext());
    const res = await caller.listTemplates();

    expect(mocks.listTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "tenant-crm-1" })
    );
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe("Modelo Oficina");
  });

  it("cria novo template nomeado com escopo no tenant", async () => {
    mocks.createTemplate.mockResolvedValueOnce({
      success: true,
      publicId: "tpl-novo-1",
    });

    const caller = proposalsRouter.createCaller(createCrmContext());
    const res = await caller.createTemplate({
      name: "Template Venda Balcão",
      niche: "general",
      isDefault: true,
    });

    expect(mocks.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "tenant-crm-1" }),
      expect.objectContaining({
        name: "Template Venda Balcão",
        niche: "general",
        isDefault: true,
      })
    );
    expect(res.success).toBe(true);
    expect(res.publicId).toBe("tpl-novo-1");
  });

  it("gera prévia HTML do orçamento compilando template e paginação", async () => {
    const salePublicId = "11111111-1111-4111-8111-111111111111";
    mocks.previewQuoteHtml.mockResolvedValueOnce({
      pages: [{ pageNumber: 1, html: "<div>A4 Page 1</div>" }],
      totalPages: 1,
      documentCustomName: "Orcamento_Carlos_21-10",
      templateName: "Padrão",
      hasServiceMetadata: true,
      itemsCount: 3,
    });

    const caller = proposalsRouter.createCaller(createCrmContext());
    const res = await caller.previewQuoteHtml({ salePublicId });

    expect(mocks.previewQuoteHtml).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "tenant-crm-1" }),
      { salePublicId }
    );
    expect(res.totalPages).toBe(1);
    expect(res.documentCustomName).toBe("Orcamento_Carlos_21-10");
  });

  it("dispara orçamento via WhatsApp com documento anexado", async () => {
    const publicId = "11111111-1111-4111-8111-111111111111";
    mocks.sendQuoteWhatsApp.mockResolvedValueOnce({
      success: true,
      messageId: "EVO-MSG-1",
      fileName: "Orcamento_Teste.pdf",
      recipientPhone: "+55 11 98888-7777",
    });

    const caller = proposalsRouter.createCaller(createCrmContext());
    const res = await caller.sendQuoteWhatsApp({
      publicId,
      phone: "11988887777",
    });

    expect(mocks.sendQuoteWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "tenant-crm-1" }),
      expect.objectContaining({
        publicId,
        phone: "11988887777",
      })
    );
    expect(res.success).toBe(true);
    expect(res.messageId).toBe("EVO-MSG-1");
  });
});
