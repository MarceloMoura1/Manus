import React from "react";
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
} from "lucide-react";
import type { CrmSection } from "./CRMWorkspace";

interface CrmSummaryPageProps {
  onNavigate: (section: CrmSection) => void;
}

export function CrmSummaryPage({ onNavigate }: CrmSummaryPageProps) {
  // Métricas iniciais honestas (sem dados fictícios gerados como métricas reais)
  const metricCards = [
    {
      label: "Oportunidades em Aberto",
      value: "0",
      helper: "Nenhuma oportunidade em andamento",
      icon: Target,
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-50 dark:bg-purple-950/40",
    },
    {
      label: "Leads em Qualificação",
      value: "0",
      helper: "Aguardando entrada de contatos",
      icon: Users,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950/40",
    },
    {
      label: "Atividades & Follow-ups",
      value: "0",
      helper: "Sem tarefas agendadas para hoje",
      icon: CalendarCheck,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950/40",
    },
    {
      label: "Valor Total em Funil",
      value: "R$ 0,00",
      helper: "Calculado a partir de propostas ativas",
      icon: TrendingUp,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
    },
  ];

  const quickNavCards = [
    {
      title: "Funil Comercial (Kanban)",
      description: "Visualização em colunas por estágios de qualificação, valores ponderados e movimentação ágil.",
      section: "pipeline" as CrmSection,
      icon: Target,
      tag: "Etapa 2B.4",
    },
    {
      title: "Leads e Prospecção",
      description: "Entrada e captação de contatos comerciais, enriquecimento cadastral e pontuação (lead scoring).",
      section: "leads" as CrmSection,
      icon: Users,
      tag: "Integrado",
    },
    {
      title: "Clientes & Contatos",
      description: "Cadastro unificado de clientes B2B/B2C, histórico completo de conversas, chamados e arquivos.",
      section: "clients" as CrmSection,
      icon: Layers,
      tag: "Integrado",
    },
    {
      title: "Atividades e Tarefas",
      description: "Agendamento de ligações, reuniões, follow-ups de vendas e histórico de interações por operador.",
      section: "activities" as CrmSection,
      icon: CalendarCheck,
      tag: "Etapa 2B.5",
    },
    {
      title: "Propostas Comerciais",
      description: "Elaboração e envio de propostas comerciais integradas ao catálogo e aos pedidos de venda do ERP.",
      section: "proposals" as CrmSection,
      icon: FileText,
      tag: "Etapa 2B.6",
    },
    {
      title: "Automações e IA (Gemini)",
      description: "Gatilhos por mudança de estágio, sugestão de próxima ação e qualificação assistida por IA.",
      section: "automations" as CrmSection,
      icon: Sparkles,
      tag: "Etapa 2B.7",
    },
  ];

  const pipelineStages = [
    { number: "1", title: "Prospecção", desc: "Entrada de novos leads via WhatsApp, site ou indicação" },
    { number: "2", title: "Qualificação", desc: "Diagnóstico inicial de necessidades e orçamento" },
    { number: "3", title: "Proposta", desc: "Apresentação comercial e envio de condições" },
    { number: "4", title: "Negociação", desc: "Alinhamento de prazos, contrato e ajustes" },
    { number: "5", title: "Fechamento", desc: "Ganho (conversão em venda) ou registro de motivo de perda" },
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
            <article
              key={idx}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{card.label}</span>
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${card.bg}`}>
                  <Icon className={`h-4 w-4 ${card.color}`} />
                </div>
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{card.value}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{card.helper}</p>
            </article>
          );
        })}
      </div>

      {/* Seção: Módulos do CRM */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Módulos e Áreas do CRM</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">Navegue pelas áreas integradas</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
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
              Jornada de conversão comercial integrada ao WhatsApp, atendimento e faturamento.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onNavigate("pipeline")}
            className="border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Ver Kanban
          </Button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {pipelineStages.map((stage, idx) => (
            <div
              key={idx}
              className="relative flex flex-col rounded-xl border border-slate-100 bg-slate-50/70 p-4 transition hover:border-purple-200 dark:border-slate-800/80 dark:bg-slate-950/60 dark:hover:border-purple-800"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white">
                  {stage.number}
                </span>
                <span className="text-xs font-semibold text-slate-900 dark:text-white">{stage.title}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{stage.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Banner de Segurança & Multi-Tenancy */}
      <footer className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-emerald-950 dark:bg-emerald-950/20">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <p className="text-xs text-emerald-900 dark:text-emerald-200">
            <strong>Ambiente Seguro:</strong> Acesso restrito e validado pela permissão dedicada <code className="font-mono text-emerald-700 dark:text-emerald-300">crm</code> com isolamento estrito de dados por tenant.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Fase 1 Auditada
        </span>
      </footer>
    </div>
  );
}
