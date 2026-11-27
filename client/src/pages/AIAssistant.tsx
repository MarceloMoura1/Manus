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
  Copy,
  Play,
  Calendar,
  AlertCircle,
  Eye,
  RefreshCw,
  Zap,
  ArrowRight,
  TrendingUp,
  FileText,
  ChevronRight,
  ChevronLeft,
  Bell,
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

  // ─── Rotinas Autônomas (tRPC) ───────────────────────────────────────────────
  const routinesQuery = trpc.assistantRoutines.listRoutines.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const upsertRoutineMutation = trpc.assistantRoutines.upsertRoutine.useMutation({
    onSuccess: () => {
      routinesQuery.refetch();
      setIsRoutineModalOpen(false);
      setEditingRoutine(null);
    },
  });

  const toggleRoutineMutation = trpc.assistantRoutines.toggleRoutineActive.useMutation({
    onSuccess: () => {
      routinesQuery.refetch();
    },
  });

  const deleteRoutineMutation = trpc.assistantRoutines.deleteRoutine.useMutation({
    onSuccess: () => {
      routinesQuery.refetch();
    },
  });

  const runRoutineMutation = trpc.assistantRoutines.runRoutineNow.useMutation();

  const [runningRoutineId, setRunningRoutineId] = useState<string | null>(null);
  const [isRoutineModalOpen, setIsRoutineModalOpen] = useState<boolean>(false);
  const [editingRoutine, setEditingRoutine] = useState<any | null>(null);
  const [logSummaryModal, setLogSummaryModal] = useState<{
    title: string;
    date: string;
    status: string;
    summary: string;
  } | null>(null);

  const [routineToast, setRoutineToast] = useState<{
    title: string;
    message: string;
    type: "success" | "error";
  } | null>(null);

  const [routineForm, setRoutineForm] = useState({
    id: undefined as string | undefined,
    title: "",
    triggerType: "morning_briefing" as "morning_briefing" | "stale_leads" | "eod_summary" | "custom",
    promptInstruction: "",
    scheduleTime: "08:30",
    scheduleDays: ["seg", "ter", "qua", "qui", "sex"] as string[],
    actionTarget: "chat_thread" as "chat_thread" | "internal_notification" | "whatsapp",
    isActive: true,
  });

  const ROUTINE_PRESETS = [
    {
      triggerType: "morning_briefing" as const,
      title: "📋 Briefing Matinal: O que tenho que fazer hoje?",
      description: "Varre chamados urgentes, leads sem retorno e orçamentos abertos para entregar a lista de prioridades do dia.",
      scheduleTime: "08:30",
      scheduleDays: ["seg", "ter", "qua", "qui", "sex"],
      promptInstruction: "Consulte os chamados em aberto com SLA prioritário, os clientes que enviaram mensagem e aguardam retorno há mais de 24h e as propostas em negociação pendentes. Monte um resumo executivo direto e acionável com o título '📋 O QUE TEMOS PARA HOJE' contendo prioridades, alertas urgentes e lista de ação imediata.",
      actionTarget: "chat_thread" as const,
    },
    {
      triggerType: "stale_leads" as const,
      title: "⏱️ Radar de Clientes Parados (Follow-up 48h)",
      description: "Identifica negociações e mensagens sem interação há 2 dias e lista quem precisa ser contatado hoje.",
      scheduleTime: "11:00",
      scheduleDays: ["seg", "ter", "qua", "qui", "sex"],
      promptInstruction: "Analise os contatos do CRM e conversas recentes. Identifique clientes, leads ou propostas sem interação recente (há mais de 48h) e gere uma lista priorizada com o título '⏱️ RADAR DE FOLLOW-UP (48H)' destacando quem precisa ser contatado hoje, telefone/canal e motivo do follow-up.",
      actionTarget: "chat_thread" as const,
    },
    {
      triggerType: "eod_summary" as const,
      title: "📊 Fechamento e Pendências do Dia",
      description: "Gera o balanço de faturamento, chamados concluídos e o que ficou acumulado para o próximo turno.",
      scheduleTime: "18:00",
      scheduleDays: ["seg", "ter", "qua", "qui", "sex"],
      promptInstruction: "Consulte o faturamento e vendas registradas no dia, os chamados fechados e os que continuam em andamento ou pendentes. Monte um relatório executivo com o título '📊 FECHAMENTO E PENDÊNCIAS DO DIA' contendo balanço geral, conquistas do turno e pendências prioritárias para amanhã.",
      actionTarget: "chat_thread" as const,
    },
    {
      triggerType: "custom" as const,
      title: "🎫 Auditoria de Chamados e SLA Crítico",
      description: "Varre os chamados pendentes com SLA atrasado ou em risco de estouro e organiza ações para o time.",
      scheduleTime: "09:00",
      scheduleDays: ["seg", "ter", "qua", "qui", "sex"],
      promptInstruction: "Consulte todos os chamados em aberto {{chamados_abertos}} e filtre os com SLA atrasado {{tickets_atrasados}}. Crie um relatório com o título '🎫 AUDITORIA DE CHAMADOS E SLA' indicando número, cliente, tempo de espera e plano de ação urgente.",
      actionTarget: "chat_thread" as const,
    },
    {
      triggerType: "custom" as const,
      title: "🎯 Resumo Comercial & Vendas",
      description: "Acompanha o faturamento do dia, taxa de conversão e orçamentos em aberto na esteira comercial.",
      scheduleTime: "17:30",
      scheduleDays: ["seg", "ter", "qua", "qui", "sex"],
      promptInstruction: "Analise o faturamento do dia {{faturamento_dia}}, os orçamentos abertos {{orcamentos_abertos}} e os leads pendentes {{leads_pendentes}}. Gere um panorama executivo com o título '🎯 BALANÇO COMERCIAL' destacando oportunidades quentes e faturamento acumulado.",
      actionTarget: "chat_thread" as const,
    },
  ];

  const ROUTINE_VARIABLES = [
    { tag: "{{chamados_abertos}}", label: "Chamados Abertos" },
    { tag: "{{leads_pendentes}}", label: "Leads Pendentes" },
    { tag: "{{orcamentos_abertos}}", label: "Orçamentos Abertos" },
    { tag: "{{faturamento_dia}}", label: "Faturamento do Dia" },
    { tag: "{{tickets_atrasados}}", label: "SLA Crítico" },
  ];

  const QUICK_TEMPLATES = [
    { label: "📋 Briefing Matinal", text: "Consulte os chamados em aberto {{chamados_abertos}}, leads pendentes {{leads_pendentes}} e orçamentos {{orcamentos_abertos}}. Monte a lista com as prioridades imediatas do dia com o título '📋 O QUE TEMOS PARA HOJE'." },
    { label: "⏱️ Radar de Follow-up", text: "Verifique negociações e orçamentos abertos {{orcamentos_abertos}} sem resposta há mais de 48h. Elabore lista com contatos prioritários para abordagem imediata." },
    { label: "🎫 Auditoria de SLA", text: "Analise todos os chamados com SLA atrasado {{tickets_atrasados}} ou críticos {{chamados_abertos}} e apresente plano de resolução urgente para a equipe." },
    { label: "📊 Fechamento do Dia", text: "Consulte o faturamento do dia {{faturamento_dia}} e propostas convertidas. Gere o balanço executivo do turno e pendências para amanhã." },
  ];

  const WEEKDAYS = [
    { key: "seg", label: "Seg" },
    { key: "ter", label: "Ter" },
    { key: "qua", label: "Qua" },
    { key: "qui", label: "Qui" },
    { key: "sex", label: "Sex" },
    { key: "sab", label: "Sáb" },
    { key: "dom", label: "Dom" },
  ];

  const handleOpenCreateModal = () => {
    setRoutineForm({
      id: undefined,
      title: "📋 Briefing Matinal: O que tenho que fazer hoje?",
      triggerType: "morning_briefing",
      promptInstruction: "Consulte os chamados em aberto com SLA prioritário, os clientes que enviaram mensagem e aguardam retorno há mais de 24h e as propostas em negociação pendentes. Monte um resumo executivo direto e acionável com o título '📋 O QUE TEMOS PARA HOJE' contendo prioridades, alertas urgentes e lista de ação imediata.",
      scheduleTime: "08:30",
      scheduleDays: ["seg", "ter", "qua", "qui", "sex"],
      actionTarget: "chat_thread",
      isActive: true,
    });
    setEditingRoutine(null);
    setIsRoutineModalOpen(true);
  };

  const handleOpenEditModal = (routine: any) => {
    setRoutineForm({
      id: routine.id,
      title: routine.title,
      triggerType: routine.triggerType,
      promptInstruction: routine.promptInstruction,
      scheduleTime: routine.scheduleTime,
      scheduleDays: Array.isArray(routine.scheduleDays) ? routine.scheduleDays : ["seg", "ter", "qua", "qui", "sex"],
      actionTarget: routine.actionTarget || "chat_thread",
      isActive: routine.isActive,
    });
    setEditingRoutine(routine);
    setIsRoutineModalOpen(true);
  };

  const handleDuplicateRoutine = (routine: any) => {
    setRoutineForm({
      id: undefined,
      title: `${routine.title} (Cópia)`,
      triggerType: routine.triggerType,
      promptInstruction: routine.promptInstruction,
      scheduleTime: routine.scheduleTime,
      scheduleDays: Array.isArray(routine.scheduleDays) ? [...routine.scheduleDays] : ["seg", "ter", "qua", "qui", "sex"],
      actionTarget: routine.actionTarget || "chat_thread",
      isActive: true,
    });
    setEditingRoutine(null);
    setIsRoutineModalOpen(true);
  };

  const handleSaveRoutineForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!routineForm.title.trim()) return;
    try {
      await upsertRoutineMutation.mutateAsync({
        id: routineForm.id,
        title: routineForm.title.trim(),
        triggerType: routineForm.triggerType,
        promptInstruction: routineForm.promptInstruction.trim(),
        scheduleTime: routineForm.scheduleTime,
        scheduleDays: routineForm.scheduleDays,
        actionTarget: routineForm.actionTarget,
        isActive: routineForm.isActive,
      });
      setRoutineToast({
        title: routineForm.id ? "Rotina Atualizada!" : "Rotina Criada!",
        message: `A rotina "${routineForm.title}" foi salva com sucesso.`,
        type: "success",
      });
      setTimeout(() => setRoutineToast(null), 4000);
    } catch (err: any) {
      setRoutineToast({
        title: "Erro ao Salvar",
        message: err?.message || "Não foi possível salvar a rotina.",
        type: "error",
      });
      setTimeout(() => setRoutineToast(null), 5000);
    }
  };

  const handleToggleRoutineActive = async (id: string, currentActive: boolean) => {
    try {
      await toggleRoutineMutation.mutateAsync({
        id,
        isActive: !currentActive,
      });
      setRoutineToast({
        title: !currentActive ? "Rotina Ativada" : "Rotina Pausada",
        message: !currentActive ? "A rotina executará nos horários programados." : "A rotina foi pausada e não executará automaticamente.",
        type: "success",
      });
      setTimeout(() => setRoutineToast(null), 4000);
    } catch (err: any) {
      setRoutineToast({
        title: "Erro",
        message: err?.message || "Falha ao alterar status da rotina.",
        type: "error",
      });
      setTimeout(() => setRoutineToast(null), 5000);
    }
  };

  const handleDeleteRoutine = async (id: string, title: string) => {
    if (!window.confirm(`Tem certeza que deseja excluir a rotina "${title}"?`)) return;
    try {
      await deleteRoutineMutation.mutateAsync({ id });
      setRoutineToast({
        title: "Rotina Excluída",
        message: `A rotina "${title}" foi removida.`,
        type: "success",
      });
      setTimeout(() => setRoutineToast(null), 4000);
    } catch (err: any) {
      setRoutineToast({
        title: "Erro ao Excluir",
        message: err?.message || "Não foi possível excluir a rotina.",
        type: "error",
      });
      setTimeout(() => setRoutineToast(null), 5000);
    }
  };

  const handleActivatePreset = async (preset: typeof ROUTINE_PRESETS[0]) => {
    try {
      await upsertRoutineMutation.mutateAsync({
        title: preset.title,
        triggerType: preset.triggerType,
        promptInstruction: preset.promptInstruction,
        scheduleTime: preset.scheduleTime,
        scheduleDays: preset.scheduleDays,
        actionTarget: preset.actionTarget,
        isActive: true,
      });
      setRoutineToast({
        title: "Rotina Ativada com 1 Clique!",
        message: `A rotina "${preset.title}" foi programada com sucesso para as ${preset.scheduleTime}.`,
        type: "success",
      });
      setTimeout(() => setRoutineToast(null), 4000);
    } catch (err: any) {
      setRoutineToast({
        title: "Erro",
        message: err?.message || "Não foi possível ativar o preset.",
        type: "error",
      });
      setTimeout(() => setRoutineToast(null), 5000);
    }
  };

  const handleRunRoutineNow = async (routine: any) => {
    try {
      setRunningRoutineId(routine.id);
      const result = await runRoutineMutation.mutateAsync({ id: routine.id });
      routinesQuery.refetch();
      threadsQuery.refetch();
      setLogSummaryModal({
        title: routine.title,
        date: "Executado Agora",
        status: result.status === "success" ? "Sucesso" : "Aviso",
        summary: result.outputSummary,
      });
      setRoutineToast({
        title: "Rotina Executada!",
        message: `A rotina "${routine.title}" foi concluída. Resumo salvo na thread 'Operações do Dia'.`,
        type: "success",
      });
      setTimeout(() => setRoutineToast(null), 4000);
    } catch (err: any) {
      setRoutineToast({
        title: "Falha na Execução",
        message: err?.message || "Erro ao processar rotina.",
        type: "error",
      });
      setTimeout(() => setRoutineToast(null), 5000);
    } finally {
      setRunningRoutineId(null);
    }
  };

  const isPresetActive = (triggerType: string) => {
    return routinesQuery.data?.routines?.some(
      (r: any) => r.triggerType === triggerType && r.isActive
    );
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

  const sendCustomText = useCallback(
    async (textToSend: string) => {
      const text = textToSend.trim();
      if (!text || isSendingText || isProcessingAudio) return;

      setInput("");

      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: ThreadMessage = {
        id: tempId,
        threadId: selectedThreadId || "pending-thread",
        role: "user",
        content: text,
        createdAt: new Date(),
      };

      setLocalMessages((prev) => [...prev, optimisticMsg]);
      setIsSendingText(true);
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
    },
    [ensureActiveThreadId, isProcessingAudio, isSendingText, scrollToBottom, selectedThreadId, sendMessageMutation, settingsConfig, trpcUtils]
  );

  const handleSendText = async () => {
    await sendCustomText(input);
  };

  // Processamento de Handoff Contextualizado vindo do Centro de Comando ou outras rotas
  const prefillHandledRef = useRef(false);
  useEffect(() => {
    if (prefillHandledRef.current) return;
    try {
      const raw = sessionStorage.getItem("megadesk:assistant:prefill-context");
      if (raw) {
        sessionStorage.removeItem("megadesk:assistant:prefill-context");
        prefillHandledRef.current = true;
        const parsed = JSON.parse(raw);
        if (parsed?.prompt) {
          setActiveTab("chat");
          if (parsed.autoSend) {
            void sendCustomText(parsed.prompt);
          } else {
            setInput(parsed.prompt);
            textareaRef.current?.focus();
          }
        }
      }
    } catch {}
  }, [sendCustomText]);

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
          sidebarOpen ? "w-full md:w-72 md:border-r" : "w-0 border-r-0"
        } ${
          activeTab === "chat" && selectedThreadId
            ? "hidden md:flex"
            : activeTab !== "chat"
            ? "hidden md:flex"
            : "flex"
        } transition-all duration-200 h-full flex-col flex-shrink-0 overflow-hidden ${currentTheme.sidebarBg} ${currentTheme.sidebarBorder}`}
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
      <div
        className={`h-full max-h-full flex-1 flex-col min-w-0 overflow-hidden ${currentTheme.chatBg} text-slate-100 ${
          activeTab === "chat" && !selectedThreadId ? "hidden md:flex" : "flex"
        }`}
      >
        {/* Cabeçalho Unificado com Abas Estilo Typebot */}
        <header className={`flex flex-wrap items-center justify-between gap-3 px-3 sm:px-5 py-2.5 sm:py-3 border-b ${currentTheme.headerBg} ${currentTheme.headerBorder}`}>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {selectedThreadId && (
              <button
                type="button"
                data-testid="mobile-back-to-threads"
                onClick={() => setSelectedThreadId(null)}
                className="md:hidden flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-800 bg-slate-900/90 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
                title="Voltar para lista de conversas"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Conversas</span>
              </button>
            )}

            <button
              type="button"
              data-testid="toggle-threads-sidebar"
              onClick={() => setSidebarOpen((prev) => !prev)}
              title={sidebarOpen ? "Recolher barra lateral" : "Abrir barra lateral"}
              className="hidden md:flex p-2 rounded-xl border border-slate-800 bg-slate-900/80 text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <PanelLeft className="w-4 h-4" />
            </button>

            <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl ${currentTheme.accentBg}/15 flex items-center justify-center flex-shrink-0`}>
              <Sparkles className={`w-4 h-4 sm:w-5 sm:h-5 ${currentTheme.accentText}`} />
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
            className="flex items-center gap-1 bg-slate-950/70 p-1 rounded-xl border border-slate-800/80 overflow-x-auto no-scrollbar whitespace-nowrap max-w-full"
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
              className={`flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-5 ${currentTheme.chatBg} text-slate-100`}
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
                        ? "Processando áudio multimodal..."
                        : "Digitando resposta..."}
                    </span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Barra de Composição Inferior (Texto + Microfone) */}
            <div
              data-testid="ai-composer-container"
              className={`flex-shrink-0 z-20 w-full mb-16 md:mb-0 pb-4 md:pb-5 px-4 sm:px-6 py-3 md:py-4 border-t ${currentTheme.composerBg} ${currentTheme.composerBorder}`}
            >
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
                  className="flex items-center justify-between gap-3 sm:gap-4 px-3 sm:px-4 py-2 sm:py-3 rounded-xl bg-rose-950/60 border border-rose-800/80"
                >
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    <span className="relative flex h-3.5 w-3.5 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-rose-500" />
                    </span>
                    <span className="text-xs sm:text-sm font-semibold text-rose-200 truncate">
                      Gravando comando de voz...
                    </span>
                    <span
                      data-testid="recording-timer"
                      className="font-mono text-xs sm:text-sm font-bold text-rose-300 bg-slate-900 px-2 py-0.5 rounded-md border border-rose-800 shrink-0"
                    >
                      {formatRecordingDuration(recordingSeconds)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    <button
                      type="button"
                      data-testid="cancel-audio-recording"
                      onClick={cancelAudioRecording}
                      className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Cancelar</span>
                    </button>
                    <button
                      type="button"
                      data-testid="send-audio-recording"
                      onClick={finishAndSendAudioRecording}
                      className={`flex items-center gap-1 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg ${currentTheme.accentBg} ${currentTheme.accentHoverBg} text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer`}
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Enviar</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-end gap-2 sm:gap-3">
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
                    className={`flex-1 resize-none rounded-xl border px-3 sm:px-4 py-2 sm:py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all ${
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
                    className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl border border-slate-800 bg-slate-800/80 hover:bg-rose-950/40 hover:border-rose-500/50 hover:text-rose-400 text-slate-300 flex items-center justify-center transition-all flex-shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <Mic className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>

                  {/* Botão de Envio de Texto */}
                  <button
                    type="button"
                    data-testid="send-text-message"
                    onClick={() => void handleSendText()}
                    disabled={!input.trim() || isSendingText || isProcessingAudio}
                    title="Enviar mensagem"
                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl ${currentTheme.accentBg} ${currentTheme.accentHoverBg} disabled:bg-slate-800 disabled:text-slate-600 text-white flex items-center justify-center transition-all flex-shrink-0 cursor-pointer`}
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
          <div data-testid="routines-tab-view" className="flex-1 overflow-y-auto p-8 space-y-8 max-w-5xl mx-auto w-full">
            {/* A. CABEÇALHO DO PAINEL */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <div className={`p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 ${currentTheme.accentText}`}>
                    <Zap className="w-5 h-5" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-100">Automações &amp; Rotinas do Assistente IA</h3>
                </div>
                <p className="text-sm text-slate-400">
                  Programe a IA para executar tarefas, cruzar dados e preparar o trabalho sem exigir ação humana.
                </p>
              </div>

              <Button
                type="button"
                onClick={handleOpenCreateModal}
                className="bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs px-4 py-2.5 rounded-xl shadow-sm flex items-center gap-2 shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Criar Nova Rotina</span>
              </Button>
            </div>

            {/* B. PRESETS PRONTOS (CARDS ATIVÁVEIS EM 1 CLIQUE) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <h4 className="text-sm font-semibold text-slate-200">Rotinas Prontas de Alto Valor (Presets)</h4>
                </div>
                <span className="text-[11px] text-slate-500">Ativação instantânea em 1 clique</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {ROUTINE_PRESETS.map((preset) => {
                  const active = isPresetActive(preset.triggerType);
                  return (
                    <div
                      key={preset.triggerType}
                      className={`flex flex-col justify-between rounded-2xl border p-5 transition-all ${
                        active
                          ? "border-emerald-500/40 bg-emerald-950/20 shadow-sm"
                          : "border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900/70"
                      }`}
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-800/80 text-blue-300 border border-slate-700/60">
                            🕒 {preset.scheduleTime} (Seg a Sex)
                          </span>
                          {active && (
                            <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="w-3 h-3" /> Ativo
                            </span>
                          )}
                        </div>
                        <h5 className="text-sm font-bold text-slate-100">{preset.title}</h5>
                        <p className="text-xs text-slate-400 leading-relaxed">{preset.description}</p>
                      </div>

                      <div className="pt-4 mt-2 border-t border-slate-800/60 flex items-center justify-between">
                        {active ? (
                          <span className="text-xs text-emerald-400 font-medium">Programado e Ativo</span>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleActivatePreset(preset)}
                            className="w-full bg-blue-600/90 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer"
                          >
                            Ativar com 1 Clique
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* C. LISTA DE ROTINAS CONFIGURADAS (TABELA / CARDS) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-400" />
                  <h4 className="text-sm font-semibold text-slate-200">Rotinas Configuradas</h4>
                  <span className="text-xs text-slate-500 font-mono">({routinesQuery.data?.routines?.length || 0})</span>
                </div>
                {routinesQuery.isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
              </div>

              {routinesQuery.isLoading ? (
                <div className="p-8 text-center text-xs text-slate-500 rounded-2xl border border-slate-800 bg-slate-900/30">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-400" />
                  Carregando rotinas configuradas...
                </div>
              ) : !routinesQuery.data?.routines || routinesQuery.data.routines.length === 0 ? (
                <div className="p-8 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 space-y-2">
                  <Clock className="w-8 h-8 mx-auto text-slate-600" />
                  <p className="text-sm font-semibold text-slate-300">Nenhuma rotina personalizada cadastrada ainda</p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Ative um dos presets acima com 1 clique ou clique em "+ Criar Nova Rotina" para definir agendamentos sob medida.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {routinesQuery.data.routines.map((routine: any) => {
                    const days = Array.isArray(routine.scheduleDays) ? routine.scheduleDays : [];
                    const isRunning = runningRoutineId === routine.id;

                    return (
                      <div
                        key={routine.id}
                        className={`rounded-2xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all ${
                          routine.isActive
                            ? "border-slate-800 bg-slate-900/50 hover:border-slate-700/80 hover:bg-slate-900/70"
                            : "border-slate-800/50 bg-slate-950/40 opacity-70"
                        }`}
                      >
                        <div className="space-y-2 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-slate-100">{routine.title}</span>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                routine.isActive
                                  ? "bg-emerald-950/80 text-emerald-400 border border-emerald-800/60"
                                  : "bg-slate-800 text-slate-400 border border-slate-700"
                              }`}
                            >
                              {routine.isActive ? "Ativo" : "Pausado"}
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                              🕒 {routine.scheduleTime}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-blue-950/60 text-blue-300 border border-blue-900/60">
                              Canal: {routine.actionTarget === "whatsapp" ? "WhatsApp" : routine.actionTarget === "internal_notification" ? "Notificação" : "Chat (Operações do Dia)"}
                            </span>
                          </div>

                          {/* Badges dos dias da semana */}
                          <div className="flex items-center gap-1">
                            {WEEKDAYS.map((w) => {
                              const isDaySelected = days.includes(w.key);
                              return (
                                <span
                                  key={w.key}
                                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                    isDaySelected
                                      ? "bg-blue-600/30 text-blue-200 border border-blue-500/50 font-semibold"
                                      : "bg-slate-950 text-slate-600 border border-slate-900"
                                  }`}
                                >
                                  {w.label}
                                </span>
                              );
                            })}
                            {routine.lastRunAt && (
                              <span className="text-[11px] text-slate-500 ml-2">
                                Última execução: {new Date(routine.lastRunAt).toLocaleDateString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Ações da rotina */}
                        <div className="flex flex-wrap items-center gap-2 sm:self-center shrink-0">
                          {/* Botão Executar Agora */}
                          <Button
                            type="button"
                            size="sm"
                            disabled={isRunning}
                            onClick={() => handleRunRoutineNow(routine)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            {isRunning ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Executando...</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5 fill-current" />
                                <span>▶️ Executar Agora</span>
                              </>
                            )}
                          </Button>

                          {/* Switch de Ativar/Desativar */}
                          <button
                            type="button"
                            onClick={() => handleToggleRoutineActive(routine.id, routine.isActive)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                              routine.isActive
                                ? "bg-amber-950/30 border-amber-800/60 text-amber-300 hover:bg-amber-950/60"
                                : "bg-emerald-950/30 border-emerald-800/60 text-emerald-300 hover:bg-emerald-950/60"
                            }`}
                            title={routine.isActive ? "Pausar rotina" : "Ativar rotina"}
                          >
                            {routine.isActive ? "Pausar" : "Ativar"}
                          </button>

                          {/* Editar */}
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(routine)}
                            className="p-1.5 rounded-lg border border-slate-700 bg-slate-800/60 text-slate-300 hover:text-white hover:bg-slate-700 cursor-pointer"
                            title="Editar rotina"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          {/* Duplicar */}
                          <button
                            type="button"
                            onClick={() => handleDuplicateRoutine(routine)}
                            className="p-1.5 rounded-lg border border-slate-700 bg-slate-800/60 text-slate-300 hover:text-white hover:bg-slate-700 cursor-pointer"
                            title="Duplicar rotina"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>

                          {/* Excluir */}
                          <button
                            type="button"
                            onClick={() => handleDeleteRoutine(routine.id, routine.title)}
                            className="p-1.5 rounded-lg border border-slate-800 bg-slate-900/60 text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 hover:border-rose-800/50 cursor-pointer"
                            title="Excluir rotina"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* E. HISTÓRICO DE ÚLTIMAS EXECUÇÕES */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-purple-400" />
                <h4 className="text-sm font-semibold text-slate-200">Histórico de Últimas Execuções</h4>
              </div>

              {!routinesQuery.data?.recentLogs || routinesQuery.data.recentLogs.length === 0 ? (
                <div className="p-4 text-center rounded-xl border border-slate-800 bg-slate-900/30 text-xs text-slate-500">
                  Nenhuma execução recente registrada ainda. Ao disparar uma rotina, o resumo executivo constará aqui.
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden divide-y divide-slate-800/70">
                  {routinesQuery.data.recentLogs.slice(0, 5).map((log: any) => {
                    const routine = routinesQuery.data?.routines?.find((r: any) => r.id === log.routineId);
                    const routineTitle = routine?.title || "Rotina Autônoma";

                    return (
                      <div key={log.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-800/30 transition-colors">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-200">{routineTitle}</span>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                log.status === "success"
                                  ? "bg-emerald-950/80 text-emerald-400 border border-emerald-800/60"
                                  : log.status === "warning"
                                  ? "bg-amber-950/80 text-amber-400 border border-amber-800/60"
                                  : "bg-rose-950/80 text-rose-400 border border-rose-800/60"
                              }`}
                            >
                              {log.status === "success" ? "Sucesso" : log.status === "warning" ? "Aviso" : "Erro"}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500">
                            {new Date(log.createdAt).toLocaleString("pt-BR")}
                          </p>
                        </div>

                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setLogSummaryModal({
                              title: routineTitle,
                              date: new Date(log.createdAt).toLocaleString("pt-BR"),
                              status: log.status === "success" ? "Sucesso" : "Aviso",
                              summary: log.outputSummary || "Sem resumo disponível.",
                            });
                          }}
                          className="border-slate-700 bg-slate-800/60 text-slate-200 hover:bg-slate-700 text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 shrink-0 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5 text-blue-400" />
                          <span>Visualizar Resumo</span>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
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
                    <span className="text-slate-400 text-[11px]">Grava o texto transcrito pela IA diretamente no histórico da mensagem.</span>
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

        {/* MODAL: CRIAR / EDITAR ROTINA (EDITOR AMPLO EM 2 COLUNAS SEM SCROLL INTERNO) */}
        {isRoutineModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
            <div className="relative w-full max-w-5xl flex flex-col rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden max-h-[92vh]">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
                    <Clock className="w-5 h-5" />
                  </span>
                  <div>
                    <h3 className="text-base font-bold text-slate-100">
                      {routineForm.id ? "Editar Rotina Autônoma" : "Nova Rotina Autônoma"}
                    </h3>
                    <p className="text-xs text-slate-400">Configure automações de IA para execução programada com canal de saída executivo.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsRoutineModalOpen(false)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Form Body em 2 Colunas */}
              <form onSubmit={handleSaveRoutineForm} className="flex-1 overflow-y-auto p-6 flex flex-col justify-between">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Coluna Esquerda: Configuração e Agendamento (5 cols) */}
                  <div className="lg:col-span-5 space-y-4 border-b lg:border-b-0 lg:border-r border-slate-800 pb-5 lg:pb-0 lg:pr-6">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <Sliders className="size-3.5 text-blue-400" /> Parâmetros de Agendamento
                    </h4>

                    {/* Nome da rotina */}
                    <div>
                      <label className="text-xs font-semibold text-slate-300 mb-1.5 block">Nome da Rotina</label>
                      <input
                        type="text"
                        required
                        value={routineForm.title}
                        onChange={(e) => setRoutineForm((prev) => ({ ...prev, title: e.target.value }))}
                        placeholder="Ex: 📋 Briefing Matinal: O que tenho que fazer hoje?"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500 transition"
                      />
                    </div>

                    {/* Tipo / Categoria */}
                    <div>
                      <label className="text-xs font-semibold text-slate-300 mb-1.5 block">Tipo / Categoria da Rotina</label>
                      <select
                        value={routineForm.triggerType}
                        onChange={(e) => {
                          const newType = e.target.value as any;
                          const preset = ROUTINE_PRESETS.find((p) => p.triggerType === newType);
                          setRoutineForm((prev) => ({
                            ...prev,
                            triggerType: newType,
                            title: preset?.title || prev.title,
                            promptInstruction: preset?.promptInstruction || prev.promptInstruction,
                            scheduleTime: preset?.scheduleTime || prev.scheduleTime,
                          }));
                        }}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500 transition"
                      >
                        <option value="morning_briefing">📋 Briefing Matinal (Prioridades do Dia)</option>
                        <option value="stale_leads">⏱️ Cobrança / Follow-up 48h</option>
                        <option value="chamados_audit">🎫 Auditoria de Chamados e SLA Crítico</option>
                        <option value="commercial_summary">🎯 Resumo Comercial & Vendas</option>
                        <option value="eod_summary">📊 Fechamento e Pendências do Dia</option>
                        <option value="custom">⚙️ Tarefa Personalizada (Prompt Livre)</option>
                      </select>
                    </div>

                    {/* Horário & Canal de Saída */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-slate-300 mb-1.5 block">Horário</label>
                        <input
                          type="time"
                          required
                          value={routineForm.scheduleTime}
                          onChange={(e) => setRoutineForm((prev) => ({ ...prev, scheduleTime: e.target.value }))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-slate-300 mb-1.5 block">Canal de Saída</label>
                        <select
                          value={routineForm.actionTarget}
                          onChange={(e) => setRoutineForm((prev) => ({ ...prev, actionTarget: e.target.value as any }))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                        >
                          <option value="chat_thread">💬 Copiloto (Operações)</option>
                          <option value="internal_notification">🔔 Notificação</option>
                          <option value="whatsapp">📱 WhatsApp do Gestor</option>
                        </select>
                      </div>
                    </div>

                    {/* Dias da Semana */}
                    <div>
                      <label className="text-xs font-semibold text-slate-300 mb-2 block">Dias da Semana</label>
                      <div className="flex flex-wrap gap-1.5">
                        {WEEKDAYS.map((w) => {
                          const isChecked = routineForm.scheduleDays.includes(w.key);
                          return (
                            <button
                              key={w.key}
                              type="button"
                              onClick={() => {
                                setRoutineForm((prev) => {
                                  const exists = prev.scheduleDays.includes(w.key);
                                  const newDays = exists
                                    ? prev.scheduleDays.filter((d) => d !== w.key)
                                    : [...prev.scheduleDays, w.key];
                                  return {
                                    ...prev,
                                    scheduleDays: newDays.length > 0 ? newDays : [w.key],
                                  };
                                });
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                                isChecked
                                  ? "bg-blue-600 text-white shadow-xs"
                                  : "bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200"
                              }`}
                            >
                              {w.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Toggle de Ativação */}
                    <div className="flex items-center gap-2 pt-2">
                      <input
                        type="checkbox"
                        id="routine-active-checkbox"
                        checked={routineForm.isActive}
                        onChange={(e) => setRoutineForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                        className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500 size-4 cursor-pointer"
                      />
                      <label htmlFor="routine-active-checkbox" className="text-xs text-slate-300 cursor-pointer">
                        Ativar rotina imediatamente após salvar
                      </label>
                    </div>
                  </div>

                  {/* Coluna Direita: Prompt / Instrução da IA (7 cols) */}
                  <div className="lg:col-span-7 space-y-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                          <Sparkles className="size-3.5 text-blue-400" /> Instrução / Prompt para a IA
                        </label>
                        <span className="text-[11px] font-medium text-slate-500">Auto-ajuste de altura</span>
                      </div>

                      {/* Chips de Variáveis Dinâmicas */}
                      <div className="mb-2">
                        <span className="text-[11px] text-slate-400 block mb-1">Inserir variáveis dinâmicas (clique para adicionar):</span>
                        <div className="flex flex-wrap gap-1.5">
                          {ROUTINE_VARIABLES.map((v) => (
                            <button
                              key={v.tag}
                              type="button"
                              onClick={() => {
                                setRoutineForm((prev) => ({
                                  ...prev,
                                  promptInstruction: prev.promptInstruction ? `${prev.promptInstruction} ${v.tag}` : v.tag,
                                }));
                              }}
                              className="inline-flex items-center gap-1 rounded-md bg-blue-950/70 border border-blue-800/60 px-2 py-0.5 text-[11px] font-mono text-blue-300 hover:bg-blue-900/60 hover:text-blue-200 transition cursor-pointer"
                              title={`Inserir ${v.tag}`}
                            >
                              <Plus className="size-2.5" />
                              {v.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Templates Rápidos */}
                      <div className="mb-3">
                        <span className="text-[11px] text-slate-400 block mb-1">Templates prontos com 1 clique:</span>
                        <div className="flex flex-wrap gap-1.5">
                          {QUICK_TEMPLATES.map((tmpl) => (
                            <button
                              key={tmpl.label}
                              type="button"
                              onClick={() => {
                                setRoutineForm((prev) => ({
                                  ...prev,
                                  promptInstruction: tmpl.text,
                                }));
                              }}
                              className="rounded-md bg-slate-950 border border-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:border-slate-700 hover:text-white transition cursor-pointer"
                            >
                              {tmpl.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Textarea sem rolamento interno preso */}
                      <textarea
                        required
                        value={routineForm.promptInstruction}
                        onChange={(e) => setRoutineForm((prev) => ({ ...prev, promptInstruction: e.target.value }))}
                        placeholder="Descreva exatamente o que a IA deve consultar e produzir..."
                        className="w-full min-h-[220px] bg-slate-950 border border-slate-800 rounded-2xl p-4 text-xs text-slate-100 focus:outline-none focus:border-blue-500 leading-relaxed font-sans transition"
                        style={{ height: "auto" }}
                      />
                    </div>

                    <p className="text-[11px] text-slate-500">
                      A rotina consultará automaticamente os dados do seu tenant (chamados, vendas e contatos) e enviará o relatório no canal escolhido.
                    </p>
                  </div>
                </div>

                {/* Footer com botões */}
                <div className="flex justify-end gap-3 pt-5 mt-4 border-t border-slate-800">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsRoutineModalOpen(false)}
                    className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 text-xs px-4 py-2 rounded-xl"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={upsertRoutineMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs px-6 py-2 rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    {upsertRoutineMutation.isPending ? "Salvando..." : "Salvar Rotina"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: VISUALIZAR RESUMO DE EXECUÇÃO */}
        {logSummaryModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
            <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
                <div>
                  <h3 className="text-base font-bold text-slate-100">{logSummaryModal.title}</h3>
                  <p className="text-xs text-slate-400">
                    {logSummaryModal.date} • Status: <span className="text-emerald-400 font-semibold">{logSummaryModal.status}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setLogSummaryModal(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-3 leading-relaxed text-slate-200">
                <AssistantMarkdown content={logSummaryModal.summary} />
              </div>

              <div className="flex justify-end px-6 py-3 border-t border-slate-800 bg-slate-950/70">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setLogSummaryModal(null)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-4 py-2 rounded-lg cursor-pointer"
                >
                  Fechar
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* TOAST DE FEEDBACK DE ROTINA */}
        {routineToast && (
          <div className="fixed bottom-6 right-6 z-50 flex items-start gap-3 p-4 rounded-xl border border-slate-700 bg-slate-900/95 backdrop-blur shadow-2xl max-w-md animate-in fade-in slide-in-from-bottom-3">
            {routineToast.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-400 mt-0.5 shrink-0" />
            )}
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-100">{routineToast.title}</p>
              <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">{routineToast.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setRoutineToast(null)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AIAssistant;
