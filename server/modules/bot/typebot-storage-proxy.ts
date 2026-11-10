/**
 * Bot Module — Typebot S3 Storage Proxy & Public Media Server
 *
 * Implementa um servidor S3 minimalista e servidor público de mídias para o Typebot:
 * 1. PUT /typebot/*        → Recebe uploads binários do MinIO client (typebot-builder),
 *                            salva em disco local (/opt/megadesk/storage/typebot) e retorna ETag.
 * 2. HEAD/GET /typebot/*    → Responde checagens de bucket e localização do S3 (MinIO).
 * 3. GET /api/typebot-media/* → Serve mídias públicas (imagens, vídeos, áudios) para o builder,
 *                            preview e despacho para o WhatsApp (Evolution API).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg; codecs=opus",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
};

export function getTypebotStorageDir(): string {
  if (process.env.TYPEBOT_STORAGE_DIR) {
    return process.env.TYPEBOT_STORAGE_DIR;
  }
  if (process.env.NODE_ENV === "production") {
    return "/opt/megadesk/storage/typebot";
  }
  return path.resolve(process.cwd(), ".storage", "typebot");
}

export function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

function sanitizeRelativePath(rawPath: string): string | null {
  const decoded = decodeURIComponent(rawPath).replace(/\\/g, "/");
  const clean = path.normalize(decoded).replace(/^(\.\.[\/\\])+/, "").replace(/^\/+/, "");
  if (clean.includes("..") || clean.startsWith("/")) return null;
  return clean;
}

export function createTypebotStorageProxy() {
  const baseDir = getTypebotStorageDir();
  try {
    fs.mkdirSync(baseDir, { recursive: true });
  } catch (err) {
    console.warn(`[TypebotStorage] Falha ao criar diretório base ${baseDir}:`, err);
  }

  return function typebotStorageMiddleware(req: Request, res: Response, next: NextFunction): void {
    const rawUrl = req.url || req.originalUrl || "";
    const parsedPath = rawUrl.split("?")[0];

    // ─── 1. Endpoint Público de Mídias: GET /api/typebot-media/* ─────────────
    if (parsedPath.startsWith("/api/typebot-media/")) {
      const relPath = sanitizeRelativePath(parsedPath.slice("/api/typebot-media/".length));
      if (!relPath) {
        res.status(400).send("Invalid media path");
        return;
      }
      const fullPath = path.join(baseDir, relPath);
      if (!fs.existsSync(fullPath)) {
        res.status(404).send("Media not found");
        return;
      }

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("Content-Type", detectMimeType(fullPath));

      if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
      }
      if (req.method === "HEAD") {
        try {
          const stat = fs.statSync(fullPath);
          res.setHeader("Content-Length", stat.size);
          res.status(200).end();
        } catch {
          res.status(500).end();
        }
        return;
      }

      const stream = fs.createReadStream(fullPath);
      stream.on("error", (err) => {
        console.error(`[TypebotStorage] Erro ao servir mídia ${relPath}:`, err);
        if (!res.headersSent) res.status(500).end();
      });
      stream.pipe(res);
      return;
    }

    // ─── 2. S3 Endpoint: /typebot ou /typebot/* (chamadas do MinIO client) ───
    if (parsedPath === "/typebot" || parsedPath.startsWith("/typebot/")) {
      const objectPath = sanitizeRelativePath(parsedPath.slice("/typebot".length));

      // Checagem de localização do bucket (ex: GET /typebot?location)
      if (req.method === "GET" && (rawUrl.includes("?location") || !objectPath)) {
        res.setHeader("Content-Type", "application/xml");
        res.status(200).send(
          '<?xml version="1.0" encoding="UTF-8"?><LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">us-east-1</LocationConstraint>'
        );
        return;
      }

      // Checagem de existência do bucket (HEAD /typebot)
      if (req.method === "HEAD" && !objectPath) {
        res.status(200).end();
        return;
      }

      // Sem caminho de objeto especificado
      if (!objectPath) {
        res.status(200).end();
        return;
      }

      const fullPath = path.join(baseDir, objectPath);

      // S3 HEAD Object
      if (req.method === "HEAD") {
        if (!fs.existsSync(fullPath)) {
          res.status(404).end();
          return;
        }
        const stat = fs.statSync(fullPath);
        res.setHeader("Content-Length", stat.size);
        res.setHeader("Content-Type", detectMimeType(fullPath));
        res.setHeader("ETag", `"${crypto.createHash("md5").update(fullPath + stat.mtimeMs).digest("hex")}"`);
        res.status(200).end();
        return;
      }

      // S3 GET Object
      if (req.method === "GET") {
        if (!fs.existsSync(fullPath)) {
          res.status(404).send("Not found");
          return;
        }
        res.setHeader("Content-Type", detectMimeType(fullPath));
        const stream = fs.createReadStream(fullPath);
        stream.pipe(res);
        return;
      }

      // S3 DELETE Object
      if (req.method === "DELETE") {
        try {
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        } catch {}
        res.status(204).end();
        return;
      }

      // S3 PUT Object (Upload do Typebot Builder)
      if (req.method === "PUT") {
        try {
          const dir = path.dirname(fullPath);
          fs.mkdirSync(dir, { recursive: true });

          const hash = crypto.createHash("md5");
          const out = fs.createWriteStream(fullPath);

          req.on("data", (chunk: Buffer) => {
            hash.update(chunk);
          });

          req.pipe(out);

          out.on("finish", () => {
            const etag = hash.digest("hex");
            res.setHeader("ETag", `"${etag}"`);
            res.setHeader("x-amz-request-id", crypto.randomUUID());
            res.status(200).end();
            console.log(`[TypebotStorage] Arquivo salvo: ${objectPath} (${fullPath})`);
          });

          out.on("error", (err) => {
            console.error(`[TypebotStorage] Erro ao gravar arquivo ${objectPath}:`, err);
            if (!res.headersSent) res.status(500).send("Upload failed");
          });
        } catch (err: any) {
          console.error(`[TypebotStorage] Falha ao processar PUT ${objectPath}:`, err);
          if (!res.headersSent) res.status(500).send("Upload initialization failed");
        }
        return;
      }

      res.status(405).end();
      return;
    }

    next();
  };
}
