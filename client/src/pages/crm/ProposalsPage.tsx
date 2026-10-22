import React from "react";
import { SalesPage } from "../erp/SalesPage";
import type { CrmWhatsAppIntent } from "../../../../shared/crm";

export interface ProposalsPageProps {
  onNavigate?: (section: any) => void;
  onClientNavigate?: (intent: CrmWhatsAppIntent) => void;
  onNavigateToClient?: (crmClientId: string) => void;
  whatsappConnected?: boolean;
  canStartConversation?: boolean;
  initialSelectedId?: string;
  onSaleNavigate?: (salePublicId?: string) => void;
}

export function ProposalsPage({
  onNavigate,
  onClientNavigate,
  onNavigateToClient,
  whatsappConnected,
  canStartConversation,
  initialSelectedId,
  onSaleNavigate,
}: ProposalsPageProps) {
  const handleClientNavigate = React.useCallback(
    (crmClientId: string) => {
      if (onNavigateToClient) {
        onNavigateToClient(crmClientId);
        return;
      }
      if (onNavigate) {
        window.history.pushState(null, "", `/crm/clientes?crmClientId=${encodeURIComponent(crmClientId)}`);
        onNavigate("clients");
        return;
      }
      if (onClientNavigate) {
        onClientNavigate({
          crmClientId,
          channel: "whatsapp",
          phone: "",
        });
      }
    },
    [onNavigateToClient, onNavigate, onClientNavigate]
  );

  return (
    <div className="min-w-0" data-testid="crm-proposals-page">
      <SalesPage
        mode="quotes"
        title="Propostas Comerciais"
        eyebrow="CRM Comercial"
        description="Elabore orçamentos com catálogo de produtos, gerencie status comercial e converta em pedidos de venda."
        initialSelectedId={initialSelectedId}
        onSaleNavigate={onSaleNavigate}
        onClientNavigate={handleClientNavigate}
      />
    </div>
  );
}
