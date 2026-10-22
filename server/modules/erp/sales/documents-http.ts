import { randomUUID } from "node:crypto";
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

export function createDirectSalePdfDownloadHandler(
  documentService: SaleDocumentService = service,
  sessionResolver: typeof resolveOperationalSessionReadOnly = resolveOperationalSessionReadOnly
) {
  return async (req: Request, res: Response): Promise<void> => {
    const session = await sessionResolver(req);
    if (!session) {
      res.status(401).end();
      return;
    }
    if (!session.permissions.includes("erp") && !session.permissions.includes("crm")) {
      res.status(403).end();
      return;
    }
    const salePublicId = req.params.salePublicId || req.params.publicId;
    if (!salePublicId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(salePublicId)) {
      res.status(400).end();
      return;
    }
    try {
      const identity = {
        clientId: session.tenantId,
        userId: session.userId,
        userName: null,
        role: session.role,
      };
      const docs = await documentService.list(identity, salePublicId);
      const activeQuotePdf = docs.find(d => d.documentType === "quote_pdf" && d.state === "active");
      let file: { bytes: Buffer; mimeType: string; fileName: string };
      if (activeQuotePdf) {
        file = await documentService.getForDownload(identity, salePublicId, activeQuotePdf.publicId);
      } else {
        const { QuotePdfService } = await import("./quote-pdf-service");
        const quotePdfService = new QuotePdfService();
        const generated = await quotePdfService.generateWithBuffer(identity, {
          salePublicId,
          idempotencyKey: randomUUID(),
        });
        file = {
          bytes: generated.bytes,
          mimeType: "application/pdf",
          fileName: generated.document.fileName,
        };
      }
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "sandbox");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        buildContentDisposition(file.fileName, "inline")
      );
      res.setHeader("Content-Length", String(file.bytes.length));
      res.status(200).send(file.bytes);
    } catch (error) {
      if (error instanceof ErpDomainError) {
        res.status(error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : 400).end();
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
  app.get(
    "/api/erp/sales/:salePublicId/pdf",
    createDirectSalePdfDownloadHandler()
  );
}
