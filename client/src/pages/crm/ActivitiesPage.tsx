import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { CrmWhatsAppIntent } from "../../../../shared/crm";
import type {
  ActivityView,
  ActivityType,
  ActivityStatus,
} from "../../../../server/modules/crm/opportunities/contracts";
import {
  CalendarCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Plus,
  Search,
  Filter,
  Phone,
  Video,
  ListChecks,
  FileText,
  Trash2,
  Edit2,
  Calendar,
  Building2,
  Target,
  ArrowRight,
  RefreshCw,
  MessageSquare,
  User,
  CheckSquare,
  Square,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface ActivitiesPageProps {
  onNavigate?: (section: any) => void;
  onClientNavigate?: (intent: CrmWhatsAppIntent) => void;
  whatsappConnected?: boolean;
  canStartConversation?: boolean;
}

const TYPE_CONFIG: Record<
  ActivityType,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  task: {
    label: "Tarefa",
    icon: CheckSquare,
    color: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800",
  },
  call: {
    label: "Ligação",
    icon: Phone,
    color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800",
  },
  meeting: {
    label: "Reunião",
    icon: Video,
    color: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800",
  },
  followup: {
    label: "Follow-up",
    icon: Clock,
    color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800",
  },
  note: {
    label: "Nota",
    icon: FileText,
    color: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-800",
  },
};

type FilterStatus = "all" | "pending" | "overdue" | "today" | "completed";

