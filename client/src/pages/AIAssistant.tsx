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
  Square,
  Send,
  PanelLeft,
  Volume2,
  Loader2,
  Bot,
  User as UserIcon,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

export function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-slate-100 text-emerald-800 font-mono text-xs"
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
          <div key={`tbl-${i}`} className="my-2 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 text-slate-700 font-semibold">
                <tr>
                  {header.map((cell, cIdx) => (
                    <th key={cIdx} className="px-3 py-2 border-b border-slate-200">
                      {renderInlineMarkdown(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {body.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-50/70">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="px-3 py-1.5 text-slate-700">
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
        <ul key={`ul-${i}`} className="my-1.5 list-disc pl-5 space-y-1 text-slate-800">
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
        <h4 key={`h-${i}`} className="font-bold text-slate-900 mt-2 mb-1">
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
        <p key={`p-${i}`} className="leading-relaxed">
          {renderInlineMarkdown(line)}
        </p>
      );
    }
    i++;
  }

  return <div data-testid="assistant-markdown" className="space-y-1">{elements}</div>;
}

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

export function AIAssistant() {
  const SESSION_KEY = "megadesk_session_v1";
  const [session] = useState<any>(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

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

  const messages: ThreadMessage[] = (messagesQuery.data?.messages as ThreadMessage[]) ?? [];

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
    scrollToBottom("smooth");
  }, [messages.length, isSendingText, isProcessingAudio, scrollToBottom]);

  // Auto-expansão do textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

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

    setInput("");
    setIsSendingText(true);
    try {
      const targetThreadId = await ensureActiveThreadId();
      if (!targetThreadId) {
        setIsSendingText(false);
        return;
      }
      await sendMessageMutation.mutateAsync({
        threadId: targetThreadId,
        content: text,
      });
      await trpcUtils?.assistantThreads?.getThreadMessages?.invalidate?.({ threadId: targetThreadId });
    } catch (err) {
      console.error("[AIAssistant] Falha ao enviar mensagem:", err);
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

        setIsProcessingAudio(true);
        try {
          const audioBlob = new Blob(chunks, { type: recordedMime });
          const base64Audio = await blobToBase64(audioBlob);
          if (!base64Audio) {
            setIsProcessingAudio(false);
            return;
          }

          const targetThreadId = await ensureActiveThreadId();
          if (!targetThreadId) {
            setIsProcessingAudio(false);
            return;
          }

          await sendAudioMutation.mutateAsync({
            threadId: targetThreadId,
            audioBase64: base64Audio,
            mimeType: recordedMime.split(";")[0] || "audio/webm",
          });
          await trpcUtils?.assistantThreads?.getThreadMessages?.invalidate?.({ threadId: targetThreadId });
        } catch (err) {
          console.error("[AIAssistant] Erro ao enviar áudio gravado:", err);
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
      className="flex h-[calc(100vh-140px)] min-h-[620px] w-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"
    >
      {/* ─── COLUNA ESQUERDA: BARRA LATERAL DE CONVERSAS (THREADS) ─────────── */}
      <aside
        data-testid="ai-threads-sidebar"
        className={`${
          sidebarOpen ? "w-72 border-r border-slate-200" : "w-0 border-r-0"
        } transition-all duration-200 bg-slate-900 text-slate-100 flex flex-col flex-shrink-0 overflow-hidden`}
      >
        {/* Botão de destaque no topo: + Nova Conversa */}
        <div className="p-4 border-b border-slate-800">
          <button
            type="button"
            data-testid="new-thread-button"
            onClick={() => void handleCreateNewThread()}
            disabled={createThreadMutation.isPending}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white font-semibold text-sm shadow-sm transition-all cursor-pointer disabled:opacity-60"
          >
            <Plus className="w-4 h-4" />
            <span>+ Nova Conversa</span>
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
              <MessageSquare className="w-7 h-7 text-emerald-400/70 mx-auto mb-2" />
              <p className="text-xs font-medium text-slate-300">Nenhuma conversa ainda</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Clique em &ldquo;+ Nova Conversa&rdquo; ou envie uma mensagem para começar.
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
                  onClick={() => setSelectedThreadId(thread.id)}
                  className={`group relative flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm transition-all cursor-pointer ${
                    isSelected
                      ? "bg-emerald-600/20 text-white border border-emerald-500/30 font-medium"
                      : "text-slate-300 hover:bg-slate-800/80 hover:text-white border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <MessageSquare
                      className={`w-4 h-4 flex-shrink-0 ${
                        isSelected ? "text-emerald-400" : "text-slate-400 group-hover:text-slate-300"
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
                          className="w-full bg-slate-950 text-white text-xs px-2 py-1 rounded border border-emerald-500 focus:outline-none"
                        />
                        <button
                          type="submit"
                          title="Salvar título"
                          className="p-1 text-emerald-400 hover:text-emerald-300"
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
                        className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-700/70 transition-colors"
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

        {/* Rodapé informativo de atalho mãos-livres */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Volume2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="truncate">Voz Multimodal • Gemini 3.5 Flash Lite</span>
          </div>
        </div>
      </aside>

      {/* ─── COLUNA PRINCIPAL: CHAT VIEW ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50">
        {/* Cabeçalho da Conversa Ativa */}
        <header className="flex items-center justify-between px-5 py-3.5 bg-white border-b border-slate-200">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              data-testid="toggle-threads-sidebar"
              onClick={() => setSidebarOpen((prev) => !prev)}
              title={sidebarOpen ? "Recolher barra lateral" : "Abrir barra lateral"}
              className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <PanelLeft className="w-4 h-4" />
            </button>

            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-emerald-600" />
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
                    className="text-sm font-semibold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg border border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveRenameHeader()}
                    className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingHeaderTitle(false)}
                    className="p-1 text-slate-400 hover:bg-slate-100 rounded"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2
                    data-testid="active-thread-title"
                    onClick={handleStartRenameHeader}
                    className="text-base font-semibold text-slate-900 truncate cursor-pointer hover:text-emerald-700 transition-colors"
                    title="Clique para editar o título da conversa"
                  >
                    {activeThread ? activeThread.title : "Assistente IA MegaDesk"}
                  </h2>
                  {activeThread && (
                    <button
                      type="button"
                      onClick={handleStartRenameHeader}
                      title="Renomear conversa"
                      className="text-slate-400 hover:text-slate-600 p-1 rounded"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
              <p className="text-xs text-slate-500 truncate">
                Copiloto Multimodal • {session?.company || "Operação Conectada"}
              </p>
            </div>
          </div>
        </header>

        {/* Área de Mensagens */}
        <div
          data-testid="ai-messages-timeline"
          className="flex-1 overflow-y-auto px-6 py-6 space-y-5"
        >
          {messages.length === 0 && !isSendingText && !isProcessingAudio ? (
            <div className="flex flex-col items-center justify-center h-full max-w-xl mx-auto text-center py-10 gap-6">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center shadow-sm">
                <Sparkles className="w-8 h-8 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 mb-1.5">
                  Como posso ajudar sua operação hoje?
                </h3>
                <p className="text-sm text-slate-600">
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
                    className="text-left px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 hover:border-emerald-400 hover:bg-emerald-50/60 transition-all shadow-xs cursor-pointer"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => {
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
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-1">
                      <Bot className="w-4 h-4 text-emerald-700" />
                    </div>
                  )}

                  <div className={`max-w-[78%] ${isUser ? "order-first" : ""}`}>
                    <div
                      className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        isUser
                          ? "bg-emerald-600 text-white rounded-tr-sm shadow-xs"
                          : "bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-xs"
                      }`}
                    >
                      {isUser ? (
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      ) : (
                        <div className="prose prose-sm prose-slate max-w-none">
                          <AssistantMarkdown content={msg.content} />
                        </div>
                      )}
                    </div>

                    {/* Card Interativo HITL caso a IA acione ferramentas de mutação */}
                    {pendingAction && (
                      <div
                        data-testid="hitl-action-card"
                        className="mt-2.5 rounded-xl border border-sky-500/40 bg-slate-900 p-4 text-xs text-slate-100 shadow-sm"
                      >
                        <p className="font-semibold text-sky-300">
                          Ação preparada pelo Copiloto — Aprovação Humana (HITL)
                        </p>
                        <p className="mt-1 text-slate-300">
                          {pendingAction.summary || `Ação: ${pendingAction.actionType}`}
                        </p>

                        {pendingAction.args && typeof pendingAction.args === "object" && (
                          <dl className="mt-3 grid gap-1.5 rounded-lg border border-slate-800 bg-slate-950/70 p-2.5 text-slate-300">
                            {Object.entries(pendingAction.args).map(([key, value]) => (
                              <div key={key} className="flex items-start justify-between gap-3">
                                <dt className="capitalize text-slate-400">{key}</dt>
                                <dd className="text-right text-slate-100 font-medium">
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
                                ? "text-emerald-300"
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
                              className="bg-emerald-600 text-white hover:bg-emerald-500"
                              onClick={() => void handleConfirmPendingAction(pendingAction)}
                            >
                              Confirmar e Executar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-slate-700 bg-transparent text-slate-200 hover:bg-slate-800"
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
                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0 mt-1">
                      <UserIcon className="w-4 h-4 text-slate-600" />
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
              <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-1">
                <Loader2 className="w-4 h-4 text-emerald-600 animate-spin" />
              </div>
              <div className="rounded-2xl px-4 py-3 text-sm bg-white border border-slate-200 text-slate-600 rounded-tl-sm shadow-xs flex items-center gap-2.5">
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

        {/* ─── BARRA DE COMPOSIÇÃO INFERIOR (TEXTO + MICROFONE MULTIMODAL) ─── */}
        <div className="px-6 py-4 bg-white border-t border-slate-200">
          {recordingError && (
            <div className="mb-3 px-3.5 py-2 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center justify-between">
              <span>{recordingError}</span>
              <button
                type="button"
                onClick={() => setRecordingError(null)}
                className="text-rose-500 hover:text-rose-700 font-semibold"
              >
                Fechar
              </button>
            </div>
          )}

          {isRecording ? (
            /* Estado Visual Claro de Gravação (Indicador Vermelho Pulsante + Timer + Cancelar/Enviar) */
            <div
              data-testid="audio-recording-bar"
              className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-rose-50/90 border border-rose-200"
            >
              <div className="flex items-center gap-3">
                <span className="relative flex h-3.5 w-3.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-rose-600" />
                </span>
                <span className="text-sm font-semibold text-rose-800">
                  Gravando comando de voz...
                </span>
                <span
                  data-testid="recording-timer"
                  className="font-mono text-sm font-bold text-rose-600 bg-white px-2.5 py-0.5 rounded-md border border-rose-200"
                >
                  {formatRecordingDuration(recordingSeconds)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="cancel-audio-recording"
                  onClick={cancelAudioRecording}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Cancelar</span>
                </button>
                <button
                  type="button"
                  data-testid="send-audio-recording"
                  onClick={finishAndSendAudioRecording}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Enviar Áudio</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-end gap-3">
              <textarea
                ref={textareaRef}
                data-testid="assistant-composer-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Digite sua mensagem ou clique no microfone para falar... (Enter envia, Shift+Enter quebra linha)"
                rows={1}
                disabled={isSendingText || isProcessingAudio}
                className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all"
                style={{ maxHeight: "140px", overflowY: "auto" }}
              />

              {/* Botão de Microfone (Gravação Nativa via MediaRecorder) */}
              <button
                type="button"
                data-testid="start-audio-recording"
                onClick={() => void startAudioRecording()}
                disabled={isSendingText || isProcessingAudio}
                title="Gravar comando de voz (Microfone)"
                className="w-11 h-11 rounded-xl border border-slate-200 bg-slate-100 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-600 text-slate-700 flex items-center justify-center transition-all flex-shrink-0 cursor-pointer disabled:opacity-50"
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
                className="w-11 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-200 disabled:text-slate-400 text-white flex items-center justify-center transition-all flex-shrink-0 cursor-pointer"
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
    </div>
  );
}

export default AIAssistant;
