import React, { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ActiveAttendancePage() {
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

  const handleSearchCustomer = async () => {
    if (!phoneNumber.trim()) {
      alert('Por favor, insira um número de telefone');
      return;
    }

    setIsSearching(true);
    setSearchAttempted(true);

    // Simular busca no banco de dados
    setTimeout(() => {
      // Exemplo: se o número for "11999999999", retorna um cliente existente
      if (phoneNumber === '11999999999') {
        setCustomerData({
          id: '1',
          phone: phoneNumber,
          name: 'João Silva',
          company: 'Tech Solutions',
          exists: true,
        });
        setShowNewCustomerForm(false);
      } else {
        setCustomerData(null);
        setShowNewCustomerForm(true);
      }
      setIsSearching(false);
    }, 500);
  };

  const handleCreateCustomer = () => {
    if (!newCustomerName.trim() || !newCustomerCompany.trim()) {
      alert('Por favor, preencha nome e empresa');
      return;
    }

    setCustomerData({
      id: Math.random().toString(),
      phone: phoneNumber,
      name: newCustomerName,
      company: newCustomerCompany,
      exists: false,
    });
    setShowNewCustomerForm(false);
  };

  const handleStartConversation = () => {
    if (!customerData) return;

    if (openTicket === true) {
      if (!ticketTitle.trim()) {
        alert('Por favor, insira o título do chamado');
        return;
      }
      // Aqui você salvaria o chamado no banco de dados
      console.log('Criando chamado:', {
        customer: customerData,
        title: ticketTitle,
        observation: ticketObservation,
      });
    }

    // Redirecionar para a página de Conversas
    console.log('Abrindo conversa com:', customerData);
    // Você pode usar o router aqui para navegar
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-6">Atendimento Ativo</h2>

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
                    className="w-full px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium"
                  >
                    Criar Cliente
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
                }}
                className="flex-1 px-6 py-3 bg-slate-200 text-slate-900 rounded-lg hover:bg-slate-300 transition-colors font-medium"
              >
                Voltar
              </button>
              <button
                onClick={handleStartConversation}
                className="flex-1 px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium flex items-center justify-center gap-2"
              >
                <MessageCircle className="w-5 h-5" />
                Abrir Conversa
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
