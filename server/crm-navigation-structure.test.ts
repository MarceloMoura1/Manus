import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCrmTopbarItems, type CrmSection } from "../client/src/pages/crm/CRMWorkspace";

const homeSource = readFileSync(resolve(process.cwd(), "client/src/pages/Home.tsx"), "utf8");
const crmWorkspaceSource = readFileSync(resolve(process.cwd(), "client/src/pages/crm/CRMWorkspace.tsx"), "utf8");
const crmSummarySource = readFileSync(resolve(process.cwd(), "client/src/pages/crm/CrmSummaryPage.tsx"), "utf8");
const crmPlaceholderSource = readFileSync(resolve(process.cwd(), "client/src/pages/crm/CrmPlaceholderPage.tsx"), "utf8");

describe("MegaDesk CRM — Etapa 2B.1: Shell e Navegação", () => {
  it("adiciona a entrada principal CRM na sidebar com ícone Users e rota crm-summary", () => {
    expect(homeSource).toContain('{ id: "crm-summary" as RouteId, label: "CRM", icon: Users }');
    expect(homeSource).toContain('item.id.startsWith("crm-")');
    expect(homeSource).toContain('session.permissions.includes("crm")');
  });

  it("protege a navegação por rota exigindo permissão dedicada crm sem depender de admin/manager", () => {
    // Verifica que o filtro de navegação da sidebar exige session.permissions.includes("crm")
    expect(homeSource).toContain('if (item.id.startsWith("crm-")) return session.permissions.includes("crm");');

    // Verifica que existe guarda de rota ativa no Home.tsx para redirecionar acessos diretos não autorizados
    expect(homeSource).toContain('active.startsWith("crm-") && !session.permissions.includes("crm")');
    expect(homeSource).toContain('navigateToRoute("home", { replace: true })');

    // Verifica que o acesso à aba de clientes do CRM respeita a permissão de clientes do CRM
    expect(homeSource).toContain('active === "crm-clients" && !canAccessCrmClients(session)');
    expect(homeSource).toContain('navigateToRoute("crm-summary", { replace: true })');
  });

  it("mapeia as rotas e URLs internas do CRM no histórico e na inicialização da aplicação", () => {
    const expectedRoutes = [
      "crm-summary",
      "crm-pipeline",
      "crm-leads",
      "crm-clients",
      "crm-activities",
      "crm-proposals",
      "crm-automations",
      "crm-reports",
    ];

    for (const route of expectedRoutes) {
      expect(homeSource).toContain(route);
    }

    const expectedPaths = [
      "/crm",
      "/crm/funil",
      "/crm/leads",
      "/crm/clientes",
      "/crm/atividades",
      "/crm/propostas",
      "/crm/automacoes",
      "/crm/relatorios",
    ];

    for (const path of expectedPaths) {
      expect(homeSource).toContain(path);
    }
  });

  it("integra o ModuleTopbar com as seções do CRM sem duplicar o shell geral", () => {
    expect(homeSource).toContain('active.startsWith("crm-") ? "Módulos do CRM"');
    expect(homeSource).toContain('active.startsWith("crm-") ? crmSection : undefined');
    expect(homeSource).toContain('active.startsWith("crm-") ? crmTopbarItems : []');
    expect(homeSource).toContain("<CRMWorkspace");
  });

  it("fornece itens de topbar para todas as áreas planejadas do CRM na ordem correta", () => {
    const selected: CrmSection[] = [];
    const items = getCrmTopbarItems({
      onNavigate: (section) => selected.push(section),
    });

    const itemIds = items.map((i) => i.id);
    expect(itemIds).toEqual([
      "summary",
      "pipeline",
      "leads",
      "clients",
      "activities",
      "proposals",
      "automations",
      "reports",
    ]);

    // Test selection callback
    items.find((i) => i.id === "pipeline")?.onSelect();
    expect(selected).toContain("pipeline");
  });

  it("reutiliza ClientesPage existente sem duplicar código ou perder dados", () => {
    expect(crmWorkspaceSource).toContain('import { ClientesPage } from "../ClientesPage"');
    expect(crmWorkspaceSource).toContain("<ClientesPage");
  });

  it("não apresenta dados fictícios como métricas reais no resumo comercial", () => {
    // Verifica que CrmSummaryPage não usa dados falsos hardcoded como R$ 150.000 ou 42 vendas
    expect(crmSummarySource).not.toContain("R$ 150.000");
    expect(crmSummarySource).not.toContain("R$ 450.000");
    expect(crmSummarySource).not.toContain("42 vendas");
    // Verifica presença de indicadores honestos de estado inicial
    expect(crmSummarySource).toContain('"0"');
    expect(crmSummarySource).toContain('"R$ 0,00"');
    expect(crmSummarySource).toContain("Nenhuma oportunidade em andamento");
    expect(crmSummarySource).toContain("Aguardando entrada de contatos");
    expect(crmSummarySource).toContain("Sem tarefas agendadas para hoje");
    expect(crmSummarySource).toContain("Fase 1 Auditada");
  });

  it("contém placeholders honestos para submódulos em construção e badges de etapa", () => {
    expect(crmPlaceholderSource).toContain("Funcionalidades planejadas no roteiro arquitetural");
    expect(crmPlaceholderSource).toContain("Voltar ao Resumo");
    expect(crmWorkspaceSource).toContain("em preparação");
  });
});
