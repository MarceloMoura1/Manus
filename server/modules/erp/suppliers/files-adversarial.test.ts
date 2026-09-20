import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, symlink, mkdir } from "node:fs/promises";
import { existsSync, lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertSafeDirectoryChain,
  buildContentDisposition,
  getTenantSupplierFilesDirectory,
  isSafeTextContent,
  parseZipEntries,
  readSupplierFile,
  removeSupplierFilePhysical,
  resolveSupplierFilePath,
  sanitizeFileName,
  validateAndInspectFile,
  validateClientId,
  validateUuid,
  writeSupplierFileAtomic,
} from "./files-storage";
import {
  canManageSupplierFiles,
  formatActorName,
  type OperationalRole,
  SUPPLIER_FILE_MAX_BYTES,
} from "./files-contracts";
import { SupplierFileService } from "./files-service";
import { type SupplierFileRepository, type SupplierFileRow } from "./files-repository";
import { parseHttpByteRange, createSupplierFileDownloadHandler } from "./files-router";
import { ErpDomainError } from "../errors";

function createMockZip(entries: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    parts.push(localHeader, nameBuf, data);

    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0);
    cdHeader.writeUInt16LE(20, 4);
    cdHeader.writeUInt16LE(20, 6);
    cdHeader.writeUInt16LE(0, 8);
    cdHeader.writeUInt16LE(0, 10);
    cdHeader.writeUInt32LE(data.length, 20);
    cdHeader.writeUInt32LE(data.length, 24);
    cdHeader.writeUInt16LE(nameBuf.length, 28);
    cdHeader.writeUInt16LE(0, 30);
    cdHeader.writeUInt16LE(0, 32);
    cdHeader.writeUInt32LE(offset, 42);
    cdParts.push(cdHeader, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const p of cdParts) cdSize += p.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([...parts, ...cdParts, eocd]);
}

