import { useState, useMemo } from 'react';
import { Phone, User, Building2, CheckCircle, AlertCircle, Loader2, ArrowRight, Plus, Search } from 'lucide-react';
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
          phone: result.phone,
          company: result.company,
          exists: true,
        });
        setSearchAttempted(false);
      } else {
        setCustomerData(null);
        setShowNewCustomerForm(true);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao buscar cliente');
      setCustomerData(null);
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
    setSuccessMessage(null);

    try {
      const result = await createCustomerMutation.mutateAsync({
        name: newCustomerName,
        phone: phoneNumber,
        company: newCustomerCompany,
        clientId,
      });

      setCustomerData({
        customerId: result.id,
        id: result.id,
        name: result.name,
        phone: result.phone,
        company: result.company,
        exists: false,
      });

      setShowNewCustomerForm(false);
      setNewCustomerName('');
      setNewCustomerCompany('');
      setSuccessMessage('Cliente criado com sucesso!');
    } catch (err: any) {
      setError(err.message || 'Erro ao criar cliente');
    }
  };

  const handleStartConversation = async () => {
    if (!customerData) return;

    setError(null);
    setSuccessMessage(null);

    try {
      if (openTicket === true) {
        if (!ticketTitle.trim()) {
          setError('Por favor, insira um título para o chamado');
          return;
        }

        const ticketResult = await createTicketMutation.mutateAsync({
          customerId: customerData.customerId,
          phone: customerData.phone,
          title: ticketTitle,
          company: customerData.company,
          customer: customerData.name,
          clientId,
          observation: ticketObservation,
        });

        const conversationResult = await createConversationMutation.mutateAsync({
          customerId: customerData.customerId,
          customerName: customerData.name,
          phone: customerData.phone,
          company: customerData.company,
          clientId,
        });

        setSuccessMessage('Conversa iniciada com sucesso!');
        setTimeout(() => {
          onNavigate?.({ route: 'conversations', conversationId: conversationResult.conversationId });
        }, 1500);
      } else {
        const conversationResult = await createConversationMutation.mutateAsync({
          customerId: customerData.customerId,
          customerName: customerData.name,
          phone: customerData.phone,
          company: customerData.company,
          clientId,
        });

        setSuccessMessage('Conversa iniciada com sucesso!');
        setTimeout(() => {
          onNavigate?.({ route: 'conversations', conversationId: conversationResult.conversationId });
        }, 1500);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao iniciar conversa');
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
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-hidden flex items-center justify-center">
      <div className="max-w-6xl mx-auto w-full px-6 md:px-12 max-h-screen overflow-y-auto py-8">
        
        {/* Header Premium */}
        <div className="mb-16">
          <div className="flex items-center gap-6 mb-4">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-3xl blur-xl opacity-50"></div>
              <div className="relative w-16 h-16 bg-gradient-to-br from-blue-500 via-blue-600 to-cyan-600 rounded-3xl flex items-center justify-center shadow-2xl">
                <Phone className="w-8 h-8 text-white" />
              </div>
            </div>
            <div>
              <h1 className="text-5xl font-black text-white tracking-tight">Atendimento Ativo</h1>
              <p className="text-slate-400 text-lg font-medium mt-2">Gerenciamento inteligente de atendimentos em tempo real</p>
            </div>
          </div>
          <div className="h-1 w-32 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full"></div>
        </div>

        {/* Messages */}
        {successMessage && (
          <div className="mb-8 p-6 bg-gradient-to-r from-emerald-500/10 to-green-500/10 border border-emerald-500/30 rounded-2xl flex items-center gap-4 shadow-lg backdrop-blur-sm">
            <CheckCircle className="w-7 h-7 text-emerald-400 flex-shrink-0" />
            <p className="text-base text-emerald-300 font-semibold">{successMessage}</p>
          </div>
        )}

        {error && (
          <div className="mb-8 p-6 bg-gradient-to-r from-red-500/10 to-rose-500/10 border border-red-500/30 rounded-2xl flex items-center gap-4 shadow-lg backdrop-blur-sm">
            <AlertCircle className="w-7 h-7 text-red-400 flex-shrink-0" />
            <p className="text-base text-red-300 font-semibold">{error}</p>
          </div>
        )}

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column - Search */}
          <div className="lg:col-span-1">
            <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl rounded-3xl border border-slate-700/50 p-8 shadow-2xl hover:border-blue-500/30 transition-all duration-300">
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <Search className="w-6 h-6 text-blue-400" />
                Buscar Cliente
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Número de Telefone</label>
                  <input
                    type="text"
                    placeholder="+55 (11) 99999-9999"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearchCustomer()}
                    disabled={!!customerData}
                    className="w-full px-6 py-4 rounded-xl border-2 border-slate-600/50 bg-slate-800/50 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 placeholder-slate-500 disabled:bg-slate-700/50 disabled:text-slate-400 text-base font-medium"
                  />
                </div>

                <button
                  onClick={handleSearchCustomer}
                  disabled={isSearching || !!customerData}
                  className="w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-xl hover:shadow-2xl hover:from-blue-700 hover:to-cyan-700 disabled:from-slate-600 disabled:to-slate-700 transition-all duration-300 font-bold flex items-center justify-center gap-3 text-base group"
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Buscando...
                    </>
                  ) : (
                    <>
                      <Search className="w-5 h-5 group-hover:scale-110 transition-transform" />
                      Buscar
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Right Column - Customer Data & Actions */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* Customer Data Card */}
            {customerData && (
              <div className="bg-gradient-to-br from-blue-600/20 via-cyan-600/20 to-slate-900/50 backdrop-blur-xl rounded-3xl border border-blue-500/30 p-8 shadow-2xl">
                <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                  <User className="w-6 h-6 text-cyan-400" />
                  Dados do Cliente
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-slate-800/50 rounded-2xl p-6 border border-slate-700/50">
                    <p className="text-xs text-slate-400 mb-3 font-bold uppercase tracking-wider">Nome</p>
                    <p className="text-2xl font-bold text-white">{customerData.name}</p>
                  </div>
                  
                  <div className="bg-slate-800/50 rounded-2xl p-6 border border-slate-700/50">
                    <p className="text-xs text-slate-400 mb-3 font-bold uppercase tracking-wider">Empresa</p>
                    <p className="text-2xl font-bold text-white flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-cyan-400" />
                      {customerData.company}
                    </p>
                  </div>
                  
                  <div className="bg-slate-800/50 rounded-2xl p-6 border border-slate-700/50">
                    <p className="text-xs text-slate-400 mb-3 font-bold uppercase tracking-wider">Telefone</p>
                    <p className="text-2xl font-bold text-white flex items-center gap-2">
                      <Phone className="w-5 h-5 text-cyan-400" />
                      {customerData.phone}
                    </p>
                  </div>
                  
                  <div className="bg-slate-800/50 rounded-2xl p-6 border border-slate-700/50">
                    <p className="text-xs text-slate-400 mb-3 font-bold uppercase tracking-wider">Status</p>
                    <p className="text-2xl font-bold text-white flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-emerald-400" />
                      {customerData.exists ? 'Existente' : 'Novo'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Ticket Option Card */}
            {customerData && (
              <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl rounded-3xl border border-slate-700/50 p-8 shadow-2xl">
                <h3 className="text-2xl font-bold text-white mb-6">Deseja abrir um chamado?</h3>
                
                <div className="flex gap-4 mb-8">
                  <button
                    onClick={() => setOpenTicket(false)}
                    className={cn(
                      'flex-1 px-6 py-4 rounded-xl font-bold transition-all duration-300 transform hover:scale-105 text-base',
                      openTicket === false
                        ? 'bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg'
                        : 'bg-slate-700/50 border-2 border-slate-600 text-slate-200 hover:border-slate-500'
                    )}
                  >
                    Não
                  </button>
                  <button
                    onClick={() => setOpenTicket(true)}
                    className={cn(
                      'flex-1 px-6 py-4 rounded-xl font-bold transition-all duration-300 transform hover:scale-105 text-base',
                      openTicket === true
                        ? 'bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-lg'
                        : 'bg-slate-700/50 border-2 border-slate-600 text-slate-200 hover:border-slate-500'
                    )}
                  >
                    Sim
                  </button>
                </div>

                {openTicket === true && (
                  <div className="space-y-4 p-6 bg-slate-800/50 rounded-2xl border border-slate-700/50">
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Título do Chamado</label>
                      <input
                        type="text"
                        placeholder="Descreva o problema..."
                        value={ticketTitle}
                        onChange={(e) => setTicketTitle(e.target.value)}
                        className="w-full px-4 py-3 rounded-lg border border-slate-600/50 bg-slate-700/50 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-slate-500 text-base"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Observação</label>
                      <textarea
                        placeholder="Detalhes adicionais..."
                        value={ticketObservation}
                        onChange={(e) => setTicketObservation(e.target.value)}
                        className="w-full px-4 py-3 rounded-lg border border-slate-600/50 bg-slate-700/50 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-slate-500 text-base resize-none"
                        rows={3}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            {customerData && (
              <div className="flex gap-4 pt-4">
                <button
                  onClick={handleReset}
                  className="flex-1 px-8 py-4 bg-slate-700/50 text-slate-200 rounded-xl hover:bg-slate-600/50 transition-all duration-300 font-bold border-2 border-slate-600 hover:shadow-lg text-base"
                >
                  Voltar
                </button>
                <button
                  onClick={handleStartConversation}
                  disabled={isSearching}
                  className="flex-1 px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl hover:shadow-2xl hover:from-cyan-600 hover:to-blue-700 disabled:from-slate-600 disabled:to-slate-700 transition-all duration-300 font-bold flex items-center justify-center gap-3 text-base group"
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Processando...
                    </>
                  ) : (
                    <>
                      <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                      Abrir Conversa
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
