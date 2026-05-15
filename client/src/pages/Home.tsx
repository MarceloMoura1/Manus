import React, { useState, useEffect } from "react";
import { navigateToPlatform } from "@/lib/platformRouting";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";
import {
  ArrowRight,
  Bell,
  Bot,
  CheckCircle2,
  ClipboardList,
  Cog,
  Eye,
  EyeOff,
  Home as HomeIcon,
  Lock,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  MessageSquare,
  PackageSearch,
  PhoneCall,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trash2,
  User,
  Zap,
  AlertCircle,
  X,
} from "lucide-react";

const MEGADESK_SESSION_KEY = "megadesk_session_v1";

type MegaDeskSession = {
  clientId: string;
  clientName: string;
  permissions: string[];
  userId: string;
  userName: string;
  userEmail: string;
  userCompany: string;
};

type RouteId = "home" | "active-attendance" | "conversations" | "tickets" | "tracking" | "erp" | "settings" | "bot-config" | "ai-assistant" | "notifications";

const cn = (...classes: any[]) => classes.filter(Boolean).join(" ");

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="space-y-4 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 animate-pulse">
          <Zap className="w-8 h-8 text-blue-600" />
        </div>
        <p className="text-slate-600 font-medium">Carregando dados operacionais do servidor...</p>
      </div>
    </div>
  );
}

function AccessDeniedPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100">
          <AlertCircle className="w-8 h-8 text-red-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900">Acesso Negado</h2>
        <p className="text-slate-600">Usuário sem acesso ativo neste cliente.</p>
      </div>
    </div>
  );
}

