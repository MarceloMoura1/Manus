/**
 * Bot Module — Typebot Reverse Proxy Middleware
 * Direciona requisições de /typebot-builder/* para o container interno
 * do Typebot Builder (porta 3002) removendo bloqueios de iframe (X-Frame-Options / CSP).
 */
import http from "node:http";
import type { Request, Response } from "express";

export function createTypebotProxyHandler() {
  const targetHost = process.env.TYPEBOT_BUILDER_HOST || "127.0.0.1";
  const targetPort = Number(process.env.TYPEBOT_BUILDER_PORT || "3002");

  return function typebotProxy(req: Request, res: Response) {
    // req.url quando montado em app.use('/typebot-builder', ...) é relativo ao mount
    // Ex: /typebot-builder/signin -> req.url é /signin
    let upstreamPath = req.url || "/";
    if (!upstreamPath.startsWith("/")) {
      upstreamPath = "/" + upstreamPath;
    }

    const clientHeaders: Record<string, string | string[] | undefined> = { ...req.headers };
    clientHeaders.host = `${targetHost}:${targetPort}`;
    delete clientHeaders["accept-encoding"]; // Evita compressão do upstream para permitir reescrita de HTML

    const proxyReq = http.request(
      {
        hostname: targetHost,
        port: targetPort,
        path: upstreamPath,
        method: req.method,
        headers: clientHeaders,
      },
      (proxyRes) => {
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

    proxyReq.on("error", (err) => {
      console.error("[TypebotProxy] Erro de conexão com o Typebot Builder:", err.message);
      if (!res.headersSent) {
        res.status(502).json({
          error: "Typebot Builder temporariamente indisponível.",
          details: err.message,
        });
      }
    });

    // Se já foi feito parse do corpo (ou se o stream ainda estiver aberto)
    if (req.body && Object.keys(req.body).length > 0 && req.method !== "GET" && req.method !== "HEAD") {
      const payload = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      proxyReq.setHeader("content-length", Buffer.byteLength(payload));
      proxyReq.write(payload);
      proxyReq.end();
    } else {
      req.pipe(proxyReq);
    }
  };
}

