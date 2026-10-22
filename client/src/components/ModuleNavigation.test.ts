import { describe, expect, it, vi } from "vitest";
import { getCrmTopbarItems } from "../pages/crm/CRMWorkspace";
import { getErpTopbarItems } from "../pages/erp/ERPWorkspace";

describe("Module Navigation — CRM and ERP tab ordering", () => {
  it("enforces the mandatory CRM navigation sequence", () => {
    const onNavigate = vi.fn();
    const items = getCrmTopbarItems({ onNavigate });
    const sequence = items.map(item => ({ id: item.id, label: item.label }));

    expect(sequence).toEqual([
      { id: "summary", label: "Resumo" },
      { id: "clients", label: "Clientes" },
      { id: "proposals", label: "Propostas" },
      { id: "leads", label: "Leads" },
      { id: "pipeline", label: "Funil de Vendas" },
      { id: "automations", label: "Automações e IA" },
      { id: "activities", label: "Atividades" },
      { id: "reports", label: "Relatórios" },
    ]);

    items.forEach(item => {
      expect(item.icon).toBeDefined();
    });

    const automationsItem = items.find(i => i.id === "automations");
    expect(automationsItem?.badge).toBeDefined();
  });

  it("enforces the mandatory ERP navigation sequence with Fornecedores at the end", () => {
    const onNavigate = vi.fn();
    const items = getErpTopbarItems({
      canAccessClients: false,
      canAccessSales: true,
      canAccessFinance: true,
      canAccessFiscal: true,
      canAccessReports: true,
      onNavigate,
    });

    const activeItems = items
      .filter(item => !item.hidden && !item.disabled)
      .map(item => ({ id: item.id, label: item.label }));

    expect(activeItems).toEqual([
      { id: "summary", label: "Resumo" },
      { id: "products", label: "Produtos" },
      { id: "services", label: "Serviços" },
      { id: "stock", label: "Estoque" },
      { id: "sales", label: "Vendas" },
      { id: "purchases", label: "Compras" },
      { id: "finance", label: "Financeiro" },
      { id: "fiscal", label: "Fiscal" },
      { id: "reports", label: "Relatórios" },
      { id: "suppliers", label: "Fornecedores" },
    ]);

    items
      .filter(item => !item.disabled)
      .forEach(item => {
        expect(item.icon).toBeDefined();
      });
  });
});
