import React, { useState, useMemo } from 'react';
import { Phone, User, Building2, CheckCircle, AlertCircle, Loader2, ArrowRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';

const MEGADESK_SESSION_KEY = "megadesk_session_v1";

export function ActiveAttendancePage({ onNavigate }: { onNavigate?: (route: any) => void }) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [customerData, setCustomerData] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerCompany, setNewCustomerCompany] = useState('');
  const [openTicket, setOpenTicket] = useState<boolean | null>(null);
  const [ticketTitle, setTicketTitle] = useState('');
  const [ticketObservation, setTicketObservation] = useState('');
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Obter clientId da sessão do usuário logado
  const session = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(MEGADESK_SESSION_KEY) || 'null'); } catch { return null; }
  }, []);
  const clientId: string = session?.clientId ?? '';

  // tRPC mutations
  const searchCustomerMutation = trpc.megadesk.searchCustomer.useMutation();
  const createCustomerMutation = trpc.megadesk.createCustomer.useMutation();
  const createTicketMutation = trpc.megadesk.createTicket.useMutation();
  const createConversationMutation = trpc.megadesk.createConversation.useMutation();

  const handleSearchCustomer = async () => {
    if (!phoneNumber.trim()) {
      setError('Por favor, insira um número de telefone');
      return;
    }

    setError(null);
    setSuccessMessage(null);
    setIsSearching(true);
    setSearchAttempted(true);

    try {
      const result = await searchCustomerMutation.mutateAsync({ phone: phoneNumber, clientId });
      if (result.found) {
        setCustomerData({
          customerId: result.id,
          id: result.id,
          name: result.name,
          company: result.company,
          phone: result.phone,
          exists: true,
        });
        setShowNewCustomerForm(false);
      } else {
        setCustomerData(null);
        setShowNewCustomerForm(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao buscar cliente');
      setShowNewCustomerForm(true);
    } finally {
      setIsSearching(false);
    }
  };

  const handleCreateCustomer = async () => {
    if (!newCustomerName.trim() || !newCustomerCompany.trim()) {
      setError('Por favor, preencha todos os campos');
      return;
    }

    setError(null);
    setIsSearching(true);

    try {
      const result = await createCustomerMutation.mutateAsync({
        phone: phoneNumber,
        name: newCustomerName,
        company: newCustomerCompany,
        clientId,
      });
      setCustomerData(result);
      setShowNewCustomerForm(false);
      setSuccessMessage('Cliente criado com sucesso!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar cliente');
    } finally {
      setIsSearching(false);
    }
  };

  const handleStartConversation = async () => {
    if (!customerData) {
      setError('Selecione um cliente primeiro');
      return;
    }

    setError(null);
    setIsSearching(true);

    try {
      let conversationId = customerData.id || customerData.customerId;
      let ticketCreated = false;
      
      // Etapa 1: Criar chamado se solicitado
      if (openTicket === true) {
        if (!ticketTitle.trim()) {
          setError('Por favor, insira o título do chamado');
          setIsSearching(false);
          return;
        }

        try {
          const ticketResult = await createTicketMutation.mutateAsync({
            customerId: customerData.id || customerData.customerId,
            phone: customerData.phone,
            title: ticketTitle,
            company: customerData.company,
            customer: customerData.name,
            observation: ticketObservation,
            clientId,
          });
          ticketCreated = true;
          setSuccessMessage('Chamado criado com sucesso!');
          console.log('Chamado criado:', ticketResult);
        } catch (ticketError) {
          console.error('Erro ao criar chamado:', ticketError);
          setError('Erro ao criar chamado, mas continuando com a conversa...');
          // Continuar mesmo se falhar
        }
      }
      
      // Etapa 2: Criar conversa
      try {
        const conversationResult = await createConversationMutation.mutateAsync({
          customerId: customerData.id || customerData.customerId,
          customerName: customerData.name,
          phone: customerData.phone,
          company: customerData.company,
          clientId,
        });
        conversationId = conversationResult.conversationId || (conversationResult as any).id;
        setSuccessMessage(ticketCreated ? 'Chamado e conversa criados com sucesso!' : 'Conversa iniciada com sucesso!');
        console.log('Conversa criada:', conversationResult);
      } catch (convError) {
        console.error('Erro ao criar conversa:', convError);
        setError('Erro ao criar conversa');
        setIsSearching(false);
        return;
      }
      
      // Etapa 3: Redirecionar para conversas
      setTimeout(() => {
        // Armazenar informações no localStorage
        localStorage.setItem('MEGADESK_NEW_CONVERSATION_ID', conversationId);
        localStorage.setItem('MEGADESK_NEW_CONVERSATION_PHONE', customerData.phone);
        localStorage.setItem('MEGADESK_NEW_CONVERSATION_NAME', customerData.name);
        
        // Chamar callback para trocar a view ativa
        if (onNavigate) {
          console.log('Navegando para conversas...');
          onNavigate('conversations');
        } else {
          // Fallback: redirecionar via hash
          window.location.hash = `#/conversas?clientId=${conversationId}&phone=${customerData.phone}`;
        }
      }, 500);
      return;
    } catch (err) {
      console.error('Erro geral:', err);
      setError(err instanceof Error ? err.message : 'Erro ao processar solicitação');
    } finally {
      setIsSearching(false);
    }
  };

  const handleReset = () => {
    setPhoneNumber('');
    setCustomerData(null);
    setShowNewCustomerForm(false);
    setNewCustomerName('');
    setNewCustomerCompany('');
    setOpenTicket(null);
    setTicketTitle('');
    setTicketObservation('');
    setSuccessMessage(null);
    setError(null);
    setSearchAttempted(false);
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 overflow-hidden flex items-center justify-center">
      <div className="max-w-5xl mx-auto w-full px-4 md:px-8 max-h-screen overflow-y-auto">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-4 mb-3">
            <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-xl">
              <Phone className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold text-slate-900">Atendimento Ativo</h1>
              <p className="text-slate-500 text-sm font-medium mt-1">Gerenciamento inteligente de atendimentos</p>
            </div>
          </div>
        </div>

        {/* Success Message */}
        {successMessage && (
          <div className="mb-8 p-5 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-300 rounded-2xl flex items-center gap-4 shadow-md">
            <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-800 font-semibold">{successMessage}</p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-8 p-5 bg-gradient-to-r from-red-50 to-rose-50 border-2 border-red-300 rounded-2xl flex items-center gap-4 shadow-md">
            <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-800 font-semibold">{error}</p>
          </div>
        )}

        {/* LAYOUT FIXO - Sempre visível */}
        <div className="space-y-6">
          {/* Etapa 1: Buscar Cliente - SEMPRE VISÍVEL */}
          <div className="bg-white rounded-2xl shadow-lg p-12 border-2 border-slate-400 hover:shadow-xl transition-shadow duration-300">
            <div className="space-y-4">
              <div>
                <label className="block text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <Phone className="w-5 h-5 text-blue-600" />
                  Número do Cliente
                </label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    placeholder="Digite o número de telefone..."
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearchCustomer()}
                    disabled={!!customerData}
                    className="flex-1 px-5 py-4 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 placeholder-slate-400 disabled:bg-slate-100 disabled:text-slate-500 text-base"
                  />
                  <button
                    onClick={handleSearchCustomer}
                    disabled={isSearching || !!customerData}
                    className="px-8 py-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-xl hover:from-blue-600 hover:to-blue-700 disabled:from-slate-400 disabled:to-slate-400 transition-all duration-200 font-semibold flex items-center gap-2 group"
                  >
                    {isSearching ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Buscando...
                      </>
                    ) : (
                      <>
                        Buscar
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Novo Cliente Form - Visível quando não encontrado */}
              {showNewCustomerForm && searchAttempted && !customerData && (
                <div className="mt-6 p-6 bg-gradient-to-br from-blue-50 to-slate-50 rounded-xl border border-blue-200">
                  <div className="flex items-center gap-2 mb-4">
                    <Plus className="w-5 h-5 text-blue-600" />
                    <p className="text-sm font-semibold text-slate-900">Cliente não encontrado. Crie um novo:</p>
                  </div>
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Nome do cliente"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 placeholder-slate-400"
                    />
                    <input
                      type="text"
                      placeholder="Nome da empresa"
                      value={newCustomerCompany}
                      onChange={(e) => setNewCustomerCompany(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 placeholder-slate-400"
                    />
                    <button
                      onClick={handleCreateCustomer}
                      disabled={isSearching}
                      className="w-full px-4 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl hover:shadow-lg hover:from-green-600 hover:to-green-700 disabled:from-slate-400 disabled:to-slate-400 transition-all duration-200 font-semibold flex items-center justify-center gap-2"
                    >
                      {isSearching ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Criando...
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4" />
                          Criar Cliente
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Etapa 2: Dados do Cliente e Opção de Chamado - Visível quando cliente encontrado */}
          {customerData && (
            <>
              {/* Customer Info Card */}
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl shadow-lg p-12 text-white border-2 border-slate-400">
                <h3 className="text-2xl font-bold mb-8 flex items-center gap-3">
                  <User className="w-6 h-6" />
                  Dados do Cliente
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="bg-white/15 rounded-2xl p-6 backdrop-blur-md border-2 border-white/30">
                    <p className="text-xs text-blue-100 mb-3 font-semibold uppercase tracking-wide">Nome</p>
                    <p className="text-2xl font-bold">{customerData.name}</p>
                  </div>
                  <div className="bg-white/15 rounded-2xl p-6 backdrop-blur-md border-2 border-white/30">
                    <p className="text-xs text-blue-100 mb-3 font-semibold uppercase tracking-wide">Empresa</p>
                    <p className="text-2xl font-bold flex items-center gap-2">
                      <Building2 className="w-6 h-6" />
                      {customerData.company}
                    </p>
                  </div>
                  <div className="bg-white/15 rounded-2xl p-6 backdrop-blur-md border-2 border-white/30">
                    <p className="text-xs text-blue-100 mb-3 font-semibold uppercase tracking-wide">Telefone</p>
                    <p className="text-2xl font-bold flex items-center gap-2">
                      <Phone className="w-6 h-6" />
                      {customerData.phone}
                    </p>
                  </div>
                  <div className="bg-white/15 rounded-2xl p-6 backdrop-blur-md border-2 border-white/30">
                    <p className="text-xs text-blue-100 mb-3 font-semibold uppercase tracking-wide">Status</p>
                    <p className="text-2xl font-bold flex items-center gap-2">
                      <CheckCircle className="w-6 h-6" />
                      {customerData.exists ? 'Existente' : 'Novo'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Ticket Option Card */}
              <div className="bg-white rounded-2xl shadow-lg p-12 border-2 border-slate-400">
                <h3 className="text-2xl font-bold text-slate-900 mb-8">Deseja abrir um chamado?</h3>
                <div className="flex gap-4 mb-8">
                  <button
                    onClick={() => setOpenTicket(false)}
                    className={cn(
                      'flex-1 px-6 py-4 rounded-xl font-bold transition-all duration-200 transform hover:scale-105 text-base',
                      openTicket === false
                        ? 'bg-gradient-to-r from-slate-700 to-slate-800 text-white shadow-lg'
                        : 'bg-slate-100 border-2 border-slate-300 text-slate-700 hover:border-slate-400'
                    )}
                  >
                    Não
                  </button>
                  <button
                    onClick={() => setOpenTicket(true)}
                    className={cn(
                      'flex-1 px-6 py-4 rounded-xl font-bold transition-all duration-200 transform hover:scale-105 text-base',
                      openTicket === true
                        ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg'
                        : 'bg-slate-100 border-2 border-slate-300 text-slate-700 hover:border-slate-400'
                    )}
                  >
                    Sim
                  </button>
                </div>

                {/* Ticket Form */}
                {openTicket === true && (
                  <div className="space-y-4 p-6 bg-gradient-to-br from-blue-50 to-slate-50 rounded-xl border-2 border-blue-200">
                    <input
                      type="text"
                      placeholder="Título do chamado"
                      value={ticketTitle}
                      onChange={(e) => setTicketTitle(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 placeholder-slate-400"
                    />
                    <textarea
                      placeholder="Observações (opcional)"
                      value={ticketObservation}
                      onChange={(e) => setTicketObservation(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 placeholder-slate-400 min-h-[100px] resize-none"
                    />
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4 pt-4">
                <button
                  onClick={handleReset}
                  className="flex-1 px-8 py-4 bg-slate-100 text-slate-900 rounded-xl hover:bg-slate-200 transition-all duration-200 font-bold border-2 border-slate-300 hover:shadow-md text-base"
                >
                  Voltar
                </button>
                <button
                  onClick={handleStartConversation}
                  disabled={isSearching}
                  className="flex-1 px-8 py-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-xl hover:from-blue-600 hover:to-blue-700 disabled:from-slate-400 disabled:to-slate-400 transition-all duration-200 font-bold flex items-center justify-center gap-2 text-base"
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processando...
                    </>
                  ) : (
                    <>
                      <ArrowRight className="w-4 h-4" />
                      Abrir Conversa
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
