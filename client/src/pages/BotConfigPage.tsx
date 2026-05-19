import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { Trash2, Send, Zap } from "lucide-react";

interface BotScript {
  scriptId: string;
  clientId: string;
  name: string;
  description?: string;
  systemPrompt: string;
  initialMessage?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function BotConfigPage() {
  const { user } = useAuth();
  const clientId = user?.clientId;

  // Estados do painel esquerdo (Novo Roteiro)
  const [newScriptName, setNewScriptName] = useState("");
  const [newScriptDescription, setNewScriptDescription] = useState("");
  const [newScriptPrompt, setNewScriptPrompt] = useState("");
  const [newScriptInitialMsg, setNewScriptInitialMsg] = useState("");

  // Estados do painel central (Lista de Roteiros)
  const [scripts, setScripts] = useState<BotScript[]>([]);
  const [selectedScript, setSelectedScript] = useState<BotScript | null>(null);

  // Estados do painel direito (Teste do Roteiro)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Queries e Mutations
  const { data: scriptsList, refetch: refetchScripts } = trpc.botScripts.list.useQuery(
    { clientId: clientId || "" },
    { enabled: !!clientId }
  );

  const createScriptMutation = trpc.botScripts.create.useMutation({
    onSuccess: () => {
      toast.success("Roteiro criado com sucesso!");
      setNewScriptName("");
      setNewScriptDescription("");
      setNewScriptPrompt("");
      setNewScriptInitialMsg("");
      refetchScripts();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao criar roteiro");
    },
  });

  const deleteScriptMutation = trpc.botScripts.delete.useMutation({
    onSuccess: () => {
      toast.success("Roteiro deletado com sucesso!");
      setSelectedScript(null);
      setChatMessages([]);
      refetchScripts();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao deletar roteiro");
    },
  });

  const activateScriptMutation = trpc.botScripts.activate.useMutation({
    onSuccess: () => {
      toast.success("Roteiro ativado!");
      refetchScripts();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao ativar roteiro");
    },
  });

  const deactivateScriptMutation = trpc.botScripts.deactivate.useMutation({
    onSuccess: () => {
      toast.success("Roteiro desativado!");
      refetchScripts();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao desativar roteiro");
    },
  });

  // Atualizar lista de scripts
  useEffect(() => {
    if (scriptsList) {
      setScripts(scriptsList);
    }
  }, [scriptsList]);

  // Auto-scroll para o final do chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Handlers
  const handleCreateScript = async () => {
    if (!clientId || !newScriptName.trim() || !newScriptPrompt.trim()) {
      toast.error("Preencha Nome e System Prompt");
      return;
    }

    await createScriptMutation.mutateAsync({
      clientId,
      name: newScriptName,
      description: newScriptDescription,
      systemPrompt: newScriptPrompt,
      initialMessage: newScriptInitialMsg,
    });
  };

  const handleDeleteScript = async (scriptId: string) => {
    if (!clientId) return;
    if (!confirm("Tem certeza que deseja deletar este roteiro?")) return;

    await deleteScriptMutation.mutateAsync({ clientId, scriptId });
  };

  const handleToggleActive = async (script: BotScript) => {
    if (!clientId) return;

    if (script.isActive) {
      await deactivateScriptMutation.mutateAsync({
        clientId,
        scriptId: script.scriptId,
      });
    } else {
      await activateScriptMutation.mutateAsync({
        clientId,
        scriptId: script.scriptId,
      });
    }
  };

  const handleSelectScript = (script: BotScript) => {
    setSelectedScript(script);
    // Inicializar chat com mensagem inicial do roteiro
    if (script.initialMessage) {
      setChatMessages([
        {
          role: "assistant",
          content: script.initialMessage,
          timestamp: new Date(),
        },
      ]);
    } else {
      setChatMessages([]);
    }
    setChatInput("");
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !selectedScript) return;

    // Adicionar mensagem do usuário
    const userMessage: ChatMessage = {
      role: "user",
      content: chatInput,
      timestamp: new Date(),
    };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setIsLoadingChat(true);

    try {
      // TODO: Integrar com Gemini IA para gerar resposta do bot
      // Por enquanto, simular resposta
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const botMessage: ChatMessage = {
        role: "assistant",
        content: `[Resposta do bot baseada no roteiro: "${selectedScript.name}"] Entendi sua mensagem: "${chatInput}"`,
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, botMessage]);
    } catch (error) {
      toast.error("Erro ao enviar mensagem");
    } finally {
      setIsLoadingChat(false);
    }
  };

  if (!clientId) {
    return <div className="p-8 text-center">Carregando...</div>;
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border p-6">
        <h1 className="text-3xl font-bold text-foreground">Configuração do Bot</h1>
        <p className="text-sm text-muted-foreground mt-1">Crie e teste roteiros de IA</p>
      </div>

      {/* Main Content - 3 Painéis */}
      <div className="flex-1 overflow-hidden flex gap-6 p-6">
        {/* Painel Esquerdo: Novo Roteiro */}
        <div className="w-96 flex-shrink-0 overflow-y-auto">
          <Card className="p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">Novo Roteiro</h2>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">Nome</label>
                <Input
                  placeholder="Ex: Suporte Técnico"
                  value={newScriptName}
                  onChange={(e) => setNewScriptName(e.target.value)}
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Descrição</label>
                <Input
                  placeholder="Descrição do roteiro"
                  value={newScriptDescription}
                  onChange={(e) => setNewScriptDescription(e.target.value)}
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">System Prompt</label>
                <Textarea
                  placeholder="Instruções para o bot IA..."
                  value={newScriptPrompt}
                  onChange={(e) => setNewScriptPrompt(e.target.value)}
                  className="mt-1 min-h-32"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Mensagem Inicial</label>
                <Textarea
                  placeholder="Mensagem de boas-vindas..."
                  value={newScriptInitialMsg}
                  onChange={(e) => setNewScriptInitialMsg(e.target.value)}
                  className="mt-1 min-h-24"
                />
              </div>

              <Button
                onClick={handleCreateScript}
                disabled={createScriptMutation.isPending}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {createScriptMutation.isPending ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4" />
                    Criando...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    Criar
                  </>
                )}
              </Button>
            </div>
          </Card>
        </div>

        {/* Painel Central: Lista de Roteiros */}
        <div className="w-80 flex-shrink-0 overflow-y-auto">
          <Card className="p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">Roteiros</h2>

            <div className="space-y-3">
              {scripts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum roteiro criado</p>
              ) : (
                scripts.map((script) => (
                  <div
                    key={script.scriptId}
                    onClick={() => handleSelectScript(script)}
                    className={`p-4 rounded-lg border cursor-pointer transition-all ${
                      selectedScript?.scriptId === script.scriptId
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                        : "border-border hover:border-blue-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-foreground truncate">{script.name}</h3>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {script.description}
                        </p>
                      </div>
                      {script.isActive && (
                        <Badge className="bg-green-600 text-white flex-shrink-0">Ativo</Badge>
                      )}
                    </div>

                    <div className="flex gap-2 mt-3">
                      <Button
                        size="sm"
                        variant={script.isActive ? "destructive" : "default"}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleActive(script);
                        }}
                        disabled={
                          activateScriptMutation.isPending ||
                          deactivateScriptMutation.isPending
                        }
                      >
                        {script.isActive ? "Desativar" : "Ativar"}
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteScript(script.scriptId);
                        }}
                        disabled={deleteScriptMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        {/* Painel Direito: Teste do Roteiro */}
        <div className="flex-1 flex flex-col min-w-0">
          <Card className="flex-1 flex flex-col p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">Teste do Roteiro</h2>

            {!selectedScript ? (
              <div className="flex-1 flex items-center justify-center text-center">
                <p className="text-muted-foreground">Selecione um roteiro para testar</p>
              </div>
            ) : (
              <>
                {/* Chat Messages */}
                <div className="flex-1 overflow-y-auto mb-4 space-y-3 bg-muted/30 rounded-lg p-4">
                  {chatMessages.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <p>Comece a conversa...</p>
                    </div>
                  ) : (
                    <>
                      {chatMessages.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                              msg.role === "user"
                                ? "bg-blue-600 text-white rounded-br-none"
                                : "bg-background border border-border text-foreground rounded-bl-none"
                            }`}
                          >
                            <p className="text-sm">{msg.content}</p>
                            <p className="text-xs mt-1 opacity-70">
                              {msg.timestamp.toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                        </div>
                      ))}
                      {isLoadingChat && (
                        <div className="flex justify-start">
                          <div className="bg-background border border-border text-foreground px-4 py-2 rounded-lg rounded-bl-none">
                            <Spinner className="h-4 w-4" />
                          </div>
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </>
                  )}
                </div>

                {/* Chat Input */}
                <div className="flex gap-2">
                  <Input
                    placeholder="Digite sua mensagem..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    disabled={isLoadingChat}
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={isLoadingChat || !chatInput.trim()}
                    size="icon"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
