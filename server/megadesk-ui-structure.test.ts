import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const homeSource = readFileSync(resolve(process.cwd(), "client/src/pages/Home.tsx"), "utf8");
const adminPanelSource = readFileSync(resolve(process.cwd(), "client/src/pages/AdminPanel.tsx"), "utf8");
const appSource = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");
const metricWebhookSource = readFileSync(resolve(process.cwd(), "server/metricWebhook.ts"), "utf8");
const dbSource = readFileSync(resolve(process.cwd(), "server/db.ts"), "utf8");

describe("MegaDesk UI structure", () => {
  it("preserva a navegação lateral da referência", () => {
    // Itens sempre visíveis (sem permissão)
    const alwaysVisible = ["Home", "Configurações", "Notificações"];
    // Itens controlados por permissão (7 módulos configurados no MegaAdmin)
    const permissionControlled = [
      "Atendimento Ativo",
      "Conversas",
      "Chamados",
      "Rastreio",
      "ERP",
      "Configurar Bot",
      "Assistente IA",
    ];
    for (const label of [...alwaysVisible, ...permissionControlled]) {
      expect(homeSource).toContain(label);
    }
    // Verifica que o filtro por permissão está implementado
    expect(homeSource).toContain("permission");
    expect(homeSource).toContain("visibleItems");
  });

  it("inclui as telas operacionais centrais alinhadas à referência", () => {
    const expectedTexts = [
      "Dashboard",
      "Visão geral de conversas, chamados e operações",
      "Selecione uma conversa para visualizar",
      "Gerenciar tickets",
      "Editar roteiros do bot",
      "Configurar Bot",
      "Central de atendimento com histórico de mensagens",
    ];

    for (const text of expectedTexts) {
      expect(homeSource).toContain(text);
    }
  });

  it("mantém os estados visuais principais de chamados e conversas", () => {
    expect(homeSource).toContain("🔵 Aberto");
    expect(homeSource).toContain("🟡 Em Progresso");
    expect(homeSource).toContain("⏳ Aguardando");
    expect(homeSource).toContain("✅ Fechado");
    expect(homeSource).toContain("statusConfig");
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
    expect(adminPanelSource).toContain("Liberar acesso");
    expect(adminPanelSource).toContain("Bloquear acesso");
    expect(adminPanelSource).toContain("Rotacionar token");
    expect(adminPanelSource).toContain("Remover");
    expect(adminPanelSource).toContain("megaadmin.createClient");
    expect(adminPanelSource).toContain("megaadmin.updateClientAccess");
    expect(adminPanelSource).toContain("megaadmin.summary");

    // MegaDesk menciona o MegaAdmin como plataforma separada
    expect(homeSource).toContain("MegaAdmin");
    // MegaDesk tem login próprio
    expect(homeSource).toContain("MegaDeskLoginGate");
    expect(homeSource).toContain("loginByEmail");
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

  it("implementa novo sidebar com expand/collapse e logo com raio", () => {
    // Novo componente MegaDeskSidebarContent
    expect(homeSource).toContain("MegaDeskSidebarContent");
    // Logo com raio (Zap)
    expect(homeSource).toContain("Zap");
    expect(homeSource).toContain("MegaDesk");
    expect(homeSource).toContain("Platform");
    // Toggle expand/collapse
    expect(homeSource).toContain("expanded");
    expect(homeSource).toContain("setExpanded");
    // Detalhe de luz sutil
    expect(homeSource).toContain("from-white/5");
    // Sincronização com permissões
    expect(homeSource).toContain("visibleItems");
    expect(homeSource).toContain("permission");
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
