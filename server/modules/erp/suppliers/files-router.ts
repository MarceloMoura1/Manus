import type { Express, Request, Response } from "express";
import { TRPCError } from "@trpc/server";
import { megadeskProcedure, router } from "../../../_core/trpc";
import { resolveOperationalSessionReadOnly } from "../../../_core/megadesk-session";
import { ErpDomainError, erpTrpcCode } from "../errors";
import {
  supplierFileDeleteInput,
  supplierFileListInput,
  supplierFileUploadInput,
} from "./files-contracts";
import { SupplierFileService } from "./files-service";
import { buildContentDisposition } from "./files-storage";

const service = new SupplierFileService();

type Context = {
  tenantId: string;
  operationalUserId: string;
  operationalUserRole: "admin" | "manager" | "agent" | "viewer";
};

const identity = (ctx: Context) => ({
  clientId: ctx.tenantId,
  userId: ctx.operationalUserId,
  role: ctx.operationalUserRole,
});

async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ErpDomainError) {
      throw new TRPCError({ code: erpTrpcCode(error), message: error.message });
    }
    throw error;
  }
}

export const supplierFilesRouter = router({
  list: megadeskProcedure.input(supplierFileListInput).query(({ input, ctx }) =>
    run(() => service.list(identity(ctx), input))
  ),
  upload: megadeskProcedure.input(supplierFileUploadInput).mutation(({ input, ctx }) =>
    run(() => service.upload(identity(ctx), input))
  ),
  delete: megadeskProcedure.input(supplierFileDeleteInput).mutation(({ input, ctx }) =>
    run(() => service.delete(identity(ctx), input))
  ),
});

export type ByteRange = {
  start: number;
  end: number;
};

export function parseHttpByteRange(rangeHeader: string | undefined, totalBytes: number): ByteRange | null | "INVALID" {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) {
    return null;
  }
  const spec = rangeHeader.slice(6).trim();
  if (spec.includes(",")) {
    return "INVALID";
  }
  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match) {
    return "INVALID";
  }
  const [, startStr, endStr] = match;
  if (!startStr && !endStr) {
    return "INVALID";
  }

  let start: number;
  let end: number;

  if (!startStr) {
    const suffix = parseInt(endStr, 10);
    if (suffix <= 0) return "INVALID";
    start = Math.max(0, totalBytes - suffix);
    end = totalBytes - 1;
  } else if (!endStr) {
    start = parseInt(startStr, 10);
    end = totalBytes - 1;
  } else {
    start = parseInt(startStr, 10);
    end = parseInt(endStr, 10);
  }

  if (start < 0 || start >= totalBytes || end < start) {
    return "INVALID";
  }

  end = Math.min(end, totalBytes - 1);
  return { start, end };
}

export function createSupplierFileDownloadHandler(
  fileService: SupplierFileService = service,
  sessionResolver: typeof resolveOperationalSessionReadOnly = resolveOperationalSessionReadOnly
) {
  return async (req: Request, res: Response): Promise<void> => {
    const session = await sessionResolver(req);
    if (!session) {
      res.status(401).end();
      return;
    }

    const { supplierPublicId, filePublicId } = req.params;
    if (!supplierPublicId || !filePublicId) {
      res.status(400).end();
      return;
    }

    try {
      const file = await fileService.getFileForDownload(
        {
          clientId: session.tenantId,
          userId: session.userId,
          role: session.role,
        },
        supplierPublicId,
        filePublicId
      );

      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "sandbox");
      res.setHeader("Content-Type", file.mimeType);
      res.setHeader("Accept-Ranges", "bytes");

      const previewableTypes = new Set([
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
      ]);
      const wantsPreview = req.query.preview === "1" || req.query.inline === "1";
      const disposition = wantsPreview && previewableTypes.has(file.mimeType) ? "inline" : "attachment";
      res.setHeader("Content-Disposition", buildContentDisposition(file.fileName, disposition));

      const totalBytes = file.bytes.length;
      const range = parseHttpByteRange(req.headers.range, totalBytes);

      if (range === "INVALID") {
        res.setHeader("Content-Range", `bytes */${totalBytes}`);
        res.status(416).end();
        return;
      }

      if (range) {
        const chunk = file.bytes.subarray(range.start, range.end + 1);
        res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${totalBytes}`);
        res.setHeader("Content-Length", String(chunk.length));
        res.status(206).send(chunk);
        return;
      }

      res.setHeader("Content-Length", String(totalBytes));
      res.status(200).send(file.bytes);
    } catch (error) {
      if (error instanceof ErpDomainError) {
        if (error.code === "NOT_FOUND") {
          res.status(404).end();
          return;
        }
        if (error.code === "FORBIDDEN") {
          res.status(403).end();
          return;
        }
        if (error.code === "VALIDATION") {
          res.status(400).end();
          return;
        }
      }
      res.status(500).end();
    }
  };
}

export function registerSupplierFileRoutes(app: Express): void {
  app.get(
    "/api/erp/suppliers/:supplierPublicId/files/:filePublicId",
    createSupplierFileDownloadHandler()
  );
}
