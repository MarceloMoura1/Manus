import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { registerMetricWebhook } from "../metricWebhook";
import { registerIntegrationApi } from "../integrationApi";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { initWhatsAppSocket, handleWebhookVerify, handleWebhookEvent } from "../modules/whatsapp";
import { addSseClient, startWhatsAppSession, disconnectWhatsApp, getSessionStatus, sendBaileysMessage, restoreExistingSessions } from "../whatsapp-baileys";
import { initEvolutionManager } from "../evolution-manager";
import { initializeQueueProcessor } from "../evolution-queue-processor";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerMetricWebhook(app);
  registerIntegrationApi(app);

  // Inicializar Evolution API
  try {
    await initEvolutionManager();
    console.log("[Evolution Manager] Inicializado com sucesso");
  } catch (err: any) {
    console.error("[Evolution Manager] Erro ao inicializar:", err);
  }

  // Inicializar processador de fila de reprocessamento
  try {
    initializeQueueProcessor();
    console.log("[Evolution Queue] Processador de fila inicializado");
  } catch (err: any) {
    console.error("[Evolution Queue] Erro ao inicializar processador:", err);
  }

  // WhatsApp Webhook endpoints (Meta)
  app.get("/api/webhooks/meta", handleWebhookVerify);
  app.post("/api/webhooks/meta", handleWebhookEvent);

  // Evolution API Webhook endpoint
  app.post("/api/webhooks/evolution", async (req, res) => {
    try {
      const { handleEvolutionWebhook } = await import("../evolution-webhook-handler");
      const payload = req.body;

      console.log(`[Evolution Webhook] Recebido webhook:`, {
        event: payload.event,
        instance: payload.instance,
      });

      // Processar webhook de forma assincrona (nao bloquear resposta)
      handleEvolutionWebhook(payload).catch((err) => {
        console.error(`[Evolution Webhook] Erro ao processar:`, err);
      });

      // Responder imediatamente
      res.json({ ok: true });
    } catch (err: any) {
      console.error(`[Evolution Webhook] Erro:`, err);
      res.status(500).json({ error: err?.message || "Erro ao processar webhook" });
    }
  });

  // Inicializar Socket.IO para WhatsApp
  initWhatsAppSocket(server);

  // Configurar webhooks da Evolution API apos inicializacao
  setTimeout(async () => {
    try {
      const { getEvolutionAdapter } = await import("../evolution-manager");
      const adapter = getEvolutionAdapter();
      const sessions = adapter.listSessions();

      if (sessions.size > 0) {
        console.log(`[Evolution] Configurando webhooks para ${sessions.size} sessao(oes)...`);

        // Obter URL base do servidor
        const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
        const host = process.env.SERVER_HOST || "localhost";
        const port = process.env.PORT || "3000";
        const webhookUrl = `${protocol}://${host}:${port}/api/webhooks/evolution`;

        for (const [clientId, session] of sessions) {
          try {
            const { configureWebhook } = await import("../evolution-manager");
            await configureWebhook(clientId, webhookUrl);
            console.log(`[Evolution] Webhook configurado para ${clientId}`);
          } catch (err: any) {
            console.error(`[Evolution] Erro ao configurar webhook para ${clientId}:`, err);
          }
        }
      }
    } catch (err: any) {
      console.error(`[Evolution] Erro ao configurar webhooks:`, err);
    }
  }, 5000); // Aguardar 5 segundos apos inicializacao
  // Backup scheduled handler
  app.post("/api/scheduled/backup", async (req, res) => {
    try {
      const sdk = await import("./sdk").then(m => m.sdk);
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) {
        return res.status(403).json({ error: "cron-only" });
      }
      
      const { loadMegaDeskStructuredState, createMegaDeskBackup, cleanupOldBackups } = await import("../db");
      const defaultState = { clients: [], conversations: [], tickets: [], botScripts: [], operationalRecords: [], auditLogs: [] };
      const state = await loadMegaDeskStructuredState(defaultState);
      
      if (!state) {
        return res.status(500).json({ error: "Falha ao carregar estado", taskUid: user.taskUid });
      }
      
      // Criar backup
      const backupId = await createMegaDeskBackup(state);
      if (!backupId) {
        return res.status(500).json({ error: "Falha ao criar backup", taskUid: user.taskUid });
      }
      
      // Limpar backups antigos (30 dias)
      await cleanupOldBackups(30);
      
      res.json({ ok: true, backupId, message: "Backup automático criado com sucesso" });
    } catch (error: any) {
      console.error("[Backup Handler] Erro:", error);
      res.status(500).json({ 
        error: error?.message || "Erro desconhecido",
        stack: error?.stack,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ─── Baileys WhatsApp QR Code (SSE) ───────────────────────────────────────
  // GET /api/baileys/qr-stream?clientId=xxx — SSE stream de status/QR
  app.get("/api/baileys/qr-stream", (req, res) => {
    const clientId = String(req.query.clientId || "");
    if (!clientId) return res.status(400).json({ error: "clientId required" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (data: string) => res.write(data);
    const cleanup = addSseClient(clientId, send);

    req.on("close", cleanup);
  });

  // POST /api/baileys/start — iniciar sessão e gerar QR
  app.post("/api/baileys/start", async (req, res) => {
    const { clientId } = req.body;
    if (!clientId) return res.status(400).json({ error: "clientId required" });
    try {
      await startWhatsAppSession(clientId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Erro ao iniciar sessão" });
    }
  });

  // POST /api/baileys/disconnect — desconectar sessão
  app.post("/api/baileys/disconnect", async (req, res) => {
    const { clientId } = req.body;
    if (!clientId) return res.status(400).json({ error: "clientId required" });
    try {
      await disconnectWhatsApp(clientId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Erro ao desconectar" });
    }
  });

  // GET /api/baileys/status?clientId=xxx — status atual
  app.get("/api/baileys/status", (req, res) => {
    const clientId = String(req.query.clientId || "");
    if (!clientId) return res.status(400).json({ error: "clientId required" });
    res.json(getSessionStatus(clientId));
  });

  // POST /api/test-baileys-send — ENDPOINT DE TESTE ISOLADO
  app.post("/api/test-baileys-send", async (req, res) => {
    const { clientId, phoneNumber, message } = req.body;
    
    console.log(`\n${"=".repeat(80)}`);
    console.log(`[TEST] INICIANDO TESTE DE ENVIO`);
    console.log(`${"=".repeat(80)}`);
    console.log(`[TEST] clientId: ${clientId}`);
    console.log(`[TEST] phoneNumber: ${phoneNumber}`);
    console.log(`[TEST] message: ${message}`);
    console.log(`${"=".repeat(80)}\n`);
    
    if (!clientId || !phoneNumber || !message) {
      return res.status(400).json({
        ok: false,
        error: "Parâmetros obrigatórios: clientId, phoneNumber, message",
      });
    }
    
    try {
      const testConversationId = `test-${Date.now()}`;
      console.log(`[TEST] Chamando sendBaileysMessage...`);
      const result = await sendBaileysMessage(
        clientId,
        testConversationId,
        phoneNumber,
        message,
        "TEST_AGENT"
      );
      
      console.log(`[TEST] Resultado:`, result);
      console.log(`${"=".repeat(80)}\n`);
      
      return res.json({
        ok: result.ok,
        error: result.error,
        timestamp: new Date().toISOString(),
        test: { clientId, phoneNumber, message },
      });
    } catch (err: any) {
      console.error(`[TEST] ERRO:`, err);
      console.log(`${"=".repeat(80)}\n`);
      return res.status(500).json({
        ok: false,
        error: err?.message || "Erro desconhecido",
        stack: err?.stack?.substring(0, 1000),
        timestamp: new Date().toISOString(),
      });
    }
  });

  // POST /api/baileys/send — enviar mensagem via Baileys
  app.post("/api/baileys/send", async (req, res) => {
    const { clientId, conversationId, phone, text, agentName } = req.body;
    if (!clientId || !conversationId || !phone || !text) {
      return res.status(400).json({ error: "clientId, conversationId, phone e text são obrigatórios" });
    }
    const result = await sendBaileysMessage(clientId, conversationId, phone, text, agentName || "Atendente");
    if (!result.ok) return res.status(500).json({ error: result.error });
    res.json({ ok: true });
  });
  // ────────────────────────────────────────────────────────────────────────────

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Restaurar sessões Baileys existentes após o servidor iniciar
    restoreExistingSessions().catch((err) =>
      console.error("[Baileys] Erro ao restaurar sessões:", err)
    );
  });
}

startServer().catch(console.error);
