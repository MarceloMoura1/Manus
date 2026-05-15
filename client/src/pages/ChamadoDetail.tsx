import React, { useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Edit2,
  MessageSquare,
  Clock,
  User,
  AlertCircle,
  CheckCircle2,
  Paperclip,
  X,
  Save,
  Loader2,
} from "lucide-react";

interface Ticket {
  id: string;
  chamadoNumber: number;
  title: string;
  observations: string;
  status: "open" | "in_progress" | "waiting" | "closed";
  priority: "baixa" | "media" | "alta" | "critica";
  customerName: string;
  company: string;
  assignedTo?: string;
  activities?: Array<{
    id: string;
    description: string;
    type: string;
    createdAt: Date;
  }>;
  attachments?: Array<{
    id: string;
    name: string;
    url: string;
    type: string;
  }>;
}

const statusColors = {
  open: "bg-blue-100 text-blue-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  waiting: "bg-orange-100 text-orange-800",
  closed: "bg-green-100 text-green-800",
};

const statusLabels = {
  open: "Aberto",
  in_progress: "Em Progresso",
  waiting: "Aguardando",
  closed: "Fechado",
};

const priorityColors = {
  baixa: "bg-green-100 text-green-800",
  media: "bg-blue-100 text-blue-800",
  alta: "bg-orange-100 text-orange-800",
  critica: "bg-red-100 text-red-800",
};

const priorityLabels = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  critica: "Crítica",
};

