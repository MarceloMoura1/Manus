import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ErpDomainError } from "../../erp/errors";
import { ClientFileRepository, type ClientFileRow } from "./files-repository";
import { ClientFileService } from "./files-service";
import {
  getTenantCrmClientFilesDirectory,
  resolveCrmClientFilePath,
  sanitizeFileName,
  validateAndInspectFile,
} from "./files-storage";

const tenantA = "tenant-alpha";
const tenantB = "tenant-beta";
const clientA1 = "crm-11111111-1111-4111-8111-111111111111";
const clientA2 = "crm-22222222-2222-4222-8222-222222222222";
const clientB1 = "crm-33333333-3333-4333-8333-333333333333";
const missingFile = "44444444-4444-4444-8444-444444444444";

type Owner = { crmClientId: string; lifecycleState: "active" | "inactive" | "archived" };

function createRepository() {
  const files: ClientFileRow[] = [];
  const owners = new Map<string, Owner>([
    [tenantA + ":" + clientA1, { crmClientId: clientA1, lifecycleState: "active" }],
    [tenantA + ":" + clientA2, { crmClientId: clientA2, lifecycleState: "active" }],
    [tenantB + ":" + clientB1, { crmClientId: clientB1, lifecycleState: "active" }],
  ]);
  let nextId = 1;
  const repository = {
    findClient: vi.fn(async (clientId: string, crmClientId: string) => owners.get(clientId + ":" + crmClientId) ?? null),
    insertFile: vi.fn(async (clientId: string, crmClientId: string, data: any) => {
      const row = {
        id: nextId++,
        public_id: data.publicId,
        client_id: clientId,
        crm_client_id: crmClientId,
        file_name: data.fileName,
        category: data.category,
        description: data.description,
        mime_type: data.mimeType,
        size_bytes: data.sizeBytes,
        sha256: data.sha256,
        storage_key: data.storageKey,
        state: "active",
        created_by: data.createdBy,
        created_at: new Date().toISOString(),
        deleted_by: null,
        deleted_at: null,
        pending_delete_at: null,
        created_by_name: "Ana Operadora",
        deleted_by_name: null,
      } as ClientFileRow;
      files.push(row);
      return row;
    }),
    list: vi.fn(async (clientId: string, crmClientId: string, options: { category?: string; includeDeleted?: boolean } = {}) =>
      files.filter(file =>
        file.client_id === clientId
        && file.crm_client_id === crmClientId
        && (options.includeDeleted || file.state === "active")
        && (!options.category || file.category === options.category)
      )
    ),
    findByPublicId: vi.fn(async (clientId: string, crmClientId: string, filePublicId: string) =>
      files.find(file => file.client_id === clientId && file.crm_client_id === crmClientId && file.public_id === filePublicId) ?? null
    ),
    transitionToPendingDelete: vi.fn(async (clientId: string, crmClientId: string, filePublicId: string, userId: string) => {
      const file = files.find(item => item.client_id === clientId && item.crm_client_id === crmClientId && item.public_id === filePublicId);
      if (!file || file.state === "deleted") return null;
      if (file.state === "pending_delete") return file;
      file.state = "pending_delete";
      file.deleted_by = userId;
      file.pending_delete_at = new Date().toISOString();
      return file;
    }),
    finalizePendingDelete: vi.fn(async (clientId: string, crmClientId: string, filePublicId: string) => {
      const file = files.find(item => item.client_id === clientId && item.crm_client_id === crmClientId && item.public_id === filePublicId);
      if (!file || file.state !== "pending_delete") return file?.state === "deleted" ? file : null;
      file.state = "deleted";
      file.deleted_at = new Date().toISOString();
      file.pending_delete_at = null;
      return file;
    }),
  };
  return { repository: repository as unknown as ClientFileRepository, files };
}

function uploadInput(crmClientId: string, name = "contrato.pdf") {
  return {
    crmClientId,
    fileName: name,
    category: "contracts" as const,
    description: "Contrato comercial",
    mimeType: "application/pdf",
    base64: Buffer.from("%PDF-1.7\n%EOF\n").toString("base64"),
  };
}

