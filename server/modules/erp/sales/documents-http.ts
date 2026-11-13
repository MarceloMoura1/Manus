import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { getPool } from "../../../db";
import { resolveOperationalSessionReadOnly } from "../../../_core/megadesk-session";
import { buildContentDisposition } from "../suppliers/files-storage";
import { parseHttpByteRange } from "../suppliers/files-router";
import { ErpDomainError } from "../errors";
import { saleDocumentDownloadInput } from "./documents-contracts";
import { SaleDocumentService } from "./documents-service";

const service = new SaleDocumentService();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_CODE_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

export async function resolveSalePublicId(
  clientId: string,
  codeOrId: string
): Promise<string | null> {
  const trimmed = codeOrId.trim();
  if (!trimmed) return null;
  if (UUID_REGEX.test(trimmed)) {
    return trimmed;
  }
  if (!ORDER_CODE_REGEX.test(trimmed)) {
    return null;
  }
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.execute<any[]>(
    `SELECT public_id FROM erp_sale_orders WHERE client_id = ? AND order_number = ? LIMIT 1`,
    [clientId, trimmed]
  );
  if (rows && rows[0]?.public_id) {
    return String(rows[0].public_id);
  }
  return null;
}

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

export async function getSalePdfFile(
  identity: { clientId: string; userId: string; role: any; userName?: string | null },
  rawIdentifier: string,
  documentService: SaleDocumentService = service
): Promise<{ bytes: Buffer; mimeType: string; fileName: string } | null> {
  const salePublicId = await resolveSalePublicId(identity.clientId, rawIdentifier);
  if (!salePublicId) return null;
  const fullIdentity = {
    clientId: identity.clientId,
    userId: identity.userId,
    userName: identity.userName ?? null,
    role: identity.role,
  };
  try {
    const docs = await documentService.list(fullIdentity, salePublicId);
    const activeQuotePdf = docs.find(d => d.documentType === "quote_pdf" && d.state === "active");
    if (activeQuotePdf) {
      const downloaded = await documentService.getForDownload(
        fullIdentity,
        salePublicId,
        activeQuotePdf.publicId
      );
      if (downloaded?.bytes && downloaded.bytes.length > 0) {
        return downloaded;
      }
    }
  } catch (err) {
    console.warn("[getSalePdfFile] Arquivo físico ausente no storage, regerando PDF JIT:", err);
  }

  try {
    const { QuotePdfService } = await import("./quote-pdf-service");
    const quotePdfService = new QuotePdfService();
    const generated = await quotePdfService.generateWithBuffer(
      { ...fullIdentity, role: "admin" },
      {
        salePublicId,
        idempotencyKey: randomUUID(),
      }
    );
    if (generated?.bytes && generated.bytes.length > 0) {
      return {
        bytes: generated.bytes,
        mimeType: "application/pdf",
        fileName: generated.document.fileName,
      };
    }
  } catch (genErr) {
    console.warn("[getSalePdfFile] Fallback para renderQuotePdf em memória:", genErr);
  }

  const [{ SaleRepository }, { getCompanySettings }, { renderQuotePdf }] = await Promise.all([
    import("./repository"),
    import("../../../db-company"),
    import("./quote-pdf"),
  ]);
  const repo = new SaleRepository();
  const quote = await repo.detail(identity.clientId, salePublicId);
  if (!quote) return null;
  const company = await getCompanySettings(identity.clientId).catch(() => null);
  const bytes = renderQuotePdf({
    company: {
      name: company?.companyName ?? null,
      email: company?.primaryEmail ?? null,
      phone: company?.primaryPhone ?? null,
      whatsapp: company?.primaryWhatsapp ?? null,
      address: company?.address ?? null,
    },
    template: null,
    quote: {
      number: quote.orderNumber,
      issuedOn: quote.commercialDate,
      customerName: quote.customerName,
      customerPhone: (quote as any).customerPhone ?? null,
      customerAddress: (quote as any).customerAddress ?? null,
      customerAddressNumber: (quote as any).customerAddressNumber ?? null,
      commercialStatus: quote.commercialStatus,
      paymentTerms: quote.paymentTerms,
      notes: quote.notes,
      documentCustomName: (quote as any).documentCustomName ?? null,
      serviceMetadata: (quote as any).serviceMetadata ?? null,
      items: quote.items.map(item => ({
        description: item.productName,
        sku: item.sku,
        quantity: item.quantity,
        unit: item.unit,
        unitPriceCents: item.unitPriceCents,
        discountCents: item.discountCents,
        lineTotalCents: item.lineTotalCents,
      })),
      subtotalCents: quote.subtotalCents,
      discountCents: quote.discountCents,
      freightCents: quote.freightCents,
      chargesCents: quote.chargesCents,
      totalCents: quote.totalCents,
    },
  });
  return {
    bytes,
    mimeType: "application/pdf",
    fileName: `orcamento-${quote.orderNumber}.pdf`,
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
    if (
      !session.permissions.includes("erp") &&
      !session.permissions.includes("crm") &&
      !session.permissions.includes("conversations") &&
      !session.permissions.includes("active-attendance")
    ) {
      res.status(403).end();
      return;
    }
    const rawIdentifier = req.params.salePublicId || req.params.publicId || req.params.codeOrId;
    if (!rawIdentifier || typeof rawIdentifier !== "string") {
      res.status(400).end();
      return;
    }
    const headerTenant = req.headers["x-tenant-id"];
    const effectiveTenantId = (typeof headerTenant === "string" && headerTenant.trim())
      ? headerTenant.trim()
      : session.tenantId;

    if (effectiveTenantId !== session.tenantId && session.role !== "admin") {
      res.status(403).end();
      return;
    }

    try {
      const identity = {
        clientId: effectiveTenantId,
        userId: session.userId,
        userName: null,
        role: session.role,
      };
      const file = await getSalePdfFile(identity, rawIdentifier, documentService);
      if (!file) {
        res.status(404).end();
        return;
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
  const directPdfHandler = createDirectSalePdfDownloadHandler();

  app.get(
    "/api/erp/sales/:salePublicId/documents/:documentPublicId",
    createSaleDocumentDownloadHandler()
  );
  app.get(
    "/api/erp/sales/:salePublicId/pdf",
    directPdfHandler
  );
  app.get(
    "/api/crm/quotes/:codeOrId/pdf",
    directPdfHandler
  );
}
