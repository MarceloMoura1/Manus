import { useState, useRef, useEffect } from "react";
import {
  Bot,
  Send,
  Trash2,
  RefreshCw,
  Server,
  Activity,
  ShieldCheck,
  Cpu,
  Sparkles,
  Terminal,
  Database,
  Radio,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Zap,
  CornerDownLeft,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

function cn(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

interface HermesOfficePageProps {
  adminUser: {
    id?: number | string;
    name?: string | null;
    email?: string | null;
    openId?: string | null;
  };
}

// Formatador leve e seguro para respostas Markdown do Hermes
function FormattedMessage({ text }: { text: string }) {
  const lines = text.split("\n");

  return (
    <div className="space-y-2 text-sm leading-relaxed text-slate-200">
      {lines.map((line, idx) => {
        const trimmed = line.trim();

        // Linha em branco
        if (!trimmed) {
          return <div key={idx} className="h-1" />;
        }

        // Título H3 / H4
        if (trimmed.startsWith("### ")) {
          return (
            <h4
              key={idx}
              className="text-base font-semibold text-emerald-300 mt-2 mb-1 flex items-center gap-1.5"
            >
              {renderInlineStyles(trimmed.slice(4))}
            </h4>
          );
        }

        // Título H2
        if (trimmed.startsWith("## ")) {
          return (
            <h3
              key={idx}
              className="text-lg font-bold text-cyan-300 mt-3 mb-1 border-b border-white/10 pb-1"
            >
              {renderInlineStyles(trimmed.slice(3))}
            </h3>
          );
        }

        // Lista com bullet
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-2">
              <span className="text-emerald-400 mt-1.5 block h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span>{renderInlineStyles(trimmed.slice(2))}</span>
            </div>
          );
        }

        // Lista numerada
        if (/^\d+\.\s/.test(trimmed)) {
          const match = trimmed.match(/^(\d+\.)\s(.*)$/);
          if (match) {
            return (
              <div key={idx} className="flex items-start gap-2 pl-2">
                <span className="text-cyan-400 font-mono text-xs mt-0.5 shrink-0">
                  {match[1]}
                </span>
                <span>{renderInlineStyles(match[2])}</span>
              </div>
            );
          }
        }

        // Bloco de citação
        if (trimmed.startsWith("> ")) {
          return (
            <blockquote
              key={idx}
              className="border-l-2 border-emerald-400/60 bg-emerald-400/5 px-3 py-1.5 rounded-r-lg text-slate-300 italic text-xs"
            >
              {renderInlineStyles(trimmed.slice(2))}
            </blockquote>
          );
        }

        // Parágrafo comum
        return <p key={idx}>{renderInlineStyles(line)}</p>;
      })}
    </div>
  );
}

function renderInlineStyles(text: string) {
  // Trata `code`, **bold**, *italic*
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);

  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-slate-800/90 border border-white/10 px-1.5 py-0.5 font-mono text-xs text-cyan-200"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <em key={i} className="text-slate-300 italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}

const QUICK_ACTIONS = [
  { label: "🏥 Vistoria da VPS", prompt: "Faça uma vistoria completa da VPS e dos containers da plataforma." },
  { label: "📊 Consumo de Tokens", prompt: "Qual é o status do consumo de tokens e cotas de IA dos clientes?" },
  { label: "🛡️ Auditoria de Segurança", prompt: "Execute uma auditoria de isolamento multi-tenant e segurança." },
  { label: "🚀 Status Geral", prompt: "Apresente o resumo operacional da infraestrutura e serviços ativos." },
];

