import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "node:http";
import { EventEmitter } from "node:events";
import {
  createLegacyTypebotPathRedirect,
  createTypebotHostProxy,
  resolveTypebotTarget,
  rewriteFrameAncestors,
} from "./typebot-proxy";

describe("Typebot Proxy (subdomínio dedicado)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resolve apenas os hosts do Typebot", () => {
    expect(resolveTypebotTarget("bot.megadesk.online")?.name).toBe("builder");
    expect(resolveTypebotTarget("viewer-bot.megadesk.online")?.name).toBe("viewer");
    expect(resolveTypebotTarget("app.megadesk.online")).toBeNull();
    expect(resolveTypebotTarget("")).toBeNull();
  });

  it("não intercepta requisições do MegaDesk", () => {
    const handler = createTypebotHostProxy();
    const next = vi.fn();
    const spy = vi.spyOn(http, "request");
    handler({ headers: { host: "app.megadesk.online" } } as any, {} as any, next);
    expect(next).toHaveBeenCalledOnce();
    expect(spy).not.toHaveBeenCalled();
  });

  it("substitui frame-ancestors preservando as demais diretivas", () => {
    const out = rewriteFrameAncestors("default-src 'self'; frame-ancestors 'self'; form-action 'self'", "'self' https://app.megadesk.online");
    expect(out).toBe("default-src 'self'; form-action 'self'; frame-ancestors 'self' https://app.megadesk.online");
  });

  it("repassa o caminho integral sem reescrita e libera o iframe para o MegaDesk", async () => {
    const handler = createTypebotHostProxy();
    const proxyRes: any = new EventEmitter();
    proxyRes.statusCode = 200;
    proxyRes.headers = {
      "content-type": "text/html",
      "x-frame-options": "SAMEORIGIN",
      "content-security-policy": "default-src 'self'; frame-ancestors 'self'",
      location: "/pt-BR/register",
    };
    proxyRes.pipe = vi.fn();
    const proxyReq: any = new EventEmitter();

    let captured: any;
    vi.spyOn(http, "request").mockImplementation((options: any, cb: any) => {
      captured = options;
      setTimeout(() => cb(proxyRes), 0);
      return proxyReq;
    });

    const req: any = new EventEmitter();
    req.originalUrl = "/pt-BR/register?x=1";
    req.method = "GET";
    req.headers = { host: "bot.megadesk.online" };
    req.pipe = vi.fn();
    const res: any = { headersSent: false, writeHead: vi.fn() };

    handler(req, res, vi.fn());
    await new Promise((r) => setTimeout(r, 5));

    expect(captured.path).toBe("/pt-BR/register?x=1");
    expect(captured.hostname).toBe("typebot-builder");
    expect(captured.headers).toMatchObject({ host: "bot.megadesk.online", "x-forwarded-proto": "https" });
    const [status, headers] = res.writeHead.mock.calls[0];
    expect(status).toBe(200);
    expect(headers["x-frame-options"]).toBeUndefined();
    expect(headers.location).toBe("/pt-BR/register");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'self' https://app.megadesk.online");
    expect(proxyRes.pipe).toHaveBeenCalledWith(res);
  });

  it("redireciona o subcaminho legado /typebot-builder para o subdomínio", () => {
    const res: any = { redirect: vi.fn() };
    createLegacyTypebotPathRedirect()({ originalUrl: "/typebot-builder/pt-BR/signin" } as any, res);
    expect(res.redirect).toHaveBeenCalledWith(302, "https://bot.megadesk.online/pt-BR/signin");
  });

  it("intercepta /api/megadesk-login, injeta cookies de sessão e redireciona para o workspace", () => {
    const handler = createTypebotHostProxy();
    const req: any = {
      path: "/api/megadesk-login",
      headers: { host: "bot.megadesk.online", "x-forwarded-proto": "https" },
      query: { token: "token-uuid-12345", workspaceId: "ws_tenant_abc" },
    };
    const res: any = {
      setHeader: vi.fn(),
      redirect: vi.fn(),
    };
    const next = vi.fn();

    handler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(
      "Set-Cookie",
      expect.arrayContaining([
        expect.stringContaining("__Secure-authjs.session-token=token-uuid-12345"),
        expect.stringContaining("Domain=.megadesk.online"),
      ])
    );
    expect(res.redirect).toHaveBeenCalledWith(302, "/w/ws_tenant_abc/typebots");
  });

  it("garante frame-ancestors incluindo bot.megadesk.online e CORS para requisições do viewer", async () => {
    const handler = createTypebotHostProxy();
    const proxyRes: any = new EventEmitter();
    proxyRes.statusCode = 200;
    proxyRes.headers = {
      "content-type": "text/html",
      "x-frame-options": "SAMEORIGIN",
    };
    proxyRes.pipe = vi.fn();
    const proxyReq: any = new EventEmitter();

    vi.spyOn(http, "request").mockImplementation((_opts: any, cb: any) => {
      setTimeout(() => cb(proxyRes), 0);
      return proxyReq;
    });

    const req: any = new EventEmitter();
    req.originalUrl = "/typebots/t123/preview";
    req.method = "GET";
    req.headers = {
      host: "viewer-bot.megadesk.online",
      origin: "https://bot.megadesk.online",
      "x-forwarded-proto": "https",
    };
    req.pipe = vi.fn();
    const res: any = { headersSent: false, writeHead: vi.fn() };

    handler(req, res, vi.fn());
    await new Promise((r) => setTimeout(r, 5));

    const [status, headers] = res.writeHead.mock.calls[0];
    expect(status).toBe(200);
    expect(headers["x-frame-options"]).toBeUndefined();
    expect(headers["content-security-policy"]).toContain("https://bot.megadesk.online");
    expect(headers["access-control-allow-origin"]).toBe("https://bot.megadesk.online");
    expect(headers["access-control-allow-credentials"]).toBe("true");
  });
});