export function ChamadoDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();

  // Estados
  const [newActivityText, setNewActivityText] = useState("");
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const [editingActivityText, setEditingActivityText] = useState("");
  const [showEditActivityModal, setShowEditActivityModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showAttendantModal, setShowAttendantModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [newStatus, setNewStatus] = useState<"open" | "in_progress" | "waiting" | "closed">("open");
  const [newAttendant, setNewAttendant] = useState("");
  const [closeObservations, setCloseObservations] = useState("");
  const [toastMessage, setToastMessage] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Queries tRPC
  const chamadoQuery = trpc.chamados.getDetail.useQuery(
    { chamadoId: id || "" },
    { enabled: !!id && !!user?.user?.id }
  );

  const utils = trpc.useUtils();
  const addActivityMutation = trpc.chamados.addActivity.useMutation();
  const editActivityMutation = trpc.chamados.editActivity.useMutation();
  const updateChamadoMutation = trpc.chamados.update.useMutation();

  const chamado = chamadoQuery.data as Ticket | undefined;

  const showToast = (message: string, type: "success" | "error") => {
    setToastMessage({ message, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleAddActivity = async () => {
    if (!newActivityText.trim() || !chamado) return;

    try {
      await addActivityMutation.mutateAsync({
        chamadoId: chamado.id,
        description: newActivityText,
        attendant: user?.user?.name || "Atendente",
      });

      setNewActivityText("");
      await chamadoQuery.refetch();
      showToast("Atividade registrada com sucesso", "success");
    } catch (error) {
      showToast("Erro ao registrar atividade", "error");
    }
  };

  const handleEditActivity = async () => {
    if (!editingActivityText.trim() || !editingActivityId || !chamado) return;

    try {
      await editActivityMutation.mutateAsync({
        activityId: editingActivityId,
        chamadoId: chamado.id,
        description: editingActivityText,
      });

      setEditingActivityId(null);
      setEditingActivityText("");
      setShowEditActivityModal(false);
      await chamadoQuery.refetch();
      showToast("Atividade atualizada com sucesso", "success");
    } catch (error) {
      showToast("Erro ao atualizar atividade", "error");
    }
  };

  const handleUpdateStatus = async () => {
    if (!chamado) return;

    try {
      await updateChamadoMutation.mutateAsync({
        chamadoId: chamado.id,
        status: newStatus,
      });

      setShowStatusModal(false);
      await chamadoQuery.refetch();
      showToast("Status atualizado com sucesso", "success");
    } catch (error) {
      showToast("Erro ao atualizar status", "error");
    }
  };

  const handleUpdateAttendant = async () => {
    if (!chamado || !newAttendant) return;

    try {
      await updateChamadoMutation.mutateAsync({
        chamadoId: chamado.id,
        assignedTo: newAttendant,
      });

      setShowAttendantModal(false);
      setNewAttendant("");
      await chamadoQuery.refetch();
      showToast("Atendente atualizado com sucesso", "success");
    } catch (error) {
      showToast("Erro ao atualizar atendente", "error");
    }
  };

  const handleCloseChamado = async () => {
    if (!chamado || !closeObservations.trim()) return;

    try {
      // Adicionar observação de encerramento como atividade
      await addActivityMutation.mutateAsync({
        chamadoId: chamado.id,
        description: `Chamado encerrado. Observações: ${closeObservations}`,
        attendant: user?.user?.name || "Atendente",
      });

      // Atualizar status para fechado
      await updateChamadoMutation.mutateAsync({
        chamadoId: chamado.id,
        status: "closed",
      });

      setShowCloseModal(false);
      setCloseObservations("");
      await chamadoQuery.refetch();
      showToast("Chamado encerrado com sucesso", "success");
    } catch (error) {
      showToast("Erro ao encerrar chamado", "error");
    }
  };

  if (chamadoQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!chamado) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Chamado não encontrado</h2>
          <Button onClick={() => navigate("/")} className="mt-4">
            Voltar para Chamados
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-6">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para Chamados
        </button>

        <div className="bg-white rounded-lg shadow-lg p-6 border border-slate-100">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold text-slate-900">#{chamado.chamadoNumber}</h1>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[chamado.status]}`}>
                  {statusLabels[chamado.status]}
                </span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${priorityColors[chamado.priority]}`}>
                  {priorityLabels[chamado.priority]}
                </span>
              </div>
              <h2 className="text-xl font-semibold text-slate-700 mb-2">{chamado.title}</h2>
              <p className="text-slate-600">
                <span className="font-medium">{chamado.customerName}</span> • {chamado.company}
              </p>
            </div>

            {chamado.status !== "closed" && (
              <Button
                onClick={() => setShowCloseModal(true)}
                variant="destructive"
                className="gap-2"
              >
                <X className="w-4 h-4" />
                Encerrar Chamado
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel - Timeline */}
        <div className="lg:col-span-2 space-y-6">
          {/* Timeline Grande */}
          <div className="bg-white rounded-lg shadow-lg p-8 border border-slate-100">
            <h3 className="text-2xl font-bold text-slate-900 mb-8">Histórico de Atividades</h3>

            <div className="space-y-6">
              {chamado.activities && chamado.activities.length > 0 ? (
                chamado.activities.map((activity, index) => (
                  <div key={activity.id} className="flex gap-6">
                    {/* Timeline Line */}
                    <div className="flex flex-col items-center">
                      <div className="w-4 h-4 rounded-full bg-blue-600 border-4 border-blue-100"></div>
                      {index < chamado.activities!.length - 1 && (
                        <div className="w-1 h-24 bg-slate-200 mt-2"></div>
                      )}
                    </div>

                    {/* Activity Content */}
                    <div className="flex-1 pb-6">
                      <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg p-6 border border-blue-200 relative">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <p className="text-slate-900 font-medium">{activity.description}</p>
                            <p className="text-sm text-slate-600 mt-2">
                              {new Date(activity.createdAt).toLocaleString("pt-BR")}
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              setEditingActivityId(activity.id);
                              setEditingActivityText(activity.description);
                              setShowEditActivityModal(true);
                            }}
                            className="p-2 hover:bg-blue-200 rounded-lg transition-colors ml-4"
                            title="Editar atividade"
                          >
                            <Edit2 className="w-4 h-4 text-blue-600" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12">
                  <MessageSquare className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500">Nenhuma atividade registrada</p>
                </div>
              )}
            </div>

            {/* Add Activity */}
            <div className="mt-8 pt-8 border-t border-slate-200">
              <h4 className="font-semibold text-slate-900 mb-4">Registrar Atividade</h4>
              <div className="space-y-3">
                <Textarea
                  placeholder="Digite a atividade ou observação..."
                  value={newActivityText}
                  onChange={(e) => setNewActivityText(e.target.value)}
                  className="min-h-24"
                />
                <Button
                  onClick={handleAddActivity}
                  disabled={addActivityMutation.isPending}
                  className="w-full gap-2"
                >
                  {addActivityMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <MessageSquare className="w-4 h-4" />
                  )}
                  Registrar Atividade
                </Button>
              </div>
            </div>
          </div>

          {/* Attachments */}
          <div className="bg-white rounded-lg shadow-lg p-6 border border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Paperclip className="w-5 h-5" />
              Anexos
            </h3>

            {chamado.attachments && chamado.attachments.length > 0 ? (
              <div className="space-y-2">
                {chamado.attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <Paperclip className="w-4 h-4 text-slate-600" />
                    <span className="text-slate-700 font-medium">{attachment.name}</span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Paperclip className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">Nenhum anexo</p>
              </div>
            )}

            <div className="mt-4">
              <label className="flex items-center justify-center w-full px-4 py-3 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-colors">
                <div className="flex items-center gap-2 text-slate-600">
                  <Paperclip className="w-4 h-4" />
                  <span className="text-sm font-medium">Adicionar Anexo</span>
                </div>
                <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
              </label>
            </div>
          </div>
        </div>

        {/* Right Panel - Info */}
        <div className="space-y-4">
          {/* Status */}
          <div className="bg-white rounded-lg shadow-lg p-6 border border-slate-100">
            <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Status
            </h4>
            <div className="flex items-center justify-between">
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[chamado.status]}`}>
                {statusLabels[chamado.status]}
              </span>
              <Button
                onClick={() => {
                  setNewStatus(chamado.status);
                  setShowStatusModal(true);
                }}
                variant="outline"
                size="sm"
              >
                Alterar
              </Button>
            </div>
          </div>

          {/* Attendant */}
          <div className="bg-white rounded-lg shadow-lg p-6 border border-slate-100">
            <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <User className="w-4 h-4" />
              Atendente
            </h4>
            <div className="flex items-center justify-between">
              <span className="text-slate-700">{chamado.assignedTo || "Não atribuído"}</span>
              <Button
                onClick={() => {
                  setNewAttendant(chamado.assignedTo || "");
                  setShowAttendantModal(true);
                }}
                variant="outline"
                size="sm"
              >
                Alterar
              </Button>
            </div>
          </div>

          {/* Priority */}
          <div className="bg-white rounded-lg shadow-lg p-6 border border-slate-100">
            <h4 className="font-semibold text-slate-900 mb-3">Prioridade</h4>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${priorityColors[chamado.priority]}`}>
              {priorityLabels[chamado.priority]}
            </span>
          </div>

          {/* Observations */}
          <div className="bg-white rounded-lg shadow-lg p-6 border border-slate-100">
            <h4 className="font-semibold text-slate-900 mb-3">Observações</h4>
            <p className="text-slate-700 text-sm leading-relaxed">{chamado.observations}</p>
          </div>
        </div>
      </div>

      {/* Modals */}

      {/* Edit Activity Modal */}
      <Dialog open={showEditActivityModal} onOpenChange={setShowEditActivityModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Atividade</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              value={editingActivityText}
              onChange={(e) => setEditingActivityText(e.target.value)}
              className="min-h-24"
            />
            <div className="flex gap-3">
              <Button
                onClick={handleEditActivity}
                disabled={editActivityMutation.isPending}
                className="flex-1 gap-2"
              >
                {editActivityMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Salvar
              </Button>
              <Button
                onClick={() => setShowEditActivityModal(false)}
                variant="outline"
                className="flex-1"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Status Modal */}
      <Dialog open={showStatusModal} onOpenChange={setShowStatusModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar Status</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Select value={newStatus} onValueChange={(value: any) => setNewStatus(value)}>
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
            <div className="flex gap-3">
              <Button
                onClick={handleUpdateStatus}
                disabled={updateChamadoMutation.isPending}
                className="flex-1"
              >
                {updateChamadoMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Salvar"
                )}
              </Button>
              <Button onClick={() => setShowStatusModal(false)} variant="outline" className="flex-1">
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Attendant Modal */}
      <Dialog open={showAttendantModal} onOpenChange={setShowAttendantModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar Atendente</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Nome do atendente"
              value={newAttendant}
              onChange={(e) => setNewAttendant(e.target.value)}
            />
            <div className="flex gap-3">
              <Button
                onClick={handleUpdateAttendant}
                disabled={updateChamadoMutation.isPending}
                className="flex-1"
              >
                {updateChamadoMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Salvar"
                )}
              </Button>
              <Button onClick={() => setShowAttendantModal(false)} variant="outline" className="flex-1">
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Close Chamado Modal */}
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
              <Textarea
                placeholder="Descreva a conclusão do chamado..."
                value={closeObservations}
                onChange={(e) => setCloseObservations(e.target.value)}
                className="min-h-24"
              />
            </div>
            <div className="flex gap-3">
              <Button
                onClick={handleCloseChamado}
                disabled={updateChamadoMutation.isPending || !closeObservations.trim()}
                variant="destructive"
                className="flex-1"
              >
                {updateChamadoMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Encerrar"
                )}
              </Button>
              <Button onClick={() => setShowCloseModal(false)} variant="outline" className="flex-1">
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Toast */}
      {toastMessage && (
        <div
          className={`fixed bottom-4 right-4 px-6 py-3 rounded-lg font-medium flex items-center gap-2 ${
            toastMessage.type === "success"
              ? "bg-green-500 text-white"
              : "bg-red-500 text-white"
          }`}
        >
          {toastMessage.type === "success" ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          {toastMessage.message}
        </div>
      )}
    </div>
  );
}
