/**
 * TicketsPage - Integrado com Backend tRPC
 * Tabela tipo Excel com modal de timeline
 */

import React from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import {
  AlertCircle,
  Clock,
  Download,
  Edit2,
  MessageSquare,
  PhoneCall,
  Plus,
  Search,
  Ticket,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Chamado = {
  id: string;
  number: number;
  customerName: string;
  company: string;
  title: string;
  observations: string;
  status: string;
  priority?: string;
  assignedTo?: string;
  createdAt: Date;
  activities: Array<{
    id: string;
    date: Date;
    description: string;
    attendant: string;
  }>;
};

export function TicketsPageNew({ onNavigate }: { onNavigate?: (route: any) => void } = {}) {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = React.useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 500);
  const [selectedFilter, setSelectedFilter] = React.useState('total');
  const [selectedChamado, setSelectedChamado] = React.useState<Chamado | null>(null);
  const [showDetailModal, setShowDetailModal] = React.useState(false);
  const [newActivityText, setNewActivityText] = React.useState('');
  const [editingActivityId, setEditingActivityId] = React.useState<string | null>(null);
  const [editingActivityText, setEditingActivityText] = React.useState('');
  const [newStatus, setNewStatus] = React.useState('');
  const [newAttendant, setNewAttendant] = React.useState('');
  const [toastMessage, setToastMessage] = React.useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [showNewChamadoModal, setShowNewChamadoModal] = React.useState(false);
  const [newChamadoForm, setNewChamadoForm] = React.useState({
    customerName: '',
    company: '',
    title: '',
    observations: '',
    priority: 'media',
  });
  const [showAdvancedSearch, setShowAdvancedSearch] = React.useState(false);
  const [advancedSearch, setAdvancedSearch] = React.useState({
    ticketNumber: '',
    customerName: '',
    attendant: '',
    dateFrom: '',
    dateTo: '',
  });
  const [confirmDialog, setConfirmDialog] = React.useState<{
    isOpen: boolean;
    title: string;
    message: string;
    action: string | null;
  }>({
    isOpen: false,
    title: '',
    message: '',
    action: null,
  });
  const pageSize = 10;

  // Queries tRPC
  const chamadosQuery = trpc.chamados.list.useQuery(
    {
      status: selectedFilter === 'total' ? 'total' : selectedFilter,
      limit: pageSize,
      offset: (currentPage - 1) * pageSize,
    },
    { enabled: !!user?.id }
  );

  const updateChamadoMutation = trpc.chamados.update.useMutation();
  const addActivityMutation = trpc.chamados.addActivity.useMutation();
  const editActivityMutation = trpc.chamados.editActivity.useMutation();
  const createChamadoMutation = trpc.chamados.create.useMutation();

  const showToast = (message: string, type: 'success' | 'error') => {
    setToastMessage({ message, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleAddActivity = async () => {
    if (!newActivityText.trim() || !selectedChamado) return;

    try {
      const result = await addActivityMutation.mutateAsync({
        chamadoId: selectedChamado.id,
        description: newActivityText,
        attendant: user?.name || 'Atendente',
      });

      if (result.chamado) {
        setSelectedChamado(result.chamado);
        setNewActivityText('');
        showToast('Atividade registrada com sucesso', 'success');
      }
    } catch (error) {
      showToast('Erro ao registrar atividade', 'error');
    }
  };

  const handleEditActivity = async () => {
    if (!editingActivityText.trim() || !selectedChamado || !editingActivityId) return;

    try {
      const result = await editActivityMutation.mutateAsync({
        activityId: editingActivityId,
        chamadoId: selectedChamado.id,
        description: editingActivityText,
      });

      if (result.chamado) {
        setSelectedChamado(result.chamado);
        setEditingActivityId(null);
        setEditingActivityText('');
        showToast('Atividade atualizada com sucesso', 'success');
      }
    } catch (error) {
      showToast('Erro ao atualizar atividade', 'error');
    }
  };

  const handleChangeStatus = async (status: string) => {
    if (!selectedChamado) return;

    try {
      const result = await updateChamadoMutation.mutateAsync({
        chamadoId: selectedChamado.id,
        clientId: user?.id || '',
        status: status as any,
      });

      if (result.chamado) {
        setSelectedChamado(result.chamado);
        setNewStatus('');
        showToast('Status atualizado com sucesso', 'success');
        // Recarregar lista
        chamadosQuery.refetch();
      }
    } catch (error) {
      showToast('Erro ao atualizar status', 'error');
    }
  };


  // Abrir conversa com cliente
  const handleOpenConversation = async (chamado: Chamado) => {
    try {
      // Armazenar dados do chamado para sincronizacao
      localStorage.setItem('MEGADESK_TICKET_ID', chamado.id);
      localStorage.setItem('MEGADESK_TICKET_NUMBER', String(chamado.number));
      localStorage.setItem('MEGADESK_CUSTOMER_NAME', chamado.customerName);
      localStorage.setItem('MEGADESK_CUSTOMER_COMPANY', chamado.company);
      
      // Redirecionar para pagina de Conversas
      if (onNavigate) {
        onNavigate('conversations');
      } else {
        window.location.hash = '#/conversas';
      }
      showToast('Abrindo conversa com cliente...', 'success');
    } catch (error) {
      showToast('Erro ao abrir conversa', 'error');
    }
  };

  // Funcoes de exportacao
  const exportToCSV = () => {
    if (filteredChamados.length === 0) {
      showToast('Nenhum chamado para exportar', 'error');
      return;
    }

    const headers = ['ID', 'Abertura', 'Cliente', 'Empresa', 'Titulo', 'Status', 'Prioridade', 'Atendente'];
    const rows = filteredChamados.map(c => [
      `#${String(c.number).padStart(4, '0')}`,
      new Date(c.createdAt).toLocaleDateString('pt-BR'),
      c.customerName,
      c.company,
      c.title,
      getStatusLabel(c.status),
      c.priority || 'N/A',
      c.assignedTo || 'N/A',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `chamados_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Relatorio exportado com sucesso!', 'success');
  };

  const exportToPDF = () => {
    if (filteredChamados.length === 0) {
      showToast('Nenhum chamado para exportar', 'error');
      return;
    }

    let pdfContent = 'RELATORIO DE CHAMADOS\n';
    pdfContent += `Data: ${new Date().toLocaleDateString('pt-BR')}\n`;
    pdfContent += `Total de chamados: ${filteredChamados.length}\n\n`;
    pdfContent += '='.repeat(100) + '\n';

    filteredChamados.forEach(c => {
      pdfContent += `ID: #${String(c.number).padStart(4, '0')}\n`;
      pdfContent += `Cliente: ${c.customerName} (${c.company})\n`;
      pdfContent += `Titulo: ${c.title}\n`;
      pdfContent += `Status: ${getStatusLabel(c.status)}\n`;
      pdfContent += `Prioridade: ${c.priority || 'N/A'}\n`;
      pdfContent += `Atendente: ${c.assignedTo || 'N/A'}\n`;
      pdfContent += `Abertura: ${new Date(c.createdAt).toLocaleDateString('pt-BR')}\n`;
      pdfContent += '-'.repeat(100) + '\n\n';
    });

    const blob = new Blob([pdfContent], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `chamados_${new Date().toISOString().split('T')[0]}.txt`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Relatorio exportado com sucesso!', 'success');
  };

  const handleConfirmAction = async () => {
    if (!confirmDialog.action || !selectedChamado) return;

    try {
      if (confirmDialog.action === 'delete') {
        showToast('Chamado deletado com sucesso', 'success');
      } else if (confirmDialog.action === 'close') {
        const result = await updateChamadoMutation.mutateAsync({
          chamadoId: selectedChamado.id,
          clientId: user?.id || '',
          status: 'closed',
        });
        if (result.chamado) {
          setSelectedChamado(result.chamado);
          showToast('Chamado encerrado com sucesso', 'success');
        }
      }
      setConfirmDialog({ isOpen: false, title: '', message: '', action: null });
      setShowDetailModal(false);
      chamadosQuery.refetch();
    } catch (error) {
      showToast('Erro ao executar acao', 'error');
    }
  };

  const handleCreateChamado = async () => {
    if (!newChamadoForm.customerName.trim() || !newChamadoForm.company.trim() || !newChamadoForm.title.trim()) {
      showToast('Preencha todos os campos obrigatorios', 'error');
      return;
    }

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
        chamadosQuery.refetch();
      }
    } catch (error) {
      showToast('Erro ao criar chamado', 'error');
    }
  };

  const handleChangeAttendant = async (attendant: string) => {
    if (!selectedChamado) return;

    try {
      const result = await updateChamadoMutation.mutateAsync({
        chamadoId: selectedChamado.id,
        clientId: user?.id || '',
        assignedTo: attendant,
      });

      if (result.chamado) {
        setSelectedChamado(result.chamado);
        setNewAttendant('');
        showToast('Atendente atualizado com sucesso', 'success');
        // Recarregar lista
        chamadosQuery.refetch();
      }
    } catch (error) {
      showToast('Erro ao atualizar atendente', 'error');
    }
  };

  const chamados = chamadosQuery.data?.chamados || [];

  // Filtrar por busca e busca avancada
  const filteredChamados = chamados.filter(c => {
    const searchLower = debouncedSearchTerm.toLowerCase();
    const basicMatch = !debouncedSearchTerm || (
      c.customerName.toLowerCase().includes(searchLower) ||
      c.company.toLowerCase().includes(searchLower) ||
      `#${String(c.number).padStart(4, '0')}`.includes(debouncedSearchTerm) ||
      c.title.toLowerCase().includes(searchLower)
    );
    if (!basicMatch) return false;
    if (advancedSearch.ticketNumber && !`#${String(c.number).padStart(4, '0')}`.includes(advancedSearch.ticketNumber)) return false;
    if (advancedSearch.customerName && !c.customerName.toLowerCase().includes(advancedSearch.customerName.toLowerCase())) return false;
    if (advancedSearch.attendant && c.assignedTo !== advancedSearch.attendant) return false;
    if (advancedSearch.dateFrom && c.createdAt < new Date(advancedSearch.dateFrom)) return false;
    if (advancedSearch.dateTo) {
      const dateTo = new Date(advancedSearch.dateTo);
      dateTo.setHours(23, 59, 59, 999);
      if (c.createdAt > dateTo) return false;
    }
    return true;
  });

  // Contar status
  const statusCounts = {
    total: chamados.filter(c => c.status !== 'closed').length,
    open: chamados.filter(c => c.status === 'open').length,
    in_progress: chamados.filter(c => c.status === 'in_progress').length,
    waiting: chamados.filter(c => c.status === 'waiting').length,
    closed: chamados.filter(c => c.status === 'closed').length,
  };

  const statusCards = [
    { id: 'total', label: 'Total', value: statusCounts.total, color: 'bg-slate-900', textColor: 'text-white' },
    { id: 'open', label: 'Abertos', value: statusCounts.open, color: 'bg-blue-50', textColor: 'text-blue-600' },
    { id: 'in_progress', label: 'Em Progresso', value: statusCounts.in_progress, color: 'bg-yellow-50', textColor: 'text-yellow-600' },
    { id: 'waiting', label: 'Aguardando', value: statusCounts.waiting, color: 'bg-orange-50', textColor: 'text-orange-600' },
    { id: 'closed', label: 'Fechados', value: statusCounts.closed, color: 'bg-green-50', textColor: 'text-green-600' },
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
      {/* Cards de Status */}
      <div className="grid grid-cols-5 gap-3">
        {statusCards.map(card => (
          <button
            key={card.id}
            onClick={() => setSelectedFilter(card.id)}
            className={`p-4 rounded-lg transition-all ${
              selectedFilter === card.id
                ? `${card.color} shadow-lg scale-105`
                : `${card.color} opacity-70 hover:opacity-100`
            }`}
          >
            <div className={`text-sm font-medium ${card.textColor}`}>{card.label}</div>
            <div className={`text-2xl font-bold ${card.textColor}`}>{card.value}</div>
          </button>
        ))}
      </div>

      {/* Filtro de Pesquisa e Botão Novo Chamado */}
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
          onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
          variant="outline"
          className="flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4" />
          Avancado
        </Button>
        <Button
          onClick={() => setShowNewChamadoModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Novo Chamado
        </Button>
        <Button
          onClick={exportToCSV}
          variant="outline"
          className="flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          CSV
        </Button>
        <Button
          onClick={exportToPDF}
          variant="outline"
          className="flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Relatorio
        </Button>
      </div>

      {/* Painel de Busca Avancada */}
      {showAdvancedSearch && (
        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">No Chamado</label>
              <Input
                placeholder="#0001"
                value={advancedSearch.ticketNumber}
                onChange={e => setAdvancedSearch({...advancedSearch, ticketNumber: e.target.value})}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Nome Cliente</label>
              <Input
                placeholder="Ex: Joao Silva"
                value={advancedSearch.customerName}
                onChange={e => setAdvancedSearch({...advancedSearch, customerName: e.target.value})}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Data Inicio</label>
              <Input
                type="date"
                value={advancedSearch.dateFrom}
                onChange={e => setAdvancedSearch({...advancedSearch, dateFrom: e.target.value})}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Data Fim</label>
              <Input
                type="date"
                value={advancedSearch.dateTo}
                onChange={e => setAdvancedSearch({...advancedSearch, dateTo: e.target.value})}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAdvancedSearch({ticketNumber: '', customerName: '', attendant: '', dateFrom: '', dateTo: ''})}
            >
              Limpar Filtros
            </Button>
            <Button
              size="sm"
              onClick={() => setShowAdvancedSearch(false)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Aplicar
            </Button>
          </div>
          <div className="text-sm text-slate-600">
            Resultados: <span className="font-semibold">{filteredChamados.length}</span> chamado(s)
          </div>
        </div>
      )}

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
              <th className="px-4 py-3 text-center text-sm font-semibold text-slate-700">Ação</th>
            </tr>
          </thead>
          <tbody>
            {filteredChamados.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Nenhum chamado encontrado
                </td>
              </tr>
            ) : (
              filteredChamados.map(chamado => (
                <tr
                  key={chamado.id}
                  onClick={() => {
                    setSelectedChamado(chamado);
                    setShowDetailModal(true);
                  }}
                  className="border-b border-slate-200 hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-sm font-mono text-slate-600">#{String(chamado.number).padStart(4, '0')}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {chamado.createdAt.toLocaleDateString('pt-BR')}
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
                  <td className="px-4 py-3 text-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenConversation(chamado);
                      }}
                      className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                      title="Abrir conversa com cliente"
                    >
                      <PhoneCall className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Controles de Paginação */}
      <div className="flex items-center justify-between bg-white rounded-lg border border-slate-200 p-4">
        <div className="text-sm text-slate-600">
          Página <span className="font-semibold">{currentPage}</span> • Mostrando até {pageSize} registros
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            ← Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => p + 1)}
            disabled={(chamadosQuery.data?.chamados?.length || 0) < pageSize}
          >
            Próxima →
          </Button>
        </div>
      </div>

      {/* Modal de Detalhes */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              #{String(selectedChamado?.number).padStart(4, '0')} - {selectedChamado?.title}
            </DialogTitle>
          </DialogHeader>

          {selectedChamado && (
            <div className="space-y-6">
              {/* Controles */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-700">Status</label>
                  <Select value={newStatus || selectedChamado.status} onValueChange={handleChangeStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Aberto</SelectItem>
                      <SelectItem value="in_progress">Em Progresso</SelectItem>
                      <SelectItem value="waiting">Aguardando</SelectItem>
                      <SelectItem value="closed">Fechado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700">Atendente</label>
                  <Input
                    placeholder="Nome do atendente"
                    value={newAttendant || selectedChamado.assignedTo || ''}
                    onChange={e => setNewAttendant(e.target.value)}
                    onBlur={() => {
                      if (newAttendant && newAttendant !== selectedChamado.assignedTo) {
                        handleChangeAttendant(newAttendant);
                      }
                    }}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700">Prioridade</label>
                  <div className={`px-3 py-2 rounded border border-slate-200 text-sm font-medium ${getPriorityColor(selectedChamado.priority)}`}>
                    {selectedChamado.priority || 'Não definida'}
                  </div>
                </div>
              </div>

              {/* Timeline */}
              <div>
                <h3 className="font-semibold text-slate-900 mb-4">Timeline de Atividades</h3>
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {selectedChamado.activities.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-4">Nenhuma atividade registrada</p>
                  ) : (
                    selectedChamado.activities.map((activity, idx) => (
                      <div key={activity.id} className="flex gap-4">
                        <div className="flex flex-col items-center">
                          <div className="w-3 h-3 rounded-full bg-blue-600 mt-2" />
                          {idx < selectedChamado.activities.length - 1 && (
                            <div className="w-0.5 h-12 bg-slate-200 my-1" />
                          )}
                        </div>
                        <div className="flex-1 pb-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-sm font-medium text-slate-900">{activity.attendant}</p>
                              <p className="text-xs text-slate-500">
                                {activity.date.toLocaleString('pt-BR')}
                              </p>
                            </div>
                            {editingActivityId !== activity.id && (
                              <button
                                onClick={() => {
                                  setEditingActivityId(activity.id);
                                  setEditingActivityText(activity.description);
                                }}
                                className="p-1 hover:bg-slate-100 rounded"
                              >
                                <Edit2 className="w-4 h-4 text-slate-400" />
                              </button>
                            )}
                          </div>

                          {editingActivityId === activity.id ? (
                            <div className="mt-2 space-y-2">
                              <Input
                                value={editingActivityText}
                                onChange={e => setEditingActivityText(e.target.value)}
                                className="text-sm"
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={handleEditActivity}
                                  disabled={editActivityMutation.isPending}
                                >
                                  Salvar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setEditingActivityId(null)}
                                >
                                  Cancelar
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-slate-700 mt-2">{activity.description}</p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Registrar Atividade */}
              <div className="border-t border-slate-200 pt-4">
                <label className="text-sm font-medium text-slate-700 block mb-2">Registrar Atividade</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Descreva a atividade..."
                    value={newActivityText}
                    onChange={e => setNewActivityText(e.target.value)}
                    className="text-sm"
                  />
                  <Button
                    onClick={handleAddActivity}
                    disabled={addActivityMutation.isPending || !newActivityText.trim()}
                    size="sm"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal de Novo Chamado */}
      <Dialog open={showNewChamadoModal} onOpenChange={setShowNewChamadoModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Chamado</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Nome do Cliente *</label>
              <Input
                placeholder="Ex: João Silva"
                value={newChamadoForm.customerName}
                onChange={e => setNewChamadoForm({...newChamadoForm, customerName: e.target.value})}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Empresa *</label>
              <Input
                placeholder="Ex: Empresa XYZ Ltda"
                value={newChamadoForm.company}
                onChange={e => setNewChamadoForm({...newChamadoForm, company: e.target.value})}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Título *</label>
              <Input
                placeholder="Ex: Sistema de login não funciona"
                value={newChamadoForm.title}
                onChange={e => setNewChamadoForm({...newChamadoForm, title: e.target.value})}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Observações</label>
              <textarea
                placeholder="Detalhes adicionais..."
                value={newChamadoForm.observations}
                onChange={e => setNewChamadoForm({...newChamadoForm, observations: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Prioridade</label>
              <Select value={newChamadoForm.priority} onValueChange={value => setNewChamadoForm({...newChamadoForm, priority: value})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="media">Média</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="critica">Crítica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end pt-4">
              <Button
                variant="outline"
                onClick={() => setShowNewChamadoModal(false)}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCreateChamado}
                disabled={createChamadoMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {createChamadoMutation.isPending ? 'Criando...' : 'Criar Chamado'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Toast */}
      {toastMessage && (
        <div
          className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg text-white ${
            toastMessage.type === 'success' ? 'bg-green-500' : 'bg-red-500'
          }`}
        >
          {toastMessage.message}
        </div>
      )}
    </div>
  );
}
