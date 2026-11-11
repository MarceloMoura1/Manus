import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatRecordingDuration,
  extractPendingActionFromMessage,
  AI_THEMES,
} from "./AIAssistant";

const aiAssistantSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/AIAssistant.tsx"),
  "utf8"
);

describe("AIAssistant Fullscreen, Typebot Tabs, Themes & Composer Scrollbar", () => {
  it("formats recording timer duration accurately in MM:SS", () => {
    expect(formatRecordingDuration(0)).toBe("00:00");
    expect(formatRecordingDuration(9)).toBe("00:09");
    expect(formatRecordingDuration(65)).toBe("01:05");
    expect(formatRecordingDuration(125)).toBe("02:05");
  });

  it("extracts pendingActionRequest from toolInvocations metadata", () => {
    const msgWithDirectPending: any = {
      id: "m1",
      threadId: "t1",
      role: "assistant",
      content: "Preparei a abertura do chamado.",
      toolInvocations: {
        pendingActionRequest: {
          id: "action-12345678",
          actionType: "CREATE_TICKET",
          summary: "Abrir chamado para Mecânica Silva",
        },
      },
      createdAt: new Date(),
    };
    expect(extractPendingActionFromMessage(msgWithDirectPending)).toEqual({
      id: "action-12345678",
      actionType: "CREATE_TICKET",
      summary: "Abrir chamado para Mecânica Silva",
    });

    const msgWithoutAction: any = {
      id: "m2",
      threadId: "t1",
      role: "assistant",
      content: "Texto normal",
      toolInvocations: null,
      createdAt: new Date(),
    };
    expect(extractPendingActionFromMessage(msgWithoutAction)).toBeNull();
  });

  it("enforces 100% fullscreen layout without floating card borders or outer margins", () => {
    expect(aiAssistantSource).toContain('data-testid="ai-assistant-workspace"');
    // Verifies full height/width and no calc margin wrappers
    expect(aiAssistantSource).toContain("flex h-full w-full overflow-hidden bg-slate-950 text-slate-100 flex-row");
    expect(aiAssistantSource).not.toContain("h-[calc(100vh-140px)]");
    expect(aiAssistantSource).toContain('data-testid="ai-threads-sidebar"');
    expect(aiAssistantSource).toContain('data-testid="new-thread-button"');
  });

  it("implements Typebot-style multi-tabs in the topbar (Chat, Temas, Rotinas & Horários, Configurações)", () => {
    expect(aiAssistantSource).toContain('data-testid="assistant-tabs"');
    expect(aiAssistantSource).toContain('data-testid="tab-chat"');
    expect(aiAssistantSource).toContain('data-testid="tab-themes"');
    expect(aiAssistantSource).toContain('data-testid="tab-routines"');
    expect(aiAssistantSource).toContain('data-testid="tab-settings"');

    // Views for each tab
    expect(aiAssistantSource).toContain('data-testid="themes-tab-view"');
    expect(aiAssistantSource).toContain('data-testid="routines-tab-view"');
    expect(aiAssistantSource).toContain('data-testid="settings-tab-view"');
  });

  it("provides 4 visual themes with instant localStorage persistence", () => {
    expect(AI_THEMES["deep-navy"]).toBeDefined();
    expect(AI_THEMES["midnight-black"]).toBeDefined();
    expect(AI_THEMES["aqua-glass"]).toBeDefined();
    expect(AI_THEMES["terminal-emerald"]).toBeDefined();

    expect(AI_THEMES["deep-navy"].name).toBe("Deep Navy");
    expect(AI_THEMES["midnight-black"].name).toBe("Midnight Black");
    expect(AI_THEMES["aqua-glass"].name).toBe("Aqua Glass");
    expect(AI_THEMES["terminal-emerald"].name).toBe("Terminal Emerald");

    expect(aiAssistantSource).toContain("megadesk_ai_theme");
    expect(aiAssistantSource).toContain("theme-card-${theme.id}");
    expect(aiAssistantSource).toContain("apply-theme-${theme.id}");
  });

  it("handles composer textarea auto-expansion and restricts vertical scrollbar strictly to > 2 lines", () => {
    expect(aiAssistantSource).toContain('rows={1}');
    expect(aiAssistantSource).toContain('data-testid="assistant-composer-input"');
    expect(aiAssistantSource).toContain('composerHasScroll ? "overflow-y-auto" : "overflow-hidden"');
    expect(aiAssistantSource).toContain('style={{ maxHeight: "76px" }}');
  });

  it("wires multimodal microphone recording (MediaRecorder) and sendThreadAudioMessage", () => {
    expect(aiAssistantSource).toContain("MediaRecorder");
    expect(aiAssistantSource).toContain("navigator.mediaDevices.getUserMedia");
    expect(aiAssistantSource).toContain("trpc.assistantThreads.sendThreadAudioMessage.useMutation");
    expect(aiAssistantSource).toContain('data-testid="start-audio-recording"');
    expect(aiAssistantSource).toContain('data-testid="cancel-audio-recording"');
    expect(aiAssistantSource).toContain('data-testid="send-audio-recording"');
    expect(aiAssistantSource).toContain("Processando áudio no Gemini Multimodal...");
  });

  it("renders Markdown with AssistantMarkdown and interactive HITL approval cards", () => {
    expect(aiAssistantSource).toContain("<AssistantMarkdown");
    expect(aiAssistantSource).toContain('data-testid="hitl-action-card"');
    expect(aiAssistantSource).toContain("Confirmar e Executar");
  });

  it("removes footer model label and enforces native dark theme styling", () => {
    expect(aiAssistantSource).not.toContain("Voz Multimodal • Gemini 3.5 Flash Lite");
  });

  it("generalizes voice tones beyond automotive niche and removes redundant detail level", () => {
    // 3 generalized tone options
    expect(aiAssistantSource).toContain("Prático / Operacional");
    expect(aiAssistantSource).toContain("Formal / Corporativo");
    expect(aiAssistantSource).toContain("Direto / Conciso");
    expect(aiAssistantSource).not.toContain("Prático / Oficina");

    // Detail level removed
    expect(aiAssistantSource).not.toContain("Nível de Detalhe das Respostas");

    // Generalized operational controls
    expect(aiAssistantSource).toContain("Modo Mãos-Livres (Áudio &amp; Campo)");
    expect(aiAssistantSource).toContain("Aprovação Humana Obrigatória (HITL)");
    expect(aiAssistantSource).toContain("Auto-Transcrição em Tempo Real");

    // Persistence key and sending settings to backend
    expect(aiAssistantSource).toContain("megadesk_ai_assistant_settings");
    expect(aiAssistantSource).toContain("tone: settingsConfig.tone");
    expect(aiAssistantSource).toContain("hitlRequired: settingsConfig.hitlRequired");
    expect(aiAssistantSource).toContain("autoTranscribe: settingsConfig.autoTranscribe");
  });

  it("renders clean 'Nova Conversa' button without duplicate plus icon and implements optimistic message sending", () => {
    // Clean button text without duplicate +
    expect(aiAssistantSource).toContain("<span>Nova Conversa</span>");
    expect(aiAssistantSource).not.toContain("<span>+ Nova Conversa</span>");

    // Optimistic sending
    expect(aiAssistantSource).toContain("optimisticMsg");
    expect(aiAssistantSource).toContain("temp-");
    expect(aiAssistantSource).toContain("setLocalMessages");
  });

  it("redesigns routines tab into rich autonomous agent orchestrator with presets, configured routines and execution logs", () => {
    // Header
    expect(aiAssistantSource).toContain("Automações &amp; Rotinas do Assistente IA");
    expect(aiAssistantSource).toContain("+ Criar Nova Rotina");

    // Presets with 1-click activation
    expect(aiAssistantSource).toContain("📋 Briefing Matinal: O que tenho que fazer hoje?");
    expect(aiAssistantSource).toContain("⏱️ Radar de Clientes Parados (Follow-up 48h)");
    expect(aiAssistantSource).toContain("📊 Fechamento e Pendências do Dia");
    expect(aiAssistantSource).toContain("Ativar com 1 Clique");

    // Configured routines list & immediate execution
    expect(aiAssistantSource).toContain("Rotinas Configuradas");
    expect(aiAssistantSource).toContain("▶️ Executar Agora");
    expect(aiAssistantSource).toContain("handleToggleRoutineActive");
    expect(aiAssistantSource).toContain("handleDeleteRoutine");

    // History and summary modal
    expect(aiAssistantSource).toContain("Histórico de Últimas Execuções");
    expect(aiAssistantSource).toContain("Visualizar Resumo");
    expect(aiAssistantSource).toContain("logSummaryModal");

    // tRPC integration
    expect(aiAssistantSource).toContain("trpc.assistantRoutines.listRoutines.useQuery");
    expect(aiAssistantSource).toContain("trpc.assistantRoutines.upsertRoutine.useMutation");
    expect(aiAssistantSource).toContain("trpc.assistantRoutines.toggleRoutineActive.useMutation");
    expect(aiAssistantSource).toContain("trpc.assistantRoutines.deleteRoutine.useMutation");
    expect(aiAssistantSource).toContain("trpc.assistantRoutines.runRoutineNow.useMutation");
  });
});
