import React, { useState, useEffect } from "react";
import { navigateToPlatform } from "@/lib/platformRouting";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { validateNewChamado, ValidationError } from "@/lib/validations";
import { ActiveAttendancePage } from "./ActiveAttendance";
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
} from "lucide-react";

const MEGADESK_SESSION_KEY = "megadesk_session_v1";
const MEGADESK_ACTIVE_PAGE_KEY = "megadesk_active_page_v1";

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
  const [searchTerm, setSearchTerm] = React.useState('');
  const [selectedFilter, setSelectedFilter] = React.useState<'open' | 'bot' | 'closed'>('open');
  const [selectedConversation, setSelectedConversation] = React.useState<string | null>(null);
  const [conversations, setConversations] = React.useState<any[]>([]);
  const [editModalOpen, setEditModalOpen] = React.useState(false);
  const [editName, setEditName] = React.useState('');
  const [editCompany, setEditCompany] = React.useState('');
  const [closeConfirmOpen, setCloseConfirmOpen] = React.useState(false);
  const [reopenConfirmOpen, setReopenConfirmOpen] = React.useState(false);
  const [toastMessage, setToastMessage] = React.useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Mutations tRPC
  const closeConversationMutation = trpc.megadesk.closeConversation.useMutation();
  const updateCustomerMutation = trpc.megadesk.updateCustomerInfo.useMutation();

  // Função para exibir toast
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ message, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Função para encerrar conversa
  const handleCloseConversation = async () => {
    if (!selectedConversation) return;
    
    // Atualizacao otimista - fecha o modal e atualiza a lista imediatamente
    setCloseConfirmOpen(false);
    setConversations(prev => prev.map(conv => 
      conv.id === selectedConversation ? { ...conv, status: 'closed' } : conv
    ));
    showToast('Conversa encerrada!', 'success');
    
    // Envia a requisicao para o backend em background
    try {
      await closeConversationMutation.mutateAsync({ conversationId: selectedConversation });
    } catch (error) {
      console.error('Erro ao encerrar conversa:', error);
      // Reverter a mudanca se falhar
      setConversations(prev => prev.map(conv => 
        conv.id === selectedConversation ? { ...conv, status: 'open' } : conv
      ));
      showToast('Erro ao encerrar conversa', 'error');
    }
  };

  // Função para reabrir conversa
  const handleReopenConversation = async () => {
    if (!selectedConversation) return;
    
    try {
      // Aqui você pode implementar a lógica de reabertura se houver um endpoint
      // Por enquanto, vamos apenas atualizar o status localmente
      setConversations(prev => prev.map(conv => 
        conv.id === selectedConversation ? { ...conv, status: 'open' } : conv
      ));
      
      setReopenConfirmOpen(false);
      showToast('Conversa reabierta com sucesso!', 'success');
    } catch (error) {
      console.error('Erro ao reabrir conversa:', error);
      showToast('Erro ao reabrir conversa', 'error');
    }
  };

  // Capturar parâmetros da URL e localStorage ao carregar a página
  React.useEffect(() => {
    // Verificar localStorage para nova conversa criada
    const newConvId = localStorage.getItem('MEGADESK_NEW_CONVERSATION_ID');
    const newConvPhone = localStorage.getItem('MEGADESK_NEW_CONVERSATION_PHONE');
    
    if (newConvId && newConvPhone) {
      // Auto-selecionar a conversa criada
      setSelectedConversation(newConvId);
      setSelectedFilter('open');
      
      // Limpar localStorage
      localStorage.removeItem('MEGADESK_NEW_CONVERSATION_ID');
      localStorage.removeItem('MEGADESK_NEW_CONVERSATION_PHONE');
    } else {
      // Ler parâmetros do hash (ex: #/conversas?clientId=...&phone=...)
      const hash = window.location.hash;
      const queryStart = hash.indexOf('?');
      
      if (queryStart !== -1) {
        const queryString = hash.substring(queryStart + 1);
        const params = new URLSearchParams(queryString);
        const clientId = params.get('clientId');
        const phone = params.get('phone');
        
        if (clientId && phone) {
          // Abrir automaticamente a conversa do cliente
          setSelectedConversation(clientId);
          // Limpar os parâmetros da URL
          window.history.replaceState({}, document.title, window.location.pathname + '#/conversas');
        }
      }
    }
  }, []);

  // Carregar conversas via tRPC
  const { data: conversationsData } = trpc.megadesk.getConversations.useQuery();
  
  React.useEffect(() => {
    if (conversationsData && conversationsData.length > 0) {
      setConversations(conversationsData);
    } else {
      // Mock data como fallback
      setConversations([
        { id: 'cust-1778848377677', name: 'João Silva', phone: '11999999999', company: 'Tech Solutions', lastMessage: 'Olá, tudo bem?', timestamp: '10:30', status: 'open' },
      ]);
    }
  }, [conversationsData]);

  // Mock data para conversas (será substituído por dados reais do banco)
  const mockConversations = conversations;

  const filters: Array<{ id: 'open' | 'bot' | 'closed'; label: string; color: string }> = [
    { id: 'open', label: 'Abertas', color: 'bg-green-500' },
    { id: 'bot', label: 'Atendimento BOT', color: 'bg-slate-700' },
    { id: 'closed', label: 'Fechadas', color: 'bg-slate-900' },
  ];

  return (
    <div className="flex h-full gap-6">
      {/* Left Panel - Conversations List */}
      <div className="w-1/3 bg-white rounded-2xl shadow-lg border border-slate-100 p-6 flex flex-col">
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <MessageCircle className="w-5 h-5 text-slate-600" />
            <h2 className="text-xl font-bold text-slate-900">Conversas</h2>
          </div>
          <p className="text-slate-500 text-sm ml-7">{mockConversations?.length || 0} conversas</p>
        </div>

        {/* Search Bar */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar número..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>

        {/* Filter Tabs */}
        <div className="mb-6">
          <div className="flex gap-4 pb-3 border-b border-slate-200">
            {filters.map((filter, index) => (
              <div key={filter.id} className="flex items-center">
                <button
                  onClick={() => setSelectedFilter(filter.id)}
                  className={cn(
                    'filter-button flex items-center gap-2 px-0 py-2 font-medium text-sm transition-all duration-200 whitespace-nowrap cursor-pointer',
                    selectedFilter === filter.id
                      ? 'active text-slate-900 font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  <div className={cn('filter-dot w-2 h-2 rounded-full', filter.color)}></div>
                  {filter.label}
                </button>
                {index < filters.length - 1 && (
                  <div className="w-px h-5 bg-slate-300 mx-2"></div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {mockConversations && mockConversations.length > 0 ? (
            mockConversations
              .filter((conv) => {
                const matchesFilter = conv.status === selectedFilter;
                const matchesSearch = searchTerm === '' || conv.phone.includes(searchTerm) || conv.name.toLowerCase().includes(searchTerm.toLowerCase());
                return matchesFilter && matchesSearch;
              })
              .map((conv) => (
              <button
                key={conv.id}
                onClick={() => setSelectedConversation(conv.id)}
                className={cn(
                  'w-full text-left p-3 rounded-lg transition-all duration-200 border-l-4',
                  selectedConversation === conv.id
                    ? 'bg-blue-50 border-l-blue-500 shadow-md'
                    : 'bg-white border-l-transparent hover:bg-slate-50'
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{conv.name}</p>
                    <p className="text-xs text-slate-500 truncate">{conv.company}</p>
                    <p className={cn(
                      'text-sm truncate mt-1',
                      conv.status === 'closed'
                        ? 'text-slate-500 italic'
                        : conv.isUnread ? 'font-bold text-slate-900' : 'text-slate-600'
                    )}>
                      {conv.status === 'closed' ? 'Conversa encerrada' : conv.lastMessage}
                    </p>
                  </div>
                  <span className="text-xs text-slate-400 ml-2 flex-shrink-0">
                    {typeof conv.timestamp === 'string' && conv.timestamp.includes(':')
                      ? new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                      : new Date(conv.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                  </span>
                </div>
              </button>
            ))
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <MessageCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">Nenhuma conversa neste filtro</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Chat View */}
      <div className="flex-1 bg-white rounded-2xl shadow-lg border border-slate-100 p-6 flex flex-col">
        {selectedConversation && mockConversations ? (
          (() => {
            const selectedConv = mockConversations.find((c) => c.id === selectedConversation);
            return selectedConv ? (
              <div className="flex flex-col h-full">
                <div className="border-b border-slate-200 pb-4 mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-slate-900">{selectedConv.name}</h3>
                      <button
                        onClick={() => {
                          setEditName(selectedConv.name);
                          setEditCompany(selectedConv.company);
                          setEditModalOpen(true);
                        }}
                        className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
                        title="Editar cliente"
                      >
                        <Cog className="w-4 h-4 text-slate-500 hover:text-slate-700" />
                      </button>
                    </div>
                    <button
                      onClick={() => {
                        if (selectedConv.status === 'closed') {
                          setReopenConfirmOpen(true);
                        } else {
                          setCloseConfirmOpen(true);
                        }
                      }}
                      className="px-3 py-1 text-sm bg-slate-100 text-slate-900 rounded-lg hover:bg-slate-200 transition-colors font-medium"
                    >
                      {selectedConv.status === 'closed' ? 'Abrir Conversa' : 'Encerrar Conversa'}
                    </button>
                  </div>
                  <p className="text-sm text-slate-600">{selectedConv.phone} • {selectedConv.company}</p>
                </div>
                <div className="flex-1 overflow-y-auto space-y-4 mb-4">
                  <div className="bg-slate-50 p-4 rounded-lg">
                    <p className="text-sm text-slate-700">{selectedConv.lastMessage}</p>
                    <p className="text-xs text-slate-500 mt-2">{selectedConv.timestamp}</p>
                  </div>
                </div>
                <div className="border-t border-slate-200 pt-4 space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Digite sua mensagem..."
                      className="flex-1 px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <MessageCircle className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Conversa não encontrada</h3>
                  <p className="text-slate-600 text-sm">Selecione uma conversa válida da lista</p>
                </div>
              </div>
            );
          })()
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <MessageCircle className="w-16 h-16 text-slate-300 mb-4" />
              <h3 className="text-lg font-bold text-slate-900 mb-2">Selecione uma conversa para visualizar</h3>
              <p className="text-slate-600 text-sm">Clique em uma conversa da lista para ver os detalhes</p>
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
  const [searchTerm, setSearchTerm] = React.useState('');
  const [selectedFilter, setSelectedFilter] = React.useState<'total' | 'open' | 'in_progress' | 'waiting' | 'closed'>('total');
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

  // Queries tRPC
  const chamadosQuery = trpc.chamados.list.useQuery(
    {
      status: selectedFilter,
      limit: 100, // Aumentar limite para mostrar mais chamados
      offset: 0,
    },
    { enabled: !!user?.user?.id }
  );

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

      // Recarregar a lista de chamados
      await chamadosQuery.refetch();
      await utils.chamados.list.invalidate();
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

      // Recarregar a lista de chamados
      const refetchedChamado = await chamadosQuery.refetch();
      if (refetchedChamado.data?.chamados) {
        const updated = refetchedChamado.data.chamados.find((c: any) => c.id === selectedChamado.id);
        if (updated) {
          setSelectedChamado(updated);
        }
      }
      await utils.chamados.list.invalidate();
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
      const result = await createChamadoMutation.mutateAsync({
        customerId: 'cust-' + Date.now(),
        customerName: newChamadoForm.customerName,
        company: newChamadoForm.company,
        title: newChamadoForm.title,
        observations: newChamadoForm.observations,
        priority: newChamadoForm.priority,
      });

      if (result.chamado) {
        showToast('Chamado criado com sucesso!', 'success');
        setShowNewChamadoModal(false);
        setNewChamadoForm({
          customerName: '',
          company: '',
          title: '',
          observations: '',
          priority: 'media',
        });
        // Invalidar cache de todas as queries de chamados
        await utils.chamados.list.invalidate();
        // Refetch para garantir que os dados mais recentes sejam carregados
        await chamadosQuery.refetch();
      }
    } catch (error) {
      showToast('Erro ao criar chamado', 'error');
    }
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

  // Contar status (com base no filtro de usuário)
  const statusCounts = {
    total: chamadosFiltrados.filter(c => c.status !== 'closed').length,
    open: chamadosFiltrados.filter(c => c.status === 'open').length,
    in_progress: chamadosFiltrados.filter(c => c.status === 'in_progress').length,
    waiting: chamadosFiltrados.filter(c => c.status === 'waiting').length,
    closed: chamadosFiltrados.filter(c => c.status === 'closed').length,
  };

  const statusCards: Array<{ id: 'total' | 'open' | 'in_progress' | 'waiting' | 'closed'; label: string; value: number; gradient: string; bgGradient: string; icon: any; iconColor: string }> = [
    { id: 'total', label: 'Total', value: statusCounts.total, gradient: 'from-slate-600 to-slate-900', bgGradient: 'from-slate-50 to-slate-100', icon: Ticket, iconColor: 'text-slate-700' },
    { id: 'open', label: 'Abertos', value: statusCounts.open, gradient: 'from-blue-400 to-blue-600', bgGradient: 'from-blue-50 to-blue-100', icon: AlertCircle, iconColor: 'text-blue-600' },
    { id: 'in_progress', label: 'Em Progresso', value: statusCounts.in_progress, gradient: 'from-amber-400 to-amber-600', bgGradient: 'from-amber-50 to-amber-100', icon: Clock, iconColor: 'text-amber-600' },
    { id: 'waiting', label: 'Aguardando', value: statusCounts.waiting, gradient: 'from-orange-400 to-orange-600', bgGradient: 'from-orange-50 to-orange-100', icon: Hourglass, iconColor: 'text-orange-600' },
    { id: 'closed', label: 'Fechados', value: statusCounts.closed, gradient: 'from-emerald-400 to-emerald-600', bgGradient: 'from-emerald-50 to-emerald-100', icon: CheckCircle2, iconColor: 'text-emerald-600' },
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
      <div className="grid grid-cols-5 gap-4">
        {statusCards.map((card: any, idx) => {
          const Icon = card.icon;
          const isSelected = selectedFilter === card.id;
          return (
            <button
              key={card.id}
              onClick={() => setSelectedFilter(card.id)}
              className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${card.bgGradient} p-6 transition-all duration-300 border-2 ${
                isSelected
                  ? `border-current shadow-xl scale-105`
                  : `border-transparent hover:shadow-lg hover:scale-102 hover:-translate-y-1`
              }`}
            >
              <div className={`absolute -top-8 -right-8 w-32 h-32 bg-gradient-to-br ${card.gradient} rounded-full blur-2xl opacity-10 group-hover:opacity-20 transition-all duration-300`} />
              
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-3">
                  <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${card.gradient} flex items-center justify-center`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className={`w-1.5 h-1.5 rounded-full bg-gradient-to-r ${card.gradient} ${isSelected ? 'animate-pulse' : ''}`} />
                </div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">{card.label}</p>
                <p className={`text-3xl font-black bg-gradient-to-r ${card.gradient} bg-clip-text text-transparent group-hover:scale-110 transition-transform duration-300 origin-left`}>
                  {card.value}
                </p>
              </div>
              
              <div className={`absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r ${card.gradient} transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left`} />
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



      {/* Modal de Novo Chamado */}
      <Dialog open={showNewChamadoModal} onOpenChange={setShowNewChamadoModal}>
        <DialogContent className="max-w-md bg-white dark:bg-slate-800 border-2 border-blue-200 dark:border-blue-900 shadow-xl rounded-lg">
          <DialogHeader className="bg-gradient-to-r from-blue-500 to-blue-600 -m-6 mb-4 p-6 rounded-t-lg">
            <DialogTitle className="text-white text-lg font-bold flex items-center gap-2">
              <Plus className="w-5 h-5" />
              Novo Chamado
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 px-2">
            <div>
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 block mb-2">Nome do Cliente</label>
              <Input
                placeholder="Ex: Joao Silva"
                value={newChamadoForm.customerName}
                onChange={e => setNewChamadoForm({...newChamadoForm, customerName: e.target.value})}
                className={`bg-slate-50 dark:bg-slate-700 border-2 transition-colors ${
                  validationErrors.find(e => e.field === 'customerName')
                    ? 'border-red-500 dark:border-red-500'
                    : 'border-slate-200 dark:border-slate-600 focus:border-blue-500'
                }`}
              />
              {validationErrors.find(e => e.field === 'customerName') && (
                <p className="text-xs text-red-500 dark:text-red-400 mt-1 font-medium">{validationErrors.find(e => e.field === 'customerName')?.message}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 block mb-2">Empresa</label>
              <Input
                placeholder="Ex: Empresa XYZ"
                value={newChamadoForm.company}
                onChange={e => setNewChamadoForm({...newChamadoForm, company: e.target.value})}
                className={`bg-slate-50 dark:bg-slate-700 border-2 transition-colors ${
                  validationErrors.find(e => e.field === 'company')
                    ? 'border-red-500 dark:border-red-500'
                    : 'border-slate-200 dark:border-slate-600 focus:border-blue-500'
                }`}
              />
              {validationErrors.find(e => e.field === 'company') && (
                <p className="text-xs text-red-500 dark:text-red-400 mt-1 font-medium">{validationErrors.find(e => e.field === 'company')?.message}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 block mb-2">Título</label>
              <Input
                placeholder="Ex: Problema com login"
                value={newChamadoForm.title}
                onChange={e => setNewChamadoForm({...newChamadoForm, title: e.target.value})}
                className={`bg-slate-50 dark:bg-slate-700 border-2 transition-colors ${
                  validationErrors.find(e => e.field === 'title')
                    ? 'border-red-500 dark:border-red-500'
                    : 'border-slate-200 dark:border-slate-600 focus:border-blue-500'
                }`}
              />
              {validationErrors.find(e => e.field === 'title') && (
                <p className="text-xs text-red-500 dark:text-red-400 mt-1 font-medium">{validationErrors.find(e => e.field === 'title')?.message}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 block mb-2">Observações</label>
              <Input
                placeholder="Detalhes adicionais..."
                value={newChamadoForm.observations}
                onChange={e => setNewChamadoForm({...newChamadoForm, observations: e.target.value})}
                className="bg-slate-50 dark:bg-slate-700 border-2 border-slate-200 dark:border-slate-600 focus:border-blue-500 transition-colors"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 block mb-2">Prioridade</label>
              <Select value={newChamadoForm.priority} onValueChange={priority => setNewChamadoForm({...newChamadoForm, priority: priority as 'media' | 'baixa' | 'alta' | 'critica'})}>
                <SelectTrigger className="bg-slate-50 dark:bg-slate-700 border-2 border-slate-200 dark:border-slate-600 focus:border-blue-500 transition-colors">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-600">
                  <SelectItem value="baixa">🟢 Baixa</SelectItem>
                  <SelectItem value="media">🟡 Média</SelectItem>
                  <SelectItem value="alta">🔴 Alta</SelectItem>
                  <SelectItem value="critica">🔴 Crítica</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3 pt-6 border-t border-slate-200 dark:border-slate-700 mt-6">
              <Button
                onClick={handleCreateChamado}
                disabled={createChamadoMutation.isPending}
                className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold shadow-md hover:shadow-lg transition-all"
              >
                {createChamadoMutation.isPending ? '⏳ Criando...' : '✅ Criar Chamado'}
              </Button>
              <Button
                onClick={() => setShowNewChamadoModal(false)}
                variant="outline"
                className="flex-1 border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-semibold transition-colors"
              >
                ✕ Cancelar
              </Button>
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
          {active === "active-attendance" && <ActiveAttendancePage onNavigate={(route) => setActive(route as RouteId)} />}
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

export function Home() {
  return <Shell />;
}
