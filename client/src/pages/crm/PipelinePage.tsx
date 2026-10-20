import React, { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { CrmWhatsAppIntent } from "../../../../shared/crm";
import type {
  OpportunityView,
  OpportunityStatus,
  ActivityType,
} from "../../../../server/modules/crm/opportunities/contracts";
import type {
  PipelineView,
  StageView,
} from "../../../../server/modules/crm/pipeline/contracts";
import {
  Target,
  Plus,
  Search,
  Filter,
  DollarSign,
  Calendar,
  User,
  Building2,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  TrendingUp,
  RotateCcw,
  RefreshCw,
  Kanban,
  Table as TableIcon,
  MessageSquare,
  History,
  CheckSquare,
  PhoneCall,
  Users,
  FileText,
  AlertCircle,
  ChevronRight,
  Sparkles,
  ExternalLink,
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

interface PipelinePageProps {
  onNavigate?: (section: any) => void;
  onClientNavigate?: (intent: CrmWhatsAppIntent) => void;
  whatsappConnected?: boolean;
  canStartConversation?: boolean;
}

function formatCentsToBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function parseBrlToCents(val: string): number {
  if (!val) return 0;
  const trimmed = val.replace(/[^\d,\.]/g, "");
  if (!trimmed) return 0;
  let normalized = trimmed;
  if (trimmed.includes(",")) {
    normalized = trimmed.replace(/\./g, "").replace(",", ".");
  }
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : Math.round(num * 100);
}

export function PipelinePage({
  onNavigate,
  onClientNavigate,
  whatsappConnected,
  canStartConversation,
}: PipelinePageProps) {
  const utils = trpc.useUtils();

  // View mode: Kanban vs Table
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"open" | "won" | "lost" | "all">("all");
  const [responsibleFilter, setResponsibleFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isLossModalOpen, setIsLossModalOpen] = useState(false);
  const [selectedOpportunity, setSelectedOpportunity] = useState<OpportunityView | null>(null);
  const [targetLossStageId, setTargetLossStageId] = useState<string | null>(null);
  const [lossReasonInput, setLossReasonInput] = useState("");

  // Create Form State
  const [formTitle, setFormTitle] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formStageId, setFormStageId] = useState("");
  const [formCrmClientId, setFormCrmClientId] = useState("");
  const [formConvertLead, setFormConvertLead] = useState(false);
  const [formResponsible, setFormInternalResponsible] = useState("");
  const [formExpectedCloseDate, setFormExpectedCloseDate] = useState("");
  const [formObservations, setFormObservations] = useState("");

  // Activity Form State inside Detail
  const [activityType, setActivityType] = useState<ActivityType>("task");
  const [activityTitle, setActivityTitle] = useState("");
  const [activityDescription, setActivityDescription] = useState("");
  const [activityDueAt, setActivityDueAt] = useState("");
  const [activityAssignedTo, setActivityAssignedTo] = useState("");

  // Detail Active Tab
  const [detailTab, setDetailTab] = useState<"details" | "activities" | "history">("details");

  // Queries
  const defaultPipelineQuery = trpc.crm.pipelines.getDefault.useQuery();
  const pipelinesListQuery = trpc.crm.pipelines.list.useQuery();

  const activePipeline: PipelineView | undefined = useMemo(() => {
    if (selectedPipelineId && pipelinesListQuery.data?.pipelines) {
      const found = pipelinesListQuery.data.pipelines.find(p => p.publicId === selectedPipelineId);
      if (found) return found;
    }
    return defaultPipelineQuery.data?.pipeline;
  }, [selectedPipelineId, pipelinesListQuery.data, defaultPipelineQuery.data]);

  const effectivePipelineId = activePipeline?.publicId;

  const metricsQuery = trpc.crm.opportunities.metrics.useQuery(
    effectivePipelineId
      ? {
          pipelinePublicId: effectivePipelineId,
          internalResponsible: responsibleFilter || undefined,
          search: searchTerm || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        }
      : undefined,
    { enabled: !!effectivePipelineId }
  );

  const opportunitiesQuery = trpc.crm.opportunities.list.useQuery(
    {
      pipelinePublicId: effectivePipelineId,
      status: statusFilter,
      internalResponsible: responsibleFilter || undefined,
      search: searchTerm || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      pageSize: 150,
    },
    { enabled: !!effectivePipelineId }
  );

  // Clients list query for dropdown association
  const clientsQuery = trpc.crm.list.useQuery(
    { lifecycle: "active" },
    { staleTime: 60000 }
  );
  const leadsQuery = trpc.crm.leads.list.useQuery(
    { status: "lead", pageSize: 100 },
    { staleTime: 60000 }
  );

  // Queries for details modal
  const historyQuery = trpc.crm.opportunities.history.useQuery(
    { opportunityPublicId: selectedOpportunity?.publicId || "" },
    { enabled: !!selectedOpportunity && isDetailOpen }
  );

  const activitiesQuery = trpc.crm.opportunities.listActivities.useQuery(
    { opportunityPublicId: selectedOpportunity?.publicId || "" },
    { enabled: !!selectedOpportunity && isDetailOpen }
  );

  // Mutations
  const createOpportunityMutation = trpc.crm.opportunities.create.useMutation({
    onSuccess: () => {
      toast.success("Oportunidade cadastrada com sucesso!");
      setIsCreateOpen(false);
      resetCreateForm();
      utils.crm.opportunities.list.invalidate();
      utils.crm.opportunities.metrics.invalidate();
      utils.crm.leads.list.invalidate();
    },
    onError: error => {
      toast.error(error.message || "Erro ao cadastrar oportunidade.");
    },
  });

  const transitionStageMutation = trpc.crm.opportunities.transitionStage.useMutation({
    onSuccess: data => {
      toast.success(`Estágio atualizado: "${data.opportunity.title}"`);
      utils.crm.opportunities.list.invalidate();
      utils.crm.opportunities.metrics.invalidate();
      if (selectedOpportunity && selectedOpportunity.publicId === data.opportunity.publicId) {
        setSelectedOpportunity(data.opportunity);
        utils.crm.opportunities.history.invalidate();
      }
    },
    onError: error => {
      toast.error(error.message || "Erro ao mover oportunidade de estágio.");
    },
  });

  const updateOpportunityMutation = trpc.crm.opportunities.update.useMutation({
    onSuccess: data => {
      toast.success("Oportunidade atualizada com sucesso!");
      utils.crm.opportunities.list.invalidate();
      utils.crm.opportunities.metrics.invalidate();
      if (selectedOpportunity && selectedOpportunity.publicId === data.opportunity.publicId) {
        setSelectedOpportunity(data.opportunity);
        utils.crm.opportunities.history.invalidate();
      }
    },
    onError: error => {
      toast.error(error.message || "Erro ao atualizar oportunidade.");
    },
  });

  const createActivityMutation = trpc.crm.opportunities.createActivity.useMutation({
    onSuccess: () => {
      toast.success("Atividade comercial registrada!");
      setActivityTitle("");
      setActivityDescription("");
      setActivityDueAt("");
      setActivityAssignedTo("");
      utils.crm.opportunities.listActivities.invalidate();
    },
    onError: error => {
      toast.error(error.message || "Erro ao registrar atividade.");
    },
  });

  const updateActivityMutation = trpc.crm.opportunities.updateActivity.useMutation({
    onSuccess: () => {
      toast.success("Atividade concluída com sucesso!");
      utils.crm.opportunities.listActivities.invalidate();
    },
    onError: error => {
      toast.error(error.message || "Erro ao atualizar status da atividade.");
    },
  });

  // Helpers
  const resetCreateForm = () => {
    setFormTitle("");
    setFormValue("");
    setFormStageId(activePipeline?.stages?.[0]?.publicId || "");
    setFormCrmClientId("");
    setFormConvertLead(false);
    setFormInternalResponsible("");
    setFormExpectedCloseDate("");
    setFormObservations("");
  };

  const handleOpenCreateModal = (defaultStageId?: string, defaultClientId?: string) => {
    resetCreateForm();
    if (defaultStageId) setFormStageId(defaultStageId);
    if (defaultClientId) setFormCrmClientId(defaultClientId);
    setIsCreateOpen(true);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      toast.error("Informe o título da oportunidade.");
      return;
    }
    if (!effectivePipelineId || !formStageId) {
      toast.error("Selecione o estágio do funil.");
      return;
    }

    createOpportunityMutation.mutate({
      pipelinePublicId: effectivePipelineId,
      stagePublicId: formStageId,
      crmClientId: formCrmClientId || null,
      convertLead: formConvertLead,
      title: formTitle.trim(),
      valueCents: parseBrlToCents(formValue),
      currency: "BRL",
      expectedCloseDate: formExpectedCloseDate || null,
      internalResponsible: formResponsible.trim(),
      observations: formObservations.trim() || null,
    });
  };

  const handleStageTransition = (
    opportunity: OpportunityView,
    toStagePublicId: string
  ) => {
    const targetStage = activePipeline?.stages?.find(s => s.publicId === toStagePublicId);
    if (!targetStage) return;

    // A mudança de estágio NÃO deduz estado comercial pela probabilidade (0%, 50%, 100%).
    // Transiciona o estágio preservando ou restaurando o estado aberto ("open") se estava encerrada.
    transitionStageMutation.mutate({
      opportunityPublicId: opportunity.publicId,
      toStagePublicId,
      status: "open",
    });
  };

  const handleConfirmLoss = () => {
    if (!selectedOpportunity) return;
    if (!lossReasonInput.trim()) {
      toast.error("Informe o motivo de perda da oportunidade.");
      return;
    }

    if (targetLossStageId) {
      transitionStageMutation.mutate({
        opportunityPublicId: selectedOpportunity.publicId,
        toStagePublicId: targetLossStageId,
        status: "lost",
        lossReason: lossReasonInput.trim(),
        notes: `Perda: ${lossReasonInput.trim()}`,
      });
    } else {
      updateOpportunityMutation.mutate({
        opportunityPublicId: selectedOpportunity.publicId,
        status: "lost",
        lossReason: lossReasonInput.trim(),
      });
    }

    setIsLossModalOpen(false);
    setTargetLossStageId(null);
  };

  const handleDragStart = (e: React.DragEvent, opp: OpportunityView) => {
    e.dataTransfer.setData("application/json", JSON.stringify(opp));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDropOnStage = (e: React.DragEvent, stagePublicId: string) => {
    e.preventDefault();
    try {
      const dataStr = e.dataTransfer.getData("application/json");
      if (!dataStr) return;
      const opp = JSON.parse(dataStr) as OpportunityView;
      if (opp.stagePublicId !== stagePublicId) {
        handleStageTransition(opp, stagePublicId);
      }
    } catch (err) {
      console.error("Drop error:", err);
    }
  };

  // Group opportunities by stage
  const stages = activePipeline?.stages || [];
  const opportunities = opportunitiesQuery.data?.opportunities || [];

  const opportunitiesByStage = useMemo(() => {
    const map = new Map<string, OpportunityView[]>();
    for (const stage of stages) {
      map.set(stage.publicId, []);
    }
    for (const opp of opportunities) {
      const list = map.get(opp.stagePublicId);
      if (list) {
        list.push(opp);
      }
    }
    return map;
  }, [stages, opportunities]);

  const metrics = metricsQuery.data || {
    openCount: 0,
    openValueCents: 0,
    wonCount: 0,
    wonValueCents: 0,
    lostCount: 0,
    lostValueCents: 0,
    totalCount: 0,
    totalValueCents: 0,
  };

  const conversionRate = useMemo(() => {
    const closed = metrics.wonCount + metrics.lostCount;
    if (closed === 0) return 0;
    return Math.round((metrics.wonCount / closed) * 100);
  }, [metrics]);

  const allClientsAndLeads = useMemo(() => {
    const clientList = Array.isArray(clientsQuery.data?.clients)
      ? clientsQuery.data.clients
      : [];
    const clients = clientList.map((c: any) => ({
      crmClientId: String(c.crmClientId || c.crm_client_id || ""),
      name: String(c.companyName || c.company_name || "Cliente"),
      isLead: false,
    }));
    const leads = (leadsQuery.data?.leads || []).map(l => ({
      crmClientId: l.crmClientId,
      name: `${l.companyName} (Lead)`,
      isLead: true,
    }));
    return [...leads, ...clients];
  }, [clientsQuery.data, leadsQuery.data]);

  const isLoading = defaultPipelineQuery.isLoading || opportunitiesQuery.isLoading;

  return (
    <div className="space-y-6 p-6" data-testid="pipeline-page">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Funil de Vendas Comercial
            </h1>
            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-400">
              Kanban
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {activePipeline?.name || "Pipeline Padrão"} — Gestão visual e conversão de negócios.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            <Button
              size="sm"
              variant={viewMode === "kanban" ? "secondary" : "ghost"}
              onClick={() => setViewMode("kanban")}
              className="h-8 gap-1.5 px-3 text-xs"
            >
              <Kanban className="h-3.5 w-3.5" />
              Kanban
            </Button>
            <Button
              size="sm"
              variant={viewMode === "table" ? "secondary" : "ghost"}
              onClick={() => setViewMode("table")}
              className="h-8 gap-1.5 px-3 text-xs"
            >
              <TableIcon className="h-3.5 w-3.5" />
              Tabela
            </Button>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              opportunitiesQuery.refetch();
              metricsQuery.refetch();
            }}
            disabled={opportunitiesQuery.isRefetching}
            className="h-9 gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${opportunitiesQuery.isRefetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>

          <Button
            size="sm"
            onClick={() => handleOpenCreateModal()}
            className="h-9 gap-1.5 bg-blue-600 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Nova Oportunidade
          </Button>
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
        <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
          <div className="flex items-center justify-between text-xs text-blue-600 dark:text-blue-400 font-medium">
            <span>Oportunidades Abertas</span>
            <Target className="h-4 w-4" />
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
            {formatCentsToBrl(metrics.openValueCents)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {metrics.openCount} {metrics.openCount === 1 ? "negócio em andamento" : "negócios em andamento"}
          </div>
        </div>

        <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <div className="flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <span>Negócios Ganhos</span>
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
            {formatCentsToBrl(metrics.wonValueCents)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {metrics.wonCount} {metrics.wonCount === 1 ? "oportunidade ganha" : "oportunidades ganhas"}
          </div>
        </div>

        <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-4 dark:border-rose-900/40 dark:bg-rose-950/20">
          <div className="flex items-center justify-between text-xs text-rose-600 dark:text-rose-400 font-medium">
            <span>Negócios Perdidos</span>
            <XCircle className="h-4 w-4" />
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
            {formatCentsToBrl(metrics.lostValueCents)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {metrics.lostCount} {metrics.lostCount === 1 ? "oportunidade perdida" : "oportunidades perdidas"}
          </div>
        </div>

        <div className="rounded-xl border border-purple-100 bg-purple-50/50 p-4 dark:border-purple-900/40 dark:bg-purple-950/20">
          <div className="flex items-center justify-between text-xs text-purple-600 dark:text-purple-400 font-medium">
            <span>Taxa de Conversão</span>
            <TrendingUp className="h-4 w-4" />
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
            {conversionRate}%
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Total histórico: {metrics.totalCount} oportunidades
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por título ou cliente..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          />
        </div>

        <div className="w-40">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
          >
            <option value="all">Status: Todos</option>
            <option value="open">Apenas Abertas</option>
            <option value="won">Apenas Ganhas</option>
            <option value="lost">Apenas Perdidas</option>
          </select>
        </div>

        <div className="w-44">
          <input
            type="text"
            placeholder="Filtrar responsável..."
            value={responsibleFilter}
            onChange={e => setResponsibleFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <span>De:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white p-1.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
          />
          <span>Até:</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white p-1.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
          />
        </div>

        {(searchTerm || statusFilter !== "all" || responsibleFilter || dateFrom || dateTo) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearchTerm("");
              setStatusFilter("all");
              setResponsibleFilter("");
              setDateFrom("");
              setDateTo("");
            }}
            className="h-8 text-xs text-slate-500 hover:text-slate-900"
          >
            Limpar Filtros
          </Button>
        )}
      </div>

      {/* Main View Area */}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
            Carregando funil de oportunidades...
          </div>
        </div>
      ) : viewMode === "kanban" ? (
        /* Kanban Columns */
        <div className="flex gap-4 overflow-x-auto pb-6">
          {stages.map(stage => {
            const stageOpps = opportunitiesByStage.get(stage.publicId) || [];
            const stageTotalCents = stageOpps.reduce((sum, o) => sum + o.valueCents, 0);

            return (
              <div
                key={stage.publicId}
                onDragOver={handleDragOver}
                onDrop={e => handleDropOnStage(e, stage.publicId)}
                className="flex w-72 flex-shrink-0 flex-col rounded-2xl border border-slate-200 bg-slate-50/70 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/40"
              >
                {/* Stage Header */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-200/80 dark:border-slate-800/80">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: stage.color || "#6366F1" }}
                    />
                    <h3 className="truncate text-xs font-bold text-slate-900 dark:text-white" title={stage.name}>
                      {stage.name}
                    </h3>
                  </div>
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {stage.probabilityPct}%
                  </Badge>
                </div>

                {/* Sub-header with metrics */}
                <div className="flex items-center justify-between py-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>{stageOpps.length} {stageOpps.length === 1 ? "card" : "cards"}</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {formatCentsToBrl(stageTotalCents)}
                  </span>
                </div>

                {/* Quick Add Button */}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleOpenCreateModal(stage.publicId)}
                  className="mb-2 h-7 w-full border border-dashed border-slate-300 text-[11px] text-slate-500 hover:border-blue-400 hover:text-blue-600 dark:border-slate-700"
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Adicionar
                </Button>

                {/* Opportunity Cards List */}
                <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[calc(100vh-340px)] min-h-[120px] pr-0.5">
                  {stageOpps.length === 0 ? (
                    <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-slate-200/80 text-[11px] text-slate-400 dark:border-slate-800">
                      Nenhuma oportunidade
                    </div>
                  ) : (
                    stageOpps.map(opp => (
                      <div
                        key={opp.publicId}
                        draggable
                        onDragStart={e => handleDragStart(e, opp)}
                        onClick={() => {
                          setSelectedOpportunity(opp);
                          setIsDetailOpen(true);
                        }}
                        className="group cursor-pointer rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm transition-all hover:border-blue-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                      >
                        {/* Title & Status */}
                        <div className="flex items-start justify-between gap-1">
                          <h4 className="text-xs font-bold text-slate-900 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400 line-clamp-2">
                            {opp.title}
                          </h4>
                          {opp.status === "won" && (
                            <Badge className="h-4 bg-emerald-100 text-[9px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              Ganha
                            </Badge>
                          )}
                          {opp.status === "lost" && (
                            <Badge className="h-4 bg-rose-100 text-[9px] text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                              Perdida
                            </Badge>
                          )}
                        </div>

                        {/* Customer Link / Name */}
                        {opp.companyName && (
                          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                            <Building2 className="h-3 w-3 text-slate-400 flex-shrink-0" />
                            <span className="truncate">{opp.companyName}</span>
                          </div>
                        )}

                        {/* Value */}
                        <div className="mt-2.5 flex items-baseline justify-between">
                          <span className="text-xs font-bold text-slate-900 dark:text-white">
                            {formatCentsToBrl(opp.valueCents)}
                          </span>
                          {opp.expectedCloseDate && (
                            <div className="flex items-center gap-1 text-[10px] text-slate-500" title={`Previsão de fechamento: ${opp.expectedCloseDate}`}>
                              <Calendar className="h-3 w-3 text-slate-400" />
                              <span>{opp.expectedCloseDate.slice(5)}</span>
                            </div>
                          )}
                        </div>

                        {/* Footer / Responsible & Actions */}
                        <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-[10px] text-slate-500 dark:border-slate-800/60">
                          <span className="truncate max-w-[120px]" title={opp.internalResponsible || "Sem responsável"}>
                            {opp.internalResponsible || "Sem atribuição"}
                          </span>

                          {/* Quick stage selector menu & explicit actions */}
                          <div className="flex items-center gap-1">
                            <select
                              value={opp.stagePublicId}
                              onClick={e => e.stopPropagation()}
                              onChange={e => handleStageTransition(opp, e.target.value)}
                              className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[9px] text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                              title="Mover de estágio"
                            >
                              {stages.map(s => (
                                <option key={s.publicId} value={s.publicId}>
                                  {s.name} ({s.probabilityPct}%)
                                </option>
                              ))}
                            </select>

                            {opp.status !== "won" && (
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  updateOpportunityMutation.mutate({
                                    opportunityPublicId: opp.publicId,
                                    status: "won",
                                  });
                                }}
                                title="Marcar Ganha"
                                className="rounded p-0.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </button>
                            )}

                            {opp.status !== "lost" && (
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  setSelectedOpportunity(opp);
                                  setTargetLossStageId(null);
                                  setLossReasonInput("");
                                  setIsLossModalOpen(true);
                                }}
                                title="Marcar Perdida"
                                className="rounded p-0.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </button>
                            )}

                            {opp.status !== "open" && (
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  updateOpportunityMutation.mutate({
                                    opportunityPublicId: opp.publicId,
                                    status: "open",
                                  });
                                }}
                                title="Reabrir Negócio"
                                className="rounded p-0.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="p-3">Título</th>
                <th className="p-3">Cliente / Lead</th>
                <th className="p-3">Estágio</th>
                <th className="p-3">Valor</th>
                <th className="p-3">Responsável</th>
                <th className="p-3">Previsão</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {opportunities.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    Nenhuma oportunidade encontrada para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                opportunities.map(opp => (
                  <tr
                    key={opp.publicId}
                    onClick={() => {
                      setSelectedOpportunity(opp);
                      setIsDetailOpen(true);
                    }}
                    className="cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                  >
                    <td className="p-3 font-semibold text-slate-900 dark:text-white">
                      {opp.title}
                    </td>
                    <td className="p-3 text-slate-600 dark:text-slate-300">
                      {opp.companyName || "—"}
                    </td>
                    <td className="p-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `${opp.stageColor || "#6366F1"}15`, color: opp.stageColor || "#6366F1" }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: opp.stageColor || "#6366F1" }} />
                        {opp.stageName || "—"}
                      </span>
                    </td>
                    <td className="p-3 font-bold text-slate-900 dark:text-white">
                      {formatCentsToBrl(opp.valueCents)}
                    </td>
                    <td className="p-3 text-slate-600 dark:text-slate-300">
                      {opp.internalResponsible || "—"}
                    </td>
                    <td className="p-3 text-slate-500">
                      {opp.expectedCloseDate || "—"}
                    </td>
                    <td className="p-3">
                      {opp.status === "won" && (
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          Ganha
                        </Badge>
                      )}
                      {opp.status === "lost" && (
                        <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                          Perdida
                        </Badge>
                      )}
                      {opp.status === "open" && (
                        <Badge variant="outline" className="text-slate-600">
                          Aberta
                        </Badge>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={e => {
                          e.stopPropagation();
                          setSelectedOpportunity(opp);
                          setIsDetailOpen(true);
                        }}
                        className="h-7 text-xs"
                      >
                        Detalhes
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Nova Oportunidade */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Oportunidade Comercial</DialogTitle>
            <DialogDescription>
              Cadastre um novo negócio no funil de vendas.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="space-y-3.5 text-xs">
            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Título da Oportunidade *
              </label>
              <input
                type="text"
                placeholder="Ex.: Implantação Sistema CRM - Lote 1"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Valor Estimado (R$)
                </label>
                <input
                  type="text"
                  placeholder="0,00"
                  value={formValue}
                  onChange={e => setFormValue(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Estágio Inicial *
                </label>
                <select
                  value={formStageId}
                  onChange={e => setFormStageId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  required
                >
                  {stages.map(s => (
                    <option key={s.publicId} value={s.publicId}>
                      {s.name} ({s.probabilityPct}%)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Cliente ou Lead Vinculado
              </label>
              <select
                value={formCrmClientId}
                onChange={e => setFormCrmClientId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
              >
                <option value="">Nenhum (avulso)</option>
                {allClientsAndLeads.map(item => (
                  <option key={item.crmClientId} value={item.crmClientId}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>

            {/* If lead selected, allow instant atomic conversion */}
            {allClientsAndLeads.find(c => c.crmClientId === formCrmClientId)?.isLead && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                <input
                  type="checkbox"
                  id="convertLead"
                  checked={formConvertLead}
                  onChange={e => setFormConvertLead(e.target.checked)}
                  className="rounded border-amber-300"
                />
                <label htmlFor="convertLead" className="cursor-pointer">
                  Converter este <strong>Lead em Cliente Ativo</strong> agora
                </label>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Responsável Interno
                </label>
                <input
                  type="text"
                  placeholder="Nome do consultor"
                  value={formResponsible}
                  onChange={e => setFormInternalResponsible(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Previsão de Fechamento
                </label>
                <input
                  type="date"
                  value={formExpectedCloseDate}
                  onChange={e => setFormExpectedCloseDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Observações Iniciais
              </label>
              <textarea
                rows={2}
                placeholder="Detalhes sobre a negociação..."
                value={formObservations}
                onChange={e => setFormObservations(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createOpportunityMutation.isPending}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                {createOpportunityMutation.isPending ? "Cadastrando..." : "Cadastrar Oportunidade"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Detalhes da Oportunidade */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedOpportunity && (
            <div>
              <DialogHeader>
                <div className="flex items-center justify-between gap-2">
                  <DialogTitle className="text-lg font-bold">{selectedOpportunity.title}</DialogTitle>
                  <div className="flex items-center gap-1.5">
                    {selectedOpportunity.status === "won" && (
                      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        Ganha
                      </Badge>
                    )}
                    {selectedOpportunity.status === "lost" && (
                      <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                        Perdida
                      </Badge>
                    )}
                    {selectedOpportunity.status === "open" && (
                      <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40">
                        Em Andamento
                      </Badge>
                    )}
                  </div>
                </div>
                <DialogDescription>
                  {selectedOpportunity.companyName ? `Cliente: ${selectedOpportunity.companyName}` : "Sem cliente vinculado"}
                </DialogDescription>
              </DialogHeader>

              {/* Status Actions Bar */}
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/80 p-2.5 text-xs dark:border-slate-800 dark:bg-slate-900/60">
                <span className="font-semibold text-slate-500">Mudar Estágio:</span>
                <select
                  value={selectedOpportunity.stagePublicId}
                  onChange={e => handleStageTransition(selectedOpportunity, e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                >
                  {stages.map(s => (
                    <option key={s.publicId} value={s.publicId}>
                      {s.name} ({s.probabilityPct}%)
                    </option>
                  ))}
                </select>

                <div className="ml-auto flex items-center gap-2">
                  {selectedOpportunity.status !== "won" && (
                    <Button
                      size="sm"
                      onClick={() => {
                        updateOpportunityMutation.mutate({
                          opportunityPublicId: selectedOpportunity.publicId,
                          status: "won",
                        });
                      }}
                      className="h-7 bg-emerald-600 text-[11px] text-white hover:bg-emerald-700"
                    >
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Marcar Ganha
                    </Button>
                  )}

                  {selectedOpportunity.status !== "lost" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setTargetLossStageId(null);
                        setLossReasonInput("");
                        setIsLossModalOpen(true);
                      }}
                      className="h-7 border-rose-200 text-[11px] text-rose-600 hover:bg-rose-50 dark:border-rose-900"
                    >
                      <XCircle className="mr-1 h-3 w-3" />
                      Marcar Perdida
                    </Button>
                  )}

                  {selectedOpportunity.status !== "open" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        updateOpportunityMutation.mutate({
                          opportunityPublicId: selectedOpportunity.publicId,
                          status: "open",
                        });
                      }}
                      className="h-7 text-[11px]"
                    >
                      <RotateCcw className="mr-1 h-3 w-3" />
                      Reabrir
                    </Button>
                  )}
                </div>
              </div>

              {/* Tabs Navigation */}
              <div className="mt-4 flex border-b border-slate-200 text-xs dark:border-slate-800">
                <button
                  onClick={() => setDetailTab("details")}
                  className={`px-4 py-2 font-semibold transition-colors ${
                    detailTab === "details"
                      ? "border-b-2 border-blue-600 text-blue-600 dark:text-blue-400"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  Dados da Negociação
                </button>
                <button
                  onClick={() => setDetailTab("activities")}
                  className={`px-4 py-2 font-semibold transition-colors ${
                    detailTab === "activities"
                      ? "border-b-2 border-blue-600 text-blue-600 dark:text-blue-400"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  Atividades & Tarefas
                </button>
                <button
                  onClick={() => setDetailTab("history")}
                  className={`px-4 py-2 font-semibold transition-colors ${
                    detailTab === "history"
                      ? "border-b-2 border-blue-600 text-blue-600 dark:text-blue-400"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  Histórico de Estágios
                </button>
              </div>

              {/* Tab 1: Details */}
              {detailTab === "details" && (
                <div className="mt-4 space-y-4 text-xs">
                  <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-950/60">
                    <div>
                      <span className="text-slate-500">Valor da Oportunidade:</span>
                      <div className="text-base font-bold text-slate-900 dark:text-white">
                        {formatCentsToBrl(selectedOpportunity.valueCents)}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">Previsão de Fechamento:</span>
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedOpportunity.expectedCloseDate || "Não definida"}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">Responsável Interno:</span>
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedOpportunity.internalResponsible || "Sem atribuição"}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">Criada em:</span>
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedOpportunity.createdAt.slice(0, 10)}
                      </div>
                    </div>
                  </div>

                  {selectedOpportunity.lossReason && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                      <strong>Motivo de Perda:</strong> {selectedOpportunity.lossReason}
                    </div>
                  )}

                  {selectedOpportunity.observations && (
                    <div>
                      <h5 className="font-bold text-slate-900 dark:text-white">Observações:</h5>
                      <p className="mt-1 whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-3 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                        {selectedOpportunity.observations}
                      </p>
                    </div>
                  )}

                  {/* Navigation shortcut to customer page */}
                  {selectedOpportunity.crmClientId && onNavigate && (
                    <div className="flex justify-end pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setIsDetailOpen(false);
                          onNavigate("clients");
                        }}
                        className="gap-1.5 text-xs text-blue-600 hover:text-blue-700"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Abrir Cadastro do Cliente
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Activities */}
              {detailTab === "activities" && (
                <div className="mt-4 space-y-4 text-xs">
                  {/* Add Activity Form */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950">
                    <h5 className="font-bold text-slate-900 dark:text-white">Registrar Nova Atividade</h5>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <select
                        value={activityType}
                        onChange={e => setActivityType(e.target.value as any)}
                        className="rounded-lg border border-slate-200 bg-white p-1.5 text-xs dark:border-slate-800 dark:bg-slate-950"
                      >
                        <option value="task">Tarefa</option>
                        <option value="call">Ligação</option>
                        <option value="meeting">Reunião</option>
                        <option value="followup">Follow-up</option>
                        <option value="note">Anotação</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Título da atividade *"
                        value={activityTitle}
                        onChange={e => setActivityTitle(e.target.value)}
                        className="col-span-2 rounded-lg border border-slate-200 bg-white p-1.5 text-xs dark:border-slate-800 dark:bg-slate-950"
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        value={activityDueAt}
                        onChange={e => setActivityDueAt(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white p-1.5 text-xs dark:border-slate-800 dark:bg-slate-950"
                      />
                      <input
                        type="text"
                        placeholder="Atribuído a..."
                        value={activityAssignedTo}
                        onChange={e => setActivityAssignedTo(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white p-1.5 text-xs dark:border-slate-800 dark:bg-slate-950"
                      />
                    </div>
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        disabled={!activityTitle.trim() || createActivityMutation.isPending}
                        onClick={() => {
                          createActivityMutation.mutate({
                            opportunityPublicId: selectedOpportunity.publicId,
                            type: activityType,
                            title: activityTitle.trim(),
                            description: activityDescription || null,
                            dueAt: activityDueAt || null,
                            assignedTo: activityAssignedTo.trim() || "",
                          });
                        }}
                        className="h-7 bg-blue-600 text-[11px] text-white"
                      >
                        Salvar Atividade
                      </Button>
                    </div>
                  </div>

                  {/* Activities List */}
                  <div className="space-y-2">
                    <h5 className="font-bold text-slate-900 dark:text-white">Atividades Registradas</h5>
                    {activitiesQuery.data?.activities && activitiesQuery.data.activities.length > 0 ? (
                      activitiesQuery.data.activities.map(act => (
                        <div
                          key={act.publicId}
                          className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px] capitalize">
                                {act.type}
                              </Badge>
                              <span className={`font-semibold ${act.status === "completed" ? "line-through text-slate-400" : "text-slate-900 dark:text-white"}`}>
                                {act.title}
                              </span>
                            </div>
                            {act.dueAt && (
                              <div className="mt-1 text-[11px] text-slate-500">
                                Vencimento: {act.dueAt.slice(0, 10)}
                              </div>
                            )}
                          </div>
                          {act.status !== "completed" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                updateActivityMutation.mutate({
                                  activityPublicId: act.publicId,
                                  status: "completed",
                                });
                              }}
                              className="h-7 text-xs text-emerald-600 hover:text-emerald-700"
                            >
                              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                              Concluir
                            </Button>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-slate-400">Nenhuma atividade registrada.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 3: History (Append-only) */}
              {detailTab === "history" && (
                <div className="mt-4 space-y-3 text-xs">
                  <h5 className="font-bold text-slate-900 dark:text-white">Linha do Tempo de Estágios</h5>
                  <div className="space-y-2">
                    {historyQuery.data?.history && historyQuery.data.history.length > 0 ? (
                      historyQuery.data.history.map(item => (
                        <div
                          key={item.publicId}
                          className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60"
                        >
                          <History className="mt-0.5 h-4 w-4 text-slate-400 flex-shrink-0" />
                          <div className="flex-1">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">
                              {item.notes || "Movimentação de estágio"}
                            </div>
                            <div className="mt-1 text-[11px] text-slate-500">
                              Por: <strong>{item.author}</strong> em {item.createdAt.slice(0, 19).replace("T", " ")}
                            </div>
                          </div>
                          <div className="font-bold text-slate-900 dark:text-white">
                            {formatCentsToBrl(item.toValueCents)}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-slate-400">Sem histórico registrado.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal: Motivo de Perda */}
      <Dialog open={isLossModalOpen} onOpenChange={setIsLossModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Marcar como Oportunidade Perdida</DialogTitle>
            <DialogDescription>
              Informe o motivo de perda para fins de histórico e inteligência comercial.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-xs">
            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Motivo da Perda *
              </label>
              <textarea
                rows={3}
                placeholder="Ex.: Preço superior ao concorrente, timing desfavorável, descontinuidade do projeto..."
                value={lossReasonInput}
                onChange={e => setLossReasonInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs focus:border-rose-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                required
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsLossModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleConfirmLoss}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              Confirmar Perda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
