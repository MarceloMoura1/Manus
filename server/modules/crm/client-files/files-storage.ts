import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { productMediaRoot } from "../../../product-media";
import { ErpDomainError } from "../../erp/errors";
import {
  assertSafeDirectoryChain,
  validateClientId,
  validateUuid,
} from "../../erp/suppliers/files-storage";

export {
  buildContentDisposition,
  sanitizeFileName,
  validateAndInspectFile,
} from "../../erp/suppliers/files-storage";

export function getTenantCrmClientFilesDirectory(clientId: string, root = productMediaRoot()): string {
  validateClientId(clientId);
  const canonicalRoot = path.resolve(root);
  const tenantDir = path.resolve(canonicalRoot, "tenants", clientId, "crm-client-files");
  if (!tenantDir.startsWith(canonicalRoot + path.sep)) {
    throw new ErpDomainError("VALIDATION", "Caminho de armazenamento inválido.");
  }
  return tenantDir;
}

export function resolveCrmClientFilePath(clientId: string, storageKey: string, root = productMediaRoot()): string {
  validateUuid(storageKey, "Storage key");
  const baseDir = getTenantCrmClientFilesDirectory(clientId, root);
  const partition = storageKey.slice(0, 2).toLowerCase();
  const filePath = path.resolve(baseDir, partition, `${storageKey}.bin`);
  if (!filePath.startsWith(baseDir + path.sep)) {
    throw new ErpDomainError("VALIDATION", "Tentativa de violação de caminho de arquivo.");
  }
  return filePath;
}

export async function writeCrmClientFileAtomic(clientId: string, storageKey: string, bytes: Buffer, root = productMediaRoot()): Promise<string> {
  const canonicalRoot = path.resolve(root);
  const filePath = resolveCrmClientFilePath(clientId, storageKey, root);
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

export async function readCrmClientFile(clientId: string, storageKey: string, root = productMediaRoot()): Promise<Buffer> {
  const canonicalRoot = path.resolve(root);
  const filePath = resolveCrmClientFilePath(clientId, storageKey, root);
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
  return readFile(filePath);
}

export async function removeCrmClientFilePhysical(clientId: string, storageKey: string, root = productMediaRoot()): Promise<void> {
  try {
    await deleteCrmClientFilePhysical(clientId, storageKey, root);
  } catch {
    // Compensating cleanup must never mask the original persistence error.
  }
}

/**
 * Removes a CRM client-file object as the committed second phase of deletion.
 * Unlike compensating upload cleanup, callers must observe failures so the
 * metadata row remains pending_delete and can be retried safely.
 */
export async function deleteCrmClientFilePhysical(clientId: string, storageKey: string, root = productMediaRoot()): Promise<void> {
  const canonicalRoot = path.resolve(root);
  const filePath = resolveCrmClientFilePath(clientId, storageKey, root);
  assertSafeDirectoryChain(canonicalRoot, filePath);
  await rm(filePath, { force: true });
}
