import React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Edit2, CheckCircle2, Clock } from "lucide-react";

interface Activity {
  id: string;
  description: string;
  attendant: string;
  date: number; // timestamp em millisegundos
  actionType?: string;
}

interface Chamado {
  id: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  customerName?: string;
  company?: string;
  assignedTo?: string;
  activities: Activity[];
}

interface ChamadoDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chamado: Chamado | null;
}

export function ChamadoDetailModal({
  open,
  onOpenChange,
  chamado,
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

          {/* Barra de Ações Horizontal */}
          <div className="flex items-center gap-4 pb-4 border-b border-slate-200 flex-wrap">
            {/* Status */}
            <div className="flex-1 min-w-40">
              <label className="text-xs font-semibold text-slate-600 block mb-1">Status</label>
              <select className="w-full px-3 py-2 border border-slate-200 rounded text-sm bg-white">
                <option value="open">Aberto</option>
                <option value="in_progress">Em Progresso</option>
                <option value="waiting">Aguardando</option>
                <option value="closed">Fechado</option>
              </select>
            </div>

            {/* Separador */}
            <div className="w-px h-12 bg-slate-200 hidden sm:block" />

            {/* Atendente */}
            <div className="flex-1 min-w-40">
              <label className="text-xs font-semibold text-slate-600 block mb-1">Atendente</label>
              <div className="flex gap-2">
                <Input
                  placeholder="Nome"
                  defaultValue={chamado.assignedTo || ""}
                  className="text-sm flex-1"
                />
                <Button size="sm">OK</Button>
              </div>
            </div>

            {/* Separador */}
            <div className="w-px h-12 bg-slate-200 hidden sm:block" />

            {/* Registrar Atividade */}
            <div className="flex-1 min-w-40">
              <label className="text-xs font-semibold text-slate-600 block mb-1">Atividade</label>
              <div className="flex gap-2">
                <Input
                  placeholder="Descrever..."
                  className="text-sm flex-1"
                />
                <Button size="sm">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Separador */}
            <div className="w-px h-12 bg-slate-200 hidden sm:block" />

            {/* Anexar */}
            <div className="flex-1 min-w-40">
              <label className="text-xs font-semibold text-slate-600 block mb-1">Anexar</label>
              <Button size="sm" variant="outline" className="w-full">
                Escolher arquivo
              </Button>
            </div>

            {/* Separador */}
            <div className="w-px h-12 bg-slate-200 hidden sm:block" />

            {/* Encerrar */}
            <div className="flex-1 min-w-40">
              <label className="text-xs font-semibold text-slate-600 block mb-1">Ação</label>
              <Button size="sm" variant="destructive" className="w-full">
                Encerrar
              </Button>
            </div>
          </div>

          {/* Timeline Grande */}
          <div className="bg-white rounded-lg p-6">
            <h3 className="font-bold text-slate-900 mb-6 text-lg">Histórico de Atividades</h3>

            <div className="space-y-6">
              {chamado.activities.length === 0 ? (
                <div className="text-center py-8">
                  <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">Nenhuma atividade registrada</p>
                </div>
              ) : (
                chamado.activities.map((activity, idx) => {
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
                            <button className="p-1.5 hover:bg-yellow-200 rounded transition-colors" title="Editar atividade">
                              <Edit2 className="w-4 h-4 text-slate-600" />
                            </button>
                          </div>
                          <p className="text-sm text-slate-800 mt-2 leading-relaxed">{activity.description}</p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
