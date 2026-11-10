/**
 * Bot Module — Typebot Reverse Proxy (por subdomínio dedicado)
 *
 * O Typebot é uma aplicação Next.js pré-compilada sem `basePath`: todos os links,
 * assets (`/_next/*`), rotas de API (`/api/auth/*`, `/api/trpc/*`) e a navegação
 * client-side apontam para a raiz do domínio. Servi-lo sob um subcaminho
 * (`app.megadesk.online/typebot-builder/`) faz qualquer navegação interna cair na
 * SPA do MegaDesk. Por isso o Typebot é exposto em subdomínios próprios:
 *
 *   bot.megadesk.online        -> typebot-builder:3000 (editor)
 *   viewer-bot.megadesk.online -> typebot-viewer:3000  (runtime dos fluxos)
 *
 * O túnel Cloudflare encaminha esses hostnames para o `megadesk-app`, e este
 * middleware repassa a requisição de forma transparente (sem reescrita de caminho
 * ou HTML), apenas ajustando os cabeçalhos de iframe para permitir que o editor
 * seja embutido em Configurações > Configurar Bot.
 */
import http from "node:http";
import type { NextFunction, Request, Response } from "express";

interface UpstreamEndpoint {
  hostname: string;
  port: number;
}

interface TypebotTarget {
  name: "builder" | "viewer";
  candidates: UpstreamEndpoint[];
}

const DEFAULT_BUILDER_PUBLIC_URL = "https://bot.megadesk.online";
const DEFAULT_VIEWER_PUBLIC_URL = "https://viewer-bot.megadesk.online";
const DEFAULT_FRAME_ANCESTORS = ["https://app.megadesk.online", "https://admin.megadesk.online"];

function hostFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function getTypebotBuilderPublicUrl(): string {
  return (process.env.TYPEBOT_BUILDER_PUBLIC_URL || DEFAULT_BUILDER_PUBLIC_URL).replace(/\/+$/, "");
}

export function getTypebotViewerPublicUrl(): string {
  return (process.env.TYPEBOT_VIEWER_PUBLIC_URL || DEFAULT_VIEWER_PUBLIC_URL).replace(/\/+$/, "");
}

function builderCandidates(): UpstreamEndpoint[] {
  if (process.env.TYPEBOT_BUILDER_HOST) {
    return [{ hostname: process.env.TYPEBOT_BUILDER_HOST, port: Number(process.env.TYPEBOT_BUILDER_PORT || 3000) }];
  }
  return [
    { hostname: "typebot-builder", port: 3000 }, // Rede Docker megadesk-backend
    { hostname: "127.0.0.1", port: 3002 },       // Host VPS / desenvolvimento local
  ];
}

function viewerCandidates(): UpstreamEndpoint[] {
  if (process.env.TYPEBOT_VIEWER_HOST) {
    return [{ hostname: process.env.TYPEBOT_VIEWER_HOST, port: Number(process.env.TYPEBOT_VIEWER_PORT || 3000) }];
  }
  return [
    { hostname: "typebot-viewer", port: 3000 },
    { hostname: "127.0.0.1", port: 3001 },
  ];
}

function frameAncestors(): string {
  const extra = (process.env.TYPEBOT_FRAME_ANCESTORS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ["'self'", ...DEFAULT_FRAME_ANCESTORS, ...extra].join(" ");
}

/** Substitui `frame-ancestors` da CSP do Typebot, preservando as demais diretivas. */
export function rewriteFrameAncestors(csp: string, ancestors = frameAncestors()): string {
  const directives = csp
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d && !/^frame-ancestors\b/i.test(d));
  directives.push(`frame-ancestors ${ancestors}`);
  return directives.join("; ");
}

function requestHost(req: Request): string {
  const raw = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  return raw.split(",")[0].trim().split(":")[0].toLowerCase();
}

/** Resolve qual serviço do Typebot atende o hostname da requisição (ou null). */
export function resolveTypebotTarget(host: string): TypebotTarget | null {
  if (!host) return null;
  const builderHost = hostFromUrl(getTypebotBuilderPublicUrl());
  const viewerHost = hostFromUrl(getTypebotViewerPublicUrl());
  if (builderHost && host === builderHost) return { name: "builder", candidates: builderCandidates() };
  if (viewerHost && host === viewerHost) return { name: "viewer", candidates: viewerCandidates() };
  return null;
}

/**
 * Middleware montado ANTES de qualquer rota do MegaDesk. Requisições cujo Host
 * seja um subdomínio do Typebot são repassadas integralmente; as demais seguem.
 */
export function createTypebotHostProxy() {
  const cache = new Map<string, UpstreamEndpoint>();

  return function typebotHostProxy(req: Request, res: Response, next: NextFunction) {
    const host = requestHost(req);
    const target = resolveTypebotTarget(host);
    if (!target) return next();

    const cached = cache.get(target.name);
    const candidates = cached
      ? [cached, ...target.candidates.filter((c) => c.hostname !== cached.hostname || c.port !== cached.port)]
      : target.candidates;
    let index = 0;

    const send = (endpoint: UpstreamEndpoint) => {
      const headers: Record<string, string | string[] | undefined> = { ...req.headers };
      headers.host = host;
      headers["x-forwarded-host"] = host;
      headers["x-forwarded-proto"] = (req.headers["x-forwarded-proto"] as string) || "https";

      const proxyReq = http.request(
        {
          hostname: endpoint.hostname,
          port: endpoint.port,
          path: req.originalUrl || req.url || "/",
          method: req.method,
          headers,
          timeout: 30000,
        },
        (proxyRes) => {
          cache.set(target.name, endpoint);
          const outHeaders: Record<string, string | string[] | undefined> = { ...proxyRes.headers };
          delete outHeaders["x-frame-options"];
          delete outHeaders["content-security-policy-report-only"];
          const csp = outHeaders["content-security-policy"];
          if (csp) {
            outHeaders["content-security-policy"] = rewriteFrameAncestors(Array.isArray(csp) ? csp.join("; ") : String(csp));
          }
          res.writeHead(proxyRes.statusCode || 502, outHeaders);
          proxyRes.pipe(res);
        },
      );

      proxyReq.on("timeout", () => proxyReq.destroy(new Error("upstream timeout")));
      proxyReq.on("error", (err: Error) => {
        index++;
        if (!res.headersSent && index < candidates.length) {
          send(candidates[index]);
          return;
        }
        console.error(`[TypebotProxy] Falha ao conectar no Typebot ${target.name}:`, err?.message || err);
        if (!res.headersSent) {
          res.status(502).json({ error: `Typebot ${target.name} temporariamente indisponível.` });
        } else {
          res.end();
        }
      });

      req.pipe(proxyReq);
    };

    send(candidates[0]);
  };
}

/**
 * Compatibilidade: o antigo subcaminho `/typebot-builder/*` não funciona com o
 * Next.js do Typebot. Redireciona para o subdomínio dedicado preservando o caminho.
 */
export function createLegacyTypebotPathRedirect() {
  return function legacyTypebotRedirect(req: Request, res: Response) {
    const original = req.originalUrl || "/typebot-builder";
    const rest = original.replace(/^\/typebot-builder/, "") || "/";
    res.redirect(302, `${getTypebotBuilderPublicUrl()}${rest.startsWith("/") ? rest : `/${rest}`}`);
  };
}
