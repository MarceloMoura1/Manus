import React, { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { useLocation } from 'wouter';

export function ActiveAttendancePage() {
  const [, setLocation] = useLocation();
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

  // tRPC mutations
  const searchCustomerMutation = trpc.megadesk.searchCustomer.useMutation();
  const createCustomerMutation = trpc.megadesk.createCustomer.useMutation();
  const createTicketMutation = trpc.megadesk.createTicket.useMutation();

  const handleSearchCustomer = async () => {
    if (!phoneNumber.trim()) {
      setError('Por favor, insira um número de telefone');
      return;
    }

    setError(null);
    setIsSearching(true);
    setSearchAttempted(true);

    try {
      const result = await searchCustomerMutation.mutateAsync({ phone: phoneNumber });
      if (result.found) {
        setCustomerData({
          id: result.id,
          phone: phoneNumber,
          name: result.name,
          company: result.company,
          exists: true,
        });
        setShowNewCustomerForm(false);
      } else {
        setCustomerData(null);
        setShowNewCustomerForm(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao buscar cliente');
      setCustomerData(null);
      setShowNewCustomerForm(false);
    } finally {
      setIsSearching(false);
    }
  };

  const handleCreateCustomer = async () => {
    if (!newCustomerName.trim() || !newCustomerCompany.trim()) {
      setError('Por favor, preencha nome e empresa');
      return;
    }

    setError(null);
    setIsSearching(true);

    try {
      const result = await createCustomerMutation.mutateAsync({
        phone: phoneNumber,
        name: newCustomerName,
        company: newCustomerCompany,
      });
      setCustomerData({
        id: result.id,
        phone: phoneNumber,
        name: newCustomerName,
        company: newCustomerCompany,
        exists: false,
      });
      setShowNewCustomerForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar cliente');
    } finally {
      setIsSearching(false);
    }
  };

  const handleStartConversation = async () => {
    if (!customerData) return;

    setError(null);
    setIsSearching(true);

    try {
      if (openTicket === true) {
        if (!ticketTitle.trim()) {
          setError('Por favor, insira o título do chamado');
          setIsSearching(false);
          return;
        }
        await createTicketMutation.mutateAsync({
          customerId: customerData.id,
          phone: customerData.phone,
          title: ticketTitle,
          observation: ticketObservation,
          company: customerData.company,
          customer: customerData.name,
        });
      }
      // Redirecionar para a página de Conversas após sucesso
      setLocation('/conversas');
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar solicitação');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-6">Atendimento Ativo</h2>

        {/* Mensagem de Erro */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Etapa 1: Buscar Cliente */}
        {!customerData && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Número do Cliente
              </label>
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="Digite o número de telefone..."
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearchCustomer()}
                  className="flex-1 px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleSearchCustomer}
                  disabled={isSearching}
                  className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-slate-400 transition-colors font-medium"
                >
                  {isSearching ? 'Buscando...' : 'Buscar'}
                </button>
              </div>
            </div>

            {/* Formulário de Novo Cliente */}
            {showNewCustomerForm && searchAttempted && (
              <div className="mt-6 p-6 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-sm text-slate-600 mb-4">Cliente não encontrado. Crie um novo:</p>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Nome do cliente"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    placeholder="Nome da empresa"
                    value={newCustomerCompany}
                    onChange={(e) => setNewCustomerCompany(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleCreateCustomer}
                    disabled={isSearching}
                    className="w-full px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-slate-400 transition-colors font-medium"
                  >
                    {isSearching ? 'Criando...' : 'Criar Cliente'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Etapa 2: Dados do Cliente e Opção de Chamado */}
        {customerData && (
          <div className="space-y-6">
            {/* Informações do Cliente */}
            <div className="p-6 bg-blue-50 rounded-lg border border-blue-200">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Dados do Cliente</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-slate-600">Nome</p>
                  <p className="text-lg font-medium text-slate-900">{customerData.name}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Empresa</p>
                  <p className="text-lg font-medium text-slate-900">{customerData.company}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Telefone</p>
                  <p className="text-lg font-medium text-slate-900">{customerData.phone}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Status</p>
                  <p className="text-lg font-medium text-green-600">
                    {customerData.exists ? 'Existente' : 'Novo'}
                  </p>
                </div>
              </div>
            </div>

            {/* Opção de Abrir Chamado */}
            <div className="p-6 bg-slate-50 rounded-lg border border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Abrir Chamado?</h3>
              <div className="flex gap-3 mb-6">
                <button
                  onClick={() => setOpenTicket(false)}
                  className={cn(
                    'flex-1 px-4 py-2 rounded-lg font-medium transition-colors',
                    openTicket === false
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  )}
                >
                  Não
                </button>
                <button
                  onClick={() => setOpenTicket(true)}
                  className={cn(
                    'flex-1 px-4 py-2 rounded-lg font-medium transition-colors',
                    openTicket === true
                      ? 'bg-blue-500 text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  )}
                >
                  Sim
                </button>
              </div>

              {/* Formulário de Chamado */}
              {openTicket === true && (
                <div className="space-y-3 p-4 bg-white rounded-lg border border-blue-200">
                  <input
                    type="text"
                    placeholder="Título do chamado"
                    value={ticketTitle}
                    onChange={(e) => setTicketTitle(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <textarea
                    placeholder="Observações (opcional)"
                    value={ticketObservation}
                    onChange={(e) => setTicketObservation(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px]"
                  />
                </div>
              )}
            </div>

            {/* Botão de Ação */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setCustomerData(null);
                  setPhoneNumber('');
                  setNewCustomerName('');
                  setNewCustomerCompany('');
                  setOpenTicket(null);
                  setTicketTitle('');
                  setTicketObservation('');
                  setSearchAttempted(false);
                  setError(null);
                }}
                className="flex-1 px-6 py-3 bg-slate-200 text-slate-900 rounded-lg hover:bg-slate-300 transition-colors font-medium"
              >
                Voltar
              </button>
              <button
                onClick={handleStartConversation}
                disabled={isSearching}
                className="flex-1 px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-slate-400 transition-colors font-medium flex items-center justify-center gap-2"
              >
                <MessageCircle className="w-5 h-5" />
                {isSearching ? 'Processando...' : 'Abrir Conversa'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
