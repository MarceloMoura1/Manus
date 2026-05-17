import { Express } from "express";

export function registerIntegrationApi(app: Express) {
  app.get("/api/megadesk/integration/health", (_req, res) => {
    res.json({ ok: true, service: "megadesk", contract: "megaadmin-token" });
  });
}
