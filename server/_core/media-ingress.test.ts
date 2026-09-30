import { createServer, request as httpRequest } from "node:http";
import express, { type ErrorRequestHandler } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupplierUploadIngressMiddleware, requestContainsSupplierUpload } from "./media-ingress";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))));

async function post(path: string, body: string, supplierLimit: number) {
  const app = express();
  app.use("/api/trpc", createSupplierUploadIngressMiddleware(supplierLimit));
  app.use(express.json({ limit: 1024 }));
  app.post("/api/trpc/*", (_req, res) => res.status(200).json({ ok: true }));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server unavailable");
  return fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: "POST", headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) }, body,
  });
}

async function postChunked(path: string, chunks: string[], supplierLimit: number) {
  const app = express();
  const service = vi.fn((_req, res) => res.status(200).json({ ok: true }));
  app.use("/api/trpc", createSupplierUploadIngressMiddleware(supplierLimit));
  app.use(express.json({ limit: 1024 }));
  app.post("/api/trpc/*", service);
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status((error as { type?: string }).type === "entity.too.large" ? 413 : 500).json({ error: "REJECTED" });
  };
  app.use(errors);
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server unavailable");
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path,
      method: "POST",
      headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
    }, response => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
    });
    request.once("error", reject);
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
  return { status, service };
}

describe("supplier upload HTTP ingress", () => {
  it("recognizes the real tRPC procedure in single and batched paths", () => {
    expect(requestContainsSupplierUpload("/erp.suppliers.files.upload")).toBe(true);
    expect(requestContainsSupplierUpload("/other,erp.suppliers.files.upload")).toBe(true);
    expect(requestContainsSupplierUpload("/erp.suppliers.files.list")).toBe(false);
  });

  it("accepts the exact HTTP envelope limit and rejects limit plus one before JSON parsing", async () => {
    const base = JSON.stringify({ value: "" });
    const limit = 256;
    const exact = JSON.stringify({ value: "x".repeat(limit - Buffer.byteLength(base)) });
    expect(Buffer.byteLength(exact)).toBe(limit);
    expect((await post("/api/trpc/erp.suppliers.files.upload", exact, limit)).status).toBe(200);
    expect((await post("/api/trpc/erp.suppliers.files.upload", `${exact} `, limit)).status).toBe(413);
  });

  it("does not impose the supplier limit on a normal non-media tRPC payload", async () => {
    const body = JSON.stringify({ value: "x".repeat(300) });
    expect((await post("/api/trpc/megadesk.session", body, 256)).status).toBe(200);
  });

  it("CAUSAL rejects an oversized chunked upload without Content-Length before the service boundary", async () => {
    const limit = 256;
    const body = JSON.stringify({ value: "x".repeat(limit) });
    expect(Buffer.byteLength(body)).toBeGreaterThan(limit);
    const result = await postChunked(
      "/api/trpc/erp.suppliers.files.upload",
      [body.slice(0, 100), body.slice(100, 200), body.slice(200)],
      limit,
    );
    expect(result.status).toBe(413);
    expect(result.service).not.toHaveBeenCalled();
  });
});
