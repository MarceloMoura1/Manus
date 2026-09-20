import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SupplierFileService } from "./files-service";
import { SupplierFileRepository, type SupplierFileRow } from "./files-repository";
import { resolveSupplierFilePath } from "./files-storage";
import { ErpDomainError } from "../errors";

describe("Supplier Files — Domain Service & Atomicity", () => {
  let tempMediaRoot: string;
  const tenantA = "tenant-alpha";
  const tenantB = "tenant-beta";
  const supplierIdA = 10;
  const supplierPublicIdA = "11111111-1111-4111-8111-111111111111";
  const supplierPublicIdB = "22222222-2222-4222-8222-222222222222";

  const testRunId = "supplier-files-unit";

  beforeEach(async () => {
    process.env.MEGADESK_MEDIA_TEST_RUN_ID = testRunId;
    tempMediaRoot = await mkdtemp(path.join(os.tmpdir(), `megadesk-${testRunId}-`));
    process.env.MEGADESK_MEDIA_ROOT = tempMediaRoot;
  });

  afterEach(async () => {
    delete process.env.MEGADESK_MEDIA_ROOT;
    delete process.env.MEGADESK_MEDIA_TEST_RUN_ID;
    await rm(tempMediaRoot, { recursive: true, force: true });
  });

  function createMockRepo(overrides: Partial<SupplierFileRepository> = {}): SupplierFileRepository {
    const memoryFiles: SupplierFileRow[] = [];
    let nextId = 1;

    const defaultRepo = {
      findSupplier: vi.fn(async (clientId: string, pubId: string) => {
        if (clientId === tenantA && pubId === supplierPublicIdA) {
          return { id: supplierIdA, publicId: supplierPublicIdA, active: true };
        }
        return null;
      }),
      insertFile: vi.fn(async (clientId: string, supId: number, data: any) => {
        const row: SupplierFileRow = {
          id: nextId++,
          public_id: data.publicId,
          client_id: clientId,
          supplier_id: supId,
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
          created_by_name: "Administrador Geral",
          deleted_by_name: null,
        } as SupplierFileRow;
        memoryFiles.push(row);
        return row;
      }),
      list: vi.fn(async (clientId: string, supId: number, options: any = {}) => {
        return memoryFiles.filter(f => {
          if (f.client_id !== clientId || f.supplier_id !== supId) return false;
          if (!options.includeDeleted && f.state !== "active") return false;
          if (options.category && f.category !== options.category) return false;
          return true;
        });
      }),
      findById: vi.fn(async (clientId: string, supId: number, id: number) => {
        return memoryFiles.find(f => f.client_id === clientId && f.supplier_id === supId && f.id === id) ?? null;
      }),
      findByPublicId: vi.fn(async (clientId: string, supId: number, pubId: string) => {
        return memoryFiles.find(f => f.client_id === clientId && f.supplier_id === supId && f.public_id === pubId) ?? null;
      }),
      softDelete: vi.fn(async (clientId: string, supId: number, pubId: string, userId: string) => {
        const file = memoryFiles.find(f => f.client_id === clientId && f.supplier_id === supId && f.public_id === pubId && f.state === "active");
        if (!file) return false;
        file.state = "deleted";
        file.deleted_by = userId;
        file.deleted_at = new Date().toISOString();
        file.deleted_by_name = "Administrador Geral";
        return true;
      }),
    };

    return Object.assign(defaultRepo, overrides) as unknown as SupplierFileRepository;
  }

  // ─── 1. Tenant & Supplier Isolation ───────────────────────────────────────
  it("rejects operations across tenants with NOT_FOUND", async () => {
    const repo = createMockRepo();
    const service = new SupplierFileService(repo);

    // Tenant B trying to access Tenant A's supplier
    await expect(
      service.list({ clientId: tenantB, userId: "user-b", role: "admin" }, { supplierPublicId: supplierPublicIdA })
    ).rejects.toThrow("Fornecedor não encontrado.");

    await expect(
      service.upload(
        { clientId: tenantB, userId: "user-b", role: "admin" },
        {
          supplierPublicId: supplierPublicIdA,
          fileName: "contrato.pdf",
          category: "contracts",
          mimeType: "application/pdf",
          base64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
        }
      )
    ).rejects.toThrow("Fornecedor não encontrado.");
  });

  it("rejects cross-supplier file access with NOT_FOUND", async () => {
    const repo = createMockRepo();
    const service = new SupplierFileService(repo);

    // File uploaded for supplier A
    const uploaded = await service.upload(
      { clientId: tenantA, userId: "admin-1", role: "admin" },
      {
        supplierPublicId: supplierPublicIdA,
        fileName: "contrato.pdf",
        category: "contracts",
        mimeType: "application/pdf",
        base64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
      }
    );

    // Attempting to download file using Supplier B's publicId
    await expect(
      service.getFileForDownload(
        { clientId: tenantA, userId: "admin-1", role: "admin" },
        supplierPublicIdB,
        uploaded.publicId
      )
    ).rejects.toThrow("Fornecedor não encontrado.");
  });

  // ─── 2. Inactive Supplier Guard ───────────────────────────────────────────
  it("rejects uploading files to an inactive supplier", async () => {
    const repo = createMockRepo({
      findSupplier: vi.fn(async () => ({ id: supplierIdA, publicId: supplierPublicIdA, active: false })),
    });
    const service = new SupplierFileService(repo);

    await expect(
      service.upload(
        { clientId: tenantA, userId: "admin-1", role: "admin" },
        {
          supplierPublicId: supplierPublicIdA,
          fileName: "tabela.csv",
          category: "price_tables",
          mimeType: "text/csv",
          base64: Buffer.from("item,preco\n1,10").toString("base64"),
        }
      )
    ).rejects.toThrow("Não é possível anexar arquivos a um fornecedor inativo.");
  });

  // ─── 3. Authorization Role Guards ─────────────────────────────────────────
  it("restricts upload and delete to admin or manager roles", async () => {
    const repo = createMockRepo();
    const service = new SupplierFileService(repo);

    // Viewer role
    await expect(
      service.upload(
        { clientId: tenantA, userId: "viewer-1", role: "viewer" },
        {
          supplierPublicId: supplierPublicIdA,
          fileName: "doc.pdf",
          category: "contracts",
          mimeType: "application/pdf",
          base64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
        }
      )
    ).rejects.toThrow("Seu perfil não permite gerenciar arquivos de fornecedores.");

    // Agent role
    await expect(
      service.delete(
        { clientId: tenantA, userId: "agent-1", role: "agent" },
        { supplierPublicId: supplierPublicIdA, filePublicId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d" }
      )
    ).rejects.toThrow("Seu perfil não permite gerenciar arquivos de fornecedores.");
  });

  // ─── 4. Upload Atomicity & Compensating Cleanup ────────────────────────────
  it("removes written disk file if database insertion throws", async () => {
    let capturedStorageKey: string | null = null;

    const repo = createMockRepo({
      insertFile: vi.fn(async (_clientId: string, _supId: number, data: any) => {
        capturedStorageKey = data.storageKey;
        throw new Error("DB_SIMULATED_FAILURE");
      }),
    });
    const service = new SupplierFileService(repo);

    await expect(
      service.upload(
        { clientId: tenantA, userId: "admin-1", role: "admin" },
        {
          supplierPublicId: supplierPublicIdA,
          fileName: "contrato.pdf",
          category: "contracts",
          mimeType: "application/pdf",
          base64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
        }
      )
    ).rejects.toThrow("DB_SIMULATED_FAILURE");

    expect(capturedStorageKey).not.toBeNull();
    const diskPath = resolveSupplierFilePath(tenantA, capturedStorageKey!, tempMediaRoot);
    expect(existsSync(diskPath)).toBe(false); // Compensating cleanup cleaned up disk!
  });

  // ─── 5. Soft Delete Semantics & Download Exclusion ────────────────────────
  it("performs soft delete, excludes from list and prevents download", async () => {
    const repo = createMockRepo();
    const service = new SupplierFileService(repo);

    const uploaded = await service.upload(
      { clientId: tenantA, userId: "admin-1", role: "admin" },
      {
        supplierPublicId: supplierPublicIdA,
        fileName: "proposta.pdf",
        category: "contracts",
        mimeType: "application/pdf",
        base64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
      }
    );

    // List shows active file
    let list = await service.list(
      { clientId: tenantA, userId: "user-1", role: "viewer" },
      { supplierPublicId: supplierPublicIdA }
    );
    expect(list.length).toBe(1);
    expect(list[0].publicId).toBe(uploaded.publicId);

    // Soft delete
    const deleteResult = await service.delete(
      { clientId: tenantA, userId: "admin-1", role: "admin" },
      { supplierPublicId: supplierPublicIdA, filePublicId: uploaded.publicId }
    );
    expect(deleteResult.ok).toBe(true);

    // Default list excludes deleted file
    list = await service.list(
      { clientId: tenantA, userId: "user-1", role: "viewer" },
      { supplierPublicId: supplierPublicIdA }
    );
    expect(list.length).toBe(0);

    // Include deleted returns the file with state 'deleted'
    const listWithDeleted = await service.list(
      { clientId: tenantA, userId: "user-1", role: "viewer" },
      { supplierPublicId: supplierPublicIdA, includeDeleted: true }
    );
    expect(listWithDeleted.length).toBe(1);
    expect(listWithDeleted[0].state).toBe("deleted");
    expect(listWithDeleted[0].deletedByName).toBe("Administrador Geral");

    // Download rejects deleted file with NOT_FOUND
    await expect(
      service.getFileForDownload(
        { clientId: tenantA, userId: "user-1", role: "viewer" },
        supplierPublicIdA,
        uploaded.publicId
      )
    ).rejects.toThrow("Arquivo não encontrado ou indisponível.");
  });

  // ─── 6. Information Exposure Guard ────────────────────────────────────────
  it("never exposes internal storage key, disk path or database ID in public DTO", async () => {
    const repo = createMockRepo();
    const service = new SupplierFileService(repo);

    const uploaded = await service.upload(
      { clientId: tenantA, userId: "admin-1", role: "admin" },
      {
        supplierPublicId: supplierPublicIdA,
        fileName: "segredo.pdf",
        category: "contracts",
        mimeType: "application/pdf",
        base64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
      }
    );

    expect((uploaded as any).storage_key).toBeUndefined();
    expect((uploaded as any).storageKey).toBeUndefined();
    expect((uploaded as any).filePath).toBeUndefined();
    expect((uploaded as any).id).toBeUndefined();
    expect(uploaded.publicId).toBeDefined();
    expect(uploaded.downloadUrl).toBe(`/api/erp/suppliers/${supplierPublicIdA}/files/${uploaded.publicId}`);
  });
});
