import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  BarChart3,
  TrendingUp,
  Download,
  Calendar,
  Layers,
  Share2,
  DollarSign,
  Clock,
  AlertTriangle,
  Users,
  CheckCircle2,
  XCircle,
  RefreshCw,
  PieChart,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function ReportsPage() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "365d" | "all">("30d");

  // Queries
  const { data: summary, isLoading: isLoadingSummary, refetch: refetchSummary, isFetching } =
    trpc.crm.reports.summary.useQuery({ period }, { refetchOnWindowFocus: false });

  const { data: stages = [], isLoading: isLoadingStages } =
    trpc.crm.reports.funnelStages.useQuery(undefined, { refetchOnWindowFocus: false });

  const { data: channels = [], isLoading: isLoadingChannels } =
    trpc.crm.reports.channels.useQuery(undefined, { refetchOnWindowFocus: false });

  const { data: lossReasons = [], isLoading: isLoadingLoss } =
    trpc.crm.reports.lossReasons.useQuery(undefined, { refetchOnWindowFocus: false });

  const { data: team = [], isLoading: isLoadingTeam } =
    trpc.crm.reports.teamPerformance.useQuery(undefined, { refetchOnWindowFocus: false });

  // Export CSV
  const handleExportCsv = () => {
    const rows = [
      ["Relatório Comercial MegaDesk", `Período: ${period}`],
      [""],
      ["MÉTRICAS GERAIS"],
      ["Novos Leads", summary?.leadsCount ?? 0],
      ["Negócios Ganhos", summary?.wonCount ?? 0],
      ["Faturamento Ganho (R$)", (summary?.wonTotalCents ?? 0) / 100],
      ["Negócios Perdidos", summary?.lostCount ?? 0],
      ["Valor Perdido (R$)", (summary?.lostTotalCents ?? 0) / 100],
      ["Taxa de Conversão (%)", `${summary?.winRate ?? 0}%`],
      ["Ticket Médio (R$)", (summary?.avgTicketCents ?? 0) / 100],
      ["Ciclo Médio de Venda (dias)", summary?.avgCycleDays ?? 0],
      [""],
      ["CANAL DE AQUISIÇÃO", "LEADS", "VENDAS", "CONVERSÃO (%)", "RECEITA (R$)"],
      ...channels.map((c) => [c.origin, c.totalLeads, c.wonCount, `${c.conversionRate}%`, c.wonCents / 100]),
      [""],
      ["MOTIVO DE PERDA", "QUANTIDADE", "VALOR PERDIDO (R$)", "PERCENTUAL (%)"],
      ...lossReasons.map((l) => [l.reason, l.count, l.totalCents / 100, `${l.percentage}%`]),
      [""],
      ["VENDEDOR", "TOTAL OPORTUNIDADES", "GANHAS", "CONVERSÃO (%)", "RECEITA (R$)"],
      ...team.map((t) => [t.seller, t.totalOpps, t.wonCount, `${t.conversionRate}%`, t.wonCents / 100]),
    ];

    const csvContent =
      "data:text/csv;charset=utf-8,\uFEFF" +
      rows.map((row) => row.map((cell) => `"${cell}"`).join(";")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `relatorio-comercial-megadesk-${period}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Relatórios & Indicadores Comerciais
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Métricas de conversão, produtividade da equipe, eficiência dos canais e motivos de perda.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Period selector */}
          <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0.5">
            {(
              [
                ["7d", "7 dias"],
                ["30d", "30 dias"],
                ["90d", "90 dias"],
                ["365d", "1 ano"],
                ["all", "Tudo"],
              ] as const
            ).map(([p, label]) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  period === p
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="gap-2 text-xs"
          >
            <Download className="w-3.5 h-3.5" /> Exportar CSV
          </Button>
        </div>
      </div>

      {/* Main KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-4 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Taxa de Conversão</span>
          <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1 block">
            {summary?.winRate ?? 0}%
          </span>
          <span className="text-[11px] text-slate-400 mt-0.5 block">
            {summary?.wonCount ?? 0} ganhos / {(summary?.wonCount ?? 0) + (summary?.lostCount ?? 0)} decididos
          </span>
        </div>

        <div className="p-4 rounded-xl border bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800">
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Faturamento Ganho</span>
          <span className="text-xl font-bold text-emerald-700 dark:text-emerald-300 mt-1 block">
            {formatMoney(summary?.wonTotalCents ?? 0)}
          </span>
          <span className="text-[11px] text-emerald-600/80 mt-0.5 block">
            {summary?.wonCount ?? 0} negócios fechados
          </span>
        </div>

        <div className="p-4 rounded-xl border bg-blue-50/50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800">
          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Ticket Médio</span>
          <span className="text-xl font-bold text-blue-700 dark:text-blue-300 mt-1 block">
            {formatMoney(summary?.avgTicketCents ?? 0)}
          </span>
          <span className="text-[11px] text-blue-600/80 mt-0.5 block">Por venda aprovada</span>
        </div>

        <div className="p-4 rounded-xl border bg-amber-50/50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800">
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Ciclo Médio de Venda</span>
          <span className="text-2xl font-bold text-amber-700 dark:text-amber-300 mt-1 block">
            {summary?.avgCycleDays ?? 0} dias
          </span>
          <span className="text-[11px] text-amber-600/80 mt-0.5 block">Da criação ao fechamento</span>
        </div>

        <div className="p-4 rounded-xl border bg-purple-50/50 border-purple-200 dark:bg-purple-950/20 dark:border-purple-800">
          <span className="text-xs font-medium text-purple-600 dark:text-purple-400">Pipeline Ativo</span>
          <span className="text-xl font-bold text-purple-700 dark:text-purple-300 mt-1 block">
            {formatMoney(summary?.openTotalCents ?? 0)}
          </span>
          <span className="text-[11px] text-purple-600/80 mt-0.5 block">
            {summary?.openCount ?? 0} negócios em andamento
          </span>
        </div>
      </div>

      {/* Grid: Funil por Estágio & Origem dos Leads */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Painel 1: Volume no Funil por Estágio */}
        <div className="p-5 rounded-2xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-600" />
              Volume no Funil por Estágio
            </h3>
            <span className="text-xs text-slate-400">Em tempo real</span>
          </div>

          {stages.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Nenhum estágio de funil configurado.
            </div>
          ) : (
            <div className="space-y-3">
              {stages.map((stage) => {
                const totalInPipe = summary?.openTotalCents || 1;
                const percentage = Math.min(100, Math.round((stage.totalCents / totalInPipe) * 100));
                return (
                  <div key={stage.publicId} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: stage.color }}
                        />
                        {stage.name}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">{stage.opportunityCount} deals</span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {formatMoney(stage.totalCents)}
                        </span>
                      </div>
                    </div>
                    {/* Visual Bar */}
                    <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.max(4, percentage)}%`,
                          backgroundColor: stage.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Painel 2: Canais de Aquisição */}
        <div className="p-5 rounded-2xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
              <Share2 className="w-5 h-5 text-indigo-600" />
              Desempenho por Canal de Aquisição
            </h3>
            <span className="text-xs text-slate-400">Origem do contato</span>
          </div>

          {channels.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Nenhum dado de aquisição disponível no momento.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 uppercase font-semibold">
                  <tr>
                    <th className="px-3 py-2">Canal</th>
                    <th className="px-3 py-2 text-center">Leads</th>
                    <th className="px-3 py-2 text-center">Vendas</th>
                    <th className="px-3 py-2 text-center">Conversão</th>
                    <th className="px-3 py-2 text-right">Receita</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {channels.map((c) => (
                    <tr key={c.origin} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-2.5 font-semibold capitalize text-slate-900 dark:text-white">
                        {c.origin}
                      </td>
                      <td className="px-3 py-2.5 text-center text-slate-600 dark:text-slate-400 font-medium">
                        {c.totalLeads}
                      </td>
                      <td className="px-3 py-2.5 text-center text-emerald-600 dark:text-emerald-400 font-bold">
                        {c.wonCount}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="px-2 py-0.5 rounded font-bold text-[11px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400">
                          {c.conversionRate}%
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-slate-900 dark:text-white">
                        {formatMoney(c.wonCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Grid: Motivos de Perda & Produtividade da Equipe */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Painel 3: Análise de Motivos de Perda */}
        <div className="p-5 rounded-2xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
              Motivos de Perda de Negócios (Pareto)
            </h3>
            <span className="text-xs text-rose-600 font-semibold">
              Perdas: {formatMoney(summary?.lostTotalCents ?? 0)}
            </span>
          </div>

          {lossReasons.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Nenhuma perda registrada com motivo no período selecionado.
            </div>
          ) : (
            <div className="space-y-3">
              {lossReasons.map((item, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[240px]">
                      {item.reason}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 font-semibold">{item.percentage}%</span>
                      <span className="text-slate-500">{item.count} deals</span>
                      <span className="font-bold text-rose-600 dark:text-rose-400">
                        {formatMoney(item.totalCents)}
                      </span>
                    </div>
                  </div>
                  <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-rose-500 rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(5, item.percentage)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Painel 4: Produtividade Comercial por Vendedor */}
        <div className="p-5 rounded-2xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-600" />
              Desempenho por Operador / Vendedor
            </h3>
            <span className="text-xs text-slate-400">Resultados da equipe</span>
          </div>

          {team.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Nenhum dado atribuído a vendedores no período.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 uppercase font-semibold">
                  <tr>
                    <th className="px-3 py-2">Vendedor</th>
                    <th className="px-3 py-2 text-center">Atribuídas</th>
                    <th className="px-3 py-2 text-center">Ganhas</th>
                    <th className="px-3 py-2 text-center">Conversão</th>
                    <th className="px-3 py-2 text-right">Faturado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {team.map((m) => (
                    <tr key={m.seller} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-white">
                        {m.seller}
                      </td>
                      <td className="px-3 py-2.5 text-center text-slate-600 dark:text-slate-400 font-medium">
                        {m.totalOpps}
                      </td>
                      <td className="px-3 py-2.5 text-center text-emerald-600 dark:text-emerald-400 font-bold">
                        {m.wonCount}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="px-2 py-0.5 rounded font-bold text-[11px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                          {m.conversionRate}%
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-slate-900 dark:text-white">
                        {formatMoney(m.wonCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
