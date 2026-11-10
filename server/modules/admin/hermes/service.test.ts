import { describe, it, expect, vi, beforeEach } from "vitest";
import { HermesService, CANONICAL_HERMES_MODEL } from "./service";
import { HermesRepository } from "./repository";
import { resolveAdminUserId, hermesRouter, createHermesRouter } from "./router";
import type { HermesMessageItem, HermesRole } from "./contracts";
import { TRPCError } from "@trpc/server";

class MockHermesRepository extends HermesRepository {
  private messages: HermesMessageItem[] = [];
  private nextId = 1;

  async getHistory(adminUserId: string): Promise<HermesMessageItem[]> {
    return this.messages.filter((m) => m.adminUserId === adminUserId);
  }

  async saveMessage(
    adminUserId: string,
    role: HermesRole,
    content: string,
    metadataJson?: Record<string, unknown> | null
  ): Promise<HermesMessageItem> {
    const item: HermesMessageItem = {
      id: this.nextId++,
      adminUserId,
      role,
      content,
      metadataJson: metadataJson ?? null,
      createdAt: new Date().toISOString(),
    };
    this.messages.push(item);
    return item;
  }

  async clearHistory(adminUserId: string): Promise<{ success: boolean; clearedCount: number }> {
    const initialCount = this.messages.length;
    this.messages = this.messages.filter((m) => m.adminUserId !== adminUserId);
    return {
      success: true,
      clearedCount: initialCount - this.messages.length,
    };
  }

  getAllMessages() {
    return this.messages;
  }
}

