import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Sparkles,
  Zap,
  Plus,
  Play,
  RotateCw,
  Copy,
  Trash2,
  Edit2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ArrowRight,
  Layers,
  Webhook,
  Bot,
  Filter,
  CheckSquare,
  UserCheck,
  Tag,
  Share2,
  ExternalLink,
  RefreshCw,
  Search,
  Code,
  Sliders,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const TRIGGER_LABELS: Record<string, { label: string; icon: string }> = {
  "lead.created": { label: "Novo Lead Criado", icon: "👤" },
  "lead.stage_changed": { label: "Mudança de Estágio no Funil", icon: "📊" },
  "opportunity.won": { label: "Negócio Ganho (Venda Fechada)", icon: "🏆" },
  "opportunity.lost": { label: "Negócio Perdido", icon: "❌" },
  "activity.overdue": { label: "Atividade Atrasada", icon: "⏰" },
  custom: { label: "Disparo Personalizado / Manual", icon: "⚡" },
};

const ACTION_LABELS: Record<string, { label: string; icon: string }> = {
  create_task: { label: "Criar Tarefa / Atividade", icon: "📝" },
  assign_owner: { label: "Atribuir Responsável", icon: "👤" },
  add_tag: { label: "Adicionar Tag", icon: "🏷️" },
  send_whatsapp: { label: "Preparar Envio WhatsApp", icon: "💬" },
  ai_qualify: { label: "Qualificar com IA (Gemini)", icon: "✨" },
  call_webhook: { label: "Chamar Webhook Externo", icon: "🌐" },
};

