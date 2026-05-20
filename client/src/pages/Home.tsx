import React, { useState, useEffect } from "react";
import { navigateToPlatform } from "@/lib/platformRouting";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { validateNewChamado, ValidationError } from "@/lib/validations";
import { ActiveAttendancePage } from "./ActiveAttendance";
import { ClientesPage } from "./ClientesPage";
import { ConversasPage } from "./ConversasPage";
import { WhatsAppConfigPage } from "./WhatsAppConfigPage";
import { SettingsPage as SettingsPageComponent } from "./SettingsPage";
import { AdminSettingsPage } from "./AdminSettingsPage";
import { BotConfigPage } from "./BotConfigPage";
import { TimelineActivity } from "@/components/TimelineActivity";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowRight,
  Bell,
  Bot,
  CheckCircle2,
  Clock,
  ClipboardList,
  Cog,
  Eye,
  EyeOff,
  Home as HomeIcon,
  Hourglass,
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
  Edit2,
  Building2,
  Smartphone,
  Tag,
  ChevronDown,
  Calendar,
  Filter,
} from "lucide-react";

const MEGADESK_SESSION_KEY = "megadesk_session_v1";
const MEGADESK_ACTIVE_PAGE_KEY = "megadesk_active_page_v1";

function loadSession(): MegaDeskSession | null {
  try {
    const raw = localStorage.getItem(MEGADESK_SESSION_KEY) ?? sessionStorage.getItem(MEGADESK_SESSION_KEY);
    if (!raw) return null;
    
    const session = JSON.parse(raw) as MegaDeskSession;
    
    // Se a sessão expirou, limpar e retornar null
    if (isSessionExpired(session)) {
      clearSession();
      return null;
    }
    
    return session;
  } catch {
    clearSession();
    return null;
  }
}

function saveSession(session: MegaDeskSession, rememberMe?: boolean) {
  // Adicionar timestamps de expiração se não existirem
  const now = Date.now();
  // rememberMe controla apenas a duração: 30 dias vs 24 horas
  // Sempre salvar no localStorage para persistir após F5
  const duration = rememberMe ? SESSION_DURATION_LONG : SESSION_DURATION;
  const sessionWithTimestamps: MegaDeskSession = {
    ...session,
    expiresAt: session.expiresAt || now + duration,
    refreshedAt: session.refreshedAt || now,
  };
  localStorage.setItem(MEGADESK_SESSION_KEY, JSON.stringify(sessionWithTimestamps));
  return sessionWithTimestamps;
}

function isSessionExpired(session: MegaDeskSession | null): boolean {
  if (!session || !session.expiresAt) return false;
  return Date.now() > session.expiresAt;
}

function shouldRefreshSession(session: MegaDeskSession | null): boolean {
  if (!session || !session.expiresAt) return false;
  const timeUntilExpiry = session.expiresAt - Date.now();
  return timeUntilExpiry < REFRESH_THRESHOLD;
}

function clearSession() {
  localStorage.removeItem(MEGADESK_SESSION_KEY);
  sessionStorage.removeItem(MEGADESK_SESSION_KEY);
}

type MegaDeskSession = {
  clientId: string;
  company: string;
  permissions: string[];
  userName: string;
  userEmail: string;
  userRole: 'admin' | 'manager' | 'agent' | 'viewer';
  role?: 'admin' | 'user'; // Compatibilidade com sistema de roles
  plan: string;
  modules: string[];
  // Token refresh management
  expiresAt?: number; // timestamp em ms quando a sessão expira
  refreshedAt?: number; // timestamp em ms da última renovação
};

// Constantes para renovação de token
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 horas em ms (padrão sem "lembrar")
const SESSION_DURATION_LONG = 30 * 24 * 60 * 60 * 1000; // 30 dias ("lembrar meu acesso")
const REFRESH_THRESHOLD = 5 * 60 * 1000; // Renovar 5 minutos antes de expirar
const REFRESH_INTERVAL = 10 * 60 * 1000; // Verificar renovação a cada 10 minutos

type RouteId = "home" | "active-attendance" | "conversations" | "tickets" | "tracking" | "erp" | "settings" | "bot-config" | "ai-assistant" | "notifications" | "clients" | "whatsapp-config" | "admin-settings";

type Ticket = {
  id: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  customerName?: string;
  company?: string;
  assignedTo?: string;
  activities: Array<{
    id: string;
    description: string;
    attendant: string;
    date: number; // timestamp em millisegundos
    actionType?: string;
  }>;
};

type ClientUser = {
  userId: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'agent' | 'viewer';
  status: 'active' | 'blocked';
};

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

function LoginPage({ onLoginSuccess }: { onLoginSuccess: (session: MegaDeskSession) => void }) {
  // Renderiza a função MegaDeskLoginGate definida mais abaixo
  return <MegaDeskLoginGate onLogin={onLoginSuccess} />;
}

