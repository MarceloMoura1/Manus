import express, { type RequestHandler } from "express";
import { SUPPLIER_FILE_MAX_BASE64_LENGTH } from "../modules/erp/suppliers/files-service";

const SUPPLIER_UPLOAD_PROCEDURE = "erp.suppliers.files.upload";
// Bounded JSON metadata/escaping overhead beyond the canonical 20 MiB base64.
export const SUPPLIER_FILE_UPLOAD_HTTP_LIMIT_BYTES = SUPPLIER_FILE_MAX_BASE64_LENGTH + 32 * 1024;

export function requestContainsSupplierUpload(pathname: string): boolean {
  return pathname.replace(/^\//, "").split(",").includes(SUPPLIER_UPLOAD_PROCEDURE);
}

/** Applies the smaller parser before the global parser allocates up to 50 MiB. */
export function createSupplierUploadIngressMiddleware(
  limitBytes = SUPPLIER_FILE_UPLOAD_HTTP_LIMIT_BYTES,
): RequestHandler {
  const parser = express.json({ limit: limitBytes });
  return (req, res, next) => {
    if (req.method !== "POST" || !requestContainsSupplierUpload(req.path)) return next();
    const contentLength = Number(req.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > limitBytes) {
      res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
      return;
    }
    if (!req.is("application/json")) {
      res.status(415).json({ error: "UNSUPPORTED_MEDIA_TYPE" });
      return;
    }
    parser(req, res, next);
  };
}
