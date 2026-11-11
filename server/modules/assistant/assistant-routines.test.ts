import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildRoutinePrompt,
  executeRoutine,
} from "./routine-executor";
import {
  getCurrentSaoPauloTimeAndDay,
  checkAndRunScheduledRoutines,
} from "./routine-scheduler";
import {
  createAssistantRoutinesRouter,
} from "./assistant-routines.router";
import {
  DEFAULT_ROUTINE_PRESETS,
} from "./contracts";
import type { MegadeskAiRoutine } from "../../../drizzle/schema";

describe("Assistant Routines & Autonomous Scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildRoutinePrompt", () => {
    it("generates correct business instruction for morning_briefing", () => {
      const routine: MegadeskAiRoutine = {
        id: "r1",
        tenantId: "tenant-1",
        userId: "user-1",
        title: "Briefing Matinal",
        scheduleTime: "08:30",
        scheduleDays: ["seg", "ter"],
        triggerType: "morning_briefing",
        promptInstruction: "",
        actionTarget: "chat_thread",
        isActive: true,
        lastRunAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const prompt = buildRoutinePrompt(routine);
      expect(prompt).toContain("📋 O QUE TEMOS PARA HOJE");
      expect(prompt).toContain("chamados em aberto com SLA prioritário");
    });

    it("generates correct business instruction for stale_leads", () => {
      const routine: MegadeskAiRoutine = {
        id: "r2",
        tenantId: "tenant-1",
        userId: "user-1",
        title: "Radar de Clientes Parados",
        scheduleTime: "11:00",
        scheduleDays: ["seg"],
        triggerType: "stale_leads",
        promptInstruction: "",
        actionTarget: "chat_thread",
        isActive: true,
        lastRunAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const prompt = buildRoutinePrompt(routine);
      expect(prompt).toContain("⏱️ RADAR DE FOLLOW-UP (48H)");
      expect(prompt).toContain("há mais de 48h");
    });

    it("generates correct business instruction for eod_summary", () => {
      const routine: MegadeskAiRoutine = {
        id: "r3",
        tenantId: "tenant-1",
        userId: "user-1",
        title: "Fechamento do Dia",
        scheduleTime: "18:00",
        scheduleDays: ["seg"],
        triggerType: "eod_summary",
        promptInstruction: "",
        actionTarget: "chat_thread",
        isActive: true,
        lastRunAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const prompt = buildRoutinePrompt(routine);
      expect(prompt).toContain("📊 FECHAMENTO E PENDÊNCIAS DO DIA");
      expect(prompt).toContain("faturamento e vendas");
    });

    it("respects custom user prompt when specified", () => {
      const routine: MegadeskAiRoutine = {
        id: "r4",
        tenantId: "tenant-1",
        userId: "user-1",
        title: "Auditoria Personalizada",
        scheduleTime: "14:00",
        scheduleDays: ["qua"],
        triggerType: "custom",
        promptInstruction: "Verifique todas as notas fiscais emitidas hoje.",
        actionTarget: "chat_thread",
        isActive: true,
        lastRunAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const prompt = buildRoutinePrompt(routine);
      expect(prompt).toBe("Verifique todas as notas fiscais emitidas hoje.");
    });
  });

  describe("Scheduler Time Parsing", () => {
    it("parses Sao Paulo timezone correctly into HH:MM and weekday key", () => {
      const specificDate = new Date("2026-11-10T12:30:00Z"); // UTC
      const { timeString, dayKey } = getCurrentSaoPauloTimeAndDay(specificDate);

      expect(timeString).toMatch(/^\d{2}:\d{2}$/);
      expect(["dom", "seg", "ter", "qua", "qui", "sex", "sab"]).toContain(dayKey);
    });
  });

  describe("executeRoutine", () => {
    it("runs routine, generates AI response and saves message in Operações do Dia thread", async () => {
      const mockAiGenerator = vi.fn().mockResolvedValue({
        text: "## 📋 O QUE TEMOS PARA HOJE\n\n- 2 chamados prioritários\n- 1 lead aguardando retorno",
        toolCalls: [],
        toolResults: [],
      });

      const mockThreadsRepo: any = {
        getOrCreateDailyOperationsThread: vi.fn().mockResolvedValue({ id: "thread-ops" }),
        saveMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
        touchThread: vi.fn().mockResolvedValue(undefined),
      };
      const mockRoutinesRepo: any = {
        createLog: vi.fn().mockResolvedValue({ id: "log-1" }),
        updateLastRunAt: vi.fn().mockResolvedValue(undefined),
      };

      const routine: MegadeskAiRoutine = {
        id: "routine-test-1",
        tenantId: "tenant-alpha",
        userId: "user-alpha",
        title: "📋 Briefing Matinal: O que tenho que fazer hoje?",
        scheduleTime: "08:30",
        scheduleDays: ["seg", "ter", "qua", "qui", "sex"],
        triggerType: "morning_briefing",
        promptInstruction: "Consulte chamados abertos",
        actionTarget: "chat_thread",
        isActive: true,
        lastRunAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await executeRoutine(routine, {
        aiGenerator: mockAiGenerator,
        threadsRepo: mockThreadsRepo,
        routinesRepo: mockRoutinesRepo,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("success");
      expect(result.outputSummary).toBeDefined();
      expect(mockThreadsRepo.getOrCreateDailyOperationsThread).toHaveBeenCalledWith("tenant-alpha", "user-alpha");
      expect(mockThreadsRepo.saveMessage).toHaveBeenCalled();
      expect(mockRoutinesRepo.createLog).toHaveBeenCalled();
    });
  });

  describe("Assistant Routines Router", () => {
    it("lists routines and recent logs with presets", async () => {
      const mockRepo: any = {
        listRoutines: vi.fn().mockResolvedValue([
          {
            id: "r-1",
            tenantId: "tenant-1",
            userId: "user-1",
            title: "Briefing Matinal",
            scheduleTime: "08:30",
            scheduleDays: ["seg", "ter", "qua", "qui", "sex"],
            triggerType: "morning_briefing",
            promptInstruction: "Instrução",
            actionTarget: "chat_thread",
            isActive: true,
            lastRunAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        listRecentLogs: vi.fn().mockResolvedValue([
          {
            id: "log-1",
            routineId: "r-1",
            tenantId: "tenant-1",
            status: "success",
            outputSummary: "Resumo executado",
            createdAt: new Date(),
          },
        ]),
      };

      const router = createAssistantRoutinesRouter(mockRepo);
      const caller = router.createCaller({
        assistantIdentity: { tenantId: "tenant-1", userId: "user-1" },
      } as any);

      const result = await caller.listRoutines();
      expect(result.routines).toHaveLength(1);
      expect(result.recentLogs).toHaveLength(1);
      expect(result.presets).toEqual(DEFAULT_ROUTINE_PRESETS);
    });

    it("upserts routine successfully", async () => {
      const mockRepo: any = {
        upsertRoutine: vi.fn().mockResolvedValue({
          id: "r-new",
          tenantId: "tenant-1",
          userId: "user-1",
          title: "Radar de Clientes Parados",
          scheduleTime: "11:00",
          scheduleDays: ["seg", "ter"],
          triggerType: "stale_leads",
          promptInstruction: "Varre clientes sem interação há 48h",
          actionTarget: "chat_thread",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      };

      const router = createAssistantRoutinesRouter(mockRepo);
      const caller = router.createCaller({
        assistantIdentity: { tenantId: "tenant-1", userId: "user-1" },
      } as any);

      const result = await caller.upsertRoutine({
        title: "Radar de Clientes Parados",
        scheduleTime: "11:00",
        scheduleDays: ["seg", "ter"],
        triggerType: "stale_leads",
        promptInstruction: "Varre clientes sem interação há 48h",
        actionTarget: "chat_thread",
        isActive: true,
      });

      expect(result.ok).toBe(true);
      expect(result.routine.title).toBe("Radar de Clientes Parados");
      expect(mockRepo.upsertRoutine).toHaveBeenCalled();
    });

    it("toggles routine active status", async () => {
      const mockRepo: any = {
        toggleRoutineActive: vi.fn().mockResolvedValue({
          id: "r-1",
          isActive: false,
        }),
      };

      const router = createAssistantRoutinesRouter(mockRepo);
      const caller = router.createCaller({
        assistantIdentity: { tenantId: "tenant-1", userId: "user-1" },
      } as any);

      const result = await caller.toggleRoutineActive({
        id: "r-1",
        isActive: false,
      });

      expect(result.ok).toBe(true);
      expect(result.routine.isActive).toBe(false);
      expect(mockRepo.toggleRoutineActive).toHaveBeenCalledWith("tenant-1", "r-1", false);
    });

    it("deletes routine successfully", async () => {
      const mockRepo: any = {
        deleteRoutine: vi.fn().mockResolvedValue({ success: true, id: "r-1" }),
      };

      const router = createAssistantRoutinesRouter(mockRepo);
      const caller = router.createCaller({
        assistantIdentity: { tenantId: "tenant-1", userId: "user-1" },
      } as any);

      const result = await caller.deleteRoutine({ id: "r-1" });
      expect(result.ok).toBe(true);
      expect(result.id).toBe("r-1");
      expect(mockRepo.deleteRoutine).toHaveBeenCalledWith("tenant-1", "r-1");
    });

    it("executes routine immediately via runRoutineNow", async () => {
      const mockRepo: any = {
        getRoutine: vi.fn().mockResolvedValue({
          id: "r-1",
          tenantId: "tenant-1",
          userId: "user-1",
          title: "Briefing Matinal",
          scheduleTime: "08:30",
          scheduleDays: ["seg", "ter"],
          triggerType: "morning_briefing",
          promptInstruction: "Consulte os chamados",
          actionTarget: "chat_thread",
          isActive: true,
          lastRunAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      };

      const mockExecutor = vi.fn().mockResolvedValue({
        success: true,
        status: "success",
        outputSummary: "Resumo executado",
      });
      const router = createAssistantRoutinesRouter(mockRepo, mockExecutor);
      const caller = router.createCaller({
        assistantIdentity: { tenantId: "tenant-1", userId: "user-1" },
      } as any);

      const result = await caller.runRoutineNow({ id: "r-1" });
      expect(result.ok).toBe(true);
      expect(result.status).toBe("success");
      expect(result.outputSummary).toBe("Resumo executado");
      expect(mockExecutor).toHaveBeenCalled();
    });
  });
});
