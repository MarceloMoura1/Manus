import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatRecordingDuration,
  extractPendingActionFromMessage,
} from "./AIAssistant";

const aiAssistantSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/AIAssistant.tsx"),
  "utf8"
);

describe("AIAssistant Multi-Chat & Multimodal Voice UI", () => {
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

  it("implements the two-column Gemini layout with left threads sidebar and main chat area", () => {
    expect(aiAssistantSource).toContain('data-testid="ai-assistant-workspace"');
    expect(aiAssistantSource).toContain('data-testid="ai-threads-sidebar"');
    expect(aiAssistantSource).toContain('data-testid="new-thread-button"');
    expect(aiAssistantSource).toContain("+ Nova Conversa");
    expect(aiAssistantSource).toContain("trpc.assistantThreads.listThreads.useQuery");
    expect(aiAssistantSource).toContain("trpc.assistantThreads.createThread.useMutation");
    expect(aiAssistantSource).toContain("trpc.assistantThreads.renameThread.useMutation");
    expect(aiAssistantSource).toContain("trpc.assistantThreads.deleteThread.useMutation");
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
});
