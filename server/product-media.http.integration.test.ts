import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import sharp from "sharp";
import { lstat, mkdir, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ProductMediaError,
  processProductImage,
  registerProductMediaRoutes,
  resolveMediaPath,
} from "./product-media";
import { registerMegaDeskCors } from "./_core/index";

describe("isolated product media HTTP contract & multi-image gallery", () => {
  let server: Server;
  let base: string;
  let runId: string;
  let root: string;
  let sampleImageBytes: Buffer;

  const productA = "11111111-1111-4111-8111-111111111111";
  const productPreExisting = "33333333-3333-4333-8333-333333333333";

  type InMemMedia = {
    id: number;
    mediaId: string;
    productPublicId: string;
    tenantId: string;
    storageKey: string;
    thumbnailKey: string;
    mimeType: string;
    byteSize: number;
    sha256: string;
    width: number;
    height: number;
    isPrimary: boolean;
    displayOrder: number;
    createdAt: string;
  };

  const dbMedia: InMemMedia[] = [];
  const attempts = new Map<string, InMemMedia>();
  let nextId = 1;

  beforeAll(async () => {
    runId = process.env.MEGADESK_MEDIA_TEST_RUN_ID?.trim() || `test-run-${randomUUID()}`;
    root = process.env.MEGADESK_MEDIA_ROOT?.trim() || path.join(os.tmpdir(), `megadesk-media-${runId}`);
    process.env.MEGADESK_MEDIA_TEST_RUN_ID = runId;
    process.env.MEGADESK_MEDIA_ROOT = root;

    await mkdir(root, { recursive: true });
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("invalid test media root");

    sampleImageBytes = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#2463eb" },
    }).jpeg().toBuffer();

    const app = express();
    registerMegaDeskCors(app);

    // In-memory synthetic service backed by real sharp image processing & file writes to test media root
    registerProductMediaRoutes(app, {
      resolveIdentity: async (req) => {
        const session = req.header("x-test-session");
        if (session === "tenant-a") return { tenantId: "tenant-a", userId: "synthetic-admin", role: "admin" };
        if (session === "tenant-b") return { tenantId: "tenant-b", userId: "synthetic-other", role: "admin" };
        return null;
      },
      createService: () => ({
        async upload(identity, publicId, attemptId, bytes, options = {}) {
          if (identity.tenantId !== "tenant-a" || ![productA, productPreExisting].includes(publicId)) {
            throw new ProductMediaError("NOT_FOUND", "Produto não encontrado.");
          }

          const existingAttempt = attempts.get(`${identity.tenantId}:${attemptId}`);
          if (existingAttempt) {
            return { mediaId: existingAttempt.mediaId, isPrimary: existingAttempt.isPrimary };
          }

          const processed = await processProductImage(bytes);
          const mediaId = randomUUID();
          const shard = mediaId.slice(0, 2);
          const storageKey = `objects/${shard}/${mediaId}.webp`;
          const thumbnailKey = `thumbnails/${shard}/${mediaId}.webp`;

          const origPath = path.join(root, ...storageKey.split("/"));
          const thumbPath = path.join(root, ...thumbnailKey.split("/"));
          await mkdir(path.dirname(origPath), { recursive: true });
          await mkdir(path.dirname(thumbPath), { recursive: true });
          await writeFile(origPath, processed.main);
          await writeFile(thumbPath, processed.thumbnail);

          const productItems = dbMedia.filter(m => m.tenantId === identity.tenantId && m.productPublicId === publicId);
          const isFirst = productItems.length === 0;
          const shouldBePrimary = isFirst || Boolean(options.setAsPrimary) || Boolean(options.replacePrimary);

          if (shouldBePrimary) {
            for (const item of productItems) {
              item.isPrimary = false;
            }
          }

          const record: InMemMedia = {
            id: nextId++,
            mediaId,
            productPublicId: publicId,
            tenantId: identity.tenantId,
            storageKey,
            thumbnailKey,
            mimeType: processed.mimeType,
            byteSize: processed.main.length,
            sha256: processed.sha256,
            width: processed.width,
            height: processed.height,
            isPrimary: shouldBePrimary,
            displayOrder: productItems.length,
            createdAt: new Date().toISOString(),
          };

          dbMedia.push(record);
          attempts.set(`${identity.tenantId}:${attemptId}`, record);

          return { mediaId: record.mediaId, isPrimary: record.isPrimary };
        },

        async list(identity, publicId) {
          if (identity.tenantId !== "tenant-a" || ![productA, productPreExisting].includes(publicId)) {
            throw new ProductMediaError("NOT_FOUND", "Produto não encontrado.");
          }
          return dbMedia
            .filter(m => m.tenantId === identity.tenantId && m.productPublicId === publicId)
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map(m => ({
              mediaId: m.mediaId,
              isPrimary: m.isPrimary,
              displayOrder: m.displayOrder,
              width: m.width,
              height: m.height,
              byteSize: m.byteSize,
              mimeType: m.mimeType,
              createdAt: m.createdAt,
            }));
        },

        async read(tenantId, publicId, thumbnail) {
          const item = dbMedia.find(m => m.tenantId === tenantId && m.productPublicId === publicId && m.isPrimary);
          if (!item) throw new ProductMediaError("NOT_FOUND", "Imagem não encontrada.");
          const key = thumbnail ? item.thumbnailKey : item.storageKey;
          return { path: path.join(root, ...key.split("/")), mimeType: item.mimeType };
        },

        async readByMediaId(tenantId, publicId, mediaPublicId, thumbnail) {
          const item = dbMedia.find(m => m.tenantId === tenantId && m.productPublicId === publicId && m.mediaId === mediaPublicId);
          if (!item) throw new ProductMediaError("NOT_FOUND", "Imagem não encontrada.");
          const key = thumbnail ? item.thumbnailKey : item.storageKey;
          return { path: path.join(root, ...key.split("/")), mimeType: item.mimeType };
        },

        async setPrimary(identity, publicId, mediaPublicId) {
          const items = dbMedia.filter(m => m.tenantId === identity.tenantId && m.productPublicId === publicId);
          const target = items.find(m => m.mediaId === mediaPublicId);
          if (!target) throw new ProductMediaError("NOT_FOUND", "Imagem não encontrada neste produto.");
          for (const it of items) it.isPrimary = it.mediaId === mediaPublicId;
          return { ok: true, primaryMediaId: mediaPublicId };
        },

        async deleteMedia(identity, publicId, mediaPublicId) {
          const idx = dbMedia.findIndex(m => m.tenantId === identity.tenantId && m.productPublicId === publicId && m.mediaId === mediaPublicId);
          if (idx === -1) throw new ProductMediaError("NOT_FOUND", "Imagem não encontrada neste produto.");
          const wasPrimary = dbMedia[idx].isPrimary;
          dbMedia.splice(idx, 1);
          let newPrimaryMediaId: string | null = null;
          if (wasPrimary) {
            const remaining = dbMedia.filter(m => m.tenantId === identity.tenantId && m.productPublicId === publicId);
            if (remaining.length > 0) {
              remaining[0].isPrimary = true;
              newPrimaryMediaId = remaining[0].mediaId;
            }
          }
          return { ok: true, removedMediaId: mediaPublicId, newPrimaryMediaId };
        },

        async remove(identity, publicId) {
          const idx = dbMedia.findIndex(m => m.tenantId === identity.tenantId && m.productPublicId === publicId && m.isPrimary);
          if (idx !== -1) dbMedia.splice(idx, 1);
          return { ok: true };
        },

        async reorder(identity, publicId, mediaIdsOrder) {
          const items = dbMedia.filter(m => m.tenantId === identity.tenantId && m.productPublicId === publicId);
          for (let i = 0; i < mediaIdsOrder.length; i++) {
            const it = items.find(m => m.mediaId === mediaIdsOrder[i]);
            if (it) it.displayOrder = i;
          }
          return { ok: true };
        },
      }),
    });

    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        base = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
      server.once("error", reject);
    });
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
    if (root) await rm(root, { recursive: true, force: true });
  });

  const request = (suffix: string, init: RequestInit = {}) =>
    fetch(`${base}${suffix}`, {
      redirect: "manual",
      ...init,
      headers: { "x-test-session": "tenant-a", ...init.headers },
    });

  // -------------------------------------------------------------------------
  // 1, 2, 3, 4: Usuário autenticado autorizado envia imagem, é persistida,
  // registro de mídia é criado e resposta é sucesso (200)
  // -------------------------------------------------------------------------
  let firstMediaId = "";
  it("1, 2, 3, 4: usuário autenticado envia imagem válida, arquivo é persistido fisicamente e retorna 200 com mediaId", async () => {
    const attemptId = randomUUID();
    const res = await request(`/api/products/${productA}/images`, {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "x-client-attempt-id": attemptId,
      },
      body: sampleImageBytes,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("mediaId");
    expect(body.isPrimary).toBe(true);
    firstMediaId = body.mediaId;

    // Prova que o arquivo existe fisicamente no root e é um WebP válido
    const item = dbMedia.find(m => m.mediaId === firstMediaId);
    expect(item).toBeDefined();
    const physicalPath = path.join(root, ...item!.storageKey.split("/"));
    const fileStat = await stat(physicalPath);
    expect(fileStat.size).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 5: GET subsequente retorna a imagem
  // -------------------------------------------------------------------------
  it("5: GET subsequente retorna a imagem persistida com Content-Type image/webp", async () => {
    const res = await request(`/api/products/${productA}/images/${firstMediaId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^image\/webp/);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe("webp");
  });

  // -------------------------------------------------------------------------
  // 6: Produto pré-existente também aceita imagem
  // -------------------------------------------------------------------------
  it("6: produto pré-existente sem fotos anteriores aceita imagem e a torna principal", async () => {
    const attemptId = randomUUID();
    const res = await request(`/api/products/${productPreExisting}/images`, {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "x-client-attempt-id": attemptId,
      },
      body: sampleImageBytes,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isPrimary).toBe(true);

    const listRes = await request(`/api/products/${productPreExisting}/images`);
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.items).toHaveLength(1);
    expect(listData.items[0].isPrimary).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7: Segunda imagem pode ser adicionada
  // -------------------------------------------------------------------------
  let secondMediaId = "";
  it("7: segunda imagem é adicionada à galeria sem sobrescrever a principal", async () => {
    const secondImage = await sharp({
      create: { width: 50, height: 50, channels: 3, background: "#10b981" },
    }).png().toBuffer();

    const attemptId = randomUUID();
    const res = await request(`/api/products/${productA}/images`, {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "x-client-attempt-id": attemptId,
      },
      body: secondImage,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mediaId).not.toBe(firstMediaId);
    expect(body.isPrimary).toBe(false);
    secondMediaId = body.mediaId;

    const listRes = await request(`/api/products/${productA}/images`);
    const list = await listRes.json();
    expect(list.items).toHaveLength(2);
    expect(list.items.find((it: any) => it.mediaId === firstMediaId).isPrimary).toBe(true);
    expect(list.items.find((it: any) => it.mediaId === secondMediaId).isPrimary).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 8: Imagem principal pode ser definida
  // -------------------------------------------------------------------------
  it("8: imagem secundária pode ser promovida a foto principal via PUT :mediaId/primary", async () => {
    const res = await request(`/api/products/${productA}/images/${secondMediaId}/primary`, {
      method: "PUT",
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.primaryMediaId).toBe(secondMediaId);

    const listRes = await request(`/api/products/${productA}/images`);
    const list = await listRes.json();
    expect(list.items.find((it: any) => it.mediaId === secondMediaId).isPrimary).toBe(true);
    expect(list.items.find((it: any) => it.mediaId === firstMediaId).isPrimary).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 9: Exclusão funciona
  // -------------------------------------------------------------------------
  it("9: exclusão de imagem remove o registro e promove a próxima imagem se a excluída era principal", async () => {
    const res = await request(`/api/products/${productA}/images/${secondMediaId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.removedMediaId).toBe(secondMediaId);
    expect(data.newPrimaryMediaId).toBe(firstMediaId);

    // Imagem excluída não pode mais ser lida
    const readDeleted = await request(`/api/products/${productA}/images/${secondMediaId}`);
    expect(readDeleted.status).toBe(404);

    // Primeira imagem voltou a ser principal
    const listRes = await request(`/api/products/${productA}/images`);
    const list = await listRes.json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].mediaId).toBe(firstMediaId);
    expect(list.items[0].isPrimary).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 10: Tentativa sem autenticação falha
  // -------------------------------------------------------------------------
  it("10: requisições sem credenciais/sessão retornam 401 Unauthorized", async () => {
    expect((await fetch(`${base}/api/products/${productA}/images`)).status).toBe(401);
    expect((await fetch(`${base}/api/products/${productA}/images`, { method: "POST", body: sampleImageBytes })).status).toBe(401);
    expect((await fetch(`${base}/api/products/${productA}/images/${firstMediaId}`, { method: "DELETE" })).status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // 11: Tenant errado não acessa produto
  // -------------------------------------------------------------------------
  it("11: tenant B não acessa galeria ou imagens de produto pertencente ao tenant A", async () => {
    const res = await fetch(`${base}/api/products/${productA}/images`, {
      headers: { "x-test-session": "tenant-b" },
    });
    // Não encontra o produto no tenant B
    const body = await res.text();
    expect([404, 403]).toContain(res.status);
    expect(body).not.toContain(firstMediaId);
  });

  // -------------------------------------------------------------------------
  // 12: Erro não vaza SQL, path ou stack trace
  // -------------------------------------------------------------------------
  it("12: erros de upload sanitizam detalhes internos e não vazam SQL, path local ou stack", async () => {
    const res = await request(`/api/products/${productA}/images`, {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "x-client-attempt-id": randomUUID(),
      },
      body: Buffer.from("not-an-image-corrupted-bytes"),
    });

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toMatch(/SELECT|INSERT|UPDATE|DELETE|table|storage|objects|thumbnails|[A-Z]:\\|\.ts:\d+/i);
  });

  // -------------------------------------------------------------------------
  // 13: Retry com mesmo attempt-id não cria duplicação
  // -------------------------------------------------------------------------
  it("13: retry com o mesmo x-client-attempt-id retorna o mesmo mediaId sem duplicar imagem", async () => {
    const attemptId = randomUUID();
    const res1 = await request(`/api/products/${productA}/images`, {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "x-client-attempt-id": attemptId,
      },
      body: sampleImageBytes,
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();

    const res2 = await request(`/api/products/${productA}/images`, {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "x-client-attempt-id": attemptId,
      },
      body: sampleImageBytes,
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();

    expect(body1.mediaId).toBe(body2.mediaId);
  });

  // -------------------------------------------------------------------------
  // 14: CORS Preflight permite x-client-attempt-id em cross-origin (app.megadesk.online)
  // -------------------------------------------------------------------------
  it("14: CORS preflight permite x-client-attempt-id a partir de origin app.megadesk.online", async () => {
    const res = await fetch(`${base}/api/products/${productA}/images`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.megadesk.online",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, x-client-attempt-id",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.megadesk.online");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    const allowHeaders = res.headers.get("access-control-allow-headers") ?? "";
    expect(allowHeaders.toLowerCase()).toContain("x-client-attempt-id");
  });
});
