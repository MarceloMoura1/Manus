/**
 * Página de Relatórios de Performance da Evolution API
 * Exibe gráficos, métricas e análises de performance
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Download, TrendingUp, TrendingDown } from "lucide-react";

interface PerformanceMetrics {
  date: string;
  totalSent: number;
  totalFailed: number;
  totalRetried: number;
  successRate: number;
  avgResponseTime: number;
}

interface ClientMetrics {
  clientId: string;
  totalMessages: number;
  successRate: number;
  avgResponseTime: number;
  failedMessages: number;
}

export function EvolutionReports() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("7d");
  const [metrics, setMetrics] = useState<PerformanceMetrics[]>([]);
  const [clientMetrics, setClientMetrics] = useState<ClientMetrics[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
  }, [period]);

  async function loadMetrics() {
    try {
      setLoading(true);
      // TODO: Implementar chamada tRPC para obter métricas
      // const data = await trpc.evolution.getMetrics.query({ period });

      // Mock data para demonstração
      const mockData = [
        { date: "2026-05-15", totalSent: 150, totalFailed: 3, totalRetried: 2, successRate: 98, avgResponseTime: 1200 },
        { date: "2026-05-16", totalSent: 180, totalFailed: 2, totalRetried: 1, successRate: 98.9, avgResponseTime: 1100 },
        { date: "2026-05-17", totalSent: 200, totalFailed: 4, totalRetried: 3, successRate: 98, avgResponseTime: 1300 },
        { date: "2026-05-18", totalSent: 220, totalFailed: 2, totalRetried: 1, successRate: 99.1, avgResponseTime: 1050 },
        { date: "2026-05-19", totalSent: 190, totalFailed: 5, totalRetried: 2, successRate: 97.4, avgResponseTime: 1400 },
        { date: "2026-05-20", totalSent: 210, totalFailed: 1, totalRetried: 0, successRate: 99.5, avgResponseTime: 950 },
        { date: "2026-05-22", totalSent: 250, totalFailed: 2, totalRetried: 1, successRate: 99.2, avgResponseTime: 1100 },
      ];

      const mockClientMetrics = [
        { clientId: "client-001", totalMessages: 1200, successRate: 99.2, avgResponseTime: 1100, failedMessages: 10 },
        { clientId: "client-002", totalMessages: 850, successRate: 98.5, avgResponseTime: 1250, failedMessages: 13 },
        { clientId: "client-003", totalMessages: 650, successRate: 99.5, avgResponseTime: 950, failedMessages: 3 },
        { clientId: "client-004", totalMessages: 420, successRate: 97.6, avgResponseTime: 1400, failedMessages: 10 },
      ];

      setMetrics(mockData);
      setClientMetrics(mockClientMetrics);
    } catch (error) {
      console.error("Erro ao carregar métricas:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    try {
      // TODO: Implementar exportação de relatório
      const csv = [
        ["Data", "Enviadas", "Falhadas", "Reenviadas", "Taxa de Sucesso", "Tempo Médio (ms)"],
        ...metrics.map((m) => [
          m.date,
          m.totalSent,
          m.totalFailed,
          m.totalRetried,
          m.successRate.toFixed(1) + "%",
          m.avgResponseTime,
        ]),
      ]
        .map((row) => row.join(","))
        .join("\n");

      const blob = new Blob([csv], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `evolution-report-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
    } catch (error) {
      console.error("Erro ao exportar relatório:", error);
    }
  }

  const avgSuccessRate =
    metrics.length > 0
      ? (metrics.reduce((sum, m) => sum + m.successRate, 0) / metrics.length).toFixed(1)
      : "0";

  const totalMessages = metrics.reduce((sum, m) => sum + m.totalSent, 0);
  const totalFailed = metrics.reduce((sum, m) => sum + m.totalFailed, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Relatórios de Performance</h1>
          <p className="text-gray-600 mt-1">Análise de performance da Evolution API</p>
        </div>
        <div className="flex gap-2">
          <Select value={period} onValueChange={(value: any) => setPeriod(value)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="90d">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleExport} className="gap-2">
            <Download className="w-4 h-4" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total Enviadas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalMessages.toLocaleString()}</div>
            <p className="text-xs text-gray-500 mt-1">Período selecionado</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Taxa de Sucesso Média</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{avgSuccessRate}%</div>
            <p className="text-xs text-gray-500 mt-1">Acima do esperado</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total Falhadas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{totalFailed}</div>
            <p className="text-xs text-gray-500 mt-1">Taxa: {((totalFailed / totalMessages) * 100).toFixed(2)}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Tempo Médio de Resposta</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">1.15s</div>
            <p className="text-xs text-gray-500 mt-1">Excelente performance</p>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Taxa de Sucesso */}
        <Card>
          <CardHeader>
            <CardTitle>Taxa de Sucesso ao Longo do Tempo</CardTitle>
            <CardDescription>Percentual de mensagens enviadas com sucesso</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={metrics}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis domain={[95, 100]} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="successRate"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ fill: "#10b981" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Mensagens Enviadas vs Falhadas */}
        <Card>
          <CardHeader>
            <CardTitle>Mensagens Enviadas vs Falhadas</CardTitle>
            <CardDescription>Comparação diária de sucesso e falhas</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={metrics}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="totalSent" fill="#3b82f6" name="Enviadas" />
                <Bar dataKey="totalFailed" fill="#ef4444" name="Falhadas" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Tempo de Resposta */}
        <Card>
          <CardHeader>
            <CardTitle>Tempo Médio de Resposta</CardTitle>
            <CardDescription>Latência em milissegundos</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={metrics}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="avgResponseTime"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={{ fill: "#f59e0b" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Mensagens Reenviadas */}
        <Card>
          <CardHeader>
            <CardTitle>Mensagens Reenviadas</CardTitle>
            <CardDescription>Tentativas de reenvio automático</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={metrics}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="totalRetried" fill="#8b5cf6" name="Reenviadas" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Tabela de Clientes */}
      <Card>
        <CardHeader>
          <CardTitle>Performance por Cliente</CardTitle>
          <CardDescription>Métricas agregadas para cada cliente</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-4">Cliente</th>
                  <th className="text-right py-2 px-4">Total Enviadas</th>
                  <th className="text-right py-2 px-4">Taxa de Sucesso</th>
                  <th className="text-right py-2 px-4">Tempo Médio</th>
                  <th className="text-right py-2 px-4">Falhadas</th>
                </tr>
              </thead>
              <tbody>
                {clientMetrics.map((client) => (
                  <tr key={client.clientId} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-4 font-mono text-xs">{client.clientId}</td>
                    <td className="text-right py-2 px-4">{client.totalMessages.toLocaleString()}</td>
                    <td className="text-right py-2 px-4">
                      <span className="text-green-600 font-semibold">{client.successRate.toFixed(1)}%</span>
                    </td>
                    <td className="text-right py-2 px-4">{client.avgResponseTime}ms</td>
                    <td className="text-right py-2 px-4">
                      <span className="text-red-600 font-semibold">{client.failedMessages}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
