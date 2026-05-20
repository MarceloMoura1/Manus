import { Express } from "express";

/**
 * Sistema de logs em tempo real para debug
 * Permite visualizar logs do servidor em tempo real no frontend
 */

interface LogEntry {
  timestamp: string;
  level: "info" | "debug" | "error" | "warn";
  message: string;
  data?: any;
}

class LogManager {
  private logs: LogEntry[] = [];
  private subscribers: Set<(log: LogEntry) => void> = new Set();
  private maxLogs = 1000;

  addLog(level: "info" | "debug" | "error" | "warn", message: string, data?: any) {
    const log: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };

    this.logs.push(log);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Notificar todos os subscribers
    this.subscribers.forEach((callback) => callback(log));
  }

  subscribe(callback: (log: LogEntry) => void) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  getLogs() {
    return this.logs;
  }

  clearLogs() {
    this.logs = [];
  }
}

export const logManager = new LogManager();

/**
 * Interceptar console.log e console.error para capturar logs
 */
export function setupLogInterception() {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalDebug = console.debug;

  console.log = (...args: any[]) => {
    originalLog(...args);
    const message = args.map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" ");
    logManager.addLog("info", message);
  };

  console.error = (...args: any[]) => {
    originalError(...args);
    const message = args.map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" ");
    logManager.addLog("error", message);
  };

  console.warn = (...args: any[]) => {
    originalWarn(...args);
    const message = args.map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" ");
    logManager.addLog("warn", message);
  };

  console.debug = (...args: any[]) => {
    originalDebug(...args);
    const message = args.map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" ");
    logManager.addLog("debug", message);
  };
}

/**
 * Registrar endpoints de debug
 */
export function setupDebugRoutes(app: Express) {
  // SSE endpoint para streaming de logs
  app.get("/api/debug/logs-stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Enviar logs históricos
    const logs = logManager.getLogs();
    logs.forEach((log) => {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    });

    // Subscrever a novos logs
    const unsubscribe = logManager.subscribe((log) => {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    });

    // Cleanup quando cliente desconectar
    req.on("close", () => {
      unsubscribe();
      res.end();
    });
  });

  // Endpoint para obter todos os logs
  app.get("/api/debug/logs", (req, res) => {
    res.json(logManager.getLogs());
  });

  // Endpoint para limpar logs
  app.post("/api/debug/logs/clear", (req, res) => {
    logManager.clearLogs();
    res.json({ success: true });
  });
}
