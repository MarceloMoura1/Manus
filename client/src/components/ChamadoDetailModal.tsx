import React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit2, Send, CheckCircle2, Clock } from "lucide-react";

// Types are imported from Home.tsx context

interface ChamadoDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chamado: any | null;
  newStatus: string | null;
  onStatusChange: (status: string) => void;
  newAttendant: string | null;
  onAttendantChange: (attendant: string) => void;
  newActivityText: string;
  onActivityTextChange: (text: string) => void;
  onAddActivity: () => void;
  editingActivityId: string | null;
  editingActivityText: string;
  onEditingActivityTextChange: (text: string) => void;
  onEditActivity: () => void;
  onCancelEdit: () => void;
  onStartEdit: (id: string, text: string) => void;
  addActivityMutation: any;
  editActivityMutation: any;
}

export function ChamadoDetailModal({
  open,
  onOpenChange,
  chamado,
  newStatus,
  onStatusChange,
  newAttendant,
  onAttendantChange,
  newActivityText,
  onActivityTextChange,
  onAddActivity,
  editingActivityId,
  editingActivityText,
  onEditingActivityTextChange,
  onEditActivity,
  onCancelEdit,
  onStartEdit,
  addActivityMutation,
  editActivityMutation,
}: ChamadoDetailModalProps) {
  if (!chamado) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto bg-slate-50">
        <DialogTitle className="sr-only">
          Detalhes do Chamado #{String(chamado?.number).padStart(4, "0")} - {chamado?.title}
        </DialogTitle>
        <div className="space-y-6 p-6">
          {/* Header com Título */}
          <div className="border-b border-slate-200 pb-4">
            <h2 className="text-2xl font-bold text-slate-900">{chamado.title}</h2>
            <p className="text-sm text-slate-500 mt-1">
              Chamado #{String(chamado.number).padStart(4, "0")} • {chamado.customerName || "N/A"} • {chamado.company || "N/A"}
            </p>
          </div>

          {/* Botões de Ação */}
          <div className="flex gap-3 flex-wrap">
            <Button
              variant="default"
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => {
                onActivityTextChange("");
                const input = document.querySelector('input[placeholder="Descreva a atividade..."]') as HTMLInputElement;
                if (input) input.focus();
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Registrar Atividade
            </Button>

            <Select value={newStatus || chamado.status} onValueChange={onStatusChange}>
              <SelectTrigger className="w-40 bg-white">
                <SelectValue placeholder="Status do chamado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Aberto</SelectItem>
                <SelectItem value="in_progress">Em Progresso</SelectItem>
                <SelectItem value="waiting">Aguardando</SelectItem>
                <SelectItem value="closed">Fechado</SelectItem>
              </SelectContent>
            </Select>

            <Input
              placeholder="Atendente Responsável"
              value={newAttendant || chamado.assignedTo || ""}
              onChange={(e) => onAttendantChange(e.target.value)}
              onBlur={() => {
                if (newAttendant && newAttendant !== chamado.assignedTo) {
                  // Trigger change
                }
              }}
              className="flex-1 min-w-48 bg-white"
            />
          </div>

          {/* Timeline */}
          <div className="bg-white rounded-lg p-6">
            <h3 className="font-bold text-slate-900 mb-6 text-lg">Histórico de Atividades</h3>

            <div className="space-y-6">
              {chamado.activities.length === 0 ? (
                <div className="text-center py-8">
                  <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">Nenhuma atividade registrada</p>
                </div>
              ) : (
                chamado.activities.map((activity: any, idx: number) => {
                  const activityDate = new Date(activity.date);
                  const dateStr = activityDate.toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  });
                  const timeStr = activityDate.toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                  return (
                    <div key={activity.id} className="flex gap-4">
                      {/* Coluna de Data e Ícone */}
                      <div className="flex flex-col items-center pt-1">
                        <div className="text-right mb-2">
                          <p className="text-xs font-semibold text-orange-500">{dateStr}</p>
                          <p className="text-xs text-slate-500">{timeStr}</p>
                        </div>
                        <div className="relative">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center border-2 border-white shadow-md">
                            <CheckCircle2 className="w-4 h-4 text-white" />
                          </div>
                          {idx < chamado.activities.length - 1 && (
                            <div
                              className="absolute left-1/2 transform -translate-x-1/2 w-0.5 bg-gradient-to-b from-slate-300 to-slate-200"
                              style={{ top: "32px", height: "64px" }}
                            />
                          )}
                        </div>
                      </div>

                      {/* Balão de Atividade */}
                      <div className="flex-1 pb-2">
                        <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 border-l-4 border-yellow-400 rounded-lg p-4 shadow-sm">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <p className="font-semibold text-slate-900 text-sm">
                                Atendente: <span className="font-bold">{activity.attendant}</span>
                              </p>
                              <p className="text-xs text-slate-600 mt-1">Horas anotadas: 00:00 ⏱️</p>
                            </div>
                            {editingActivityId !== activity.id && (
                              <button
                                onClick={() => onStartEdit(activity.id, activity.description)}
                                className="p-1.5 hover:bg-yellow-200 rounded transition-colors"
                                title="Editar atividade"
                              >
                                <Edit2 className="w-4 h-4 text-slate-600" />
                              </button>
                            )}
                          </div>

                          {editingActivityId === activity.id ? (
                            <div className="mt-3 space-y-2">
                              <Input
                                value={editingActivityText}
                                onChange={(e) => onEditingActivityTextChange(e.target.value)}
                                className="text-sm bg-white"
                                placeholder="Descreva a atividade..."
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={onEditActivity}
                                  disabled={editActivityMutation.isPending}
                                  className="bg-blue-600 hover:bg-blue-700"
                                >
                                  Salvar
                                </Button>
                                <Button size="sm" variant="outline" onClick={onCancelEdit}>
                                  Cancelar
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-slate-800 mt-2 leading-relaxed">{activity.description}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Registrar Nova Atividade */}
          <div className="bg-white rounded-lg p-6 border-t-4 border-blue-500">
            <label className="text-sm font-bold text-slate-900 block mb-3">Registrar Nova Atividade</label>
            <div className="flex gap-2">
              <Input
                placeholder="Descreva a atividade..."
                value={newActivityText}
                onChange={(e) => onActivityTextChange(e.target.value)}
                className="text-sm flex-1 bg-slate-50"
              />
              <Button
                onClick={onAddActivity}
                disabled={addActivityMutation.isPending || !newActivityText.trim()}
                size="sm"
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
