import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/_core/hooks/useAuth";

interface LogEntry {
  timestamp: string;
  level: "info" | "debug" | "error" | "warn";
  message: string;
  data?: any;
}

export default function DebugLogsPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;

    // Conectar ao SSE stream de logs
    const eventSource = new EventSource("/api/debug/logs-stream");

    eventSource.onopen = () => {
      setIsConnected(true);
      console.log("[Debug] Conectado ao stream de logs");
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLogs((prev) => [...prev, data].slice(-500)); // Manter últimos 500 logs
        
        // Auto-scroll para o final
        setTimeout(() => {
          logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 0);
      } catch (err) {
        console.error("[Debug] Erro ao parsear log:", err);
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      eventSource.close();
    };

    eventSourceRef.current = eventSource;

    return () => {
      eventSource.close();
    };
  }, [user]);

  const clearLogs = () => {
    setLogs([]);
  };

  const downloadLogs = () => {
    const content = logs
      .map((log) => `[${log.timestamp}] ${log.level.toUpperCase()}: ${log.message}${log.data ? "\n" + JSON.stringify(log.data, null, 2) : ""}`)
      .join("\n\n");
    
    const element = document.createElement("a");
    element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(content));
    element.setAttribute("download", `debug-logs-${new Date().toISOString()}.txt`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case "error":
        return "text-red-600 bg-red-50";
      case "warn":
        return "text-yellow-600 bg-yellow-50";
      case "debug":
        return "text-blue-600 bg-blue-50";
      default:
        return "text-gray-600 bg-gray-50";
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Debug Logs</h1>
        <p className="text-gray-600">Visualize logs em tempo real do servidor</p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Status da Conexão</CardTitle>
          <CardDescription>
            {isConnected ? (
              <span className="text-green-600 font-semibold">✓ Conectado ao stream de logs</span>
            ) : (
              <span className="text-red-600 font-semibold">✗ Desconectado</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button variant="outline" onClick={clearLogs}>
            Limpar Logs
          </Button>
          <Button variant="outline" onClick={downloadLogs}>
            Baixar Logs
          </Button>
          <span className="ml-auto text-sm text-gray-600">Total: {logs.length} logs</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logs em Tempo Real</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-900 text-gray-100 p-4 rounded-lg font-mono text-sm max-h-[600px] overflow-y-auto">
            {logs.length === 0 ? (
              <div className="text-gray-500">Aguardando logs...</div>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} className={`mb-2 pb-2 border-b border-gray-700 ${getLevelColor(log.level)}`}>
                  <div className="flex gap-2">
                    <span className="text-gray-400 flex-shrink-0">[{log.timestamp}]</span>
                    <span className="font-bold flex-shrink-0">{log.level.toUpperCase()}</span>
                    <span className="break-words flex-grow">{log.message}</span>
                  </div>
                  {log.data && (
                    <div className="mt-1 ml-4 text-xs text-gray-500 bg-gray-800 p-2 rounded break-words">
                      <pre>{JSON.stringify(log.data, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="font-semibold text-blue-900 mb-2">Como usar:</h3>
        <ol className="list-decimal list-inside text-sm text-blue-800 space-y-1">
          <li>Envie uma mensagem no WhatsApp para seu número</li>
          <li>Os logs aparecerão aqui em tempo real</li>
          <li>Procure por "[Baileys]" para ver informações do WhatsApp</li>
          <li>Use "Baixar Logs" para salvar os logs em arquivo</li>
        </ol>
      </div>
    </div>
  );
}
