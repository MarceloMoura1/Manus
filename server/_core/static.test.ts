import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ staticMiddleware: vi.fn((..._args: unknown[]) => vi.fn()) }));
vi.mock("express", () => ({ default: { static: mocks.staticMiddleware } }));

import { serveStatic } from "./static";
import type { Express } from "express";

describe("SPA static cache policy", () => {
  beforeEach(() => mocks.staticMiddleware.mockClear());

  it("revalidates index.html but leaves hashed assets unchanged", () => {
    const app = { use: vi.fn() };
    serveStatic(app as unknown as Express);
    const options = mocks.staticMiddleware.mock.calls[0]?.[1] as unknown as {
      setHeaders: (res: { setHeader: ReturnType<typeof vi.fn> }, filePath: string) => void;
    };
    const res = { setHeader: vi.fn() };
    options.setHeaders(res, "/release/public/index.html");
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-cache");
    res.setHeader.mockClear();
    options.setHeaders(res, "/release/public/assets/index-abc123.js");
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it("revalidates the SPA fallback for direct routes", () => {
    const app = { use: vi.fn() };
    serveStatic(app as unknown as Express);
    const fallback = app.use.mock.calls.find(([route]) => route === "*")?.[1];
    expect(fallback).toBeTypeOf("function");
    const res = { setHeader: vi.fn(), sendFile: vi.fn() };
    fallback({}, res);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-cache");
    expect(res.sendFile).toHaveBeenCalledWith(expect.stringMatching(/index\.html$/));
  });

  it("never serves the SPA for unmatched API or legacy Typebot paths", () => {
    const app = { use: vi.fn() };
    serveStatic(app as unknown as Express);
    const fallback = app.use.mock.calls.find(([route]) => route === "*")?.[1];
    for (const originalUrl of ["/api/unknown", "/typebot-builder/pt-BR/register"]) {
      const json = vi.fn();
      const res = { setHeader: vi.fn(), sendFile: vi.fn(), status: vi.fn(() => ({ json })) };
      fallback({ originalUrl }, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.sendFile).not.toHaveBeenCalled();
    }
  });
});
