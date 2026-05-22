/**
 * ConversasPage — Página de Conversas do MegaDesk
 * Filtros: Todas / Minhas / Usuário Específico
 * Abas: Abertas / Pendentes / Encerradas
 * Atualizações em tempo real via Socket.IO
 */
import React, { useState, useMemo, useCallback, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageCircle,
  Search,
  User,
  Building2,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Bot,
  UserCheck,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useConversasSocket } from "@/hooks/useConversasSocket";
import type { ConversaSocketItem } from "@/hooks/useConversasSocket";
import { validations } from "@/lib/validations";

// ─── Constantes ───────────────────────────────────────────────────────────────
const MEGADESK_SESSION_KEY = "megadesk_session_v1";

type ViewMode = "all" | "mine" | "specific";
type StatusTab = "open" | "pending" | "closed";

type ConversationItem = {
  id: string;
  customerName: string;
  customerPhone: string;
  companyName: string;
  lastMessage: string;
  lastMessageAt: Date;
  unreadCount: number;
  status: "open" | "pending" | "closed";
  assignedUserId: string | null;
  assignedUserName?: string;
  iaActive: boolean;
  lastMessageFrom?: "customer" | "agent" | "bot";
  createdAt?: string;
  syncStatus?: "synced" | "syncing" | "sync_failed";
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(date: Date | string | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function getSession() {
  try {
    const raw =
      localStorage.getItem(MEGADESK_SESSION_KEY) ??
      sessionStorage.getItem(MEGADESK_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as {
      clientId: string;
      userEmail: string;
      userName: string;
      userRole: string;
    };
  } catch {
    return null;
  }
}

// ─── Componente de Skeleton ───────────────────────────────────────────────────
function ConversationSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="space-y-1.5 flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <Skeleton className="h-3 w-full" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-24 rounded-lg" />
      </div>
    </div>
  );
}

// ─── Card de Conversa ─────────────────────────────────────────────────────────
type ConversationCardProps = {
  conv: ConversationItem;
  onClose: (id: string) => void;
  onReopen: (id: string) => void;
  onAssign: (id: string) => void;
  confirmingClose: string | null;
  setConfirmingClose: (id: string | null) => void;
  confirmingReopen: string | null;
  setConfirmingReopen: (id: string | null) => void;
};

function ConversationCard({
  conv,
  onClose,
  onReopen,
  onAssign,
  confirmingClose,
  setConfirmingClose,
  confirmingReopen,
  setConfirmingReopen,
}: ConversationCardProps) {
  const isUnread = conv.unreadCount > 0 && conv.lastMessageFrom === "customer";
  const isClosed = conv.status === "closed";

  return (
    <div
      className={[
        "bg-white rounded-xl border transition-all duration-200",
        "hover:shadow-md hover:-translate-y-0.5",
        isUnread ? "border-blue-200 shadow-sm shadow-blue-50" : "border-slate-100",
      ].join(" ")}
      style={{ animation: "fadeSlideIn 0.2s ease-out" }}
    >
      <div className="p-4">
        {/* Header do card */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={[
                  "text-sm truncate",
                  isUnread ? "font-bold text-slate-900" : "font-semibold text-slate-800",
                ].join(" ")}
              >
                {conv.customerName || "Sem nome"}
              </span>
              {conv.unreadCount > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white text-xs font-bold flex-shrink-0">
                  {conv.unreadCount > 9 ? "9+" : conv.unreadCount}
                </span>
              )}
            </div>
            <div className="space-y-0.5 mt-0.5">
              {conv.companyName && (
                <div className="flex items-center gap-1">
                  <Building2 className="w-3 h-3 text-slate-400 flex-shrink-0" />
                  <span className="text-xs text-slate-500 truncate">{conv.companyName}</span>
                </div>
              )}
              {conv.customerPhone && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-400">📱</span>
                  <span className="text-xs text-slate-500 font-mono">{validations.formatPhone(conv.customerPhone)}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {conv.syncStatus === 'syncing' && (
              <div className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">
                <div className="w-3 h-3 rounded-full border-2 border-amber-600 border-t-transparent animate-spin" />
                <span>Sincronizando...</span>
              </div>
            )}
            {conv.syncStatus === 'sync_failed' && (
              <div className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-1 rounded-lg">
                <span>⚠️ Erro na sincronização</span>
              </div>
            )}
            <span className="text-xs text-slate-400">
              {formatDate(conv.lastMessageAt)}
            </span>
          </div>
        </div>

        {/* Última mensagem */}
        <p
          className={[
            "text-xs mb-3 line-clamp-2",
            isClosed
              ? "text-slate-400 italic"
              : isUnread
              ? "text-slate-800 font-semibold"
              : "text-slate-500",
          ].join(" ")}
        >
          {isClosed ? "Conversa encerrada" : conv.lastMessage || "Sem mensagens"}
        </p>

        {/* Footer do card */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {conv.assignedUserName ? (
              <div className="flex items-center gap-1">
                <UserCheck className="w-3 h-3 text-green-500 flex-shrink-0" />
                <span className="text-xs text-slate-500 truncate max-w-[120px]">
                  {conv.assignedUserName}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <User className="w-3 h-3 text-slate-300 flex-shrink-0" />
                <span className="text-xs text-slate-400">Não atribuído</span>
              </div>
            )}
            {conv.iaActive && (
              <div className="flex items-center gap-1">
                <Bot className="w-3 h-3 text-purple-500" />
                <span className="text-xs text-purple-500">IA</span>
              </div>
            )}
          </div>

          {/* Ações */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!isClosed && (
              <button
                type="button"
                onClick={() => onAssign(conv.id)}
                className="text-xs text-slate-500 hover:text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
              >
                Atribuir
              </button>
            )}

            {/* Encerrar / Abrir com confirmação inline */}
            {!isClosed ? (
              confirmingClose === conv.id ? (
                <div className="flex items-center gap-1 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                  <span className="text-xs text-red-600 font-medium">Encerrar?</span>
                  <button
                    type="button"
                    onClick={() => {
                      onClose(conv.id);
                      setConfirmingClose(null);
                    }}
                    className="text-xs font-bold text-red-600 hover:text-red-700 px-1 transition-colors"
                  >
                    Sim
                  </button>
                  <span className="text-red-300 text-xs">|</span>
                  <button
                    type="button"
                    onClick={() => setConfirmingClose(null)}
                    className="text-xs text-slate-500 hover:text-slate-700 px-1 transition-colors"
                  >
                    Não
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingClose(conv.id)}
                  className="text-xs text-red-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors border border-transparent hover:border-red-200"
                >
                  Encerrar
                </button>
              )
            ) : confirmingReopen === conv.id ? (
              <div className="flex items-center gap-1 bg-green-50 border border-green-200 rounded-lg px-2 py-1">
                <span className="text-xs text-green-600 font-medium">Abrir?</span>
                <button
                  type="button"
                  onClick={() => {
                    onReopen(conv.id);
                    setConfirmingReopen(null);
                  }}
                  className="text-xs font-bold text-green-600 hover:text-green-700 px-1 transition-colors"
                >
                  Sim
                </button>
                <span className="text-green-300 text-xs">|</span>
                <button
                  type="button"
                  onClick={() => setConfirmingReopen(null)}
                  className="text-xs text-slate-500 hover:text-slate-700 px-1 transition-colors"
                >
                  Não
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingReopen(conv.id)}
                className="text-xs text-green-600 hover:text-green-700 px-2 py-1 rounded-lg hover:bg-green-50 transition-colors border border-transparent hover:border-green-200"
              >
                Abrir conversa
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Atribuição ──────────────────────────────────────────────────────
type AssignModalProps = {
  conversationId: string | null;
  users: Array<{ id: string; name: string; email: string; role: string }>;
  onAssign: (userId: string, userName: string) => void;
  onClose: () => void;
};

function AssignModal({ conversationId, users, onAssign, onClose }: AssignModalProps) {
  if (!conversationId) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-5"
        style={{ animation: "scaleIn 0.15s cubic-bezier(0.23, 1, 0.32, 1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-slate-800 mb-4">Atribuir conversa</h3>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {users.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">Nenhum usuário disponível</p>
          ) : (
            users.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => onAssign(u.id, u.name)}
                className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-600 font-semibold text-sm">
                    {u.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-800">{u.name}</p>
                  <p className="text-xs text-slate-400">{u.email}</p>
                </div>
              </button>
            ))
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ─── Componente Principal ─────────────────────────────────────────────────────
export function ConversasPage() {
  const session = useMemo(() => getSession(), []);
  const clientId = session?.clientId ?? null;
  const userEmail = session?.userEmail ?? null;

  // Estados de filtro
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [specificUserId, setSpecificUserId] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState<StatusTab>("open");
  const [searchTerm, setSearchTerm] = useState("");

  // Estados de ação
  const [confirmingClose, setConfirmingClose] = useState<string | null>(null);
  const [confirmingReopen, setConfirmingReopen] = useState<string | null>(null);
  const [assigningConvId, setAssigningConvId] = useState<string | null>(null);

  // Estado local das conversas (para atualizações em tempo real)
  const [localConversations, setLocalConversations] = useState<ConversationItem[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);

  // ─── Busca de usuários ──────────────────────────────────────────────────────
  const { data: usersData } = trpc.users.list.useQuery(
    { clientId: clientId ?? "" },
    { enabled: !!clientId, staleTime: 60_000 }
  );

  // Encontrar o userId do usuário logado pelo email
  const currentUserId = useMemo(() => {
    if (!userEmail || !usersData) return null;
    return usersData.find((u) => u.email === userEmail)?.id ?? null;
  }, [userEmail, usersData]);

  // Calcular o assignedUserId para o filtro
  const filterAssignedUserId = useMemo(() => {
    if (viewMode === "mine") return currentUserId;
    if (viewMode === "specific") return specificUserId;
    return null;
  }, [viewMode, currentUserId, specificUserId]);

  // ─── Query de conversas ─────────────────────────────────────────────────────
  const { data: conversationsData, isLoading, refetch } = trpc.conversations.list.useQuery(
    {
      clientId: clientId ?? "",
      viewMode,
      assignedUserId: filterAssignedUserId,
    },
    {
      enabled: !!clientId,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    }
  );

  // Sincronizar dados do servidor com estado local
  useEffect(() => {
    if (conversationsData) {
      setLocalConversations(
        conversationsData.map((c) => ({
          ...c,
          lastMessageAt:
            c.lastMessageAt instanceof Date ? c.lastMessageAt : new Date(c.lastMessageAt),
        }))
      );
      setHasLoaded(true);
    }
  }, [conversationsData]);

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const closeMutation = trpc.conversations.close.useMutation({
    onSuccess: (_, vars) => {
      setLocalConversations((prev) =>
        prev.map((c) =>
          c.id === vars.conversationId ? { ...c, status: "closed" as const } : c
        )
      );
    },
  });

  const reopenMutation = trpc.conversations.reopen.useMutation({
    onSuccess: (_, vars) => {
      setLocalConversations((prev) =>
        prev.map((c) =>
          c.id === vars.conversationId ? { ...c, status: "open" as const } : c
        )
      );
    },
  });

  const assignMutation = trpc.conversations.assign.useMutation({
    onSuccess: (_, vars) => {
      const user = usersData?.find((u) => u.id === vars.userId);
      setLocalConversations((prev) =>
        prev.map((c) =>
          c.id === vars.conversationId
            ? {
                ...c,
                assignedUserId: vars.userId,
                assignedUserName: vars.userName ?? user?.name,
              }
            : c
        )
      );
      setAssigningConvId(null);
    },
  });

  // ─── Socket.IO — atualizações em tempo real ─────────────────────────────────
  const handleConversationNew = useCallback((conv: ConversaSocketItem) => {
    setLocalConversations((prev) => {
      if (prev.some((c) => c.id === conv.id)) return prev;
      return [conv, ...prev];
    });
  }, []);

  const handleConversationClosed = useCallback((conversationId: string) => {
    setLocalConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId ? { ...c, status: "closed" as const } : c
      )
    );
  }, []);

  const handleConversationReopened = useCallback((conversationId: string) => {
    setLocalConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId ? { ...c, status: "open" as const } : c
      )
    );
  }, []);

  const handleConversationAssigned = useCallback(
    (data: { conversationId: string; assignedUserId: string; assignedUserName?: string }) => {
      setLocalConversations((prev) =>
        prev.map((c) =>
          c.id === data.conversationId
            ? {
                ...c,
                assignedUserId: data.assignedUserId,
                assignedUserName: data.assignedUserName,
              }
            : c
        )
      );
    },
    []
  );

  useConversasSocket({
    clientId,
    onConversationNew: handleConversationNew,
    onConversationClosed: handleConversationClosed,
    onConversationReopened: handleConversationReopened,
    onConversationAssigned: handleConversationAssigned,
  });

  // ─── Filtragem local ────────────────────────────────────────────────────────
  const filteredConversations = useMemo(() => {
    let list = localConversations;

    // Filtro de status (aba)
    list = list.filter((c) => c.status === statusTab);

    // Busca por texto
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (c) =>
          c.customerName?.toLowerCase().includes(term) ||
          c.companyName?.toLowerCase().includes(term) ||
          c.customerPhone?.includes(term) ||
          c.lastMessage?.toLowerCase().includes(term)
      );
    }

    // Ordenar: não lidas primeiro, depois por data
    list = [...list].sort((a, b) => {
      const aUnread = a.unreadCount > 0 && a.lastMessageFrom === "customer" ? 1 : 0;
      const bUnread = b.unreadCount > 0 && b.lastMessageFrom === "customer" ? 1 : 0;
      if (aUnread !== bUnread) return bUnread - aUnread;
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    });

    return list;
  }, [localConversations, statusTab, searchTerm]);

  // Contadores por aba
  const counts = useMemo(
    () => ({
      open: localConversations.filter((c) => c.status === "open").length,
      pending: localConversations.filter((c) => c.status === "pending").length,
      closed: localConversations.filter((c) => c.status === "closed").length,
    }),
    [localConversations]
  );

  // ─── Handlers ───────────────────────────────────────────────────────────────
  const handleClose = useCallback(
    (conversationId: string) => {
      if (!clientId) return;
      closeMutation.mutate({ conversationId, clientId });
    },
    [clientId, closeMutation]
  );

  const handleReopen = useCallback(
    (conversationId: string) => {
      if (!clientId) return;
      reopenMutation.mutate({ conversationId, clientId });
    },
    [clientId, reopenMutation]
  );

  const handleAssignConfirm = useCallback(
    (userId: string, userName: string) => {
      if (!clientId || !assigningConvId) return;
      assignMutation.mutate({ conversationId: assigningConvId, userId, userName, clientId });
    },
    [clientId, assigningConvId, assignMutation]
  );

  // ─── Render ──────────────────────────────────────────────────────────────────
  if (!clientId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500 text-sm">Sessão não encontrada. Faça login novamente.</p>
      </div>
    );
  }

  const tabConfig: Array<{ id: StatusTab; label: string; icon: React.ReactNode }> = [
    { id: "open", label: "Abertas", icon: <MessageCircle className="w-3.5 h-3.5" /> },
    { id: "pending", label: "Pendentes", icon: <Clock className="w-3.5 h-3.5" /> },
    { id: "closed", label: "Encerradas", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  ];

  return (
    <>
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>

      <div className="h-full flex flex-col bg-slate-50">
        {/* ─── Header ─────────────────────────────────────────────────────── */}
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Conversas</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {isLoading
                  ? "Carregando..."
                  : `${localConversations.length} conversa${localConversations.length !== 1 ? "s" : ""}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500 hover:text-slate-700"
              title="Atualizar"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Filtros de visualização */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1">
              {(
                [
                  { id: "all" as ViewMode, label: "Todas" },
                  { id: "mine" as ViewMode, label: "Minhas" },
                  { id: "specific" as ViewMode, label: "Específico" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setViewMode(opt.id);
                    if (opt.id !== "specific") setSpecificUserId(null);
                  }}
                  className={[
                    "px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150",
                    viewMode === opt.id
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-700",
                  ].join(" ")}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Dropdown para filtrar por atendente - SEMPRE VISÍVEL */}
            <div style={{ animation: "scaleIn 0.15s cubic-bezier(0.23, 1, 0.32, 1)" }}>
              <Select
                value={specificUserId ?? ""}
                onValueChange={(v) => {
                  if (v) {
                    setViewMode("specific");
                    setSpecificUserId(v);
                  } else {
                    setViewMode("all");
                    setSpecificUserId(null);
                  }
                }}
              >
                <SelectTrigger className="w-56 h-9 text-sm bg-white border-slate-200">
                  <SelectValue placeholder="Filtrar por Atendente..." />
                </SelectTrigger>
                <SelectContent>
                  {!usersData || usersData.length === 0 ? (
                    <SelectItem value="_none" disabled>
                      Nenhum usuário
                    </SelectItem>
                  ) : (
                    usersData.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* ─── Abas de Status ─────────────────────────────────────────────── */}
        <div className="bg-white border-b border-slate-200 px-6 flex-shrink-0">
          <div className="flex gap-0">
            {tabConfig.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusTab(tab.id)}
                className={[
                  "flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-all duration-150",
                  statusTab === tab.id
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300",
                ].join(" ")}
              >
                {tab.icon}
                {tab.label}
                <span
                  className={[
                    "ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-xs font-bold px-1",
                    statusTab === tab.id
                      ? "bg-blue-100 text-blue-600"
                      : "bg-slate-100 text-slate-500",
                  ].join(" ")}
                >
                  {counts[tab.id]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ─── Busca ──────────────────────────────────────────────────────── */}
        <div className="px-6 py-3 bg-white border-b border-slate-100 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Buscar por nome, empresa, telefone ou mensagem..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-sm bg-slate-50 border-slate-200 focus:bg-white transition-colors"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <XCircle className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* ─── Lista de Conversas ──────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading && !hasLoaded ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <ConversationSkeleton key={i} />
              ))}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                <MessageCircle className="w-8 h-8 text-slate-300" />
              </div>
              <p className="text-slate-500 font-medium">
                {searchTerm
                  ? "Nenhuma conversa encontrada para esta busca"
                  : statusTab === "open"
                  ? "Nenhuma conversa aberta"
                  : statusTab === "pending"
                  ? "Nenhuma conversa pendente"
                  : "Nenhuma conversa encerrada"}
              </p>
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="mt-2 text-sm text-blue-500 hover:text-blue-600 transition-colors"
                >
                  Limpar busca
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredConversations.map((conv, index) => (
                <div
                  key={conv.id}
                  style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
                >
                  <ConversationCard
                    conv={conv}
                    onClose={handleClose}
                    onReopen={handleReopen}
                    onAssign={(id) => setAssigningConvId(id)}
                    confirmingClose={confirmingClose}
                    setConfirmingClose={setConfirmingClose}
                    confirmingReopen={confirmingReopen}
                    setConfirmingReopen={setConfirmingReopen}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Modal de Atribuição ─────────────────────────────────────────── */}
      <AssignModal
        conversationId={assigningConvId}
        users={
          usersData?.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
          })) ?? []
        }
        onAssign={handleAssignConfirm}
        onClose={() => setAssigningConvId(null)}
      />
    </>
  );
}
