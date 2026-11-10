import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "node:http";
import { EventEmitter } from "node:events";
import { createTypebotProxyHandler } from "./typebot-proxy";

describe("Typebot Proxy Middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deve reescrever cabeçalhos e remover X-Frame-Options", async () => {
    const handler = createTypebotProxyHandler();

    const mockProxyRes: any = new EventEmitter();
    mockProxyRes.statusCode = 200;
    mockProxyRes.headers = {
      "content-type": "text/html; charset=utf-8",
      "x-frame-options": "DENY",
      "content-security-policy": "frame-ancestors 'none'",
      location: "/signin",
    };

    const mockProxyReq: any = new EventEmitter();
    mockProxyReq.write = vi.fn();
    mockProxyReq.end = vi.fn();
    mockProxyReq.setHeader = vi.fn();

    vi.spyOn(http, "request").mockImplementation((options: any, callback: any) => {
      // Executa callback na próxima iteração
      setTimeout(() => {
        callback(mockProxyRes);
        mockProxyRes.emit("data", Buffer.from("<head><title>Typebot</title></head><body><script src=\"/_next/static/app.js\"></script></body>"));
        mockProxyRes.emit("end");
      }, 5);
      return mockProxyReq;
    });

    const req: any = new EventEmitter();
    req.url = "/signin";
    req.method = "GET";
    req.headers = { host: "localhost:3000" };
    req.pipe = vi.fn();

    const res: any = {
      writeHead: vi.fn(),
      end: vi.fn(),
      headersSent: false,
    };

    await new Promise<void>((resolve) => {
      res.end = vi.fn((html: string) => {
        expect(res.writeHead).toHaveBeenCalledWith(
          200,
          expect.objectContaining({
            "x-frame-options": "SAMEORIGIN",
            location: "/typebot-builder/signin",
          })
        );
        expect(html).toContain('<base href="/typebot-builder/">');
        expect(html).toContain('src="/typebot-builder/_next/static/app.js"');
        resolve();
      });

      handler(req, res);
    });
  });
});

