import type { Express, Request, Response } from "express";
import { resolveOperationalSessionReadOnly } from "../../../_core/megadesk-session";
import { buildContentDisposition } from "../suppliers/files-storage";
import { parseHttpByteRange } from "../suppliers/files-router";
import { ErpDomainError } from "../errors";
import { saleDocumentDownloadInput } from "./documents-contracts";
import { SaleDocumentService } from "./documents-service";

const service = new SaleDocumentService();

export function createSaleDocumentDownloadHandler(
  documentService: SaleDocumentService = service,
  sessionResolver: typeof resolveOperationalSessionReadOnly = resolveOperationalSessionReadOnly
) {
  return async (req: Request, res: Response): Promise<void> => {
    const session = await sessionResolver(req);
    if (!session) {
      res.status(401).end();
      return;
    }
    if (!session.permissions.includes("erp")) {
      res.status(403).end();
      return;
    }
    const parsed = saleDocumentDownloadInput.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).end();
      return;
    }
    try {
      const file = await documentService.getForDownload(
        {
          clientId: session.tenantId,
          userId: session.userId,
          userName: null,
          role: session.role,
        },
        parsed.data.salePublicId,
        parsed.data.documentPublicId
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "sandbox");
      res.setHeader("Content-Type", file.mimeType);
      res.setHeader("Accept-Ranges", "bytes");
      const previewable = new Set([
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
      ]);
      const preview = req.query.preview === "1" || req.query.inline === "1";
      res.setHeader(
        "Content-Disposition",
        buildContentDisposition(
          file.fileName,
          preview && previewable.has(file.mimeType) ? "inline" : "attachment"
        )
      );
      const range = parseHttpByteRange(req.headers.range, file.bytes.length);
      if (range === "INVALID") {
        res.setHeader("Content-Range", `bytes */${file.bytes.length}`);
        res.status(416).end();
        return;
      }
      if (range) {
        const chunk = file.bytes.subarray(range.start, range.end + 1);
        res.setHeader(
          "Content-Range",
          `bytes ${range.start}-${range.end}/${file.bytes.length}`
        );
        res.setHeader("Content-Length", String(chunk.length));
        res.status(206).send(chunk);
        return;
      }
      res.setHeader("Content-Length", String(file.bytes.length));
      res.status(200).send(file.bytes);
    } catch (error) {
      if (error instanceof ErpDomainError) {
        res.status(
          error.code === "NOT_FOUND"
            ? 404
            : error.code === "FORBIDDEN"
              ? 403
              : 400
        ).end();
        return;
      }
      res.status(500).end();
    }
  };
}

export function registerSaleDocumentRoutes(app: Express): void {
  app.get(
    "/api/erp/sales/:salePublicId/documents/:documentPublicId",
    createSaleDocumentDownloadHandler()
  );
}
