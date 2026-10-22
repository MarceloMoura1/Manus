import { describe, it, expect, vi, beforeEach } from "vitest";
import { HermesService } from "./service";
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

  // helper for test inspection
  getAllMessages() {
    return this.messages;
  }
}

describe("Hermes Module - Unit & Isolation Tests", () => {
  let mockRepo: MockHermesRepository;
  let service: HermesService;

  beforeEach(() => {
    mockRepo = new MockHermesRepository();
    service = new HermesService(mockRepo);
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

    it("generates structured diagnostic fallback when asked about vistoria or tokens", async () => {
      const socioA = "marcelo@megadesk.online";
      const resultVistoria = await service.sendMessage(socioA, "Faça uma vistoria da VPS");
      expect(resultVistoria.response.content).toContain("Vistoria Operacional da Plataforma");
      expect(resultVistoria.response.metadataJson?.source).toBe("fallback");
      expect(resultVistoria.response.metadataJson?.actionTriggered).toBe("vistoria_vps");

      const resultTokens = await service.sendMessage(socioA, "Como está o consumo de tokens?");
      expect(resultTokens.response.content).toContain("Telemetria de Tokens & Recursos");
      expect(resultTokens.response.metadataJson?.actionTriggered).toBe("token_telemetry");

      const resultWhatsApp = await service.sendMessage(socioA, "Como está a conexão do WhatsApp Evolution?");
      expect(resultWhatsApp.response.content).toContain("Diagnóstico do Gateway WhatsApp");
      expect(resultWhatsApp.response.metadataJson?.actionTriggered).toBe("whatsapp_check");
    });

    it("detects on-demand actions accurately", () => {
      expect(service.detectAction("Checar containers Docker")).toBe("vistoria_vps");
      expect(service.detectAction("Status do zap e evolution")).toBe("whatsapp_check");
      expect(service.detectAction("Consumo de cotas")).toBe("token_telemetry");
      expect(service.detectAction("Auditoria de multi-tenant")).toBe("security_audit");
      expect(service.detectAction("Qual a previsão para o próximo trimestre?")).toBeNull();
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
