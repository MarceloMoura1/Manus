import type { Express, Request, Response } from "express";
import { TRPCError } from "@trpc/server";
import { megadeskProcedure, router } from "../../../_core/trpc";
import { resolveOperationalSessionReadOnly } from "../../../_core/megadesk-session";
import { hasCrmAccess, requireCrmAccess } from "../../../crm-access";
import { ErpDomainError, erpTrpcCode } from "../../erp/errors";
import { buildContentDisposition } from "../../erp/suppliers/files-storage";
import { parseHttpByteRange } from "../../erp/suppliers/files-router";
import { clientFileDeleteInput, clientFileDownloadInput, clientFileListInput, clientFileUploadInput } from "./files-contracts";
import { ClientFileService } from "./files-service";

const service = new ClientFileService();

type Context = {
  tenantId: string;
  operationalUserId: string;
  operationalUserRole: "admin" | "manager" | "agent" | "viewer";
  operationalPermissions?: string[];
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

export const clientFilesRouter = router({
  list: megadeskProcedure.input(clientFileListInput).query(({ input, ctx }) => {
    requireCrmAccess(ctx);
    return run(() => service.list(identity(ctx), input));
  }),
  upload: megadeskProcedure.input(clientFileUploadInput).mutation(({ input, ctx }) => {
    requireCrmAccess(ctx);
    return run(() => service.upload(identity(ctx), input));
  }),
  delete: megadeskProcedure.input(clientFileDeleteInput).mutation(({ input, ctx }) => {
    requireCrmAccess(ctx);
    return run(() => service.delete(identity(ctx), input));
  }),
});

export function createClientFileDownloadHandler(
  fileService: ClientFileService = service,
  sessionResolver: typeof resolveOperationalSessionReadOnly = resolveOperationalSessionReadOnly
) {
  return async (req: Request, res: Response): Promise<void> => {
    const session = await sessionResolver(req);
    if (!session) {
      res.status(401).end();
      return;
    }
    if (!hasCrmAccess({ operationalUserRole: session.role, operationalPermissions: session.permissions })) {
      res.status(403).end();
      return;
    }
    const parsedParams = clientFileDownloadInput.safeParse(req.params);
    if (!parsedParams.success) {
      res.status(400).end();
      return;
    }
    const { crmClientId, filePublicId } = parsedParams.data;
    try {
      const file = await fileService.getFileForDownload(
        { clientId: session.tenantId, userId: session.userId, role: session.role },
        crmClientId,
        filePublicId
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "sandbox");
      res.setHeader("Content-Type", file.mimeType);
      res.setHeader("Accept-Ranges", "bytes");
      const previewableTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
      const preview = req.query.preview === "1" || req.query.inline === "1";
      res.setHeader("Content-Disposition", buildContentDisposition(file.fileName, preview && previewableTypes.has(file.mimeType) ? "inline" : "attachment"));
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
        res.status(error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : 400).end();
        return;
      }
      res.status(500).end();
    }
  };
}

export function registerClientFileRoutes(app: Express): void {
  app.get("/api/crm/clients/:crmClientId/files/:filePublicId", createClientFileDownloadHandler());
}
