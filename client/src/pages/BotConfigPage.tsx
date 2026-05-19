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
import { useState, useRef, useEffect } from "react";

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

  const testScriptMutation = trpc.botScripts.testScript.useMutation();

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
    await deleteScriptMutation.mutateAsync({ clientId, scriptId });
  };

  const handleActivateScript = async (scriptId: string) => {
    if (!clientId) return;
    await activateScriptMutation.mutateAsync({ clientId, scriptId });
  };

  const handleDeactivateScript = async (scriptId: string) => {
    if (!clientId) return;
    await deactivateScriptMutation.mutateAsync({ clientId, scriptId });
  };

  const handleSelectScript = (script: BotScript) => {
    setSelectedScript(script);
    setChatMessages([]);
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !selectedScript || !clientId) return;

    const userMessageContent = chatInput;
    const userMessage: ChatMessage = {
      role: "user",
      content: userMessageContent,
      timestamp: new Date(),
    };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setIsLoadingChat(true);

    try {
      const response = await testScriptMutation.mutateAsync({
        clientId,
        scriptId: selectedScript.scriptId,
        userMessage: userMessageContent,
        conversationHistory: chatMessages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
      });

      const botMessage: ChatMessage = {
        role: "assistant",
        content: response.botResponse,
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, botMessage]);
    } catch (error) {
      console.error("Erro ao enviar mensagem:", error);
      toast.error("Erro ao gerar resposta do bot");
    } finally {
      setIsLoadingChat(false);
    }
  };

  if (!clientId) {
    return <div className="p-6">Carregando...</div>;
  }

  return (
    <div className="p-6 bg-background min-h-screen">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Configuração do Bot</h1>
        <p className="text-muted-foreground">Crie e teste roteiros de IA</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Painel Esquerdo: Novo Roteiro */}
        <Card className="p-6 border border-border">
          <h2 className="text-xl font-bold mb-4">Novo Roteiro</h2>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Nome</label>
              <Input
                placeholder="Ex: Suporte Técnico"
                value={newScriptName}
                onChange={(e) => setNewScriptName(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Descrição</label>
              <Input
                placeholder="Descrição do roteiro"
                value={newScriptDescription}
                onChange={(e) => setNewScriptDescription(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-medium">System Prompt</label>
              <Textarea
                placeholder="Instruções para o bot..."
                value={newScriptPrompt}
                onChange={(e) => setNewScriptPrompt(e.target.value)}
                className="min-h-[120px]"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Mensagem Inicial</label>
              <Textarea
                placeholder="Mensagem de boas-vindas"
                value={newScriptInitialMsg}
                onChange={(e) => setNewScriptInitialMsg(e.target.value)}
                className="min-h-[80px]"
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

        {/* Painel Central: Lista de Roteiros */}
        <Card className="p-6 border border-border">
          <h2 className="text-xl font-bold mb-4">Roteiros</h2>

          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {scripts.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nenhum roteiro criado</p>
            ) : (
              scripts.map((script) => (
                <div
                  key={script.scriptId}
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedScript?.scriptId === script.scriptId
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                      : "border-border hover:border-blue-300"
                  }`}
                  onClick={() => handleSelectScript(script)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-medium">{script.name}</h3>
                      {script.description && (
                        <p className="text-xs text-muted-foreground mt-1">{script.description}</p>
                      )}
                    </div>
                    <Badge variant={script.isActive ? "default" : "secondary"}>
                      {script.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>

                  <div className="flex gap-2 mt-3">
                    {script.isActive ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeactivateScript(script.scriptId);
                        }}
                      >
                        ✓ Ativar
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleActivateScript(script.scriptId);
                        }}
                      >
                        ✓ Ativar
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteScript(script.scriptId);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Painel Direito: Teste do Roteiro */}
        <Card className="p-6 border border-border flex flex-col">
          <h2 className="text-xl font-bold mb-4">Teste do Roteiro</h2>

          {!selectedScript ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              Selecione um roteiro para testar
            </div>
          ) : (
            <>
              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto mb-4 space-y-3 bg-muted/30 p-4 rounded-lg min-h-[300px]">
                {chatMessages.length === 0 && (
                  <div className="text-center text-muted-foreground text-sm py-8">
                    {selectedScript.initialMessage || "Comece a conversa..."}
                  </div>
                )}

                {chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                        msg.role === "user"
                          ? "bg-blue-600 text-white rounded-br-none"
                          : "bg-gray-200 dark:bg-gray-700 text-foreground rounded-bl-none"
                      }`}
                    >
                      <p className="text-sm">{msg.content}</p>
                      <p className="text-xs opacity-70 mt-1">
                        {msg.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}

                {isLoadingChat && (
                  <div className="flex justify-start">
                    <div className="bg-gray-200 dark:bg-gray-700 px-4 py-2 rounded-lg">
                      <Spinner className="h-4 w-4" />
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              {/* Input Area */}
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
  );
}
