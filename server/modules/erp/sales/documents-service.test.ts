import { beforeEach, describe, expect, it, vi } from "vitest";
import { SaleDocumentService } from "./documents-service";
import type { SaleDocumentRow } from "./documents-repository";
import { ErpDomainError } from "../errors";

const tenant = "tenant-a";
const salePublicId = "11111111-1111-4111-8111-111111111111";
const documentPublicId = "22222222-2222-4222-8222-222222222222";

function row(state: SaleDocumentRow["state"] = "active"): SaleDocumentRow {
  return {
    id: 1,
    public_id: documentPublicId,
    client_id: tenant,
    sale_order_id: 10,
    sale_public_id: salePublicId,
    order_number: "VD-00001",
    crm_client_id: "crm-a",
    client_file_id: 20,
    file_public_id: "33333333-3333-4333-8333-333333333333",
    file_name: "nota.pdf",
    description: null,
    mime_type: "application/pdf",
    size_bytes: 14,
    sha256: "a".repeat(64),
    storage_key: "44444444-4444-4444-8444-444444444444",
    document_type: "invoice",
    upload_idempotency_key: "99999999-9999-4999-8999-999999999999",
    upload_payload_hash: "b".repeat(64),
    state,
    created_by: "admin-a",
    created_at: "2026-10-06T12:00:00.000Z",
    deleted_by: state === "active" ? null : "admin-a",
    deleted_at: state === "deleted" ? "2026-10-06T13:00:00.000Z" : null,
    pending_delete_at: state === "pending_delete" ? "2026-10-06T12:30:00.000Z" : null,
    created_by_name: "Ana Admin",
    deleted_by_name: state === "active" ? null : "Ana Admin",
  } as SaleDocumentRow;
}

function harness() {
  let current = row();
  let reservedKey: string | null = null;
  let reservedPayloadHash: string | null = null;
  const repository = {
    findOwner: vi.fn(async (clientId: string, publicId: string) => clientId === tenant && publicId === salePublicId ? { id: 10, public_id: salePublicId, order_number: "VD-00001", crm_client_id: "crm-a", lifecycle_state: "active" } : null),
    reserveUpload: vi.fn(async (clientId: string, publicId: string, data: any) => {
      if (clientId !== tenant || publicId !== salePublicId) {
        throw new ErpDomainError("NOT_FOUND", "Venda não encontrada.");
      }
      if (reservedKey === data.idempotencyKey) {
        if (reservedPayloadHash !== data.payloadHash) throw Object.assign(new Error("conflict"), { code: "IDEMPOTENCY_CONFLICT" });
        return { document: current, replay: true };
      }
      if (current.state === "pending_upload" && reservedPayloadHash === data.payloadHash) {
        return { document: current, replay: true };
      }
      reservedKey = data.idempotencyKey;
      reservedPayloadHash = data.payloadHash;
      current = { ...row("pending_upload"), public_id: data.documentPublicId, file_public_id: data.filePublicId, storage_key: data.storageKey, file_name: data.fileName, sha256: data.sha256, size_bytes: data.sizeBytes, document_type: data.documentType, upload_idempotency_key: data.idempotencyKey, upload_payload_hash: data.payloadHash };
      return { document: current, replay: false };
    }),
    finalizeUpload: vi.fn(async () => {
      current = { ...current, state: "active" };
      return current;
    }),
    findByUploadKey: vi.fn(async () => current),
    list: vi.fn(async (clientId: string, publicId: string) => clientId === tenant && publicId === salePublicId ? [current] : []),
    findByPublicId: vi.fn(async (clientId: string, publicId: string, id: string) => clientId === tenant && publicId === salePublicId && id === current.public_id ? current : null),
    transitionToPendingDelete: vi.fn(async (clientId: string, publicId: string, id: string) => {
      if (clientId !== tenant || publicId !== salePublicId || id !== current.public_id || current.state === "deleted") return null;
      current = { ...current, state: "pending_delete", deleted_by: "admin-a", pending_delete_at: "2026-10-06T12:30:00.000Z" };
      return current;
    }),
    finalizePendingDelete: vi.fn(async () => {
      current = { ...current, state: "deleted", pending_delete_at: null, deleted_at: "2026-10-06T13:00:00.000Z" };
      return current;
    }),
    customerSales: vi.fn(async () => ({ customerName: "Cliente", sales: [] })),
  };
  const storage = {
    write: vi.fn(async () => "path"),
    read: vi.fn(async () => Buffer.from("%PDF-1.7\n%EOF\n")),
    delete: vi.fn(async () => undefined),
  };
  return { repository, storage, service: new SaleDocumentService(repository as any, storage), current: () => current };
}

