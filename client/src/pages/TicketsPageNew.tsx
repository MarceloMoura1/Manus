/**
 * TicketsPage - Integrado com Backend tRPC
 * Tabela tipo Excel com modal de timeline
 */

import React from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/hooks/useAuth';
import {
  AlertCircle,
  Clock,
  Edit2,
  MessageSquare,
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

export function TicketsPageNew() {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = React.useState('');
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

  // Filtrar por busca
  const filteredChamados = chamados.filter(c => {
    const searchLower = searchTerm.toLowerCase();
    return (
      c.customerName.toLowerCase().includes(searchLower) ||
      c.company.toLowerCase().includes(searchLower) ||
      `#${String(c.number).padStart(4, '0')}`.includes(searchTerm) ||
      c.title.toLowerCase().includes(searchLower)
    );
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

      {/* Filtro de Pesquisa */}
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
