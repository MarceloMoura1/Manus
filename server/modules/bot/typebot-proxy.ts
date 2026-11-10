/**
 * Bot Module — Typebot Reverse Proxy Middleware
 * Direciona requisições de /typebot-builder/* para o container interno
 * do Typebot Builder removendo bloqueios de iframe (X-Frame-Options / CSP).
 * Suporta resolução em ambiente Docker (typebot-builder:3000) e local (127.0.0.1:3002).
 */
import http from "node:http";
import type { Request, Response } from "express";

interface UpstreamEndpoint {
  hostname: string;
  port: number;
}

function getUpstreamCandidates(): UpstreamEndpoint[] {
  if (process.env.TYPEBOT_BUILDER_HOST) {
    const port = Number(process.env.TYPEBOT_BUILDER_PORT || 3000);
    return [{ hostname: process.env.TYPEBOT_BUILDER_HOST, port }];
  }
  return [
    { hostname: "typebot-builder", port: 3000 }, // Rede Docker compartilhada (megadesk-backend)
    { hostname: "127.0.0.1", port: 3002 },        // Host local / desenvolvimento
    { hostname: "localhost", port: 3002 },
  ];
}

export function createTypebotProxyHandler() {
  let cachedWorkingEndpoint: UpstreamEndpoint | null = null;

  return function typebotProxy(req: Request, res: Response) {
    // req.url quando montado em app.use('/typebot-builder', ...) é relativo ao mount
    // Ex: /typebot-builder/signin -> req.url é /signin
    let upstreamPath = req.url || "/";
    if (!upstreamPath.startsWith("/")) {
      upstreamPath = "/" + upstreamPath;
    }

    const candidates = cachedWorkingEndpoint
      ? [cachedWorkingEndpoint, ...getUpstreamCandidates().filter(c => c.hostname !== cachedWorkingEndpoint?.hostname || c.port !== cachedWorkingEndpoint?.port)]
      : getUpstreamCandidates();

    let candidateIndex = 0;

    function trySendToUpstream(endpoint: UpstreamEndpoint) {
      const clientHeaders: Record<string, string | string[] | undefined> = { ...req.headers };
      clientHeaders.host = `${endpoint.hostname}:${endpoint.port}`;
      delete clientHeaders["accept-encoding"]; // Evita compressão do upstream para permitir reescrita de HTML

      const proxyReq = http.request(
        {
          hostname: endpoint.hostname,
          port: endpoint.port,
          path: upstreamPath,
          method: req.method,
          headers: clientHeaders,
          timeout: 8000,
        },
        (proxyRes) => {
          cachedWorkingEndpoint = endpoint;
          const headers: Record<string, string | string[] | undefined> = { ...proxyRes.headers };

          // 1. Remover cabeçalhos restritivos de iframe
          delete headers["x-frame-options"];
          delete headers["content-security-policy"];
          delete headers["content-security-policy-report-only"];

          // 2. Permitir embedding seguro no MegaDesk
          headers["x-frame-options"] = "SAMEORIGIN";

          // 3. Reescrever cabeçalho Location em redirecionamentos (301, 302, 307, 308)
          if (headers.location) {
            let loc = Array.isArray(headers.location) ? headers.location[0] : headers.location;
            if (loc.startsWith("http://") || loc.startsWith("https://")) {
              try {
                const parsed = new URL(loc);
                loc = parsed.pathname + parsed.search + parsed.hash;
              } catch {}
            }
            if (loc.startsWith("/")) {
              headers.location = `/typebot-builder${loc}`;
            }
          }

          const contentType = String(headers["content-type"] || "");
          const isHtml = contentType.includes("text/html");

          if (isHtml) {
            const chunks: Buffer[] = [];
            proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
            proxyRes.on("end", () => {
              let html = Buffer.concat(chunks).toString("utf-8");

              // Injeta <base href="/typebot-builder/"> para que caminhos relativos funcionem
              if (html.includes("<head>")) {
                html = html.replace("<head>", '<head><base href="/typebot-builder/">');
              }

              // Reescreve assets absolutos do Next.js e endpoints
              html = html.replace(/(href|src)=["']\/_next\//g, '$1="/typebot-builder/_next/');
              html = html.replace(/(href|src)=["']\/__ENV\.js["']/g, '$1="/typebot-builder/__ENV.js"');
              html = html.replace(/(href|src)=["']\/api\//g, '$1="/typebot-builder/api/');
              html = html.replace(/(href|src)=["']\/favicon\./g, '$1="/typebot-builder/favicon.');

              headers["content-length"] = Buffer.byteLength(html, "utf-8").toString();
              res.writeHead(proxyRes.statusCode || 200, headers);
              res.end(html);
            });
          } else {
            res.writeHead(proxyRes.statusCode || 200, headers);
            proxyRes.pipe(res);
          }
        }
      );

      proxyReq.on("error", (err: any) => {
        candidateIndex++;
        if (candidateIndex < candidates.length) {
          trySendToUpstream(candidates[candidateIndex]);
          return;
        }

        console.error("[TypebotProxy] Erro ao conectar ao Typebot Builder em todos os candidatos:", err?.message || err);
        if (!res.headersSent) {
          res.status(502).json({
            error: "Typebot Builder temporariamente indisponível.",
            details: err?.message || "Conexão recusada",
          });
        }
      });

      // Se já foi feito parse do corpo
      if (req.body && Object.keys(req.body).length > 0 && req.method !== "GET" && req.method !== "HEAD") {
        const payload = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        proxyReq.setHeader("content-length", Buffer.byteLength(payload));
        proxyReq.write(payload);
        proxyReq.end();
      } else {
        req.pipe(proxyReq);
      }
    }

    trySendToUpstream(candidates[0]);
  };
}