const admin = { clientId: tenant, userId: "admin-a", userName: "Ana Admin", role: "admin" as const };
const viewer = { ...admin, userId: "viewer-a", role: "viewer" as const };
const upload = {
  salePublicId,
  idempotencyKey: "99999999-9999-4999-8999-999999999999",
  documentType: "invoice" as const,
  fileName: "../nota.pdf",
  description: "Nota manual",
  mimeType: "application/pdf",
  base64: Buffer.from("%PDF-1.7\n%EOF\n").toString("base64"),
};

describe("sale documents service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps viewer reads and blocks viewer writes before storage mutation", async () => {
    const { service, storage } = harness();
    expect(await service.list(viewer, salePublicId)).toHaveLength(1);
    expect((await service.getForDownload(viewer, salePublicId, documentPublicId)).bytes.length).toBeGreaterThan(0);
    await expect(service.upload(viewer, upload)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.delete(viewer, { salePublicId, documentPublicId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("resolves the sale inside the tenant before writing one physical object", async () => {
    const { service, repository, storage } = harness();
    const created = await service.upload(admin, upload);
    expect(created.documentType).toBe("invoice");
    expect(created.fileName).not.toMatch(/[\\/]/);
    expect(created.fileName).toContain("nota.pdf");
    expect(repository.reserveUpload).toHaveBeenCalledWith(tenant, salePublicId, expect.objectContaining({ createdBy: "admin-a", idempotencyKey: upload.idempotencyKey }));
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(repository.finalizeUpload).toHaveBeenCalledTimes(1);

    await expect(service.upload({ ...admin, clientId: "tenant-b" }, upload)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(storage.write).toHaveBeenCalledTimes(1);
  });

  it("keeps a retryable reservation when finalization fails after the physical write", async () => {
    const { service, repository, storage } = harness();
    repository.finalizeUpload.mockRejectedValueOnce(new Error("synthetic finalization rollback"));
    await expect(service.upload(admin, upload)).rejects.toThrow("synthetic finalization rollback");
    expect(storage.write).toHaveBeenCalledTimes(1);
    await expect(service.upload(admin, upload)).resolves.toMatchObject({ state: "active" });
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(repository.reserveUpload).toHaveBeenCalledTimes(2);
    expect(repository.finalizeUpload).toHaveBeenCalledTimes(2);
  });

  it("returns an active idempotent replay without writing a second physical object", async () => {
    const { service, repository, storage } = harness();
    const first = await service.upload(admin, upload);
    const replay = await service.upload(admin, upload);
    expect(replay.publicId).toBe(first.publicId);
    expect(repository.reserveUpload).toHaveBeenCalledTimes(2);
    expect(storage.write).toHaveBeenCalledTimes(1);
  });

  it("rejects a divergent retry that reuses the upload key", async () => {
    const { service, storage } = harness();
    await service.upload(admin, upload);
    await expect(service.upload(admin, { ...upload, description: "Outro documento" }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(storage.write).toHaveBeenCalledTimes(1);
  });

  it("retries a missing physical object through the pending upload reservation", async () => {
    const { service, repository, storage } = harness();
    storage.write.mockRejectedValueOnce(new Error("synthetic storage failure"));
    storage.read.mockRejectedValue(new ErpDomainError("NOT_FOUND", "missing"));
    await expect(service.upload(admin, upload)).rejects.toThrow("synthetic storage failure");
    await expect(service.upload(admin, { ...upload, idempotencyKey: "88888888-8888-4888-8888-888888888888" }))
      .resolves.toMatchObject({ state: "active" });
    expect(repository.reserveUpload).toHaveBeenCalledTimes(2);
    expect(storage.write).toHaveBeenCalledTimes(2);
    expect(repository.finalizeUpload).toHaveBeenCalledTimes(1);
  });

  it("uses a retryable two-phase tombstone when physical deletion fails", async () => {
    const { service, repository, storage, current } = harness();
    storage.delete.mockRejectedValueOnce(new Error("synthetic delete failure"));
    await expect(service.delete(admin, { salePublicId, documentPublicId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(current().state).toBe("pending_delete");
    expect(repository.finalizePendingDelete).not.toHaveBeenCalled();

    await expect(service.delete(admin, { salePublicId, documentPublicId })).resolves.toEqual({ ok: true });
    expect(current().state).toBe("deleted");
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(repository.finalizePendingDelete).toHaveBeenCalledTimes(1);
  });

  it("rejects spoofed file content through the shared backend inspection", async () => {
    const { service, storage } = harness();
    await expect(service.upload(admin, {
      ...upload,
      base64: Buffer.from("MZ executable").toString("base64"),
    })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(storage.write).not.toHaveBeenCalled();
  });
});
