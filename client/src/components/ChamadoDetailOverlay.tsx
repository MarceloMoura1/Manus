import React, { useState } from "react";
import { X, ArrowLeft, Edit2, Plus, Upload, Phone, Clock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

export interface TicketActivity {
  id: string;
  description: string;
  attendant: string;
  date?: Date;
  createdAt?: Date;
}

export interface Ticket {
  id: string;
  number: number;
  customerName: string;
  company: string;
  title: string;
  observations: string;
  priority?: string;
  status: string;
  assignedTo?: string;
  createdAt: Date;
  activities: TicketActivity[];
}

interface ChamadoDetailOverlayProps {
  chamado: Ticket | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ChamadoDetailOverlay({
  chamado,
  isOpen,
  onClose,
}: ChamadoDetailOverlayProps) {
  const { user } = useAuth();
  const [newActivityText, setNewActivityText] = useState("");
  const [newStatus, setNewStatus] = useState<string>(
    chamado?.status || "open"
  );
  const [newAttendant, setNewAttendant] = useState(chamado?.assignedTo || "");
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeObservations, setCloseObservations] = useState("");
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const [editingActivityText, setEditingActivityText] = useState("");
  const [showEditActivityModal, setShowEditActivityModal] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  const addActivityMutation = trpc.chamados.addActivity.useMutation();
  const updateChamadoMutation = trpc.chamados.update.useMutation();
  const editActivityMutation = trpc.chamados.editActivity.useMutation();

  if (!isOpen || !chamado) return null;

  const handleAddActivity = async () => {
    if (!newActivityText.trim()) return;

    try {
      await addActivityMutation.mutateAsync({
        chamadoId: chamado.id,
        description: newActivityText,
        attendant: user?.user?.name || "Atendente",
      });

      setNewActivityText("");
      // Refetch would happen here
    } catch (error) {
      console.error("Erro ao registrar atividade:", error);
    }
  };

  const handleUpdateStatus = async () => {
    try {
      await updateChamadoMutation.mutateAsync({
        chamadoId: chamado.id,
        status: newStatus as any,
      });
    } catch (error) {
      console.error("Erro ao atualizar status:", error);
    }
  };

  const handleUpdateAttendant = async () => {
    try {
      await updateChamadoMutation.mutateAsync({
        chamadoId: chamado.id,
        assignedTo: newAttendant,
      });
    } catch (error) {
      console.error("Erro ao atualizar atendente:", error);
    }
  };

  const handleCloseChamado = async () => {
    if (!closeObservations.trim()) return;

    try {
      await addActivityMutation.mutateAsync({
        chamadoId: chamado.id,
        description: `Chamado encerrado. Observações: ${closeObservations}`,
        attendant: user?.user?.name || "Atendente",
      });

      await updateChamadoMutation.mutateAsync({
        chamadoId: chamado.id,
        status: "closed",
      });

      setShowCloseModal(false);
      setCloseObservations("");
      onClose();
    } catch (error) {
      console.error("Erro ao encerrar chamado:", error);
    }
  };

  const handleEditActivity = async () => {
    if (!editingActivityText.trim() || !editingActivityId) return;

    try {
      await editActivityMutation.mutateAsync({
        activityId: editingActivityId,
        chamadoId: chamado.id,
        description: editingActivityText,
      });

      setEditingActivityId(null);
      setEditingActivityText("");
      setShowEditActivityModal(false);
    } catch (error) {
      console.error("Erro ao editar atividade:", error);
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      open: "Aberto",
      in_progress: "Em Progresso",
      waiting: "Aguardando",
      closed: "Fechado",
    };
    return labels[status] || status;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      open: "bg-blue-100 text-blue-800",
      in_progress: "bg-yellow-100 text-yellow-800",
      waiting: "bg-purple-100 text-purple-800",
      closed: "bg-green-100 text-green-800",
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">
              #{String(chamado.number).padStart(4, "0")} - {chamado.title}
            </h2>
            <p className="text-blue-100 mt-1">
              {chamado.customerName} • {chamado.company}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-blue-800 p-2 rounded-lg transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Action Bar - Horizontal com separadores */}
        <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between gap-6 flex-wrap">
          {/* Registrar Atividade */}
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Input
              placeholder="Registrar atividade..."
              value={newActivityText}
              onChange={(e) => setNewActivityText(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={handleAddActivity}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {/* Separador */}
          <div className="h-8 w-px bg-gray-300"></div>

          {/* Status */}
          <div className="flex items-center gap-2">
            <Select value={newStatus} onValueChange={(value: string) => setNewStatus(value)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Aberto</SelectItem>
                <SelectItem value="in_progress">Em Progresso</SelectItem>
                <SelectItem value="waiting">Aguardando</SelectItem>
                <SelectItem value="closed">Fechado</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={handleUpdateStatus}
              size="sm"
              variant="outline"
              className="text-xs"
            >
              Atualizar
            </Button>
          </div>

          {/* Separador */}
          <div className="h-8 w-px bg-gray-300"></div>

          {/* Atendente */}
          <div className="flex items-center gap-2">
            <Input
              placeholder="Atendente"
              value={newAttendant}
              onChange={(e) => setNewAttendant(e.target.value)}
              className="w-[150px]"
            />
            <Button
              onClick={handleUpdateAttendant}
              size="sm"
              variant="outline"
              className="text-xs"
            >
              Atualizar
            </Button>
          </div>

          {/* Separador */}
          <div className="h-8 w-px bg-gray-300"></div>

          {/* Anexar Arquivos */}
          <div className="flex items-center gap-2">
            <label className="cursor-pointer">
              <input
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={(e) => {
                  if (e.target.files) {
                    setAttachedFiles(Array.from(e.target.files));
                  }
                }}
                className="hidden"
              />
              <button
                className="px-3 py-2 text-xs border border-slate-300 rounded-md hover:bg-slate-100 transition cursor-pointer flex items-center gap-1"
              >
                <Upload className="w-4 h-4" />
                Anexar
              </button>
            </label>
          </div>

          {/* Separador */}
          <div className="h-8 w-px bg-gray-300"></div>

          {/* Encerrar Chamado */}
          <Button
            onClick={() => setShowCloseModal(true)}
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white text-xs"
          >
            Encerrar
          </Button>
        </div>

        {/* Content - Timeline */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Timeline */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Histórico de Atividades</h3>

              <div className="space-y-4">
                {chamado.activities && chamado.activities.length > 0 ? (
                  chamado.activities.map((activity, index) => (
                    <div
                      key={activity.id}
                      className="flex gap-4 relative"
                    >
                      {/* Timeline line */}
                      {index < chamado.activities.length - 1 && (
                        <div className="absolute left-6 top-12 bottom-0 w-0.5 bg-gradient-to-b from-blue-400 to-blue-200"></div>
                      )}

                      {/* Timeline dot */}
                      <div className="flex-shrink-0 mt-1">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white shadow-lg">
                          <Clock className="w-6 h-6" />
                        </div>
                      </div>

                      {/* Activity content */}
                      <div className="flex-1 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200 shadow-md">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-semibold text-slate-900">{activity.attendant}</p>
                            <p className="text-sm text-slate-600">
                              {new Date(activity.createdAt || activity.date || new Date()).toLocaleString("pt-BR")}
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              setEditingActivityId(activity.id);
                              setEditingActivityText(activity.description);
                              setShowEditActivityModal(true);
                            }}
                            className="text-blue-600 hover:text-blue-800 p-2 hover:bg-blue-200 rounded transition"
                            title="Editar atividade"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        </div>
                        <p className="text-slate-700">{activity.description}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-500 text-center py-8">Nenhuma atividade registrada</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal - Encerrar Chamado */}
      <Dialog open={showCloseModal} onOpenChange={setShowCloseModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Encerrar Chamado</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Observações de Conclusão
              </label>
              <textarea
                value={closeObservations}
                onChange={(e) => setCloseObservations(e.target.value)}
                placeholder="Descreva como o chamado foi resolvido..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={4}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                onClick={() => setShowCloseModal(false)}
                variant="outline"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCloseChamado}
                className="bg-red-600 hover:bg-red-700"
              >
                Encerrar Chamado
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal - Editar Atividade */}
      <Dialog open={showEditActivityModal} onOpenChange={setShowEditActivityModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Atividade</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <textarea
              value={editingActivityText}
              onChange={(e) => setEditingActivityText(e.target.value)}
              placeholder="Editar atividade..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={4}
            />
            <div className="flex gap-2 justify-end">
              <Button
                onClick={() => setShowEditActivityModal(false)}
                variant="outline"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleEditActivity}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
