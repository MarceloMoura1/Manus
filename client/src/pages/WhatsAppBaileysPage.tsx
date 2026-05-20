/**
 * WhatsAppBaileysPage — Conexão WhatsApp via Baileys (QR Code)
 * Permite conectar WhatsApp Web escaneando um QR code
 */
import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Smartphone,
  QrCode,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  LogOut,
  Copy,
  Loader,
} from "lucide-react";
import { toast } from "sonner";

type SessionStatus = "disconnected" | "connecting" | "qr_ready" | "connected";

interface SessionState {
  status: SessionStatus;
  qrDataUrl?: string;
  phoneNumber?: string;
  connectedAt?: number;
}

export function WhatsAppBaileysPage() {
  const [clientId, setClientId] = React.useState<string>("");

  React.useEffect(() => {
    try {
      const session = JSON.parse(localStorage.getItem("megadesk_session_v1") || "{}");
      setClientId(session?.clientId ?? "");
    } catch (err) {
      console.error("Erro ao ler sessão:", err);
    }
  }, []);

  const [sessionState, setSessionState] = useState<SessionState>({
    status: "disconnected",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Conectar ao SSE stream
  React.useEffect(() => {
    if (!clientId) return;

    // Buscar status inicial
    fetchStatus();

    // Se estiver conectando ou qr_ready, conectar ao SSE
    if (sessionState.status === "connecting" || sessionState.status === "qr_ready") {
      connectSSE();
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [clientId, sessionState.status]);

  const fetchStatus = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/baileys/status?clientId=${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setSessionState(data);
        setError(null);
      }
    } catch (err) {
      console.error("Erro ao buscar status:", err);
    }
  }, [clientId]);

  const connectSSE = React.useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(`/api/baileys/qr-stream?clientId=${clientId}`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const { event: eventType, data } = JSON.parse(event.data);

        if (eventType === "status") {
          setSessionState(data);
        } else if (eventType === "qr") {
          setSessionState((prev) => ({
            ...prev,
            status: "qr_ready",
            qrDataUrl: data.qrDataUrl,
          }));
        }
      } catch (err) {
        console.error("Erro ao processar SSE:", err);
      }
    };

    eventSource.onerror = () => {
      console.error("SSE connection error");
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [clientId]);

  const handleStart = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/baileys/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao iniciar sessão");
      }

      // Conectar ao SSE após iniciar
      setSessionState({ status: "connecting" });
      setTimeout(() => connectSSE(), 500);
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [clientId, connectSSE]);

  const handleDisconnect = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/baileys/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao desconectar");
      }

      setSessionState({ status: "disconnected" });
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      toast.success("Desconectado com sucesso");
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [clientId]);

  const copyPhoneNumber = React.useCallback(() => {
    if (sessionState.phoneNumber) {
      navigator.clipboard.writeText(`+${sessionState.phoneNumber}`);
      toast.success("Número copiado!");
    }
  }, [sessionState.phoneNumber]);

  const statusConfig = React.useMemo(() => ({
    disconnected: {
      color: "bg-slate-100 text-slate-700",
      label: "Desconectado",
      icon: XCircle,
    },
    connecting: {
      color: "bg-yellow-100 text-yellow-700",
      label: "Conectando...",
      icon: Loader,
    },
    qr_ready: {
      color: "bg-blue-100 text-blue-700",
      label: "Escaneie o QR Code",
      icon: QrCode,
    },
    connected: {
      color: "bg-emerald-100 text-emerald-700",
      label: "Conectado",
      icon: CheckCircle2,
    },
  }), []);

  const config = statusConfig?.[sessionState.status] || statusConfig?.disconnected;
  const StatusIcon = config?.icon || XCircle;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Smartphone className="w-6 h-6 text-emerald-600" />
            Conectar WhatsApp
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Escaneie o QR code com seu WhatsApp para conectar
          </p>
        </div>
      </div>

      {/* Status Card */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${config.color}`}>
              <StatusIcon className="w-5 h-5" />
            </div>
            <div>
              <p className="font-semibold text-slate-900">Status da Conexão</p>
              <Badge className={config.color}>{config.label}</Badge>
            </div>
          </div>

          {sessionState.status === "connected" && (
            <Button
              onClick={handleDisconnect}
              disabled={isLoading}
              variant="outline"
              className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
            >
              <LogOut className="w-4 h-4" />
              Desconectar
            </Button>
          )}
        </div>

        {/* QR Code Display */}
        {sessionState.status === "qr_ready" && sessionState.qrDataUrl && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="bg-white border-2 border-blue-200 rounded-lg p-4">
              <img
                src={sessionState.qrDataUrl}
                alt="QR Code"
                className="w-64 h-64"
              />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-slate-700">
                Abra o WhatsApp no seu celular
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Vá para Configurações → Dispositivos vinculados → Vincular um dispositivo
              </p>
            </div>
            <div className="w-full pt-4 border-t border-slate-200">
              <p className="text-xs text-slate-500 text-center mb-3">
                Não consegue escanear? Tente novamente:
              </p>
              <Button
                onClick={handleStart}
                disabled={isLoading}
                variant="outline"
                className="w-full gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Gerar novo QR Code
              </Button>
            </div>
          </div>
        )}

        {/* Connecting State */}
        {sessionState.status === "connecting" && (
          <div className="flex flex-col items-center gap-4 py-12">
            <div className="animate-spin">
              <Loader className="w-8 h-8 text-blue-600" />
            </div>
            <p className="text-sm text-slate-600">Gerando QR code...</p>
          </div>
        )}

        {/* Connected State */}
        {sessionState.status === "connected" && sessionState.phoneNumber && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-slate-900">Conectado com sucesso!</p>
              <p className="text-sm text-slate-600 mt-2">Número:</p>
              <div className="flex items-center justify-center gap-2 mt-2">
                <code className="bg-slate-100 px-3 py-2 rounded text-sm font-mono text-slate-700">
                  +{sessionState.phoneNumber}
                </code>
                <Button
                  onClick={copyPhoneNumber}
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              {sessionState.connectedAt && (
                <p className="text-xs text-slate-500 mt-3">
                  Conectado em {new Date(sessionState.connectedAt).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Disconnected State */}
        {sessionState.status === "disconnected" && (
          <div className="flex flex-col items-center gap-4 py-12">
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
              <Smartphone className="w-8 h-8 text-slate-400" />
            </div>
            <p className="text-sm text-slate-600">Nenhuma conexão ativa</p>
            <Button
              onClick={handleStart}
              disabled={isLoading}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isLoading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Iniciando...
                </>
              ) : (
                <>
                  <QrCode className="w-4 h-4" />
                  Iniciar Conexão
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-900">Erro</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Info Box */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-blue-900">Como funciona</p>
          <ul className="text-sm text-blue-700 mt-2 space-y-1 list-disc list-inside">
            <li>Clique em "Iniciar Conexão" para gerar um QR code</li>
            <li>Abra o WhatsApp no seu celular</li>
            <li>Vá para Configurações → Dispositivos vinculados</li>
            <li>Escaneie o QR code com a câmera do seu celular</li>
            <li>Aguarde a confirmação de conexão</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
