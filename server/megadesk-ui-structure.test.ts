import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const homeSource = readFileSync(resolve(process.cwd(), "client/src/pages/Home.tsx"), "utf8");
const adminPanelSource = readFileSync(resolve(process.cwd(), "client/src/pages/AdminPanel.tsx"), "utf8");
const appSource = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");
const metricWebhookSource = readFileSync(resolve(process.cwd(), "server/metricWebhook.ts"), "utf8");
const dbSource = readFileSync(resolve(process.cwd(), "server/db.ts"), "utf8");
const botConfigSource = readFileSync(resolve(process.cwd(), "client/src/pages/BotConfigPage.tsx"), "utf8");
const erpSource = readFileSync(resolve(process.cwd(), "client/src/pages/erp/ERPWorkspace.tsx"), "utf8");
const suppliersSource = readFileSync(resolve(process.cwd(), "client/src/pages/erp/SuppliersPage.tsx"), "utf8");
const purchasesSource = readFileSync(resolve(process.cwd(), "client/src/pages/erp/PurchasesPage.tsx"), "utf8");
const fiscalSource = readFileSync(resolve(process.cwd(), "client/src/pages/erp/FiscalPage.tsx"), "utf8");
const reportsSource = readFileSync(resolve(process.cwd(), "client/src/pages/erp/ReportsPage.tsx"), "utf8");
const moduleTopbarSource = readFileSync(resolve(process.cwd(), "client/src/components/ModuleTopbar.tsx"), "utf8");
const conversationDetailsSource = readFileSync(resolve(process.cwd(), "client/src/components/ConversationDetailsPanel.tsx"), "utf8");
const clientsPageSource = readFileSync(resolve(process.cwd(), "client/src/pages/ClientesPage.tsx"), "utf8");

