/**
 * WhatsAppConfigPage — Conexão WhatsApp 100% White-Label para o Cliente
 * Interface limpa e unificada para conectar e gerenciar o WhatsApp empresarial.
 */
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Smartphone,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  QrCode,
  Loader2,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export function WhatsAppConfigPage() {
  const session = JSON.parse(localStorage.getItem("megadesk_session_v1") || "{}");
  const clientId: string = session?.tenantId || session?.clientId || "main";

  const [refreshing, setRefreshing] = useState(false);
  const [qrCodeData, setQrCodeData] = useState<{ code?: string; base64: string } | null>(null);

  // Status da conexão
  const { data: status, isLoading, refetch } = trpc.evolution.getStatus.useQuery(
    { clientId },
    { enabled: !!clientId, refetchInterval: 5000 }
  );

  // Mutation para conectar e obter QR Code
  const connectMut = trpc.evolution.connect.useMutation({
    onSuccess: (data: any) => {
      if (data?.qrCode) {
        toast.success("QR Code gerado com sucesso! Escaneie com seu WhatsApp.");
        setQrCodeData({ base64: data.qrCode, code: data.code });
      } else if (data?.status === "connected" || data?.status === "open") {
        toast.info("WhatsApp já está conectado.");
      } else {
        toast.error("Não foi possível obter o QR Code. Tente novamente.");
      }
      refetch();
    },
    onError: (e: any) => toast.error(e?.message || "Erro ao conectar WhatsApp"),
  });

  // Mutation para desconectar
  const disconnectMut = trpc.evolution.disconnect.useMutation({
    onSuccess: () => {
      toast.success("WhatsApp desconectado com sucesso.");
      setQrCodeData(null);
      refetch();
    },
    onError: (e: any) => toast.error(e?.message || "Erro ao desconectar WhatsApp"),
  });

  const isConnected =
    status?.status === "open" ||
    status?.status === "connected" ||
    (status as any)?.state === "open";

  const connectedNumber = (status as any)?.phoneNumber || (status as any)?.phone || null;
  const displayQR = qrCodeData?.base64 || (status as any)?.qrCode;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
            <Smartphone className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              Conexão WhatsApp da Empresa
              <Badge className={isConnected ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"}>
                {isConnected ? "Conectado" : "Desconectado"}
              </Badge>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Canal oficial para atendimento de clientes e envio de mensagens operacionais.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="text-xs cursor-pointer"
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", isLoading && "animate-spin")} />
            Atualizar Status
          </Button>

          {isConnected && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disconnectMut.isPending}
                  className="text-xs text-rose-600 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                >
                  Desconectar WhatsApp
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Desconectar WhatsApp?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação desconectará o número da plataforma. Para reconectar, será necessário escanear um novo QR Code.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => disconnectMut.mutate({ clientId })}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Confirmar Desconexão
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Conteúdo Principal */}
      {isConnected ? (
        <div className="p-8 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-center flex flex-col items-center gap-4">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 dark:text-emerald-400" />
          <div className="space-y-1">
            <h2 className="text-base font-bold text-emerald-950 dark:text-emerald-100">
              WhatsApp Conectado e Operacional
            </h2>
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              {connectedNumber ? `Número vinculado: ${connectedNumber}` : "Sua empresa está pronta para enviar e receber mensagens."}
            </p>
          </div>
          <Badge variant="outline" className="border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 bg-white dark:bg-emerald-950/80 px-3 py-1">
            Pronto para Atendimento
          </Badge>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center flex flex-col items-center justify-center">
          {displayQR ? (
            <div className="flex flex-col items-center gap-4 max-w-sm">
              <div className="p-4 bg-white rounded-2xl shadow-md border border-slate-200">
                <img
                  src={displayQR.startsWith("data:") ? displayQR : `data:image/png;base64,${displayQR}`}
                  alt="QR Code WhatsApp"
                  className="w-56 h-56 object-contain"
                />
              </div>

              <div className="space-y-1 text-center">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Escaneie o QR Code com seu celular</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  1. Abra o WhatsApp no smartphone &gt; Menu &gt; <strong>Aparelhos Conectados</strong><br />
                  2. Toque em <strong>Conectar um aparelho</strong> e aponte para a tela.
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => connectMut.mutate({ clientId })}
                disabled={connectMut.isPending}
                className="mt-2 text-xs cursor-pointer"
              >
                <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", connectMut.isPending && "animate-spin")} />
                Gerar Novo QR Code
              </Button>
            </div>
          ) : (
            <div className="py-8 flex flex-col items-center gap-3 max-w-md">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500">
                <QrCode className="w-7 h-7" />
              </div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">WhatsApp Desconectado</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Gere o QR Code de autenticação para conectar o WhatsApp oficial da sua empresa à plataforma.
              </p>
              <Button
                onClick={() => connectMut.mutate({ clientId })}
                disabled={connectMut.isPending}
                className="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl shadow-xs gap-2 px-5 py-2.5 cursor-pointer"
              >
                {connectMut.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Smartphone className="w-4 h-4" />
                )}
                <span>Conectar WhatsApp</span>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default WhatsAppConfigPage;
