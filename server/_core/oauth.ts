import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Extrai o returnPath do state OAuth.
 * Suporta três formatos de state:
 *   1. JSON base64: btoa(JSON.stringify({ origin, returnPath })) — gerado pelo AdminPanel
 *   2. URL completa base64: btoa("https://origin/path") — formato legado
 *   3. Path relativo direto: "/admin"
 */
function extractReturnPath(state: string): string {
  try {
    const decoded = Buffer.from(state, "base64").toString("utf-8");

    // Formato 1: JSON com { origin, returnPath }
    try {
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed.returnPath === "string" && parsed.returnPath.startsWith("/")) {
        return parsed.returnPath;
      }
    } catch {
      // não é JSON, tenta como URL
    }

    // Formato 2: URL completa
    try {
      const url = new URL(decoded);
      if (url.pathname !== "/api/oauth/callback") {
        return url.pathname + url.search + url.hash;
      }
    } catch {
      // não é URL válida
    }

    // Formato 3: path relativo direto
    if (decoded.startsWith("/")) return decoded;

    return "/";
  } catch {
    if (typeof state === "string" && state.startsWith("/")) return state;
    return "/";
  }
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // Preservar returnPath: se o state contiver um path diferente de /,
      // redirecionar de volta para lá (ex: /admin após login no MegaAdmin).
      const returnPath = extractReturnPath(state);
      res.redirect(302, returnPath);
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
