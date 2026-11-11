import type { Express, Request, Response } from "express";
import { resolveOperationalSessionReadOnly } from "../_core/megadesk-session";
import { getAiTokenUsageSummary } from "../modules/ai-usage/ai-usage.service";
import { NOT_ADMIN_ERR_MSG } from "@shared/const";

export function registerAiTokenUsageRoutes(app: Express): void {
  app.get("/api/ai/token-usage", async (req: Request, res: Response) => {
    try {
      const session = await resolveOperationalSessionReadOnly(req);
      if (!session || !session.tenantId) {
        return res.status(401).json({
          error: "UNAUTHORIZED",
          message: "Sessão inválida ou não autenticada.",
        });
      }

      if (session.role !== "admin") {
        return res.status(403).json({
          error: "FORBIDDEN",
          message: NOT_ADMIN_ERR_MSG,
        });
      }

      const summary = await getAiTokenUsageSummary(session.tenantId);
      return res.status(200).json(summary);
    } catch (error: any) {
      console.error("[AiTokenUsageRoute] Erro ao obter métricas de consumo de IA:", error);
      return res.status(500).json({
        error: "INTERNAL_ERROR",
        message: "Falha ao processar resumo de consumo de IA.",
      });
    }
  });
}