export function HermesOfficePage({ adminUser }: HermesOfficePageProps) {
  const [inputMessage, setInputMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const adminIdentifier =
    adminUser.email || adminUser.name || (adminUser.id ? `Admin #${adminUser.id}` : "Administrador");

  // Queries e Mutações tRPC no namespace trpc.admin.hermes.*
  const historyQuery = trpc.admin.hermes.getHistory.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  });

  const statsQuery = trpc.admin.hermes.getQuickStats.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const utils = trpc.useUtils();

  const sendMessageMutation = trpc.admin.hermes.sendMessage.useMutation({
    onSuccess(data) {
      utils.admin.hermes.getHistory.setData(undefined, {
        adminUserId: data.response.adminUserId,
        messages: data.history,
      });
      scrollToBottom();
    },
    onError(err) {
      toast.error(err.message || "Falha ao enviar mensagem para o Hermes.");
    },
  });

  const clearHistoryMutation = trpc.admin.hermes.clearHistory.useMutation({
    onSuccess(data) {
      toast.success(`Histórico limpo com sucesso (${data.clearedCount} mensagens removidas).`);
      utils.admin.hermes.getHistory.setData(undefined, {
        adminUserId: String(adminUser.email || adminUser.id || ""),
        messages: [],
      });
    },
    onError(err) {
      toast.error(err.message || "Erro ao limpar histórico do Hermes.");
    },
  });

  const messages = historyQuery.data?.messages ?? [];

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages.length]);

  const handleSend = () => {
    const text = inputMessage.trim();
    if (!text || sendMessageMutation.isPending) return;

    setInputMessage("");
    sendMessageMutation.mutate({ message: text });
    inputRef.current?.focus();
  };

  const handleQuickPrompt = (prompt: string) => {
    if (sendMessageMutation.isPending) return;
    sendMessageMutation.mutate({ message: prompt });
  };

  const handleClearHistory = () => {
    if (
      confirm(
        "Deseja realmente limpar toda a sua conversa com o Hermes? Esta ação afeta apenas a sua sessão privada de administrador."
      )
    ) {
      clearHistoryMutation.mutate();
    }
  };

  const stats = statsQuery.data;

  return (
    <div className="space-y-6">
      {/* ─── Header Principal do Escritório ──────────────────────────────────── */}
      <header className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/80 p-6 shadow-2xl backdrop-blur-xl">
        <div className="absolute right-0 top-0 -mr-20 -mt-20 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="absolute left-1/3 bottom-0 -mb-24 h-48 w-48 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />

        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 via-cyan-400 to-blue-500 text-slate-950 shadow-lg shadow-emerald-950/40 ring-1 ring-white/20">
              <Bot className="h-8 w-8" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  Escritório do Hermes
                </h1>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-0.5 text-xs font-semibold text-emerald-300">
                  <Sparkles className="h-3 w-3" /> Central de Inteligência & Operações
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-400">
                Sala de comando executivo dos sócios fundadores. Gestão estratégica, vistoria de VPS e IA.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[.04] px-4 py-2.5 backdrop-blur">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <div className="text-left">
                <span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                  Sessão Exclusiva
                </span>
                <span className="block text-xs font-medium text-white max-w-[200px] truncate" title={adminIdentifier}>
                  {adminIdentifier}
                </span>
              </div>
            </div>

            <button
              onClick={handleClearHistory}
              disabled={clearHistoryMutation.isPending || messages.length === 0}
              title="Limpar mensagens desta sessão privada"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-2.5 text-xs font-medium text-slate-300 hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="h-4 w-4" />
              Limpar Conversa
            </button>
          </div>
        </div>
      </header>

      {/* ─── Grid de 2 Colunas: Mesa de Trabalho (Chat) e Quadro de Vistoria ─── */}
      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        {/* ─── Coluna Esquerda: Mesa de Trabalho (Chat) ────────────────────── */}
        <section className="flex flex-col rounded-[2rem] border border-white/10 bg-slate-950/70 shadow-2xl backdrop-blur-xl h-[680px]">
          {/* Topo do Chat */}
          <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
            <div className="flex items-center gap-2.5">
              <div className="rounded-xl bg-emerald-400/10 p-2 text-emerald-300 ring-1 ring-emerald-400/20">
                <Terminal className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">Mesa de Trabalho</h2>
                <span className="text-xs text-slate-400">
                  Canal criptografado e isolado de conversação
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Radio className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
              Hermes Online
            </div>
          </div>

          {/* Histórico com Scroll Automático */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {historyQuery.isLoading && (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-slate-400 text-sm">
                <RefreshCw className="h-6 w-6 animate-spin text-emerald-400" />
                Carregando histórico privado do Hermes...
              </div>
            )}

            {!historyQuery.isLoading && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-64 text-center max-w-md mx-auto">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[.03] border border-white/10 text-emerald-300 mb-3">
                  <Bot className="h-7 w-7" />
                </div>
                <h3 className="text-base font-semibold text-white">
                  Pronto para as ordens, {adminUser.name || "Sócio"}.
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  Este é o seu canal direto e particular com o Hermes. As mensagens registradas aqui pertencem
                  exclusivamente à sua conta de administrador. Escolha um atalho abaixo ou digite sua solicitação.
                </p>
              </div>
            )}

            {messages.map((msg) => {
              const isUser = msg.role === "user";
              return (
                <div
                  key={msg.id}
                  className={cn("flex flex-col", isUser ? "items-end" : "items-start")}
                >
                  <div className="flex items-center gap-2 mb-1 px-1 text-[11px] text-slate-500">
                    <span>{isUser ? "Você" : "Hermes"}</span>
                    <span>•</span>
                    <span>
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl p-4 shadow-lg text-sm",
                      isUser
                        ? "bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-400/40 text-slate-100 rounded-tr-none"
                        : "bg-slate-900/90 border border-white/10 text-slate-200 rounded-tl-none"
                    )}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <FormattedMessage text={msg.content} />
                    )}

                    {!isUser && Boolean(msg.metadataJson?.source) && (
                      <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-500">
                        <span>Modelo: {String(msg.metadataJson?.model || "Hermes Core")}</span>
                        <span>
                          {msg.metadataJson?.source === "gemini_api" ? "⚡ Gemini Live" : "🛡️ Local Standby"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {sendMessageMutation.isPending && (
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-2 mb-1 px-1 text-[11px] text-slate-500">
                  <span>Hermes</span>
                  <span>•</span>
                  <span>Analisando</span>
                </div>
                <div className="rounded-2xl rounded-tl-none bg-slate-900/90 border border-emerald-400/30 p-4 text-sm text-slate-300 flex items-center gap-3">
                  <div className="h-4 w-4 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                  <span className="text-xs text-emerald-300 animate-pulse">
                    Hermes está analisando e sintetizando sua resposta...
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Atalhos Rápidos e Campo de Input */}
          <div className="border-t border-white/10 p-4 bg-slate-950/90 rounded-b-[2rem] space-y-3">
            {/* Botões de Atalho */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
              <span className="text-[11px] text-slate-500 shrink-0 font-medium flex items-center gap-1">
                <Zap className="h-3 w-3 text-emerald-400" /> Ações rápidas:
              </span>
              {QUICK_ACTIONS.map((action, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={sendMessageMutation.isPending}
                  onClick={() => handleQuickPrompt(action.prompt)}
                  className="shrink-0 rounded-xl border border-white/10 bg-white/[.02] px-3 py-1.5 text-slate-300 hover:border-emerald-400/50 hover:bg-emerald-400/10 hover:text-white transition disabled:opacity-40"
                >
                  {action.label}
                </button>
              ))}
            </div>

            {/* Input com Textarea e Botão Enviar */}
            <div className="relative flex items-end gap-2 rounded-2xl border border-white/10 bg-slate-900/80 p-2 focus-within:border-emerald-400/60 focus-within:ring-2 focus-within:ring-emerald-400/20 transition">
              <textarea
                ref={inputRef}
                rows={2}
                value={inputMessage}
                disabled={sendMessageMutation.isPending}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Instrua o Hermes ou faça uma pergunta sobre a plataforma (Shift+Enter para nova linha)..."
                className="flex-1 bg-transparent px-3 py-1.5 text-sm text-white placeholder-slate-500 outline-none resize-none"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!inputMessage.trim() || sendMessageMutation.isPending}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 hover:scale-105 active:scale-95 transition disabled:opacity-30 disabled:scale-100 disabled:cursor-not-allowed"
                title="Enviar instrução"
              >
                {sendMessageMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </section>

        {/* ─── Coluna Direita: Quadro de Vistoria & Habilidades ──────────────── */}
        <section className="space-y-6">
          {/* Card: Quadro de Vistoria */}
          <div className="rounded-[2rem] border border-white/10 bg-slate-950/70 p-6 shadow-2xl backdrop-blur-xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-xl bg-cyan-400/10 p-2 text-cyan-300 ring-1 ring-cyan-400/20">
                  <Server className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Quadro de Vistoria</h3>
                  <span className="text-[11px] text-slate-400">Telemetria de infraestrutura VPS</span>
                </div>
              </div>
              <button
                onClick={() => statsQuery.refetch()}
                disabled={statsQuery.isFetching}
                title="Atualizar métricas agora"
                className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
              >
                <RefreshCw className={cn("h-4 w-4", statsQuery.isFetching && "animate-spin")} />
              </button>
            </div>

            {/* Métricas do Processo / VPS */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[.02] p-3">
                <span className="block text-[11px] text-slate-400 flex items-center gap-1">
                  <Clock className="h-3 w-3 text-cyan-400" /> Uptime
                </span>
                <strong className="mt-1 block text-base font-semibold text-white">
                  {stats?.uptimeFormatted || "Calculando..."}
                </strong>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[.02] p-3">
                <span className="block text-[11px] text-slate-400 flex items-center gap-1">
                  <Cpu className="h-3 w-3 text-emerald-400" /> Memória RSS
                </span>
                <strong className="mt-1 block text-base font-semibold text-white">
                  {stats ? `${stats.memoryUsageMb} MB` : "..."}
                </strong>
              </div>
            </div>

            {/* Status dos Serviços */}
            <div className="space-y-2 pt-1">
              <span className="text-xs font-medium text-slate-400">Serviços e Containers:</span>
              <div className="space-y-2">
                {(stats?.services ?? []).map((srv) => {
                  const isOnline = srv.status === "online";
                  return (
                    <div
                      key={srv.key}
                      className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-900/60 px-3 py-2 text-xs"
                    >
                      <div>
                        <strong className="block text-slate-200">{srv.name}</strong>
                        <span className="text-[11px] text-slate-400">{srv.details}</span>
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border",
                          isOnline
                            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                            : "border-amber-400/30 bg-amber-400/10 text-amber-200"
                        )}
                      >
                        {isOnline ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <AlertTriangle className="h-3 w-3" />
                        )}
                        {isOnline ? "Online" : "Atenção"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Card: Caixa de Habilidades (Skills) */}
          <div className="rounded-[2rem] border border-white/10 bg-slate-950/70 p-6 shadow-2xl backdrop-blur-xl space-y-4">
            <div className="flex items-center gap-2 border-b border-white/10 pb-3">
              <div className="rounded-xl bg-emerald-400/10 p-2 text-emerald-300 ring-1 ring-emerald-400/20">
                <Activity className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Caixa de Habilidades</h3>
                <span className="text-[11px] text-slate-400">Atribuições operacionais do Hermes</span>
              </div>
            </div>

            <div className="space-y-3">
              {(stats?.skills ?? []).map((skill, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-white/5 bg-white/[.02] p-3 text-xs space-y-1.5 transition hover:border-emerald-400/30"
                >
                  <div className="flex items-center justify-between">
                    <strong className="text-slate-100 font-medium">{skill.name}</strong>
                    <span className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300">
                      {skill.category}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-400">
                    {skill.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default HermesOfficePage;
