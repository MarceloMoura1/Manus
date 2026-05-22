/**
 * Dashboard de Monitoramento de Sessões Evolution API
 * Exibe status de conexão, métricas e ações para cada cliente
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { AlertCircle, CheckCircle2, Wifi, WifiOff, RefreshCw, Trash2 } from "lucide-react";

interface SessionStatus {
  clientId: string;
  status: "connected" | "disconnected" | "connecting";
  phoneNumber?: string;
  instanceId?: string;
  webhookStatus: "active" | "inactive" | "unknown";
  lastMessageSent?: Date;
  lastMessageReceived?: Date;
  failedMessagesCount: number;
  successRate: number;
}

export function EvolutionDashboard() {
  const [sessions, setSessions] = useState<SessionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
    const interval = setInterval(loadSessions, 30000); // Atualizar a cada 30 segundos
    return () => clearInterval(interval);
  }, []);

  async function loadSessions() {
    try {
      setLoading(true);
      // TODO: Implementar chamada tRPC para obter sessões
      // const sessions = await trpc.evolution.listSessions.query();
      // setSessions(sessions);

      // Mock data para demonstração
      setSessions([
        {
          clientId: "client-001",
          status: "connected",
          phoneNumber: "+55 41 99548-4515",
          instanceId: "instance-xyz",
          webhookStatus: "active",
          lastMessageSent: new Date(Date.now() - 5 * 60000),
          lastMessageReceived: new Date(Date.now() - 10 * 60000),
          failedMessagesCount: 2,
          successRate: 98.5,
        },
        {
          clientId: "client-002",
          status: "disconnected",
          webhookStatus: "inactive",
          failedMessagesCount: 15,
          successRate: 0,
        },
        {
          clientId: "client-003",
          status: "connecting",
          webhookStatus: "unknown",
          failedMessagesCount: 0,
          successRate: 0,
        },
      ]);
    } catch (error) {
      console.error("Erro ao carregar sessões:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadSessions();
    setRefreshing(false);
  }

  async function handleReconnect(clientId: string) {
    try {
      // TODO: Implementar chamada tRPC para reconectar
      // await trpc.evolution.startSession.mutate({ clientId });
      alert(`Reconectando ${clientId}...`);
    } catch (error) {
      console.error("Erro ao reconectar:", error);
    }
  }

  async function handleDisconnect(clientId: string) {
    if (!window.confirm(`Desconectar ${clientId}?`)) return;

    try {
      // TODO: Implementar chamada tRPC para desconectar
      // await trpc.evolution.disconnect.mutate({ clientId });
      alert(`Desconectando ${clientId}...`);
    } catch (error) {
      console.error("Erro ao desconectar:", error);
    }
  }

  async function handleTestWebhook(clientId: string) {
    try {
      // TODO: Implementar teste de webhook
      alert(`Testando webhook para ${clientId}...`);
    } catch (error) {
      console.error("Erro ao testar webhook:", error);
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "connected":
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "disconnected":
        return <WifiOff className="w-5 h-5 text-red-500" />;
      case "connecting":
        return <Spinner className="w-5 h-5 text-yellow-500" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "connected":
        return <Badge className="bg-green-100 text-green-800">Conectado</Badge>;
      case "disconnected":
        return <Badge className="bg-red-100 text-red-800">Desconectado</Badge>;
      case "connecting":
        return <Badge className="bg-yellow-100 text-yellow-800">Conectando</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">Desconhecido</Badge>;
    }
  };

  const getWebhookBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-100 text-green-800">Ativo</Badge>;
      case "inactive":
        return <Badge className="bg-red-100 text-red-800">Inativo</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">Desconhecido</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard Evolution API</h1>
          <p className="text-gray-600 mt-1">Monitoramento de sessões WhatsApp em tempo real</p>
        </div>
        <Button
          onClick={handleRefresh}
          disabled={refreshing}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Resumo Geral */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total de Clientes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sessions.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Conectados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {sessions.filter((s) => s.status === "connected").length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Desconectados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {sessions.filter((s) => s.status === "disconnected").length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Mensagens Falhadas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {sessions.reduce((sum, s) => sum + s.failedMessagesCount, 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lista de Sessões */}
      <div className="space-y-4">
        {sessions.map((session) => (
          <Card
            key={session.clientId}
            className={`cursor-pointer transition-colors ${
              selectedClient === session.clientId ? "ring-2 ring-blue-500" : ""
            }`}
            onClick={() => setSelectedClient(selectedClient === session.clientId ? null : session.clientId)}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getStatusIcon(session.status)}
                  <div>
                    <CardTitle className="text-lg">{session.clientId}</CardTitle>
                    <CardDescription>
                      {session.phoneNumber || "Sem número conectado"}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(session.status)}
                  {getWebhookBadge(session.webhookStatus)}
                </div>
              </div>
            </CardHeader>

            {selectedClient === session.clientId && (
              <CardContent className="space-y-4">
                {/* Informações Detalhadas */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Instance ID</p>
                    <p className="font-mono text-xs">
                      {session.instanceId?.substring(0, 16) || "N/A"}...
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Taxa de Sucesso</p>
                    <p className="font-bold text-green-600">{session.successRate.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Mensagens Falhadas</p>
                    <p className="font-bold text-yellow-600">{session.failedMessagesCount}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Última Mensagem</p>
                    <p className="text-xs">
                      {session.lastMessageSent
                        ? new Date(session.lastMessageSent).toLocaleTimeString("pt-BR")
                        : "N/A"}
                    </p>
                  </div>
                </div>

                {/* Ações */}
                <div className="flex gap-2 pt-4 border-t">
                  {session.status === "connected" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTestWebhook(session.clientId);
                        }}
                      >
                        Testar Webhook
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDisconnect(session.clientId);
                        }}
                      >
                        <WifiOff className="w-4 h-4 mr-1" />
                        Desconectar
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReconnect(session.clientId);
                      }}
                    >
                      <Wifi className="w-4 h-4 mr-1" />
                      Reconectar
                    </Button>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {sessions.length === 0 && (
        <Card>
          <CardContent className="text-center py-8">
            <AlertCircle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-600">Nenhuma sessão encontrada</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