function DashboardPage({ setActive, indicadores }: { setActive: (route: RouteId) => void; indicadores?: { conversasAbertas: number; chamadosAbertos: number; tempoMedio: string; resolucaoBot: string } }) {
  const kpiCards = [
    { label: "Conversas Abertas", value: String(indicadores?.conversasAbertas ?? 0), icon: MessageCircle, note: "em andamento" },
    { label: "Taxa de Resolução", value: indicadores?.resolucaoBot ?? "0%", icon: CheckCircle2, note: "bot inteligente" },
    { label: "Chamados Ativos", value: String(indicadores?.chamadosAbertos ?? 0), icon: AlertCircle, note: "aguardando" },
    { label: "Tempo Médio", value: indicadores?.tempoMedio ?? "0m", icon: Ticket, note: "resposta" },
  ];

  const quickActions = [
    { title: "Conversas", subtitle: "Central de atendimento", route: "conversations" as RouteId },
    { title: "Chamados", subtitle: "Gerenciar tickets", route: "tickets" as RouteId },
    { title: "Rastreio", subtitle: "Monitorar atividades", route: "tracking" as RouteId },
  ];

  return (
    <div className="space-y-6">
      {/* Hero Section - Profissional e Estilizado */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 p-16 shadow-2xl">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-slate-500 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10 grid gap-12 lg:grid-cols-2 lg:items-center">
          <div className="space-y-8 animate-fade-in">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-3 rounded-full bg-blue-500/20 backdrop-blur px-4 py-2 border border-blue-400/30">
                <Zap className="h-4 w-4 text-blue-300 animate-pulse" />
                <span className="text-sm font-semibold uppercase tracking-wider text-blue-200">Plataforma Inteligente</span>
              </div>
              <h1 className="text-7xl font-black text-white leading-tight animate-slide-up" style={{ animationDelay: '0.1s' }}>
                Mega<span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">Desk</span>
              </h1>
              <p className="text-2xl text-blue-100 font-semibold animate-slide-up" style={{ animationDelay: '0.2s' }}>Atendimento Inteligente em Um Lugar</p>
            </div>
            <p className="text-lg text-slate-300 leading-relaxed max-w-lg animate-slide-up" style={{ animationDelay: '0.3s' }}>
              Gerencie conversas WhatsApp, chamados, rastreio e atendimento com IA. Tudo integrado e sincronizado.
            </p>
            <div className="flex gap-4 pt-4 animate-slide-up" style={{ animationDelay: '0.4s' }}>
              <button onClick={() => setActive('conversations')} className="px-8 py-3 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-blue-500/50 hover:-translate-y-1 active:scale-95">
                Acessar Dashboard
              </button>
              <button className="px-8 py-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl border border-white/30 transition-all duration-200 backdrop-blur hover:shadow-lg">
                Documentação
              </button>
            </div>
          </div>
          <div className="hidden lg:flex items-center justify-center animate-float">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-400 to-cyan-300 rounded-3xl blur-2xl opacity-40 animate-pulse" />
              <div className="relative bg-gradient-to-br from-blue-400 to-cyan-300 rounded-3xl p-12 shadow-2xl flex items-center justify-center">
                <Zap className="w-40 h-40 text-white opacity-90 animate-bounce" style={{ animationDuration: '2s' }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* KPI Cards - Profissionais */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="group relative overflow-hidden rounded-2xl bg-white p-8 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 cursor-pointer animate-fade-in border border-slate-100"
              style={{ animationDelay: `${idx * 0.1}s` }}
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-blue-400/10 to-cyan-300/10 rounded-full blur-2xl group-hover:from-blue-400/20 group-hover:to-cyan-300/20 transition-all duration-300" />
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-100 to-cyan-100 flex items-center justify-center group-hover:from-blue-200 group-hover:to-cyan-200 transition-all duration-300">
                    <Icon className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
                <p className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-2">{card.label}</p>
                <p className="text-4xl font-black text-slate-900 mb-1">{card.value}</p>
                <p className="text-xs font-medium text-slate-500">{card.note}</p>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-400 to-cyan-300 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
            </div>
          );
        })}
      </section>

      {/* Actions and Activity - Profissional */}
      <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Quick Actions */}
        <div className="rounded-2xl bg-white p-10 shadow-lg border border-slate-100 animate-fade-in" style={{ animationDelay: '0.4s' }}>
          <h2 className="text-2xl font-bold text-slate-900 mb-8">Atalhos Principais</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {quickActions.map((action, idx) => {
              const Icon = action.title === "Conversas" ? MessageCircle : action.title === "Chamados" ? ClipboardList : Zap;
              return (
                <button
                  key={action.route}
                  onClick={() => setActive(action.route)}
                  className="group relative overflow-hidden rounded-2xl p-6 text-left text-white shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 active:scale-95 bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800"
                  style={{ animationDelay: `${0.4 + idx * 0.1}s` }}
                >
                  <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full blur-xl group-hover:bg-white/20 transition-all duration-300" />
                  <div className="relative z-10">
                    <Icon className="h-8 w-8 mb-3 group-hover:scale-125 transition-transform duration-300" />
                    <p className="text-lg font-bold">{action.title}</p>
                    <p className="text-sm text-white/90 mt-1">{action.subtitle}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="rounded-2xl bg-white p-10 shadow-lg border border-slate-100 animate-fade-in" style={{ animationDelay: '0.5s' }}>
          <h2 className="text-2xl font-bold text-slate-900 mb-8">Atividades Recentes</h2>
          <div className="space-y-4">
            {[
              { title: "Novo chamado", desc: "Solicitação de backup", time: "Agora", color: "bg-blue-500" },
              { title: "BOT ativo", desc: "Cliente em triagem", time: "5 min", color: "bg-emerald-500" },
              { title: "Token OK", desc: "MegaAdmin validado", time: "12 min", color: "bg-slate-500" },
            ].map(({ title, desc, time, color }, idx) => (
              <div key={title} className="flex items-start gap-3 p-4 rounded-xl bg-gradient-to-r from-slate-50 to-slate-100 hover:from-slate-100 hover:to-slate-200 transition-all duration-200 animate-fade-in border border-slate-200 group cursor-pointer" style={{ animationDelay: `${0.5 + idx * 0.1}s` }}>
                <div className={cn("mt-1 h-3 w-3 rounded-full flex-shrink-0 group-hover:scale-125 transition-transform duration-300", color)} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-900 text-sm">{title}</p>
                  <p className="text-xs text-slate-600 mt-0.5">{desc}</p>
                </div>
                <span className="text-xs font-semibold text-slate-600 flex-shrink-0 bg-white px-2 py-1 rounded-lg group-hover:bg-blue-50 transition-colors duration-200">{time}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function ConversationsPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Conversas</h2>
        <p className="text-slate-600">Central de atendimento com histórico de mensagens.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white rounded-2xl shadow-lg p-6 border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-4">Conversas Ativas</h3>
          <div className="space-y-2">
            <div className="p-3 rounded-lg bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors">
              <p className="font-semibold text-slate-900">Cliente A</p>
              <p className="text-xs text-slate-600">Última mensagem: 2 min</p>
            </div>
          </div>
        </div>
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-lg p-6 border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-4">Conversa</h3>
          <p className="text-slate-600">Selecione uma conversa para visualizar</p>
        </div>
      </div>
    </div>
  );
}

function TicketsPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Chamados</h2>
        <p className="text-slate-600">Gerenciar e acompanhar todos os chamados abertos.</p>
      </div>
    </div>
  );
}

function TrackingPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Rastreio</h2>
        <p className="text-slate-600">Monitorar atividades e status dos atendimentos.</p>
      </div>
    </div>
  );
}

function ERPPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">ERP</h2>
        <p className="text-slate-600">Integração com sistema de gestão empresarial.</p>
      </div>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Configurações</h2>
        <p className="text-slate-600">Personalize sua experiência no MegaDesk.</p>
      </div>
    </div>
  );
}

function BotConfigPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Configurar Bot</h2>
        <p className="text-slate-600">Treine e configure o bot de IA.</p>
      </div>
    </div>
  );
}

function AIAssistantPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Assistente IA</h2>
        <p className="text-slate-600">Converse com o assistente inteligente.</p>
      </div>
    </div>
  );
}

function NotificationsPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Notificações</h2>
        <p className="text-slate-600">Gerencie suas notificações e alertas.</p>
      </div>
    </div>
  );
}

function ActiveAttendancePage() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Atendimento Ativo</h2>
        <p className="text-slate-600">Acompanhe os atendimentos em tempo real.</p>
      </div>
    </div>
  );
}

function Shell() {
  const { theme, toggleTheme } = useTheme();
  const [active, setActive] = useState<RouteId>("home");
  const [session, setSession] = useState<MegaDeskSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [indicadores, setIndicadores] = useState<any>(null);

  const loginMutation = trpc.megadesk.loginByEmail.useMutation();

  useEffect(() => {
    const storedSession = localStorage.getItem(MEGADESK_SESSION_KEY);
    if (storedSession) {
      try {
        const parsed = JSON.parse(storedSession);
        setSession(parsed);
      } catch (e) {
        console.error("Failed to parse session:", e);
        // Criar sessão de teste automática
        const testSession: MegaDeskSession = {
          clientId: "test-client-001",
          clientName: "Empresa Teste",
          permissions: ["conversations", "tickets", "tracking", "erp", "bot-config", "ai-assistant"],
          userId: "user-001",
          userName: "Usuário Teste",
          userEmail: "teste@megadesk.com",
          userCompany: "MegaDesk",
        };
        localStorage.setItem(MEGADESK_SESSION_KEY, JSON.stringify(testSession));
        setSession(testSession);
      }
    } else {
      // Criar sessão de teste automática quando não houver sessão
      const testSession: MegaDeskSession = {
        clientId: "test-client-001",
        clientName: "Empresa Teste",
        permissions: ["conversations", "tickets", "tracking", "erp", "bot-config", "ai-assistant"],
        userId: "user-001",
        userName: "Usuário Teste",
        userEmail: "teste@megadesk.com",
        userCompany: "MegaDesk",
      };
      localStorage.setItem(MEGADESK_SESSION_KEY, JSON.stringify(testSession));
      setSession(testSession);
    }
    setLoading(false);
  }, []);

  if (loading) return <LoadingSpinner />;
  if (!session) return <AccessDeniedPage />;

  const navItems = [
    { id: "home" as RouteId, label: "Home", icon: HomeIcon },
    { id: "active-attendance" as RouteId, label: "Atendimento Ativo", icon: PhoneCall },
    { id: "conversations" as RouteId, label: "Conversas", icon: MessageCircle },
    { id: "tickets" as RouteId, label: "Chamados", icon: ClipboardList },
    { id: "tracking" as RouteId, label: "Rastreamento", icon: MapPin },
    { id: "erp" as RouteId, label: "ERP", icon: PackageSearch },
    { id: "settings" as RouteId, label: "Configurações", icon: Cog },
    { id: "bot-config" as RouteId, label: "Configurar Bot", icon: Bot },
    { id: "ai-assistant" as RouteId, label: "Assistente IA", icon: Sparkles },
    { id: "help" as RouteId, label: "Ajuda", icon: AlertCircle },
    { id: "notifications" as RouteId, label: "Notificações", icon: Bell },
  ];

  const filteredNavItems = navItems.filter(item => {
    if (["home", "active-attendance", "settings", "help", "notifications"].includes(item.id)) return true;
    return session.permissions.includes(item.id);
  });

  // Separar itens em seções
  const mainNavItems = filteredNavItems.filter(item => !["settings", "bot-config", "ai-assistant", "help", "notifications"].includes(item.id));
  const settingsNavItems = filteredNavItems.filter(item => ["settings", "bot-config", "ai-assistant", "help", "notifications"].includes(item.id));

  return (
    <div className={`flex h-screen bg-slate-50 ${theme === 'dark' ? 'dark bg-slate-950' : ''}`}>
      {/* Sidebar */}
      <div className={cn(
        "fixed lg:relative z-40 h-full bg-slate-950 text-white flex flex-col transition-all duration-300",
        sidebarOpen ? "w-64" : "w-20"
      )}>
        {/* Header com Logo */}
        <div className="p-4 flex items-center justify-between transition-all duration-300">
          {sidebarOpen ? (
            <>
              <div className="flex items-center gap-2 overflow-hidden">
                <Zap className="w-6 h-6 text-blue-400 flex-shrink-0" />
                <span className="font-bold text-xl whitespace-nowrap transition-opacity duration-300">
                  MegaDesk
                </span>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-slate-400 hover:text-white transition-colors flex-shrink-0"
                title="Fechar menu"
              >
                <X className="w-5 h-5" />
              </button>
            </>
          ) : (
            <button
              onClick={() => setSidebarOpen(true)}
              className="w-full flex items-center justify-center text-slate-400 hover:text-white transition-colors py-2"
              title="Abrir menu"
            >
              <Menu className="w-6 h-6" />
            </button>
          )}
        </div>

        {/* Faixa de luz roxo minimalista */}
        <div className={cn(
          "bg-gradient-to-r from-purple-600/0 via-purple-500 to-purple-600/0 transition-all duration-300 my-2",
          sidebarOpen ? "h-1 mx-4" : "h-px mx-2"
        )}></div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1 pt-8">
          {mainNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            
            return (
              <button
                key={item.id}
                onClick={() => setActive(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 py-3 rounded-lg transition-all duration-300 relative",
                  sidebarOpen ? "justify-start px-4" : "justify-center px-0",
                  isActive
                    ? "bg-gradient-to-r from-purple-600 to-magenta-600 text-white shadow-lg"
                    : "text-slate-300 hover:text-white hover:bg-slate-800/50"
                )}
                title={item.label}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {sidebarOpen && (
                  <span className="text-base font-medium transition-opacity duration-300 overflow-hidden whitespace-nowrap">
                    {item.label}
                  </span>
                )}
                {/* Indicador de notificacoes */}
                {item.id === "notifications" && (
                  <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full"></span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Separador */}
        <div className="border-t border-slate-800"></div>

        {/* Settings Section */}
        <nav className="p-3 space-y-1">
          {settingsNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            
            return (
              <button
                key={item.id}
                onClick={() => setActive(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 py-3 rounded-lg transition-all duration-300 relative",
                  sidebarOpen ? "justify-start px-4" : "justify-center px-0",
                  isActive
                    ? "bg-gradient-to-r from-purple-600 to-magenta-600 text-white shadow-lg"
                    : "text-slate-300 hover:text-white hover:bg-slate-800/50"
                )}
                title={item.label}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {sidebarOpen && (
                  <span className="text-base font-medium transition-opacity duration-300 overflow-hidden whitespace-nowrap">
                    {item.label}
                  </span>
                )}
                {/* Indicador de notificacoes */}
                {item.id === "notifications" && (
                  <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full"></span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Separador */}
        <div className="border-t border-slate-800"></div>

        {/* Bottom Actions */}
        <div className="p-3 space-y-1">
          <button
            onClick={toggleTheme}
            className={cn(
              "w-full flex items-center gap-3 py-3 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/50 transition-all duration-200",
              sidebarOpen ? "justify-start px-4" : "justify-center px-0"
            )}
            title={`Mudar para modo ${theme === 'light' ? 'escuro' : 'claro'}`}
          >
            {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            {sidebarOpen && <span className="text-base font-medium">{theme === 'light' ? 'Modo Escuro' : 'Modo Claro'}</span>}
          </button>
          
          {/* Logout Button */}
          <button
            onClick={() => {
              localStorage.removeItem(MEGADESK_SESSION_KEY);
              setSession(null);
            }}
            className={cn(
              "w-full flex items-center gap-3 py-3 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-900/20 transition-all duration-200",
              sidebarOpen ? "justify-start px-4" : "justify-center px-0"
            )}
            title="Sair"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {sidebarOpen && <span className="text-base font-medium">Sair</span>}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{navItems.find(i => i.id === active)?.label || 'MegaDesk'}</h1>
            <p className="text-sm text-slate-600">{session.clientName} • {session.userName}</p>
          </div>
          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors" title="Abrir assistente IA">
              <Sparkles className="w-6 h-6 text-slate-600" />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-8">
          {active === "home" && <DashboardPage setActive={setActive} indicadores={indicadores} />}
          {active === "conversations" && <ConversationsPage />}
          {active === "tickets" && <TicketsPage />}
          {active === "tracking" && <TrackingPage />}
          {active === "erp" && <ERPPage />}
          {active === "settings" && <SettingsPage />}
          {active === "bot-config" && <BotConfigPage />}
          {active === "ai-assistant" && <AIAssistantPage />}
          {active === "notifications" && <NotificationsPage />}
          {active === "active-attendance" && <ActiveAttendancePage />}
        </main>
      </div>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 lg:hidden z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}

// Import Moon and Sun icons
const Moon = (props: any) => (
  <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
  </svg>
);

const Sun = (props: any) => (
  <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1m-16 0H1m15.364 1.636l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

export function Home() {
  return <Shell />;
}
