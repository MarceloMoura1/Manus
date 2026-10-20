import React from "react";
import type { ModuleTopbarItem } from "@/components/ModuleTopbar";
import { ClientesPage } from "../ClientesPage";
import type { CrmWhatsAppIntent } from "../../../../shared/crm";
import { CrmSummaryPage } from "./CrmSummaryPage";
import { CrmPlaceholderPage } from "./CrmPlaceholderPage";
import { LeadsPage } from "./LeadsPage";
import { PipelinePage } from "./PipelinePage";
import {
  Users,
  Target,
  CalendarCheck,
  FileText,
  Sparkles,
  BarChart3,
  Layers,
} from "lucide-react";

export type CrmSection =
  | "summary"
  | "pipeline"
  | "leads"
  | "clients"
  | "activities"
  | "proposals"
  | "automations"
  | "reports";

export function getCrmTopbarItems({
  onNavigate,
}: {
  onNavigate: (section: CrmSection) => void;
}): ModuleTopbarItem[] {
  const items: ModuleTopbarItem[] = [
    { id: "summary" as const, label: "Resumo", onSelect: () => onNavigate("summary") },
    { id: "pipeline" as const, label: "Funil de Vendas", onSelect: () => onNavigate("pipeline") },
    { id: "leads" as const, label: "Leads", onSelect: () => onNavigate("leads") },
    { id: "clients" as const, label: "Clientes", onSelect: () => onNavigate("clients") },
    { id: "activities" as const, label: "Atividades", onSelect: () => onNavigate("activities") },
    { id: "proposals" as const, label: "Propostas", onSelect: () => onNavigate("proposals") },
    { id: "automations" as const, label: "Automações & IA", onSelect: () => onNavigate("automations") },
    { id: "reports" as const, label: "Relatórios", onSelect: () => onNavigate("reports") },
  ];

  return items;
}

export function CRMWorkspace({
  section,
  onNavigate,
  canAccessClients,
  initialCrmClientId,
  onClientNavigate,
  whatsappConnected,
  canStartConversation,
  canPermanentlyDeleteClients,
}: {
  section: CrmSection;
  onNavigate: (section: CrmSection) => void;
  canAccessClients: boolean;
  initialCrmClientId?: string;
  onClientNavigate: (intent: CrmWhatsAppIntent) => void;
  whatsappConnected: boolean;
  canStartConversation: boolean;
  canPermanentlyDeleteClients: boolean;
}) {
  const denied = (
    <div role="alert" className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Acesso indisponível</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Este submódulo não está disponível para o seu perfil de usuário.
      </p>
    </div>
  );

  let content: React.ReactNode;

  switch (section) {
    case "summary":
      content = <CrmSummaryPage onNavigate={onNavigate} />;
      break;

    case "pipeline":
      content = (
        <PipelinePage
          onNavigate={onNavigate}
          onClientNavigate={onClientNavigate}
          whatsappConnected={whatsappConnected}
          canStartConversation={canStartConversation}
        />
      );
      break;

    case "leads":
      content = (
        <LeadsPage
          onNavigate={onNavigate}
          onClientNavigate={onClientNavigate}
          whatsappConnected={whatsappConnected}
          canStartConversation={canStartConversation}
        />
      );
      break;

    case "clients":
      content = canAccessClients ? (
        <ClientesPage
          initialSelectedId={initialCrmClientId}
          onNavigate={onClientNavigate}
          whatsappConnected={whatsappConnected}
          canStartConversation={canStartConversation}
          canPermanentlyDelete={canPermanentlyDeleteClients}
        />
      ) : (
        denied
      );
      break;

    case "activities":
      content = (
        <CrmPlaceholderPage
          title="Atividades e Tarefas Comerciais"
          stageBadge="Etapa 2B.5 em preparação"
          description="Organização de follow-ups, tarefas, compromissos e histórico de contato com compradores."
          icon={CalendarCheck}
          onBackToSummary={() => onNavigate("summary")}
          highlights={[
            "Agendamento de ligações, reuniões, follow-ups e visitas",
            "Lembretes e notificações de atividades próximas ou atrasadas",
            "Associação direta a oportunidades e clientes",
            "Histórico unificado de interações comerciais por operador",
            "Timeline cronológica automática integrada ao WhatsApp",
          ]}
        />
      );
      break;

    case "proposals":
      content = (
        <CrmPlaceholderPage
          title="Propostas Comerciais"
          stageBadge="Etapa 2B.6 em preparação"
          description="Elaboração e acompanhamento de propostas integradas ao catálogo de produtos e vendas."
          icon={FileText}
          onBackToSummary={() => onNavigate("summary")}
          highlights={[
            "Elaboração de propostas com itens do catálogo de produtos",
            "Envio rápido de PDF / resumo da proposta via WhatsApp",
            "Conversão automática de proposta aprovada em pedido de venda",
            "Acompanhamento de status (rascunho, enviada, aceita, recusada)",
            "Desacoplamento gracioso para clientes que utilizam apenas CRM",
          ]}
        />
      );
      break;

    case "automations":
      content = (
        <CrmPlaceholderPage
          title="Automações e IA Comercial"
          stageBadge="Etapa 2B.7 em preparação"
          description="Automação de processos comerciais e assistência inteligente com Gemini."
          icon={Sparkles}
          onBackToSummary={() => onNavigate("summary")}
          highlights={[
            "Gatilhos automáticos ao mover oportunidade de estágio",
            "Sugestão inteligente de Próxima Melhor Ação (Next Best Action)",
            "Qualificação e extração de dados de conversas com IA (Gemini)",
            "Geração automática de notas e resumos de atendimento",
            "Controle rigoroso de limites de tokens e cotas por tenant",
          ]}
        />
      );
      break;

    case "reports":
      content = (
        <CrmPlaceholderPage
          title="Relatórios e Indicadores Comerciais"
          stageBadge="Etapa 2B.7 em preparação"
          description="Métricas de conversão, produtividade comercial e projeções de receita."
          icon={BarChart3}
          onBackToSummary={() => onNavigate("summary")}
          highlights={[
            "Taxa de conversão por estágio do funil comercial",
            "Ticket médio por vendedor e por canal de aquisição",
            "Tempo médio de ciclo de venda (duração da oportunidade)",
            "Relatório de motivos mais comuns de perda de negócios",
            "Exportação em CSV/PDF para reuniões de alinhamento comercial",
          ]}
        />
      );
      break;

    default:
      content = <CrmSummaryPage onNavigate={onNavigate} />;
  }

  return (
    <div className="min-w-0 max-w-full" data-testid="crm-workspace">
      {content}
    </div>
  );
}