function DashboardPage({ setActive, indicadores }: { setActive: (route: RouteId) => void; indicadores?: { conversasAbertas: number; chamadosAbertos: number; tempoMedio: string; resolucaoBot: string } }) {
  const kpiCards = [
    { label: "Conversas Abertas", value: String(indicadores?.conversasAbertas ?? 0), icon: MessageCircle, note: "em andamento", gradient: "from-emerald-400 to-teal-600", bgGradient: "from-emerald-50 to-teal-50", iconBg: "from-emerald-100 to-teal-100", iconColor: "text-emerald-600" },
    { label: "Taxa de Resolução", value: indicadores?.resolucaoBot ?? "0%", icon: CheckCircle2, note: "bot inteligente", gradient: "from-violet-400 to-purple-600", bgGradient: "from-violet-50 to-purple-50", iconBg: "from-violet-100 to-purple-100", iconColor: "text-violet-600" },
    { label: "Chamados Ativos", value: String(indicadores?.chamadosAbertos ?? 0), icon: AlertCircle, note: "aguardando", gradient: "from-orange-400 to-red-600", bgGradient: "from-orange-50 to-red-50", iconBg: "from-orange-100 to-red-100", iconColor: "text-orange-600" },
    { label: "Tempo Médio", value: indicadores?.tempoMedio ?? "0m", icon: Ticket, note: "resposta", gradient: "from-blue-400 to-indigo-600", bgGradient: "from-blue-50 to-indigo-50", iconBg: "from-blue-100 to-indigo-100", iconColor: "text-blue-600" },
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

      {/* KPI Cards - Estilizados e Animados */}
      <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card: any, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className={`group relative overflow-hidden rounded-3xl bg-gradient-to-br ${card.bgGradient} p-8 shadow-xl hover:shadow-2xl transition-all duration-500 hover:-translate-y-2 cursor-pointer animate-fade-in border border-white/40 backdrop-blur-sm`}
              style={{ animationDelay: `${idx * 0.1}s` }}
            >
              <div className={`absolute -top-12 -right-12 w-40 h-40 bg-gradient-to-br ${card.gradient} rounded-full blur-3xl opacity-20 group-hover:opacity-30 transition-all duration-500 animate-pulse`} />
              <div className={`absolute -bottom-12 -left-12 w-40 h-40 bg-gradient-to-tr ${card.gradient} rounded-full blur-3xl opacity-15 group-hover:opacity-25 transition-all duration-500`} style={{ animationDelay: '0.5s' }} />
              
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent transform -skew-x-12" style={{ animation: 'shimmer 2s infinite' }} />
              </div>
              
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-6">
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${card.iconBg} flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-lg`}>
                    <Icon className={`w-8 h-8 ${card.iconColor} group-hover:animate-bounce`} style={{ animationDuration: '0.6s' }} />
                  </div>
                  <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${card.gradient} animate-pulse`} />
                </div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3 opacity-75">{card.label}</p>
                <p className={`text-5xl font-black bg-gradient-to-r ${card.gradient} bg-clip-text text-transparent mb-2 group-hover:scale-105 transition-transform duration-300 origin-left`}>{card.value}</p>
                <p className="text-sm font-semibold text-slate-600 group-hover:text-slate-700 transition-colors">{card.note}</p>
              </div>
              
              <div className={`absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r ${card.gradient} transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left`} />
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
  // Obter dados da sessão
  const sessionData = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem(MEGADESK_SESSION_KEY) || 'null'); } catch { return null; }
  }, []);
  const clientId: string = sessionData?.clientId ?? '';
  const userName: string = sessionData?.userName ?? 'Atendente';

  const [searchTerm, setSearchTerm] = React.useState('');
  const [selectedFilter, setSelectedFilter] = React.useState<'open' | 'bot' | 'closed'>('open');
  const [ownerFilter, setOwnerFilter] = React.useState<'all' | 'mine' | 'history'>('all');
  const [attendantFilter, setAttendantFilter] = React.useState<string>('');
  const [historySearch, setHistorySearch] = React.useState<string>('');
  const [attendantDropdownOpen, setAttendantDropdownOpen] = React.useState(false);
  // Filtro por data
  const [dateFilterOpen, setDateFilterOpen] = React.useState(false);
  const [dateFrom, setDateFrom] = React.useState<string>('');
  const [dateTo, setDateTo] = React.useState<string>('');
  const [selectedConversation, setSelectedConversation] = React.useState<string | null>(null);
  const [conversations, setConversations] = React.useState<any[]>([]);
  const [messageInput, setMessageInput] = React.useState('');
  const [editModalOpen, setEditModalOpen] = React.useState(false);
  const [editName, setEditName] = React.useState('');
  const [editCompany, setEditCompany] = React.useState('');
  const [closeConfirmOpen, setCloseConfirmOpen] = React.useState(false);
  const [reopenConfirmOpen, setReopenConfirmOpen] = React.useState(false);
  const [toastMessage, setToastMessage] = React.useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Mutations tRPC
  const closeConversationMutation = trpc.megadesk.closeConversation.useMutation();
  const updateCustomerMutation = trpc.megadesk.updateCustomerInfo.useMutation();

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ message, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleCloseConversation = async () => {
    if (!selectedConversation) return;
    setCloseConfirmOpen(false);
    setConversations(prev => prev.map(conv =>
      conv.id === selectedConversation ? { ...conv, status: 'closed' } : conv
    ));
    showToast('Conversa encerrada!', 'success');
    try {
      await closeConversationMutation.mutateAsync({ conversationId: selectedConversation, clientId });
    } catch {
      setConversations(prev => prev.map(conv =>
        conv.id === selectedConversation ? { ...conv, status: 'open' } : conv
      ));
      showToast('Erro ao encerrar conversa', 'error');
    }
  };

  const handleReopenConversation = async () => {
    if (!selectedConversation) return;
    setConversations(prev => prev.map(conv =>
      conv.id === selectedConversation ? { ...conv, status: 'open' } : conv
    ));
    setReopenConfirmOpen(false);
    showToast('Conversa reaberta com sucesso!', 'success');
  };

  React.useEffect(() => {
    const newConvId = localStorage.getItem('MEGADESK_NEW_CONVERSATION_ID');
    const newConvPhone = localStorage.getItem('MEGADESK_NEW_CONVERSATION_PHONE');
    if (newConvId && newConvPhone) {
      setSelectedConversation(newConvId);
      setSelectedFilter('open');
      localStorage.removeItem('MEGADESK_NEW_CONVERSATION_ID');
      localStorage.removeItem('MEGADESK_NEW_CONVERSATION_PHONE');
    } else {
      const hash = window.location.hash;
      const queryStart = hash.indexOf('?');
      if (queryStart !== -1) {
        const params = new URLSearchParams(hash.substring(queryStart + 1));
        const cId = params.get('clientId');
        const phone = params.get('phone');
        if (cId && phone) {
          setSelectedConversation(cId);
          window.history.replaceState({}, document.title, window.location.pathname + '#/conversas');
        }
      }
    }
  }, []);

  const { data: conversationsData } = trpc.megadesk.getConversations.useQuery(
    { clientId },
    { enabled: !!clientId, refetchInterval: 5000, refetchOnWindowFocus: true }
  );

  React.useEffect(() => {
    if (conversationsData) {
      setConversations(conversationsData);
    }
  }, [conversationsData]);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedConversation]);

  const filters: Array<{ id: 'open' | 'bot' | 'closed'; label: string; dot: string; count: number }> = [
    { id: 'open', label: 'Abertas', dot: 'bg-emerald-500', count: conversations.filter(c => c.status === 'open').length },
    { id: 'bot', label: 'BOT', dot: 'bg-violet-500', count: conversations.filter(c => c.status === 'bot').length },
    { id: 'closed', label: 'Fechadas', dot: 'bg-slate-400', count: conversations.filter(c => c.status === 'closed').length },
  ];

  // Buscar todos os usuários ativos do cliente
  const { data: activeUsersData } = trpc.megadesk.getActiveUsers.useQuery(
    { clientId },
    { enabled: !!clientId }
  );

  // Lista de atendentes (todos os usuários ativos)
  const attendants = React.useMemo(() => {
    if (!activeUsersData) return [];
    return activeUsersData.map(u => u.name).filter(Boolean);
  }, [activeUsersData]);

  // Modo Histórico: busca em TODAS as conversas (abertas + fechadas + bot), sem filtro de status
  const isHistoryMode = ownerFilter === 'history';

  // Helper: converte timestamp de conversa para Date
  const convToDate = (conv: any): Date | null => {
    if (!conv.timestamp) return null;
    if (typeof conv.timestamp === 'number') return new Date(conv.timestamp);
    if (typeof conv.timestamp === 'string') {
      const d = new Date(conv.timestamp);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  };

  // Verifica se o filtro por data está ativo
  const hasDateFilter = dateFrom !== '' || dateTo !== '';

  const filteredConversations = conversations.filter(conv => {
    // Filtro por data (aplica em todos os modos)
    if (hasDateFilter) {
      const d = convToDate(conv);
      if (!d) return false;
      const convDate = d.toISOString().slice(0, 10);
      if (dateFrom && convDate < dateFrom) return false;
      if (dateTo && convDate > dateTo) return false;
      // Dentro do periodo: aplica busca adicional
      const q = searchTerm.toLowerCase();
      if (searchTerm.trim() === '') return true;
      return (
        conv.name?.toLowerCase().includes(q) ||
        conv.company?.toLowerCase().includes(q) ||
        conv.phone?.includes(searchTerm)
      );
    }

    if (isHistoryMode) {
      // Histórico: ignora filtro de status, busca em tudo pelo termo de histórico
      if (historySearch.trim() === '') return true;
      const q = historySearch.toLowerCase();
      return (
        conv.name?.toLowerCase().includes(q) ||
        conv.company?.toLowerCase().includes(q) ||
        conv.phone?.includes(historySearch)
      );
    }
    const matchesFilter = conv.status === selectedFilter;
    const matchesSearch = searchTerm === '' ||
      conv.phone?.includes(searchTerm) ||
      conv.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      conv.company?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesOwner =
      ownerFilter === 'all' ? true :
      ownerFilter === 'mine' ? (conv.assignedTo === userName || conv.assignedTo === sessionData?.userId) :
      true;
    return matchesFilter && matchesSearch && matchesOwner;
  });

  const selectedConv = conversations.find(c => c.id === selectedConversation);

  const formatTime = (ts: any) => {
    if (!ts) return '';
    if (typeof ts === 'string' && ts.includes(':')) return ts;
    const d = new Date(ts);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (ts: any) => {
    if (!ts) return '';
    if (typeof ts === 'string' && ts.includes(':')) return new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  const getInitials = (name: string) => name?.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?';

  const avatarColors = ['bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500'];
  const getAvatarColor = (id: string) => avatarColors[id?.charCodeAt(0) % avatarColors.length] || 'bg-slate-500';

  return (
    <div className="flex h-full overflow-hidden rounded-2xl shadow-xl border border-slate-200 bg-white">

      {/* ─── Coluna Esquerda: Lista de Conversas ─── */}
      <div className="w-[420px] flex-shrink-0 flex flex-col border-r border-slate-100 bg-slate-50">

                {/* Header */}
        <div className="px-4 pt-4 pb-3 bg-white border-b border-slate-100">
          {/* Linha 1: Ícone + Título */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg flex-shrink-0">
              <MessageCircle className="w-9 h-9 text-white" />
            </div>
            <div>
              <h2 className="text-3xl font-bold text-slate-900 leading-tight" style={{textShadow: '0 2px 8px rgba(99,102,241,0.25), 0 1px 3px rgba(0,0,0,0.12)'}}>Conversas</h2>
              <p className="text-xs text-slate-500">{conversations.length} conversa{conversations.length !== 1 ? 's' : ''}</p>
            </div>
          </div>

          {/* Botão único de Filtros */}
          <button
            onClick={() => setDateFilterOpen(o => !o)}
            className={cn(
              'w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm font-medium transition-all duration-200',
              (hasDateFilter || searchTerm || historySearch || attendantFilter)
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            )}
          >
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4" />
              <span>
                {(hasDateFilter || searchTerm || historySearch || attendantFilter) ? 'Filtros ativos' : 'Filtros'}
              </span>
            </div>
            <ChevronDown className={cn('w-4 h-4 transition-transform duration-200', dateFilterOpen && 'rotate-180')} />
          </button>

          {/* Painel de filtros unificado */}
          {dateFilterOpen && (
            <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-3">

              {/* Busca por nome/empresa/telefone */}
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Buscar</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Nome, empresa ou telefone..."
                    value={searchTerm || historySearch}
                    onChange={e => { setSearchTerm(e.target.value); setHistorySearch(e.target.value); }}
                    className="w-full pl-8 pr-8 py-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition-all"
                  />
                  {(searchTerm || historySearch) && (
                    <button
                      onClick={() => { setSearchTerm(''); setHistorySearch(''); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Filtro por período */}
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Período</label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-slate-500 mb-1 block">De</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={e => setDateFrom(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-slate-500 mb-1 block">Até</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={e => setDateTo(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                </div>
              </div>

              {/* Limpar filtros */}
              {(hasDateFilter || searchTerm || historySearch || attendantFilter) && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo(''); setSearchTerm(''); setHistorySearch(''); setAttendantFilter(''); }}
                  className="w-full text-xs text-indigo-600 hover:text-indigo-800 font-medium py-1 text-center underline"
                >Limpar todos os filtros</button>
              )}

              {(hasDateFilter || searchTerm || historySearch) && (
                <p className="text-xs text-slate-500 text-center">
                  {filteredConversations.length} resultado{filteredConversations.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Botões Todas / Minhas / Histórico */}
        <div className="px-3 py-2 bg-white border-b border-slate-100">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {(['all', 'mine', 'history'] as const).map((f, i) => (
              <button
                key={f}
                onClick={() => { setOwnerFilter(f); setAttendantFilter(''); if (f !== 'history') setHistorySearch(''); }}
                className={cn(
                  'flex-1 px-3 py-1.5 text-xs font-medium transition-all duration-150',
                  i > 0 && 'border-l border-slate-200',
                  ownerFilter === f
                    ? f === 'history' ? 'bg-amber-500 text-white' : 'bg-blue-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                {f === 'all' ? 'Todas' : f === 'mine' ? 'Minhas' : 'Histórico'}
              </button>
            ))}
          </div>
        </div>

        {/* Filtros */}
        <div className="px-3 py-2 bg-white border-b border-slate-100">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {filters.map((filter, i) => (
              <button
                key={filter.id}
                onClick={() => setSelectedFilter(filter.id)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all duration-200',
                  i > 0 && 'border-l border-slate-200',
                  selectedFilter === filter.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full', selectedFilter === filter.id ? 'bg-white' : filter.dot)} />
                {filter.label}
                <span className={cn(
                  'text-xs font-bold',
                  selectedFilter === filter.id ? 'text-blue-100' : 'text-slate-400'
                )}>{filter.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length > 0 ? (
            filteredConversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => setSelectedConversation(conv.id)}
                className={cn(
                  'w-full text-left px-4 py-3 border-b border-slate-100 transition-all duration-150 relative',
                  selectedConversation === conv.id
                    ? 'bg-blue-50 border-l-4 border-l-blue-500'
                    : 'hover:bg-white border-l-4 border-l-transparent'
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className={cn('w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-bold', getAvatarColor(conv.id))}>
                    {getInitials(conv.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className={cn('text-sm font-semibold truncate', conv.isUnread ? 'text-slate-900' : 'text-slate-700')}>{conv.name}</p>
                      <span className="text-xs text-slate-400 flex-shrink-0 ml-2">{formatDate(conv.timestamp)}</span>
                    </div>
                    <p className="text-xs text-slate-500 truncate mb-1">{conv.company || conv.phone}</p>
                    <div className="flex items-center gap-1.5">
                      {isHistoryMode && (
                        <span className={cn(
                          'text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0',
                          conv.status === 'open' ? 'bg-emerald-100 text-emerald-700' :
                          conv.status === 'bot' ? 'bg-violet-100 text-violet-700' :
                          'bg-slate-100 text-slate-500'
                        )}>
                          {conv.status === 'open' ? 'Aberta' : conv.status === 'bot' ? 'BOT' : 'Fechada'}
                        </span>
                      )}
                      <p className={cn('text-xs truncate', conv.isUnread ? 'font-semibold text-slate-800' : 'text-slate-500')}>
                        {conv.lastMessage || 'Sem mensagens'}
                      </p>
                    </div>
                  </div>
                  {conv.isUnread && (
                    <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1" />
                  )}
                </div>
              </button>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-center px-6">
              <MessageCircle className="w-10 h-10 text-slate-200 mb-3" />
              <p className="text-sm font-medium text-slate-500">
                {isHistoryMode ? 'Nenhum resultado' : 'Nenhuma conversa'}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {isHistoryMode
                  ? 'Digite um nome, empresa ou telefone para buscar'
                  : 'Tente outro filtro ou busca'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Coluna Direita: Chat ─── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedConv ? (
          <>
            {/* Header do Chat */}
            <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className={cn('w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold', getAvatarColor(selectedConv.id))}>
                  {getInitials(selectedConv.name)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">{selectedConv.name}</h3>
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full font-medium',
                      selectedConv.status === 'open' ? 'bg-emerald-100 text-emerald-700' :
                      selectedConv.status === 'bot' ? 'bg-violet-100 text-violet-700' :
                      'bg-slate-100 text-slate-600'
                    )}>
                      {selectedConv.status === 'open' ? 'Aberta' : selectedConv.status === 'bot' ? 'BOT' : 'Fechada'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">{selectedConv.phone} {selectedConv.company ? `• ${selectedConv.company}` : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setEditName(selectedConv.name); setEditCompany(selectedConv.company || ''); setEditModalOpen(true); }}
                  className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-500 hover:text-slate-700"
                  title="Editar cliente"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => selectedConv.status === 'closed' ? setReopenConfirmOpen(true) : setCloseConfirmOpen(true)}
                  className={cn(
                    'px-4 py-2 rounded-xl text-sm font-medium transition-all',
                    selectedConv.status === 'closed'
                      ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'bg-red-50 text-red-600 hover:bg-red-100'
                  )}
                >
                  {selectedConv.status === 'closed' ? 'Reabrir' : 'Encerrar'}
                </button>
              </div>
            </div>

            {/* Área de Mensagens */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3" style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)' }}>
              {(() => {
                let msgs: any[] = [];
                try { msgs = JSON.parse(selectedConv.messagesJson || '[]'); } catch { msgs = []; }
                if (msgs.length === 0) {
                  return (
                    <div className="flex justify-start">
                      <div className="max-w-xs lg:max-w-md">
                        <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm border border-slate-100">
                          <p className="text-sm text-slate-800">{selectedConv.lastMessage || 'Conversa iniciada'}</p>
                          <p className="text-xs text-slate-400 mt-1 text-right">{formatTime(selectedConv.timestamp)}</p>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 ml-1">{selectedConv.name}</p>
                      </div>
                    </div>
                  );
                }
                return msgs.map((msg: any, idx: number) => {
                  const isAgent = msg.sender === 'agent' || msg.from === 'agent';
                  const msgText = msg.text || msg.message || '';
                  const msgTime = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
                  return (
                    <div key={msg.id || idx} className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
                      <div className="max-w-xs lg:max-w-md">
                        <div className={`rounded-2xl px-4 py-2.5 shadow-sm ${
                          isAgent
                            ? 'bg-gradient-to-br from-blue-500 to-violet-600 text-white rounded-tr-sm'
                            : 'bg-white border border-slate-100 text-slate-800 rounded-tl-sm'
                        }`}>
                          <p className="text-sm">{msgText}</p>
                          <p className={`text-xs mt-1 text-right ${isAgent ? 'text-blue-100' : 'text-slate-400'}`}>{msgTime}</p>
                        </div>
                        {!isAgent && <p className="text-xs text-slate-400 mt-1 ml-1">{selectedConv.name}</p>}
                        {isAgent && msg.agentName && <p className="text-xs text-slate-400 mt-1 mr-1 text-right">{msg.agentName}</p>}
                      </div>
                    </div>
                  );
                });
              })()}
              <div ref={messagesEndRef} />
            </div>

            {/* Input de Mensagem */}
            <div className="px-6 py-4 bg-white border-t border-slate-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    placeholder="Digite sua mensagem..."
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (!messageInput.trim() || !selectedConv) return;
                        const text = messageInput.trim();
                        setMessageInput('');
                        try {
                          const res = await fetch('/api/baileys/send', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              clientId,
                              conversationId: selectedConv.id,
                              phone: selectedConv.phone,
                              text,
                              agentName: userName,
                            }),
                          });
                          if (!res.ok) {
                            const err = await res.json();
                            showToast(err.error || 'Erro ao enviar mensagem', 'error');
                          } else {
                            showToast('Mensagem enviada!', 'success');
                          }
                        } catch {
                          showToast('Erro ao enviar mensagem', 'error');
                        }
                      }
                    }}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white text-sm transition-all pr-12"
                  />
                </div>
                <button
                  onClick={async () => {
                    if (!messageInput.trim() || !selectedConv) return;
                    const text = messageInput.trim();
                    setMessageInput('');
                    try {
                      const res = await fetch('/api/baileys/send', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          clientId,
                          conversationId: selectedConv.id,
                          phone: selectedConv.phone,
                          text,
                          agentName: userName,
                        }),
                      });
                      if (!res.ok) {
                        const err = await res.json();
                        showToast(err.error || 'Erro ao enviar mensagem', 'error');
                      } else {
                        showToast('Mensagem enviada!', 'success');
                      }
                    } catch {
                      showToast('Erro ao enviar mensagem', 'error');
                    }
                  }}
                  className="w-11 h-11 bg-gradient-to-br from-blue-500 to-violet-600 text-white rounded-2xl flex items-center justify-center hover:shadow-lg hover:scale-105 transition-all duration-200 flex-shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-2 ml-1">Enviando como <span className="font-medium text-slate-600">{userName}</span></p>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center" style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)' }}>
            <div className="text-center">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-100 to-violet-100 flex items-center justify-center mx-auto mb-5">
                <MessageCircle className="w-10 h-10 text-blue-400" />
              </div>
              <h3 className="text-xl font-bold text-slate-700 mb-2">Selecione uma conversa</h3>
              <p className="text-slate-400 text-sm max-w-xs">Escolha uma conversa da lista à esquerda para começar a atender</p>
            </div>
          </div>
        )}
      </div>



      {/* Modal de Confirmação - Encerrar Conversa - Simplificado */}
      {closeConfirmOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
          <div className="bg-white rounded-lg shadow-lg p-4 w-80 pointer-events-auto">
            <p className="text-slate-900 font-semibold mb-4 text-center">Encerrar conversa?</p>
            <div className="flex gap-2">
              <button
                onClick={() => setCloseConfirmOpen(false)}
                className="flex-1 px-3 py-2 bg-slate-100 text-slate-900 rounded-lg hover:bg-slate-200 transition-colors font-medium text-sm"
              >
                Não
              </button>
              <button
                onClick={handleCloseConversation}
                className="flex-1 px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium text-sm"
              >
                Sim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação - Reabrir Conversa - Simplificado */}
      {reopenConfirmOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
          <div className="bg-white rounded-lg shadow-lg p-4 w-80 pointer-events-auto">
            <p className="text-slate-900 font-semibold mb-4 text-center">Reabrir conversa?</p>
            <div className="flex gap-2">
              <button
                onClick={() => setReopenConfirmOpen(false)}
                className="flex-1 px-3 py-2 bg-slate-100 text-slate-900 rounded-lg hover:bg-slate-200 transition-colors font-medium text-sm"
              >
                Não
              </button>
              <button
                onClick={handleReopenConversation}
                className="flex-1 px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium text-sm"
              >
                Sim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edição de Cliente */}
      {editModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
          <div className="bg-white rounded-lg shadow-lg p-6 w-96 pointer-events-auto">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Editar Cliente</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nome</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Nome do cliente"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Empresa</label>
                <input
                  type="text"
                  value={editCompany}
                  onChange={(e) => setEditCompany(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Nome da empresa"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setEditModalOpen(false)}
                className="flex-1 px-4 py-2 bg-slate-100 text-slate-900 rounded-lg hover:bg-slate-200 transition-colors font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (selectedConversation) {
                    setConversations(prev => prev.map(c =>
                      c.id === selectedConversation ? { ...c, name: editName, company: editCompany } : c
                    ));
                    showToast('Cliente atualizado com sucesso!', 'success');
                  }
                  setEditModalOpen(false);
                }}
                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className={cn(
          'fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg text-white font-medium transition-all duration-300 z-50',
          toastMessage.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        )}>
          {toastMessage.message}
        </div>
      )}
    </div>
  );
}

type TicketActivity = {
  id: string;
  date: number; // timestamp em millisegundos
  description: string;
  attendant: string;
  actionType?: string;
};

// Tipo Ticket já definido acima

export function TicketsPage() {
  const { user } = useAuth();
  // Sessão MegaDesk para obter clientId
  const sessionData = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem(MEGADESK_SESSION_KEY) || 'null'); } catch { return null; }
  }, []);
  const clientId: string = sessionData?.clientId ?? '';
  const [searchTerm, setSearchTerm] = React.useState('');
  const [selectedFilter, setSelectedFilter] = React.useState<string>('total');
  const [chamadoFilter, setChamadoFilter] = React.useState<'all' | 'mine'>('all');
  const [selectedChamado, setSelectedChamado] = React.useState<any | null>(null);
  const [showForwardCard, setShowForwardCard] = React.useState(false);
  const [forwardAttendant, setForwardAttendant] = React.useState<string>('');
  const [forwardObservations, setForwardObservations] = React.useState<string>('');
  const [clientUsers, setClientUsers] = React.useState<ClientUser[]>([]);
  const [showManageCollaboratorsCard, setShowManageCollaboratorsCard] = React.useState(false);
  const [selectedCollaborators, setSelectedCollaborators] = React.useState<Array<{ userId: string; userName: string }>>([]);
  const [isEditingCollaborators, setIsEditingCollaborators] = React.useState(false);
  const [showRegisterActivityModal, setShowRegisterActivityModal] = React.useState(false);
  const [activityDescription, setActivityDescription] = React.useState('');
  const [activityType, setActivityType] = React.useState<'register' | 'edit' | 'close' | 'forward' | 'note'>('note');
  const [showCloseModal, setShowCloseModal] = React.useState(false);
  const [closeResolution, setCloseResolution] = React.useState('');
  const [showEditCard, setShowEditCard] = React.useState(false);
  const [editForm, setEditForm] = React.useState<{
    clientName: string;
    title: string;
    observations: string;
    priority: 'media' | 'baixa' | 'alta' | 'critica';
  }>({
    clientName: '',
    title: '',
    observations: '',
    priority: 'media',
  });

  const [toastMessage, setToastMessage] = React.useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showNewChamadoModal, setShowNewChamadoModal] = React.useState(false);
  const [newChamadoForm, setNewChamadoForm] = React.useState<{
    customerName: string;
    company: string;
    title: string;
    observations: string;
    priority: 'media' | 'baixa' | 'alta' | 'critica';
  }>({
    customerName: '',
    company: '',
    title: '',
    observations: '',
    priority: 'media',
  });
  const [validationErrors, setValidationErrors] = React.useState<ValidationError[]>([]);
  const [currentPage, setCurrentPage] = React.useState(1);
  const ITEMS_PER_PAGE = 20;
  // Estados para busca de empresa no modal de novo chamado
  const [companySearchResults, setCompanySearchResults] = React.useState<any[]>([]);
  const [isSearchingCompany, setIsSearchingCompany] = React.useState(false);
  const [selectedCrmCustomer, setSelectedCrmCustomer] = React.useState<any | null>(null);
  const [showCompanyDropdown, setShowCompanyDropdown] = React.useState(false);

  // Queries tRPC
  const chamadosQuery = trpc.chamados.list.useQuery(
    {
      status: selectedFilter as 'total' | 'open' | 'in_progress' | 'waiting' | 'closed',
      limit: ITEMS_PER_PAGE,
      offset: (currentPage - 1) * ITEMS_PER_PAGE,
    },
        { enabled: !!clientId }
  );
  // Calcular total de páginas
  const totalChamados = chamadosQuery.data?.total || 0;
  const totalPages = Math.ceil(totalChamados / ITEMS_PER_PAGE);

  const utils = trpc.useUtils();
  const updateChamadoMutation = trpc.chamados.update.useMutation();
  const addActivityMutation = trpc.chamados.addActivity.useMutation();
  const editActivityMutation = trpc.chamados.editActivity.useMutation();
  const createChamadoMutation = trpc.chamados.create.useMutation();
  const updateCollaboratorsMutation = trpc.chamados.updateCollaborators.useMutation();
  const registerActivityMutation = trpc.chamados.registerActivity.useMutation();

  // Carregar usuários do cliente ao abrir o card de encaminhamento
  const getClientUsersQuery = trpc.megadesk.getClientUsers.useQuery(
    {},
    { enabled: (showForwardCard || showManageCollaboratorsCard) && !!selectedChamado }
  );

  // Carregar colaboradores do chamado
  const getCollaboratorsQuery = trpc.chamados.getCollaborators.useQuery(
    { chamadoId: selectedChamado?.id || '' },
    { enabled: !!selectedChamado }
  );

  // Carregar contadores de status
  const statusCountsQuery = trpc.chamados.getStatusCounts.useQuery(
    undefined,
    { enabled: !!user?.user?.id }
  );
  // Status personalizados do cliente
  const customStatusesQuery = trpc.megadeskSettings.listTicketStatuses.useQuery(
    { clientId, userRole: sessionData?.userRole ?? 'viewer' },
    { enabled: !!clientId }
  );
  const customStatuses = customStatusesQuery.data ?? [];

  // Resetar pagina quando o filtro muda
  React.useEffect(() => {
    setCurrentPage(1);
  }, [selectedFilter]);

  React.useEffect(() => {
    if ((showForwardCard || showManageCollaboratorsCard) && selectedChamado && getClientUsersQuery.data) {
      setClientUsers(getClientUsersQuery.data || []);
    }
  }, [showForwardCard, showManageCollaboratorsCard, selectedChamado, getClientUsersQuery.data]);

  React.useEffect(() => {
    if (getCollaboratorsQuery.data && !isEditingCollaborators) {
      setSelectedCollaborators(getCollaboratorsQuery.data.collaborators || []);
    }
  }, [getCollaboratorsQuery.data, isEditingCollaborators]);

  React.useEffect(() => {
    if (showManageCollaboratorsCard && selectedChamado && getCollaboratorsQuery.data) {
      setSelectedCollaborators(getCollaboratorsQuery.data.collaborators || []);
      setIsEditingCollaborators(true);
    }
  }, [showManageCollaboratorsCard, selectedChamado, getCollaboratorsQuery.data]);

  React.useEffect(() => {
    if (showEditCard && selectedChamado) {
      setEditForm({
        clientName: selectedChamado.clientName || '',
        title: selectedChamado.title || '',
        observations: selectedChamado.observations || '',
        priority: selectedChamado.priority || 'media',
      });
    }
  }, [showEditCard, selectedChamado]);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToastMessage({ message, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleUpdateCollaborators = async () => {
    if (!selectedChamado) {
      showToast('Nenhum chamado selecionado', 'error');
      return;
    }

    try {
      await updateCollaboratorsMutation.mutateAsync({
        chamadoId: selectedChamado.id,
        collaborators: selectedCollaborators,
      });

      showToast('Colaboradores atualizados com sucesso', 'success');
      setShowManageCollaboratorsCard(false);
      setIsEditingCollaborators(false);
      await getCollaboratorsQuery.refetch();
      utils.chamados.list.invalidate();
    } catch (error) {
      showToast('Erro ao atualizar colaboradores', 'error');
      console.error('Error updating collaborators:', error);
    }
  };

  const toggleCollaborator = (userId: string, userName: string) => {
    setSelectedCollaborators(prev => {
      const isSelected = prev.some(c => c.userId === userId);
      if (isSelected) {
        return prev.filter(c => c.userId !== userId);
      } else {
        return [...prev, { userId, userName }];
      }
    });
  };

  const handleForwardChamado = async () => {
    if (!selectedChamado || !forwardAttendant) {
      showToast('Selecione um atendente', 'error');
      return;
    }

    // Obter o nome do atendente
    const attendantName = clientUsers.find(u => u.userId === forwardAttendant)?.name || forwardAttendant;
    const oldAssignedTo = selectedChamado.assignedTo;

    // Atualizacao otimista - fecha card e atualiza imediatamente
    setShowForwardCard(false);
    setForwardAttendant('');
    setForwardObservations('');
    showToast('Chamado encaminhado!', 'success');

    // Atualizar o chamado selecionado
    setSelectedChamado({
      ...selectedChamado,
      assignedTo: attendantName,
    });

    // Enviar para backend em background
    try {
      // Atualizar o chamado com o novo atendente
      await updateChamadoMutation.mutateAsync({
        chamadoId: selectedChamado.id,
        assignedTo: attendantName,
      });

      // Adicionar atividade se houver observações
      if (forwardObservations.trim()) {
        await addActivityMutation.mutateAsync({
          chamadoId: selectedChamado.id,
          description: `Encaminhado para ${attendantName}. Observação: ${forwardObservations}`,
          attendant: user?.user?.name || 'Atendente',
        });
      }

      // Invalidar cache e refetch
      await utils.chamados.list.invalidate();
      await chamadosQuery.refetch();
    } catch (error) {
      console.error('Erro ao encaminhar chamado:', error);
      showToast('Erro ao sincronizar encaminhamento', 'error');
      // Reverter para atendente anterior se falhar
      setSelectedChamado({
        ...selectedChamado,
        assignedTo: oldAssignedTo,
      });
    }
  };

  const handleRegisterActivity = async () => {
    if (!selectedChamado || !activityDescription.trim()) {
      showToast('Preencha a descricao da atividade', 'error');
      return;
    }

    // Atualizacao otimista - fecha modal e limpa estados imediatamente
    const newActivity = {
      id: `activity-${Date.now()}`,
      date: Date.now(),
      description: activityDescription.trim(),
      attendant: user?.user?.name || 'Atendente',
      actionType: activityType,
    };

    setShowRegisterActivityModal(false);
    setActivityDescription('');
    setActivityType('note');
    showToast('Atividade registrada!', 'success');

    // Atualizar localmente a lista de atividades
    if (selectedChamado.activities) {
      setSelectedChamado({
        ...selectedChamado,
        activities: [...selectedChamado.activities, newActivity],
      });
    }

    // Enviar para backend em background
    try {
      await registerActivityMutation.mutateAsync({
        chamadoId: selectedChamado.id,
        description: activityDescription.trim(),
        actionType: activityType,
      });

      // Recarregar para sincronizar com servidor
      const updatedChamado = await chamadosQuery.refetch();
      if (updatedChamado.data?.chamados) {
        const updated = updatedChamado.data.chamados.find((c: any) => c.id === selectedChamado.id);
        if (updated) {
          setSelectedChamado(updated);
        }
      }

      // Invalidar cache
      await utils.chamados.list.invalidate();
    } catch (error) {
      console.error('Erro ao registrar atividade:', error);
      showToast('Erro ao sincronizar atividade', 'error');
      // Recarregar para reverter mudanca
      const reloadChamado = await chamadosQuery.refetch();
      if (reloadChamado.data?.chamados) {
        const updated = reloadChamado.data.chamados.find((c: any) => c.id === selectedChamado.id);
        if (updated) {
          setSelectedChamado(updated);
        }
      }
    }
  };

  const handleUpdateStatus = async (newStatus: 'open' | 'in_progress' | 'waiting' | 'closed') => {
    if (!selectedChamado) return;

    // Atualizacao otimista - atualiza status imediatamente
    const oldStatus = selectedChamado.status;
    setSelectedChamado({
      ...selectedChamado,
      status: newStatus,
    });
    showToast('Status atualizado!', 'success');

    // Enviar para backend em background
    try {
      await updateChamadoMutation.mutateAsync({
        chamadoId: selectedChamado.id,
        status: newStatus,
      });

      // Recarregar a lista de chamados e atualizar contadores
      await chamadosQuery.refetch();
      await utils.chamados.list.invalidate();
      await utils.chamados.getStatusCounts.invalidate();
    } catch (error) {
      console.error('Erro ao atualizar status:', error);
      // Reverter para status anterior se falhar
      setSelectedChamado({
        ...selectedChamado,
        status: oldStatus,
      });
      showToast('Erro ao atualizar status', 'error');
    }
  };

  const handleCloseChamado = async () => {
    if (!selectedChamado || !closeResolution.trim()) {
      showToast('Preencha a resolucao do chamado', 'error');
      return;
    }

    // Atualizacao otimista - fecha modal e atualiza imediatamente
    const newActivity = {
      id: `activity-${Date.now()}`,
      date: Date.now(),
      description: `Encerramento: ${closeResolution.trim()}`,
      attendant: user?.user?.name || 'Atendente',
      actionType: 'close',
    };

    setShowCloseModal(false);
    setCloseResolution('');
    showToast('Chamado encerrado!', 'success');

    // Atualizar o chamado selecionado localmente
    const updatedChamado = {
      ...selectedChamado,
      status: 'closed',
      observations: closeResolution.trim(),
      activities: selectedChamado.activities ? [...selectedChamado.activities, newActivity] : [newActivity],
    };
    setSelectedChamado(updatedChamado);

    // Enviar para backend em background
    try {
      // Encerrar o chamado
      await updateChamadoMutation.mutateAsync({
        chamadoId: selectedChamado.id,
        status: 'closed',
        observations: closeResolution.trim(),
      });

      // Criar atividade de encerramento no historico
      await registerActivityMutation.mutateAsync({
        chamadoId: selectedChamado.id,
        description: `Encerramento: ${closeResolution.trim()}`,
        actionType: 'close',
      });

      // Recarregar a lista de chamados e atualizar contadores
      const refetchedChamado = await chamadosQuery.refetch();
      if (refetchedChamado.data?.chamados) {
        const updated = refetchedChamado.data.chamados.find((c: any) => c.id === selectedChamado.id);
        if (updated) {
          setSelectedChamado(updated);
        }
      }
      await utils.chamados.list.invalidate();
      await utils.chamados.getStatusCounts.invalidate();
    } catch (error) {
      console.error('Erro ao encerrar chamado:', error);
      showToast('Erro ao sincronizar encerramento', 'error');
      // Recarregar para reverter mudanca
      const reloadChamado = await chamadosQuery.refetch();
      if (reloadChamado.data?.chamados) {
        const updated = reloadChamado.data.chamados.find((c: any) => c.id === selectedChamado.id);
        if (updated) {
          setSelectedChamado(updated);
        }
      }
    }
  };

  const handleCreateChamado = async () => {
    // Validar formulário
    const errors = validateNewChamado(newChamadoForm);
    if (errors.length > 0) {
      setValidationErrors(errors);
      showToast(errors[0].message, 'error');
      return;
    }
    setValidationErrors([]);

    try {
      // Usar o customerId do CRM se encontrado, caso contrário vazio (backend gera fallback)
      const customerId = selectedCrmCustomer?.id || '';
      
      const result = await createChamadoMutation.mutateAsync({
        customerId,
        customerName: newChamadoForm.customerName,
        customerPhone: selectedCrmCustomer?.phone || '',
        customerEmail: selectedCrmCustomer?.email || '',
        customerCNPJ: selectedCrmCustomer?.cpfCnpj || '',
        company: newChamadoForm.company,
        title: newChamadoForm.title,
        observations: newChamadoForm.observations,
        priority: newChamadoForm.priority,
      });

      if (result.chamado) {
        showToast(`Chamado #${result.chamado.number} criado com sucesso!`, 'success');
        setShowNewChamadoModal(false);
        setNewChamadoForm({ customerName: '', company: '', title: '', observations: '', priority: 'media' });
        setSelectedCrmCustomer(null);
        setCompanySearchResults([]);
        setShowCompanyDropdown(false);
        // Invalidar cache e atualizar contadores
        await utils.chamados.list.invalidate();
        await utils.chamados.getStatusCounts.invalidate();
        await chamadosQuery.refetch();
      }
    } catch (error: any) {
      const msg = error?.message || 'Erro ao criar chamado';
      showToast(msg, 'error');
    }
  };

  // Buscar empresa no banco de dados com debounce
  const handleCompanySearch = React.useCallback(
    React.useMemo(() => {
      let timer: ReturnType<typeof setTimeout>;
      return (value: string) => {
        clearTimeout(timer);
        setNewChamadoForm(prev => ({ ...prev, company: value, customerName: '' }));
        setSelectedCrmCustomer(null);
        if (value.length < 2) {
          setCompanySearchResults([]);
          setShowCompanyDropdown(false);
          return;
        }
        setIsSearchingCompany(true);
        timer = setTimeout(async () => {
          try {
            const results = await (trpc.megadesk.searchCustomerByCompany as any).fetch({ company: value, clientId });
            setCompanySearchResults(results || []);
            setShowCompanyDropdown(true);
          } catch {
            setCompanySearchResults([]);
          } finally {
            setIsSearchingCompany(false);
          }
        }, 400);
      };
    }, [clientId]),
    [clientId]
  );

  const handleSelectCompany = (customer: any) => {
    setSelectedCrmCustomer(customer);
    setNewChamadoForm(prev => ({ ...prev, company: customer.company, customerName: customer.name || '' }));
    setShowCompanyDropdown(false);
    setCompanySearchResults([]);
  };

  const chamados = chamadosQuery.data?.chamados || [];
  console.log('[DEBUG] chamadosQuery.data:', chamadosQuery.data);
  console.log('[DEBUG] chamados:', chamados);
  console.log('[DEBUG] chamados.length:', chamados.length);

  // Filtrar por usuário (todos vs somente seu)
  const chamadosFiltrados = chamadoFilter === 'mine' 
    ? chamados.filter(c => c.assignedTo === user?.user?.name)
    : chamados;
  console.log('[DEBUG] chamadosFiltrados:', chamadosFiltrados);

  // Filtrar por busca
  const filteredChamados = chamadosFiltrados.filter(c => {
    const searchLower = searchTerm.toLowerCase();
    return (
      c.customerName.toLowerCase().includes(searchLower) ||
      c.company.toLowerCase().includes(searchLower) ||
      `#${String(c.number).padStart(4, '0')}`.includes(searchTerm) ||
      c.title.toLowerCase().includes(searchLower)
    );
  });
  console.log('[DEBUG] filteredChamados:', filteredChamados);

  // Contar status (usando dados da query)
  const statusCounts = statusCountsQuery.data || {
    total: 0,
    open: 0,
    in_progress: 0,
    waiting: 0,
    closed: 0,
  };
  console.log('[DEBUG] statusCounts:', statusCounts);

  const statusCards: Array<{ id: string; label: string; value: number; gradient: string; bgGradient: string; icon: any; iconColor: string; customColor?: string }> = [
    { id: 'total', label: 'Total', value: statusCounts.total, gradient: 'from-slate-600 to-slate-900', bgGradient: 'from-slate-50 to-slate-100', icon: Ticket, iconColor: 'text-slate-700' },
    { id: 'open', label: 'Abertos', value: statusCounts.open, gradient: 'from-blue-400 to-blue-600', bgGradient: 'from-blue-50 to-blue-100', icon: AlertCircle, iconColor: 'text-blue-600' },
    { id: 'in_progress', label: 'Em Progresso', value: statusCounts.in_progress, gradient: 'from-amber-400 to-amber-600', bgGradient: 'from-amber-50 to-amber-100', icon: Clock, iconColor: 'text-amber-600' },
    { id: 'waiting', label: 'Aguardando', value: statusCounts.waiting, gradient: 'from-orange-400 to-orange-600', bgGradient: 'from-orange-50 to-orange-100', icon: Hourglass, iconColor: 'text-orange-600' },
    { id: 'closed', label: 'Fechados', value: statusCounts.closed, gradient: 'from-emerald-400 to-emerald-600', bgGradient: 'from-emerald-50 to-emerald-100', icon: CheckCircle2, iconColor: 'text-emerald-600' },
    // Status personalizados do cliente
    ...customStatuses.map((cs) => ({
      id: `custom_${cs.statusId}`,
      label: cs.name,
      value: 0,
      gradient: 'from-slate-400 to-slate-600',
      bgGradient: 'from-slate-50 to-slate-100',
      icon: Tag,
      iconColor: 'text-slate-600',
      customColor: cs.color,
    })),
  ];

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-blue-100 text-blue-700';
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-700';
      case 'waiting':
        return 'bg-orange-100 text-orange-700';
      case 'closed':
        return 'bg-green-100 text-green-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'open':
        return 'Aberto';
      case 'in_progress':
        return 'Em Progresso';
      case 'waiting':
        return 'Aguardando';
      case 'closed':
        return 'Fechado';
      default:
        return status;
    }
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'baixa':
        return 'text-green-600';
      case 'media':
        return 'text-yellow-600';
      case 'alta':
        return 'text-orange-600';
      case 'critica':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  if (chamadosQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Ticket className="w-12 h-12 mx-auto mb-4 animate-spin text-blue-600" />
          <p className="text-slate-600">Carregando chamados...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filtro de Chamados */}
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-slate-700">Chamados:</label>
        <select
          value={chamadoFilter}
          onChange={e => setChamadoFilter(e.target.value as 'all' | 'mine')}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">Todos</option>
          <option value="mine">Somente seu</option>
        </select>
      </div>

      {/* Cards de Status - Estilizados */}
      <div className="flex flex-wrap gap-4">
        {statusCards.map((card: any, idx) => {
          const Icon = card.icon;
          const isSelected = selectedFilter === card.id;
          // Para status personalizados, usar a cor hex diretamente
          const cardStyle = card.customColor ? {
            borderColor: isSelected ? card.customColor : 'transparent',
            backgroundColor: isSelected ? `${card.customColor}15` : undefined,
          } : {};
          return (
            <button
              key={card.id}
              onClick={() => setSelectedFilter(card.id)}
              style={cardStyle}
              className={`group relative overflow-hidden rounded-2xl ${
                card.customColor ? '' : `bg-gradient-to-br ${card.bgGradient}`
              } p-5 transition-all duration-300 border-2 min-w-[140px] flex-1 ${
                isSelected
                  ? `${card.customColor ? '' : 'border-current'} shadow-xl scale-105`
                  : `border-transparent hover:shadow-lg hover:scale-102 hover:-translate-y-1`
              }`}
            >
              {!card.customColor && (
                <div className={`absolute -top-8 -right-8 w-32 h-32 bg-gradient-to-br ${card.gradient} rounded-full blur-2xl opacity-10 group-hover:opacity-20 transition-all duration-300`} />
              )}
              
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      card.customColor ? '' : `bg-gradient-to-br ${card.gradient}`
                    }`}
                    style={card.customColor ? { backgroundColor: card.customColor } : {}}
                  >
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${card.customColor ? '' : `bg-gradient-to-r ${card.gradient}`} ${isSelected ? 'animate-pulse' : ''}`}
                    style={card.customColor ? { backgroundColor: card.customColor } : {}}
                  />
                </div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">{card.label}</p>
                <p
                  className={`text-3xl font-black group-hover:scale-110 transition-transform duration-300 origin-left ${
                    card.customColor ? '' : `bg-gradient-to-r ${card.gradient} bg-clip-text text-transparent`
                  }`}
                  style={card.customColor ? { color: card.customColor } : {}}
                >
                  {card.value}
                </p>
              </div>
              
              {!card.customColor && (
                <div className={`absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r ${card.gradient} transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left`} />
              )}
              {card.customColor && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-0.5 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"
                  style={{ backgroundColor: card.customColor }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Filtro de Pesquisa e Botao Novo Chamado */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
          <Input
            placeholder="Buscar por nome, empresa, nº ou título..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          onClick={() => setShowNewChamadoModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Novo Chamado
        </Button>
      </div>

      {/* Tabela de Chamados */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">ID</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Abertura</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Nome e Cliente</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Título</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Atendente</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredChamados.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Nenhum chamado encontrado
                </td>
              </tr>
            ) : (
              filteredChamados.map(chamado => (
                <tr
                  key={chamado.id}
                  onClick={() => setSelectedChamado(chamado)}
                  className="border-b border-slate-200 hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-sm font-mono text-slate-600">#{String(chamado.number).padStart(4, '0')}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {new Date(chamado.createdAt).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="font-medium text-slate-900">{chamado.customerName}</div>
                    <div className="text-xs text-slate-500">{chamado.company}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{chamado.title}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{chamado.assignedTo || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusBadgeColor(chamado.status)}`}>
                      {getStatusLabel(chamado.status)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Controles de Paginação */}
      {filteredChamados.length > 0 && (
        <div className="flex items-center justify-between mt-6 px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="text-sm text-slate-600 dark:text-slate-300">
            Mostrando <span className="font-semibold">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> a{' '}
            <span className="font-semibold">
              {Math.min(currentPage * ITEMS_PER_PAGE, totalChamados)}
            </span>{' '}
            de <span className="font-semibold">{totalChamados}</span> chamados
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ← Anterior
            </button>
            
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                      currentPage === pageNum
                        ? 'bg-blue-500 text-white'
                        : 'text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Próximo →
            </button>
          </div>
        </div>
      )}

      {/* Modal de Novo Chamado */}
      <Dialog open={showNewChamadoModal} onOpenChange={setShowNewChamadoModal}>
        <DialogContent className="max-w-md bg-white border border-slate-300 shadow-lg rounded-lg p-0">
          <DialogTitle className="sr-only">Novo Chamado</DialogTitle>
          <div className="bg-blue-600 p-4 rounded-t-lg">
            <h2 className="text-white text-lg font-bold flex items-center gap-2">
              <Plus className="w-5 h-5" />
              Novo Chamado
            </h2>
          </div>
          <div className="p-6">
          <div className="space-y-4">
            {/* 1. Empresa - com busca automática no banco */}
            <div className="relative">
              <label className="text-sm font-semibold text-black block mb-2">
                Empresa <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Input
                  placeholder="Digite o nome da empresa..."
                  value={newChamadoForm.company}
                  onChange={e => handleCompanySearch(e.target.value)}
                  onBlur={() => setTimeout(() => setShowCompanyDropdown(false), 200)}
                  autoComplete="off"
                  className={`bg-white border-2 transition-colors pr-8 text-black ${
                    validationErrors.find(e => e.field === 'company')
                      ? 'border-red-500'
                      : selectedCrmCustomer ? 'border-green-500' : 'border-slate-400 focus:border-blue-500'
                  }`}
                />
                {isSearchingCompany && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {selectedCrmCustomer && !isSearchingCompany && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500">✓</div>
                )}
              </div>
              {/* Dropdown de sugestões */}
              {showCompanyDropdown && companySearchResults.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {companySearchResults.map((customer: any) => (
                    <button
                      key={customer.id}
                      type="button"
                      onMouseDown={() => handleSelectCompany(customer)}
                      className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors border-b border-slate-200 last:border-0 text-black"
                    >
                      <div className="font-semibold text-black text-sm">{customer.company}</div>
                      {customer.name && <div className="text-xs text-slate-600">{customer.name}</div>}
                    </button>
                  ))}
                </div>
              )}
              {showCompanyDropdown && companySearchResults.length === 0 && !isSearchingCompany && newChamadoForm.company.length >= 2 && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg px-4 py-3 text-sm text-slate-600">
                  Nenhuma empresa encontrada
                </div>
              )}
              {validationErrors.find(e => e.field === 'company') && (
                <p className="text-xs text-red-600 mt-1 font-medium">{validationErrors.find(e => e.field === 'company')?.message}</p>
              )}
            </div>

            {/* 2. Nome do Cliente - preenchido automaticamente */}
            <div>
              <label className="text-sm font-semibold text-black block mb-2">
                Nome do Cliente <span className="text-red-500">*</span>
                {selectedCrmCustomer && <span className="ml-2 text-xs text-green-700 font-normal">✓ Encontrado no banco</span>}
              </label>
              <Input
                placeholder={selectedCrmCustomer ? '' : 'Selecione a empresa acima ou digite manualmente'}
                value={newChamadoForm.customerName}
                onChange={e => setNewChamadoForm({...newChamadoForm, customerName: e.target.value})}
                className={`bg-white border-2 transition-colors text-black ${
                  validationErrors.find(e => e.field === 'customerName')
                    ? 'border-red-500'
                    : selectedCrmCustomer ? 'border-green-500' : 'border-slate-400 focus:border-blue-500'
                }`}
              />
              {validationErrors.find(e => e.field === 'customerName') && (
                <p className="text-xs text-red-600 mt-1 font-medium">{validationErrors.find(e => e.field === 'customerName')?.message}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-semibold text-black block mb-2">Título</label>
              <Input
                placeholder="Ex: Problema com login"
                value={newChamadoForm.title}
                onChange={e => setNewChamadoForm({...newChamadoForm, title: e.target.value})}
                className={`bg-white border-2 transition-colors text-black ${
                  validationErrors.find(e => e.field === 'title')
                    ? 'border-red-500'
                    : 'border-slate-400 focus:border-blue-500'
                }`}
              />
              {validationErrors.find(e => e.field === 'title') && (
                <p className="text-xs text-red-600 mt-1 font-medium">{validationErrors.find(e => e.field === 'title')?.message}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-semibold text-black block mb-2">Observações</label>
              <Input
                placeholder="Detalhes adicionais..."
                value={newChamadoForm.observations}
                onChange={e => setNewChamadoForm({...newChamadoForm, observations: e.target.value})}
                className="bg-white border-2 border-slate-400 focus:border-blue-500 transition-colors text-black"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-black block mb-2">Prioridade</label>
              <Select value={newChamadoForm.priority} onValueChange={priority => setNewChamadoForm({...newChamadoForm, priority: priority as 'media' | 'baixa' | 'alta' | 'critica'})}>
                <SelectTrigger className="bg-white border-2 border-slate-400 focus:border-blue-500 transition-colors text-black">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border border-slate-300">
                  <SelectItem value="baixa">🟢 Baixa</SelectItem>
                  <SelectItem value="media">🟡 Média</SelectItem>
                  <SelectItem value="alta">🔴 Alta</SelectItem>
                  <SelectItem value="critica">🔴 Crítica</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3 pt-4 border-t border-slate-300 mt-4">
              <Button
                onClick={handleCreateChamado}
                disabled={createChamadoMutation.isPending}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-md hover:shadow-lg transition-all"
              >
                {createChamadoMutation.isPending ? '⏳ Criando...' : '✅ Criar Chamado'}
              </Button>
              <Button
                onClick={() => setShowNewChamadoModal(false)}
                variant="outline"
                className="flex-1 border-2 border-slate-400 text-black hover:bg-slate-100 font-semibold transition-colors"
              >
                ✕ Cancelar
              </Button>
            </div>
          </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Toast */}
      {toastMessage && (
        <div
          className={`fixed bottom-4 right-4 px-6 py-3 rounded-lg text-white font-medium shadow-lg z-50 ${
            toastMessage.type === 'success' ? 'bg-green-500' : 'bg-red-500'
          }`}
        >
          {toastMessage.message}
        </div>
      )}

      {/* Tela Branca de Detalhes do Chamado */}
      {selectedChamado && (
        <div className="fixed top-0 right-0 bottom-0 left-20 lg:left-64 bg-white z-40 overflow-y-auto border border-slate-300" style={{height: '1016px', marginBottom: '5px', marginLeft: '-175px', marginRight: '0px', marginTop: '83px', paddingBottom: '16px', paddingLeft: '2px', width: 'calc(100% - 80px)'}}>
          {/* Header com Botao Voltar */}
          <div className="sticky top-0 bg-white border-b border-slate-200 p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button
                onClick={() => setSelectedChamado(null)}
                variant="outline"
                className="flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                Voltar
              </Button>
              <h1 className="text-2xl font-bold text-slate-900">
                #{String(selectedChamado.number).padStart(4, '0')} - {selectedChamado.title}
              </h1>
            </div>
            
            {/* Status e Botao Encerrar */}
            <div className="flex items-center gap-3">
              <Select value={selectedChamado.status} onValueChange={(value) => handleUpdateStatus(value as 'open' | 'in_progress' | 'waiting' | 'closed')}>
                <SelectTrigger className="w-40 bg-slate-50 border-2 border-slate-200 focus:border-blue-500">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-2 border-slate-200">
                  <SelectItem value="open">Aberto</SelectItem>
                  <SelectItem value="in_progress">Em Progresso</SelectItem>
                  <SelectItem value="waiting">Aguardando</SelectItem>
                  <SelectItem value="closed">Encerrado</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={() => setShowCloseModal(true)}
                className="bg-red-500 hover:bg-red-600 text-white font-semibold"
              >
                Encerrar Chamado
              </Button>
            </div>
          </div>

          {/* Retangulo com Dados do Cliente */}
          <div className="bg-slate-600 text-white p-4 mx-8 mt-6 rounded-lg flex items-center justify-between" style={{height: '103px', marginBottom: '6px', marginLeft: '31px', paddingBottom: '0px', paddingLeft: '16px', paddingTop: '0px', width: '1778px'}}>
            <div className="flex items-center gap-8 w-full">
              <div className="flex-1">
                <p className="text-xs text-slate-300">Nome</p>
                <p className="text-sm font-medium">{selectedChamado.clientName || 'N/A'}</p>
              </div>
              <div className="border-l border-slate-500 h-12"></div>
              <div className="flex-1">
                <p className="text-xs text-slate-300">Telefone</p>
                <p className="text-sm font-medium">{selectedChamado.clientPhone || 'N/A'}</p>
              </div>
              <div className="border-l border-slate-500 h-12"></div>
              <div className="flex-1">
                <p className="text-xs text-slate-300">CNPJ</p>
                <p className="text-sm font-medium">{selectedChamado.clientCnpj || 'N/A'}</p>
              </div>
              <div className="border-l border-slate-500 h-12"></div>
              <div className="flex-1">
                <p className="text-xs text-slate-300">Email</p>
                <p className="text-sm font-medium">{selectedChamado.clientEmail || 'N/A'}</p>
              </div>
            </div>
          </div>

          {/* Linha de Icones com Tooltips */}
          <div className="flex items-center justify-center gap-0 px-8 py-6 border-b border-slate-200" style={{height: '60px', marginBottom: '-5px'}}>
            <div className="group relative cursor-pointer px-6 py-4 hover:bg-slate-50 transition-colors" onClick={() => setShowForwardCard(!showForwardCard)}>
              {/* Círculo com seta - Encaminhar */}
              <svg className="w-6 h-6 text-black hover:text-slate-700" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8l4 4m-4-4l-4 4" />
                <path d="M12 16v-4" />
              </svg>
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap font-medium">Encaminhar chamado</div>
            </div>
            <div className="border-l border-slate-300 h-8"></div>
            <div className="group relative cursor-pointer px-6 py-4 hover:bg-slate-50 transition-colors" onClick={() => setShowManageCollaboratorsCard(!showManageCollaboratorsCard)}>
              {/* Gerenciar colaboradores - mantém */}
              <svg className="w-6 h-6 text-black hover:text-slate-700" fill="currentColor" viewBox="0 0 24 24">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
              </svg>
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap font-medium">Gerenciar colaboradores</div>
            </div>
            <div className="border-l border-slate-300 h-8"></div>
            <div className="group relative cursor-pointer px-6 py-4 hover:bg-slate-50 transition-colors" onClick={() => setShowEditCard(!showEditCard)}>
              {/* Editar chamado - mantém */}
              <svg className="w-6 h-6 text-black hover:text-slate-700" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" />
                <path d="M20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
              </svg>
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap font-medium">Editar chamado</div>
            </div>
            <div className="border-l border-slate-300 h-8"></div>
            <div className="group relative cursor-pointer px-6 py-4 hover:bg-slate-50 transition-colors" onClick={() => setShowRegisterActivityModal(true)}>
              {/* Balão retangular com 2 linhas - Atividade */}
              <svg className="w-6 h-6 text-black hover:text-slate-700" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <rect x="3" y="5" width="14" height="10" rx="2" />
                <path d="M17 15l2 2" />
                <line x1="6" y1="8" x2="12" y2="8" />
                <line x1="6" y1="11" x2="12" y2="11" />
              </svg>
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap font-medium">Registro de atividade</div>
            </div>
            <div className="border-l border-slate-300 h-8"></div>
            <div className="group relative cursor-pointer px-6 py-4 hover:bg-slate-50 transition-colors">
              {/* Clipe - Anexo */}
              <svg className="w-6 h-6 text-black hover:text-slate-700" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap font-medium">Anexo</div>
            </div>
            <div className="border-l border-slate-300 h-8"></div>
            <div className="group relative cursor-pointer px-6 py-4 hover:bg-slate-50 transition-colors">
              {/* Pasta bonita - Dossiê */}
              <svg className="w-6 h-6 text-black hover:text-slate-700" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
              </svg>
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap font-medium">Dossiê do cliente</div>
            </div>
            <div className="border-l border-slate-300 h-8"></div>
            {/* Colaboradores na linha de ferramentas */}
            {selectedCollaborators && selectedCollaborators.length > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-2">
                <span className="text-xs font-medium text-slate-500">Colabs:</span>
                <div className="flex -space-x-1.5">
                  {selectedCollaborators.slice(0, 3).map(collab => (
                    <div key={collab.userId} className="w-5 h-5 rounded-full bg-slate-400 flex items-center justify-center text-white text-xs font-semibold border border-slate-200 hover:z-10 cursor-pointer hover:bg-slate-500 transition-colors" title={collab.userName}>
                      {collab.userName.charAt(0).toUpperCase()}
                    </div>
                  ))}
                  {selectedCollaborators.length > 3 && (
                    <div className="w-5 h-5 rounded-full bg-slate-300 flex items-center justify-center text-slate-700 text-xs font-semibold border border-slate-200" title={`+${selectedCollaborators.length - 3} mais`}>
                      +{selectedCollaborators.length - 3}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Mensagem Inicial do Chamado */}
          {selectedChamado && selectedChamado.observations && (
            <div className="mx-8 mt-6 p-4 bg-white rounded-lg border border-slate-200">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Mensagem Inicial</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{selectedChamado.observations}</p>
            </div>
          )}

          {/* Historico do Chamado */}
          {selectedChamado && (
            <div className="mx-8 mt-8 pb-8">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-slate-900">Historico do Chamado</h3>
              </div>
              
              {selectedChamado.activities && selectedChamado.activities.length > 0 ? (
                <TimelineActivity activities={selectedChamado.activities} />
              ) : (
                <div className="text-center py-8 text-slate-500">
                  <p>Nenhuma atividade registrada ainda.</p>
                </div>
              )}
            </div>
          )}

          {/* Modal de Registrar Atividade */}
          {showRegisterActivityModal && selectedChamado && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-2xl border border-slate-200 p-6 w-full max-w-2xl mx-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-slate-900">Registrar Atividade</h3>
                  <button
                    onClick={() => setShowRegisterActivityModal(false)}
                    className="text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Descricao */}
                  <div>
                    <label className="text-sm font-semibold text-slate-700 block mb-2">Descricao</label>
                    <textarea
                      placeholder="Descreva a atividade realizada..."
                      value={activityDescription}
                      onChange={(e) => setActivityDescription(e.target.value)}
                      className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-200 dark:border-slate-600 focus:border-blue-500 rounded-lg transition-colors resize-none h-32 text-sm"
                    />
                  </div>

                  {/* Botoes */}
                  <div className="flex gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <Button
                      onClick={handleRegisterActivity}
                      disabled={registerActivityMutation.isPending}
                      className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold shadow-md hover:shadow-lg transition-all"
                    >
                      {registerActivityMutation.isPending ? 'Registrando...' : 'Registrar'}
                    </Button>
                    <Button
                      onClick={() => setShowRegisterActivityModal(false)}
                      className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-900 font-semibold transition-colors"
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Modal de Encerramento */}
          {showCloseModal && selectedChamado && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-2xl border border-slate-200 p-6 w-full max-w-2xl mx-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-slate-900">Encerrar Chamado</h3>
                  <button
                    onClick={() => setShowCloseModal(false)}
                    className="text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Resolucao */}
                  <div>
                    <label className="text-sm font-semibold text-slate-700 block mb-2">Resolucao do Chamado</label>
                    <textarea
                      placeholder="Descreva como o chamado foi resolvido..."
                      value={closeResolution}
                      onChange={(e) => setCloseResolution(e.target.value)}
                      className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-200 dark:border-slate-600 focus:border-blue-500 rounded-lg transition-colors resize-none h-32 text-sm"
                    />
                  </div>

                  {/* Botoes */}
                  <div className="flex gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <Button
                      onClick={handleCloseChamado}
                      disabled={updateChamadoMutation.isPending}
                      className="flex-1 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-semibold shadow-md hover:shadow-lg transition-all"
                    >
                      {updateChamadoMutation.isPending ? 'Encerrando...' : 'Encerrar'}
                    </Button>
                    <Button
                      onClick={() => setShowCloseModal(false)}
                      className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-900 font-semibold transition-colors"
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Card Suspenso de Encaminhamento */}
          {showForwardCard && selectedChamado && (
            <div className="absolute top-[280px] left-1/2 transform -translate-x-1/2 z-50 bg-white rounded-lg shadow-2xl border border-slate-200 p-6 w-96">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">Encaminhar Chamado</h3>
                <button
                  onClick={() => setShowForwardCard(false)}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Select de Atendentes */}
                <div>
                  <label className="text-sm font-semibold text-slate-700 block mb-2">Atendente</label>
                  <Select value={forwardAttendant} onValueChange={setForwardAttendant}>
                    <SelectTrigger className="bg-slate-50 border-2 border-slate-200 focus:border-blue-500 transition-colors">
                      <SelectValue placeholder="Selecione um atendente" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-2 border-slate-200">
                      {clientUsers.map(user => (
                        <SelectItem key={user.userId} value={user.userId}>
                          {user.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Campo de Observações */}
                <div>
                  <label className="text-sm font-semibold text-slate-700 block mb-2">Observações</label>
                  <textarea
                    placeholder="obs:"
                    value={forwardObservations}
                    onChange={e => setForwardObservations(e.target.value)}
                    className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition-colors resize-none"
                    rows={3}
                  />
                </div>

                {/* Botões */}
                <div className="flex gap-3 pt-4 border-t border-slate-200">
                  <Button
                    onClick={handleForwardChamado}
                    disabled={!forwardAttendant}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                  >
                    ✅ Encaminhar
                  </Button>
                  <Button
                    onClick={() => setShowForwardCard(false)}
                    variant="outline"
                    className="flex-1 border-2 border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold"
                  >
                    ✕ Cancelar
                  </Button>
                </div>
              </div>
            </div>
          )}

          {showManageCollaboratorsCard && selectedChamado && (
            <div className="absolute top-[280px] left-1/2 transform -translate-x-1/2 z-50 bg-white rounded-lg shadow-2xl border border-slate-200 p-6 w-96 max-h-[500px] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">Gerenciar Colaboradores</h3>
                <button
                  onClick={() => setShowManageCollaboratorsCard(false)}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Lista de Colaboradores com Checkboxes */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700 block mb-3">Selecione os colaboradores:</label>
                  {clientUsers.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhum usuário disponível</p>
                  ) : (
                    clientUsers.map(user => (
                      <div key={user.userId} className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                        <input
                          type="checkbox"
                          id={`collab-${user.userId}`}
                          checked={selectedCollaborators.some(c => c.userId === user.userId)}
                          onChange={() => toggleCollaborator(user.userId, user.name)}
                          className="w-5 h-5 text-blue-600 rounded cursor-pointer"
                        />
                        <label htmlFor={`collab-${user.userId}`} className="flex-1 cursor-pointer text-slate-700 font-medium">
                          {user.name}
                        </label>
                      </div>
                    ))
                  )}
                </div>

                {/* Botões */}
                <div className="flex gap-3 pt-4 border-t border-slate-200">
                  <Button
                    onClick={handleUpdateCollaborators}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                  >
                    ✅ Salvar
                  </Button>
                  <Button
                    onClick={() => {
                      setShowManageCollaboratorsCard(false);
                      setIsEditingCollaborators(false);
                    }}
                    variant="outline"
                    className="flex-1 border-2 border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold"
                  >
                    ✗ Cancelar
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Card Suspenso de Editar Chamado */}
          {showEditCard && selectedChamado && (
            <div className="absolute top-[280px] left-1/2 transform -translate-x-1/2 z-50 bg-white rounded-lg shadow-2xl border border-slate-200 p-8 w-[600px] max-h-[700px] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">Editar Chamado</h3>
                <button
                  onClick={() => setShowEditCard(false)}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Cliente */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Cliente</label>
                  <Input
                    type="text"
                    value={editForm.clientName}
                    onChange={(e) => setEditForm({ ...editForm, clientName: e.target.value })}
                    placeholder="Nome do cliente"
                    className="w-full"
                  />
                </div>

                {/* Título */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Título</label>
                  <Input
                    type="text"
                    value={editForm.title}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    placeholder="Título do chamado"
                    className="w-full"
                  />
                </div>

                {/* Observações */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Observações</label>
                  <textarea
                    value={editForm.observations}
                    onChange={(e) => setEditForm({ ...editForm, observations: e.target.value })}
                    placeholder="Observações iniciais"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                  />
                </div>

                {/* Prioridade */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Prioridade</label>
                  <Select value={editForm.priority} onValueChange={(value) => setEditForm({ ...editForm, priority: value as 'media' | 'baixa' | 'alta' | 'critica' })}>
                    <SelectTrigger className="bg-slate-50 dark:bg-slate-700 border-2 border-slate-200 dark:border-slate-600 focus:border-blue-500 transition-colors">
                      <SelectValue placeholder="Selecione a prioridade" />
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-600">
                      <SelectItem value="baixa">🟢 Baixa</SelectItem>
                      <SelectItem value="media">🟡 Média</SelectItem>
                      <SelectItem value="alta">🔴 Alta</SelectItem>
                      <SelectItem value="critica">🔴 Crítica</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Botões */}
                <div className="flex gap-3 pt-4 border-t border-slate-200">
                  <Button
                    onClick={() => {
                      updateChamadoMutation.mutate({
                        chamadoId: selectedChamado.id,
                        title: editForm.title,
                        clientName: editForm.clientName,
                        observations: editForm.observations,
                        priority: editForm.priority as 'media' | 'baixa' | 'alta' | 'critica',
                      }, {
                        onSuccess: () => {
                          showToast('Chamado atualizado com sucesso', 'success');
                          setShowEditCard(false);
                          setSelectedChamado({
                            ...selectedChamado,
                            title: editForm.title,
                            clientName: editForm.clientName,
                            observations: editForm.observations,
                            priority: editForm.priority,
                          });
                          utils.chamados.list.invalidate();
                        },
                        onError: () => {
                          showToast('Erro ao atualizar chamado', 'error');
                        },
                      });
                    }}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                  >
                    ✅ Salvar
                  </Button>
                  <Button
                    onClick={() => setShowEditCard(false)}
                    variant="outline"
                    className="flex-1 border-2 border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold"
                  >
                    ✗ Cancelar
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Conteudo da Tela Branca */}
          <div className="p-8 max-w-6xl mx-auto">
            <p className="text-slate-600">Detalhes do chamado serao exibidos aqui...</p>
          </div>
        </div>
      )}
    </div>
  );
}


function TrackingPage() {
  const [searchTerm, setSearchTerm] = React.useState('');

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-6">Rastreamentos</h2>

        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar código..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select className="px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="all">Todas</option>
          </select>
          <select className="px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="all">Todos</option>
          </select>
          <button className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Novo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white rounded-2xl shadow-lg p-6 border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-4">Lista de Rastreamentos</h3>
          <div className="flex items-center justify-center h-40 text-center">
            <p className="text-slate-500">Carregando...</p>
          </div>
        </div>
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-lg p-6 border border-slate-100 flex flex-col items-center justify-center h-80">
          <PackageSearch className="w-16 h-16 text-slate-300 mb-4" />
          <h3 className="text-lg font-bold text-slate-900 mb-2">Selecione um rastreamento para ver detalhes</h3>
          <p className="text-slate-600">Clique em um rastreamento da lista</p>
        </div>
      </div>
    </div>
  );
}

function ERPPage() {
  const [timeRange, setTimeRange] = React.useState('today');

  const kpis = [
    { label: 'Vendas Hoje', value: 'R$ 12.540', change: '↑ 12% vs ontem', color: 'text-green-600' },
    { label: 'Pedidos Pendentes', value: '0', change: 'Aguardando ação', color: 'text-orange-600' },
    { label: 'Pedidos Atrasados', value: '3', change: 'Requer atenção', color: 'text-red-600' },
    { label: 'Clientes Ativos', value: '0', change: 'Total registrado', color: 'text-blue-600' },
    { label: 'Faturamento Total', value: 'R$ 0.00', change: 'Mês atual', color: 'text-slate-600' },
    { label: 'Chamados Abertos', value: '8', change: 'Aguardando resposta', color: 'text-purple-600' },
    { label: 'Entregues Hoje', value: '24', change: 'Pedidos completados', color: 'text-green-600' },
    { label: 'Pagamentos Pendentes', value: 'R$ 0', change: 'Aguardando recebimento', color: 'text-slate-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Dashboard Operacional</h2>
            <p className="text-slate-600 text-sm mt-1">Acompanhe as métricas principais do negócio</p>
          </div>
        </div>

        <div className="flex gap-3 mb-8">
          {['today', 'week', 'month'].map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={cn(
                'px-4 py-2 rounded-lg font-medium transition-all duration-200',
                timeRange === range
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              )}
            >
              {range === 'today' ? 'Hoje' : range === 'week' ? 'Esta Semana' : 'Este Mês'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((kpi, idx) => (
            <div key={idx} className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-6 border border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-slate-600">{kpi.label}</h3>
              </div>
              <p className="text-2xl font-bold text-slate-900 mb-1">{kpi.value}</p>
              <p className="text-xs text-slate-600">{kpi.change}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-4">Vendas vs Pedidos</h3>
          <div className="h-64 flex items-center justify-center bg-slate-50 rounded-lg">
            <p className="text-slate-500">Gráfico de vendas vs pedidos</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-4">Distribuição de Status</h3>
          <div className="space-y-3">
            {['Aguardando Pagamento', 'Separando', 'Em Produção', 'Enviado', 'Entregue'].map((status, idx) => (
              <div key={idx} className="flex items-center justify-between">
                <span className="text-sm text-slate-600">{status}</span>
                <span className="text-sm font-bold text-slate-900">{[0, 12, 8, 24, 156][idx]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-100">
        <h3 className="text-lg font-bold text-slate-900 mb-4">Atividade Recente</h3>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div>
                <p className="font-semibold text-slate-900">Pedido #PED-100{item} criado</p>
                <p className="text-xs text-slate-600">Cliente: João Silva</p>
              </div>
              <span className="text-xs text-slate-600">há {item} minutos</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsPagePlaceholder() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Configurações</h2>
        <p className="text-slate-600">Personalize sua experiência no MegaDesk.</p>
      </div>
    </div>
  );
}

// BotConfigPage é importada de BotConfigPage.tsx

function AIAssistantPage() {
  // IMPORTANTE: usar a mesma chave que o login salva a sessão
  const SESSION_KEY = "megadesk_session_v1";

  // Ler sessão de forma reativa — atualiza se o localStorage mudar
  const [session, setSession] = React.useState<any>(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  // Ouvir mudanças no localStorage (ex: login em outra aba)
  React.useEffect(() => {
    const handler = () => {
      try {
        const raw = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY);
        setSession(raw ? JSON.parse(raw) : null);
      } catch { setSession(null); }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const clientId = session?.clientId ?? "";
  // Use email as userId for history (stable identifier)
  const userId = session?.userEmail ?? "";

  type ChatMessage = { role: "user" | "assistant"; content: string; timestamp: number; functionCalls?: string[] };

  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [geminiConfigured, setGeminiConfigured] = React.useState<boolean | null>(null);
  const [historyLoaded, setHistoryLoaded] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Verificar se Gemini está configurado
  const { data: geminiConfig } = trpc.assistant.checkGeminiConfig.useQuery(
    { clientId },
    { enabled: !!clientId, refetchOnWindowFocus: false }
  );

  React.useEffect(() => {
    if (geminiConfig !== undefined) {
      setGeminiConfigured(geminiConfig.configured);
    }
  }, [geminiConfig]);

  // Carregar histórico do banco
  const { data: historyData } = trpc.assistant.getHistory.useQuery(
    { clientId, userId },
    { enabled: !!clientId && !!userId && !historyLoaded, refetchOnWindowFocus: false }
  );

  React.useEffect(() => {
    if (historyData && !historyLoaded) {
      const loaded: ChatMessage[] = historyData.history.map((m: any) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp ?? Date.now(),
      }));
      if (loaded.length > 0) {
        setMessages(loaded);
      }
      setHistoryLoaded(true);
    }
  }, [historyData, historyLoaded]);

  // Scroll para o final ao receber nova mensagem
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const chatMutation = trpc.assistant.clientChat.useMutation();
  const clearHistoryMutation = trpc.assistant.clearHistory.useMutation();

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = { role: "user", content: text, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setSending(true);

    // Mensagem de "digitando"
    const typingMsg: ChatMessage = { role: "assistant", content: "...", timestamp: Date.now() };
    setMessages(prev => [...prev, typingMsg]);

    try {
      const result = await chatMutation.mutateAsync({ clientId, userId, message: text });
      setMessages(prev => [
        ...prev.slice(0, -1), // remove typing
        {
          role: "assistant",
          content: result.response,
          timestamp: Date.now(),
          functionCalls: result.functionCallsMade,
        },
      ]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev.slice(0, -1), // remove typing
        {
          role: "assistant",
          content: `❌ Erro: ${err.message ?? "Não foi possível obter resposta."}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearHistory = async () => {
    if (!confirm("Limpar todo o histórico de conversa com o Assistente IA?")) return;
    await clearHistoryMutation.mutateAsync({ clientId, userId });
    setMessages([]);
    setHistoryLoaded(false);
  };

  // Sugestões rápidas
  const suggestions = [
    "Quantas vendas tivemos hoje?",
    "Quantos chamados estão abertos?",
    "Resumo das conversas desta semana",
    "Quais produtos temos em estoque?",
  ];

  // Sem token configurado
  if (geminiConfigured === false) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-6">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center">
          <Sparkles className="w-8 h-8 text-amber-500" />
        </div>
        <div className="text-center max-w-md">
          <h2 className="text-xl font-bold text-slate-900 mb-2">Token Gemini não configurado</h2>
          <p className="text-slate-500 text-sm">
            O Assistente IA precisa de um token da API Gemini configurado pelo administrador.
            Entre em contato com o suporte para ativar esta funcionalidade.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-900 to-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Assistente IA</h2>
            <p className="text-xs text-slate-400">Powered by Gemini • {session?.company}</p>
          </div>
        </div>
        <button
          onClick={handleClearHistory}
          className="text-xs text-slate-400 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-900/20"
          title="Limpar histórico"
        >
          Limpar histórico
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-slate-50">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-6 py-12">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-emerald-500" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold text-slate-800 mb-1">Como posso ajudar?</h3>
              <p className="text-sm text-slate-500">Faça perguntas sobre vendas, chamados, conversas ou qualquer dado do sistema.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full max-w-lg">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                  className="text-left px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 hover:border-emerald-400 hover:bg-emerald-50 transition-all duration-150 shadow-sm"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-1">
                <Sparkles className="w-4 h-4 text-emerald-600" />
              </div>
            )}
            <div className={`max-w-[75%] ${msg.role === "user" ? "order-first" : ""}`}>
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-emerald-600 text-white rounded-tr-sm"
                    : msg.content === "..."
                    ? "bg-white border border-slate-200 text-slate-400 rounded-tl-sm"
                    : "bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm"
                }`}
              >
                {msg.content === "..." ? (
                  <span className="flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                ) : (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}
              </div>
              {msg.functionCalls && msg.functionCalls.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {msg.functionCalls.map((fc) => (
                    <span key={fc} className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                      🔍 {fc.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-400 mt-1 px-1">
                {new Date(msg.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            {msg.role === "user" && (
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0 mt-1">
                <span className="text-xs font-bold text-slate-600">{(session?.userName ?? "U").charAt(0).toUpperCase()}</span>
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-slate-100 bg-white">
        <div className="flex gap-3 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite sua mensagem... (Enter para enviar, Shift+Enter para nova linha)"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition-all bg-slate-50"
            style={{ maxHeight: "120px", overflowY: "auto" }}
            disabled={sending}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="w-11 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:cursor-not-allowed text-white flex items-center justify-center transition-all duration-150 active:scale-95 flex-shrink-0"
          >
            {sending ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 22 6.477 22 12h-4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2 text-center">
          O assistente pode consultar dados do sistema em tempo real quando necessário.
        </p>
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



function Shell() {
  const { theme, toggleTheme } = useTheme();
  const [active, setActive] = useState<RouteId>(() => {
    const stored = localStorage.getItem(MEGADESK_ACTIVE_PAGE_KEY);
    return (stored as RouteId) || "home";
  });
  const [session, setSession] = useState<MegaDeskSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [indicadores, setIndicadores] = useState<any>(null);
  const [activeCrmClientId, setActiveCrmClientId] = useState<string | null>(null);

  const loginMutation = trpc.megadesk.loginByEmail.useMutation();

  // Persistir página ativa no localStorage
  useEffect(() => {
    localStorage.setItem(MEGADESK_ACTIVE_PAGE_KEY, active);
  }, [active]);

  useEffect(() => {
    const storedSession = localStorage.getItem(MEGADESK_SESSION_KEY);
    if (storedSession) {
      try {
        const parsed = JSON.parse(storedSession);
        setSession(parsed);
        setLoading(false);
      } catch (e) {
        console.error("Failed to parse session:", e);
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, []);

  if (loading) return <LoadingSpinner />;
  if (!session) return <LoginPage onLoginSuccess={(newSession) => setSession(newSession)} />;

  const navItems = [
    { id: "home" as RouteId, label: "Home", icon: HomeIcon },
    { id: "active-attendance" as RouteId, label: "Atendimento Ativo", icon: PhoneCall },
    { id: "conversations" as RouteId, label: "Conversas", icon: MessageCircle },
    { id: "tickets" as RouteId, label: "Chamados", icon: ClipboardList },
    { id: "tracking" as RouteId, label: "Rastreamento", icon: MapPin },
    { id: "erp" as RouteId, label: "ERP", icon: PackageSearch },
    { id: "clients" as RouteId, label: "Clientes", icon: Building2 },
    { id: "whatsapp-config" as RouteId, label: "WhatsApp", icon: Smartphone },
    { id: "settings" as RouteId, label: "Configurações", icon: Cog },
    { id: "admin-settings" as RouteId, label: "Configurações Admin", icon: Cog },
    { id: "bot-config" as RouteId, label: "Configurar Bot", icon: Bot },
    { id: "ai-assistant" as RouteId, label: "Assistente IA", icon: Sparkles },
    { id: "help" as RouteId, label: "Ajuda", icon: AlertCircle },
    { id: "notifications" as RouteId, label: "Notificações", icon: Bell },
  ];

  // Itens que são sempre visíveis independente de permissões
  const alwaysVisibleItems = ["home", "settings", "help", "notifications"];
  
  const filteredNavItems = navItems.filter(item => {
    // Itens sempre visíveis
    if (alwaysVisibleItems.includes(item.id)) return true;
    // Itens que dependem de permissões: active-attendance, conversations, tickets, tracking, erp, bot-config, ai-assistant
    return session.permissions.includes(item.id);
  });

  // Separar itens em seções
  const mainNavItems = filteredNavItems.filter(item => !["settings", "admin-settings", "bot-config", "ai-assistant", "help", "notifications"].includes(item.id));
  const settingsNavItems = filteredNavItems.filter(item => ["settings", "admin-settings", "bot-config", "ai-assistant", "help", "notifications", "whatsapp-config"].includes(item.id));

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
              <div className="flex items-center gap-3 overflow-hidden">
                <Zap className="w-8 h-8 text-blue-400 flex-shrink-0" />
                <span className="font-bold text-2xl whitespace-nowrap transition-opacity duration-300">
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
          "bg-gradient-to-r from-purple-600/0 via-purple-500 to-purple-600/0 transition-all duration-300 my-2 shadow-lg shadow-purple-500/50",
          sidebarOpen ? "h-0.5 mx-4" : "h-px mx-2"
        )}></div>

        {/* Navigation */}
        <nav className={cn(
          "flex-1 p-3 space-y-1 pt-8 transition-all duration-300 scrollbar-hide",
          sidebarOpen ? "overflow-y-auto" : "overflow-hidden"
        )}>
          {mainNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            
            return (
              <button
                key={item.id}
                onClick={() => setActive(item.id)}
                className={cn(
                  "flex items-center py-3 rounded-lg transition-all duration-300 relative px-3 mx-2",
                  isActive
                    ? "bg-gradient-to-r from-purple-600 to-magenta-600 text-white shadow-2xl shadow-purple-500/50 rounded-xl"
                    : "text-slate-300 hover:text-white hover:bg-slate-800/50"
                )}
                style={isActive && sidebarOpen ? { width: '215px' } : {}}
                title={item.label}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {sidebarOpen && (
                  <span className="text-base font-medium transition-opacity duration-300 overflow-hidden whitespace-nowrap ml-3">
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
                  "flex items-center py-3 rounded-lg transition-all duration-300 relative px-3 mx-2",
                  isActive
                    ? "bg-gradient-to-r from-purple-600 to-magenta-600 text-white shadow-2xl shadow-purple-500/50 rounded-xl"
                    : "text-slate-300 hover:text-white hover:bg-slate-800/50"
                )}
                style={isActive && sidebarOpen ? { width: '215px' } : {}}
                title={item.label}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {sidebarOpen && (
                  <span className="text-base font-medium transition-opacity duration-300 overflow-hidden whitespace-nowrap ml-3">
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
              "flex items-center py-3 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/50 transition-all duration-200 px-2"
            )}
            title={`Mudar para modo ${theme === 'light' ? 'escuro' : 'claro'}`}
          >
            {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            {sidebarOpen && <span className="text-base font-medium ml-3">{theme === 'light' ? 'Modo Escuro' : 'Modo Claro'}</span>}
          </button>
          
          {/* Logout Button */}
          <button
            onClick={() => {
              localStorage.removeItem(MEGADESK_SESSION_KEY);
              localStorage.removeItem(MEGADESK_ACTIVE_PAGE_KEY);
              localStorage.removeItem("megadesk-session-token");
              localStorage.removeItem("manus-runtime-user-info");
              setSession(null);
            }}
            className={cn(
              "flex items-center py-3 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-900/20 transition-all duration-200 px-2"
            )}
            title="Sair"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {sidebarOpen && <span className="text-base font-medium ml-3">Sair</span>}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header — oculto na rota conversations pois ela tem header próprio */}
        <header className={`bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between${active === 'conversations' ? ' hidden' : ''}`}>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{navItems.find(i => i.id === active)?.label || 'MegaDesk'}</h1>
            <p className="text-sm text-slate-600">{session.company} • {session.userName}</p>
          </div>
          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors" title="Abrir assistente IA">
              <Sparkles className="w-6 h-6 text-slate-600" />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className={`flex-1 flex flex-col ${active === 'conversations' ? 'overflow-hidden' : 'overflow-auto p-8'}`}>
          {active === "home" && <DashboardPage setActive={setActive} indicadores={indicadores} />}
          {active === "conversations" && <ConversationsPage />}
          {active === "tickets" && <TicketsPage />}
          {active === "tracking" && <TrackingPage />}
          {active === "erp" && <ERPPage />}
          {active === "settings" && <SettingsPageComponent />}
          {active === "admin-settings" && session.role === "admin" && <AdminSettingsPage clientId={session.clientId} />}
          {active === "bot-config" && <BotConfigPage />}
          {active === "whatsapp-config" && <WhatsAppConfigPage />}
          {active === "ai-assistant" && <AIAssistantPage />}
          {active === "notifications" && <NotificationsPage />}
          {active === "active-attendance" && <ActiveAttendancePage onNavigate={(nav) => {
            if (typeof nav === 'string') {
              setActive(nav as RouteId);
            } else if (nav && typeof nav === 'object') {
              const { route, crmClientId } = nav as { route: string; crmClientId?: string };
              if (crmClientId) {
                setActiveCrmClientId(crmClientId);
              }
              setActive(route as RouteId);
            }
          }} />}
          {active === "clients" && <ClientesPage initialSelectedId={activeCrmClientId ?? undefined} onNavigate={(phone) => {
            // Navegar para Conversas com novo chat aberto
            setActive('conversations');
          }} />}
        </main>
      </div>

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

function MegaDeskLoginGate({ onLogin }: { onLogin: (session: MegaDeskSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [forgotSent, setForgotSent] = useState(false);

  const loginMutation = trpc.megadesk.loginByEmail.useMutation({
    onSuccess: (data) => {
      // Sempre salvar no localStorage para persistir após F5
      // rememberMe controla apenas a duração: 30 dias (true) vs 24 horas (false)
      const savedSession = saveSession(data.session, rememberMe);
      onLogin(savedSession);
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
      <div className="relative hidden w-[52%] flex-col justify-between overflow-hidden bg-slate-950 p-12 lg:flex">
        <div className="pointer-events-none absolute inset-0">
          <div className="login-orb-1 absolute -left-32 -top-32 h-[500px] w-[500px] rounded-full bg-blue-600/20 blur-[120px]" />
          <div className="login-orb-2 absolute -bottom-40 -right-20 h-[400px] w-[400px] rounded-full bg-cyan-500/15 blur-[100px]" />
          <div className="login-orb-3 absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/10 blur-[80px]" />
        </div>

        <div className="login-anim-logo relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-900">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-black tracking-tight text-white">MegaDesk</span>
        </div>

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

        <div className="login-anim-footer relative">
          <p className="text-xs text-slate-600">© {new Date().getFullYear()} MegaDesk. Todos os direitos reservados.</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 lg:px-16">
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-black text-slate-950">MegaDesk</span>
        </div>

        <div className="login-anim-form w-full max-w-[400px]">
          <div className="mb-8">
            <h2 className="text-3xl font-black text-slate-950">Bem-vindo de volta</h2>
            <p className="mt-2 text-slate-500">Entre com seu e-mail para continuar.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
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

            {error && (
              <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-4 py-3">
                <Lock className="h-4 w-4 shrink-0 text-red-500" />
                <p className="text-sm font-semibold text-red-700">{error}</p>
              </div>
            )}

            {forgotSent && (
              <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 px-4 py-3">
                <Mail className="h-4 w-4 shrink-0 text-emerald-600" />
                <p className="text-sm font-semibold text-emerald-700">Solicitação enviada. Aguarde o contato do suporte.</p>
              </div>
            )}

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

          <div className="my-8 flex items-center gap-4">
            <div className="h-px flex-1 bg-slate-100" />
            <span className="text-xs font-semibold text-slate-400">Precisa de ajuda?</span>
            <div className="h-px flex-1 bg-slate-100" />
          </div>

          <a
            href="https://wa.me/5541995484515?text=Ol%C3%A1%2C%20preciso%20de%20suporte%20para%20acessar%20o%20MegaDesk."
            target="_blank"
            rel="noopener noreferrer"
            className="login-anim-support flex h-12 w-full items-center justify-center gap-3 rounded-2xl border-2 border-slate-200 bg-white text-sm font-bold text-slate-700 transition hover:border-green-400 hover:bg-green-50 hover:text-green-700 hover:scale-[1.02] active:scale-[0.98]"
          >
            <MessageSquare className="h-4 w-4" />
            Falar com o suporte
          </a>

          <p className="mt-8 text-center text-xs text-slate-400">
            MegaDesk · Powered by MegaAdmin
          </p>
        </div>
      </div>
    </div>
  );
}

function useSessionRefresh(session: MegaDeskSession | null, setSession: (session: MegaDeskSession) => void) {
  const refreshMutation = trpc.megadesk.refreshSession.useMutation();

  React.useEffect(() => {
    if (!session) return;

    // Verificar se a sessão precisa ser renovada
    const checkAndRefresh = async () => {
      if (shouldRefreshSession(session)) {
        try {
          const result = await refreshMutation.mutateAsync({ userEmail: session.userEmail });
          if (result.ok) {
            const updatedSession = saveSession(result.session);
            setSession(updatedSession);
          }
        } catch (error) {
          console.error("Erro ao renovar sessão:", error);
          // Se falhar, não fazer nada - deixar o usuário continuar
        }
      }
    };

    // Verificar renovação imediatamente
    checkAndRefresh();

    // Configurar intervalo para verificar periodicamente
    const interval = setInterval(checkAndRefresh, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [session?.userEmail]);
}

export function Home() {
  const [session, setSession] = useState<MegaDeskSession | null>(() => loadSession());
  const [isValidating, setIsValidating] = useState(true);
  const refreshMutation = trpc.megadesk.refreshSession.useMutation();
  
  // Validar e renovar sessão ao carregar a página
  React.useEffect(() => {
    const validateAndRefreshSession = async () => {
      try {
        const loadedSession = loadSession();
        
        if (!loadedSession) {
          setIsValidating(false);
          return;
        }
        
        // Se a sessão está próxima de expirar, renovar
        if (shouldRefreshSession(loadedSession)) {
          try {
            const result = await refreshMutation.mutateAsync({ userEmail: loadedSession.userEmail });
            if (result.ok) {
              const updatedSession = saveSession(result.session);
              setSession(updatedSession);
            } else {
              clearSession();
              setSession(null);
            }
          } catch (error) {
            console.error("Erro ao renovar sessão ao carregar:", error);
            // Se falhar ao renovar, limpar sessão
            clearSession();
            setSession(null);
          }
        } else {
          setSession(loadedSession);
        }
      } catch (error) {
        console.error("Erro ao validar sessão:", error);
        clearSession();
        setSession(null);
      } finally {
        setIsValidating(false);
      }
    };
    
    validateAndRefreshSession();
  }, []);
  
  useSessionRefresh(session, setSession);

  if (isValidating) {
    return <LoadingSpinner />;
  }
  
  if (!session) {
    return <MegaDeskLoginGate onLogin={setSession} />;
  }

  return <Shell />;
}
