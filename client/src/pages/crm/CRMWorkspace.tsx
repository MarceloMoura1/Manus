import React from "react";
import type { ModuleTopbarItem } from "@/components/ModuleTopbar";
import { ClientesPage } from "../ClientesPage";
import type { CrmWhatsAppIntent } from "../../../../shared/crm";
import { CrmSummaryPage } from "./CrmSummaryPage";
import { ActivitiesPage } from "./ActivitiesPage";
import { ProposalsPage } from "./ProposalsPage";
import { AutomationsPage } from "./AutomationsPage";
import { ReportsPage } from "./ReportsPage";
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
    { id: "clients" as const, label: "Clientes", onSelect: () => onNavigate("clients") },
    { id: "proposals" as const, label: "Propostas", onSelect: () => onNavigate("proposals") },
    { id: "leads" as const, label: "Leads", onSelect: () => onNavigate("leads") },
    { id: "pipeline" as const, label: "Funil de Vendas", onSelect: () => onNavigate("pipeline") },
    { id: "automations" as const, label: "Automações e IA", onSelect: () => onNavigate("automations") },
    { id: "activities" as const, label: "Atividades", onSelect: () => onNavigate("activities") },
    { id: "reports" as const, label: "Relatórios", onSelect: () => onNavigate("reports") },
  ];

  return items;
}

export function CRMWorkspace({
  section,
  onNavigate,
  canAccessClients,
  initialCrmClientId,
  initialSalePublicId,
  onClientNavigate,
  onNavigateToClient,
  onNavigateToSale,
  whatsappConnected,
  canStartConversation,
  canPermanentlyDeleteClients,
}: {
  section: CrmSection;
  onNavigate: (section: CrmSection) => void;
  canAccessClients: boolean;
  initialCrmClientId?: string;
  initialSalePublicId?: string;
  onClientNavigate: (intent: CrmWhatsAppIntent) => void;
  onNavigateToClient?: (crmClientId: string) => void;
  onNavigateToSale?: (salePublicId?: string) => void;
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
        <ActivitiesPage
          onNavigate={onNavigate}
          onClientNavigate={onClientNavigate}
          whatsappConnected={whatsappConnected}
          canStartConversation={canStartConversation}
        />
      );
      break;

    case "proposals":
      content = (
        <ProposalsPage
          onNavigate={onNavigate}
          onClientNavigate={onClientNavigate}
          onNavigateToClient={onNavigateToClient}
          whatsappConnected={whatsappConnected}
          canStartConversation={canStartConversation}
          initialSelectedId={initialSalePublicId}
          onSaleNavigate={onNavigateToSale}
        />
      );
      break;

    case "automations":
      content = <AutomationsPage />;
      break;

    case "reports":
      content = <ReportsPage />;
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
