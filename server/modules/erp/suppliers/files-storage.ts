import { createHash, randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { productMediaRoot } from "../../../product-media";
import {
  allowedSupplierFileMimeTypes,
  type AllowedSupplierFileMimeType,
  SUPPLIER_FILE_MAX_BYTES,
} from "./files-contracts";
import { ErpDomainError } from "../errors";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CLIENT_ID_REGEX = /^[a-zA-Z0-9_-]{1,80}$/;

export function validateClientId(clientId: string): void {
  if (!CLIENT_ID_REGEX.test(clientId)) {
    throw new ErpDomainError("VALIDATION", "Identificador de tenant inválido.");
  }
}

export function validateUuid(val: string, label = "ID"): void {
  if (!UUID_REGEX.test(val)) {
    throw new ErpDomainError("VALIDATION", `${label} inválido.`);
  }
}

export function sanitizeFileName(name: string): string {
  const normalized = name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\x00-\x1F\x7F]/g, "_")
    .trim();
  if (!normalized || normalized === "." || normalized === "..") {
    throw new ErpDomainError("VALIDATION", "Nome de arquivo inválido.");
  }
  return normalized.slice(0, 255);
}

export function buildContentDisposition(
  fileName: string,
  disposition: "attachment" | "inline" = "attachment"
): string {
  const safe = sanitizeFileName(fileName);
  const fallback = safe
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_") || "documento";
  const encoded = [...Buffer.from(safe, "utf8")]
    .map(b => `%${b.toString(16).padStart(2, "0").toUpperCase()}`)
    .join("");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function parseZipEntries(buf: Buffer): string[] {
  const entries: string[] = [];
  let offset = 0;
  while (offset < buf.length - 4) {
    if (buf.readUInt32LE(offset) === 0x04034b50) {
      if (offset + 30 > buf.length) break;
      const fnLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      if (offset + 30 + fnLen <= buf.length) {
        entries.push(buf.subarray(offset + 30, offset + 30 + fnLen).toString("utf8"));
      }
      offset += 30 + fnLen + extraLen;
    } else {
      offset++;
    }
  }
  return entries;
}

export function isSafeTextContent(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  const str = bytes.toString("utf8");
  if (str.includes("\uFFFD")) return false;
  // Check control chars: allow \t (9), \n (10), \r (13), and >= 32
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 32 && b !== 9 && b !== 10 && b !== 13) {
      return false;
    }
  }
  // Reject embedded active script/html
  if (/<(?:script|html|svg|iframe|object|embed)\b/i.test(str)) {
    return false;
  }
  return true;
}

export async function validateAndInspectFile(
  bytes: Buffer,
  declaredMimeType: string
): Promise<{ mimeType: AllowedSupplierFileMimeType; sha256: string }> {
  if (!bytes || bytes.length === 0) {
    throw new ErpDomainError("VALIDATION", "Arquivo vazio não é permitido.");
  }
  if (bytes.length > SUPPLIER_FILE_MAX_BYTES) {
    throw new ErpDomainError("VALIDATION", "Arquivo excede o limite máximo de 20 MB.");
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const detected = await fileTypeFromBuffer(bytes);

  // Check PDF
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d    // -
  ) {
    if (detected && detected.mime !== "application/pdf") {
      throw new ErpDomainError("VALIDATION", "Conteúdo do arquivo não corresponde a um PDF válido.");
    }
    return { mimeType: "application/pdf", sha256 };
  }

  // Check Images
  if (detected?.mime === "image/png" || detected?.mime === "image/jpeg" || detected?.mime === "image/webp") {
    return { mimeType: detected.mime, sha256 };
  }

  // Check OOXML (DOCX / XLSX)
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) {
    const zipEntries = parseZipEntries(bytes);
    const hasContentTypes = zipEntries.some(e => e.toLowerCase() === "[content_types].xml");
    const hasWord = zipEntries.some(e => e.toLowerCase().startsWith("word/"));
    const hasXl = zipEntries.some(e => e.toLowerCase().startsWith("xl/"));

    if (hasContentTypes && hasWord) {
      return {
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sha256,
      };
    }
    if (hasContentTypes && hasXl) {
      return {
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sha256,
      };
    }

    throw new ErpDomainError(
      "VALIDATION",
      "Arquivo compactado ZIP genérico não é suportado. Envie um documento DOCX ou XLSX válido."
    );
  }

  // Check Text (Plain text or CSV) - only if declared as text
  const isDeclaredText = declaredMimeType.toLowerCase().startsWith("text/");
  if (isDeclaredText && !detected && isSafeTextContent(bytes)) {
    const dec = declaredMimeType.toLowerCase().split(";")[0].trim();
    const mimeType = dec === "text/csv" ? "text/csv" : "text/plain";
    return { mimeType, sha256 };
  }

  throw new ErpDomainError(
    "VALIDATION",
    "Tipo de arquivo não permitido ou conteúdo incompatível. Formatos aceitos: PDF, Imagens (PNG/JPG/WEBP), Planilhas (XLSX/CSV), Textos (TXT) e Documentos (DOCX)."
  );
}