describe("Supplier Files — Exhaustive Adversarial Hardening Suite", () => {
  let tempMediaRoot: string;
  const testClientId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
  const validStorageKey = "f0e1d2c3-b4a5-4987-9876-543210fedcba";

  beforeEach(async () => {
    tempMediaRoot = await mkdtemp(path.join(os.tmpdir(), "megadesk-adv-"));
    process.env.MEGADESK_MEDIA_ROOT = tempMediaRoot;
    process.env.MEGADESK_MEDIA_TEST_RUN_ID = path.basename(tempMediaRoot);
  });

  afterEach(async () => {
    delete process.env.MEGADESK_MEDIA_ROOT;
    delete process.env.MEGADESK_MEDIA_TEST_RUN_ID;
    await rm(tempMediaRoot, { recursive: true, force: true });
  });

  // ==========================================================================
  // 1. PATH ADVERSARIAL ATTACKS (Traversals, Symlinks, Root Confinement)
  // ==========================================================================
  describe("1. Path Adversarial Attacks", () => {
    it("rejects traversal sequences in clientId", () => {
      expect(() => validateClientId("../traversal")).toThrow(ErpDomainError);
      expect(() => validateClientId("..\\traversal")).toThrow(ErpDomainError);
      expect(() => validateClientId("../../etc/passwd")).toThrow(ErpDomainError);
      expect(() => validateClientId("..\\..\\windows\\system32")).toThrow(ErpDomainError);
      expect(() => validateClientId("tenant/subpath")).toThrow(ErpDomainError);
      expect(() => validateClientId("tenant\\subpath")).toThrow(ErpDomainError);
      expect(() => validateClientId("%2e%2e%2f")).toThrow(ErpDomainError);
      expect(() => validateClientId("")).toThrow(ErpDomainError);
      expect(() => validateClientId("a".repeat(81))).toThrow(ErpDomainError);
    });

    it("rejects absolute paths in clientId", () => {
      expect(() => validateClientId("C:\\Windows\\System32")).toThrow(ErpDomainError);
      expect(() => validateClientId("/etc/shadow")).toThrow(ErpDomainError);
    });

    it("rejects non-UUID storageKey tampering", () => {
      expect(() => resolveSupplierFilePath(testClientId, "../fake-key", tempMediaRoot)).toThrow(ErpDomainError);
      expect(() => resolveSupplierFilePath(testClientId, "C:\\autoexec.bat", tempMediaRoot)).toThrow(ErpDomainError);
      expect(() => resolveSupplierFilePath(testClientId, "/bin/sh", tempMediaRoot)).toThrow(ErpDomainError);
      expect(() => resolveSupplierFilePath(testClientId, validStorageKey + "/sub", tempMediaRoot)).toThrow(ErpDomainError);
    });

    it("proves write and read strictly stay inside canonical root", async () => {
      const writtenPath = await writeSupplierFileAtomic(
        testClientId,
        validStorageKey,
        Buffer.from("adversarial-content"),
        tempMediaRoot
      );
      const canonicalRoot = path.resolve(tempMediaRoot);
      expect(writtenPath.startsWith(canonicalRoot + path.sep)).toBe(true);

      const readBytes = await readSupplierFile(testClientId, validStorageKey, tempMediaRoot);
      expect(readBytes.toString()).toBe("adversarial-content");
    });

    it("detects and rejects file-level symlink on read", async () => {
      const filePath = resolveSupplierFilePath(testClientId, validStorageKey, tempMediaRoot);
      await mkdir(path.dirname(filePath), { recursive: true });

      const targetFile = path.join(tempMediaRoot, "secret.txt");
      await writeFile(targetFile, "sensitive data");

      try {
        await symlink(targetFile, filePath);
        await expect(readSupplierFile(testClientId, validStorageKey, tempMediaRoot)).rejects.toThrow(
          "Arquivo protegido ou inválido."
        );
      } catch (err: any) {
        // Symlinks might require admin on Windows; if so, verify test caught or skipped
        if (err.code !== "EPERM") throw err;
      }
    });

    it("detects and rejects directory-level symlink in chain", async () => {
      const baseDir = getTenantSupplierFilesDirectory(testClientId, tempMediaRoot);
      await mkdir(path.dirname(baseDir), { recursive: true });

      const fakeTargetDir = path.join(tempMediaRoot, "fake-external-dir");
      await mkdir(fakeTargetDir, { recursive: true });

      try {
        await symlink(fakeTargetDir, baseDir);
        expect(() => assertSafeDirectoryChain(tempMediaRoot, path.join(baseDir, "00", "file.bin"))).toThrow(
          "Diretório de armazenamento intermediário inseguro."
        );
      } catch (err: any) {
        if (err.code !== "EPERM") throw err;
      }
    });
  });

  // ==========================================================================
  // 2. MIME & CONTENT ADVERSARIAL VALIDATION
  // ==========================================================================
  describe("2. MIME & Content Adversarial Validation", () => {
    it("rejects empty file (0 bytes)", async () => {
      await expect(validateAndInspectFile(Buffer.alloc(0), "application/pdf")).rejects.toThrow(
        "Arquivo vazio não é permitido."
      );
    });

    it("rejects file exceeding 20 MB limit", async () => {
      const oversize = Buffer.alloc(SUPPLIER_FILE_MAX_BYTES + 1);
      await expect(validateAndInspectFile(oversize, "application/pdf")).rejects.toThrow(
        "Arquivo excede o limite máximo de 20 MB."
      );
    });

    it("accepts file at exact 20 MB boundary with valid PDF header", async () => {
      const exact = Buffer.alloc(SUPPLIER_FILE_MAX_BYTES);
      exact.write("%PDF-1.7\n%EOF");
      const result = await validateAndInspectFile(exact, "application/pdf");
      expect(result.mimeType).toBe("application/pdf");
    });

    it("rejects PDF extension with EXE/MZ payload", async () => {
      const mzPayload = Buffer.from("MZ\x90\x00\x03\x00\x00\x00WindowsExecutable");
      await expect(validateAndInspectFile(mzPayload, "application/pdf")).rejects.toThrow(
        "Tipo de arquivo não permitido ou conteúdo incompatível"
      );
    });

    it("rejects PNG extension with arbitrary payload", async () => {
      const fakePng = Buffer.from("NOT_A_REAL_PNG_CONTENT");
      await expect(validateAndInspectFile(fakePng, "image/png")).rejects.toThrow(
        "Tipo de arquivo não permitido ou conteúdo incompatível"
      );
    });

    it("rejects WEBP spoof (RIFF but invalid WEBP header)", async () => {
      const fakeWebp = Buffer.from("RIFF\x00\x00\x00\x00FAKEPAYLOAD");
      await expect(validateAndInspectFile(fakeWebp, "image/webp")).rejects.toThrow(
        "Tipo de arquivo não permitido ou conteúdo incompatível"
      );
    });

    it("rejects DOCX containing only generic ZIP (missing word/)", async () => {
      const genericZip = createMockZip({
        "[Content_Types].xml": "<Types></Types>",
        "other/file.txt": "just a zip",
      });
      await expect(validateAndInspectFile(genericZip, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).rejects.toThrow(
        "Arquivo compactado ZIP genérico não é suportado."
      );
    });

    it("rejects XLSX containing only generic ZIP (missing xl/)", async () => {
      const genericZip = createMockZip({
        "[Content_Types].xml": "<Types></Types>",
        "random/sheet.txt": "not real sheet",
      });
      await expect(validateAndInspectFile(genericZip, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).rejects.toThrow(
        "Arquivo compactado ZIP genérico não é suportado."
      );
    });

    it("rejects OOXML missing [Content_Types].xml", async () => {
      const missingContentTypes = createMockZip({
        "word/document.xml": "<w:document></w:document>",
      });
      await expect(validateAndInspectFile(missingContentTypes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).rejects.toThrow(
        "Arquivo compactado ZIP genérico não é suportado."
      );
    });

    it("rejects truncated / corrupted ZIP header", async () => {
      const truncated = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
      await expect(validateAndInspectFile(truncated, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).rejects.toThrow(
        "Arquivo compactado ZIP genérico não é suportado."
      );
    });

    it("rejects text file containing NUL (zero) byte", async () => {
      const nulText = Buffer.from("Hello\x00World");
      await expect(validateAndInspectFile(nulText, "text/plain")).rejects.toThrow(
        "Tipo de arquivo não permitido"
      );
    });

    it("rejects CSV file containing NUL byte", async () => {
      const nulCsv = Buffer.from("col1,col2\nval1,\x00val2");
      await expect(validateAndInspectFile(nulCsv, "text/csv")).rejects.toThrow(
        "Tipo de arquivo não permitido"
      );
    });

    it("rejects invalid UTF-8 in text file", async () => {
      // 0xFF 0xFE is invalid UTF-8 sequence
      const invalidUtf8 = Buffer.from([0xff, 0xfe, 0x41, 0x42]);
      await expect(validateAndInspectFile(invalidUtf8, "text/plain")).rejects.toThrow(
        "Tipo de arquivo não permitido"
      );
    });

    it("rejects binary payload declared as text/plain", async () => {
      // ELF executable header
      const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
      await expect(validateAndInspectFile(elf, "text/plain")).rejects.toThrow(
        "Tipo de arquivo não permitido"
      );
    });

    it("rejects active script/HTML injection inside text file", () => {
      expect(isSafeTextContent(Buffer.from("<script>alert(1)</script>"))).toBe(false);
      expect(isSafeTextContent(Buffer.from("<svg onload=alert(1)>"))).toBe(false);
      expect(isSafeTextContent(Buffer.from("<iframe src=evil.com>"))).toBe(false);
      expect(isSafeTextContent(Buffer.from("Valid clean text with normal characters\nSecond line\r\n\tIndented"))).toBe(true);
    });
  });

  // ==========================================================================
  // 3. AUTHORIZATION & RBAC REVIEW
  // ==========================================================================
  describe("3. Authorization & RBAC Review", () => {
    it("enforces canonical ERP operational role permissions for supplier files", () => {
      expect(canManageSupplierFiles("admin")).toBe(true);
      expect(canManageSupplierFiles("manager")).toBe(true);
      expect(canManageSupplierFiles("agent")).toBe(false);
      expect(canManageSupplierFiles("viewer")).toBe(false);
    });

    it("blocks viewer and agent from upload and delete in domain service", async () => {
      const mockRepo = {
        findSupplier: vi.fn(),
      } as unknown as SupplierFileRepository;
      const service = new SupplierFileService(mockRepo);

      await expect(
        service.upload(
          { clientId: testClientId, userId: "u-1", role: "viewer" as OperationalRole },
          {
            supplierPublicId: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
            fileName: "doc.pdf",
            category: "contracts",
            mimeType: "application/pdf",
            base64: Buffer.from("%PDF-1.4\n").toString("base64"),
          }
        )
      ).rejects.toThrow("Seu perfil não permite gerenciar arquivos de fornecedores.");

      await expect(
        service.delete(
          { clientId: testClientId, userId: "u-1", role: "agent" as OperationalRole },
          {
            supplierPublicId: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
            filePublicId: validStorageKey,
          }
        )
      ).rejects.toThrow("Seu perfil não permite gerenciar arquivos de fornecedores.");
    });
  });

  // ==========================================================================
  // 4. TENANT & CROSS-SUPPLIER ISOLATION
  // ==========================================================================
  describe("4. Tenant & Cross-Supplier Isolation", () => {
    it("rejects downloading file belonging to another tenant (returns NOT_FOUND)", async () => {
      const mockRepo = {
        findSupplier: vi.fn().mockResolvedValue(null), // Supplier does not exist in this tenant
      } as unknown as SupplierFileRepository;

      const service = new SupplierFileService(mockRepo);
      await expect(
        service.getFileForDownload(
          { clientId: "tenant-attacker", userId: "u-att", role: "viewer" },
          "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
          validStorageKey
        )
      ).rejects.toThrow("Fornecedor não encontrado.");
    });

    it("rejects downloading file belonging to another supplier within same tenant", async () => {
      const mockRepo = {
        findSupplier: vi.fn().mockResolvedValue({ id: 10, publicId: "sup-1", active: true }),
        findByPublicId: vi.fn().mockResolvedValue(null), // File does not belong to supplier 10
      } as unknown as SupplierFileRepository;

      const service = new SupplierFileService(mockRepo);
      await expect(
        service.getFileForDownload(
          { clientId: testClientId, userId: "u-1", role: "viewer" },
          "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
          validStorageKey
        )
      ).rejects.toThrow("Arquivo não encontrado ou indisponível.");
    });

    it("rejects downloading soft-deleted file", async () => {
      const mockRepo = {
        findSupplier: vi.fn().mockResolvedValue({ id: 10, publicId: "sup-1", active: true }),
        findByPublicId: vi.fn().mockResolvedValue({
          id: 1,
          public_id: validStorageKey,
          state: "deleted",
          storage_key: validStorageKey,
        }),
      } as unknown as SupplierFileRepository;

      const service = new SupplierFileService(mockRepo);
      await expect(
        service.getFileForDownload(
          { clientId: testClientId, userId: "u-1", role: "viewer" },
          "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
          validStorageKey
        )
      ).rejects.toThrow("Arquivo não encontrado ou indisponível.");
    });
  });

  // ==========================================================================
  // 5. ATOMICITY & ORPHAN COMPENSATING CLEANUP
  // ==========================================================================
  describe("5. Atomicity & Compensating Cleanup", () => {
    it("cleans up disk file when database insert fails", async () => {
      const mockRepo = {
        findSupplier: vi.fn().mockResolvedValue({ id: 10, publicId: "sup-1", active: true }),
        insertFile: vi.fn().mockRejectedValue(new Error("DB_CONNECTION_FAILURE")),
      } as unknown as SupplierFileRepository;

      const service = new SupplierFileService(mockRepo);
      const pdfBase64 = Buffer.from("%PDF-1.4\n%EOF\n").toString("base64");

      await expect(
        service.upload(
          { clientId: testClientId, userId: "u-admin", role: "admin" },
          {
            supplierPublicId: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
            fileName: "contract.pdf",
            category: "contracts",
            mimeType: "application/pdf",
            base64: pdfBase64,
          }
        )
      ).rejects.toThrow("DB_CONNECTION_FAILURE");

      // Verify no orphaned storage files remain in the tenant directory
      const tenantDir = getTenantSupplierFilesDirectory(testClientId, tempMediaRoot);
      if (existsSync(tenantDir)) {
        // Any subdirectories should be empty of .bin files
        const fs = await import("node:fs/promises");
        const dirs = await fs.readdir(tenantDir, { recursive: true });
        const binFiles = dirs.filter(f => f.endsWith(".bin"));
        expect(binFiles.length).toBe(0);
      }
    });

    it("soft-delete is idempotent and second delete returns NOT_FOUND", async () => {
      const mockRepo = {
        findSupplier: vi.fn().mockResolvedValue({ id: 10, publicId: "sup-1", active: true }),
        softDelete: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      } as unknown as SupplierFileRepository;

      const service = new SupplierFileService(mockRepo);
      const res1 = await service.delete(
        { clientId: testClientId, userId: "u-admin", role: "admin" },
        { supplierPublicId: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e", filePublicId: validStorageKey }
      );
      expect(res1.ok).toBe(true);

      await expect(
        service.delete(
          { clientId: testClientId, userId: "u-admin", role: "admin" },
          { supplierPublicId: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e", filePublicId: validStorageKey }
        )
      ).rejects.toThrow("Arquivo não encontrado ou já excluído.");
    });
  });

  // ==========================================================================
  // 6. DOWNLOAD, HEADERS & RANGE REQUESTS
  // ==========================================================================
  describe("6. Download, Headers & Range Requests", () => {
    it("escapes Content-Disposition headers against quotes, CRLF and Unicode", () => {
      const evilName = 'evil"\r\nInjected-Header: true\n.pdf';
      const disposition = buildContentDisposition(evilName, "attachment");
      expect(disposition).not.toContain("\r");
      expect(disposition).not.toContain("\n");
      expect(disposition.startsWith("attachment;")).toBe(true);

      const unicodeName = "Contrato de Fornecimento nº 123 — 2026.pdf";
      const unicodeDisp = buildContentDisposition(unicodeName, "inline");
      expect(unicodeDisp.startsWith("inline;")).toBe(true);
      expect(unicodeDisp).toContain("filename=");
      expect(unicodeDisp).toContain("filename*=UTF-8''");
    });

    it("parses HTTP Byte Ranges correctly", () => {
      const total = 1000;
      // Standard range
      expect(parseHttpByteRange("bytes=0-499", total)).toEqual({ start: 0, end: 499 });
      // Prefix range
      expect(parseHttpByteRange("bytes=500-", total)).toEqual({ start: 500, end: 999 });
      // Suffix range
      expect(parseHttpByteRange("bytes=-200", total)).toEqual({ start: 800, end: 999 });
      // Beyond EOF -> INVALID
      expect(parseHttpByteRange("bytes=1000-1200", total)).toBe("INVALID");
      // Inverted range -> INVALID
      expect(parseHttpByteRange("bytes=500-100", total)).toBe("INVALID");
      // Multi-range -> INVALID
      expect(parseHttpByteRange("bytes=0-100,200-300", total)).toBe("INVALID");
      // Malformed -> INVALID
      expect(parseHttpByteRange("bytes=abc", total)).toBe("INVALID");
      // Missing header -> null
      expect(parseHttpByteRange(undefined, total)).toBe(null);
    });

    it("express handler serves 206 Partial Content for valid range", async () => {
      const mockService = {
        getFileForDownload: vi.fn().mockResolvedValue({
          bytes: Buffer.from("0123456789ABCDEF"),
          mimeType: "application/pdf",
          fileName: "sample.pdf",
        }),
      } as unknown as SupplierFileService;

      const mockSessionResolver = vi.fn().mockResolvedValue({
        tenantId: testClientId,
        userId: "u-1",
        role: "viewer",
      });

      const handler = createSupplierFileDownloadHandler(mockService, mockSessionResolver as any);

      const headers: Record<string, string> = {};
      let statusCode = 0;
      let sentBody: any;

      const req = {
        params: {
          supplierPublicId: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
          filePublicId: validStorageKey,
        },
        query: {},
        headers: { range: "bytes=0-3" },
      } as unknown as any;

      const res = {
        setHeader: (k: string, v: string) => { headers[k] = v; },
        status: (code: number) => {
          statusCode = code;
          return {
            send: (b: any) => { sentBody = b; },
            end: () => {},
          };
        },
      } as unknown as any;

      await handler(req, res);

      expect(statusCode).toBe(206);
      expect(headers["Content-Range"]).toBe("bytes 0-3/16");
      expect(headers["Content-Length"]).toBe("4");
      expect(sentBody.toString()).toBe("0123");
    });
  });

  // ==========================================================================
  // 7. TIMELINE & ACTOR RESOLUTION
  // ==========================================================================
  describe("7. Timeline & Actor Resolution", () => {
    it("formats actor name safely and never exposes raw UUIDs in UI", () => {
      expect(formatActorName("Carlos Santos")).toBe("Carlos Santos");
      expect(formatActorName("  Ana Lima  ")).toBe("Ana Lima");
      expect(formatActorName("")).toBe("Usuário indisponível");
      expect(formatActorName(null)).toBe("Usuário indisponível");
      expect(formatActorName(undefined)).toBe("Usuário indisponível");
      // Raw UUID string as actor name should be sanitized to fallback
      expect(formatActorName("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")).toBe("Usuário indisponível");
    });
  });
});
