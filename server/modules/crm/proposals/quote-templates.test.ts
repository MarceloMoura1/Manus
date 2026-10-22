import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Mock dependencies
const dbMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  addCrmTimeline: vi.fn(),
  getCompanySettings: vi.fn(),
  writeCrmClientFileAtomic: vi.fn(),
  readCrmClientFile: vi.fn(),
  evoSendAttachment: vi.fn(),
  instanceNameFor: vi.fn((clientId: string) => `megadesk-${clientId}`),
}));

vi.mock("../../../db", () => ({
  getPool: () => ({
    execute: dbMocks.execute,
  }),
}));

vi.mock("../../../db-crm", () => ({
  addCrmTimeline: dbMocks.addCrmTimeline,
}));

vi.mock("../../../db-company", () => ({
  getCompanySettings: dbMocks.getCompanySettings,
}));

vi.mock("../client-files/files-storage", () => ({
  writeCrmClientFileAtomic: dbMocks.writeCrmClientFileAtomic,
  readCrmClientFile: dbMocks.readCrmClientFile,
  deleteCrmClientFilePhysical: vi.fn(),
  removeCrmClientFilePhysical: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../evolution/client", () => ({
  evoSendAttachment: dbMocks.evoSendAttachment,
}));

vi.mock("../../../evolution/session-store", () => ({
  instanceNameFor: dbMocks.instanceNameFor,
}));

import { QuoteTemplatesService, type Identity } from "./quote-templates";

const identity: Identity = {
  clientId: "tenant-alpha",
  userId: "user-1",
  userName: "Vendedor Teste",
  role: "admin",
};