describe("Client Files — tenant scoped persistence", () => {
  let tempMediaRoot: string;

  beforeEach(async () => {
    tempMediaRoot = await mkdtemp(path.join(os.tmpdir(), "megadesk-client-files-unit-"));
    process.env.MEGADESK_MEDIA_TEST_RUN_ID = "client-files-unit";
    process.env.MEGADESK_MEDIA_ROOT = tempMediaRoot;
  });

  afterEach(async () => {
    delete process.env.MEGADESK_MEDIA_ROOT;
    delete process.env.MEGADESK_MEDIA_TEST_RUN_ID;
    await rm(tempMediaRoot, { recursive: true, force: true });
  });

  it("lists only the files of the CRM client and tenant that own them", async () => {
    const { repository } = createRepository();
    const service = new ClientFileService(repository);
    const adminA = { clientId: tenantA, userId: "admin-a", role: "admin" as const };

    await service.upload(adminA, uploadInput(clientA1));
    await service.upload(adminA, uploadInput(clientA2, "proposta.pdf"));

    expect(await service.list(adminA, { crmClientId: clientA1 })).toHaveLength(1);
    expect(await service.list(adminA, { crmClientId: clientA2 })).toHaveLength(1);
    await expect(service.list({ clientId: tenantB, userId: "admin-b", role: "admin" }, { crmClientId: clientA1 })).rejects.toMatchObject({
      message: "Cliente não encontrado.",
    });
  });

  it("denies upload, download and delete for another tenant before any file lookup", async () => {
    const { repository } = createRepository();
    const service = new ClientFileService(repository);
    const adminA = { clientId: tenantA, userId: "admin-a", role: "admin" as const };
    const uploaded = await service.upload(adminA, uploadInput(clientA1));
    const adminB = { clientId: tenantB, userId: "admin-b", role: "admin" as const };

    await expect(service.upload(adminB, uploadInput(clientA1))).rejects.toThrow("Cliente não encontrado.");
    await expect(service.getFileForDownload(adminB, clientA1, uploaded.publicId)).rejects.toThrow("Cliente não encontrado.");
    await expect(service.delete(adminB, { crmClientId: clientA1, filePublicId: uploaded.publicId })).rejects.toThrow("Cliente não encontrado.");
  });

  it("persists correct metadata, physically removes the object, and leaves a deleted tombstone", async () => {
    const { repository, files } = createRepository();
    const service = new ClientFileService(repository);
    const adminA = { clientId: tenantA, userId: "admin-a", role: "admin" as const };
    const uploaded = await service.upload(adminA, uploadInput(clientA1, "../../contrato cliente.pdf"));

    expect(uploaded.crmClientId).toBe(clientA1);
    expect(uploaded.fileName).not.toContain("/");
    expect(files[0]).toMatchObject({ client_id: tenantA, crm_client_id: clientA1, category: "contracts", state: "active" });
    expect(await service.list(adminA, { crmClientId: clientA1 })).toHaveLength(1);
    const physicalPath = resolveCrmClientFilePath(tenantA, files[0].storage_key, tempMediaRoot);
    await expect(access(physicalPath)).resolves.toBeUndefined();
    expect(await service.delete(adminA, { crmClientId: clientA1, filePublicId: uploaded.publicId })).toEqual({ ok: true });
    expect(await service.list(adminA, { crmClientId: clientA1 })).toHaveLength(0);
    await expect(access(physicalPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(files[0]).toMatchObject({ state: "deleted", deleted_by: "admin-a", pending_delete_at: null });
    await expect(service.getFileForDownload(adminA, clientA1, missingFile)).rejects.toThrow("Arquivo não encontrado ou indisponível.");
  });

  it("keeps pending_delete blocking on physical failure and converges safely on retry", async () => {
    const { repository, files } = createRepository();
    const adminA = { clientId: tenantA, userId: "admin-a", role: "admin" as const };
    const failingService = new ClientFileService(repository, async () => {
      throw new Error("SYNTHETIC_PHYSICAL_DELETE_FAILURE");
    });
    const uploaded = await failingService.upload(adminA, uploadInput(clientA1));
    const physicalPath = resolveCrmClientFilePath(tenantA, files[0].storage_key, tempMediaRoot);

    await expect(failingService.delete(adminA, { crmClientId: clientA1, filePublicId: uploaded.publicId }))
      .rejects.toThrow("O arquivo permanece pendente para nova tentativa.");
    expect(files[0]).toMatchObject({ state: "pending_delete", deleted_by: "admin-a", deleted_at: null });
    await expect(access(physicalPath)).resolves.toBeUndefined();

    const retryService = new ClientFileService(repository);
    await expect(retryService.delete(adminA, { crmClientId: clientA1, filePublicId: uploaded.publicId })).resolves.toEqual({ ok: true });
    expect(files[0]).toMatchObject({ state: "deleted", pending_delete_at: null });
    await expect(access(physicalPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((repository as any).transitionToPendingDelete).toHaveBeenCalledTimes(2);
    expect((repository as any).finalizePendingDelete).toHaveBeenCalledTimes(1);
  });

  it("uses the existing safe filename, path and content policies in a distinct CRM namespace", async () => {
    expect(sanitizeFileName("../../arquivo.pdf")).not.toContain("/");
    expect(() => resolveCrmClientFilePath(tenantA, "../traversal", tempMediaRoot)).toThrow(ErpDomainError);
    expect(getTenantCrmClientFilesDirectory(tenantA, tempMediaRoot)).toContain(path.join("tenants", tenantA, "crm-client-files"));
    await expect(validateAndInspectFile(Buffer.alloc(0), "application/pdf")).rejects.toThrow("Arquivo vazio não é permitido.");
    await expect(validateAndInspectFile(Buffer.alloc(20 * 1024 * 1024 + 1), "application/pdf")).rejects.toThrow("Arquivo excede o limite máximo de 20 MB.");
    await expect(validateAndInspectFile(Buffer.from("MZ executable"), "application/pdf")).rejects.toThrow("Tipo de arquivo não permitido");
  });
});
