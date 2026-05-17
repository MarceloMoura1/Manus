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
  const [createdChamadoNumber, setCreatedChamadoNumber] = useState<number | null>(null);
  const [createdChamadoId, setCreatedChamadoId] = useState<string | null>(null);

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
          source: (result as any).source ?? 'contacts',
          email: (result as any).email ?? '',
          whatsapp: (result as any).whatsapp ?? '',
          crmClientId: (result as any).crmClientId ?? null,
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
          if (ticketResult.chamadoNumber) {
            setCreatedChamadoNumber(ticketResult.chamadoNumber);
            setCreatedChamadoId(ticketResult.ticketId);
          }
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
          fromCrm: customerData.source === 'crm',
        });
        conversationId = conversationResult.conversationId || (conversationResult as any).id;
        if (ticketCreated && createdChamadoNumber) {
          setSuccessMessage(`Chamado #${String(createdChamadoNumber).padStart(4, '0')} e conversa criados com sucesso!`);
        } else if (ticketCreated) {
          setSuccessMessage('Chamado e conversa criados com sucesso!');
        } else {
          setSuccessMessage('Conversa iniciada com sucesso!');
        }
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
    setCreatedChamadoNumber(null);
    setCreatedChamadoId(null);
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 overflow-hidden flex items-center justify-center">
      <div className="max-w-5xl mx-auto w-full px-4 md:px-8 max-h-screen overflow-y-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <Phone className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-slate-900">Atendimento Ativo</h1>
          </div>
          <p className="text-slate-600 ml-15">Inicie um atendimento com um cliente</p>
        </div>

        {/* Success Message */}
        {successMessage && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl">
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
              <p className="text-sm text-green-700 font-semibold">{successMessage}</p>
            </div>
            {createdChamadoNumber && (
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-green-200">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-green-600">Número do chamado:</span>
                  <span className="text-sm font-bold text-green-800 bg-green-100 px-2 py-0.5 rounded-lg">
                    #{String(createdChamadoNumber).padStart(4, '0')}
                  </span>
                </div>
                <button
                  onClick={() => onNavigate && onNavigate('tickets')}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition-all duration-200 hover:shadow-md"
                >
                  <ArrowRight className="w-4 h-4" />
                  Ver Chamado
                </button>
              </div>
            )}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-700 font-medium">{error}</p>
          </div>
        )}

        {/* LAYOUT FIXO - Sempre visível */}
        <div className="space-y-6">
          {/* Etapa 1: Buscar Cliente - SEMPRE VISÍVEL */}
          <div className="bg-white rounded-2xl shadow-lg p-12 border-2 border-slate-400 hover:shadow-xl transition-shadow duration-300">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
                  <Phone className="w-4 h-4 text-blue-600" />
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
                    className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 placeholder-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                  <button
                    onClick={handleSearchCustomer}
                    disabled={isSearching || !!customerData}
                    className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-lg hover:from-blue-600 hover:to-blue-700 disabled:from-slate-400 disabled:to-slate-400 transition-all duration-200 font-semibold flex items-center gap-2 group"
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
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <User className="w-5 h-5" />
                    Dados do Cliente
                  </h3>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                    customerData.source === 'crm'
                      ? 'bg-yellow-400 text-yellow-900'
                      : 'bg-white/20 text-white'
                  }`}>
                    {customerData.source === 'crm' ? '📋 CRM' : '💬 Contato'}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm border border-white/20">
                    <p className="text-sm text-blue-100 mb-1">Nome</p>
                    <p className="text-xl font-bold">{customerData.name}</p>
                  </div>
                  <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm border border-white/20">
                    <p className="text-sm text-blue-100 mb-1">Empresa</p>
                    <p className="text-xl font-bold flex items-center gap-2">
                      <Building2 className="w-5 h-5" />
                      {customerData.company}
                    </p>
                  </div>
                  <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm border border-white/20">
                    <p className="text-sm text-blue-100 mb-1">Telefone</p>
                    <p className="text-xl font-bold flex items-center gap-2">
                      <Phone className="w-5 h-5" />
                      {customerData.phone}
                    </p>
                  </div>
                  <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm border border-white/20">
                    <p className="text-sm text-blue-100 mb-1">Status</p>
                    <p className="text-xl font-bold flex items-center gap-2">
                      <CheckCircle className="w-5 h-5" />
                      {customerData.exists ? 'Existente' : 'Novo'}
                    </p>
                  </div>
                  {customerData.source === 'crm' && customerData.email && (
                    <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm border border-white/20">
                      <p className="text-sm text-blue-100 mb-1">E-mail</p>
                      <p className="text-base font-semibold truncate">{customerData.email}</p>
                    </div>
                  )}
                  {customerData.source === 'crm' && customerData.whatsapp && (
                    <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm border border-white/20">
                      <p className="text-sm text-blue-100 mb-1">WhatsApp</p>
                      <p className="text-base font-semibold">{customerData.whatsapp}</p>
                    </div>
                  )}
                </div>
                {customerData.source === 'crm' && customerData.crmClientId && onNavigate && (
                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={() => onNavigate('clients')}
                      className="flex items-center gap-2 bg-white/20 hover:bg-white/30 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all duration-200 border border-white/30"
                    >
                      <ArrowRight className="w-4 h-4" />
                      Ver no CRM
                    </button>
                  </div>
                )}
              </div>

              {/* Ticket Option Card */}
              <div className="bg-white rounded-2xl shadow-lg p-12 border-2 border-slate-400">
                <h3 className="text-lg font-semibold text-slate-900 mb-6">Deseja abrir um chamado?</h3>
                <div className="flex gap-3 mb-6">
                  <button
                    onClick={() => setOpenTicket(false)}
                    className={cn(
                      'flex-1 px-4 py-3 rounded-xl font-semibold transition-all duration-200 transform hover:scale-105',
                      openTicket === false
                        ? 'bg-gradient-to-r from-slate-700 to-slate-800 text-white shadow-lg'
                        : 'bg-slate-100 border-2 border-slate-200 text-slate-700 hover:border-slate-300'
                    )}
                  >
                    Não
                  </button>
                  <button
                    onClick={() => setOpenTicket(true)}
                    className={cn(
                      'flex-1 px-4 py-3 rounded-xl font-semibold transition-all duration-200 transform hover:scale-105',
                      openTicket === true
                        ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg'
                        : 'bg-slate-100 border-2 border-slate-200 text-slate-700 hover:border-slate-300'
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
              <div className="flex gap-3">
                <button
                  onClick={handleReset}
                  className="flex-1 px-6 py-3 bg-slate-100 text-slate-900 rounded-xl hover:bg-slate-200 transition-all duration-200 font-semibold border border-slate-200 hover:shadow-md"
                >
                  Voltar
                </button>
                <button
                  onClick={handleStartConversation}
                  disabled={isSearching}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-lg hover:from-blue-600 hover:to-blue-700 disabled:from-slate-400 disabled:to-slate-400 transition-all duration-200 font-semibold flex items-center justify-center gap-2"
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