describe("MegaDesk UI structure", () => {
  it("keeps a single real ERP implementation without legacy fictional metrics", () => {
    expect(homeSource).not.toContain("function ERPPage()");
    expect(homeSource).not.toContain("Vendas Hoje");
    expect(homeSource).not.toContain("Pedido #PED-100");
    expect(erpSource).toContain("trpc.erp.summary.useQuery");
    expect(erpSource).toContain("trpc.erp.products.list.useQuery");
    expect(erpSource).toContain("trpc.erp.stock.list.useQuery");
    expect(erpSource).toContain("erp:supplier.changed");
    expect(suppliersSource).toContain("trpc.erp.suppliers.list.useQuery");
    expect(erpSource).toContain('label:"Fornecedores"');
    expect(purchasesSource).toContain("trpc.erp.purchases.list.useQuery");
    expect(erpSource).toContain('label:"Compras"');
    expect(erpSource).toContain('{id:"sales" as const,label:"Vendas"}');
    expect(erpSource).toContain('label:"Financeiro"');
    expect(erpSource).toContain('label:"Fiscal"');
    expect(erpSource).toContain('label:"Relatórios"');
    expect(reportsSource).toContain("Relatórios essenciais");
    expect(fiscalSource).toContain("Emissão fiscal eletrônica ainda não configurada.");
    expect(erpSource).toContain('const planned = ["Integrações"]');
    expect(homeSource).not.toContain('label: "Fornecedores"');
    expect(homeSource).toContain("<ModuleTopbar");
    expect(moduleTopbarSource).toContain("overflow-x-auto");
    expect(moduleTopbarSource).toContain('aria-current={isActive ? "page" : undefined}');
    expect(moduleTopbarSource).toContain("item.hidden");
    expect(moduleTopbarSource).toContain("item.disabled");
  });
  it("preserva a navegação lateral da referência", () => {
    // Itens sempre visíveis (sem permissão)
    const alwaysVisible = ["Home", "Configurações", "Notificações"];
    // Itens controlados por permissão (7 módulos configurados no MegaAdmin)
    const permissionControlled = [
      "Atendimento",
      "Chamados",
      "Rastreio",
      "ERP",
      "Configurar Bot",
      "Assistente IA",
    ];
    for (const label of [...alwaysVisible, ...permissionControlled]) {
      expect(homeSource).toContain(label);
    }
    expect(homeSource).toContain('{ id: "conversations" as RouteId, label: "Atendimento", icon: MessageCircle }');
    expect(homeSource).not.toContain('label: "Atendimento Ativo"');
    expect(homeSource).not.toContain('label: "Conversas"');
    // Verifica que o filtro por permissão está implementado
    expect(homeSource).toContain("permission");
    expect(homeSource).toContain("filteredNavItems");
    expect(homeSource).toContain("navItems.filter");
  });

  it("inclui as telas operacionais centrais alinhadas à referência", () => {
    const expectedTexts = [
      "Atendimento Inteligente em Um Lugar",
      "Conversas Abertas",
      "Atividades Recentes",
      "Selecione uma conversa",
      "Chamados Ativos",
      "Novo Chamado",
    ];

    for (const text of expectedTexts) {
      expect(homeSource).toContain(text);
    }
    expect(botConfigSource).toContain("Novo Roteiro");
    expect(botConfigSource).toContain("Teste do Roteiro");
  });

  it("mantém os estados visuais principais de chamados e conversas", () => {
    expect(homeSource).toContain("id: 'open', label: 'Abertos'");
    expect(homeSource).toContain("id: 'in_progress', label: 'Em Progresso'");
    expect(homeSource).toContain("id: 'waiting', label: 'Aguardando'");
    expect(homeSource).toContain("id: 'closed', label: 'Fechados'");
    expect(homeSource).toContain("selectedConv.status === 'open'");
  });

  it("preserva o contrato visual unificado de Atendimento com controles do lifecycle", () => {
    expect(homeSource).toContain('active === "conversations" && <ConversationsPage attendanceLaunch={attendanceLaunch} attendancePhone={activeAttendancePhone} />');
    expect(homeSource).not.toContain('active === "conversations" && <ConversasPage />');
    expect(homeSource).toContain("min-[900px]:w-[420px]");
    expect(homeSource).toContain('data-testid="conversation-list-panel"');
    expect(homeSource).toContain('data-testid="conversation-chat-panel"');
    expect(homeSource).toContain('data-testid="conversation-composer"');
    expect(homeSource).toContain("['all', 'mine']");
    for (const label of ["Filtro", "Todos", "Meus", "Novo atendimento", "BOT/Aguardando", "Encerradas", "Assumir", "Transferir", "Abrir detalhes da conversa", "Fechar detalhes da conversa"]) {
      expect(homeSource).toContain(label);
    }
    expect(homeSource).toContain('data-testid="attendance-primary-controls"');
    expect(homeSource).toContain('data-testid="attendance-action-controls"');
    expect(homeSource).toContain('data-testid="attendance-scope-controls"');
    expect(homeSource).toContain('className="whitespace-nowrap">Novo atendimento</span>');
    expect(homeSource).not.toContain('<span>Abertas</span>');
    expect(homeSource).not.toContain('openCount');
    expect(homeSource).toContain('data-testid="new-attendance-composer"');
    expect(homeSource).toContain("<ActiveAttendancePage");
    expect(homeSource).toContain("embedded");
    expect(homeSource).not.toContain("Mais ações");
    for (const label of ["Atendimento", "Contato", "Cliente", "Chamados", "Histórico de conversas", "Copiar ID da conversa", "Empresa informada"]) {
      expect(conversationDetailsSource).toContain(label);
    }
    expect(conversationDetailsSource).not.toContain("Adicionar empresa");
    expect(conversationDetailsSource).not.toContain("Editar empresa informada");
    expect(conversationDetailsSource).not.toContain("Remover empresa informada");
    expect(homeSource).not.toContain("Modal de Edição de Cliente");
    expect(conversationDetailsSource).toContain("trpc.conversations.updateContact.useMutation");
    expect(conversationDetailsSource).toContain("enabled: open && linking && crmSearchIsReady");
    expect(conversationDetailsSource).toContain('aria-expanded={linking}');
    expect(conversationDetailsSource).toContain('aria-controls="crm-link-search"');
    expect(conversationDetailsSource).toContain('placeholder="Digite o nome da pessoa ou empresa"');
    expect(conversationDetailsSource).toContain("closeCrmSearch");
    expect(conversationDetailsSource).toContain("crmSearchInputRef.current?.focus()");
    expect(conversationDetailsSource).toContain("crmLinkButtonRef.current?.focus()");
    expect(conversationDetailsSource).toContain("canManageClients && <button");
    expect(conversationDetailsSource).not.toContain("item.document ?");
    expect(conversationDetailsSource).not.toContain("item.phone ?");
    expect(conversationDetailsSource).not.toContain('item.customerType === "person"');
    expect(clientsPageSource).toContain("editableClient(editData)");
    expect(clientsPageSource).toContain('const visualString = (value: unknown)');
    expect(clientsPageSource).toContain('setSubmitError("Revise os campos destacados.")');
    expect(clientsPageSource).toContain('const message = "Não foi possível salvar o cliente. Tente novamente."');
    expect(clientsPageSource).not.toContain("error instanceof Error ? error.message");
    expect(homeSource).toContain("<ConversationMedia");
    expect(homeSource).toContain("isAgent && <p");
    expect(homeSource).toContain("operatorDisplayName(msg)");
    expect(homeSource).not.toContain("!isAgent && <p className=\"text-xs text-slate-400 mt-1 ml-1\"");
  });

  it("inclui MegaAdmin e MegaDesk como duas URLs lógicas com backend único", () => {
    // App.tsx roteia /admin → AdminPanel e / → Home
    expect(appSource).toContain("isAdminRoute");
    expect(appSource).toContain("/admin");
    expect(appSource).toContain("AdminPanel");
    expect(appSource).toContain("httpBatchLink");
    expect(appSource).toContain("/api/trpc");

    // AdminPanel tem as funcionalidades administrativas
    expect(adminPanelSource).toContain("MegaAdmin");
    expect(adminPanelSource).toContain("Cadastrar novo cliente");
    expect(adminPanelSource).toContain("Liberar empresa");
    expect(adminPanelSource).toContain("colocado em quarentena");
    expect(adminPanelSource).toContain("Rotacionar token");
    expect(adminPanelSource).toContain("Remover");
    expect(adminPanelSource).toContain("megaadmin.createClient");
    expect(adminPanelSource).toContain("megaadmin.reactivateClient");
    expect(adminPanelSource).toContain("megaadmin.releaseClientAccess");
    expect(adminPanelSource).toContain("megaadmin.summary");

    // MegaDesk menciona o MegaAdmin como plataforma separada
    expect(homeSource).toContain("MegaAdmin");
  });

  it("implementa gate de login administrativo no AdminPanel com fluxo OAuth Manus", () => {
    // Tela de login com OAuth
    expect(adminPanelSource).toContain("LoginScreen");
    expect(adminPanelSource).toContain("Entrar como Administrador");
    expect(adminPanelSource).toContain("getAdminLoginUrl");
    expect(adminPanelSource).toContain("VITE_OAUTH_PORTAL_URL");
    expect(adminPanelSource).toContain("VITE_APP_ID");
    expect(adminPanelSource).toContain("/admin");
    expect(adminPanelSource).toContain("/api/oauth/callback");

    // Tela de acesso negado
    expect(adminPanelSource).toContain("AccessDeniedScreen");
    expect(adminPanelSource).toContain("Acesso restrito");

    // Detecção de auth state via trpc.auth.me
    expect(adminPanelSource).toContain("trpc.auth.me.useQuery");
    expect(adminPanelSource).toContain("authQuery");
    expect(adminPanelSource).toContain("role");
    expect(adminPanelSource).toContain("admin");
  });

  it("exige métricas persistentes por tenant e token no webhook operacional", () => {
    expect(metricWebhookSource).toContain("validateMegaDeskClientToken");
    expect(metricWebhookSource).toContain("recordMegaDeskMetric");
    expect(metricWebhookSource).toContain("persisted: true");
    expect(metricWebhookSource).toContain("tenantDatabaseName");
    expect(metricWebhookSource).toContain("status(403)");
    expect(dbSource).toContain("megadesk_domain_metrics");
    expect(dbSource).toContain("idx_mdbs_client");
  });
});
