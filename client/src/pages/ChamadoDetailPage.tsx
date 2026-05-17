import React, { useState } from "react";
import { ArrowLeft, Clock, Edit2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

interface TicketActivity {
  id: string;
  description: string;
  attendant: string;
  date?: number; // timestamp em millisegundos
  createdAt?: number; // timestamp em millisegundos
  actionType?: string;
}

interface Ticket {
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

interface ChamadoDetailPageProps {
  chamado: Ticket;
  onBack: () => void;
}

export function ChamadoDetailPage({ chamado, onBack }: ChamadoDetailPageProps) {
  const { user } = useAuth();
  console.log('ChamadoDetailPage renderizado com chamado:', chamado);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showAttendantModal, setShowAttendantModal] = useState(false);
  const [newActivityText, setNewActivityText] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [selectedAttendant, setSelectedAttendant] = useState(chamado?.assignedTo || "");

  const addActivityMutation = trpc.chamados.addActivity.useMutation();
  const updateChamadoMutation = trpc.chamados.update.useMutation();

  const handleAddActivity = async () => {
    if (!newActivityText.trim()) return;

    try {
      await addActivityMutation.mutateAsync({
        chamadoId: chamado.id,
        description: newActivityText,
        attendant: user?.user?.name || "Atendente",
      });

      setNewActivityText("");
      setShowActivityModal(false);
    } catch (error) {
      console.error("Erro ao registrar atividade:", error);
    }
  };

  const handleUpdateStatus = async (newStatus: string) => {
    try {
      await updateChamadoMutation.mutateAsync({
        chamadoId: chamado.id,
        status: newStatus as any,
      });
      setShowStatusModal(false);
    } catch (error) {
      console.error("Erro ao atualizar status:", error);
    }
  };

  const handleUpdateAttendant = async (attendant: string) => {
    try {
      await updateChamadoMutation.mutateAsync({
        chamadoId: chamado.id,
        assignedTo: attendant,
      });
      setSelectedAttendant(attendant);
      setShowAttendantModal(false);
    } catch (error) {
      console.error("Erro ao atualizar atendente:", error);
    }
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

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      open: "Aberto",
      in_progress: "Em Progresso",
      waiting: "Aguardando",
      closed: "Fechado",
    };
    return labels[status] || status;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="hover:bg-blue-800 p-2 rounded-lg transition"
              title="Voltar"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <div>
              <h1 className="text-3xl font-bold">
                #{String(chamado.number).padStart(4, "0")} - {chamado.title}
              </h1>
              <p className="text-blue-100 mt-1">
                {chamado.customerName} • {chamado.company}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="bg-white border-b border-slate-200 p-6 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-6 flex-wrap">
          {/* Status */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-600">Status:</span>
            <button
              onClick={() => setShowStatusModal(true)}
              className={`px-4 py-2 rounded-lg font-medium transition ${getStatusColor(
                chamado.status
              )} hover:shadow-md`}
            >
              {getStatusLabel(chamado.status)}
            </button>
          </div>

          {/* Separador */}
          <div className="h-8 w-px bg-slate-300"></div>

          {/* Atendente */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-600">Atendente:</span>
            <button
              onClick={() => setShowAttendantModal(true)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-medium transition"
            >
              {selectedAttendant || "Selecionar"}
            </button>
          </div>

          {/* Separador */}
          <div className="h-8 w-px bg-slate-300"></div>

          {/* Registrar Atividade */}
          <button
            onClick={() => setShowActivityModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition"
          >
            + Registrar Atividade
          </button>

          {/* Separador */}
          <div className="h-8 w-px bg-slate-300"></div>

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
              <button className="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-800 rounded-lg font-medium transition flex items-center gap-2">
                <Upload className="w-4 h-4" />
                Anexar
              </button>
            </label>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Timeline - Main Content */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold text-slate-900 mb-6">Histórico de Atividades</h2>

              <div className="space-y-6">
                {chamado.activities && chamado.activities.length > 0 ? (
                  chamado.activities.map((activity, index) => (
                    <div key={activity.id} className="flex gap-4 relative">
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
                      <div className="flex-1 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200 shadow-sm">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-semibold text-slate-900">{activity.attendant}</p>
                            <p className="text-sm text-slate-600">
                              {new Date(
                                activity.createdAt || activity.date || new Date()
                              ).toLocaleString("pt-BR")}
                            </p>
                          </div>
                          <button className="text-blue-600 hover:text-blue-800 p-2 hover:bg-blue-200 rounded transition">
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

          {/* Sidebar - Info */}
          <div className="space-y-4">
            {/* Card - Prioridade */}
            <div className="bg-white rounded-lg shadow-md p-4">
              <h3 className="text-sm font-semibold text-slate-600 mb-2">Prioridade</h3>
              <p className="text-lg font-bold text-slate-900 capitalize">{chamado.priority || "Não definida"}</p>
            </div>

            {/* Card - Observações */}
            <div className="bg-white rounded-lg shadow-md p-4">
              <h3 className="text-sm font-semibold text-slate-600 mb-2">Observações</h3>
              <p className="text-slate-700">{chamado.observations || "Nenhuma observação"}</p>
            </div>

            {/* Card - Data de Criação */}
            <div className="bg-white rounded-lg shadow-md p-4">
              <h3 className="text-sm font-semibold text-slate-600 mb-2">Data de Criação</h3>
              <p className="text-slate-700">{new Date(chamado.createdAt).toLocaleDateString("pt-BR")}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Modal - Registrar Atividade */}
      <Dialog open={showActivityModal} onOpenChange={setShowActivityModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Atividade</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <textarea
              value={newActivityText}
              onChange={(e) => setNewActivityText(e.target.value)}
              placeholder="Descreva a atividade..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={4}
            />
            <div className="flex gap-2 justify-end">
              <Button onClick={() => setShowActivityModal(false)} variant="outline">
                Cancelar
              </Button>
              <Button onClick={handleAddActivity} className="bg-blue-600 hover:bg-blue-700">
                Registrar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal - Alterar Status */}
      <Dialog open={showStatusModal} onOpenChange={setShowStatusModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar Status</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {["open", "in_progress", "waiting", "closed"].map((status) => (
              <button
                key={status}
                onClick={() => handleUpdateStatus(status)}
                className={`w-full px-4 py-2 rounded-lg font-medium transition ${getStatusColor(
                  status
                )} hover:shadow-md`}
              >
                {getStatusLabel(status)}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal - Selecionar Atendente */}
      <Dialog open={showAttendantModal} onOpenChange={setShowAttendantModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Selecionar Atendente</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {["João Silva", "Maria Santos", "Pedro Oliveira", "Ana Costa"].map((attendant) => (
              <button
                key={attendant}
                onClick={() => handleUpdateAttendant(attendant)}
                className={`w-full px-4 py-2 rounded-lg font-medium transition ${
                  selectedAttendant === attendant
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-800"
                }`}
              >
                {attendant}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
