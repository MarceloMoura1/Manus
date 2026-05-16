import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { AlertCircle, Send } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export default function AssistentIA() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Olá! Como posso te ajudar hoje? 👋",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Queries e mutations
  const quotaQuery = trpc.gemini.getQuotaInfo.useQuery();
  const sendMessageMutation = trpc.gemini.sendMessage.useMutation();
  const historyQuery = trpc.gemini.getHistory.useQuery();

  // Auto-scroll para o final das mensagens
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Carregar histórico ao montar
  useEffect(() => {
    if (historyQuery.data?.messages) {
      const loadedMessages = historyQuery.data.messages.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
        timestamp: new Date(),
      }));
      if (loadedMessages.length > 0) {
        setMessages(loadedMessages);
      }
    }
  }, [historyQuery.data]);

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;

    // Adicionar mensagem do usuário
    const userMessage: Message = {
      role: "user",
      content: inputValue,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    try {
      const response = await sendMessageMutation.mutateAsync({
        message: inputValue,
        tipo: "consulta",
      });

      // Adicionar resposta da IA
      const assistantMessage: Message = {
        role: "assistant",
        content: response.response,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      // Recarregar quota
      quotaQuery.refetch();
    } catch (error) {
      console.error("Erro ao enviar mensagem:", error);
      const errorMessage: Message = {
        role: "assistant",
        content: "Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Assistente IA</h1>
            <p className="text-sm text-muted-foreground">Powered by Gemini</p>
          </div>
          {quotaQuery.data && (
            <Card className="p-3 bg-muted">
              <div className="text-sm">
                <p className="text-muted-foreground">Quota Disponível</p>
                <p className="text-lg font-semibold text-foreground">
                  {quotaQuery.data.quotaMode === "free"
                    ? "Ilimitada"
                    : `${quotaQuery.data.disponivel} / ${quotaQuery.data.quotaMensal}`}
                </p>
                {quotaQuery.data.quotaMode !== "free" && (
                  <div className="mt-2 w-full bg-background rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{
                        width: `${Math.min(quotaQuery.data.percentualUsado, 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-xs lg:max-w-md xl:max-w-lg px-4 py-2 rounded-lg ${
                message.role === "user"
                  ? "bg-blue-500 text-white rounded-br-none"
                  : "bg-muted text-foreground rounded-bl-none border border-border"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
              <p
                className={`text-xs mt-1 ${
                  message.role === "user" ? "text-blue-100" : "text-muted-foreground"
                }`}
              >
                {message.timestamp.toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted text-foreground rounded-lg rounded-bl-none px-4 py-2 border border-border">
              <Spinner className="w-5 h-5" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error State */}
      {sendMessageMutation.isError && (
        <div className="px-4 py-2 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-900">Erro ao enviar mensagem</p>
            <p className="text-xs text-red-700">
              {(sendMessageMutation.error as any)?.message || "Tente novamente"}
            </p>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t border-border bg-card p-4">
        <div className="flex gap-2">
          <Input
            placeholder="Digite sua mensagem..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isLoading}
            className="flex-1"
          />
          <Button
            onClick={handleSendMessage}
            disabled={isLoading || !inputValue.trim()}
            className="gap-2"
          >
            {isLoading ? <Spinner className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            Enviar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Pressione Enter para enviar • Shift+Enter para nova linha
        </p>
      </div>
    </div>
  );
}
