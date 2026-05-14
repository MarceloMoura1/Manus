'use client';

import { navigateToPlatform } from "@/lib/platformRouting";
import { trpc } from "@/lib/trpc";
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
  ChevronLeft,
  LogOut,
} from "lucide-react";
import { useMemo, useState } from "react";

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

// ============================================================================
// NOVO MEGADESK SIDEBAR - INTEGRADO
// ============================================================================

interface MegaDeskSidebarContentProps {
  active: RouteId;
  onNavigate: (route: RouteId) => void;
  session?: MegaDeskSession | null;
  onLogout?: () => void;
  visibleItems: NavItem[];
}

function MegaDeskSidebarContent({
  active,
  onNavigate,
  session,
  onLogout,
  visibleItems,
}: MegaDeskSidebarContentProps) {
  const [expanded, setExpanded] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);

  const mainItems = visibleItems.filter((item) => item.group === "main");
  const toolsItems = visibleItems.filter((item) => item.group === "tools");

  const handleMouseDown = () => {
    setIsResizing(true);
  };

  return (
    <>
      {/* Sidebar */}
      <aside
        className={cn(
          "relative flex flex-col bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-white shadow-2xl transition-all duration-300 border-r border-white/10",
          expanded ? "w-64" : "w-20"
        )}
        style={{ width: expanded ? `${sidebarWidth}px` : "80px" }}
        onMouseMove={(e) => {
          if (!isResizing || !expanded) return;
          const newWidth = e.clientX;
          if (newWidth >= 200 && newWidth <= 480) {
            setSidebarWidth(newWidth);
          }
        }}
        onMouseUp={() => setIsResizing(false)}
        onMouseLeave={() => setIsResizing(false)}
      >
        {/* Detalhe de luz sutil */}
        <div className="absolute inset-0 bg-gradient-to-r from-white/5 via-transparent to-transparent opacity-40 pointer-events-none" />

        {/* Conteúdo do Sidebar */}
        <div className="relative z-10 flex flex-col h-full">
          {/* Header com Logo */}
          <div className="h-16 flex items-center justify-between px-4 border-b border-white/10">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {/* Logo com Raio */}
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg flex-shrink-0">
                <Zap className="w-5 h-5 text-white" />
              </div>

              {expanded && (
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-sm tracking-tight text-white truncate">
                    MegaDesk
                  </span>
                  <span className="text-xs text-blue-300/70 truncate">
                    Platform
                  </span>
                </div>
              )}
            </div>

            {/* Botão de Expandir/Recolher */}
            <button
              onClick={() => setExpanded((v) => !v)}
              className="h-8 w-8 flex items-center justify-center hover:bg-white/10 rounded-lg transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ml-2 flex-shrink-0"
              aria-label="Toggle navigation"
              title={expanded ? "Recolher" : "Expandir"}
            >
              <ChevronLeft
                className={`h-4 w-4 text-white/70 transition-transform duration-300 ${
                  expanded ? "rotate-180" : ""
                }`}
              />
            </button>
          </div>

          {/* Menu Items - Main */}
          <div className="flex-1 overflow-y-auto py-4 px-2 space-y-2">
            {mainItems.map((item) => {
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group relative overflow-hidden",
                    isActive
                      ? "bg-slate-800/50 border border-slate-700 shadow-lg"
                      : "hover:bg-white/5"
                  )}
                  title={expanded ? "" : item.label}
                >
                  {/* Ícone */}
                  <div
                    className={cn(
                      "flex-shrink-0 p-1.5 rounded-lg transition-all duration-200",
                      isActive
                        ? "bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-md"
                        : "text-white/60 group-hover:text-white/80 group-hover:bg-white/10"
                    )}
                  >
                    <item.icon className="w-4 h-4" />
                  </div>

                  {/* Label */}
                  {expanded && (
                    <span
                      className={cn(
                        "text-sm font-medium truncate transition-colors duration-200",
                        isActive ? "text-white" : "text-white/70 group-hover:text-white/90"
                      )}
                    >
                      {item.label}
                    </span>
                  )}

                  {/* Indicador de ativo */}
                  {isActive && expanded && (
                    <div className="ml-auto w-1 h-1 rounded-full bg-gradient-to-r from-blue-400 to-blue-500 shadow-lg" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Menu Items - Tools */}
          {toolsItems.length > 0 && (
            <div className="border-t border-white/10 py-4 px-2 space-y-2">
              {toolsItems.map((item) => {
                const isActive = active === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group relative overflow-hidden",
                      isActive
                        ? "bg-slate-800/50 border border-slate-700 shadow-lg"
                        : "hover:bg-white/5"
                    )}
                    title={expanded ? "" : item.label}
                  >
                    {/* Ícone */}
                    <div
                      className={cn(
                        "flex-shrink-0 p-1.5 rounded-lg transition-all duration-200",
                        isActive
                          ? "bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-md"
                          : "text-white/60 group-hover:text-white/80 group-hover:bg-white/10"
                      )}
                    >
                      <item.icon className="w-4 h-4" />
                    </div>

                    {/* Label */}
                    {expanded && (
                      <span
                        className={cn(
                          "text-sm font-medium truncate transition-colors duration-200",
                          isActive ? "text-white" : "text-white/70 group-hover:text-white/90"
                        )}
                      >
                        {item.label}
                      </span>
                    )}

                    {/* Indicador de ativo */}
                    {isActive && expanded && (
                      <div className="ml-auto w-1 h-1 rounded-full bg-gradient-to-r from-blue-400 to-blue-500 shadow-lg" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-white/10 p-3 space-y-3">
            {session && (
              <div className={cn("rounded-lg bg-white/5 px-3 py-2", expanded ? "text-left" : "text-center")}>
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
            <button
              type="button"
              onClick={() => navigateToPlatform("megaadmin")}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-3 text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white"
              title="Abrir URL MegaAdmin"
            >
              {expanded ? <span className="truncate">MegaAdmin</span> : <ShieldCheck className="h-4 w-4 text-emerald-300" />}
            </button>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-900/30 px-3 py-2 text-xs font-bold text-red-300 transition hover:bg-red-900/50"
                title="Sair"
              >
                {expanded ? <span>Sair</span> : <LogOut className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>

        {/* Divisor de redimensionamento */}
        {expanded && (
          <div
            className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-500/30 transition-colors"
            onMouseDown={handleMouseDown}
            style={{ zIndex: 50 }}
          />
        )}
      </aside>
    </>
  );
}

// ============================================================================
// SHELL - REFATORADA PARA USAR O NOVO SIDEBAR
// ============================================================================

function Shell({ active, setActive, children, session, onLogout }: { active: RouteId; setActive: (route: RouteId) => void; children: React.ReactNode; session?: MegaDeskSession | null; onLogout?: () => void }) {
  // Filtra itens visíveis com base nas permissões da sessão
  const visibleItems = useMemo(() => {
    const perms = new Set(session?.permissions ?? []);
    return navItems.filter((item) => {
      if (!item.permission) return true; // sem restrição: sempre visível
      return perms.has(item.permission);
    });
  }, [session?.permissions]);

  return (
    <div className="flex h-screen bg-[#f6f8fb] text-slate-950">
      <MegaDeskSidebarContent
        active={active}
        onNavigate={setActive}
        session={session}
        onLogout={onLogout}
        visibleItems={visibleItems}
      />
      <main className="flex-1 overflow-y-auto px-6 py-6">
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
  const cards = [
    { label: "Conversas Abertas", value: String(indicadores?.conversasAbertas ?? 0), accent: "from-blue-500 to-cyan-400", note: "dados vindos do servidor" },
    { label: "Atendimento BOT", value: indicadores?.resolucaoBot ?? "0%", accent: "from-yellow-400 to-orange-400", note: "triagem ativa" },
    { label: "Chamados Ativos", value: String(indicadores?.chamadosAbertos ?? 0), accent: "from-emerald-500 to-teal-400", note: "contrato tRPC" },
    { label: "Tempo Médio", value: indicadores?.tempoMedio ?? "0m", accent: "from-purple-500 to-indigo-500", note: "resposta inicial" },
  ];

  const actions: Array<{ title: string; subtitle: string; route: RouteId; icon: IconComponent }> = [
    { title: "Conversas", subtitle: "Abrir central de atendimento", route: "conversations", icon: MessageCircle },
    { title: "Chamados", subtitle: "Gerenciar tickets", route: "tickets", icon: ClipboardList },
    { title: "Configuração", subtitle: "Editar roteiros do bot", route: "bot-config", icon: Cog },
  ];

  return (
    <div>
      <PageHeader icon={HomeIcon} title="Dashboard" subtitle="Visão geral de conversas, chamados e operações." />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{card.label}</p>
            <div className={`bg-gradient-to-r ${card.accent} bg-clip-text text-4xl font-black text-transparent mt-3`}>
              {card.value}
            </div>
            <p className="text-xs text-slate-400 mt-2">{card.note}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {actions.map((action) => (
          <button
            key={action.route}
            onClick={() => setActive(action.route)}
            className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200 text-left hover:shadow-md hover:border-blue-300 transition"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <action.icon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-950">{action.title}</h3>
                <p className="text-xs text-slate-500 mt-1">{action.subtitle}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function SimpleGridModule({
  icon: Icon,
  title,
  subtitle,
  cards,
}: {
  icon: IconComponent;
  title: string;
  subtitle: string;
  cards: Array<[string, string]>;
}) {
  return (
    <div>
      <PageHeader icon={Icon} title={title} subtitle={subtitle} />
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map(([cardTitle, cardDesc]) => (
          <div key={cardTitle} className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200">
            <h3 className="font-semibold text-slate-950">{cardTitle}</h3>
            <p className="text-sm text-slate-500 mt-2">{cardDesc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConversationsPage({
  conversations,
  userEmail,
}: {
  conversations: Conversation[];
  userEmail: string;
}) {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(
    conversations[0] ?? null
  );

  return (
    <div>
      <PageHeader
        icon={MessageCircle}
        title="Conversas"
        subtitle="Central de atendimento com histórico de mensagens."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Lista de Conversas */}
        <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200 lg:col-span-1">
          <h3 className="font-semibold text-slate-950 mb-4">Conversas Ativas</h3>
          <div className="space-y-2">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setSelectedConversation(conv)}
                className={cn(
                  "w-full text-left rounded-lg p-3 transition",
                  selectedConversation?.id === conv.id
                    ? "bg-blue-50 border border-blue-300"
                    : "hover:bg-slate-50 border border-transparent"
                )}
              >
                <p className="font-medium text-sm text-slate-950">{conv.name}</p>
                <p className="text-xs text-slate-500">{conv.phone}</p>
                <p className="text-xs text-slate-400 mt-1 line-clamp-1">{conv.lastMessage}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Detalhes da Conversa */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200 lg:col-span-2">
          {selectedConversation ? (
            <>
              <div className="mb-4 pb-4 border-b border-slate-200">
                <h3 className="font-semibold text-slate-950">{selectedConversation.name}</h3>
                <p className="text-sm text-slate-500">{selectedConversation.phone}</p>
              </div>

              <div className="space-y-3 mb-4 max-h-96 overflow-y-auto">
                {selectedConversation.messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex gap-2",
                      msg.from === "agent" ? "justify-end" : "justify-start"
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-xs rounded-lg p-3 text-sm",
                        msg.from === "agent"
                          ? "bg-blue-500 text-white"
                          : "bg-slate-100 text-slate-950"
                      )}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Digite uma mensagem..."
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 transition">
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </>
          ) : (
            <p className="text-slate-500">Selecione uma conversa para visualizar</p>
          )}
        </div>
      </div>
    </div>
  );
}

function TicketsPage({
  tickets,
  userEmail,
}: {
  tickets: TicketRecord[];
  userEmail: string;
}) {
  const [filter, setFilter] = useState<TicketStatus | "all">("all");

  const filtered =
    filter === "all" ? tickets : tickets.filter((t) => t.status === filter);

  return (
    <div>
      <PageHeader
        icon={Ticket}
        title="Chamados"
        subtitle="Gerenciar tickets de atendimento."
      />

      <div className="mb-6 flex gap-2">
        {(["all", "open", "in_progress", "waiting", "closed"] as const).map(
          (status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium transition",
                filter === status
                  ? "bg-blue-500 text-white"
                  : "bg-white text-slate-950 border border-slate-200 hover:bg-slate-50"
              )}
            >
              {status === "all" ? "Todos" : statusConfig[status]?.label || status}
            </button>
          )
        )}
      </div>

      <div className="space-y-3">
        {filtered.map((ticket) => (
          <div
            key={ticket.id}
            className={cn(
              "rounded-2xl bg-white p-4 shadow-sm border-l-4",
              statusConfig[ticket.status]?.card
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-slate-950">{ticket.problem}</h3>
                <p className="text-sm text-slate-500 mt-1">{ticket.customer}</p>
                <p className="text-xs text-slate-400 mt-1">{ticket.description}</p>
              </div>
              <span
                className={cn(
                  "rounded-lg px-3 py-1 text-xs font-medium whitespace-nowrap",
                  statusConfig[ticket.status]?.badge
                )}
              >
                {statusConfig[ticket.status]?.label}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActiveAttendancePage() {
  return (
    <SimpleGridModule
      icon={PhoneCall}
      title="Atendimento Ativo"
      subtitle="Conversas em tempo real com clientes."
      cards={[
        ["Chamadas Ativas", "Monitore conversas em andamento com clientes."],
        ["Fila de Espera", "Gerencie clientes aguardando atendimento."],
        ["Transferências", "Redirecione para especialistas quando necessário."],
      ]}
    />
  );
}

function BotConfigPage({ initialScripts }: { initialScripts: BotScript[] }) {
  const [scripts, setScripts] = useState<BotScript[]>(initialScripts);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newScript, setNewScript] = useState<Partial<BotScript>>({});

  return (
    <div>
      <PageHeader
        icon={Cog}
        title="Configurar Bot"
        subtitle="Gerencie roteiros e respostas automáticas."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Lista de Scripts */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200 lg:col-span-1">
          <h3 className="font-semibold text-slate-950 mb-4">Scripts Disponíveis</h3>
          <div className="space-y-2">
            {scripts.map((script) => (
              <button
                key={script.id}
                onClick={() => setEditingId(script.id)}
                className={cn(
                  "w-full text-left rounded-lg p-3 transition",
                  editingId === script.id
                    ? "bg-blue-50 border border-blue-300"
                    : "hover:bg-slate-50 border border-transparent"
                )}
              >
                <p className="font-medium text-sm text-slate-950">{script.name}</p>
                <p className="text-xs text-slate-500 mt-1">{script.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Editor de Script */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200 lg:col-span-2">
          {editingId ? (
            <>
              <h3 className="font-semibold text-slate-950 mb-4">Editar Script</h3>
              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="Nome do script"
                  defaultValue={scripts.find((s) => s.id === editingId)?.name}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <textarea
                  placeholder="Descrição"
                  defaultValue={scripts.find((s) => s.id === editingId)?.description}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-24"
                />
                <textarea
                  placeholder="Mensagem inicial"
                  defaultValue={scripts.find((s) => s.id === editingId)?.initialMessage}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-24"
                />
                <button className="w-full rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 transition">
                  Salvar Alterações
                </button>
              </div>
            </>
          ) : (
            <p className="text-slate-500">Selecione um script para editar</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TELA DE LOGIN
// ============================================================================

function MegaDeskLoginGate({ onLogin }: { onLogin: (session: MegaDeskSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const login = trpc.megadesk.loginByEmail.useMutation({
    onSuccess: (data) => {
      const session: MegaDeskSession = {
        userEmail: data.session.userEmail,
        userName: data.session.userName,
        userRole: data.session.userRole,
        permissions: data.session.permissions,
        clientId: data.session.clientId,
        company: data.session.company,
        plan: data.session.plan,
        modules: data.session.modules,
      };
      saveSession(session);
      onLogin(session);
    },
    onError: (err) => {
      setError(err.message || "Erro ao fazer login");
      setLoading(false);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    login.mutate({
      email,
      password,
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-white p-8 shadow-2xl">
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-slate-950">MegaDesk</h1>
              <p className="text-xs text-slate-500">Platform</p>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-slate-950 mb-2">Bem-vindo</h2>
          <p className="text-sm text-slate-500 mb-6">Faça login para acessar a plataforma</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-950 mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-950 mb-2">
                Senha
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-500 px-4 py-2 text-sm font-bold text-white hover:bg-blue-600 transition disabled:opacity-50"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

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