describe("QuoteTemplatesService", () => {
  let service: QuoteTemplatesService;
  let mockSaleService: any;
  let mockQuotePdfService: any;
  let mockDocumentService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSaleService = {
      detail: vi.fn(),
    };
    mockQuotePdfService = {
      generate: vi.fn(),
      generateWithBuffer: vi.fn(),
    };
    mockDocumentService = {
      list: vi.fn().mockResolvedValue([]),
      getForDownload: vi.fn(),
    };
    service = new QuoteTemplatesService(mockSaleService, mockQuotePdfService, mockDocumentService);
  });

  describe("listTemplates (Multitenant Isolation)", () => {
    it("filtra templates estritamente pelo clientId do tenant", async () => {
      dbMocks.execute.mockResolvedValueOnce([
        [
          {
            public_id: "tpl-1",
            name: "Template Oficina Mecânica",
            niche: "automotive",
            background_image_url: "https://storage.test/bg1.png",
            layout_config: '{"rowHeight": 25}',
            is_default: 1,
            created_at: "2026-10-21 00:00:00",
            updated_at: "2026-10-21 00:00:00",
          },
        ],
      ]);

      const result = await service.listTemplates(identity);

      expect(dbMocks.execute).toHaveBeenCalledWith(
        expect.stringContaining("WHERE client_id = ?"),
        [identity.clientId]
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        publicId: "tpl-1",
        name: "Template Oficina Mecânica",
        niche: "automotive",
        isDefault: true,
      });
    });
  });

  describe("createTemplate", () => {
    it("persiste novo template com escopo no tenant e armazena imagem base64 se fornecida", async () => {
      dbMocks.execute.mockResolvedValueOnce([{}]); // insert

      const result = await service.createTemplate(identity, {
        name: "Base Prestação de Serviços",
        niche: "services",
        fileBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        mimeType: "image/png",
        isDefault: true,
      });

      expect(dbMocks.writeCrmClientFileAtomic).toHaveBeenCalledWith(
        identity.clientId,
        expect.any(String),
        expect.any(Buffer)
      );
      expect(dbMocks.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO megadesk_crm_quote_templates"),
        expect.arrayContaining([identity.clientId, "Base Prestação de Serviços", "services"])
      );
      expect(result.success).toBe(true);
      expect(result.publicId).toBeDefined();
    });

    it("rejeita upload de formato de imagem não suportado (ex: pdf)", async () => {
      await expect(
        service.createTemplate(identity, {
          name: "Template Inválido",
          fileBase64: "data:application/pdf;base64,JVBERi0xLjQK",
          mimeType: "application/pdf",
        })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });
  });

  describe("deleteTemplate", () => {
    it("remove template garantindo validação de client_id", async () => {
      dbMocks.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await service.deleteTemplate(identity, "tpl-uuid-1");

      expect(dbMocks.execute).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM megadesk_crm_quote_templates WHERE client_id = ? AND public_id = ?"),
        [identity.clientId, "tpl-uuid-1"]
      );
      expect(result.success).toBe(true);
    });

    it("lança NOT_FOUND se o template pertencer a outro tenant ou inexistente", async () => {
      dbMocks.execute.mockResolvedValueOnce([{ affectedRows: 0 }]);

      await expect(service.deleteTemplate(identity, "tpl-outro-tenant")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("previewQuoteHtml (Paginação dinâmica e gaveta contextual)", () => {
    it("gera página única quando houver até 9 itens", async () => {
      const items = Array.from({ length: 5 }, (_, i) => ({
        publicId: `item-${i + 1}`,
        productName: `Peça automotiva ${i + 1}`,
        quantity: "1.000",
        unit: "un",
        unitPriceCents: 10000,
        lineTotalCents: 10000,
      }));

      mockSaleService.detail.mockResolvedValueOnce({
        publicId: "sale-1",
        documentType: "quote",
        orderNumber: "ORC-001",
        customerName: "Carlos Mecânica",
        commercialDate: "2026-10-21",
        commercialStatus: "negotiation",
        subtotalCents: 50000,
        discountCents: 0,
        freightCents: 0,
        chargesCents: 0,
        totalCents: 50000,
        items,
        documentCustomName: "Orcamento_Revisao_Carlos",
        serviceMetadata: {
          brandModel: "Honda Civic EXL",
          plate: "BRA2E19",
          year: "2021",
          color: "Cinza",
          km: "42.000",
        },
      });

      dbMocks.getCompanySettings.mockResolvedValueOnce({
        companyName: "Oficina Turbo MegaDesk",
      });
      dbMocks.execute.mockResolvedValueOnce([[]]); // no custom template

      const preview = await service.previewQuoteHtml(identity, { salePublicId: "sale-1" });

      expect(preview.totalPages).toBe(1);
      expect(preview.pages).toHaveLength(1);
      expect(preview.documentCustomName).toBe("Orcamento_Revisao_Carlos");
      expect(preview.hasServiceMetadata).toBe(true);
      expect(preview.pages[0].html).toContain("Honda Civic EXL");
      expect(preview.pages[0].html).toContain("BRA2E19");
      expect(preview.pages[0].html).toContain("Peça automotiva 5");
      expect(preview.pages[0].html).toContain("TOTAL GERAL");
    });

    it("divide automaticamente em Página 1 (itens 1 a 9) e Página 2 (itens subsequentes + totais) se > 9 itens", async () => {
      const items = Array.from({ length: 15 }, (_, i) => ({
        publicId: `item-${i + 1}`,
        productName: `Item Longo ${i + 1}`,
        quantity: "1.000",
        unit: "un",
        unitPriceCents: 2000,
        lineTotalCents: 2000,
      }));

      mockSaleService.detail.mockResolvedValueOnce({
        publicId: "sale-2",
        documentType: "quote",
        orderNumber: "ORC-002",
        customerName: "Frota Express",
        commercialDate: "2026-10-21",
        commercialStatus: "draft",
        subtotalCents: 30000,
        discountCents: 0,
        freightCents: 0,
        chargesCents: 0,
        totalCents: 30000,
        items,
      });

      dbMocks.getCompanySettings.mockResolvedValueOnce({
        companyName: "MegaDesk Serviços",
      });
      dbMocks.execute.mockResolvedValueOnce([[]]);

      const preview = await service.previewQuoteHtml(identity, { salePublicId: "sale-2" });

      expect(preview.totalPages).toBe(2);
      expect(preview.pages).toHaveLength(2);

      // Page 1 has items 1 to 9, without totals
      expect(preview.pages[0].html).toContain("Item Longo 1");
      expect(preview.pages[0].html).toContain("Item Longo 9");
      expect(preview.pages[0].html).not.toContain("Item Longo 10");
      expect(preview.pages[0].html).not.toContain("TOTAL:");

      // Page 2 has items 10 onwards and totals
      expect(preview.pages[1].html).toContain("Item Longo 10");
      expect(preview.pages[1].html).toContain("Item Longo 15");
      expect(preview.pages[1].html).toContain("TOTAL:");
      expect(preview.pages[1].html).toContain("R$ 300,00");
    });
  });

  describe("sendQuoteWhatsApp (Evolution API + Timeline)", () => {
    it("valida telefone via contact-phone, despacha documento e registra evento na timeline CRM", async () => {
      mockSaleService.detail.mockResolvedValueOnce({
        publicId: "sale-3",
        crmClientId: "crm-client-99",
        documentType: "quote",
        orderNumber: "ORC-999",
        customerName: "Ana Paula Silva",
        totalCents: 125000,
        documentCustomName: "Orcamento_Ana_Paula_Freios",
      });

      mockQuotePdfService.generate.mockResolvedValueOnce({
        filePublicId: "doc-stored-uuid",
        fileName: "Orcamento_Ana_Paula_Freios.pdf",
      });

      dbMocks.readCrmClientFile.mockResolvedValueOnce(Buffer.from("PDF-SYNTHETIC-BYTES"));
      dbMocks.evoSendAttachment.mockResolvedValueOnce({
        key: { id: "EVO-MSG-12345" },
        message: {},
      });

      const result = await service.sendQuoteWhatsApp(identity, {
        publicId: "sale-3",
        phone: "11988887777", // formato nacional válido que contact-phone normaliza para 5511988887777
      });

      expect(dbMocks.evoSendAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceName: "megadesk-tenant-alpha",
          number: "5511988887777",
          kind: "document",
          fileName: "Orcamento_Ana_Paula_Freios.pdf",
        })
      );

      expect(dbMocks.addCrmTimeline).toHaveBeenCalledWith(
        "crm-client-99",
        identity.clientId,
        expect.objectContaining({
          type: "quote_sent_whatsapp",
          description: expect.stringContaining("ORC-999"),
        })
      );

      expect(result).toMatchObject({
        success: true,
        messageId: "EVO-MSG-12345",
        fileName: "Orcamento_Ana_Paula_Freios.pdf",
      });
    });

    it("reutiliza documento físico existente no storage sem reprocessar", async () => {
      mockSaleService.detail.mockResolvedValueOnce({
        publicId: "sale-existing-pdf",
        crmClientId: "crm-client-50",
        documentType: "quote",
        orderNumber: "ORC-500",
        customerName: "Carlos Drum",
        totalCents: 50000,
      });

      mockDocumentService.list.mockResolvedValueOnce([
        {
          publicId: "doc-active-1",
          documentType: "quote_pdf",
          state: "active",
          fileName: "Orcamento-ORC-500.pdf",
        },
      ]);

      mockDocumentService.getForDownload.mockResolvedValueOnce({
        bytes: Buffer.from("EXISTING-PDF-BYTES"),
        fileName: "Orcamento-ORC-500.pdf",
      });

      dbMocks.evoSendAttachment.mockResolvedValueOnce({
        key: { id: "EVO-REUSED-1" },
        message: {},
      });

      const result = await service.sendQuoteWhatsApp(identity, {
        publicId: "sale-existing-pdf",
        phone: "11977778888",
      });

      expect(mockQuotePdfService.generateWithBuffer).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.messageId).toBe("EVO-REUSED-1");
    });

    it("rejeita envio se número informado for inválido", async () => {
      mockSaleService.detail.mockResolvedValueOnce({
        publicId: "sale-4",
        crmClientId: "crm-client-10",
        documentType: "quote",
        orderNumber: "ORC-100",
        customerName: "Cliente Número Inválido",
        totalCents: 10000,
      });

      await expect(
        service.sendQuoteWhatsApp(identity, {
          publicId: "sale-4",
          phone: "123", // inválido
        })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("persiste mensagem outbound em megadesk_domain_conversations_messages com media_reference e status sent", async () => {
      mockSaleService.detail.mockResolvedValueOnce({
        publicId: "sale-chat-1",
        crmClientId: "crm-client-77",
        documentType: "quote",
        orderNumber: "ORC-777",
        customerName: "Lucas Mendes",
        totalCents: 75000,
      });

      mockQuotePdfService.generate.mockResolvedValueOnce({
        filePublicId: "doc-chat-uuid",
        fileName: "Orcamento_Lucas.pdf",
      });

      dbMocks.readCrmClientFile.mockResolvedValueOnce(Buffer.from("PDF-CHAT-BYTES"));
      dbMocks.evoSendAttachment.mockResolvedValueOnce({
        key: { id: "EVO-CHAT-MSG-77" },
        message: {},
      });

      const dbExecCalls: any[] = [];
      dbMocks.execute.mockImplementation(async (sql: string, params: any[]) => {
        dbExecCalls.push({ sql, params });
        if (sql.includes("SELECT conversation_id")) {
          return [[{ conversation_id: "conv-lucas-1", messages_json: "[]" }]];
        }
        if (sql.includes("SELECT messages_json")) {
          return [[{ messages_json: "[]" }]];
        }
        return [{ affectedRows: 1 }];
      });

      const result = await service.sendQuoteWhatsApp(identity, {
        publicId: "sale-chat-1",
        phone: "11999998888",
        customMessage: "Segue proposta comercial em anexo",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("EVO-CHAT-MSG-77");

      // Verificar insert em megadesk_domain_conversations_messages
      const insertMessageCall = dbExecCalls.find((c) =>
        c.sql.includes("INSERT INTO megadesk_domain_conversations_messages")
      );
      expect(insertMessageCall).toBeDefined();
      expect(insertMessageCall.sql).toContain("'outbound'");
      expect(insertMessageCall.sql).toContain("'document'");
      expect(insertMessageCall.sql).toContain("'operator'");
      expect(insertMessageCall.params).toContain("conv-lucas-1");
      expect(insertMessageCall.params).toContain(identity.clientId);
      expect(insertMessageCall.params[6]).toContain("Orcamento_Lucas.pdf"); // media_reference

      // Verificar update na conversa
      const updateConvCall = dbExecCalls.find((c) =>
        c.sql.includes("UPDATE megadesk_domain_conversations")
      );
      expect(updateConvCall).toBeDefined();
    });
  });

  describe("Folha Timbrada Milimétrica (Low Garage)", () => {
    it("renderiza overlay transparente quando template possui backgroundImageUrl, sem cabeçalhos genéricos e com charset UTF-8", async () => {
      mockSaleService.detail.mockResolvedValueOnce({
        publicId: "sale-low-garage",
        documentType: "quote",
        orderNumber: "ORC-042",
        customerName: "Oficina Low Garage Cliente",
        customerPhone: "(11) 98765-4321",
        customerAddress: "Av. Automotiva",
        customerAddressNumber: "100",
        commercialDate: "2026-10-21",
        commercialStatus: "draft",
        subtotalCents: 50000,
        chargesCents: 15000,
        freightCents: 5000,
        discountCents: 0,
        totalCents: 70000,
        paymentTerms: "30 dias no boleto",
        notes: "Entregar peças limpas",
        serviceMetadata: {
          brandModel: "Nissan 350Z Drift",
          plate: "DFT-3500",
          year: "2008",
          color: "Cinza",
          km: "85000",
          entryDate: "2026-10-20",
          exitDate: "2026-10-25",
        },
        items: [
          {
            publicId: "item-1",
            productName: "Troca Pastilhas Cerâmica Brembo",
            quantity: "1.000",
            unit: "serv",
            unitPriceCents: 50000,
            lineTotalCents: 50000,
          },
        ],
      });

      dbMocks.getCompanySettings.mockResolvedValueOnce({
        companyName: "Low Garage",
        address: "Rua do Galpão 50",
      });

      // Retorna template configurado com imagem de fundo
      dbMocks.execute.mockResolvedValueOnce([
        [
          {
            public_id: "tpl-low-garage",
            name: "Low Garage Folha Timbrada",
            niche: "automotive",
            background_image_url: "https://bucket/low-garage.jpg",
            layout_config: JSON.stringify({ mimeType: "image/jpeg" }),
            is_default: 1,
            created_at: "2026-10-21",
            updated_at: "2026-10-21",
          },
        ],
      ]);
      dbMocks.readCrmClientFile.mockResolvedValueOnce(Buffer.from("FAKE-JPEG-BYTES"));

      const preview = await service.previewQuoteHtml(identity, { salePublicId: "sale-low-garage" });

      expect(preview.pages).toHaveLength(1);
      const html = preview.pages[0].html;

      // Charset UTF-8 explícito
      expect(html).toContain('<meta charset="UTF-8">');

      // Folha A4 vetorial nativa sem dependência de imagem rasterizada
      expect(html).toContain("native-automotive-sheet");
      expect(html).toContain("a4-sheet");
      expect(html).toContain("210mm");
      expect(html).toContain("297mm");

      // Campos mapeados no grid semântico
      expect(html).toContain("ORC-042");
      expect(html).toContain("Oficina Low Garage Cliente");
      expect(html).toContain("Nissan 350Z Drift");
      expect(html).toContain("DFT-3500");
      expect(html).toContain("85000 km");
      expect(html).toContain("Troca Pastilhas Cerâmica Brembo");
      expect(html).toContain("R$ 700,00");
      expect(html).toContain("DADOS DO CLIENTE");
      expect(html).toContain("DADOS DO VEÍCULO / OBJETO");
      expect(html).toContain("TOTAL GERAL");

      // Não utiliza coordenadas de sobreposição frágil sobre imagem de fundo JPG
      expect(html).not.toContain("letterhead-overlay");
      expect(html).not.toContain("top: 136mm");

      // NÃO deve conter títulos corporativos genéricos ou cabeçalhos de tabela azuis
      expect(html).not.toContain("MEGADESK COMERCIAL");
      expect(html).not.toContain("background: #1e3a8a");
    });

    it("garante que sendQuoteWhatsApp persiste rota resolúvel de PDF (/api/erp/sales/:publicId/pdf) e outbound no chat", async () => {
      mockSaleService.detail.mockResolvedValueOnce({
        publicId: "sale-media-check",
        crmClientId: "crm-client-99",
        documentType: "quote",
        orderNumber: "ORC-999",
        customerName: "Carlos Alinhamento",
        totalCents: 120000,
      });

      mockQuotePdfService.generate.mockResolvedValueOnce({
        filePublicId: "doc-media-check",
        fileName: "Orcamento_Carlos.pdf",
      });

      dbMocks.readCrmClientFile.mockResolvedValueOnce(Buffer.from("PDF-BYTES-MEDIA"));
      dbMocks.evoSendAttachment.mockResolvedValueOnce({
        key: { id: "EVO-MEDIA-MSG-99" },
      });

      const execCalls: any[] = [];
      dbMocks.execute.mockImplementation(async (sql: string, params: any[]) => {
        execCalls.push({ sql, params });
        if (sql.includes("SELECT conversation_id")) {
          return [[{ conversation_id: "conv-carlos", messages_json: "[]" }]];
        }
        if (sql.includes("SELECT messages_json")) {
          return [[{ messages_json: "[]" }]];
        }
        return [{ affectedRows: 1 }];
      });

      await service.sendQuoteWhatsApp(identity, {
        publicId: "sale-media-check",
        phone: "11999991111",
      });

      const insertCall = execCalls.find((c) =>
        c.sql.includes("INSERT INTO megadesk_domain_conversations_messages")
      );
      expect(insertCall).toBeDefined();
      const mediaRefObj = JSON.parse(insertCall.params[6]);
      expect(mediaRefObj.url).toBe("/api/erp/sales/sale-media-check/pdf");
      expect(mediaRefObj.mediaUrl).toBe("/api/erp/sales/sale-media-check/pdf");
      expect(mediaRefObj.mimeType).toBe("application/pdf");

      const updateCall = execCalls.find((c) =>
        c.sql.includes("UPDATE megadesk_domain_conversations")
      );
      expect(updateCall).toBeDefined();
      const messagesJson = JSON.parse(updateCall.params[0]);
      expect(messagesJson[0].url).toBe("/api/erp/sales/sale-media-check/pdf");
      expect(messagesJson[0].from).toBe("agent");
      expect(messagesJson[0].sender).toBe("operator");
      expect(messagesJson[0].direction).toBe("outbound");
    });
  });
});
