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
import { operationalAllowedOrigins } from "./megadesk-session";

// ─── Domínios permitidos (CORS) ───────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "https://app.megadesk.online",
  "https://admin.megadesk.online",
  "https://api.megadesk.online",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
];

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = net.createServer();
    s.listen(port, () => { s.close(() => resolve(true)); });
    s.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? "0");
  if (Number.isInteger(trustedProxyHops) && trustedProxyHops > 0) app.set("trust proxy", trustedProxyHops);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ─── CORS ─────────────────────────────────────────────────────────────────
  app.use((req, res, next) => {
    const origin = req.headers.origin ?? "";
    const allowedOrigins = new Set([...ALLOWED_ORIGINS, ...operationalAllowedOrigins()]);
    if ((typeof origin === "string" && allowedOrigins.has(origin)) || !origin) {
      if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers",
        "Content-Type,Authorization,x-tenant-id,x-user-role,x-trpc-source,Cookie");
      res.setHeader("Access-Control-Expose-Headers", "Set-Cookie");
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerMetricWebhook(app);
  registerIntegrationApi(app);

  // ─── Webhooks ─────────────────────────────────────────────────────────────
  // Meta WhatsApp Business API
  app.get("/api/webhooks/meta", handleWebhookVerify);
  app.post("/api/webhooks/meta", handleWebhookEvent);

  // Evolution API (QR Code / Baileys)
  app.post("/webhook/evolution", handleEvolutionWebhook);
  // Evolution com webhookByEvents=true envia para sub-paths
  app.post("/webhook/evolution/:event", (req, res) => {
    const eventSlug = req.params.event.toUpperCase().replace(/-/g, "_");
    req.body = { ...req.body, event: req.body.event ?? eventSlug };
    return handleEvolutionWebhook(req, res);
  });

  // Endpoint diagnóstico de erros frontend
  app.post("/api/client-error", (req, res) => {
    const { message, stack, page } = req.body ?? {};
    if (process.env.NODE_ENV !== "production") {
      console.error(`[CLIENT ERROR] ${page}\n${message}\n${stack?.slice(0, 600)}`);
    }
    res.json({ received: true });
  });

  // Garantir tabela de sessões Evolution
  await ensureSessionTable();

  // ─── Socket.IO (WhatsApp em tempo real) ───────────────────────────────────
  initWhatsAppSocket(server);

  // ─── Backup agendado ──────────────────────────────────────────────────────
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
      if (!state) return res.status(500).json({ error: "Falha ao carregar estado" });
      const backupId = await createMegaDeskBackup(state);
      if (!backupId) return res.status(500).json({ error: "Falha ao criar backup" });
      await cleanupOldBackups(30);
      res.json({ ok: true, backupId });
    } catch (error: any) {
      console.error("[Backup Handler] Erro:", error?.message);
      res.status(500).json({ error: error?.message ?? "Erro desconhecido" });
    }
  });

  // ─── tRPC ─────────────────────────────────────────────────────────────────
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

  // ─── Frontend ─────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT ?? "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} busy, using ${port}`);
  }

  server.listen(port, () => {
    console.log(`\nMegaDesk rodando em http://localhost:${port}`);
    console.log(`Admin:  http://localhost:${port}/admin\n`);
  });
}

startServer().catch(console.error);
