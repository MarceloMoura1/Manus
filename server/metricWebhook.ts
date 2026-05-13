import { Express, Request, Response } from "express";
import { recordMegaDeskMetric, validateMegaDeskClientToken } from "./db";

const VALID_METRIC_TYPES = new Set([
  "message",
  "conversation",
  "ticket",
  "resolution",
  "handoff",
  "bot_response",
]);

type MetricWebhookBody = {
  clientId?: string;
  metricType?: string;
  amount?: number;
  source?: string;
  metadata?: Record<string, unknown>;
};

function readBearerToken(req: Request<any, any, any>) {
  const header = req.header("authorization") || req.header("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export function registerMetricWebhook(app: Express) {
  app.post("/api/megadesk/webhooks/metrics", async (req: Request<any, any, MetricWebhookBody>, res: Response) => {
    const apiToken = readBearerToken(req);

    if (!apiToken) {
      return res.status(401).json({ success: false, error: "Token de API ausente." });
    }

    const { clientId, metricType, amount = 1, source = "megadesk", metadata = {} } = req.body || {};

    if (!clientId || typeof clientId !== "string") {
      return res.status(400).json({ success: false, error: "clientId é obrigatório." });
    }

    if (!metricType || !VALID_METRIC_TYPES.has(metricType)) {
      return res.status(400).json({ success: false, error: "metricType inválido." });
    }

    if (typeof amount !== "number" || Number.isNaN(amount) || amount < 0) {
      return res.status(400).json({ success: false, error: "amount deve ser um número positivo." });
    }

    const client = await validateMegaDeskClientToken(clientId, apiToken);
    if (!client) {
      return res.status(403).json({ success: false, error: "Token inválido, cliente bloqueado ou tenant inexistente." });
    }

    await recordMegaDeskMetric(clientId, metricType, amount, { ...metadata, tenantDatabaseName: client.tenantDatabaseName }, source);

    return res.json({
      success: true,
      client: { id: client.clientId, company: client.company, tenantDatabaseName: client.tenantDatabaseName },
      metric: {
        clientId,
        metricType,
        amount,
        source,
        metadata,
        persisted: true,
        tokenHint: `${apiToken.slice(0, 6)}...${apiToken.slice(-4)}`,
      },
    });
  });

  app.post("/api/megadesk/metrics", (req: Request, res: Response) => {
    return res.status(410).json({ ok: false, error: "Use /api/megadesk/webhooks/metrics com Bearer token e clientId para persistência por tenant." });
  });
}