describe("Hermes Module - Vercel AI SDK & Strict Partner Isolation", () => {
  let mockRepo: MockHermesRepository;
  let mockAiGenerate: any;
  let service: HermesService;

  beforeEach(() => {
    mockRepo = new MockHermesRepository();
    mockAiGenerate = vi.fn().mockResolvedValue({
      text: "Resposta executiva gerada via Gemini 3.5 Flash Lite.",
      toolCalls: [],
    });
    service = new HermesService(mockRepo, undefined, mockAiGenerate);
    delete process.env.GEMINI_API_KEY;
  });

  describe("resolveAdminUserId", () => {
    it("resolves email in lowercase", () => {
      expect(resolveAdminUserId({ email: "SocioA@MegaDesk.online" })).toBe("socioa@megadesk.online");
    });

    it("resolves openId when email is absent", () => {
      expect(resolveAdminUserId({ openId: "admin-open-id-123" })).toBe("admin-open-id-123");
    });

    it("throws UNAUTHORIZED when no identifier is present", () => {
      expect(() => resolveAdminUserId({})).toThrow(TRPCError);
    });
  });

  describe("HermesService - Strict Partner Isolation", () => {
    it("guarantees that Sócio A and Sócio B have completely isolated conversation histories", async () => {
      process.env.GEMINI_API_KEY = "test-key-partner-isolation";

      const socioA = "socio.a@megadesk.online";
      const socioB = "socio.b@megadesk.online";

      // Sócio A sends a message
      await service.sendMessage(socioA, "Como está a infraestrutura hoje?");

      // Sócio B sends a different message
      await service.sendMessage(socioB, "Preciso de um resumo de faturamento");

      // Verify Sócio A's history
      const historyA = await service.getHistory(socioA);
      expect(historyA.length).toBe(2); // 1 user + 1 assistant
      expect(historyA[0].content).toBe("Como está a infraestrutura hoje?");
      expect(historyA.every((m) => m.adminUserId === socioA)).toBe(true);

      // Verify Sócio B's history
      const historyB = await service.getHistory(socioB);
      expect(historyB.length).toBe(2); // 1 user + 1 assistant
      expect(historyB[0].content).toBe("Preciso de um resumo de faturamento");
      expect(historyB.every((m) => m.adminUserId === socioB)).toBe(true);

      // Sócio A clearing history does NOT delete Sócio B's messages
      await service.clearHistory(socioA);

      const historyAAfterClear = await service.getHistory(socioA);
      expect(historyAAfterClear.length).toBe(0);

      const historyBAfterClear = await service.getHistory(socioB);
      expect(historyBAfterClear.length).toBe(2);
    });

    it("informs cleanly when GEMINI_API_KEY is not configured without using hardcoded regex fallbacks", async () => {
      delete process.env.GEMINI_API_KEY;

      const socioA = "marcelo@megadesk.online";
      const result = await service.sendMessage(socioA, "Faça uma vistoria da VPS");
      expect(result.response.content).toContain("GEMINI_API_KEY");
      expect(result.response.metadataJson?.source).toBe("unconfigured_key");
      expect(mockAiGenerate).not.toHaveBeenCalled();
    });

    it("executes Vercel AI SDK generateText with canonical gemini-3.5-flash-lite model and clean tools", async () => {
      process.env.GEMINI_API_KEY = "valid-test-key";

      const socioA = "marcelo@megadesk.online";
      const result = await service.sendMessage(socioA, "Qual o status dos containers?");

      expect(mockAiGenerate).toHaveBeenCalledTimes(1);
      const callArgs = mockAiGenerate.mock.calls[0][0];
      expect(callArgs.system).toContain("Hermes");
      expect(callArgs.messages.length).toBe(1);
      expect(callArgs.messages[0]).toEqual({
        role: "user",
        content: "Qual o status dos containers?",
      });

      // Verifica ferramentas disponíveis
      expect(callArgs.tools).toBeDefined();
      expect(callArgs.tools.inspectTenantStorage).toBeDefined();
      expect(callArgs.tools.vistoriaVps).toBeDefined();
      expect(callArgs.tools.whatsappCheck).toBeDefined();
      expect(callArgs.tools.tokenTelemetry).toBeDefined();
      expect(callArgs.tools.securityAudit).toBeDefined();

      expect(result.response.content).toBe("Resposta executiva gerada via Gemini 3.5 Flash Lite.");
      expect(result.response.metadataJson?.model).toBe(CANONICAL_HERMES_MODEL);
      expect(result.response.metadataJson?.source).toBe("gemini_api");
    });

    it("provides Zod-schema tools that execute operational inspection safely", async () => {
      const mockInspector = vi.fn().mockResolvedValue({
        tenantFound: true,
        clientName: "FaYerS Indústria",
        clientId: "client-fayers-01",
        totalMessages: 1250,
        mediaCount: 140,
        totalContacts: 326,
        contatosWhatsApp: 310,
        clientesCrm: 6,
        clientesErp: 10,
        totalConversations: 450,
        totalChamados: 85,
        chamadosAbertos: 2,
        estimatedDbSizeFormatted: "4.39 MB",
        activeStatus: "active",
      });

      const customService = new HermesService(mockRepo, mockInspector, mockAiGenerate);
      const tools = customService.getTools();

      // Testa execução direta da tool com schema Zod limpo
      const tenantToolRes = await tools.inspectTenantStorage.execute({ slugOrName: "FaYerS" });
      expect(mockInspector).toHaveBeenCalledWith("FaYerS");
      expect(tenantToolRes.clientName).toBe("FaYerS Indústria");
      expect(tenantToolRes.totalMessages).toBe(1250);

      // Testa tool de vistoria da VPS
      const vpsToolRes = await tools.vistoriaVps.execute({});
      expect(vpsToolRes.status).toBe("online");
      expect(vpsToolRes.containers.app).toContain("megadesk-app");

      // Testa tool do WhatsApp Evolution
      const wppToolRes = await tools.whatsappCheck.execute({});
      expect(wppToolRes.service).toBe("Evolution API");
      expect(wppToolRes.status).toBe("online");

      // Testa telemetria de tokens
      const tokenToolRes = await tools.tokenTelemetry.execute({});
      expect(tokenToolRes.canonicalModel).toBe(CANONICAL_HERMES_MODEL);
    });

    it("handles AI provider failure gracefully and logs error metadata", async () => {
      process.env.GEMINI_API_KEY = "valid-test-key";
      mockAiGenerate.mockRejectedValueOnce(new Error("API Quota Exceeded"));

      const socioA = "marcelo@megadesk.online";
      const result = await service.sendMessage(socioA, "Status do sistema");

      expect(result.response.content).toContain("Erro na comunicação com a inteligência artificial");
      expect(result.response.content).toContain("API Quota Exceeded");
      expect(result.response.metadataJson?.source).toBe("error");
    });

    it("provides quick stats for the inspection dashboard", () => {
      const stats = service.getQuickStats();
      expect(stats.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(typeof stats.uptimeFormatted).toBe("string");
      expect(stats.memoryUsageMb).toBeGreaterThan(0);
      expect(stats.services.length).toBeGreaterThanOrEqual(3);
      expect(stats.skills.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("HermesRouter - Authorization and tRPC procedures", () => {
    it("allows admin callers and enforces session-based isolation", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      const testRouter = createHermesRouter(service);
      const mockAdminCallerA = testRouter.createCaller({
        req: {} as any,
        res: {} as any,
        user: { email: "socio1@megadesk.online", role: "admin" } as any,
      });

      const mockAdminCallerB = testRouter.createCaller({
        req: {} as any,
        res: {} as any,
        user: { email: "socio2@megadesk.online", role: "admin" } as any,
      });

      // Sócio 1 sends message
      const sendRes = await mockAdminCallerA.sendMessage({ message: "Mensagem do Sócio 1" });
      expect(sendRes.response.content).toBeDefined();

      // Sócio 1 gets history
      const histA = await mockAdminCallerA.getHistory();
      expect(histA.adminUserId).toBe("socio1@megadesk.online");
      expect(histA.messages.length).toBe(2);

      // Sócio 2 gets history (should be empty for Sócio 2)
      const histB = await mockAdminCallerB.getHistory();
      expect(histB.adminUserId).toBe("socio2@megadesk.online");
      expect(histB.messages.length).toBe(0);

      // Quick stats is accessible to any admin
      const stats = await mockAdminCallerA.getQuickStats();
      expect(stats.services).toBeDefined();

      // Clear history of Sócio 1
      const clearRes = await mockAdminCallerA.clearHistory();
      expect(clearRes.success).toBe(true);

      const histAAfter = await mockAdminCallerA.getHistory();
      expect(histAAfter.messages.length).toBe(0);
    });

    it("rejects non-admin users with FORBIDDEN error", async () => {
      const testRouter = createHermesRouter(service);
      const mockNonAdminCaller = testRouter.createCaller({
        req: {} as any,
        res: {} as any,
        user: { email: "cliente@tenant.com", role: "agent" } as any,
      });

      await expect(mockNonAdminCaller.getHistory()).rejects.toThrow();
    });

    it("rejects unauthenticated users", async () => {
      const testRouter = createHermesRouter(service);
      const unauthCaller = testRouter.createCaller({
        req: {} as any,
        res: {} as any,
        user: null,
      });

      await expect(unauthCaller.getHistory()).rejects.toThrow();
    });
  });
});
