import React from 'react';
import { Menu, X, Home as HomeIcon, Phone, MessageCircle, Clipboard, MapPin, Building2, Settings, Zap, Moon, LogOut, Bell, Sparkles, Clock, ChevronRight } from 'lucide-react';

function HomePage() {
  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-blue-900 to-blue-800 rounded-2xl shadow-lg p-8 text-white">
        <div className="flex items-center gap-2 mb-4 w-fit px-3 py-1 rounded-full border border-blue-400/30 bg-blue-400/10">
          <Sparkles className="w-4 h-4" />
          <span className="text-xs font-medium">PLATAFORMA INTELIGENTE</span>
        </div>
        <h1 className="text-5xl font-bold mb-2">
          Mega<span className="text-blue-300">Desk</span>
        </h1>
        <p className="text-xl text-blue-100 mb-6">Atendimento Inteligente em Um Lugar</p>
        <p className="text-blue-100 mb-8">Gerencie conversas WhatsApp, chamados, rastreio e atendimento com IA. Tudo integrado e sincronizado.</p>
        <div className="flex gap-3">
          <button className="px-6 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg font-medium transition-colors">Acessar Dashboard</button>
          <button className="px-6 py-2 border border-blue-300 hover:bg-blue-400/10 rounded-lg font-medium transition-colors">Documentação</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-xs font-medium text-slate-500 uppercase">Conversas Abertas</span>
          </div>
          <p className="text-3xl font-bold text-slate-900">0</p>
          <p className="text-sm text-slate-600">em andamento</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
              <Clipboard className="w-5 h-5 text-green-600" />
            </div>
            <span className="text-xs font-medium text-slate-500 uppercase">Taxa de Resolução</span>
          </div>
          <p className="text-3xl font-bold text-slate-900">0%</p>
          <p className="text-sm text-slate-600">bot inteligente</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
              <Clipboard className="w-5 h-5 text-purple-600" />
            </div>
            <span className="text-xs font-medium text-slate-500 uppercase">Chamados Ativos</span>
          </div>
          <p className="text-3xl font-bold text-slate-900">0</p>
          <p className="text-sm text-slate-600">aguardando</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
              <Clock className="w-5 h-5 text-orange-600" />
            </div>
            <span className="text-xs font-medium text-slate-500 uppercase">Tempo Médio</span>
          </div>
          <p className="text-3xl font-bold text-slate-900">0m</p>
          <p className="text-sm text-slate-600">resposta</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Atalhos Principais</h2>
          <div className="space-y-3">
            <button className="w-full p-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-medium transition-colors flex items-center justify-between">
              <div className="flex items-center gap-3">
                <MessageCircle className="w-5 h-5" />
                <div className="text-left">
                  <p className="font-medium">Conversas</p>
                  <p className="text-xs text-blue-100">Central de atendimento</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5" />
            </button>
            <button className="w-full p-4 rounded-lg bg-purple-500 hover:bg-purple-600 text-white font-medium transition-colors flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clipboard className="w-5 h-5" />
                <div className="text-left">
                  <p className="font-medium">Chamados</p>
                  <p className="text-xs text-purple-100">Gerenciar tickets</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5" />
            </button>
            <button className="w-full p-4 rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium transition-colors flex items-center justify-between">
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5" />
                <div className="text-left">
                  <p className="font-medium">Rastreio</p>
                  <p className="text-xs text-green-100">Monitorar atividades</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Atividades Recentes</h2>
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
              <p className="font-medium text-slate-900">Novo chamado</p>
              <p className="text-sm text-slate-600">Solicitação de backup</p>
              <p className="text-xs text-slate-500 mt-1">Agora</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
              <p className="font-medium text-slate-900">BOT ativo</p>
              <p className="text-sm text-slate-600">Cliente em triagem</p>
              <p className="text-xs text-slate-500 mt-1">5 min</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
              <p className="font-medium text-slate-900">Token OK</p>
              <p className="text-sm text-slate-600">MegaAdmin validado</p>
              <p className="text-xs text-slate-500 mt-1">12 min</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConversationsPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Conversas</h2>
        <p className="text-slate-600 mb-6">Gerencie suas conversas WhatsApp.</p>
        
        <div className="flex gap-2 mb-6">
          <button className="px-4 py-2 rounded-lg bg-blue-100 text-blue-700 font-medium hover:bg-blue-200 transition-colors">Abertas</button>
          <button className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors">Atendimento BOT</button>
          <button className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors">Fechadas</button>
        </div>

        <div className="space-y-3">
          <div className="p-4 rounded-lg border border-slate-200 hover:border-slate-300 cursor-pointer transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900">Cliente #001</p>
                <p className="text-sm text-slate-600">Última mensagem: Olá, tudo bem?</p>
              </div>
              <span className="text-xs text-slate-500">5 min</span>
            </div>
          </div>
          <div className="p-4 rounded-lg border border-slate-200 hover:border-slate-300 cursor-pointer transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900">Cliente #002</p>
                <p className="text-sm text-slate-600">Última mensagem: Preciso de ajuda</p>
              </div>
              <span className="text-xs text-slate-500">12 min</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TicketsPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Chamados</h2>
        <p className="text-slate-600 mb-6">Gerenciar seus tickets de suporte.</p>
        
        <div className="flex gap-2 mb-6">
          <button className="px-4 py-2 rounded-lg bg-blue-100 text-blue-700 font-medium hover:bg-blue-200 transition-colors">Abertos</button>
          <button className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors">Em Progresso</button>
          <button className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors">Aguardando</button>
          <button className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors">Fechados</button>
        </div>

        <div className="space-y-3">
          <div className="p-4 rounded-lg border border-slate-200 hover:border-slate-300 cursor-pointer transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900">#TICKET-001 - Problema de acesso</p>
                <p className="text-sm text-slate-600">Prioridade: Alta</p>
              </div>
              <span className="px-3 py-1 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium">Em Progresso</span>
            </div>
          </div>
          <div className="p-4 rounded-lg border border-slate-200 hover:border-slate-300 cursor-pointer transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900">#TICKET-002 - Erro no sistema</p>
                <p className="text-sm text-slate-600">Prioridade: Média</p>
              </div>
              <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">Aberto</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackingPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Rastreamento</h2>
        <p className="text-slate-600 mb-6">Monitore suas atividades e eventos.</p>
        
        <input type="text" placeholder="Buscar rastreamento..." className="w-full px-4 py-2 border border-slate-200 rounded-lg mb-6 focus:outline-none focus:border-blue-500" />

        <div className="space-y-3">
          <div className="p-4 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900">Rastreamento #001</p>
                <p className="text-sm text-slate-600">Status: Em trânsito</p>
              </div>
              <span className="text-xs text-slate-500">Hoje</span>
            </div>
          </div>
          <div className="p-4 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900">Rastreamento #002</p>
                <p className="text-sm text-slate-600">Status: Entregue</p>
              </div>
              <span className="text-xs text-slate-500">Ontem</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ERPPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">ERP</h2>
        <p className="text-slate-600 mb-6">Dashboard operacional e métricas.</p>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-sm text-slate-600 mb-2">Vendas Hoje</p>
            <p className="text-2xl font-bold text-slate-900">R$ 0,00</p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-sm text-slate-600 mb-2">Pedidos Pendentes</p>
            <p className="text-2xl font-bold text-slate-900">0</p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-sm text-slate-600 mb-2">Clientes Ativos</p>
            <p className="text-2xl font-bold text-slate-900">0</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function BotConfigPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Configurar Bot</h2>
        <p className="text-slate-600 mb-6">Treine e configure seu assistente IA.</p>
        
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-slate-200">
            <p className="font-medium text-slate-900 mb-2">Treinar com Documentos</p>
            <p className="text-sm text-slate-600 mb-3">Faça upload de arquivos para treinar o bot</p>
            <button className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors">Upload de Arquivo</button>
          </div>
          <div className="p-4 rounded-lg border border-slate-200">
            <p className="font-medium text-slate-900 mb-2">Comportamento do Bot</p>
            <p className="text-sm text-slate-600 mb-3">Ajuste como o bot responde aos clientes</p>
            <textarea placeholder="Digite as instruções..." className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500" rows={4}></textarea>
          </div>
        </div>
      </div>
    </div>
  );
}

function AIAssistantPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Assistente IA</h2>
        <p className="text-slate-600 mb-6">Converse com seu assistente inteligente.</p>
        
        <div className="bg-slate-50 rounded-lg p-4 h-96 border border-slate-200 mb-4 flex items-center justify-center">
          <p className="text-slate-500">Chat carregando...</p>
        </div>
        
        <div className="flex gap-2">
          <input type="text" placeholder="Digite sua mensagem..." className="flex-1 px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500" />
          <button className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors">Enviar</button>
        </div>
      </div>
    </div>
  );
}

function HelpPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Ajuda</h2>
        <p className="text-slate-600 mb-6">Encontre respostas para suas dúvidas.</p>
        
        <div className="space-y-3">
          <div className="p-4 rounded-lg border border-slate-200 hover:border-slate-300 cursor-pointer transition-colors">
            <p className="font-medium text-slate-900">Como criar uma conversa?</p>
            <p className="text-sm text-slate-600">Clique em Conversas e selecione novo cliente</p>
          </div>
          <div className="p-4 rounded-lg border border-slate-200 hover:border-slate-300 cursor-pointer transition-colors">
            <p className="font-medium text-slate-900">Como treinar o bot?</p>
            <p className="text-sm text-slate-600">Acesse Configurar Bot e faça upload de documentos</p>
          </div>
          <div className="p-4 rounded-lg border border-slate-200 hover:border-slate-300 cursor-pointer transition-colors">
            <p className="font-medium text-slate-900">Como criar um chamado?</p>
            <p className="text-sm text-slate-600">Clique em Chamados e selecione novo ticket</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function LayoutEditorPage({ onBack }: { onBack: () => void }) {
  const [sidebarColors, setSidebarColors] = React.useState(() => {
    const saved = localStorage.getItem('sidebarColors');
    return saved ? JSON.parse(saved) : {
      background: '#0f172a',
      accentStart: '#9333ea',
      accentEnd: '#ec4899',
      glowColor: '#a855f7',
      textPrimary: '#ffffff',
      textSecondary: '#cbd5e1',
    };
  });

  const [saved, setSaved] = React.useState(false);

  const handleSave = () => {
    localStorage.setItem('sidebarColors', JSON.stringify(sidebarColors));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const presets = [
    {
      name: 'Roxo Padrão',
      colors: {
        background: '#0f172a',
        accentStart: '#9333ea',
        accentEnd: '#ec4899',
        glowColor: '#a855f7',
        textPrimary: '#ffffff',
        textSecondary: '#cbd5e1',
      }
    },
    {
      name: 'Azul Profissional',
      colors: {
        background: '#0c1222',
        accentStart: '#0ea5e9',
        accentEnd: '#06b6d4',
        glowColor: '#0284c7',
        textPrimary: '#ffffff',
        textSecondary: '#cbd5e1',
      }
    },
    {
      name: 'Verde Moderno',
      colors: {
        background: '#051f1f',
        accentStart: '#10b981',
        accentEnd: '#14b8a6',
        glowColor: '#059669',
        textPrimary: '#ffffff',
        textSecondary: '#cbd5e1',
      }
    },
    {
      name: 'Laranja Vibrante',
      colors: {
        background: '#1f1209',
        accentStart: '#f97316',
        accentEnd: '#ea580c',
        glowColor: '#fb923c',
        textPrimary: '#ffffff',
        textSecondary: '#cbd5e1',
      }
    },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Edição de Layout</h2>
            <p className="text-slate-600">Personalize as cores da barra lateral</p>
          </div>
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        {/* Temas Pré-definidos */}
        <div className="mb-8">
          <h3 className="text-lg font-bold text-slate-900 mb-4">Temas Pré-definidos</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {presets.map((preset) => (
              <button
                key={preset.name}
                onClick={() => setSidebarColors(preset.colors)}
                className="p-4 rounded-lg border-2 border-slate-200 hover:border-purple-400 transition-all duration-200 text-left"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-full"
                    style={{
                      background: `linear-gradient(135deg, ${preset.colors.accentStart} 0%, ${preset.colors.accentEnd} 100%)`
                    }}
                  ></div>
                  <span className="text-sm font-medium text-slate-900">{preset.name}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Editor de Cores */}
        <div className="mb-8 pb-8 border-b border-slate-200">
          <h3 className="text-lg font-bold text-slate-900 mb-4">Cores Personalizadas</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { key: 'background', label: 'Fundo da Barra' },
              { key: 'accentStart', label: 'Gradiente Início' },
              { key: 'accentEnd', label: 'Gradiente Fim' },
              { key: 'glowColor', label: 'Cor do Glow' },
            ].map((color) => (
              <div key={color.key} className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-700">{color.label}</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={sidebarColors[color.key as keyof typeof sidebarColors]}
                    onChange={(e) => setSidebarColors((prev: any) => ({ ...prev, [color.key]: e.target.value }))}
                    className="w-12 h-12 rounded-lg cursor-pointer border border-slate-300"
                  />
                  <input
                    type="text"
                    value={sidebarColors[color.key as keyof typeof sidebarColors]}
                    onChange={(e) => setSidebarColors((prev: any) => ({ ...prev, [color.key]: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                    placeholder="#000000"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pré-visualização e Botão Salvar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-sm font-medium text-slate-600 mb-2">Pré-visualização:</p>
              <div
                className="w-20 h-40 rounded-lg shadow-lg flex flex-col items-center justify-center gap-2 p-2"
                style={{
                  backgroundColor: sidebarColors.background,
                  boxShadow: `0 0 20px ${sidebarColors.glowColor}40`
                }}
              >
                <div
                  className="w-10 h-10 rounded-lg"
                  style={{
                    background: `linear-gradient(135deg, ${sidebarColors.accentStart} 0%, ${sidebarColors.accentEnd} 100%)`
                  }}
                ></div>
                <div
                  className="w-12 h-1 rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${sidebarColors.accentStart}00 0%, ${sidebarColors.glowColor} 50%, ${sidebarColors.accentEnd}00 100%)`
                  }}
                ></div>
              </div>
            </div>
          </div>

          <button
            onClick={handleSave}
            className={`px-6 py-3 rounded-lg font-medium transition-all duration-200 ${
              saved
                ? 'bg-green-500 text-white'
                : 'bg-blue-500 hover:bg-blue-600 text-white'
            }`}
          >
            {saved ? '✓ Salvo!' : 'Salvar Cores'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsPage() {
  const [editingLayout, setEditingLayout] = React.useState(false);

  if (editingLayout) {
    return <LayoutEditorPage onBack={() => setEditingLayout(false)} />;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Configurações</h2>
        <p className="text-slate-600 mb-8">Personalize sua experiência no MegaDesk.</p>

        {/* Menu de Opções */}
        <div className="space-y-3">
          <button
            onClick={() => setEditingLayout(true)}
            className="w-full p-4 rounded-lg border border-slate-200 hover:border-purple-400 hover:bg-purple-50 transition-all duration-200 text-left flex items-center justify-between"
          >
            <div>
              <p className="font-medium text-slate-900">Edição de Layout</p>
              <p className="text-sm text-slate-600">Personalize as cores da barra lateral</p>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-400" />
          </button>
          
          <button className="w-full p-4 rounded-lg border border-slate-200 hover:border-purple-400 hover:bg-purple-50 transition-all duration-200 text-left flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-900">Notificações</p>
              <p className="text-sm text-slate-600">Gerenciar alertas e notificações</p>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-400" />
          </button>
          
          <button className="w-full p-4 rounded-lg border border-slate-200 hover:border-purple-400 hover:bg-purple-50 transition-all duration-200 text-left flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-900">Privacidade</p>
              <p className="text-sm text-slate-600">Controlar dados e privacidade</p>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [currentPage, setCurrentPage] = React.useState('home');
  const [isDark, setIsDark] = React.useState(false);

  const pages: { [key: string]: React.ReactNode } = {
    home: <HomePage />,
    conversations: <ConversationsPage />,
    tickets: <TicketsPage />,
    tracking: <TrackingPage />,
    erp: <ERPPage />,
    bot: <BotConfigPage />,
    assistant: <AIAssistantPage />,
    help: <HelpPage />,
    settings: <SettingsPage />,
  };

  const navItems = [
    { id: 'home', label: 'Home', icon: HomeIcon },
    { id: 'conversations', label: 'Atendimento Ativo', icon: Phone },
    { id: 'conversations', label: 'Conversas', icon: MessageCircle },
    { id: 'tickets', label: 'Chamados', icon: Clipboard },
    { id: 'tracking', label: 'Rastreamento', icon: MapPin },
    { id: 'erp', label: 'ERP', icon: Building2 },
  ];

  const bottomItems = [
    { id: 'bot', label: 'Configurar Bot', icon: Zap },
    { id: 'assistant', label: 'Assistente IA', icon: Sparkles },
    { id: 'help', label: 'Ajuda', icon: MessageCircle },
    { id: 'settings', label: 'Configurações', icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-slate-100">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } bg-slate-900 text-white transition-all duration-300 flex flex-col border-r border-slate-800 overflow-hidden`}
      >
        {/* Header */}
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Zap className="w-8 h-8 text-purple-400 flex-shrink-0" />
            {sidebarOpen && <span className="font-bold text-lg whitespace-nowrap">MegaDesk</span>}
          </div>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 hover:bg-slate-800 rounded-lg transition-colors flex-shrink-0"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Divider */}
        <div
          className={`${sidebarOpen ? 'h-1' : 'h-px'} bg-gradient-to-r from-purple-600/0 via-purple-500 to-purple-600/0 transition-all duration-300 mx-2`}
        ></div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto pt-8 px-2">
          <div className="space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPage === item.id;
              return (
                <button
                  key={`${item.id}-${item.label}`}
                  onClick={() => setCurrentPage(item.id)}
                  className={`w-full px-2 py-3 rounded-xl transition-all duration-200 flex items-center gap-3 ${
                    isActive
                      ? `bg-gradient-to-r from-purple-600 to-magenta-600 text-white shadow-2xl shadow-purple-500/50 rounded-xl ${sidebarOpen ? 'w-[215px]' : ''}`
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/50'
                  }`}
                  style={isActive && sidebarOpen ? { width: '215px' } : {}}
                  title={item.label}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {sidebarOpen && <span className="text-sm font-medium truncate">{item.label}</span>}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Bottom Items */}
        <div className="border-t border-slate-800 p-2 space-y-2">
          {bottomItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentPage(item.id)}
                className={`w-full px-2 py-3 rounded-xl transition-all duration-200 flex items-center gap-3 ${
                  isActive
                    ? `bg-gradient-to-r from-purple-600 to-magenta-600 text-white shadow-2xl shadow-purple-500/50 rounded-xl ${sidebarOpen ? 'w-[215px]' : ''}`
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/50'
                }`}
                style={isActive && sidebarOpen ? { width: '215px' } : {}}
                title={item.label}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {sidebarOpen && <span className="text-sm font-medium truncate">{item.label}</span>}
              </button>
            );
          })}

          {/* Theme & Logout */}
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <button
              onClick={() => setIsDark(!isDark)}
              className="w-full px-2 py-3 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/50 transition-all duration-200 flex items-center gap-3"
              title="Mudar para modo escuro"
            >
              <Moon className="w-5 h-5 flex-shrink-0" />
              {sidebarOpen && <span className="text-sm font-medium truncate">Modo Escuro</span>}
            </button>
            <button
              className="w-full px-2 py-3 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/50 transition-all duration-200 flex items-center gap-3"
              title="Sair"
            >
              <LogOut className="w-5 h-5 flex-shrink-0" />
              {sidebarOpen && <span className="text-sm font-medium truncate">Sair</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {navItems.find((item) => item.id === currentPage)?.label || 'Configurações'}
            </h1>
            <p className="text-sm text-slate-600">Empresa Teste • Usuário Teste</p>
          </div>
          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors" title="Notificações">
              <Bell className="w-5 h-5 text-slate-600" />
            </button>
            <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors" title="Abrir assistente IA">
              <Sparkles className="w-5 h-5 text-slate-600" />
            </button>
          </div>
        </div>

        {/* Page Content */}
        <div className="flex-1 overflow-auto p-8">
          {pages[currentPage]}
        </div>
      </div>
    </div>
  );
}