export function getTenantSupplierFilesDirectory(clientId: string, root = productMediaRoot()): string {
  validateClientId(clientId);
  const canonicalRoot = path.resolve(root);
  const tenantDir = path.resolve(canonicalRoot, "tenants", clientId, "supplier-files");
  if (!tenantDir.startsWith(canonicalRoot + path.sep)) {
    throw new ErpDomainError("VALIDATION", "Caminho de armazenamento inválido.");
  }
  return tenantDir;
}

export function assertSafeDirectoryChain(canonicalRoot: string, targetPath: string): void {
  const root = path.resolve(canonicalRoot);
  const target = path.resolve(targetPath);
  if (!target.startsWith(root + path.sep) && target !== root) {
    throw new ErpDomainError("VALIDATION", "Caminho fora do limite de armazenamento.");
  }
  try {
    const rootInfo = lstatSync(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      throw new ErpDomainError("FORBIDDEN", "Diretório raiz de armazenamento inválido.");
    }
  } catch {
    // Root directory may be created on first write
    return;
  }
  const relative = path.relative(root, path.dirname(target));
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const info = lstatSync(current);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new ErpDomainError("FORBIDDEN", "Diretório de armazenamento intermediário inseguro.");
      }
    } catch (e) {
      if (e instanceof ErpDomainError) throw e;
      // Missing intermediate directory during write setup
      return;
    }
  }
}

export function resolveSupplierFilePath(
  clientId: string,
  storageKey: string,
  root = productMediaRoot()
): string {
  validateUuid(storageKey, "Storage key");
  const baseDir = getTenantSupplierFilesDirectory(clientId, root);
  const partition = storageKey.slice(0, 2).toLowerCase();
  const filePath = path.resolve(baseDir, partition, `${storageKey}.bin`);
  if (!filePath.startsWith(baseDir + path.sep)) {
    throw new ErpDomainError("VALIDATION", "Tentativa de violação de caminho de arquivo.");
  }
  return filePath;
}

export async function writeSupplierFileAtomic(
  clientId: string,
  storageKey: string,
  bytes: Buffer,
  root = productMediaRoot()
): Promise<string> {
  const canonicalRoot = path.resolve(root);
  const filePath = resolveSupplierFilePath(clientId, storageKey, root);
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  assertSafeDirectoryChain(canonicalRoot, filePath);

  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  const handle = await open(tempPath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close().catch(() => undefined);
  }

  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return filePath;
}

export async function readSupplierFile(
  clientId: string,
  storageKey: string,
  root = productMediaRoot()
): Promise<Buffer> {
  const canonicalRoot = path.resolve(root);
  const filePath = resolveSupplierFilePath(clientId, storageKey, root);
  assertSafeDirectoryChain(canonicalRoot, filePath);

  let info;
  try {
    info = lstatSync(filePath);
  } catch {
    throw new ErpDomainError("NOT_FOUND", "Arquivo físico não encontrado no armazenamento.");
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new ErpDomainError("FORBIDDEN", "Arquivo protegido ou inválido.");
  }
  return await readFile(filePath);
}

export async function removeSupplierFilePhysical(
  clientId: string,
  storageKey: string,
  root = productMediaRoot()
): Promise<void> {
  try {
    const filePath = resolveSupplierFilePath(clientId, storageKey, root);
    await rm(filePath, { force: true });
  } catch {
    // Ignore cleanup errors
  }
}
