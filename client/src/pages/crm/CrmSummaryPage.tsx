import React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Users,
  Target,
  TrendingUp,
  CalendarCheck,
  FileText,
  Sparkles,
  BarChart3,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Layers,
  Zap,
} from "lucide-react";
import type { CrmSection } from "./CRMWorkspace";
import { RiskRadar } from "./RiskRadar";

interface CrmSummaryPageProps {
  onNavigate: (section: CrmSection) => void;
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function CrmSummaryPage({ onNavigate }: CrmSummaryPageProps) {
  // Live queries for authentic CRM metrics
  const { data: summary } = trpc.crm.reports.summary.useQuery(
    { period: "30d" },
    { staleTime: 30_000 }
  );

  const { data: activitiesData } = trpc.crm.opportunities.listActivities.useQuery(
    { status: "pending" },
    { staleTime: 30_000 }
  );

  const pendingActivitiesCount = activitiesData?.activities?.length ?? 0;

  const metricCards = [
    {
      label: "Oportunidades em Aberto",
      value: String(summary?.openCount ?? 0),
      helper: summary?.openCount ? `${summary.openCount} negócios em negociação ativa` : "Nenhuma oportunidade em andamento",
      icon: Target,
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-50 dark:bg-purple-950/40",
      onClick: () => onNavigate("pipeline"),
    },
    {
      label: "Leads Cadastrados",
      value: String(summary?.leadsCount ?? 0),
      helper: summary?.leadsCount ? `${summary.leadsCount} contatos em prospecção` : "Aguardando entrada de novos leads",
      icon: Users,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950/40",
      onClick: () => onNavigate("leads"),
    },
    {
      label: "Tarefas Pendentes",
      value: String(pendingActivitiesCount),
      helper: pendingActivitiesCount > 0 ? `${pendingActivitiesCount} follow-ups a realizar` : "Todas as atividades em dia",
      icon: CalendarCheck,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950/40",
      onClick: () => onNavigate("activities"),
    },
    {
      label: "Valor Total em Funil",
      value: formatMoney(summary?.openTotalCents ?? 0),
      helper: `Taxa de conversão: ${summary?.winRate ?? 0}%`,
      icon: TrendingUp,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      onClick: () => onNavigate("reports"),
    },
  ];

  const quickNavCards = [
    {
      title: "Funil Comercial (Kanban)",
      description: "Visualização em colunas por estágios de qualificação, valores ponderados e movimentação ágil.",
      section: "pipeline" as CrmSection,
      icon: Target,
      tag: "Operacional",
    },
    {
      title: "Leads e Prospecção",
      description: "Entrada e captação de contatos comerciais, enriquecimento cadastral e qualificação.",
      section: "leads" as CrmSection,
      icon: Users,
      tag: "Operacional",
    },
    {
      title: "Clientes & Contatos",
      description: "Cadastro unificado de clientes B2B/B2C, histórico completo de conversas, chamados e arquivos.",
      section: "clients" as CrmSection,
      icon: Layers,
      tag: "Operacional",
    },
    {
      title: "Atividades e Tarefas",
      description: "Follow-ups, tarefas, compromissos e histórico de contato com compradores por operador.",
      section: "activities" as CrmSection,
      icon: CalendarCheck,
      tag: "Operacional",
    },
    {
      title: "Propostas Comerciais",
      description: "Elaboração e envio de propostas integradas ao catálogo, geração de PDF e conversão em vendas.",
      section: "proposals" as CrmSection,
      icon: FileText,
      tag: "Operacional",
    },
    {
      title: "Automações & IA (Gemini)",
      description: "Gatilhos por mudança de estágio, captura via webhooks e assistência inteligente do Gemini.",
      section: "automations" as CrmSection,
      icon: Sparkles,
      tag: "Operacional",
    },
    {
      title: "Relatórios Comerciais",
      description: "Taxas de conversão, ticket médio, análise de perdas (Pareto) e produtividade da equipe.",
      section: "reports" as CrmSection,
      icon: BarChart3,
      tag: "Operacional",
    },
  ];

  const pipelineStages = [
    { number: "1", title: "Prospecção", desc: "Entrada de novos leads via WhatsApp, site ou webhook" },
    { number: "2", title: "Qualificação", desc: "Diagnóstico inicial de necessidades e orçamento" },
    { number: "3", title: "Proposta", desc: "Elaboração de orçamento com catálogo de produtos" },
    { number: "4", title: "Negociação", desc: "Alinhamento de prazos, desconto e condições" },
    { number: "5", title: "Fechamento", desc: "Conversão em pedido de venda ou registro de motivo de perda" },
  ];

  return (
    <div className="space-y-6" data-testid="crm-summary-page">
      {/* Cabeçalho */}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Resumo do CRM</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Painel de controle comercial, funil de oportunidades e gestão de relacionamento no MegaDesk.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => onNavigate("clients")}
            variant="outline"
            className="border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Layers className="mr-2 h-4 w-4" />
            Base de Clientes
          </Button>
          <Button
            onClick={() => onNavigate("pipeline")}
            className="bg-purple-600 text-white hover:bg-purple-700"
          >
            <Target className="mr-2 h-4 w-4" />
            Abrir Funil
          </Button>
        </div>
      </header>

      {/* Grid de Métricas Principais */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <button
              key={idx}
              type="button"
              onClick={card.onClick}
              className="text-left rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-purple-300 hover:shadow-md transition-all dark:border-slate-800 dark:bg-slate-900 dark:hover:border-purple-700"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{card.label}</span>
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${card.bg}`}>
                  <Icon className={`h-4 w-4 ${card.color}`} />
                </div>
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{card.value}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{card.helper}</p>
            </button>
          );
        })}
      </div>

      {/* Radar de Oportunidades em Risco */}
      <RiskRadar onNavigate={onNavigate} />

      {/* Seção: Módulos do CRM */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Módulos e Áreas do CRM</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">Navegue pelas áreas integradas</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {quickNavCards.map((item, idx) => {
            const Icon = item.icon;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onNavigate(item.section)}
                className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-purple-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-purple-700"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition group-hover:bg-purple-100 group-hover:text-purple-700 dark:bg-slate-800 dark:text-slate-300 dark:group-hover:bg-purple-950 dark:group-hover:text-purple-300">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      {item.tag}
                    </span>
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-slate-900 transition group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.description}</p>
                </div>

                <div className="mt-4 flex items-center text-xs font-semibold text-purple-600 transition group-hover:translate-x-0.5 dark:text-purple-400">
                  <span>Acessar área</span>
                  <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Régua Estrutural do Funil de Vendas */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Fluxo do Funil de Vendas</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Jornada de conversão comercial integrada ao WhatsApp, propostas e faturamento.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onNavigate("pipeline")}
            className="border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Ver no Kanban
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-5">
          {pipelineStages.map((stage) => (
            <div
              key={stage.number}
              className="flex flex-col justify-between rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800/60 dark:bg-slate-800/40"
            >
              <div>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-100 text-xs font-bold text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                  {stage.number}
                </span>
                <h3 className="mt-2 text-xs font-bold text-slate-900 dark:text-white">{stage.title}</h3>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {stage.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
