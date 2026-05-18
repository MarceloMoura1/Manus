import { useState, useMemo } from 'react';
import { Phone, User, Building2, CheckCircle, AlertCircle, Loader2, ArrowRight, Plus, X } from 'lucide-react';
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
          name: result.name,
          company: result.company,
          phone: result.phone,
          email: result.email || '',
          whatsapp: result.whatsapp || '',
          exists: result.exists,
          source: result.source,
          crmClientId: result.crmClientId,
          customerId: result.customerId,
        });
        setShowNewCustomerForm(false);
      } else {
        setShowNewCustomerForm(true);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao buscar cliente');
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

      setCustomerData({
        name: result.name,
        company: result.company,
        phone: result.phone,
        email: result.email || '',
        whatsapp: result.whatsapp || '',
        exists: false,
        source: result.source,
        crmClientId: result.crmClientId,
        customerId: result.customerId,
      });
      setShowNewCustomerForm(false);
    } catch (err: any) {
      setError(err.message || 'Erro ao criar cliente');
    } finally {
      setIsSearching(false);
    }
  };

  const handleStartConversation = async () => {
    if (!customerData) return;

    setError(null);
    setSuccessMessage(null);
    setIsSearching(true);

    try {
      const result = await createConversationMutation.mutateAsync({
        customerId: customerData.customerId,
        clientId,
      });

      setSuccessMessage(`Conversa iniciada com ${customerData.name}!`);
      setTimeout(() => {
        handleReset();
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Erro ao iniciar conversa');
    } finally {
      setIsSearching(false);
    }
  };

  const handleCreateTicket = async () => {
    if (!ticketTitle.trim()) {
      setError('Por favor, insira um título para o chamado');
      return;
    }

    setError(null);
    setSuccessMessage(null);
    setIsSearching(true);

    try {
      const result = await createTicketMutation.mutateAsync({
        customerId: customerData.customerId,
        title: ticketTitle,
        observation: ticketObservation,
        clientId,
      });

      setCreatedChamadoNumber(result.chamadoNumber);
      setCreatedChamadoId(result.id);
      setSuccessMessage(`Chamado #${result.chamadoNumber} criado com sucesso!`);
    } catch (err: any) {
      setError(err.message || 'Erro ao criar chamado');
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
    setSearchAttempted(false);
    setError(null);
    setSuccessMessage(null);
    setCreatedChamadoNumber(null);
    setCreatedChamadoId(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="bg-blue-600 rounded-full p-3">
              <Phone className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-4xl font-bold text-slate-900">Atendimento Ativo</h1>
          </div>
          <p className="text-slate-600">Inicie um atendimento com um cliente</p>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-700 font-medium">{error}</p>
          </div>
        )}
        {successMessage && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-700 font-medium">{successMessage}</p>
          </div>
        )}

        {/* LAYOUT RESPONSIVO */}
        <div className="flex gap-8 justify-center items-start">
          {/* ESQUERDA: Input de busca (animação para esquerda quando cliente encontrado) */}
          <div
            className={cn(
              "transition-all duration-500 ease-out",
              customerData ? "w-96 translate-x-0" : "w-full max-w-md"
            )}
          >
            <div className="bg-white rounded-2xl shadow-lg p-12 border-2 border-slate-400 hover:shadow-xl transition-shadow duration-300">
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-4">
                  <label className="block text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Phone className="w-4 h-4 text-blue-600" />
                    Número do Cliente
                  </label>
                  <div className="flex gap-3 w-full">
                    <input
                      type="text"
                      placeholder="Digite o número..."
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSearchCustomer()}
                      disabled={!!customerData}
                      className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 placeholder-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                    />
                    <button
                      onClick={handleSearchCustomer}
                      disabled={isSearching || !!customerData}
                      className="px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-lg hover:from-blue-600 hover:to-blue-700 disabled:from-slate-400 disabled:to-slate-400 transition-all duration-200 font-semibold flex items-center gap-2 group"
                    >
                      {isSearching ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Novo Cliente Form */}
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
          </div>

          {/* CENTRO: Dados do Cliente e Chamado (aparecem quando cliente encontrado) */}
          {customerData && (
            <div className="flex flex-col gap-6 w-96 animate-fadeSlideIn">
              {/* Customer Info Card */}
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl shadow-lg p-12 text-white border-2 border-slate-400">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <User className="w-5 h-5" />
                    Dados do Cliente
                  </h3>
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                    customerData.source === 'crm'
                      ? 'bg-yellow-400 text-yellow-900'
                      : 'bg-white/20 text-white'
                  }`}>
                    {customerData.source === 'crm' ? '📋 CRM' : '💬 Contato'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm border border-white/20">
                    <p className="text-xs text-blue-100 mb-2">Nome</p>
                    <p className="text-base font-bold truncate">{customerData.name}</p>
                  </div>
                  <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm border border-white/20">
                    <p className="text-xs text-blue-100 mb-2">Empresa</p>
                    <p className="text-base font-bold flex items-center gap-1 truncate">
                      <Building2 className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate">{customerData.company}</span>
                    </p>
                  </div>
                  <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm border border-white/20">
                    <p className="text-xs text-blue-100 mb-2">Telefone</p>
                    <p className="text-base font-bold flex items-center gap-1">
                      <Phone className="w-4 h-4 flex-shrink-0" />
                      {customerData.phone}
                    </p>
                  </div>
                  <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm border border-white/20">
                    <p className="text-xs text-blue-100 mb-2">Status</p>
                    <p className="text-base font-bold flex items-center gap-1">
                      <CheckCircle className="w-4 h-4 flex-shrink-0" />
                      {customerData.exists ? 'Existente' : 'Novo'}
                    </p>
                  </div>
                  {customerData.source === 'crm' && customerData.email && (
                    <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm border border-white/20 col-span-2">
                      <p className="text-xs text-blue-100 mb-2">E-mail</p>
                      <p className="text-base font-semibold truncate">{customerData.email}</p>
                    </div>
                  )}
                  {customerData.source === 'crm' && customerData.whatsapp && (
                    <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm border border-white/20 col-span-2">
                      <p className="text-xs text-blue-100 mb-2">WhatsApp</p>
                      <p className="text-base font-semibold">{customerData.whatsapp}</p>
                    </div>
                  )}
                </div>
                {customerData.source === 'crm' && customerData.crmClientId && onNavigate && (
                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={() => onNavigate({ route: 'clients', crmClientId: customerData.crmClientId })}
                      className="flex items-center gap-2 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-all duration-200 border border-white/30"
                    >
                      <ArrowRight className="w-3 h-3" />
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
                      'flex-1 px-4 py-3 rounded-lg text-base font-semibold transition-all duration-200 transform hover:scale-105',
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
                      'flex-1 px-4 py-3 rounded-lg text-base font-semibold transition-all duration-200 transform hover:scale-105',
                      openTicket === true
                        ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg'
                        : 'bg-slate-100 border-2 border-slate-200 text-slate-700 hover:border-slate-300'
                    )}
                  >
                    Sim
                  </button>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 justify-end pt-4 border-t border-slate-200">
                  <button
                    onClick={handleReset}
                    className="px-4 py-2 text-sm bg-slate-100 text-slate-900 rounded-lg hover:bg-slate-200 transition-all duration-200 font-semibold border border-slate-200 hover:shadow-md"
                  >
                    Voltar
                  </button>
                  <button
                    onClick={handleStartConversation}
                    disabled={isSearching}
                    className="px-4 py-2 text-sm bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:shadow-lg hover:from-blue-600 hover:to-blue-700 disabled:from-slate-400 disabled:to-slate-400 transition-all duration-200 font-semibold flex items-center justify-center gap-2"
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
              </div>
            </div>
          )}

          {/* DIREITA: Formulário de Chamado (aparece quando SIM é clicado) */}
          {customerData && openTicket === true && (
            <div className="w-96 animate-fadeSlideIn">
              <div className="bg-white rounded-2xl shadow-lg p-12 border-2 border-slate-400">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-slate-900">Criar Chamado</h3>
                  <button
                    onClick={() => setOpenTicket(false)}
                    className="p-2 hover:bg-slate-100 rounded-lg transition-all duration-200"
                  >
                    <X className="w-5 h-5 text-slate-600" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Título do Chamado</label>
                    <input
                      type="text"
                      placeholder="Ex: Problema com faturamento"
                      value={ticketTitle}
                      onChange={(e) => setTicketTitle(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 placeholder-slate-400"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Descrição (opcional)</label>
                    <textarea
                      placeholder="Descreva o problema em detalhes..."
                      value={ticketObservation}
                      onChange={(e) => setTicketObservation(e.target.value)}
                      rows={4}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 placeholder-slate-400 resize-none"
                    />
                  </div>

                  <button
                    onClick={handleCreateTicket}
                    disabled={isSearching}
                    className="w-full px-4 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl hover:shadow-lg hover:from-green-600 hover:to-green-700 disabled:from-slate-400 disabled:to-slate-400 transition-all duration-200 font-semibold flex items-center justify-center gap-2 mt-4"
                  >
                    {isSearching ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Criando...
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        Criar Chamado
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fadeSlideIn {
          animation: fadeSlideIn 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
