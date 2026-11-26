import { describe, expect, it, vi } from "vitest";
import { getCrmTopbarItems } from "../pages/crm/CRMWorkspace";
import { getErpTopbarItems } from "../pages/erp/ERPWorkspace";
import { ALL_MODULE_KEYS, CRM_SECTION_MODULES, ERP_SECTION_MODULES, hasUserPermission, isModuleEnabled } from "@shared/tenant-modules";

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

  it("hides each CRM tab when its module is unchecked and shows it when checked", () => {
    const onNavigate = vi.fn();
    const all = getCrmTopbarItems({ onNavigate, enabledModules: [...ALL_MODULE_KEYS] });
    expect(all.every(i => !i.hidden)).toBe(true);
    for (const { section, key } of CRM_SECTION_MODULES) {
      const items = getCrmTopbarItems({ onNavigate, enabledModules: ALL_MODULE_KEYS.filter(k => k !== key) });
      expect(items.find(i => i.id === section)?.hidden).toBe(true);
      expect(items.filter(i => i.id !== section).every(i => !i.hidden)).toBe(true);
    }
  });

  it("hides each ERP tab when its module is unchecked", () => {
    const onNavigate = vi.fn();
    const base = { canAccessClients: true, canAccessSales: true, canAccessFinance: true, canAccessFiscal: true, canAccessReports: true, onNavigate };
    for (const { section, key } of ERP_SECTION_MODULES) {
      if (section === "clients") continue;
      const items = getErpTopbarItems({ ...base, enabledModules: ALL_MODULE_KEYS.filter(k => k !== key) });
      expect(items.find(i => i.id === section)?.hidden).toBe(true);
    }
  });

  it("shows Atendimento/WhatsApp in the sidebar for backend and MegaAdmin permission names", () => {
    expect(isModuleEnabled(["atendimento"], "atendimento") && hasUserPermission(["conversations"], "conversations")).toBe(true);
    expect(hasUserPermission(["conversas"], "conversations")).toBe(true);
    expect(isModuleEnabled(["chamados"], "atendimento")).toBe(false);
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