export function ActivitiesPage({
  onNavigate,
  onClientNavigate,
  whatsappConnected,
  canStartConversation,
}: ActivitiesPageProps) {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("pending");
  const [filterType, setFilterType] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grouped">("list");

  // Modals
  const [modalOpen, setModalOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<ActivityView | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [activityToDelete, setActivityToDelete] = useState<ActivityView | null>(null);

  // Form State
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formType, setFormType] = useState<ActivityType>("task");
  const [formDueAt, setFormDueAt] = useState("");
  const [formAssignedTo, setFormAssignedTo] = useState("");
  const [formCrmClientId, setFormCrmClientId] = useState("");
  const [formOpportunityPublicId, setFormOpportunityPublicId] = useState("");

  const utils = trpc.useUtils();

  // Queries
  const { data, isLoading, refetch, isFetching } = trpc.crm.opportunities.listActivities.useQuery(
    {
      search: search.trim() || undefined,
      type: filterType !== "all" ? (filterType as ActivityType) : undefined,
    },
    { refetchOnWindowFocus: false }
  );

  const { data: clientsData } = trpc.crm.list.useQuery(
    { lifecycle: "active" },
    { staleTime: 60_000 }
  );

  const { data: opportunitiesData } = trpc.crm.opportunities.list.useQuery(
    { status: "open" },
    { staleTime: 60_000 }
  );

  const activities = useMemo(() => data?.activities || [], [data]);
  const clients = useMemo(() => (clientsData?.clients || []) as any[], [clientsData]);
  const opportunities = useMemo(() => opportunitiesData?.opportunities || [], [opportunitiesData]);

  // Mutations
  const createMutation = trpc.crm.opportunities.createActivity.useMutation({
    onSuccess: () => {
      toast.success("Atividade criada com sucesso!");
      utils.crm.opportunities.listActivities.invalidate();
      closeModal();
    },
    onError: err => {
      toast.error(err.message || "Erro ao criar atividade.");
    },
  });

  const updateMutation = trpc.crm.opportunities.updateActivity.useMutation({
    onSuccess: () => {
      toast.success("Atividade atualizada!");
      utils.crm.opportunities.listActivities.invalidate();
      closeModal();
    },
    onError: err => {
      toast.error(err.message || "Erro ao atualizar atividade.");
    },
  });

  const deleteMutation = trpc.crm.opportunities.deleteActivity.useMutation({
    onSuccess: () => {
      toast.success("Atividade excluída!");
      utils.crm.opportunities.listActivities.invalidate();
      setDeleteConfirmOpen(false);
      setActivityToDelete(null);
    },
    onError: err => {
      toast.error(err.message || "Erro ao excluir atividade.");
    },
  });

  // Calculate Metrics
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const metrics = useMemo(() => {
    let pending = 0;
    let overdue = 0;
    let today = 0;
    let completed = 0;

    for (const a of activities) {
      if (a.status === "completed") {
        completed++;
      } else {
        pending++;
        if (a.dueAt) {
          const dueDate = new Date(a.dueAt);
          if (dueDate < startOfToday) {
            overdue++;
          } else if (dueDate <= endOfToday) {
            today++;
          }
        }
      }
    }

    return {
      total: activities.length,
      pending,
      overdue,
      today,
      completed,
    };
  }, [activities, startOfToday, endOfToday]);

  // Filtered Activities
  const filteredActivities = useMemo(() => {
    return activities.filter(a => {
      if (filterStatus === "all") return true;
      if (filterStatus === "completed") return a.status === "completed";
      if (a.status === "completed") return false;

      if (filterStatus === "pending") return true;

      if (!a.dueAt) return false;
      const dueDate = new Date(a.dueAt);

      if (filterStatus === "overdue") {
        return dueDate < startOfToday;
      }
      if (filterStatus === "today") {
        return dueDate >= startOfToday && dueDate <= endOfToday;
      }

      return true;
    });
  }, [activities, filterStatus, startOfToday, endOfToday]);

  // Quick Toggle Completed
  const handleToggleComplete = async (activity: ActivityView) => {
    const nextStatus: ActivityStatus = activity.status === "completed" ? "pending" : "completed";
    try {
      await updateMutation.mutateAsync({
        activityPublicId: activity.publicId,
        status: nextStatus,
      });
      toast.success(
        nextStatus === "completed" ? "Atividade marcada como concluída!" : "Atividade reaberta!"
      );
    } catch {
      // error handled by mutation
    }
  };

  // Open Create / Edit Modal
  const openCreateModal = () => {
    setEditingActivity(null);
    setFormTitle("");
    setFormDescription("");
    setFormType("task");
    setFormDueAt(new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 16));
    setFormAssignedTo("");
    setFormCrmClientId("");
    setFormOpportunityPublicId("");
    setModalOpen(true);
  };

  const openEditModal = (activity: ActivityView) => {
    setEditingActivity(activity);
    setFormTitle(activity.title);
    setFormDescription(activity.description || "");
    setFormType(activity.type);
    setFormDueAt(activity.dueAt ? new Date(activity.dueAt).toISOString().slice(0, 16) : "");
    setFormAssignedTo(activity.assignedTo || "");
    setFormCrmClientId(activity.crmClientId || "");
    setFormOpportunityPublicId(activity.opportunityPublicId || "");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingActivity(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      toast.error("O título da atividade é obrigatório.");
      return;
    }
    if (!formOpportunityPublicId && !formCrmClientId) {
      toast.error("Vincule a atividade a pelo menos uma oportunidade ou cliente.");
      return;
    }

    let isoDueAt: string | null = null;
    if (formDueAt && formDueAt.trim()) {
      const d = new Date(formDueAt.trim());
      if (!isNaN(d.getTime())) {
        isoDueAt = d.toISOString();
      }
    }

    if (editingActivity) {
      updateMutation.mutate({
        activityPublicId: editingActivity.publicId,
        title: formTitle.trim(),
        description: formDescription.trim() || null,
        dueAt: isoDueAt,
        assignedTo: formAssignedTo.trim(),
      });
    } else {
      createMutation.mutate({
        title: formTitle.trim(),
        description: formDescription.trim() || null,
        type: formType,
        dueAt: isoDueAt,
        assignedTo: formAssignedTo.trim(),
        crmClientId: formCrmClientId.trim() || null,
        opportunityPublicId: formOpportunityPublicId.trim() || null,
      });
    }
  };

  // Format Due Date Label
  const formatDueLabel = (dueAt: string | null, status: ActivityStatus) => {
    if (!dueAt) return { label: "Sem prazo", color: "text-slate-400" };
    const date = new Date(dueAt);
    if (status === "completed") {
      return {
        label: `Concluída (${date.toLocaleDateString("pt-BR")})`,
        color: "text-emerald-600 dark:text-emerald-400 font-medium",
      };
    }
    if (date < startOfToday) {
      const days = Math.round((startOfToday.getTime() - date.getTime()) / (1000 * 3600 * 24));
      return {
        label: `Atrasada há ${days === 0 ? "1" : days} dia(s)`,
        color: "text-rose-600 dark:text-rose-400 font-semibold",
      };
    }
    if (date <= endOfToday) {
      return {
        label: `Hoje às ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
        color: "text-amber-600 dark:text-amber-400 font-semibold",
      };
    }
    return {
      label: date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
      color: "text-slate-600 dark:text-slate-300",
    };
  };

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarCheck className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Atividades & Tarefas Comerciais
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Organize follow-ups, tarefas, reuniões e histórico de contatos com compradores.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button size="sm" onClick={openCreateModal} className="gap-2 bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4" />
            Nova Atividade
          </Button>
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <button
          type="button"
          onClick={() => setFilterStatus("all")}
          className={`flex flex-col p-4 rounded-xl border text-left transition-all ${
            filterStatus === "all"
              ? "bg-indigo-50/50 border-indigo-400 ring-2 ring-indigo-400/20 dark:bg-indigo-950/20 dark:border-indigo-600"
              : "bg-white border-slate-200 hover:border-slate-300 dark:bg-slate-900 dark:border-slate-800"
          }`}
        >
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total</span>
          <span className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{metrics.total}</span>
        </button>

        <button
          type="button"
          onClick={() => setFilterStatus("pending")}
          className={`flex flex-col p-4 rounded-xl border text-left transition-all ${
            filterStatus === "pending"
              ? "bg-blue-50/50 border-blue-400 ring-2 ring-blue-400/20 dark:bg-blue-950/20 dark:border-blue-600"
              : "bg-white border-slate-200 hover:border-slate-300 dark:bg-slate-900 dark:border-slate-800"
          }`}
        >
          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Em Aberto</span>
          <span className="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-1">{metrics.pending}</span>
        </button>

        <button
          type="button"
          onClick={() => setFilterStatus("overdue")}
          className={`flex flex-col p-4 rounded-xl border text-left transition-all ${
            filterStatus === "overdue"
              ? "bg-rose-50/50 border-rose-400 ring-2 ring-rose-400/20 dark:bg-rose-950/20 dark:border-rose-600"
              : "bg-white border-slate-200 hover:border-slate-300 dark:bg-slate-900 dark:border-slate-800"
          }`}
        >
          <span className="text-xs font-medium text-rose-600 dark:text-rose-400 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Atrasadas
          </span>
          <span className="text-2xl font-bold text-rose-700 dark:text-rose-400 mt-1">{metrics.overdue}</span>
        </button>

        <button
          type="button"
          onClick={() => setFilterStatus("today")}
          className={`flex flex-col p-4 rounded-xl border text-left transition-all ${
            filterStatus === "today"
              ? "bg-amber-50/50 border-amber-400 ring-2 ring-amber-400/20 dark:bg-amber-950/20 dark:border-amber-600"
              : "bg-white border-slate-200 hover:border-slate-300 dark:bg-slate-900 dark:border-slate-800"
          }`}
        >
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> Para Hoje
          </span>
          <span className="text-2xl font-bold text-amber-700 dark:text-amber-400 mt-1">{metrics.today}</span>
        </button>

        <button
          type="button"
          onClick={() => setFilterStatus("completed")}
          className={`flex flex-col p-4 rounded-xl border text-left transition-all ${
            filterStatus === "completed"
              ? "bg-emerald-50/50 border-emerald-400 ring-2 ring-emerald-400/20 dark:bg-emerald-950/20 dark:border-emerald-600"
              : "bg-white border-slate-200 hover:border-slate-300 dark:bg-slate-900 dark:border-slate-800"
          }`}
        >
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Concluídas
          </span>
          <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 mt-1">{metrics.completed}</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por título, oportunidade ou cliente..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
            />
          </div>

          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 bg-slate-50 dark:bg-slate-800/60 dark:text-white font-medium"
          >
            <option value="all">Todos os tipos</option>
            <option value="task">Tarefas</option>
            <option value="call">Ligações</option>
            <option value="meeting">Reuniões</option>
            <option value="followup">Follow-ups</option>
            <option value="note">Notas</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                viewMode === "list"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400"
              }`}
            >
              Lista
            </button>
            <button
              type="button"
              onClick={() => setViewMode("grouped")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                viewMode === "grouped"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400"
              }`}
            >
              Por Prazo
            </button>
          </div>
        </div>
      </div>

      {/* Activities Content */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
          <p className="text-sm text-slate-500">Carregando atividades comerciais...</p>
        </div>
      ) : filteredActivities.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-12 text-center bg-white/50 dark:bg-slate-900/50">
          <CalendarCheck className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Nenhuma atividade encontrada
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1">
            Não há tarefas registradas com os filtros atuais. Crie uma nova atividade para começar.
          </p>
          <Button onClick={openCreateModal} className="mt-4 gap-2 bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4" /> Criar Primeira Atividade
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredActivities.map(activity => {
            const typeConf = TYPE_CONFIG[activity.type] || TYPE_CONFIG.task;
            const TypeIcon = typeConf.icon;
            const dueMeta = formatDueLabel(activity.dueAt, activity.status);
            const isCompleted = activity.status === "completed";

            return (
              <div
                key={activity.publicId}
                className={`group flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl border transition-all ${
                  isCompleted
                    ? "bg-slate-50/70 border-slate-200 opacity-75 dark:bg-slate-900/40 dark:border-slate-800/60"
                    : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm dark:bg-slate-900 dark:border-slate-800 dark:hover:border-slate-700"
                }`}
              >
                {/* Left: Checkbox + Type Icon + Info */}
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={() => handleToggleComplete(activity)}
                    className="mt-0.5 text-slate-400 hover:text-indigo-600 transition-colors"
                    title={isCompleted ? "Reabrir atividade" : "Concluir atividade"}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Square className="w-5 h-5 hover:text-indigo-600" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-md border ${typeConf.color}`}
                      >
                        <TypeIcon className="w-3 h-3" />
                        {typeConf.label}
                      </span>

                      <h4
                        className={`text-sm font-semibold truncate ${
                          isCompleted
                            ? "line-through text-slate-400 dark:text-slate-500"
                            : "text-slate-900 dark:text-white"
                        }`}
                      >
                        {activity.title}
                      </h4>
                    </div>

                    {activity.description && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                        {activity.description}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                      {/* Linked Opportunity */}
                      {activity.opportunityTitle && (
                        <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-medium">
                          <Target className="w-3.5 h-3.5" />
                          {activity.opportunityTitle}
                        </span>
                      )}

                      {/* Linked Client */}
                      {activity.clientName && (
                        <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
                          <Building2 className="w-3.5 h-3.5 text-slate-400" />
                          {activity.clientName}
                        </span>
                      )}

                      {/* Assigned to */}
                      {activity.assignedTo && (
                        <span className="flex items-center gap-1 text-slate-500">
                          <User className="w-3 h-3" />
                          {activity.assignedTo}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Due Date & Actions */}
                <div className="mt-3 sm:mt-0 flex items-center gap-3 self-end sm:self-center">
                  <span className={`text-xs flex items-center gap-1 ${dueMeta.color}`}>
                    <Clock className="w-3.5 h-3.5" />
                    {dueMeta.label}
                  </span>

                  <div className="flex items-center gap-1 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditModal(activity)}
                      className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                      title="Editar"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setActivityToDelete(activity);
                        setDeleteConfirmOpen(true);
                      }}
                      className="h-8 w-8 p-0 text-slate-500 hover:text-rose-600"
                      title="Excluir"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Create / Edit Activity */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>
                {editingActivity ? "Editar Atividade" : "Nova Atividade Comercial"}
              </DialogTitle>
              <DialogDescription>
                Defina o tipo, prazo e os vínculos comerciais para manter o histórico alinhado.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Type Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Tipo de Atividade
                </label>
                <div className="grid grid-cols-5 gap-1.5">
                  {(Object.keys(TYPE_CONFIG) as ActivityType[]).map(typeKey => {
                    const cfg = TYPE_CONFIG[typeKey];
                    const Icon = cfg.icon;
                    const selected = formType === typeKey;
                    return (
                      <button
                        type="button"
                        key={typeKey}
                        onClick={() => setFormType(typeKey)}
                        className={`flex flex-col items-center justify-center p-2 rounded-lg border text-xs font-medium transition-all ${
                          selected
                            ? "bg-indigo-50 border-indigo-500 text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-500 dark:text-indigo-300 ring-2 ring-indigo-500/20"
                            : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                        }`}
                      >
                        <Icon className="w-4 h-4 mb-1" />
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Título da Atividade *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Ligar para confirmar proposta, Alinhar requisitos técnicos..."
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                />
              </div>

              {/* Linked Client & Opportunity */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Cliente / Lead
                  </label>
                  <select
                    value={formCrmClientId}
                    onChange={e => setFormCrmClientId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                  >
                    <option value="">Selecione um cliente...</option>
                    {clients.map(c => (
                      <option key={c.crmClientId} value={c.crmClientId}>
                        {c.companyName} {c.status === "lead" ? "(Lead)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Oportunidade (Funil)
                  </label>
                  <select
                    value={formOpportunityPublicId}
                    onChange={e => setFormOpportunityPublicId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                  >
                    <option value="">Selecione uma oportunidade...</option>
                    {opportunities.map(o => (
                      <option key={o.publicId} value={o.publicId}>
                        {o.title} {o.companyName ? `(${o.companyName})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Due Date & Assignee */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Data e Hora de Prazo
                  </label>
                  <input
                    type="datetime-local"
                    value={formDueAt}
                    onChange={e => setFormDueAt(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Responsável
                  </label>
                  <input
                    type="text"
                    placeholder="Nome do operador..."
                    value={formAssignedTo}
                    onChange={e => setFormAssignedTo(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Notas / Detalhes
                </label>
                <textarea
                  rows={3}
                  placeholder="Informações adicionais, tópicos da pauta, pontos combinados..."
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                {editingActivity ? "Salvar Alterações" : "Criar Atividade"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir Atividade</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir permanentemente a atividade{" "}
              <strong>"{activityToDelete?.title}"</strong>? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteConfirmOpen(false);
                setActivityToDelete(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (activityToDelete) {
                  deleteMutation.mutate({ activityPublicId: activityToDelete.publicId });
                }
              }}
            >
              {deleteMutation.isPending ? (
                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Excluir Definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