export function AutomationsPage() {
  const [activeTab, setActiveTab] = useState<"rules" | "runs" | "webhooks" | "ai">("rules");

  // Rule Modals
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testRule, setTestRule] = useState<any | null>(null);
  const [testPayload, setTestPayload] = useState(
    JSON.stringify(
      {
        company_name: "Empresa Teste Ltda",
        phone: "11999999999",
        email: "contato@empresa.com",
        observations: "Interesse urgente no software de gestão",
        city: "São Paulo",
        origin: "site",
      },
      null,
      2
    )
  );

  // Run Detail Modal
  const [selectedRun, setSelectedRun] = useState<any | null>(null);

  // Webhook Modal
  const [webhookModalOpen, setWebhookModalOpen] = useState(false);
  const [webhookName, setWebhookName] = useState("");

  // AI Copilot Interactive Test
  const [aiTestResult, setAiTestResult] = useState<string | null>(null);

  // Form State for Rule
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formTrigger, setFormTrigger] = useState("lead.created");
  const [formConditions, setFormConditions] = useState<Array<{ field: string; op: "eq" | "neq" | "contains"; value: string }>>([]);
  const [formActions, setFormActions] = useState<Array<{ type: string; config: Record<string, any> }>>([
    { type: "create_task", config: { title: "Fazer primeiro contato", type: "call", dueHours: 2 } },
  ]);

  const utils = trpc.useUtils();

  // Queries
  const { data: rules = [], isLoading: isLoadingRules, refetch: refetchRules } =
    trpc.crm.automations.listRules.useQuery();

  const { data: runs = [], isLoading: isLoadingRuns, refetch: refetchRuns } =
    trpc.crm.automations.listRuns.useQuery({ limit: 50 }, { enabled: activeTab === "runs" });

  const { data: webhooks = [], isLoading: isLoadingWebhooks, refetch: refetchWebhooks } =
    trpc.crm.automations.listWebhookSources.useQuery(undefined, { enabled: activeTab === "webhooks" });

  const { data: aiSettings, isLoading: isLoadingAi, refetch: refetchAi } =
    trpc.crm.automations.getAiSettings.useQuery(undefined, { enabled: activeTab === "ai" });

  const { data: oppsData } = trpc.crm.opportunities.list.useQuery({ status: "open" });

  // Mutations
  const createRuleMutation = trpc.crm.automations.createRule.useMutation({
    onSuccess: () => {
      toast.success("Regra de automação criada com sucesso!");
      utils.crm.automations.listRules.invalidate();
      closeRuleModal();
    },
    onError: (err) => toast.error(err.message || "Erro ao criar regra."),
  });

  const toggleRuleMutation = trpc.crm.automations.toggleRule.useMutation({
    onSuccess: () => {
      utils.crm.automations.listRules.invalidate();
      toast.success("Status da regra alterado!");
    },
  });

  const deleteRuleMutation = trpc.crm.automations.deleteRule.useMutation({
    onSuccess: () => {
      utils.crm.automations.listRules.invalidate();
      toast.success("Regra excluída!");
    },
  });

  const testRuleMutation = trpc.crm.automations.testRule.useMutation({
    onSuccess: (res) => {
      toast.success(`Teste executado: status ${res.status}`);
      setTestModalOpen(false);
      utils.crm.automations.listRuns.invalidate();
    },
    onError: (err) => toast.error(err.message || "Falha no teste da regra."),
  });

  const createWebhookMutation = trpc.crm.automations.createWebhookSource.useMutation({
    onSuccess: () => {
      toast.success("Webhook de entrada criado com sucesso!");
      utils.crm.automations.listWebhookSources.invalidate();
      setWebhookModalOpen(false);
      setWebhookName("");
    },
    onError: (err) => toast.error(err.message || "Erro ao criar webhook."),
  });

  const rotateTokenMutation = trpc.crm.automations.rotateWebhookToken.useMutation({
    onSuccess: () => {
      toast.success("Token de webhook rotacionado com sucesso!");
      utils.crm.automations.listWebhookSources.invalidate();
    },
  });

  const deleteWebhookMutation = trpc.crm.automations.deleteWebhookSource.useMutation({
    onSuccess: () => {
      toast.success("Webhook excluído!");
      utils.crm.automations.listWebhookSources.invalidate();
    },
  });

  const updateAiMutation = trpc.crm.automations.updateAiSettings.useMutation({
    onSuccess: () => {
      toast.success("Configurações do Gemini salvas!");
      utils.crm.automations.getAiSettings.invalidate();
    },
  });

  const suggestActionMutation = trpc.crm.automations.suggestNextAction.useMutation({
    onSuccess: (res) => {
      setAiTestResult(res.suggestion);
    },
  });

  // Open / Close Rule Modal
  const openCreateRuleModal = () => {
    setEditingRuleId(null);
    setFormName("");
    setFormDescription("");
    setFormTrigger("lead.created");
    setFormConditions([]);
    setFormActions([
      { type: "create_task", config: { title: "Fazer primeiro contato com {company_name}", type: "call", dueHours: 2 } },
    ]);
    setRuleModalOpen(true);
  };

  const closeRuleModal = () => {
    setRuleModalOpen(false);
    setEditingRuleId(null);
  };

  const handleAddCondition = () => {
    setFormConditions((prev) => [...prev, { field: "origin", op: "eq", value: "site" }]);
  };

  const handleRemoveCondition = (index: number) => {
    setFormConditions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddAction = (type: string) => {
    let config: Record<string, any> = {};
    if (type === "create_task") config = { title: "Tarefa para {company_name}", type: "task", dueHours: 24 };
    if (type === "assign_owner") config = { owner: "Vendedor Padrão" };
    if (type === "add_tag") config = { tag: "lead-qualificado" };
    if (type === "send_whatsapp") config = { message: "Olá {company_name}! Recebemos seu contato e logo falaremos com você." };
    if (type === "ai_qualify") config = {};
    if (type === "call_webhook") config = { url: "https://seu-endpoint.com/webhook" };

    setFormActions((prev) => [...prev, { type, config }]);
  };

  const handleRemoveAction = (index: number) => {
    setFormActions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error("O nome da regra é obrigatório.");
      return;
    }
    if (formActions.length === 0) {
      toast.error("Adicione pelo menos uma ação à regra.");
      return;
    }

    createRuleMutation.mutate({
      name: formName.trim(),
      description: formDescription.trim() || null,
      triggerType: formTrigger as any,
      conditions: formConditions,
      actions: formActions as any,
      isActive: true,
    });
  };

  const originUrl = typeof window !== "undefined" ? window.location.origin : "https://app.megadesk.online";

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Automações Comerciais & IA (Gemini)
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Crie fluxos automáticos de tarefas, capture leads via Webhooks e utilize inteligência artificial no funil.
          </p>
        </div>

        {activeTab === "rules" && (
          <Button onClick={openCreateRuleModal} className="gap-2 bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4" /> Nova Regra
          </Button>
        )}
        {activeTab === "webhooks" && (
          <Button onClick={() => setWebhookModalOpen(true)} className="gap-2 bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4" /> Novo Webhook
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("rules")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
            activeTab === "rules"
              ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <Zap className="w-4 h-4" /> Regras de Automação ({rules.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("runs")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
            activeTab === "runs"
              ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <Clock className="w-4 h-4" /> Histórico de Execuções
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("webhooks")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
            activeTab === "webhooks"
              ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <Webhook className="w-4 h-4" /> Webhooks de Entrada ({webhooks.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("ai")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
            activeTab === "ai"
              ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <Sparkles className="w-4 h-4" /> Copiloto IA (Gemini)
        </button>
      </div>

      {/* Tab 1: Regras */}
      {activeTab === "rules" && (
        <div className="space-y-4">
          {isLoadingRules ? (
            <div className="py-20 text-center text-slate-500">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
              Carregando regras de automação...
            </div>
          ) : rules.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-12 text-center bg-white/50 dark:bg-slate-900/50">
              <Zap className="w-12 h-12 text-slate-400 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Nenhuma regra de automação configurada
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1">
                Automatize tarefas imediatas quando novos leads chegarem ou oportunidades mudarem de estágio.
              </p>
              <Button onClick={openCreateRuleModal} className="mt-4 gap-2 bg-indigo-600 hover:bg-indigo-700">
                <Plus className="w-4 h-4" /> Criar Primeira Regra
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {rules.map((rule) => {
                const triggerConf = TRIGGER_LABELS[rule.triggerType] || { label: rule.triggerType, icon: "⚡" };
                return (
                  <div
                    key={rule.publicId}
                    className={`p-5 rounded-xl border transition-all ${
                      rule.isActive
                        ? "bg-white border-slate-200 dark:bg-slate-900 dark:border-slate-800 shadow-sm"
                        : "bg-slate-50/60 border-slate-200 opacity-60 dark:bg-slate-900/30 dark:border-slate-800"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{triggerConf.icon}</span>
                          <h3 className="font-bold text-base text-slate-900 dark:text-white">
                            {rule.name}
                          </h3>
                        </div>
                        {rule.description && (
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {rule.description}
                          </p>
                        )}
                      </div>

                      {/* Active toggle */}
                      <button
                        type="button"
                        onClick={() =>
                          toggleRuleMutation.mutate({
                            publicId: rule.publicId,
                            isActive: !rule.isActive,
                          })
                        }
                        className={`text-xs px-2.5 py-1 rounded-full font-semibold border transition-all ${
                          rule.isActive
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-500 border-slate-300 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {rule.isActive ? "Ativa" : "Pausada"}
                      </button>
                    </div>

                    {/* Trigger & Conditions */}
                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs">
                      <div>
                        <span className="font-semibold text-slate-600 dark:text-slate-400">Gatilho: </span>
                        <span className="text-slate-900 dark:text-white font-medium">
                          {triggerConf.label}
                        </span>
                      </div>

                      {rule.conditions && rule.conditions.length > 0 && (
                        <div>
                          <span className="font-semibold text-slate-600 dark:text-slate-400">Condições: </span>
                          <span className="text-slate-700 dark:text-slate-300">
                            {rule.conditions
                              .map((c: any) => `${c.field} ${c.op} "${c.value}"`)
                              .join(" E ")}
                          </span>
                        </div>
                      )}

                      {/* Actions */}
                      <div>
                        <span className="font-semibold text-slate-600 dark:text-slate-400">Ações: </span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {rule.actions?.map((act: any, i: number) => {
                            const actConf = ACTION_LABELS[act.type] || { label: act.type, icon: "⚡" };
                            return (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-700 dark:text-slate-300"
                              >
                                <span>{actConf.icon}</span> {actConf.label}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Footer stats & actions */}
                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-400">
                      <span>Executada {rule.executionCount} vezes</span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setTestRule(rule);
                            setTestModalOpen(true);
                          }}
                          className="h-7 px-2 text-xs gap-1 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                        >
                          <Play className="w-3 h-3" /> Testar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteRuleMutation.mutate({ publicId: rule.publicId })}
                          className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Histórico de Execuções */}
      {activeTab === "runs" && (
        <div className="space-y-4">
          {isLoadingRuns ? (
            <div className="py-20 text-center text-slate-500">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
              Carregando histórico...
            </div>
          ) : runs.length === 0 ? (
            <div className="p-12 text-center border rounded-xl text-slate-500 bg-white dark:bg-slate-900">
              Nenhuma execução registrada até o momento.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 uppercase font-semibold">
                  <tr>
                    <th className="px-4 py-3">Regra</th>
                    <th className="px-4 py-3">Evento</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Duração</th>
                    <th className="px-4 py-3">Data/Hora</th>
                    <th className="px-4 py-3 text-right">Detalhes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {runs.map((run) => (
                    <tr key={run.publicId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                        {run.ruleName || "Regra Manual"}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{run.eventType}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                            run.status === "success"
                              ? "bg-emerald-100 text-emerald-800"
                              : run.status === "failed"
                              ? "bg-rose-100 text-rose-800"
                              : run.status === "skipped"
                              ? "bg-slate-100 text-slate-600"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{run.durationMs}ms</td>
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(run.createdAt).toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedRun(run)}
                          className="h-7 px-2 text-xs"
                        >
                          Ver Logs
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Webhooks de Entrada */}
      {activeTab === "webhooks" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {webhooks.map((source) => {
              const fullUrl = `${originUrl}/api/v1/crm/webhooks/${source.token}`;
              return (
                <div
                  key={source.publicId}
                  className="p-5 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                      <Webhook className="w-4 h-4 text-indigo-600" /> {source.name}
                    </h3>
                    <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                      {source.totalReceived} leads capturados
                    </span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      URL de Destino para Formulários / Landing Pages
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        readOnly
                        value={fullUrl}
                        className="w-full text-xs font-mono px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border rounded-lg select-all text-slate-700 dark:text-slate-300"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(fullUrl);
                          toast.success("URL do webhook copiada!");
                        }}
                        className="h-8 px-2.5 text-xs"
                        title="Copiar URL"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="pt-2 border-t flex items-center justify-between text-xs text-slate-400">
                    <span>
                      Último disparo:{" "}
                      {source.lastReceivedAt ? new Date(source.lastReceivedAt).toLocaleString("pt-BR") : "Nenhum"}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => rotateTokenMutation.mutate({ publicId: source.publicId })}
                        className="h-7 text-xs text-slate-500 hover:text-indigo-600"
                      >
                        <RotateCw className="w-3 h-3 mr-1" /> Renovar Token
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteWebhookMutation.mutate({ publicId: source.publicId })}
                        className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 4: Copiloto IA (Gemini) */}
      {activeTab === "ai" && (
        <div className="space-y-6">
          <div className="p-6 rounded-2xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Copiloto Comercial Inteligente (Google Gemini)
                </h3>
              </div>
              <Badge variant="outline" className="text-indigo-600 border-indigo-200">
                Modelo Ativo: {aiSettings?.modelName || "gemini-1.5-flash"}
              </Badge>
            </div>

            <p className="text-xs text-slate-500">
              O Copiloto analisa as interações no WhatsApp e oportunidades do funil para sugerir a próxima melhor ação (Next Best Action) e qualificar automaticamente novos leads.
            </p>

            <div className="space-y-3 pt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Instrução e Tom de Voz do Copiloto (System Prompt)
                </label>
                <textarea
                  rows={3}
                  defaultValue={aiSettings?.systemPrompt || ""}
                  onBlur={(e) => updateAiMutation.mutate({ systemPrompt: e.target.value })}
                  className="w-full text-xs p-3 border rounded-xl bg-slate-50 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Critérios de Qualificação de Leads (BANT & ICP)
                </label>
                <textarea
                  rows={3}
                  defaultValue={aiSettings?.qualificationCriteria || ""}
                  onBlur={(e) => updateAiMutation.mutate({ qualificationCriteria: e.target.value })}
                  className="w-full text-xs p-3 border rounded-xl bg-slate-50 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Interactive AI Suggestion Test */}
          <div className="p-6 rounded-2xl border bg-indigo-50/40 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-800 space-y-4">
            <h4 className="font-bold text-sm text-indigo-900 dark:text-indigo-300 flex items-center gap-2">
              <Bot className="w-4 h-4" /> Testar Sugestão de Próxima Ação em Tempo Real
            </h4>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <select
                id="select-opp-ai"
                className="text-xs px-3 py-2 border rounded-lg bg-white dark:bg-slate-900 dark:text-white flex-1"
              >
                <option value="">Selecione uma oportunidade para testar...</option>
                {oppsData?.opportunities?.map((o) => (
                  <option key={o.publicId} value={o.publicId}>
                    {o.title} ({o.companyName || "Sem cliente"})
                  </option>
                ))}
              </select>

              <Button
                size="sm"
                className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
                disabled={suggestActionMutation.isPending}
                onClick={() => {
                  const select = document.getElementById("select-opp-ai") as HTMLSelectElement;
                  const val = select?.value;
                  if (!val) {
                    toast.error("Selecione uma oportunidade.");
                    return;
                  }
                  suggestActionMutation.mutate({ opportunityPublicId: val });
                }}
              >
                {suggestActionMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                Gerar Sugestão IA
              </Button>
            </div>

            {aiTestResult && (
              <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 text-xs whitespace-pre-wrap leading-relaxed shadow-sm">
                <span className="font-bold text-indigo-700 dark:text-indigo-400 block mb-2">
                  Recomendação do Copiloto Gemini:
                </span>
                {aiTestResult}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Nova Regra de Automação */}
      <Dialog open={ruleModalOpen} onOpenChange={setRuleModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleSaveRule}>
            <DialogHeader>
              <DialogTitle>Nova Regra de Automação</DialogTitle>
              <DialogDescription>
                Configure gatilhos, filtros de condição e ações automáticas para seu processo comercial.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4 text-xs">
              <div>
                <label className="block font-semibold mb-1">Nome da Regra *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Agendar follow-up para leads do site, Notificar vendedor..."
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Gatilho Disparador</label>
                <select
                  value={formTrigger}
                  onChange={(e) => setFormTrigger(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-900 dark:text-white"
                >
                  {Object.entries(TRIGGER_LABELS).map(([key, item]) => (
                    <option key={key} value={key}>
                      {item.icon} {item.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Conditions */}
              <div className="p-3 border rounded-xl bg-slate-50 dark:bg-slate-900 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Condições / Filtros (Opcional)
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={handleAddCondition} className="h-6 text-[11px]">
                    + Adicionar Condição
                  </Button>
                </div>

                {formConditions.length === 0 ? (
                  <p className="text-slate-400 text-[11px]">
                    Sem condições adicionais (a regra disparará para todos os eventos desse gatilho).
                  </p>
                ) : (
                  formConditions.map((cond, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Campo (ex: origin, city, value)"
                        value={cond.field}
                        onChange={(e) => {
                          const copy = [...formConditions];
                          copy[idx].field = e.target.value;
                          setFormConditions(copy);
                        }}
                        className="flex-1 px-2 py-1 border rounded bg-white dark:bg-slate-900 text-xs"
                      />
                      <select
                        value={cond.op}
                        onChange={(e) => {
                          const copy = [...formConditions];
                          copy[idx].op = e.target.value as any;
                          setFormConditions(copy);
                        }}
                        className="w-24 px-2 py-1 border rounded bg-white dark:bg-slate-900 text-xs"
                      >
                        <option value="eq">Igual a</option>
                        <option value="neq">Diferente de</option>
                        <option value="contains">Contém</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Valor esperado"
                        value={cond.value}
                        onChange={(e) => {
                          const copy = [...formConditions];
                          copy[idx].value = e.target.value;
                          setFormConditions(copy);
                        }}
                        className="flex-1 px-2 py-1 border rounded bg-white dark:bg-slate-900 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveCondition(idx)}
                        className="text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Actions */}
              <div className="p-3 border rounded-xl bg-slate-50 dark:bg-slate-900 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Ações a Executar *
                  </span>
                  <div className="flex items-center gap-1">
                    <select
                      id="action-add-select"
                      className="text-xs border rounded px-2 py-1 bg-white dark:bg-slate-800"
                    >
                      <option value="create_task">Criar Tarefa</option>
                      <option value="assign_owner">Atribuir Responsável</option>
                      <option value="add_tag">Adicionar Tag</option>
                      <option value="send_whatsapp">Enviar WhatsApp</option>
                      <option value="ai_qualify">Qualificar com IA</option>
                      <option value="call_webhook">Chamar Webhook</option>
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        const sel = document.getElementById("action-add-select") as HTMLSelectElement;
                        if (sel) handleAddAction(sel.value);
                      }}
                      className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                      + Adicionar
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  {formActions.map((act, idx) => {
                    const actConf = ACTION_LABELS[act.type] || { label: act.type, icon: "⚡" };
                    return (
                      <div key={idx} className="p-3 rounded-lg border bg-white dark:bg-slate-800 flex items-start justify-between gap-3">
                        <div className="flex-1 space-y-2">
                          <span className="font-semibold text-slate-800 dark:text-white flex items-center gap-1.5">
                            <span>{actConf.icon}</span> {actConf.label}
                          </span>

                          {act.type === "create_task" && (
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                type="text"
                                placeholder="Título da tarefa..."
                                value={act.config.title || ""}
                                onChange={(e) => {
                                  const copy = [...formActions];
                                  copy[idx].config.title = e.target.value;
                                  setFormActions(copy);
                                }}
                                className="px-2 py-1 border rounded text-xs"
                              />
                              <input
                                type="number"
                                placeholder="Prazo em horas..."
                                value={act.config.dueHours || 24}
                                onChange={(e) => {
                                  const copy = [...formActions];
                                  copy[idx].config.dueHours = Number(e.target.value);
                                  setFormActions(copy);
                                }}
                                className="px-2 py-1 border rounded text-xs"
                              />
                            </div>
                          )}

                          {act.type === "assign_owner" && (
                            <input
                              type="text"
                              placeholder="Nome do operador / vendedor..."
                              value={act.config.owner || ""}
                              onChange={(e) => {
                                const copy = [...formActions];
                                copy[idx].config.owner = e.target.value;
                                setFormActions(copy);
                              }}
                              className="w-full px-2 py-1 border rounded text-xs"
                            />
                          )}

                          {act.type === "add_tag" && (
                            <input
                              type="text"
                              placeholder="Nome da tag..."
                              value={act.config.tag || ""}
                              onChange={(e) => {
                                const copy = [...formActions];
                                copy[idx].config.tag = e.target.value;
                                setFormActions(copy);
                              }}
                              className="w-full px-2 py-1 border rounded text-xs"
                            />
                          )}

                          {act.type === "send_whatsapp" && (
                            <textarea
                              rows={2}
                              placeholder="Template da mensagem (suporta {company_name})..."
                              value={act.config.message || ""}
                              onChange={(e) => {
                                const copy = [...formActions];
                                copy[idx].config.message = e.target.value;
                                setFormActions(copy);
                              }}
                              className="w-full px-2 py-1 border rounded text-xs"
                            />
                          )}

                          {act.type === "call_webhook" && (
                            <input
                              type="url"
                              placeholder="https://..."
                              value={act.config.url || ""}
                              onChange={(e) => {
                                const copy = [...formActions];
                                copy[idx].config.url = e.target.value;
                                setFormActions(copy);
                              }}
                              className="w-full px-2 py-1 border rounded text-xs"
                            />
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveAction(idx)}
                          className="text-slate-400 hover:text-rose-600 mt-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeRuleModal}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createRuleMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700">
                {createRuleMutation.isPending && <RefreshCw className="w-4 h-4 animate-spin mr-1" />}
                Salvar Regra
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Testar Regra */}
      <Dialog open={testModalOpen} onOpenChange={setTestModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Testar Regra: {testRule?.name}</DialogTitle>
            <DialogDescription>
              Envie um payload de teste para validar condições e execução das ações com rastreamento completo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-3 text-xs">
            <label className="block font-semibold">Payload do Evento (JSON)</label>
            <textarea
              rows={8}
              value={testPayload}
              onChange={(e) => setTestPayload(e.target.value)}
              className="w-full p-2.5 font-mono text-xs border rounded-lg bg-slate-50 dark:bg-slate-900"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTestModalOpen(false)}>
              Fechar
            </Button>
            <Button
              disabled={testRuleMutation.isPending}
              onClick={() => {
                try {
                  const parsed = JSON.parse(testPayload);
                  testRuleMutation.mutate({ publicId: testRule.publicId, mockPayload: parsed });
                } catch {
                  toast.error("JSON inválido.");
                }
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {testRuleMutation.isPending && <RefreshCw className="w-4 h-4 animate-spin mr-1" />}
              Executar Teste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Novo Webhook */}
      <Dialog open={webhookModalOpen} onOpenChange={setWebhookModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Webhook de Entrada</DialogTitle>
            <DialogDescription>
              Crie um endpoint seguro para receber formulários de captura de leads e páginas de conversão.
            </DialogDescription>
          </DialogHeader>

          <div className="py-3 text-xs space-y-3">
            <label className="block font-semibold">Nome da Origem *</label>
            <input
              type="text"
              required
              placeholder="Ex: Landing Page Campanha X, Formulário de Contato Site..."
              value={webhookName}
              onChange={(e) => setWebhookName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-900 dark:text-white"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWebhookModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={createWebhookMutation.isPending || !webhookName.trim()}
              onClick={() => createWebhookMutation.mutate({ name: webhookName.trim() })}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Criar Webhook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Detalhes do Log */}
      <Dialog open={!!selectedRun} onOpenChange={() => setSelectedRun(null)}>
        <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Log de Execução: {selectedRun?.ruleName}</DialogTitle>
            <DialogDescription>
              Status: <strong>{selectedRun?.status}</strong> • Duração: {selectedRun?.durationMs}ms
            </DialogDescription>
          </DialogHeader>

          <div className="py-3 text-xs space-y-3">
            <div>
              <span className="font-semibold block mb-1">Payload Recebido:</span>
              <pre className="p-3 bg-slate-50 dark:bg-slate-900 border rounded-lg overflow-x-auto">
                {JSON.stringify(selectedRun?.triggerPayload, null, 2)}
              </pre>
            </div>

            <div>
              <span className="font-semibold block mb-1">Resultados das Ações:</span>
              <pre className="p-3 bg-slate-50 dark:bg-slate-900 border rounded-lg overflow-x-auto">
                {JSON.stringify(selectedRun?.results, null, 2)}
              </pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
