import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { existsSync, lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildContentDisposition,
  isSafeTextContent,
  parseZipEntries,
  readSupplierFile,
  removeSupplierFilePhysical,
  resolveSupplierFilePath,
  sanitizeFileName,
  validateAndInspectFile,
  validateUuid,
  writeSupplierFileAtomic,
} from "./files-storage";
import { ErpDomainError } from "../errors";

function createMockZipBuffer(entries: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // magic
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // compression: store
    localHeader.writeUInt32LE(data.length, 18); // compressed size
    localHeader.writeUInt32LE(data.length, 22); // uncompressed size
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

describe("Supplier Files — Storage & Security Architecture", () => {
  let tempMediaRoot: string;
  const testClientId = "tenant-safe-123";
  const validUuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

  beforeEach(async () => {
    tempMediaRoot = await mkdtemp(path.join(os.tmpdir(), "megadesk-files-test-"));
  });

  afterEach(async () => {
    await rm(tempMediaRoot, { recursive: true, force: true });
  });

  // ─── 1. Path Resolution & Confinement ─────────────────────────────────────
  it("resolves storage file path safely within tenant boundary", () => {
    const filePath = resolveSupplierFilePath(testClientId, validUuid, tempMediaRoot);
    const expectedBase = path.resolve(tempMediaRoot, "tenants", testClientId, "supplier-files");

    expect(filePath.startsWith(expectedBase)).toBe(true);
    expect(filePath.endsWith(`${validUuid}.bin`)).toBe(true);
  });

  it("rejects invalid or traversal storage key in UUID validation", () => {
    expect(() => resolveSupplierFilePath(testClientId, "../traversal", tempMediaRoot)).toThrow(ErpDomainError);
    expect(() => resolveSupplierFilePath(testClientId, "../../etc/passwd", tempMediaRoot)).toThrow(ErpDomainError);
    expect(() => validateUuid("not-a-valid-uuid")).toThrow(ErpDomainError);
  });

  // ─── 2. Atomic Disk Writes ────────────────────────────────────────────────
  it("performs atomic write and ensures file exists with content", async () => {
    const payload = Buffer.from("conteudo-documento-comercial-123", "utf8");
    const filePath = await writeSupplierFileAtomic(testClientId, validUuid, payload, tempMediaRoot);

    expect(existsSync(filePath)).toBe(true);
    const content = await readSupplierFile(testClientId, validUuid, tempMediaRoot);
    expect(content.equals(payload)).toBe(true);
  });

  it("compensating cleanup physically removes written file", async () => {
    const payload = Buffer.from("teste-remocao", "utf8");
    const filePath = await writeSupplierFileAtomic(testClientId, validUuid, payload, tempMediaRoot);
    expect(existsSync(filePath)).toBe(true);

    await removeSupplierFilePhysical(testClientId, validUuid, tempMediaRoot);
    expect(existsSync(filePath)).toBe(false);
  });

  // ─── 3. Symlink & Traversal Protections ────────────────────────────────────
  it("rejects reading through symlink pointers", async () => {
    const payload = Buffer.from("arquivo-real", "utf8");
    const realFilePath = await writeSupplierFileAtomic(testClientId, validUuid, payload, tempMediaRoot);

    // Create another key pointing to realFilePath as a symlink
    const fakeUuid = "f1f2f3f4-e5f6-4a7b-8c9d-0e1f2a3b4c5e";
    const fakePath = resolveSupplierFilePath(testClientId, fakeUuid, tempMediaRoot);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.dirname(fakePath), { recursive: true });

    try {
      await symlink(realFilePath, fakePath);
      await expect(readSupplierFile(testClientId, fakeUuid, tempMediaRoot)).rejects.toThrow("Arquivo protegido ou inválido.");
    } catch (e: any) {
      // On Windows without SeCreateSymbolicLinkPrivilege, symlink creation may throw EPERM;
      // if created, it must reject.
      if (e.code !== "EPERM") {
        throw e;
      }
    }
  });

  // ─── 4. MIME & Binary Validation ──────────────────────────────────────────
  it("validates authentic PDF files with %PDF- magic bytes", async () => {
    const validPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "utf8");
    const result = await validateAndInspectFile(validPdf, "application/pdf");

    expect(result.mimeType).toBe("application/pdf");
    expect(result.sha256).toBeDefined();
    expect(result.sha256.length).toBe(64);
  });

  it("rejects files claiming to be PDF but lacking %PDF- magic", async () => {
    const fakePdf = Buffer.from("NOT-A-PDF-HEADER-CONTENT", "utf8");
    await expect(validateAndInspectFile(fakePdf, "application/pdf")).rejects.toThrow(ErpDomainError);
  });

  it("validates authentic PNG images", async () => {
    // PNG 8-byte header: 89 50 4E 47 0D 0A 1A 0A + IHDR chunk
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89
    ]);
    const result = await validateAndInspectFile(pngHeader, "image/png");
    expect(result.mimeType).toBe("image/png");
  });

  // ─── 5. OOXML (DOCX / XLSX) Validation ───────────────────────────────────
  it("accepts authentic DOCX container with [Content_Types].xml and word/ entry", async () => {
    const docxZip = createMockZipBuffer({
      "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      "word/document.xml": '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    });

    const result = await validateAndInspectFile(
      docxZip,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(result.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("accepts authentic XLSX container with [Content_Types].xml and xl/ entry", async () => {
    const xlsxZip = createMockZipBuffer({
      "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      "xl/workbook.xml": '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
    });

    const result = await validateAndInspectFile(
      xlsxZip,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(result.mimeType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  it("rejects generic ZIP lacking OOXML structure", async () => {
    const genericZip = createMockZipBuffer({
      "arquivo_qualquer.txt": "conteudo de teste",
      "pasta/imagem.jpg": "conteudo falso",
    });

    await expect(validateAndInspectFile(genericZip, "application/zip")).rejects.toThrow(
      "Arquivo compactado ZIP genérico não é suportado."
    );
  });

  // ─── 6. Text (CSV / TXT) Validation ───────────────────────────────────────
  it("accepts clean UTF-8 text and CSV content", async () => {
    const csvContent = Buffer.from("codigo,descricao,preco\n101,Parafuso Aco,1.50\n102,Porca Sextavada,0.75\n", "utf8");
    const result = await validateAndInspectFile(csvContent, "text/csv");
    expect(result.mimeType).toBe("text/csv");

    const txtContent = Buffer.from("Termo de homologacao comercial de fornecedores.\nLinha 2.\n", "utf8");
    const txtResult = await validateAndInspectFile(txtContent, "text/plain");
    expect(txtResult.mimeType).toBe("text/plain");
  });

  it("rejects text containing binary null bytes or dangerous scripts", async () => {
    const nullByteContent = Buffer.from("texto normal\0conteudo binario oculto", "utf8");
    expect(isSafeTextContent(nullByteContent)).toBe(false);

    const scriptContent = Buffer.from("<script>alert('xss')</script>", "utf8");
    expect(isSafeTextContent(scriptContent)).toBe(false);

    const iframeContent = Buffer.from("Dados normais <iframe src='evil.com'></iframe>", "utf8");
    expect(isSafeTextContent(iframeContent)).toBe(false);
  });

  // ─── 7. File Size Limits ──────────────────────────────────────────────────
  it("rejects empty files (0 bytes)", async () => {
    await expect(validateAndInspectFile(Buffer.alloc(0), "text/plain")).rejects.toThrow("Arquivo vazio não é permitido.");
  });

  it("rejects files exceeding 20 MB", async () => {
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1);
    await expect(validateAndInspectFile(oversized, "application/pdf")).rejects.toThrow("Arquivo excede o limite máximo de 20 MB.");
  });

  // ─── 8. Safe Content-Disposition ──────────────────────────────────────────
  it("sanitizes filenames in Content-Disposition headers", () => {
    const header = buildContentDisposition('Relatório_Tabela "Final" & Preços.pdf');
    expect(header).toContain("attachment;");
    expect(header).toContain('filename=');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).not.toContain('"Final"'); // Quotes sanitized
  });

  it("rejects malicious or empty filenames during sanitization", () => {
    expect(() => sanitizeFileName("")).toThrow(ErpDomainError);
    expect(() => sanitizeFileName("..")).toThrow(ErpDomainError);
    expect(() => sanitizeFileName(".")).toThrow(ErpDomainError);
  });
});
