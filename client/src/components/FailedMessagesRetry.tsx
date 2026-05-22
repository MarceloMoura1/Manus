import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { AlertCircle, RotateCw, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface FailedMessage {
  id: string;
  phone: string;
  messageText: string;
  errorType?: string;
  errorMessage?: string;
  retryCount: number;
  maxRetries: number;
  status: "pending" | "retrying" | "completed" | "failed";
  createdAt: Date;
  lastRetryAt?: Date;
}

export function FailedMessagesRetry() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<FailedMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const { data: pendingData } = trpc.retry.getPendingCount.useQuery(undefined, {
    refetchInterval: 10000, // Atualizar a cada 10 segundos
  });

  const { data: messagesData } = trpc.retry.getFailedMessages.useQuery(undefined, {
    enabled: open, // Só buscar quando o dialog estiver aberto
  });

  const retryAllMutation = trpc.retry.retryAll.useMutation({
    onSuccess: (data: any) => {
      toast.success(data.message);
      setIsRetrying(false);
      // Refetch messages
      void messagesData;
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao reenviar mensagens");
      setIsRetrying(false);
    },
  });

  const retryOneMutation = trpc.retry.retryOne.useMutation({
    onSuccess: (data: any) => {
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao reenviar mensagem");
    },
  });

  useEffect(() => {
    if (messagesData?.messages) {
      setMessages(messagesData.messages);
    }
  }, [messagesData]);

  const handleRetryAll = async () => {
    setIsRetrying(true);
    await retryAllMutation.mutateAsync();
  };

  const handleRetryOne = async (messageId: string) => {
    await retryOneMutation.mutateAsync({ messageId });
  };

  const pendingCount = pendingData?.count || 0;

  if (pendingCount === 0) {
    return null;
  }

  return (
    <>
      {/* Badge/Button para abrir o dialog */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="relative"
      >
        <AlertCircle className="w-4 h-4 mr-2 text-red-500" />
        {pendingCount} Mensagem{pendingCount !== 1 ? "s" : ""} Falhada{pendingCount !== 1 ? "s" : ""}
      </Button>

      {/* Dialog com lista de mensagens falhadas */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mensagens Falhadas</DialogTitle>
            <DialogDescription>
              {messages.length} mensagem{messages.length !== 1 ? "s" : ""} aguardando reenvio
            </DialogDescription>
          </DialogHeader>

          {/* Lista de mensagens */}
          <div className="space-y-4 my-4">
            {messages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Nenhuma mensagem falhada pendente
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className="border rounded-lg p-4 space-y-2 bg-red-50 border-red-200"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-semibold text-sm">Para: {msg.phone}</p>
                      <p className="text-sm text-muted-foreground mt-1">{msg.messageText}</p>
                      {msg.errorMessage && (
                        <p className="text-xs text-red-600 mt-2">
                          Erro: {msg.errorMessage}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        Tentativas: {msg.retryCount}/{msg.maxRetries}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRetryOne(msg.id)}
                      disabled={msg.retryCount >= msg.maxRetries}
                      className="ml-2"
                    >
                      <RotateCw className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Botão de reenvio em massa */}
          <div className="flex gap-2 justify-end mt-6">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Fechar
            </Button>
            <Button
              onClick={handleRetryAll}
              disabled={isRetrying || messages.length === 0}
              className="gap-2"
            >
              {isRetrying ? (
                <>
                  <Spinner className="w-4 h-4" />
                  Reenviando...
                </>
              ) : (
                <>
                  <RotateCw className="w-4 h-4" />
                  Reenviar Tudo
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
