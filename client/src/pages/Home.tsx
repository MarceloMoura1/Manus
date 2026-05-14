import { useMemo, useState } from "react";
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
} from "lucide-react";

const MEGADESK_SESSION_KEY = "megadesk_session_v1";

type MegaDeskSession = {
  userEmail: string;
  userName: string;
  userRole: string;
  permissions: string[];
  clientId: string;
  company: string;
  plan: string;
  modules: string[];
};

function loadSession(): MegaDeskSession | null {
  try {
    // Tenta primeiro localStorage (lembrar login ativo), depois sessionStorage (sessão temporária)
    const raw = localStorage.getItem(MEGADESK_SESSION_KEY) ?? sessionStorage.getItem(MEGADESK_SESSION_KEY);
    return raw ? (JSON.parse(raw) as MegaDeskSession) : null;
  } catch {
    return null;
  }
}

function saveSession(session: MegaDeskSession) {
  localStorage.setItem(MEGADESK_SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(MEGADESK_SESSION_KEY);
  sessionStorage.removeItem(MEGADESK_SESSION_KEY);
}

type RouteId =
  | "home"
  | "active-attendance"
  | "conversations"
  | "tickets"
  | "tracking"
  | "erp"
  | "settings"
  | "bot-config"
  | "assistant"
  | "notifications";

type IconComponent = React.ComponentType<{ className?: string }>;

// Chave de permissão que controla visibilidade do item (undefined = sempre visível)
type NavItem = {
  id: RouteId;
  label: string;
  icon: IconComponent;
  group: "main" | "tools";
  permission?: string; // se definido, item só aparece se a sessão tiver essa permissão
};

type ConversationStatus = "open" | "bot" | "closed";

type Conversation = {
  id: string;
  name: string;
  phone: string;
  company: string;
  status: ConversationStatus;
  lastMessage: string;
  time: string;
  messages: Array<{ from: "customer" | "agent" | "bot"; text: string; time: string }>;
};

type TicketStatus = "open" | "in_progress" | "waiting" | "closed";

type TicketRecord = {
  id: string;
  company: string;
  customer: string;
  problem: string;
  category: string;
  status: TicketStatus;
  createdAt: string;
  description: string;
};

type BotScript = {
  id: string;
  name: string;
  description: string;
  initialMessage: string;
  active: boolean;
};

// Mapeamento: id do item → chave de permissão no backend
// home, settings, notifications: sem permission (sempre visíveis)
const navItems: NavItem[] = [
  { id: "home",             label: "Home",             icon: HomeIcon,      group: "main" },
  { id: "active-attendance",label: "Atendimento Ativo",icon: PhoneCall,     group: "main", permission: "atendimento_ativo" },
  { id: "conversations",    label: "Conversas",        icon: MessageCircle, group: "main", permission: "conversas" },
  { id: "tickets",          label: "Chamados",         icon: Ticket,        group: "main", permission: "chamados" },
  { id: "tracking",         label: "Rastreio",         icon: MapPin,        group: "main", permission: "rastreio" },
  { id: "erp",              label: "ERP",              icon: PackageSearch, group: "main", permission: "erp" },
  { id: "settings",         label: "Configurações",   icon: Settings,      group: "tools" },
  { id: "bot-config",       label: "Configurar Bot",   icon: Cog,           group: "tools", permission: "configurar_bot" },
  { id: "assistant",        label: "Assistente IA",    icon: Bot,           group: "tools", permission: "assistente_ia" },
  { id: "notifications",    label: "Notificações",    icon: Bell,          group: "tools" },
];

const statusConfig: Record<TicketStatus, { label: string; dot: string; badge: string; card: string }> = {
  open: { label: "🔵 Aberto", dot: "bg-blue-500", badge: "bg-blue-100 text-blue-700", card: "border-l-blue-500" },
  in_progress: { label: "🟡 Em Progresso", dot: "bg-amber-400", badge: "bg-amber-100 text-amber-700", card: "border-l-amber-400" },
  waiting: { label: "⏳ Aguardando", dot: "bg-orange-400", badge: "bg-orange-100 text-orange-700", card: "border-l-orange-400" },
  closed: { label: "✅ Fechado", dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700", card: "border-l-emerald-500" },
};

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function Sidebar({ active, onNavigate, session, onLogout, onToggleTheme, currentTheme }: { active: RouteId; onNavigate: (route: RouteId) => void; session?: MegaDeskSession | null; onLogout?: () => void; onToggleTheme?: () => void; currentTheme?: string }) {
  const [expanded, setExpanded] = useState(false);

  // Filtra itens visíveis com base nas permissões da sessão
  const visibleItems = useMemo(() => {
    const perms = new Set(session?.permissions ?? []);
    return navItems.filter((item) => {
      if (!item.permission) return true; // sem restrição: sempre visível
      return perms.has(item.permission);
    });
  }, [session?.permissions]);

  return (
    <aside className={cn("fixed inset-y-0 left-0 z-30 flex flex-col bg-slate-950 text-white shadow-2xl transition-all duration-300", expanded ? "w-64" : "w-20")}>
      <div className="flex h-20 items-center justify-center border-b border-white/10 px-4">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex h-11 w-full items-center justify-center gap-3 rounded-2xl bg-white/10 text-sm font-bold transition hover:bg-white/15"
          aria-label="Expandir menu"
        >
          <Bot className="h-5 w-5 text-yellow-300" />
          {expanded && <span>MegaDesk</span>}
        </button>
      </div>
      <nav className="flex flex-1 flex-col justify-between overflow-y-auto px-3 py-4">
        <div className="space-y-2">
          {visibleItems.filter((item) => item.group === "main").map((item) => (
            <SidebarButton key={item.id} item={item} active={active === item.id} expanded={expanded} onNavigate={onNavigate} />
          ))}
        </div>
        <div className="space-y-2 border-t border-white/10 pt-4">
          {visibleItems.filter((item) => item.group === "tools").map((item) => (
            <SidebarButton key={item.id} item={item} active={active === item.id} expanded={expanded} onNavigate={onNavigate} />
          ))}
        </div>
      </nav>
      <div className="space-y-2 border-t border-white/10 p-3">
        {session && onLogout && (
          <div className={cn("rounded-2xl bg-white/5 px-3 py-2", expanded ? "text-left" : "text-center")}>
            {expanded ? (
              <>
                <p className="text-xs font-bold text-slate-300 truncate">{session.userName}</p>
                <p className="text-[11px] text-slate-500 truncate">{session.company}</p>
              </>
            ) : (
              <User className="mx-auto h-4 w-4 text-slate-400" />
            )}
          </div>
        )}
        {onToggleTheme && (
          <button
            type="button"
            onClick={onToggleTheme}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-3 py-3 text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white"
            title={`Mudar para modo ${currentTheme === 'light' ? 'escuro' : 'claro'}`}
          >
            {currentTheme === 'light' ? (
              <>
                <span className="text-lg">🌙</span>
                {expanded && <span className="truncate">Modo Escuro</span>}
              </>
            ) : (
              <>
                <span className="text-lg">☀️</span>
                {expanded && <span className="truncate">Modo Claro</span>}
              </>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => navigateToPlatform("megaadmin")}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-3 py-3 text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white"
          title="Abrir URL MegaAdmin"
        >
          {expanded ? <span className="truncate">MegaAdmin separado</span> : <ShieldCheck className="h-4 w-4 text-emerald-300" />}
        </button>
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-900/30 px-3 py-2 text-xs font-bold text-red-300 transition hover:bg-red-900/50"
            title="Sair"
          >
            {expanded ? <span>Sair</span> : <Zap className="h-4 w-4 rotate-180" />}
          </button>
        )}
      </div>
    </aside>
  );
}

function SidebarButton({ item, active, expanded, onNavigate }: { item: NavItem; active: boolean; expanded: boolean; onNavigate: (route: RouteId) => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      title={item.label}
      onClick={() => onNavigate(item.id)}
      className={cn(
        "group flex h-12 w-full items-center rounded-2xl px-3 text-left text-sm font-semibold transition",
        expanded ? "justify-start gap-3" : "justify-center",
        active ? "bg-yellow-400 text-slate-950 shadow-lg shadow-yellow-500/20" : "text-slate-300 hover:bg-white/10 hover:text-white",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      {expanded && <span className="truncate">{item.label}</span>}
    </button>
  );
}

function Shell({ active, setActive, children, session, onLogout }: { active: RouteId; setActive: (route: RouteId) => void; children: React.ReactNode; session?: MegaDeskSession | null; onLogout?: () => void }) {
  const { toggleTheme, theme } = useTheme();
  
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] transition-colors duration-300">
      <Sidebar active={active} onNavigate={setActive} session={session} onLogout={onLogout} onToggleTheme={toggleTheme} currentTheme={theme} />
      <main className="ml-20 min-h-screen px-6 py-6 transition-all lg:px-8">
        <div className="mx-auto max-w-[1440px]">{children}</div>
      </main>
    </div>
  );
}

function PageHeader({ icon: Icon, title, subtitle }: { icon: IconComponent; title: string; subtitle: string }) {
  return (
    <header className="mb-6 flex items-start gap-3">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-sm">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h1 className="text-3xl font-black tracking-tight text-slate-950">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
    </header>
  );
}

function DashboardPage({ setActive, indicadores }: { setActive: (route: RouteId) => void; indicadores?: { conversasAbertas: number; chamadosAbertos: number; tempoMedio: string; resolucaoBot: string } }) {
  const kpiCards = [
    { label: "Conversas Abertas", value: String(indicadores?.conversasAbertas ?? 0), accent: "bg-blue-50 border-blue-200", icon: MessageCircle, note: "em andamento", iconColor: "text-blue-600" },
    { label: "Taxa de Resolução", value: indicadores?.resolucaoBot ?? "0%", accent: "bg-emerald-50 border-emerald-200", icon: CheckCircle2, note: "bot inteligente", iconColor: "text-emerald-600" },
    { label: "Chamados Ativos", value: String(indicadores?.chamadosAbertos ?? 0), accent: "bg-slate-50 border-slate-200", icon: AlertCircle, note: "aguardando", iconColor: "text-slate-600" },
    { label: "Tempo Médio", value: indicadores?.tempoMedio ?? "0m", accent: "bg-slate-50 border-slate-200", icon: Ticket, note: "resposta", iconColor: "text-slate-600" },
  ];

  const quickActions = [
    { title: "Conversas", subtitle: "Central de atendimento", route: "conversations" as RouteId, color: "bg-blue-600 hover:bg-blue-700" },
    { title: "Chamados", subtitle: "Gerenciar tickets", route: "tickets" as RouteId, color: "bg-slate-700 hover:bg-slate-800" },
    { title: "Rastreio", subtitle: "Monitorar atividades", route: "tracking" as RouteId, color: "bg-slate-600 hover:bg-slate-700" },
  ];

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 p-12 shadow-sm border border-slate-200">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div className="space-y-6 animate-fade-in">
            <div className="inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-1.5 border border-blue-200">
              <Zap className="h-3.5 w-3.5 text-blue-600" />
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-700">Plataforma de Atendimento</span>
            </div>
            <div>
              <h1 className="text-5xl font-bold text-slate-900 leading-tight mb-2 animate-slide-up" style={{ animationDelay: '0.1s' }}>
                MegaDesk
              </h1>
              <p className="text-lg text-slate-600 font-medium animate-slide-up" style={{ animationDelay: '0.2s' }}>Sistema Inteligente de Atendimento</p>
            </div>
            <p className="text-base text-slate-600 leading-relaxed max-w-md animate-slide-up" style={{ animationDelay: '0.3s' }}>
              Gerencie conversas WhatsApp, chamados e atendimento com IA em um único lugar.
            </p>
            <div className="flex gap-3 pt-4 animate-slide-up" style={{ animationDelay: '0.4s' }}>
              <button onClick={() => setActive('conversations')} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
                Começar
              </button>
            </div>
          </div>
          <div className="hidden lg:flex items-center justify-center">
            <div className="relative w-48 h-48 bg-gradient-to-br from-blue-100 to-slate-100 rounded-2xl flex items-center justify-center shadow-sm border border-blue-200">
              <Zap className="w-24 h-24 text-blue-600 opacity-60" />
            </div>
          </div>
        </div>
      </section>

      {/* KPI Cards */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className={cn("group relative overflow-hidden rounded-xl p-6 border transition-all duration-300 hover:shadow-md cursor-pointer animate-fade-in bg-white", card.accent)}
              style={{ animationDelay: `${idx * 0.1}s` }}
            >
              <div className="relative">
                <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center mb-4", card.iconColor.replace('text-', 'bg-').replace('-600', '-100'))}>
                  <Icon className={cn("w-5 h-5", card.iconColor)} />
                </div>
                <p className="text-sm font-semibold text-slate-600 uppercase tracking-wide">{card.label}</p>
                <p className="mt-3 text-3xl font-bold text-slate-900">{card.value}</p>
                <p className="mt-2 text-xs font-medium text-slate-500">{card.note}</p>
              </div>
            </div>
          );
        })}
      </section>

      {/* Actions and Activity */}
      <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        {/* Quick Actions */}
        <div className="rounded-xl bg-white p-8 shadow-sm border border-slate-200 animate-fade-in" style={{ animationDelay: '0.4s' }}>
          <h2 className="text-xl font-bold text-slate-900 mb-6">Ações Rápidas</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {quickActions.map((action, idx) => {
              const Icon = action.title === "Conversas" ? MessageCircle : action.title === "Chamados" ? ClipboardList : Zap;
              return (
                <button
                  key={action.route}
                  onClick={() => setActive(action.route)}
                  className={cn(
                    "group relative overflow-hidden rounded-lg p-5 text-left text-white shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-0.5",
                    action.color
                  )}
                  style={{ animationDelay: `${0.4 + idx * 0.1}s` }}
                >
                  <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative z-10">
                    <Icon className="h-6 w-6 mb-2 group-hover:scale-110 transition-transform duration-300" />
                    <p className="text-base font-semibold">{action.title}</p>
                    <p className="text-xs text-white/80 mt-0.5">{action.subtitle}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="rounded-xl bg-white p-8 shadow-sm border border-slate-200 animate-fade-in" style={{ animationDelay: '0.5s' }}>
          <h2 className="text-xl font-bold text-slate-900 mb-6">Atividade Recente</h2>
          <div className="space-y-3">
            {[
              { title: "Novo chamado", desc: "Solicitação de backup", time: "Agora", color: "bg-blue-500" },
              { title: "BOT ativo", desc: "Cliente em triagem", time: "5 min", color: "bg-emerald-500" },
              { title: "Token OK", desc: "MegaAdmin validado", time: "12 min", color: "bg-slate-500" },
            ].map(({ title, desc, time, color }, idx) => (
              <div key={title} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors duration-200 animate-fade-in border border-slate-200" style={{ animationDelay: `${0.5 + idx * 0.1}s` }}>
                <div className={cn("mt-1 h-2 w-2 rounded-full flex-shrink-0", color)} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 text-sm">{title}</p>
                  <p className="text-xs text-slate-600">{desc}</p>
                </div>
                <span className="text-xs font-medium text-slate-500 flex-shrink-0">{time}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function ConversationsPage({ conversations, userEmail }: { conversations: Conversation[]; userEmail: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ConversationStatus>("open");
  const [search, setSearch] = useState("");
  const [reply, setReply] = useState("");
  const sendMessage = trpc.megadesk.sendMessage.useMutation({ onSuccess: () => setReply("") });
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const filtered = conversations.filter((conversation) => conversation.status === filter && `${conversation.phone} ${conversation.name}`.toLowerCase().includes(search.toLowerCase()));

  const filterButtons: Array<{ status: ConversationStatus; label: string; color: string }> = [
    { status: "open", label: "🟢 Abertas", color: "text-emerald-700" },
    { status: "bot", label: "🤖 Atendimento BOT", color: "text-blue-700" },
    { status: "closed", label: "⚫ Fechadas", color: "text-slate-700" },
  ];

  return (
    <div>
      <PageHeader icon={MessageCircle} title="Conversas" subtitle={`${conversations.length} conversas`} />
      <section className="grid min-h-[calc(100vh-8rem)] gap-6 lg:grid-cols-[380px_1fr]">
        <aside className="rounded-[2rem] bg-white p-5 shadow-sm shadow-slate-200/70">
          <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 focus-within:ring-4 focus-within:ring-blue-100">
            <Search className="h-4 w-4" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar número..." className="w-full bg-transparent outline-none" />
          </label>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
            {filterButtons.map((button) => (
              <button key={button.status} type="button" onClick={() => setFilter(button.status)} className={cn("shrink-0 rounded-full px-3 py-2 text-xs font-bold transition", filter === button.status ? "bg-slate-950 text-white" : "bg-slate-100", filter !== button.status && button.color)}>
                {button.label}
              </button>
            ))}
          </div>
          <div className="mt-4 max-h-[620px] space-y-3 overflow-y-auto pr-1">
            {filtered.map((conversation) => (
              <button key={conversation.id} type="button" onClick={() => setSelectedId(conversation.id)} className={cn("w-full rounded-3xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md", selectedId === conversation.id ? "border-blue-300 bg-blue-50" : "border-transparent bg-white hover:border-slate-200")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-slate-950">{conversation.name}</p>
                    <p className="text-sm text-slate-500">{conversation.phone}</p>
                  </div>
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", conversation.status === "closed" ? "bg-slate-100 text-slate-600" : conversation.status === "bot" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700")}>{conversation.status === "closed" ? "Fechada" : conversation.status === "bot" ? "BOT" : "Ativa"}</span>
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-slate-600">{conversation.lastMessage}</p>
                <p className="mt-2 text-xs font-semibold text-slate-400">{conversation.time}</p>
              </button>
            ))}
          </div>
        </aside>
        <main className="rounded-[2rem] bg-white shadow-sm shadow-slate-200/70">
          {selected ? (
            <div className="flex h-full min-h-[680px] flex-col">
              <header className="flex items-center justify-between border-b border-slate-100 p-5">
                <div>
                  <h2 className="text-xl font-black">{selected.name}</h2>
                  <p className="text-sm text-slate-500">{selected.company} · {selected.phone}</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">Atendimento ativo</span>
              </header>
              <div className="flex-1 space-y-4 bg-slate-50/70 p-6">
                {selected.messages.map((message, index) => (
                  <div key={`${message.time}-${index}`} className={cn("flex", message.from === "customer" ? "justify-start" : "justify-end")}>
                    <div className={cn("max-w-[70%] rounded-3xl px-4 py-3 shadow-sm", message.from === "customer" ? "bg-white text-slate-700" : message.from === "bot" ? "bg-yellow-100 text-slate-800" : "bg-blue-600 text-white")}>
                      <p className="text-sm leading-6">{message.text}</p>
                      <p className={cn("mt-1 text-[11px]", message.from === "agent" ? "text-blue-100" : "text-slate-400")}>{message.time}</p>
                    </div>
                  </div>
                ))}
              </div>
              <footer className="flex items-center gap-3 border-t border-slate-100 p-4">
                <input value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Digite uma resposta..." className="h-12 flex-1 rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:ring-4 focus:ring-blue-100" />
                <button type="button" disabled={!selected || !reply.trim() || sendMessage.isPending} onClick={() => selected && sendMessage.mutate({ conversationId: selected.id, message: reply, userEmail })} className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200 disabled:opacity-50"><Send className="h-5 w-5" /></button>
              </footer>
            </div>
          ) : (
            <div className="flex h-full min-h-[680px] flex-col items-center justify-center text-center text-slate-500">
              <MessageCircle className="h-14 w-14 text-slate-300" />
              <p className="mt-4 font-semibold">Selecione uma conversa para visualizar</p>
            </div>
          )}
        </main>
      </section>
    </div>
  );
}

function TicketsPage({ tickets, userEmail }: { tickets: TicketRecord[]; userEmail: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const updateTicket = trpc.megadesk.updateTicketStatus.useMutation();
  const selected = tickets.find((ticket) => ticket.id === selectedId) ?? null;
  const stats = useMemo(() => ({
    total: tickets.length,
    open: tickets.filter((ticket) => ticket.status === "open").length,
    inProgress: tickets.filter((ticket) => ticket.status === "in_progress").length,
    waiting: tickets.filter((ticket) => ticket.status === "waiting").length,
    closed: tickets.filter((ticket) => ticket.status === "closed").length,
  }), [tickets]);

  return (
    <div>
      <PageHeader icon={Ticket} title="Chamados" subtitle="Gerencie todos os chamados de atendimento" />
      <section className="grid gap-4 md:grid-cols-5">
        <StatCard label="Total" value={stats.total} className="bg-slate-950 text-white" />
        <StatCard label="Abertos" value={stats.open} className="bg-blue-50 text-blue-700" />
        <StatCard label="Em Progresso" value={stats.inProgress} className="bg-yellow-50 text-yellow-700" />
        <StatCard label="Aguardando" value={stats.waiting} className="bg-orange-50 text-orange-700" />
        <StatCard label="Fechados" value={stats.closed} className="bg-emerald-50 text-emerald-700" />
      </section>
      <section className="mt-5 rounded-[2rem] bg-white p-4 shadow-sm shadow-slate-200/70">
        <div className="flex flex-col gap-3 md:flex-row">
          <label className="flex flex-1 items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-500">
            <Search className="h-4 w-4" />
            <input placeholder="Buscar por nome, número ou problema..." className="w-full bg-transparent outline-none" />
          </label>
          <select className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 outline-none">
            <option>Todas as categorias</option>
            <option>Suporte</option>
            <option>Comercial</option>
            <option>Financeiro</option>
          </select>
        </div>
      </section>
      <section className="mt-5 grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="max-h-[620px] space-y-3 overflow-y-auto pr-1">
          {tickets.map((ticket) => (
            <button key={ticket.id} type="button" onClick={() => setSelectedId(ticket.id)} className={cn("w-full rounded-[1.5rem] border border-slate-100 border-l-4 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", statusConfig[ticket.status].card, selectedId === ticket.id && "ring-4 ring-blue-100")}>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">N° do chamado</p>
                <span className={cn("h-2.5 w-2.5 rounded-full", statusConfig[ticket.status].dot)} />
              </div>
              <p className="mt-3 text-2xl font-black text-slate-950">{ticket.id}</p>
              <p className="mt-2 flex items-center gap-2 text-sm font-bold text-slate-700"><User className="h-4 w-4" />{ticket.company}</p>
              <p className="mt-4 text-sm leading-6 text-slate-600">{ticket.problem}</p>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div><p className="font-bold text-slate-400">Categoria</p><p className="font-bold text-blue-700">{ticket.category}</p></div>
                <div><p className="font-bold text-slate-400">Status</p><span className={cn("rounded-full px-2 py-1 font-bold", statusConfig[ticket.status].badge)}>{statusConfig[ticket.status].label}</span></div>
              </div>
              <p className="mt-4 text-xs font-semibold text-slate-400">{ticket.createdAt}</p>
            </button>
          ))}
        </aside>
        <main className="min-h-[620px] rounded-[2rem] bg-white p-8 shadow-sm shadow-slate-200/70">
          {selected ? (
            <div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">Chamado {selected.id}</p>
                  <h2 className="mt-2 text-3xl font-black text-slate-950">{selected.problem}</h2>
                  <p className="mt-2 text-slate-500">{selected.company} · {selected.customer}</p>
                </div>
                <span className={cn("rounded-full px-3 py-1 text-sm font-bold", statusConfig[selected.status].badge)}>{statusConfig[selected.status].label}</span>
              </div>
              <div className="mt-8 grid gap-4 md:grid-cols-3">
                <InfoTile label="Categoria" value={selected.category} />
                <InfoTile label="Criado em" value={selected.createdAt} />
                <InfoTile label="Origem" value="WhatsApp" />
              </div>
              <div className="mt-8 rounded-3xl bg-slate-50 p-6">
                <h3 className="font-black">Descrição</h3>
                <p className="mt-3 leading-7 text-slate-600">{selected.description}</p>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <button type="button" disabled={updateTicket.isPending} onClick={() => updateTicket.mutate({ ticketId: selected.id, status: selected.status === "closed" ? "open" : "closed", userEmail })} className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200 disabled:opacity-50">{updateTicket.isPending ? "Atualizando..." : "Atualizar status"}</button>
                <button className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-bold text-slate-700">Adicionar nota</button>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[560px] flex-col items-center justify-center text-center text-slate-500">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-blue-50 text-blue-600"><ClipboardList className="h-8 w-8" /></div>
              <p className="mt-5 text-lg font-black text-slate-900">Selecione um chamado</p>
              <p className="mt-1 text-sm">Clique em um chamado da lista para ver os detalhes</p>
            </div>
          )}
        </main>
      </section>
    </div>
  );
}

function StatCard({ label, value, className }: { label: string; value: number | string; className: string }) {
  return <div className={cn("rounded-[1.3rem] p-5 shadow-sm", className)}><p className="text-2xl font-black">{value}</p><p className="mt-2 text-sm font-semibold opacity-80">{label}</p></div>;
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-3xl bg-slate-50 p-5"><p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{label}</p><p className="mt-2 font-black text-slate-900">{value}</p></div>;
}

function BotConfigPage({ initialScripts }: { initialScripts: BotScript[] }) {
  const [scripts, setScripts] = useState(initialScripts);
  const saveBotScript = trpc.megadesk.saveBotScript.useMutation({ onSuccess: ({ script }) => setScripts((items) => [...items, script]) });
  const [selectedId, setSelectedId] = useState("script-1");
  const selected = scripts.find((script) => script.id === selectedId) ?? scripts[0];

  function activateScript(id: string) {
    setScripts((current) => current.map((script) => ({ ...script, active: script.id === id })));
    setSelectedId(id);
  }

  function removeScript(id: string) {
    setScripts((current) => current.filter((script) => script.id !== id));
    if (selectedId === id) setSelectedId("script-1");
  }

  return (
    <div>
      <PageHeader icon={Bot} title="Configurar Bot & Testador" subtitle="Crie roteiros, edite prompts e teste seu bot em tempo real" />
      <section className="grid gap-6 xl:grid-cols-[280px_280px_1fr]">
        <div className="rounded-[2rem] bg-white p-5 shadow-sm shadow-slate-200/70">
          <h2 className="flex items-center gap-2 text-lg font-black"><Plus className="h-5 w-5" /> Novo Roteiro</h2>
          <div className="mt-5 space-y-4">
            <Field label="Nome" placeholder="Ex: Suporte Técnico" />
            <Field label="Descrição" placeholder="Descrição do roteiro" />
            <Field label="Mensagem Inicial" placeholder="Ex: Olá! Como posso ajudar?" />
            <label className="block text-sm font-bold text-slate-600">Instruções do Bot<textarea placeholder="Digite as instruções para o bot..." className="mt-2 min-h-40 w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:ring-4 focus:ring-blue-100" /></label>
            <button className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200">Salvar</button>
          </div>
        </div>
        <div className="max-h-[680px] space-y-3 overflow-y-auto pr-1">
          {scripts.map((script) => (
            <div key={script.id} className={cn("rounded-[1.4rem] bg-white p-4 shadow-sm shadow-slate-200/70", selected?.id === script.id && "ring-4 ring-blue-100")}>
              <button type="button" onClick={() => setSelectedId(script.id)} className="w-full text-left">
                <div className="flex items-start justify-between gap-3">
                  <div><h3 className="font-black text-slate-950">{script.name}</h3><p className="mt-1 text-sm text-slate-500">{script.description}</p></div>
                  {script.active && <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">Ativo</span>}
                </div>
              </button>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => activateScript(script.id)} className={cn("rounded-xl px-3 py-2 text-xs font-bold", script.active ? "bg-emerald-100 text-emerald-700" : "bg-yellow-100 text-yellow-800")}><Zap className="mr-1 inline h-3.5 w-3.5" />{script.active ? "Ativo" : "Ativar"}</button>
                <button type="button" onClick={() => removeScript(script.id)} className="rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white"><Trash2 className="mr-1 inline h-3.5 w-3.5" />Excluir</button>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-[2rem] bg-white p-5 shadow-sm shadow-slate-200/70">
          <h2 className="flex items-center gap-2 text-lg font-black"><MessageCircle className="h-5 w-5 text-blue-600" /> Testador de Bot</h2>
          <div className="mt-5 flex min-h-[470px] flex-col justify-center rounded-3xl border border-slate-200 bg-slate-50 p-6 text-center text-slate-500">
            <Bot className="mx-auto h-12 w-12 text-slate-300" />
            <p className="mt-4 font-semibold">{selected ? selected.initialMessage : "Selecione um roteiro para começar"}</p>
          </div>
          <div className="mt-4 flex gap-3">
            <input placeholder="Selecione um roteiro primeiro" className="h-12 flex-1 rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:ring-4 focus:ring-blue-100" />
            <button className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white"><Send className="h-5 w-5" /></button>
          </div>
          <button className="mt-3 w-full rounded-2xl bg-slate-100 py-3 text-sm font-bold text-slate-500">Limpar Histórico</button>
        </div>
      </section>
    </div>
  );
}

function Field({ label, placeholder }: { label: string; placeholder: string }) {
  return <label className="block text-sm font-bold text-slate-600">{label}<input placeholder={placeholder} className="mt-2 h-11 w-full rounded-2xl border border-slate-200 px-4 text-sm font-normal outline-none focus:ring-4 focus:ring-blue-100" /></label>;
}

function ActiveAttendancePage() {
  return (
    <ModulePage icon={PhoneCall} title="Atendimento Ativo" subtitle="Inicie um atendimento por telefone, confira contato e abra chamado integrado.">
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="rounded-[2rem] bg-white p-6 shadow-sm shadow-slate-200/70">
          <h2 className="text-xl font-black">Novo atendimento</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Field label="Número WhatsApp" placeholder="Ex: 5511999999999" />
            <Field label="Nome do contato" placeholder="Nome do cliente" />
            <Field label="Empresa" placeholder="Empresa vinculada" />
            <Field label="Título do chamado" placeholder="Resumo do problema" />
          </div>
          <button className="mt-6 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200">Iniciar atendimento</button>
        </div>
        <div className="rounded-[2rem] bg-slate-950 p-6 text-white shadow-xl shadow-slate-200">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-yellow-300">Fluxo sugerido</p>
          <ol className="mt-5 space-y-4 text-sm text-slate-300">
            <li>1. Buscar telefone normalizado.</li>
            <li>2. Confirmar dados do contato.</li>
            <li>3. Criar ou vincular chamado.</li>
            <li>4. Redirecionar para Conversas.</li>
          </ol>
        </div>
      </div>
    </ModulePage>
  );
}

function SimpleGridModule({ icon, title, subtitle, cards }: { icon: IconComponent; title: string; subtitle: string; cards: Array<[string, string]> }) {
  return (
    <ModulePage icon={icon} title={title} subtitle={subtitle}>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {cards.map(([cardTitle, text]) => (
          <div key={cardTitle} className="rounded-[2rem] bg-white p-6 shadow-sm shadow-slate-200/70">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><CheckCircle2 className="h-5 w-5" /></div>
            <h2 className="mt-5 text-xl font-black">{cardTitle}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
          </div>
        ))}
      </div>
    </ModulePage>
  );
}

function ModulePage({ icon, title, subtitle, children }: { icon: IconComponent; title: string; subtitle: string; children: React.ReactNode }) {
  return <div><PageHeader icon={icon} title={title} subtitle={subtitle} />{children}</div>;
}

function MegaDeskLoginGate({ onLogin }: { onLogin: (session: MegaDeskSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [forgotSent, setForgotSent] = useState(false);

  const loginMutation = trpc.megadesk.loginByEmail.useMutation({
    onSuccess: (data) => {
      // Se "Lembrar login" estiver marcado, persiste no localStorage; caso contrário, usa sessionStorage
      if (rememberMe) {
        saveSession(data.session);
      } else {
        sessionStorage.setItem(MEGADESK_SESSION_KEY, JSON.stringify(data.session));
      }
      onLogin(data.session);
    },
    onError: (err) => setError(err.message),
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!email.trim() || !password.trim()) return;
    loginMutation.mutate({ email: email.trim(), password });
  }

  function handleForgot() {
    if (!email.trim()) {
      setError("Digite seu e-mail antes de solicitar recuperação de acesso.");
      return;
    }
    // Abre WhatsApp do suporte com mensagem pré-preenchida contendo o e-mail
    const msg = encodeURIComponent(`Olá! Preciso de ajuda para acessar o MegaDesk. Meu e-mail cadastrado é: ${email.trim()}`);
    window.open(`https://wa.me/5541995484515?text=${msg}`, "_blank", "noopener,noreferrer");
    setForgotSent(true);
    setTimeout(() => setForgotSent(false), 5000);
  }

  const features = [
    { icon: MessageCircle, label: "Atendimento WhatsApp centralizado" },
    { icon: Bot, label: "Triagem inteligente com IA" },
    { icon: ClipboardList, label: "Chamados e histórico unificados" },
  ];

  return (
    <div className="flex min-h-screen bg-white">
      {/* Painel esquerdo — identidade visual */}
      <div className="relative hidden w-[52%] flex-col justify-between overflow-hidden bg-slate-950 p-12 lg:flex">
        {/* Gradiente decorativo animado */}
        <div className="pointer-events-none absolute inset-0">
          <div className="login-orb-1 absolute -left-32 -top-32 h-[500px] w-[500px] rounded-full bg-blue-600/20 blur-[120px]" />
          <div className="login-orb-2 absolute -bottom-40 -right-20 h-[400px] w-[400px] rounded-full bg-cyan-500/15 blur-[100px]" />
          <div className="login-orb-3 absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/10 blur-[80px]" />
        </div>

        {/* Logo */}
        <div className="login-anim-logo relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-900">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-black tracking-tight text-white">MegaDesk</span>
        </div>

        {/* Hero */}
        <div className="relative">
          <p className="login-anim-badge mb-4 inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-blue-300">
            <Sparkles className="h-3.5 w-3.5" /> Plataforma de Atendimento
          </p>
          <h1 className="login-anim-hero text-5xl font-black leading-[1.1] tracking-tight text-white">
            Atendimento<br />
            <span className="login-gradient-text">inteligente</span><br />
            em um lugar só.
          </h1>
          <p className="login-anim-hero mt-6 max-w-sm text-base leading-7 text-slate-400">
            Gerencie conversas WhatsApp, chamados e integrações com IA de forma unificada e segura.
          </p>

          <div className="mt-10 space-y-4">
            {features.map(({ icon: Icon, label }, i) => (
              <div key={label} className={`login-anim-feat-${i} flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.04] px-4 py-3 transition hover:bg-white/[0.08]`}>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/20">
                  <Icon className="h-4 w-4 text-blue-300" />
                </div>
                <span className="text-sm font-medium text-slate-300">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Rodapé esquerdo */}
        <div className="login-anim-footer relative">
          <p className="text-xs text-slate-600">© {new Date().getFullYear()} MegaDesk. Todos os direitos reservados.</p>
        </div>
      </div>

      {/* Painel direito — formulário */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 lg:px-16">
        {/* Logo mobile */}
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-black text-slate-950">MegaDesk</span>
        </div>

        <div className="login-anim-form w-full max-w-[400px]">
          {/* Cabeçalho do form */}
          <div className="mb-8">
            <h2 className="text-3xl font-black text-slate-950">Bem-vindo de volta</h2>
            <p className="mt-2 text-slate-500">Entre com seu e-mail para continuar.</p>
          </div>

          {/* Formulário */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Campo e-mail */}
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">E-mail</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  placeholder="seu@email.com"
                  autoFocus
                  className="h-13 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 pl-11 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
                />
              </div>
            </div>

            {/* Campo senha */}
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">Senha</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  placeholder="Sua senha de acesso"
                  className="h-13 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 pl-11 pr-12 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Lembrar + Esqueceu */}
            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2.5">
                <div
                  onClick={() => setRememberMe((v) => !v)}
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-md border-2 transition",
                    rememberMe ? "border-blue-600 bg-blue-600" : "border-slate-300 bg-white"
                  )}
                >
                  {rememberMe && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
                </div>
                <span className="text-sm text-slate-600">Lembrar meu acesso</span>
              </label>
              <button
                type="button"
                onClick={handleForgot}
                className="text-sm font-semibold text-blue-600 transition hover:text-blue-700"
              >
                Esqueceu o acesso?
              </button>
            </div>

            {/* Feedback de erro */}
            {error && (
              <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-4 py-3">
                <Lock className="h-4 w-4 shrink-0 text-red-500" />
                <p className="text-sm font-semibold text-red-700">{error}</p>
              </div>
            )}

            {/* Feedback de esqueceu senha */}
            {forgotSent && (
              <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 px-4 py-3">
                <Mail className="h-4 w-4 shrink-0 text-emerald-600" />
                <p className="text-sm font-semibold text-emerald-700">Solicitação enviada. Aguarde o contato do suporte.</p>
              </div>
            )}

            {/* Botão entrar */}
            <button
              type="submit"
              disabled={loginMutation.isPending || !email.trim() || !password.trim()}
              className="login-anim-btn group flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 hover:shadow-blue-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              {loginMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Verificando...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Entrar na plataforma
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </span>
              )}
            </button>
          </form>

          {/* Divisor */}
          <div className="my-8 flex items-center gap-4">
            <div className="h-px flex-1 bg-slate-100" />
            <span className="text-xs font-semibold text-slate-400">Precisa de ajuda?</span>
            <div className="h-px flex-1 bg-slate-100" />
          </div>

          {/* Botão suporte */}
          <a
            href="https://wa.me/5541995484515?text=Ol%C3%A1%2C%20preciso%20de%20suporte%20para%20acessar%20o%20MegaDesk."
            target="_blank"
            rel="noopener noreferrer"
            className="login-anim-support flex h-12 w-full items-center justify-center gap-3 rounded-2xl border-2 border-slate-200 bg-white text-sm font-bold text-slate-700 transition hover:border-green-400 hover:bg-green-50 hover:text-green-700 hover:scale-[1.02] active:scale-[0.98]"
          >
            <MessageSquare className="h-4 w-4" />
            Falar com o suporte
          </a>

          {/* Rodapé */}
          <p className="mt-8 text-center text-xs text-slate-400">
            MegaDesk · Powered by MegaAdmin
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [session, setSession] = useState<MegaDeskSession | null>(() => loadSession());
  const [active, setActive] = useState<RouteId>("home");

  const overview = trpc.megadesk.overview.useQuery(
    { clientId: session?.clientId, userEmail: session?.userEmail ?? "" },
    { enabled: !!session }
  );
  const data = overview.data;

  function handleLogout() {
    clearSession();
    setSession(null);
  }

  // Gate de login: exibe a tela de login se não houver sessão ativa
  if (!session) {
    return <MegaDeskLoginGate onLogin={setSession} />;
  }

  return (
    <Shell active={active} setActive={setActive} session={session} onLogout={handleLogout}>
      {overview.isLoading && <div className="rounded-[2rem] bg-white p-8 text-sm font-semibold text-slate-500 shadow-sm">Carregando dados operacionais do servidor...</div>}
      {overview.error && <div className="rounded-[2rem] bg-red-50 p-8 text-sm font-semibold text-red-700">{overview.error.message}</div>}
      {!overview.isLoading && !overview.error && active === "home" && <DashboardPage setActive={setActive} indicadores={data?.indicadores} />}
      {!overview.isLoading && !overview.error && active === "active-attendance" && <ActiveAttendancePage />}
      {!overview.isLoading && !overview.error && active === "conversations" && <ConversationsPage conversations={data?.conversas ?? []} userEmail={session.userEmail} />}
      {!overview.isLoading && !overview.error && active === "tickets" && <TicketsPage tickets={data?.tickets ?? []} userEmail={session.userEmail} />}
      {!overview.isLoading && !overview.error && active === "bot-config" && <BotConfigPage initialScripts={data?.botScripts ?? []} />}
      {active === "tracking" && <SimpleGridModule icon={MapPin} title="Rastreio" subtitle="Acompanhe eventos de mensagens, webhooks e jornada do atendimento." cards={[["Linha do tempo", "Eventos recebidos via WhatsApp e MegaAdmin aparecem organizados por cliente e telefone."], ["Status de webhook", "Monitore sucesso, atraso ou falhas de entrega por integração."], ["Auditoria", "Registre origem, token, módulo e usuário responsável por cada evento operacional."]]} />}
      {active === "erp" && <SimpleGridModule icon={PackageSearch} title="ERP" subtitle="Visão de pedidos, clientes, financeiro e dados operacionais conectados." cards={[["Pedidos", "Consulte pedidos associados ao atendimento em andamento."], ["Financeiro", "Visualize pendências e histórico de cobranças por cliente."], ["Clientes", "Mantenha dados operacionais sincronizados com a conta cadastrada no MegaAdmin."]]} />}
      {active === "settings" && <SimpleGridModule icon={Settings} title="Configurações" subtitle="Parâmetros gerais da plataforma MegaDesk." cards={[["Telefone principal", "Configure a origem oficial de atendimento WhatsApp."], ["Permissões", "Respeite os módulos liberados pelo MegaAdmin para cada usuário."], ["Integração", "Use token de API gerado automaticamente no cadastro do cliente."]]} />}
      {active === "assistant" && <SimpleGridModule icon={Bot} title="Assistente IA" subtitle="Apoio inteligente para triagem, resumo e sugestão de respostas." cards={[["Resumo automático", "A IA resume histórico de conversa e problema relatado."], ["Resposta sugerida", "Sugestões de texto ajudam o operador sem substituir a revisão humana."], ["Classificação", "Intenção, urgência e categoria são identificadas para orientar o chamado."]]} />}
      {active === "notifications" && <SimpleGridModule icon={Bell} title="Notificações" subtitle="Central de alertas de chamados, conversas e integração." cards={[["Chamados críticos", "Receba alertas sobre chamados abertos com prioridade alta."], ["Webhooks", "Monitore entregas recusadas ou atrasadas."], ["Atendimento", "Acompanhe conversas paradas e transferências para humano."]]} />}
    </Shell>
  );
}
