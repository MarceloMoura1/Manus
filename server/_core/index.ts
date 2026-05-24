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
import { handleEvolutionWebhook, ensureSessionTable } from "../evolution";



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



  // WhatsApp Webhook endpoints (Meta)
  app.get("/api/webhooks/meta", handleWebhookVerify);
  app.post("/api/webhooks/meta", handleWebhookEvent);

  // Evolution API Webhook endpoint
  app.post("/webhook/evolution", handleEvolutionWebhook);

  // Garantir que a tabela de sessões Evolution existe
  await ensureSessionTable().catch(err => console.warn("[Evolution] Aviso ao criar tabela:", err));



  // Inicializar Socket.IO para WhatsApp
  initWhatsAppSocket(server);


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

  });
}

startServer().catch(console.error);
