import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { CrmWhatsAppIntent } from "../../../../shared/crm";
import {
  AlertTriangle,
  Clock,
  CheckCircle2,
  Phone,
  MessageSquare,
  ArrowRight,
  Target,
  Building2,
  Calendar,
  Sparkles,
  RefreshCw,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface RiskRadarProps {
  onNavigate?: (section: any) => void;
  onClientNavigate?: (intent: CrmWhatsAppIntent) => void;
  whatsappConnected?: boolean;
  canStartConversation?: boolean;
  onQuickTask?: (opportunityPublicId: string) => void;
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function RiskRadar({
  onNavigate,
  onClientNavigate,
  whatsappConnected,
  canStartConversation,
  onQuickTask,
}: RiskRadarProps) {
  const [activeBucket, setActiveBucket] = useState<"stalled" | "overdue" | "no_step">("stalled");

  const { data: radar, isLoading, refetch, isFetching } =
    trpc.crm.opportunities.radar.useQuery(undefined, { refetchOnWindowFocus: false });

  const stalled = radar?.stalledDeals || [];
  const overdue = radar?.overdueActivities || [];
  const noStep = radar?.dealsWithoutNextStep || [];
  const totalAtRisk = radar?.totalAtRisk || 0;

  if (isLoading) {
    return (
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse flex items-center justify-center py-8">
        <RefreshCw className="w-5 h-5 text-indigo-600 animate-spin mr-2" />
        <span className="text-xs text-slate-500">Varrendo oportunidades e atividades em risco...</span>
      </div>
    );
  }

  if (totalAtRisk === 0) {
    return (
      <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <div>
            <h4 className="text-xs font-bold text-emerald-900 dark:text-emerald-300">
              Radar Comercial: Nenhuma demanda em risco no momento
            </h4>
            <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
              Todas as oportunidades ativas possuem movimentação recente ou próximo passo agendado.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-7 text-xs text-emerald-700">
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20 space-y-3">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
            Radar de Risco Comercial ({totalAtRisk} demandas necessitam de atenção)
          </h4>
        </div>

        {/* Filter Buckets */}
        <div className="flex items-center gap-1 bg-white/80 dark:bg-slate-900/80 p-0.5 rounded-lg border border-amber-200 dark:border-amber-900">
          <button
            type="button"
            onClick={() => setActiveBucket("stalled")}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
              activeBucket === "stalled"
                ? "bg-amber-500 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400"
            }`}
          >
            Parados 7d+ ({stalled.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveBucket("overdue")}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
              activeBucket === "overdue"
                ? "bg-rose-600 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400"
            }`}
          >
            Tarefas Atrasadas ({overdue.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveBucket("no_step")}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
              activeBucket === "no_step"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400"
            }`}
          >
            Sem Próximo Passo ({noStep.length})
          </button>
        </div>
      </div>

      {/* Items List */}
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {activeBucket === "stalled" &&
          stalled.map((deal) => (
            <div
              key={deal.publicId}
              className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 dark:text-white truncate">
                    {deal.title}
                  </span>
                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-amber-600 border-amber-300">
                    Parado há {deal.daysStalled} dias
                  </Badge>
                </div>
                <div className="text-[11px] text-slate-500 flex items-center gap-3 mt-0.5">
                  <span>Estágio: <strong>{deal.stageName}</strong></span>
                  {deal.companyName && <span>Cliente: {deal.companyName}</span>}
                  <span>Valor: {formatMoney(deal.valueCents)}</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {onQuickTask && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onQuickTask(deal.publicId)}
                    className="h-7 text-[11px] gap-1"
                  >
                    <Plus className="w-3 h-3" /> Agendar Ação
                  </Button>
                )}
                {onNavigate && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onNavigate("pipeline")}
                    className="h-7 text-[11px] text-indigo-600"
                  >
                    Ir ao Funil
                  </Button>
                )}
              </div>
            </div>
          ))}

        {activeBucket === "overdue" &&
          overdue.map((act) => (
            <div
              key={act.publicId}
              className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 dark:text-white truncate">
                    {act.title}
                  </span>
                  <Badge variant="destructive" className="text-[10px] py-0 px-1.5">
                    Atrasada há {act.daysOverdue} dia(s)
                  </Badge>
                </div>
                <div className="text-[11px] text-slate-500 flex items-center gap-3 mt-0.5">
                  {act.opportunityTitle && <span>Deal: {act.opportunityTitle}</span>}
                  {act.companyName && <span>Cliente: {act.companyName}</span>}
                  {act.assignedTo && <span>Resp: {act.assignedTo}</span>}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {onNavigate && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onNavigate("activities")}
                    className="h-7 text-[11px] gap-1"
                  >
                    Concluir / Remarcar
                  </Button>
                )}
              </div>
            </div>
          ))}

        {activeBucket === "no_step" &&
          noStep.map((deal) => (
            <div
              key={deal.publicId}
              className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 dark:text-white truncate">
                    {deal.title}
                  </span>
                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-indigo-600 border-indigo-200">
                    Sem follow-up futuro
                  </Badge>
                </div>
                <div className="text-[11px] text-slate-500 flex items-center gap-3 mt-0.5">
                  <span>Estágio: <strong>{deal.stageName}</strong></span>
                  {deal.companyName && <span>Cliente: {deal.companyName}</span>}
                  <span>Valor: {formatMoney(deal.valueCents)}</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {onQuickTask && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onQuickTask(deal.publicId)}
                    className="h-7 text-[11px] gap-1 bg-indigo-50 border-indigo-200 text-indigo-700"
                  >
                    <Plus className="w-3 h-3" /> Agendar Próximo Passo
                  </Button>
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
