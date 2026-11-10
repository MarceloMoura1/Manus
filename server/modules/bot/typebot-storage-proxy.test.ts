import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createTypebotStorageProxy, detectMimeType } from "./typebot-storage-proxy";

describe("Typebot Storage Proxy", () => {
  let tempDir: string;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "megadesk-typebot-test-"));
    process.env.TYPEBOT_STORAGE_DIR = tempDir;

    const app = express();
    app.use(createTypebotStorageProxy());

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    delete process.env.TYPEBOT_STORAGE_DIR;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("detects correct MIME types", () => {
    expect(detectMimeType("photo.png")).toBe("image/png");
    expect(detectMimeType("photo.jpg")).toBe("image/jpeg");
    expect(detectMimeType("audio.ogg")).toBe("audio/ogg");
    expect(detectMimeType("voice.opus")).toBe("audio/ogg; codecs=opus");
    expect(detectMimeType("video.mp4")).toBe("video/mp4");
    expect(detectMimeType("unknown.xyz")).toBe("application/octet-stream");
  });

  it("handles S3 bucket location and existence queries", async () => {
    const resLocation = await fetch(`${baseUrl}/typebot?location`);
    expect(resLocation.status).toBe(200);
    expect(resLocation.headers.get("content-type")).toContain("xml");
    const text = await resLocation.text();
    expect(text).toContain("LocationConstraint");

    const resHead = await fetch(`${baseUrl}/typebot`, { method: "HEAD" });
    expect(resHead.status).toBe(200);
  });

  it("uploads file via S3 PUT /typebot/* and serves it via GET /api/typebot-media/*", async () => {
    const binaryData = Buffer.from("fake-image-bytes-megadesk-12345");
    const objectPath = "public/workspaces/ws1/typebots/tb1/blocks/b1/test.png";

    // 1. S3 PUT
    const putRes = await fetch(`${baseUrl}/typebot/${objectPath}`, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: binaryData,
    });

    expect(putRes.status).toBe(200);
    expect(putRes.headers.get("etag")).toBeDefined();

    // Verify file exists on disk
    const savedPath = path.join(tempDir, "public/workspaces/ws1/typebots/tb1/blocks/b1/test.png");
    expect(fs.existsSync(savedPath)).toBe(true);
    expect(fs.readFileSync(savedPath)).toEqual(binaryData);

    // 2. Public GET
    const getRes = await fetch(`${baseUrl}/api/typebot-media/${objectPath}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("content-type")).toBe("image/png");
    expect(getRes.headers.get("cache-control")).toContain("public");
    const arrayBuf = await getRes.arrayBuffer();
    expect(Buffer.from(arrayBuf)).toEqual(binaryData);

    // 3. Public HEAD
    const headRes = await fetch(`${baseUrl}/api/typebot-media/${objectPath}`, { method: "HEAD" });
    expect(headRes.status).toBe(200);
    expect(Number(headRes.headers.get("content-length"))).toBe(binaryData.length);
  });

  it("rejects path traversal attempts on /api/typebot-media/*", async () => {
    const res = await fetch(`${baseUrl}/api/typebot-media/../../etc/passwd`);
    expect([400, 404]).toContain(res.status);
  });

  it("returns 404 for non-existent media", async () => {
    const res = await fetch(`${baseUrl}/api/typebot-media/non-existent.png`);
    expect(res.status).toBe(404);
  });
});
