import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Sparkles,
  Plus,
  MessageSquare,
  Pencil,
  Trash2,
  Check,
  X,
  Mic,
  Send,
  PanelLeft,
  Loader2,
  Bot,
  User as UserIcon,
  Palette,
  Clock,
  Sliders,
  Sun,
  Moon,
  CheckCircle2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

export function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-100">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-slate-800 text-blue-300 border border-slate-700/60 font-mono text-xs"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export function AssistantMarkdown({ content }: { content: string }) {
  const lines = String(content || "").split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Tabelas Markdown
    if (trimmed.startsWith("|") && trimmed.endsWith("|") && i + 1 < lines.length && lines[i + 1].trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const rows = tableLines
        .filter((r) => !/^\|[\s\-:|]+\|$/.test(r))
        .map((r) =>
          r
            .slice(1, -1)
            .split("|")
            .map((c) => c.trim())
        );
      if (rows.length > 0) {
        const [header, ...body] = rows;
        elements.push(
          <div key={`tbl-${i}`} className="my-2 overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/60">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-800/90 text-slate-200 font-semibold">
                <tr>
                  {header.map((cell, cIdx) => (
                    <th key={cIdx} className="px-3 py-2 border-b border-slate-700">
                      {renderInlineMarkdown(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {body.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-800/40">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="px-3 py-1.5 text-slate-300">
                        {renderInlineMarkdown(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    // Listas com marcador
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-1.5 list-disc pl-5 space-y-1 text-slate-200">
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Títulos Markdown
    if (/^#{1,3}\s+/.test(trimmed)) {
      const headingText = trimmed.replace(/^#{1,3}\s+/, "");
      elements.push(
        <h4 key={`h-${i}`} className="font-bold text-slate-100 mt-2 mb-1">
          {renderInlineMarkdown(headingText)}
        </h4>
      );
      i++;
      continue;
    }

    if (!trimmed) {
      elements.push(<div key={`br-${i}`} className="h-2" />);
    } else {
      elements.push(
        <p key={`p-${i}`} className="text-slate-200 leading-relaxed">
          {renderInlineMarkdown(line)}
        </p>
      );
    }
    i++;
  }

  return <div data-testid="assistant-markdown" className="space-y-1">{elements}</div>;
}

export type AIAssistantTab = "chat" | "themes" | "routines" | "settings";

export type AIThemeId = "deep-navy" | "midnight-black" | "aqua-glass" | "terminal-emerald";

export interface AITheme {
  id: AIThemeId;
  name: string;
  badge: string;
  description: string;
  sidebarBg: string;
  sidebarBorder: string;
  chatBg: string;
  headerBg: string;
  headerBorder: string;
  composerBg: string;
  composerBorder: string;
  composerInputBg: string;
  composerInputBorder: string;
  userBubble: string;
  assistantBubble: string;
  assistantBubbleBorder: string;
  accentBg: string;
  accentHoverBg: string;
  accentText: string;
  accentBorder: string;
  activeTabBg: string;
  swatches: [string, string, string];
}

export const AI_THEMES: Record<AIThemeId, AITheme> = {
  "deep-navy": {
    id: "deep-navy",
    name: "Deep Navy",
    badge: "Padrão",
    description: "Tons de azul marinho profundo e ardósia, com realces azuis corporativos elegantes.",
    sidebarBg: "bg-[#090f1d]",
    sidebarBorder: "border-slate-800",
    chatBg: "bg-[#050b16]",
    headerBg: "bg-[#090f1d]/95",
    headerBorder: "border-slate-800",
    composerBg: "bg-[#090f1d]/95",
    composerBorder: "border-slate-800",
    composerInputBg: "bg-[#050b16]",
    composerInputBorder: "border-slate-800 focus:border-blue-500",
    userBubble: "bg-blue-600/90 text-white",
    assistantBubble: "bg-slate-900/90 text-slate-100",
    assistantBubbleBorder: "border-slate-800",
    accentBg: "bg-blue-600",
    accentHoverBg: "hover:bg-blue-500",
    accentText: "text-blue-400",
    accentBorder: "border-blue-500/40",
    activeTabBg: "bg-blue-600 text-white shadow-sm",
    swatches: ["#090f1d", "#050b16", "#2563eb"],
  },
  "midnight-black": {
    id: "midnight-black",
    name: "Midnight Black",
    badge: "AMOLED",
    description: "Preto puro AMOLED com bordas neutras de alto contraste e foco total no conteúdo.",
    sidebarBg: "bg-[#0c0c0e]",
    sidebarBorder: "border-neutral-800",
    chatBg: "bg-[#000000]",
    headerBg: "bg-[#0c0c0e]/95",
    headerBorder: "border-neutral-800",
    composerBg: "bg-[#0c0c0e]/95",
    composerBorder: "border-neutral-800",
    composerInputBg: "bg-[#141417]",
    composerInputBorder: "border-neutral-800 focus:border-neutral-600",
    userBubble: "bg-neutral-800 text-white",
    assistantBubble: "bg-neutral-900/95 text-neutral-100",
    assistantBubbleBorder: "border-neutral-800",
    accentBg: "bg-neutral-800",
    accentHoverBg: "hover:bg-neutral-700",
    accentText: "text-neutral-300",
    accentBorder: "border-neutral-700",
    activeTabBg: "bg-neutral-800 text-white shadow-sm",
    swatches: ["#0c0c0e", "#000000", "#737373"],
  },
  "aqua-glass": {
    id: "aqua-glass",
    name: "Aqua Glass",
    badge: "Ciano & Teal",
    description: "Tons ciano e azul petróleo, inspirados em interfaces de telemetria automotiva de alta tecnologia.",
    sidebarBg: "bg-[#04161f]",
    sidebarBorder: "border-cyan-950",
    chatBg: "bg-[#020d14]",
    headerBg: "bg-[#04161f]/95",
    headerBorder: "border-cyan-950",
    composerBg: "bg-[#04161f]/95",
    composerBorder: "border-cyan-950",
    composerInputBg: "bg-[#020d14]",
    composerInputBorder: "border-cyan-900/60 focus:border-cyan-500",
    userBubble: "bg-cyan-600/90 text-white",
    assistantBubble: "bg-[#07212e]/90 text-cyan-50",
    assistantBubbleBorder: "border-cyan-900/60",
    accentBg: "bg-cyan-600",
    accentHoverBg: "hover:bg-cyan-500",
    accentText: "text-cyan-400",
    accentBorder: "border-cyan-500/40",
    activeTabBg: "bg-cyan-600 text-white shadow-sm",
    swatches: ["#04161f", "#020d14", "#0891b2"],
  },
  "terminal-emerald": {
    id: "terminal-emerald",
    name: "Terminal Emerald",
    badge: "Esmeralda",
    description: "Fundo ultra-escuro com realces em esmeralda, estilo console de monitoramento rápido.",
    sidebarBg: "bg-[#04140d]",
    sidebarBorder: "border-emerald-950",
    chatBg: "bg-[#020a06]",
    headerBg: "bg-[#04140d]/95",
    headerBorder: "border-emerald-950",
    composerBg: "bg-[#04140d]/95",
    composerBorder: "border-emerald-950",
    composerInputBg: "bg-[#020a06]",
    composerInputBorder: "border-emerald-900/60 focus:border-emerald-500",
    userBubble: "bg-emerald-600/90 text-white",
    assistantBubble: "bg-[#072215]/90 text-emerald-50",
    assistantBubbleBorder: "border-emerald-900/60",
    accentBg: "bg-emerald-600",
    accentHoverBg: "hover:bg-emerald-500",
    accentText: "text-emerald-400",
    accentBorder: "border-emerald-500/40",
    activeTabBg: "bg-emerald-600 text-white shadow-sm",
    swatches: ["#04140d", "#020a06", "#059669"],
  },
};

export interface ThreadSummary {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolInvocations?: any;
  createdAt: string | Date;
  actionState?: "EXECUTING" | "EXECUTED" | "CANCELLED" | "FAILED";
  actionMessage?: string;
  actionEntityId?: string | number;
}

export function formatRecordingDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function detectSupportedAudioMimeType(): string {
  if (typeof window === "undefined" || typeof (window as any).MediaRecorder === "undefined") {
    return "audio/webm";
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/wav",
    "audio/mp4",
  ];
  for (const type of candidates) {
    try {
      if ((window as any).MediaRecorder.isTypeSupported?.(type)) {
        return type;
      }
    } catch {
      // ignore
    }
  }
  return "audio/webm";
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const base64 = result.replace(/^data:[^;]+;base64,/i, "").trim();
      resolve(base64);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(blob);
  });
}

export function extractPendingActionFromMessage(msg: ThreadMessage): any | null {
  if (!msg?.toolInvocations || typeof msg.toolInvocations !== "object") {
    return null;
  }
  if (msg.toolInvocations.pendingActionRequest) {
    return msg.toolInvocations.pendingActionRequest;
  }
  if (Array.isArray(msg.toolInvocations.toolResults)) {
    for (const tr of msg.toolInvocations.toolResults) {
      if (tr?.output?.pendingActionRequest) {
        return tr.output.pendingActionRequest;
      }
    }
  }
  return null;
}

export interface AIAssistantSettings {
  tone: "pratico" | "formal" | "direto";
  hitlRequired: boolean;
  handsFreeAudio: boolean;
  autoTranscribe: boolean;
}

const DEFAULT_ASSISTANT_SETTINGS: AIAssistantSettings = {
  tone: "pratico",
  hitlRequired: true,
  handsFreeAudio: false,
  autoTranscribe: true,
};

export function AIAssistant() {
  const SESSION_KEY = "megadesk_session_v1";
  const THEME_KEY = "megadesk_ai_theme";
  const ROUTINES_KEY = "megadesk_ai_routines";
  const SETTINGS_KEY = "megadesk_ai_assistant_settings";

  const [session] = useState<any>(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  // Tema Selecionado (Persistência imediata)
  const [selectedThemeId, setSelectedThemeId] = useState<AIThemeId>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored && stored in AI_THEMES) {
        return stored as AIThemeId;
      }
    } catch {
      // ignore
    }
    return "deep-navy";
  });

  const currentTheme: AITheme = AI_THEMES[selectedThemeId] || AI_THEMES["deep-navy"];

  const handleSelectTheme = (themeId: AIThemeId) => {
    setSelectedThemeId(themeId);
    try {
      localStorage.setItem(THEME_KEY, themeId);
    } catch {
      // ignore
    }
  };

  // Aba Ativa (Typebot style)
  const [activeTab, setActiveTab] = useState<AIAssistantTab>("chat");

  // Estado das Rotinas Operacionais
  const [routinesConfig, setRoutinesConfig] = useState(() => {
    try {
      const stored = localStorage.getItem(ROUTINES_KEY);
      if (stored) return JSON.parse(stored);
    } catch {
      // ignore
    }
    return {
      startDayTime: "08:00",
      endDayTime: "18:00",
      startNightTime: "18:01",
      endNightTime: "07:59",
      proactiveSuggestions: true,
      autoQueueTickets: true,
      nightMessage:
        "Olá! Nosso expediente encerrou por hoje. Deixe sua solicitação que nossa equipe atenderá na primeira hora da manhã.",
    };
  });
  const [routinesSaved, setRoutinesSaved] = useState<boolean>(false);

  const handleSaveRoutines = () => {
    try {
      localStorage.setItem(ROUTINES_KEY, JSON.stringify(routinesConfig));
      setRoutinesSaved(true);
      setTimeout(() => setRoutinesSaved(false), 3000);
    } catch {
      // ignore
    }
  };

  // Estado das Configurações do Assistente (Persistência real no localStorage)
  const [settingsConfig, setSettingsConfig] = useState<AIAssistantSettings>(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          tone: (parsed.tone === "formal" || parsed.tone === "direto") ? parsed.tone : "pratico",
          hitlRequired: parsed.hitlRequired !== false,
          handsFreeAudio: Boolean(parsed.handsFreeAudio || parsed.handsFreeVoice),
          autoTranscribe: parsed.autoTranscribe !== false && parsed.autoTranscription !== false,
        };
      }
      const legacy = localStorage.getItem("megadesk_ai_settings");
      if (legacy) {
        const parsed = JSON.parse(legacy);
        return {
          tone: (parsed.voiceTone === "formal" || parsed.voiceTone === "direto") ? parsed.voiceTone : "pratico",
          hitlRequired: parsed.requireHitl !== false,
          handsFreeAudio: Boolean(parsed.handsFreeVoice),
          autoTranscribe: parsed.autoTranscription !== false,
        };
      }
    } catch {
      // ignore
    }
    return DEFAULT_ASSISTANT_SETTINGS;
  });
  const [settingsSaved, setSettingsSaved] = useState<boolean>(false);

  const handleSaveSettings = () => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsConfig));
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch {
      // ignore
    }
  };

  // Sessões / Threads de Chat
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [input, setInput] = useState<string>("");
  const [isSendingText, setIsSendingText] = useState<boolean>(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState<boolean>(false);

  // Edição de título (Sidebar ou Header)
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState<string>("");
  const [isEditingHeaderTitle, setIsEditingHeaderTitle] = useState<boolean>(false);
  const [headerTitleDraft, setHeaderTitleDraft] = useState<string>("");

  // Estado de gravação de áudio via MediaRecorder
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  // Estado local de ações HITL por mensagem
  const [actionStates, setActionStates] = useState<
    Record<
      string,
      {
        state: "EXECUTING" | "EXECUTED" | "CANCELLED" | "FAILED";
        message?: string;
        entityId?: string | number;
      }
    >
  >({});

  // Controle de scrollbar no Textarea do Composer:
  // Inicialmente rows={1} com overflow-hidden, expande suavemente e SÓ ativa scrollbar se ultrapassar 2 linhas (~76px)
  const [composerHasScroll, setComposerHasScroll] = useState<boolean>(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldSendAudioOnStopRef = useRef<boolean>(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trpcUtils = trpc.useUtils?.() ?? (trpc as any).useContext?.();

  // Queries e Mutations de Threads
  const threadsQuery = trpc.assistantThreads.listThreads.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const threads: ThreadSummary[] = (threadsQuery.data?.threads as ThreadSummary[]) ?? [];

  // Seleciona automaticamente a thread mais recente se nenhuma estiver ativa
  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      setSelectedThreadId(threads[0].id);
    } else if (selectedThreadId && threads.length > 0 && !threads.some((t) => t.id === selectedThreadId)) {
      setSelectedThreadId(threads[0]?.id ?? null);
    }
  }, [threads, selectedThreadId]);

  const activeThread = threads.find((t) => t.id === selectedThreadId) ?? null;

  const messagesQuery = trpc.assistantThreads.getThreadMessages.useQuery(
    { threadId: selectedThreadId ?? "" },
    {
      enabled: Boolean(selectedThreadId),
      refetchOnWindowFocus: false,
    }
  );

  const serverMessages: ThreadMessage[] = (messagesQuery.data?.messages as ThreadMessage[]) ?? [];
  const [localMessages, setLocalMessages] = useState<ThreadMessage[]>([]);

  useEffect(() => {
    if (messagesQuery.data?.messages) {
      setLocalMessages(messagesQuery.data.messages as ThreadMessage[]);
    } else if (!selectedThreadId) {
      setLocalMessages([]);
    }
  }, [messagesQuery.data?.messages, selectedThreadId]);

  const updateSettings = (partial: Partial<AIAssistantSettings>) => {
    setSettingsConfig((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const createThreadMutation = trpc.assistantThreads.createThread.useMutation({
    onSuccess: (data) => {
      void trpcUtils?.assistantThreads?.listThreads?.invalidate?.();
      if (data?.thread?.id) {
        setSelectedThreadId(data.thread.id);
      }
    },
  });

  const renameThreadMutation = trpc.assistantThreads.renameThread.useMutation({
    onSuccess: () => {
      void trpcUtils?.assistantThreads?.listThreads?.invalidate?.();
      if (selectedThreadId) {
        void trpcUtils?.assistantThreads?.getThreadMessages?.invalidate?.({ threadId: selectedThreadId });
      }
    },
  });

  const deleteThreadMutation = trpc.assistantThreads.deleteThread.useMutation({
    onSuccess: (_, variables) => {
      if (selectedThreadId === variables.threadId) {
        const remaining = threads.filter((t) => t.id !== variables.threadId);
        setSelectedThreadId(remaining[0]?.id ?? null);
      }
      void trpcUtils?.assistantThreads?.listThreads?.invalidate?.();
    },
  });

  const sendMessageMutation = trpc.assistantThreads.sendThreadMessage.useMutation({
    onSettled: () => {
      setIsSendingText(false);
      void trpcUtils?.assistantThreads?.listThreads?.invalidate?.();
      if (selectedThreadId) {
        void trpcUtils?.assistantThreads?.getThreadMessages?.invalidate?.({ threadId: selectedThreadId });
      }
    },
  });

  const sendAudioMutation = trpc.assistantThreads.sendThreadAudioMessage.useMutation({
    onSettled: () => {
      setIsProcessingAudio(false);
      void trpcUtils?.assistantThreads?.listThreads?.invalidate?.();
      if (selectedThreadId) {
        void trpcUtils?.assistantThreads?.getThreadMessages?.invalidate?.({ threadId: selectedThreadId });
      }
    },
  });

  const executeActionMutation = trpc.assistant.executeAction.useMutation();
  const cancelActionMutation = trpc.assistant.cancelAction.useMutation();

  // Scroll suave ao final da conversa
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
    });
  }, []);

  useEffect(() => {
    if (activeTab === "chat") {
      scrollToBottom("smooth");
    }
  }, [localMessages.length, isSendingText, isProcessingAudio, activeTab, scrollToBottom]);

  // Expansão dinâmica do textarea: 1 a 2 linhas sem scrollbar; ativa overflow-y-auto apenas além de 2 linhas (~76px)
  const adjustComposerHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const scrollHeight = el.scrollHeight;
    const maxTwoLinesHeight = 76;

    if (scrollHeight > maxTwoLinesHeight) {
      el.style.height = `${maxTwoLinesHeight}px`;
      setComposerHasScroll(true);
    } else {
      el.style.height = `${Math.max(scrollHeight, 42)}px`;
      setComposerHasScroll(false);
    }
  }, []);

  useEffect(() => {
    adjustComposerHeight();
  }, [input, adjustComposerHeight]);

  // Limpeza de stream de microfone ao desmontar
  const cleanupRecordingResources = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setRecordingSeconds(0);
  }, []);

  useEffect(() => {
    return () => {
      cleanupRecordingResources();
    };
  }, [cleanupRecordingResources]);

  const handleCreateNewThread = async () => {
    try {
      const created = await createThreadMutation.mutateAsync({ title: "Nova Conversa" });
      if (created?.thread?.id) {
        setSelectedThreadId(created.thread.id);
      }
      setActiveTab("chat");
      textareaRef.current?.focus();
    } catch (err) {
      console.error("[AIAssistant] Falha ao criar nova conversa:", err);
    }
  };

  const ensureActiveThreadId = async (): Promise<string | null> => {
    if (selectedThreadId) return selectedThreadId;
    try {
      const created = await createThreadMutation.mutateAsync({ title: "Nova Conversa" });
      if (created?.thread?.id) {
        setSelectedThreadId(created.thread.id);
        return created.thread.id;
      }
    } catch (err) {
      console.error("[AIAssistant] Erro ao garantir thread ativa:", err);
    }
    return null;
  };

  const handleSendText = async () => {
    const text = input.trim();
    if (!text || isSendingText || isProcessingAudio) return;

    // 1. Limpa o input imediatamente
    setInput("");

    // 2. Cria mensagem otimista temporária do usuário
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: ThreadMessage = {
      id: tempId,
      threadId: selectedThreadId || "pending-thread",
      role: "user",
      content: text,
      createdAt: new Date(),
    };

    // 3. Adiciona imediatamente ao estado local de mensagens
    setLocalMessages((prev) => [...prev, optimisticMsg]);

    // 4. Ativa estado de carregamento / digitando
    setIsSendingText(true);

    // 5. Rola suavemente para o rodapé
    scrollToBottom("smooth");

    try {
      const targetThreadId = await ensureActiveThreadId();
      if (!targetThreadId) {
        setIsSendingText(false);
        setLocalMessages((prev) => prev.filter((m) => m.id !== tempId));
        return;
      }

      const result = await sendMessageMutation.mutateAsync({
        threadId: targetThreadId,
        content: text,
        settings: {
          tone: settingsConfig.tone,
          hitlRequired: settingsConfig.hitlRequired,
          handsFreeAudio: settingsConfig.handsFreeAudio,
          autoTranscribe: settingsConfig.autoTranscribe,
        },
      });

      // Atualiza com as mensagens reais retornadas pelo servidor
      if (result?.userMessage && result?.assistantMessage) {
        setLocalMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          return [...withoutTemp, result.userMessage as ThreadMessage, result.assistantMessage as ThreadMessage];
        });
      }

      await trpcUtils?.assistantThreads?.getThreadMessages?.invalidate?.({ threadId: targetThreadId });
      await trpcUtils?.assistantThreads?.listThreads?.invalidate?.();
    } catch (err) {
      console.error("[AIAssistant] Falha ao enviar mensagem:", err);
      setLocalMessages((prev) => prev.filter((m) => m.id !== tempId));
      setIsSendingText(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendText();
    }
  };

  const handleStartRenameSidebar = (thread: ThreadSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingThreadId(thread.id);
    setEditingTitleValue(thread.title);
  };

  const handleSaveRenameSidebar = async (threadId: string, e?: React.MouseEvent | React.FormEvent) => {
    e?.stopPropagation();
    const trimmed = editingTitleValue.trim();
    setEditingThreadId(null);
    if (!trimmed) return;
    await renameThreadMutation.mutateAsync({ threadId, title: trimmed });
  };

  const handleStartRenameHeader = () => {
    if (!activeThread) return;
    setHeaderTitleDraft(activeThread.title);
    setIsEditingHeaderTitle(true);
  };

  const handleSaveRenameHeader = async () => {
    setIsEditingHeaderTitle(false);
    if (!activeThread) return;
    const trimmed = headerTitleDraft.trim();
    if (!trimmed || trimmed === activeThread.title) return;
    await renameThreadMutation.mutateAsync({
      threadId: activeThread.id,
      title: trimmed,
    });
  };

  const handleDeleteThread = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteThreadMutation.mutateAsync({ threadId });
  };

  // Gravação de Áudio via MediaRecorder
  const startAudioRecording = async () => {
    setRecordingError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingError("Seu navegador não suporta gravação de áudio pelo microfone.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = detectSupportedAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      shouldSendAudioOnStopRef.current = false;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const shouldSend = shouldSendAudioOnStopRef.current;
        const recordedMime = recorder.mimeType || mimeType || "audio/webm";
        const chunks = [...audioChunksRef.current];
        cleanupRecordingResources();

        if (!shouldSend || chunks.length === 0) {
          return;
        }

        const tempAudioId = `temp-audio-${Date.now()}`;
        const optimisticAudioMsg: ThreadMessage = {
          id: tempAudioId,
          threadId: selectedThreadId || "pending-thread",
          role: "user",
          content: "🎤 [Processando áudio...]",
          createdAt: new Date(),
        };
        setLocalMessages((prev) => [...prev, optimisticAudioMsg]);
        setIsProcessingAudio(true);
        scrollToBottom("smooth");

        try {
          const audioBlob = new Blob(chunks, { type: recordedMime });
          const base64Audio = await blobToBase64(audioBlob);
          if (!base64Audio) {
            setIsProcessingAudio(false);
            setLocalMessages((prev) => prev.filter((m) => m.id !== tempAudioId));
            return;
          }

          const targetThreadId = await ensureActiveThreadId();
          if (!targetThreadId) {
            setIsProcessingAudio(false);
            setLocalMessages((prev) => prev.filter((m) => m.id !== tempAudioId));
            return;
          }

          const result = await sendAudioMutation.mutateAsync({
            threadId: targetThreadId,
            audioBase64: base64Audio,
            mimeType: recordedMime.split(";")[0] || "audio/webm",
            settings: {
              tone: settingsConfig.tone,
              hitlRequired: settingsConfig.hitlRequired,
              handsFreeAudio: settingsConfig.handsFreeAudio,
              autoTranscribe: settingsConfig.autoTranscribe,
            },
          });

          if (result?.userMessage && result?.assistantMessage) {
            setLocalMessages((prev) => {
              const withoutTemp = prev.filter((m) => m.id !== tempAudioId);
              return [...withoutTemp, result.userMessage as ThreadMessage, result.assistantMessage as ThreadMessage];
            });
          }

          await trpcUtils?.assistantThreads?.getThreadMessages?.invalidate?.({ threadId: targetThreadId });
          await trpcUtils?.assistantThreads?.listThreads?.invalidate?.();
        } catch (err) {
          console.error("[AIAssistant] Erro ao enviar áudio gravado:", err);
          setLocalMessages((prev) => prev.filter((m) => m.id !== tempAudioId));
          setIsProcessingAudio(false);
        }
      };

      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error("[AIAssistant] Permissão de microfone negada ou indisponível:", err);
      setRecordingError("Não foi possível acessar o microfone. Verifique as permissões do navegador.");
      cleanupRecordingResources();
    }
  };

  const cancelAudioRecording = () => {
    shouldSendAudioOnStopRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    } else {
      cleanupRecordingResources();
    }
  };

  const finishAndSendAudioRecording = () => {
    shouldSendAudioOnStopRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    } else {
      cleanupRecordingResources();
    }
  };

  // Aprovação / Cancelamento de Cards HITL
  const handleConfirmPendingAction = async (actionReq: any) => {
    if (!actionReq?.id) return;
    setActionStates((prev) => ({
      ...prev,
      [actionReq.id]: { state: "EXECUTING", message: "Executando ação aprovada..." },
    }));
    try {
      const result: any = await executeActionMutation.mutateAsync({
        actionId: actionReq.id,
        actionType: actionReq.actionType,
        payload: actionReq.args ?? {},
      });
      setActionStates((prev) => ({
        ...prev,
        [actionReq.id]: {
          state: "EXECUTED",
          message: result?.message || "Ação concluída com sucesso.",
          entityId: result?.entityId,
        },
      }));
    } catch (err: any) {
      setActionStates((prev) => ({
        ...prev,
        [actionReq.id]: {
          state: "FAILED",
          message: err?.message || "Não foi possível executar a ação.",
        },
      }));
    }
  };

  const handleCancelPendingAction = async (actionReq: any) => {
    if (!actionReq?.id) return;
    try {
      await cancelActionMutation.mutateAsync({
        actionId: actionReq.id,
        actionType: actionReq.actionType,
      });
      setActionStates((prev) => ({
        ...prev,
        [actionReq.id]: {
          state: "CANCELLED",
          message: "Ação cancelada pelo usuário.",
        },
      }));
    } catch (err: any) {
      setActionStates((prev) => ({
        ...prev,
        [actionReq.id]: {
          state: "FAILED",
          message: err?.message || "Não foi possível cancelar a ação.",
        },
      }));
    }
  };

  const quickSuggestions = [
    "Quantas vendas tivemos este mês?",
    "Quais chamados estão abertos agora?",
    "Consultar cliente no CRM",
    "Abrir um chamado de suporte para um cliente",
  ];

  return (
    <div
      data-testid="ai-assistant-workspace"
      className="flex h-full w-full overflow-hidden bg-slate-950 text-slate-100 flex-row"
    >
      {/* ─── COLUNA ESQUERDA: BARRA LATERAL DE CONVERSAS (THREADS) ─────────── */}
      <aside
        data-testid="ai-threads-sidebar"
        className={`${
          sidebarOpen ? "w-72 border-r" : "w-0 border-r-0"
        } transition-all duration-200 h-full flex flex-col flex-shrink-0 overflow-hidden ${currentTheme.sidebarBg} ${currentTheme.sidebarBorder}`}
      >
        {/* Botão de destaque no topo: Nova Conversa */}
        <div className={`p-4 border-b ${currentTheme.sidebarBorder}`}>
          <button
            type="button"
            data-testid="new-thread-button"
            onClick={() => void handleCreateNewThread()}
            disabled={createThreadMutation.isPending}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl ${currentTheme.accentBg} ${currentTheme.accentHoverBg} active:scale-[0.99] text-white font-semibold text-sm shadow-sm transition-all cursor-pointer disabled:opacity-60`}
          >
            <Plus className="w-4 h-4 mr-2" />
            <span>Nova Conversa</span>
          </button>
        </div>

        {/* Lista rolável de conversas anteriores */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Suas Conversas
          </div>

          {threads.length === 0 ? (
            <div
              data-testid="threads-empty-state"
              className="px-3 py-8 text-center rounded-xl border border-dashed border-slate-800 bg-slate-900/50"
            >
              <MessageSquare className={`w-7 h-7 ${currentTheme.accentText} mx-auto mb-2 opacity-80`} />
              <p className="text-xs font-medium text-slate-300">Nenhuma conversa ainda</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Clique em &ldquo;Nova Conversa&rdquo; ou envie uma mensagem para começar.
              </p>
            </div>
          ) : (
            threads.map((thread) => {
              const isSelected = thread.id === selectedThreadId;
              const isEditingThis = editingThreadId === thread.id;

              return (
                <div
                  key={thread.id}
                  data-testid={`thread-item-${thread.id}`}
                  onClick={() => {
                    setSelectedThreadId(thread.id);
                    setActiveTab("chat");
                  }}
                  className={`group relative flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm transition-all cursor-pointer ${
                    isSelected
                      ? "bg-blue-600/20 text-white border border-blue-500/40 font-medium"
                      : "text-slate-300 hover:bg-slate-900/70 hover:text-white border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <MessageSquare
                      className={`w-4 h-4 flex-shrink-0 ${
                        isSelected ? currentTheme.accentText : "text-slate-500 group-hover:text-slate-400"
                      }`}
                    />
                    {isEditingThis ? (
                      <form
                        onSubmit={(e) => void handleSaveRenameSidebar(thread.id, e)}
                        className="flex items-center gap-1 flex-1 min-w-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={editingTitleValue}
                          onChange={(e) => setEditingTitleValue(e.target.value)}
                          autoFocus
                          className="w-full bg-slate-950 text-white text-xs px-2 py-1 rounded border border-blue-500 focus:outline-none"
                        />
                        <button
                          type="submit"
                          title="Salvar título"
                          className="p-1 text-blue-400 hover:text-blue-300"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Cancelar"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingThreadId(null);
                          }}
                          className="p-1 text-slate-400 hover:text-slate-200"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </form>
                    ) : (
                      <span className="truncate" title={thread.title}>
                        {thread.title}
                      </span>
                    )}
                  </div>

                  {/* Ações sutis no hover: Renomear / Excluir */}
                  {!isEditingThis && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        data-testid={`rename-thread-${thread.id}`}
                        title="Renomear conversa"
                        onClick={(e) => handleStartRenameSidebar(thread, e)}
                        className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        data-testid={`delete-thread-${thread.id}`}
                        title="Excluir conversa"
                        onClick={(e) => void handleDeleteThread(thread.id, e)}
                        className="p-1 rounded-md text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* ─── COLUNA PRINCIPAL: TABS & CONTEÚDO ───────────────────────────────── */}
      <div className={`h-full flex-1 flex flex-col min-w-0 overflow-hidden ${currentTheme.chatBg} text-slate-100`}>
        {/* Cabeçalho Unificado com Abas Estilo Typebot */}
        <header className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b ${currentTheme.headerBg} ${currentTheme.headerBorder}`}>
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              data-testid="toggle-threads-sidebar"
              onClick={() => setSidebarOpen((prev) => !prev)}
              title={sidebarOpen ? "Recolher barra lateral" : "Abrir barra lateral"}
              className="p-2 rounded-xl border border-slate-800 bg-slate-900/80 text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <PanelLeft className="w-4 h-4" />
            </button>

            <div className={`w-9 h-9 rounded-xl ${currentTheme.accentBg}/15 flex items-center justify-center flex-shrink-0`}>
              <Sparkles className={`w-5 h-5 ${currentTheme.accentText}`} />
            </div>

            <div className="min-w-0">
              {isEditingHeaderTitle && activeThread ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    data-testid="header-title-input"
                    value={headerTitleDraft}
                    onChange={(e) => setHeaderTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSaveRenameHeader();
                      if (e.key === "Escape") setIsEditingHeaderTitle(false);
                    }}
                    autoFocus
                    className="text-sm font-semibold text-slate-100 bg-slate-950 px-2.5 py-1 rounded-lg border border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveRenameHeader()}
                    className="p-1 text-blue-400 hover:bg-slate-800 rounded"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingHeaderTitle(false)}
                    className="p-1 text-slate-400 hover:bg-slate-800 rounded"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2
                    data-testid="active-thread-title"
                    onClick={handleStartRenameHeader}
                    className="text-base font-semibold text-slate-100 truncate cursor-pointer hover:text-blue-400 transition-colors"
                    title="Clique para editar o título da conversa"
                  >
                    {activeThread ? activeThread.title : "Assistente IA MegaDesk"}
                  </h2>
                  {activeThread && (
                    <button
                      type="button"
                      onClick={handleStartRenameHeader}
                      title="Renomear conversa"
                      className="text-slate-400 hover:text-slate-200 p-1 rounded"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
              <p className="text-xs text-slate-400 truncate">
                Copiloto Multimodal • {session?.company || "Operação Conectada"}
              </p>
            </div>
          </div>

          {/* Abas Superiores no Estilo Typebot */}
          <nav
            data-testid="assistant-tabs"
            className="flex items-center gap-1 bg-slate-950/70 p-1 rounded-xl border border-slate-800/80"
          >
            <button
              type="button"
              data-testid="tab-chat"
              onClick={() => setActiveTab("chat")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "chat"
                  ? currentTheme.activeTabBg
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat</span>
            </button>

            <button
              type="button"
              data-testid="tab-themes"
              onClick={() => setActiveTab("themes")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "themes"
                  ? currentTheme.activeTabBg
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Temas</span>
            </button>

            <button
              type="button"
              data-testid="tab-routines"
              onClick={() => setActiveTab("routines")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "routines"
                  ? currentTheme.activeTabBg
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Rotinas &amp; Horários</span>
            </button>

            <button
              type="button"
              data-testid="tab-settings"
              onClick={() => setActiveTab("settings")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "settings"
                  ? currentTheme.activeTabBg
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Configurações</span>
            </button>
          </nav>
        </header>

        {/* ─── ABA 1: CHAT TIMELINE + COMPOSER ───────────────────────────────── */}
        {activeTab === "chat" && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Timeline de Mensagens */}
            <div
              data-testid="ai-messages-timeline"
              className={`flex-1 overflow-y-auto px-6 py-6 space-y-5 ${currentTheme.chatBg} text-slate-100`}
            >
              {localMessages.length === 0 && !isSendingText && !isProcessingAudio ? (
                <div className="flex flex-col items-center justify-center h-full max-w-xl mx-auto text-center py-10 gap-6">
                  <div className={`w-16 h-16 rounded-2xl ${currentTheme.accentBg}/15 border ${currentTheme.accentBorder} flex items-center justify-center shadow-sm`}>
                    <Sparkles className={`w-8 h-8 ${currentTheme.accentText}`} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-100 mb-1.5">
                      Como posso ajudar sua operação hoje?
                    </h3>
                    <p className="text-sm text-slate-400">
                      Envie uma mensagem de texto ou grave um comando de voz pelo microfone para consultar vendas, CRM, chamados ou abrir solicitações em segundos.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                    {quickSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => {
                          setInput(suggestion);
                          textareaRef.current?.focus();
                        }}
                        className="text-left px-4 py-3 rounded-xl border border-slate-800 bg-slate-900/70 text-sm text-slate-200 hover:border-blue-500/60 hover:bg-slate-800/90 transition-all shadow-xs cursor-pointer"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                localMessages.map((msg) => {
                  const isUser = msg.role === "user";
                  const pendingAction = extractPendingActionFromMessage(msg);
                  const localAction = pendingAction?.id ? actionStates[pendingAction.id] : undefined;

                  return (
                    <div
                      key={msg.id}
                      data-testid={`assistant-msg-${msg.role}`}
                      className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      {!isUser && (
                        <div className={`w-8 h-8 rounded-full ${currentTheme.accentBg}/15 border ${currentTheme.accentBorder} flex items-center justify-center flex-shrink-0 mt-1`}>
                          <Bot className={`w-4 h-4 ${currentTheme.accentText}`} />
                        </div>
                      )}

                      <div className={`max-w-[78%] ${isUser ? "order-first" : ""}`}>
                        <div
                          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                            isUser
                              ? `${currentTheme.userBubble} rounded-tr-sm shadow-sm`
                              : `${currentTheme.assistantBubble} border ${currentTheme.assistantBubbleBorder} rounded-tl-sm shadow-sm`
                          }`}
                        >
                          {isUser ? (
                            <div className="whitespace-pre-wrap">{msg.content}</div>
                          ) : (
                            <div className="prose prose-sm prose-invert max-w-none">
                              <AssistantMarkdown content={msg.content} />
                            </div>
                          )}
                        </div>

                        {/* Card Interativo HITL caso a IA acione ferramentas de mutação */}
                        {pendingAction && (
                          <div
                            data-testid="hitl-action-card"
                            className="mt-2.5 rounded-xl border border-blue-500/40 bg-slate-900/95 p-4 text-xs text-slate-100 shadow-md"
                          >
                            <p className="font-semibold text-blue-400">
                              Ação preparada pelo Copiloto — Aprovação Humana (HITL)
                            </p>
                            <p className="mt-1 text-slate-200">
                              {pendingAction.summary || `Ação: ${pendingAction.actionType}`}
                            </p>

                            {pendingAction.args && typeof pendingAction.args === "object" && (
                              <dl className="mt-3 grid gap-1.5 rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 text-slate-300">
                                {Object.entries(pendingAction.args).map(([key, value]) => (
                                  <div key={key} className="flex items-start justify-between gap-3">
                                    <dt className="capitalize text-slate-400 font-medium">{key}</dt>
                                    <dd className="text-right text-slate-100 font-semibold">
                                      {typeof value === "object" ? JSON.stringify(value) : String(value)}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            )}

                            {localAction?.message && (
                              <p
                                className={`mt-2.5 font-medium ${
                                  localAction.state === "FAILED"
                                    ? "text-rose-300"
                                    : localAction.state === "EXECUTED"
                                    ? "text-emerald-400"
                                    : "text-slate-300"
                                }`}
                              >
                                {localAction.message}
                              </p>
                            )}

                            {!localAction?.state && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  className="bg-blue-600 text-white hover:bg-blue-500 font-semibold shadow-sm"
                                  onClick={() => void handleConfirmPendingAction(pendingAction)}
                                >
                                  Confirmar e Executar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white"
                                  onClick={() => void handleCancelPendingAction(pendingAction)}
                                >
                                  Cancelar
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {isUser && (
                        <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0 mt-1">
                          <UserIcon className="w-4 h-4 text-slate-300" />
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {/* Indicador de Digitando / Processando Áudio */}
              {(isSendingText || isProcessingAudio) && (
                <div
                  data-testid="assistant-status-indicator"
                  className="flex gap-3 justify-start animate-fade-in"
                >
                  <div className={`w-8 h-8 rounded-full ${currentTheme.accentBg}/15 border ${currentTheme.accentBorder} flex items-center justify-center flex-shrink-0 mt-1`}>
                    <Loader2 className={`w-4 h-4 ${currentTheme.accentText} animate-spin`} />
                  </div>
                  <div className="rounded-2xl px-4 py-3 text-sm bg-slate-900/90 border border-slate-800 text-slate-200 rounded-tl-sm shadow-xs flex items-center gap-2.5">
                    <span className="font-medium">
                      {isProcessingAudio
                        ? "Processando áudio no Gemini Multimodal..."
                        : "Digitando resposta..."}
                    </span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Barra de Composição Inferior (Texto + Microfone) */}
            <div className={`px-6 py-4 border-t ${currentTheme.composerBg} ${currentTheme.composerBorder}`}>
              {recordingError && (
                <div className="mb-3 px-3.5 py-2 rounded-xl bg-rose-950/60 border border-rose-800/80 text-xs text-rose-300 flex items-center justify-between">
                  <span>{recordingError}</span>
                  <button
                    type="button"
                    onClick={() => setRecordingError(null)}
                    className="text-rose-400 hover:text-rose-200 font-semibold cursor-pointer"
                  >
                    Fechar
                  </button>
                </div>
              )}

              {isRecording ? (
                /* Estado Visual de Gravação de Áudio */
                <div
                  data-testid="audio-recording-bar"
                  className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-rose-950/60 border border-rose-800/80"
                >
                  <div className="flex items-center gap-3">
                    <span className="relative flex h-3.5 w-3.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-rose-500" />
                    </span>
                    <span className="text-sm font-semibold text-rose-200">
                      Gravando comando de voz...
                    </span>
                    <span
                      data-testid="recording-timer"
                      className="font-mono text-sm font-bold text-rose-300 bg-slate-900 px-2.5 py-0.5 rounded-md border border-rose-800"
                    >
                      {formatRecordingDuration(recordingSeconds)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid="cancel-audio-recording"
                      onClick={cancelAudioRecording}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Cancelar</span>
                    </button>
                    <button
                      type="button"
                      data-testid="send-audio-recording"
                      onClick={finishAndSendAudioRecording}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg ${currentTheme.accentBg} ${currentTheme.accentHoverBg} text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer`}
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Enviar Áudio</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-end gap-3">
                  {/* Textarea com auto-expansão e scrollbar vertical SOMENTE além de 2 linhas */}
                  <textarea
                    ref={textareaRef}
                    data-testid="assistant-composer-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Digite sua mensagem ou clique no microfone para falar... (Enter envia, Shift+Enter quebra linha)"
                    rows={1}
                    disabled={isSendingText || isProcessingAudio}
                    className={`flex-1 resize-none rounded-xl border px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all ${
                      composerHasScroll ? "overflow-y-auto" : "overflow-hidden"
                    } ${currentTheme.composerInputBg} ${currentTheme.composerInputBorder}`}
                    style={{ maxHeight: "76px" }}
                  />

                  {/* Botão de Microfone (Gravação Nativa via MediaRecorder) */}
                  <button
                    type="button"
                    data-testid="start-audio-recording"
                    onClick={() => void startAudioRecording()}
                    disabled={isSendingText || isProcessingAudio}
                    title="Gravar comando de voz (Microfone)"
                    className="w-11 h-11 rounded-xl border border-slate-800 bg-slate-800/80 hover:bg-rose-950/40 hover:border-rose-500/50 hover:text-rose-400 text-slate-300 flex items-center justify-center transition-all flex-shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <Mic className="w-5 h-5" />
                  </button>

                  {/* Botão de Envio de Texto */}
                  <button
                    type="button"
                    data-testid="send-text-message"
                    onClick={() => void handleSendText()}
                    disabled={!input.trim() || isSendingText || isProcessingAudio}
                    title="Enviar mensagem"
                    className={`w-11 h-11 rounded-xl ${currentTheme.accentBg} ${currentTheme.accentHoverBg} disabled:bg-slate-800 disabled:text-slate-600 text-white flex items-center justify-center transition-all flex-shrink-0 cursor-pointer`}
                  >
                    {isSendingText ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── ABA 2: TEMAS VISUAIS ─────────────────────────────────────────── */}
        {activeTab === "themes" && (
          <div data-testid="themes-tab-view" className="flex-1 overflow-y-auto p-8 space-y-6 max-w-4xl mx-auto w-full">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Palette className={`w-5 h-5 ${currentTheme.accentText}`} />
                <h3 className="text-xl font-bold text-slate-100">Temas Visuais do Assistente</h3>
              </div>
              <p className="text-sm text-slate-400">
                Personalize a paleta de cores da interface do Copiloto IA. As preferências são salvas e aplicadas em tempo real.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.values(AI_THEMES).map((theme) => {
                const isSelected = selectedThemeId === theme.id;
                return (
                  <div
                    key={theme.id}
                    data-testid={`theme-card-${theme.id}`}
                    onClick={() => handleSelectTheme(theme.id)}
                    className={`cursor-pointer rounded-2xl p-5 border transition-all duration-200 flex flex-col justify-between gap-4 ${
                      isSelected
                        ? "border-blue-500 bg-slate-900/90 shadow-lg ring-1 ring-blue-500/50"
                        : "border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900/40"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="font-semibold text-base text-slate-100">{theme.name}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                          {theme.badge}
                        </span>
                      </div>
                      {isSelected && (
                        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-800">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Ativo
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">{theme.description}</p>

                    {/* Amostras de cores */}
                    <div className="rounded-xl p-3 border border-slate-800/80 bg-slate-950/80 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-5 h-5 rounded-full border border-slate-700"
                          style={{ backgroundColor: theme.swatches[0] }}
                          title="Barra Lateral"
                        />
                        <div
                          className="w-5 h-5 rounded-full border border-slate-700"
                          style={{ backgroundColor: theme.swatches[1] }}
                          title="Canvas Central"
                        />
                        <div
                          className="w-5 h-5 rounded-full border border-slate-700"
                          style={{ backgroundColor: theme.swatches[2] }}
                          title="Cor de Realce"
                        />
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {theme.swatches[2]}
                      </span>
                    </div>

                    <button
                      type="button"
                      data-testid={`apply-theme-${theme.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectTheme(theme.id);
                      }}
                      className={`w-full py-2 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                        isSelected
                          ? `${theme.accentBg} text-white shadow-sm`
                          : "bg-slate-800 hover:bg-slate-700 text-slate-200"
                      }`}
                    >
                      {isSelected ? "Tema em Uso" : "Ativar Este Tema"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── ABA 3: ROTINAS OPERACIONAIS & HORÁRIOS ───────────────────────── */}
        {activeTab === "routines" && (
          <div data-testid="routines-tab-view" className="flex-1 overflow-y-auto p-8 space-y-6 max-w-4xl mx-auto w-full">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Clock className={`w-5 h-5 ${currentTheme.accentText}`} />
                <h3 className="text-xl font-bold text-slate-100">Rotinas Operacionais &amp; Horários</h3>
              </div>
              <p className="text-sm text-slate-400">
                Configure os turnos operacionais do Copiloto IA para ajustar as respostas automáticas de acordo com o expediente.
              </p>
            </div>

            {/* Banner de Status Atual */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                <div>
                  <p className="text-sm font-semibold text-slate-100">Status Operacional: Modo Expediente Ativo</p>
                  <p className="text-xs text-slate-400">
                    Atendimento ágil em tempo real com acesso pleno a consultas, CRM e chamados.
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono text-emerald-400 bg-emerald-950/50 border border-emerald-800/80 px-2.5 py-1 rounded-full">
                Turno Diurno
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Modo Expediente Ativo */}
              <div className="rounded-2xl border border-blue-500/30 bg-slate-900/40 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sun className="w-4 h-4 text-amber-400" />
                    <h4 className="font-semibold text-slate-100 text-sm">Modo Expediente Ativo</h4>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800">
                    08:00 às 18:00
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Horário de Início</label>
                    <input
                      type="time"
                      value={routinesConfig.startDayTime}
                      onChange={(e) => setRoutinesConfig((prev: any) => ({ ...prev, startDayTime: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Horário de Término</label>
                    <input
                      type="time"
                      value={routinesConfig.endDayTime}
                      onChange={(e) => setRoutinesConfig((prev: any) => ({ ...prev, endDayTime: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <p className="text-xs text-slate-400">
                  Respostas instantâneas para consulta de preços, serviços, cadastros e abertura de solicitações.
                </p>

                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={routinesConfig.proactiveSuggestions}
                    onChange={(e) => setRoutinesConfig((prev: any) => ({ ...prev, proactiveSuggestions: e.target.checked }))}
                    className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Permitir sugestões proativas (itens complementares, rotinas de follow-up)</span>
                </label>
              </div>

              {/* Modo Noturno */}
              <div className="rounded-2xl border border-indigo-500/30 bg-slate-900/40 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Moon className="w-4 h-4 text-indigo-400" />
                    <h4 className="font-semibold text-slate-100 text-sm">Modo Noturno (Triagem)</h4>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800">
                    18:01 às 07:59
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Horário de Início</label>
                    <input
                      type="time"
                      value={routinesConfig.startNightTime}
                      onChange={(e) => setRoutinesConfig((prev: any) => ({ ...prev, startNightTime: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Horário de Término</label>
                    <input
                      type="time"
                      value={routinesConfig.endNightTime}
                      onChange={(e) => setRoutinesConfig((prev: any) => ({ ...prev, endNightTime: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Mensagem de Triagem Noturna</label>
                  <textarea
                    rows={2}
                    value={routinesConfig.nightMessage}
                    onChange={(e) => setRoutinesConfig((prev: any) => ({ ...prev, nightMessage: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={routinesConfig.autoQueueTickets}
                    onChange={(e) => setRoutinesConfig((prev: any) => ({ ...prev, autoQueueTickets: e.target.checked }))}
                    className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Enfileirar chamado para triagem no primeiro horário da manhã</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                data-testid="save-routines-btn"
                onClick={handleSaveRoutines}
                className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-sm cursor-pointer"
              >
                {routinesSaved ? "✓ Rotinas Salvas!" : "Salvar Rotinas & Horários"}
              </Button>
            </div>
          </div>
        )}

        {/* ─── ABA 4: CONFIGURAÇÕES DA IA ───────────────────────────────────── */}
        {activeTab === "settings" && (
          <div data-testid="settings-tab-view" className="flex-1 overflow-y-auto p-8 space-y-6 max-w-4xl mx-auto w-full">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Sliders className={`w-5 h-5 ${currentTheme.accentText}`} />
                <h3 className="text-xl font-bold text-slate-100">Configurações do Assistente IA</h3>
              </div>
              <p className="text-sm text-slate-400">
                Ajuste a postura do modelo e mecanismos de segurança para a operação.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5">
              {/* Tom de Voz */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-3">
                <h4 className="font-semibold text-slate-100 text-sm">Tom de Voz</h4>
                <p className="text-xs text-slate-400">
                  Define a postura linguística do modelo ao responder comandos da equipe.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { id: "pratico", label: "Prático / Operacional", desc: "Ágil, direto e focado na rotina diária de atendimento e operações." },
                    { id: "formal", label: "Formal / Corporativo", desc: "Polido, técnico e estruturado, ideal para gestão e empresas B2B." },
                    { id: "direto", label: "Direto / Conciso", desc: "Ultra-sintético, focado em dados e respostas sem introduções ou despedidas." },
                  ].map((tone) => (
                    <div
                      key={tone.id}
                      data-testid={`tone-option-${tone.id}`}
                      onClick={() => updateSettings({ tone: tone.id as any })}
                      className={`cursor-pointer p-3.5 rounded-xl border text-xs transition-all ${
                        settingsConfig.tone === tone.id
                          ? "border-blue-500 bg-blue-600/10 text-white ring-1 ring-blue-500"
                          : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700"
                      }`}
                    >
                      <p className="font-semibold mb-1 text-slate-100">{tone.label}</p>
                      <p className="text-[11px] text-slate-400 leading-snug">{tone.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Controles Operacionais */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
                <h4 className="font-semibold text-slate-100 text-sm">Controles Operacionais</h4>

                <label className="flex items-center justify-between gap-4 cursor-pointer text-xs text-slate-300">
                  <div>
                    <span className="font-medium text-slate-100 block">Aprovação Humana Obrigatória (HITL)</span>
                    <span className="text-slate-400 text-[11px]">Exige confirmação por botão antes de criar chamados ou registrar transações.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settingsConfig.hitlRequired}
                    onChange={(e) => updateSettings({ hitlRequired: e.target.checked })}
                    className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500 h-4 w-4"
                  />
                </label>

                <label className="flex items-center justify-between gap-4 cursor-pointer text-xs text-slate-300">
                  <div>
                    <span className="font-medium text-slate-100 block">Modo Mãos-Livres (Áudio &amp; Campo)</span>
                    <span className="text-slate-400 text-[11px]">Permite comandos de voz ágeis para operações externas ou de balcão.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settingsConfig.handsFreeAudio}
                    onChange={(e) => updateSettings({ handsFreeAudio: e.target.checked })}
                    className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500 h-4 w-4"
                  />
                </label>

                <label className="flex items-center justify-between gap-4 cursor-pointer text-xs text-slate-300">
                  <div>
                    <span className="font-medium text-slate-100 block">Auto-Transcrição em Tempo Real</span>
                    <span className="text-slate-400 text-[11px]">Grava o texto transcrito pelo Gemini diretamente no histórico da mensagem.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settingsConfig.autoTranscribe}
                    onChange={(e) => updateSettings({ autoTranscribe: e.target.checked })}
                    className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500 h-4 w-4"
                  />
                </label>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                data-testid="save-settings-btn"
                onClick={handleSaveSettings}
                className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-sm cursor-pointer"
              >
                {settingsSaved ? "✓ Configurações Salvas!" : "Salvar Configurações"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AIAssistant;
