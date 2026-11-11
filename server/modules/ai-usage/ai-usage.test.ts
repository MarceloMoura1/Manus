import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateMonthlyBillingCycle,
  recordAiUsageLog,
  getAiTokenUsageSummary,
} from "./ai-usage.service";
import * as dbModule from "../../db";

describe("AiUsageService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("calculateMonthlyBillingCycle", () => {
    it("correctly calculates billing cycle when reference day is after billing day", () => {
      const refDate = new Date(2026, 10, 15); // 15 de Novembro de 2026
      const { cycleStart, cycleEnd, daysRemaining } = calculateMonthlyBillingCycle(refDate, 1);

      expect(cycleStart.getDate()).toBe(1);
      expect(cycleStart.getMonth()).toBe(10); // Novembro
      expect(cycleEnd.getDate()).toBe(1);
      expect(cycleEnd.getMonth()).toBe(11); // Dezembro
      expect(daysRemaining).toBeGreaterThan(0);
      expect(daysRemaining).toBeLessThanOrEqual(31);
    });

    it("correctly calculates billing cycle when reference day is before billing day", () => {
      const refDate = new Date(2026, 10, 5); // 5 de Novembro de 2026
      const { cycleStart, cycleEnd, daysRemaining } = calculateMonthlyBillingCycle(refDate, 10);

      expect(cycleStart.getDate()).toBe(10);
      expect(cycleStart.getMonth()).toBe(9); // Outubro
      expect(cycleEnd.getDate()).toBe(10);
      expect(cycleEnd.getMonth()).toBe(10); // Novembro
      expect(daysRemaining).toBeGreaterThan(0);
      expect(daysRemaining).toBeLessThanOrEqual(6);
    });
  });

  describe("recordAiUsageLog", () => {
    it("ignores calls when all token counts are 0", async () => {
      const executeMock = vi.fn();
      vi.spyOn(dbModule, "getPool").mockReturnValue({
        execute: executeMock,
      } as any);

      await recordAiUsageLog({
        tenantId: "tenant-test-1",
        featureSource: "assistant_chat",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });

      expect(executeMock).not.toHaveBeenCalled();
    });

    it("persists log in megadesk_ai_usage_logs when token counts are positive", async () => {
      const executeMock = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
      vi.spyOn(dbModule, "getPool").mockReturnValue({
        execute: executeMock,
      } as any);

      await recordAiUsageLog({
        tenantId: "tenant-test-1",
        userId: "user-123",
        featureSource: "assistant_chat",
        conversationId: "thread-abc",
        promptTokens: 150,
        completionTokens: 50,
        totalTokens: 200,
      });

      // 1. chamada do CREATE TABLE IF NOT EXISTS (se idempotente), 2. chamada do INSERT
      expect(executeMock).toHaveBeenCalled();
      const insertCall = executeMock.mock.calls.find((call) =>
        String(call[0]).includes("INSERT INTO megadesk_ai_usage_logs")
      );
      expect(insertCall).toBeDefined();
      const args = insertCall![1];
      expect(args[1]).toBe("tenant-test-1");
      expect(args[2]).toBe("user-123");
      expect(args[3]).toBe("assistant_chat");
      expect(args[4]).toBe("thread-abc");
      expect(args[5]).toBe(150); // promptTokens
      expect(args[6]).toBe(50);  // completionTokens
      expect(args[7]).toBe(200); // totalTokens
    });
  });

  describe("getAiTokenUsageSummary", () => {
    it("aggregates token consumption and returns structured breakdown", async () => {
      const executeMock = vi.fn().mockImplementation((query: string) => {
        if (query.includes("ai_monthly_token_limit")) {
          return Promise.resolve([
            [
              {
                ai_monthly_token_limit: 1000000,
                ai_cycle_renewal_date: null,
                created_at: new Date(2026, 0, 1),
              },
            ],
          ]);
        }
        if (query.includes("total_used")) {
          return Promise.resolve([
            [
              {
                total_used: "5000",
              },
            ],
          ]);
        }
        if (query.includes("GROUP BY feature_source")) {
          return Promise.resolve([
            [
              { feature_source: "assistant_chat", tokens: "4000" },
              { feature_source: "automation", tokens: "1000" },
            ],
          ]);
        }
        if (query.includes("megadesk_domain_client_users")) {
          return Promise.resolve([
            [
              {
                user_id: "user-1",
                name: "Operador Alpha",
                email: "alpha@megadesk.online",
              },
            ],
          ]);
        }
        if (query.includes("GROUP BY user_id")) {
          return Promise.resolve([
            [
              {
                user_id: "user-1",
                tokens: "3000",
              },
            ],
          ]);
        }
        if (query.includes("ORDER BY created_at DESC")) {
          return Promise.resolve([
            [
              {
                id: "log-1",
                created_at: new Date(),
                user_id: "user-1",
                feature_source: "assistant_chat",
                prompt_tokens: 300,
                completion_tokens: 100,
                total_tokens: 400,
              },
            ],
          ]);
        }
        return Promise.resolve([[]]);
      });

      vi.spyOn(dbModule, "getPool").mockReturnValue({
        execute: executeMock,
      } as any);

      const result = await getAiTokenUsageSummary("tenant-test-1");

      expect(result.summary.total_limit).toBe(1000000);
      expect(result.summary.total_used).toBe(5000);
      expect(result.summary.remaining_tokens).toBe(995000);
      expect(result.summary.percent_used).toBe(0.5); // 5000 / 1000000 = 0.5%
      expect(result.by_source.length).toBeGreaterThan(0);
      expect(result.by_operator.length).toBe(1);
      expect(result.recent_activity.length).toBe(1);
      expect(result.recent_activity[0].operatorName).toBe("Operador Alpha");
    });
  });
});

