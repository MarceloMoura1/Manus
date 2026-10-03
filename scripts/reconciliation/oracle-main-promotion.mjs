import { createHash, randomUUID, timingSafeEqual, verify as verifySignature } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import os from "node:os";
import { dirname, join, parse as parsePath, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { stableValue } from "./reconciler.mjs";

const PLAN_URL = new URL("./reconciliation-plan.json", import.meta.url);
const AUTH_KIND = "megadesk-oracle-main-promotion-authorization";
const AUTH_VERSION = 2;
const FREEZE_EVIDENCE_KIND = "megadesk-oracle-write-freeze-evidence";
const FREEZE_EVIDENCE_VERSION = 1;
const MAX_FREEZE_EVIDENCE_TTL_MS = 15 * 60 * 1000;
const GIT_COMMIT_RE = /^[a-f0-9]{40}$/;
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PROMOTION_TRUST_ROOT_PATH = fileURLToPath(new URL("./trust/oracle-promotion-authority.v1.pem", import.meta.url));
const FREEZE_TRUST_ROOT_PATH = fileURLToPath(new URL("./trust/oracle-write-freeze-authority.v1.pem", import.meta.url));
const PROMOTION_TRUST_ROOT_SHA256 = "7c28dba348bac78a1e97b209c6e89c585924c05c8a4acfdfa24111b133ffc53f";
const FREEZE_TRUST_ROOT_SHA256 = "5ed809d46c8bd59e3bef90e45df1372bbf23cf50cd49f2c4ded0bacd45ed40c6";
const JOURNAL_KIND = "megadesk-oracle-main-promotion-journal";
const JOURNAL_VERSION = 1;
const LOCK_KIND = "megadesk-oracle-main-promotion-lock";
const LOCK_VERSION = 1;
const APPROVED_DATABASE_FINGERPRINT = "594d3c32ce5df222b37abbb8a9ba09afae2ed21505bd66e1f2452046a2f0f048";
const APPROVED_STORAGE_MANIFEST = "0f7298fe9036af2d10ab9a5ad3765f0fd01f344fa820d284222e23646aadce86";
const EXPECTED_FREEZE_BOUNDARY = "9479c73fe1cf4f8b91ebe38dafd6a106";
const PRODUCTION_HOSTNAME = "megadesk-prod-01";
const PRODUCTION_DATABASE = "megadesk_local";
const PRODUCTION_MYSQL_CONTAINER = "megadesk-mysql";
const PRODUCTION_APP_CONTAINER = "megadesk-app";
const PRODUCTION_STORAGE_ROOT = "/opt/megadesk/storage";
const PRODUCTION_OPERATIONS_ROOT = "/opt/megadesk/backups/cutover";
const PRODUCTION_LOCK_PATH = `${PRODUCTION_OPERATIONS_ROOT}/.oracle-main-promotion.lock`;
const REHEARSAL_ROOT_SUFFIX = `megadesk-test-oracle-main-promotion-${EXPECTED_FREEZE_BOUNDARY.slice(0, 8)}`;
const ISOLATED_REHEARSAL_KIND = "megadesk-isolated-linux-runner-rehearsal";
const ISOLATED_REHEARSAL_VERSION = 1;
const ISOLATED_REHEARSAL_ROOT_PREFIX = "/tmp/megadesk-";
const AUX_TABLES = new Set(["_reconciliation_entity_map", "_reconciliation_audit"]);
const TERMINAL_PHASES = new Set(["COMMITTED", "ROLLED_BACK", "ABORTED"]);
const PRE_MUTATION_PHASES = new Set([
  "PRECHECK",
  "BACKUP_STARTED",
  "DB_BACKUP_CREATED",
  "BACKUP_VERIFIED",
  "CANDIDATE_VERIFIED",
  "TARGET_REVALIDATED",
  "CANDIDATE_CAPTURED",
]);
const MUTATION_STARTED_PHASES = new Set([
  "DB_PROMOTION_STARTED",
  "DB_PROMOTED",
  "STORAGE_SWAP_PREPARED",
  "STORAGE_PROMOTED",
  "ROLLBACK_STARTED",
]);
const INJECTION_POINTS = new Set([
  "none",
  "before_backup",
  "during_db_backup",
  "after_db_backup_before_storage_backup",
  "during_storage_backup",
  "after_backup_before_promotion",
  "during_db_promotion",
  "after_db_before_storage",
  "during_storage_promotion",
  "after_storage_before_post_verify",
  "after_verify_before_committed",
  "process_crash",
]);

export class OracleMainPromotionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OracleMainPromotionError";
    this.code = code;
  }
}

const fail = (code, message) => { throw new OracleMainPromotionError(code, message); };
const sha256 = value => createHash("sha256").update(value).digest("hex");
const quote = value => `\`${String(value).replaceAll("`", "``")}\``;
const canonical = value => JSON.stringify(stableValue(value));
const nowIso = () => new Date().toISOString();

function isIsolatedRunnerRehearsal(auth) {
  return auth?.target?.class === "oracle-main-isolated-rehearsal"
    && auth?.rehearsal?.kind === ISOLATED_REHEARSAL_KIND
    && auth?.rehearsal?.version === ISOLATED_REHEARSAL_VERSION
    && auth?.rehearsal?.databaseTransport === "mysql2-direct";
}

function assertHex(value, label) {
  if (!/^[a-f0-9]{64}$/.test(String(value))) fail("INVALID_IDENTITY", `${label} must be a lowercase SHA-256.`);
  return String(value);
}

function assertUuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value))) {
    fail("INVALID_IDENTITY", `${label} must be a UUID.`);
  }
  return String(value);
}

function equalSecret(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function isInside(root, candidate, allowRoot = false) {
  const base = resolve(root);
  const target = resolve(candidate);
  const relation = relative(base, target);
  return (allowRoot && relation === "") || (relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`));
}

function pathsOverlap(left, right) {
  const l = resolve(left);
  const r = resolve(right);
  return l === r || isInside(l, r) || isInside(r, l);
}

async function assertNoSymlinkPath(path, { allowMissingLeaf = false } = {}) {
  const target = resolve(path);
  const root = parsePath(target).root;
  const parts = target.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) fail("UNSAFE_PATH", "Symbolic links or reparse points are not accepted in promotion paths.");
    } catch (error) {
      if (error?.code === "ENOENT" && allowMissingLeaf) return;
      throw error;
    }
  }
}

async function fsyncPath(path) {
  const handle = await open(path, "r");
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await handle.sync();
        return;
      } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error?.code) || attempt === 7) throw error;
        await new Promise(resolvePromise => setTimeout(resolvePromise, 25 * (attempt + 1)));
      }
    }
  } finally { await handle.close(); }
}

async function fsyncHandle(handle, label = "durable file") {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await handle.sync();
      return;
    } catch (error) {
      if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error?.code) || attempt === 7) {
        fail("DURABLE_FSYNC_FAILED", `Could not fsync ${label}: ${error?.code ?? "UNEXPECTED"}.`);
      }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 25 * (attempt + 1)));
    }
  }
}

async function durableWrite(path, bytes, { exclusive = false } = {}) {
  await mkdir(dirname(path), { recursive: true });
  if (exclusive) {
    let exclusiveHandle;
    try { exclusiveHandle = await open(path, "wx", 0o600); }
    catch (error) {
      if (error?.code === "EEXIST") fail("EXCLUSIVE_FILE_EXISTS", "Exclusive durable artifact already exists.");
      throw error;
    }
    try {
      await exclusiveHandle.writeFile(bytes);
      await fsyncHandle(exclusiveHandle, path);
    } finally { await exclusiveHandle.close(); }
    try { await fsyncPath(dirname(path)); } catch (error) {
      if (process.platform !== "win32") throw error;
    }
    return;
  }
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await fsyncHandle(handle, temp);
  } finally { await handle.close(); }
  let renamed = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rename(temp, path);
      renamed = true;
      break;
    } catch (error) {
      if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error?.code) || attempt === 7) throw error;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 25 * (attempt + 1)));
    }
  }
  if (!renamed) fail("DURABLE_WRITE_FAILED", "Could not atomically replace durable state.");
  try { await fsyncPath(dirname(path)); } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

async function durableJson(path, value, options) {
  await durableWrite(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"), options);
}

async function fileSha256(path) {
  return sha256(await readFile(path));
}

async function directoryIdentity(path) {
  await assertNoSymlinkPath(path);
  const info = await stat(path);
  if (!info.isDirectory()) fail("UNSAFE_PATH", "Expected a directory identity.");
  return { device: String(info.dev), inode: String(info.ino), realPath: await realpath(path) };
}

export async function storageSnapshot(root) {
  const base = resolve(root);
  await assertNoSymlinkPath(base);
  const rootInfo = await stat(base);
  if (!rootInfo.isDirectory()) fail("UNSAFE_STORAGE_ROOT", "Storage root is not a directory.");
  const entries = [];
  async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      const rel = relative(base, path).split(sep).join("/");
      if (!rel || rel.startsWith("../")) fail("STORAGE_ESCAPE", "Storage path escaped its approved root.");
      if (item.isSymbolicLink()) fail("STORAGE_SYMLINK", "Storage contains a symbolic link or reparse point.");
      if (item.isDirectory()) await walk(path);
      else if (item.isFile()) {
        const info = await stat(path);
        entries.push({ path, rel, size: info.size, digest: await fileSha256(path) });
      } else fail("UNSAFE_STORAGE_ENTRY", "Storage accepts only regular files and directories.");
    }
  }
  await walk(base);
  entries.sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
  const encoded = `${entries.map(entry => `${entry.rel}\t${entry.size}\t${entry.digest}`).join("\n")}\n`;
  return {
    fingerprint: sha256(encoded),
    files: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    entries,
  };
}

async function copyStorage(source, target, { partial = false } = {}) {
  const snapshot = await storageSnapshot(source);
  await assertNoSymlinkPath(target, { allowMissingLeaf: true });
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  const selected = partial ? snapshot.entries.slice(0, 1) : snapshot.entries;
  for (const entry of selected) {
    const destination = resolve(target, entry.rel.split("/").join(sep));
    if (!isInside(target, destination)) fail("STORAGE_ESCAPE", "Storage copy escaped its destination.");
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(entry.path, destination);
  }
  return snapshot;
}

function fileIdentity(info) {
  return {
    device: String(info.dev),
    inode: String(info.ino),
    size: Number(info.size),
    mtimeMs: Math.trunc(Number(info.mtimeMs)),
    ctimeMs: Math.trunc(Number(info.ctimeMs)),
  };
}

function sameFileIdentity(left, right) {
  return left && right && left.device === right.device && left.inode === right.inode
    && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function readCandidateFile(path) {
  await assertNoSymlinkPath(path);
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) fail("CANDIDATE_SOURCE_CHANGED", "Candidate database artifact is not a regular file.");
  const bytes = await readFile(path);
  const after = await lstat(path);
  if (!after.isFile() || after.isSymbolicLink() || !sameFileIdentity(fileIdentity(before), fileIdentity(after))) {
    fail("CANDIDATE_SOURCE_CHANGED", "Candidate database artifact changed while it was captured.");
  }
  return { bytes, identity: fileIdentity(after), sha256: sha256(bytes) };
}

async function captureCandidateStorage(root) {
  const base = resolve(root);
  await assertNoSymlinkPath(base);
  const rootInfo = await lstat(base);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail("CANDIDATE_SOURCE_CHANGED", "Candidate storage root is not a regular directory.");
  const entries = [];
  async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      const rel = relative(base, path).split(sep).join("/");
      if (!rel || rel.startsWith("../")) fail("STORAGE_ESCAPE", "Candidate storage path escaped its approved root.");
      const before = await lstat(path);
      if (before.isSymbolicLink()) fail("STORAGE_SYMLINK", "Candidate storage contains a symbolic link or reparse point.");
      if (before.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!before.isFile()) fail("UNSAFE_STORAGE_ENTRY", "Candidate storage accepts only regular files and directories.");
      const bytes = await readFile(path);
      const after = await lstat(path);
      if (!after.isFile() || after.isSymbolicLink() || !sameFileIdentity(fileIdentity(before), fileIdentity(after))) {
        fail("CANDIDATE_SOURCE_CHANGED", "Candidate storage file changed while it was captured.");
      }
      entries.push({ rel, size: bytes.length, digest: sha256(bytes), identity: fileIdentity(after), bytes });
    }
  }
  await walk(base);
  entries.sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
  const encoded = `${entries.map(entry => `${entry.rel}\t${entry.size}\t${entry.digest}`).join("\n")}\n`;
  return {
    root: await directoryIdentity(base),
    fingerprint: sha256(encoded),
    files: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    entries,
  };
}

function candidateStorageEvidence(snapshot) {
  return {
    root: snapshot.root,
    fingerprint: snapshot.fingerprint,
    files: snapshot.files,
    bytes: snapshot.bytes,
    entries: snapshot.entries.map(entry => ({ rel: entry.rel, size: entry.size, digest: entry.digest, identity: entry.identity })),
  };
}

function sameCandidateStorage(left, right) {
  if (!left || !right || left.fingerprint !== right.fingerprint || left.files !== right.files || left.bytes !== right.bytes
      || !sameFileIdentity({ ...left.root, size: 0, mtimeMs: 0, ctimeMs: 0 }, { ...right.root, size: 0, mtimeMs: 0, ctimeMs: 0 })
      || left.entries.length !== right.entries.length) return false;
  return left.entries.every((entry, index) => {
    const other = right.entries[index];
    return other && entry.rel === other.rel && entry.size === other.size && entry.digest === other.digest
      && sameFileIdentity(entry.identity, other.identity);
  });
}

async function materializeCapturedStorage(snapshot, target, { partial = false } = {}) {
  await assertNoSymlinkPath(target, { allowMissingLeaf: true });
  if (await exists(target)) fail("STORAGE_SWAP_RESIDUE", "Captured candidate destination already exists.");
  await mkdir(target, { recursive: true });
  const selected = partial ? snapshot.entries.slice(0, 1) : snapshot.entries;
  for (const entry of selected) {
    const destination = resolve(target, entry.rel.split("/").join(sep));
    if (!isInside(target, destination)) fail("STORAGE_ESCAPE", "Captured candidate escaped its destination.");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, entry.bytes, { flag: "wx", mode: 0o600 });
  }
  return storageSnapshot(target);
}

function boundRelativeParts(value, label) {
  if (typeof value !== "string" || value.includes("\0") || value === "" || value === "." || value === ".." || /^[\\/]/.test(value)) {
    fail("UNSAFE_PATH", `${label} must be a non-root relative storage path.`);
  }
  const parts = value.split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.some(part => part === "." || part === "..")) fail("UNSAFE_PATH", `${label} escaped the bound storage root.`);
  return parts;
}

function boundPath(value, label) {
  return join(".", ...boundRelativeParts(value, label));
}

async function boundExists(value, label) {
  try { await access(boundPath(value, label)); return true; } catch { return false; }
}

async function assertNoSymlinkBoundPath(value, label, { allowMissingLeaf = false } = {}) {
  const parts = boundRelativeParts(value, label);
  const root = await lstat(".");
  if (!root.isDirectory() || root.isSymbolicLink()) fail("STORAGE_TARGET_IDENTITY_MISMATCH", "Bound storage root is not a regular directory.");
  let current = ".";
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) fail("UNSAFE_PATH", "Symbolic links or reparse points are not accepted below a bound storage root.");
      if (index < parts.length - 1 && !info.isDirectory()) fail("UNSAFE_PATH", "A bound storage path component is not a directory.");
    } catch (error) {
      // Once a validated parent lacks a descendant, every remaining component is
      // necessarily absent. The caller may create that descendant under the
      // already-bound directory; only existing components need a symlink check.
      if (error?.code === "ENOENT" && allowMissingLeaf) return;
      throw error;
    }
  }
}

async function boundStorageSnapshot(root = ".") {
  const rootPath = root === "." ? "." : boundPath(root, "bound snapshot root");
  if (root !== ".") await assertNoSymlinkBoundPath(root, "bound snapshot root");
  const rootInfo = await lstat(rootPath);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail("UNSAFE_STORAGE_ROOT", "Bound storage root is not a regular directory.");
  const entries = [];
  async function walk(directory, prefix = "") {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      const info = await lstat(path);
      if (info.isSymbolicLink()) fail("STORAGE_SYMLINK", "Bound storage contains a symbolic link or reparse point.");
      if (info.isDirectory()) await walk(path, rel);
      else if (info.isFile()) entries.push({ rel, size: info.size, digest: await fileSha256(path) });
      else fail("UNSAFE_STORAGE_ENTRY", "Bound storage accepts only regular files and directories.");
    }
  }
  await walk(rootPath);
  entries.sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
  const encoded = `${entries.map(entry => `${entry.rel}\t${entry.size}\t${entry.digest}`).join("\n")}\n`;
  return { fingerprint: sha256(encoded), files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.size, 0), entries };
}

async function materializeCapturedStorageBound(snapshot, stageName, { duringMaterialization = null } = {}) {
  await assertNoSymlinkBoundPath(stageName, "bound candidate stage", { allowMissingLeaf: true });
  if (await boundExists(stageName, "bound candidate stage")) fail("STORAGE_SWAP_RESIDUE", "Bound candidate stage already exists.");
  const stage = boundPath(stageName, "bound candidate stage");
  await mkdir(stage, { recursive: true, mode: 0o700 });
  let hookCalled = false;
  for (const entry of snapshot.entries) {
    const destinationName = join(stageName, ...entry.rel.split("/"));
    await assertNoSymlinkBoundPath(destinationName, "bound candidate destination", { allowMissingLeaf: true });
    const destination = boundPath(destinationName, "bound candidate destination");
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, entry.bytes, { flag: "wx", mode: 0o600 });
    if (!hookCalled && duringMaterialization) {
      hookCalled = true;
      await duringMaterialization();
    }
  }
  if (!hookCalled && duringMaterialization) await duringMaterialization();
  return boundStorageSnapshot(stageName);
}

async function replaceBoundStorageContents(stageName, previousName) {
  await assertNoSymlinkBoundPath(stageName, "bound candidate stage");
  await assertNoSymlinkBoundPath(previousName, "bound previous stage", { allowMissingLeaf: true });
  if (await boundExists(previousName, "bound previous stage")) fail("STORAGE_SWAP_RESIDUE", "Bound previous stage already exists.");
  const stage = boundPath(stageName, "bound candidate stage");
  const previous = boundPath(previousName, "bound previous stage");
  await mkdir(previous, { recursive: true, mode: 0o700 });
  const currentEntries = await readdir(".", { withFileTypes: true });
  for (const entry of currentEntries) {
    if (entry.name === stageName || entry.name === previousName) continue;
    const info = await lstat(entry.name);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) fail("UNSAFE_STORAGE_ENTRY", "Bound storage contains an unsafe swap entry.");
    await rename(entry.name, join(previousName, entry.name));
  }
  for (const entry of await readdir(stage, { withFileTypes: true })) {
    const source = join(stageName, entry.name);
    const info = await lstat(boundPath(source, "bound staged entry"));
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) fail("UNSAFE_STORAGE_ENTRY", "Bound candidate stage contains an unsafe entry.");
    await rename(source, entry.name);
  }
  await rmdir(stage);
}

async function currentWorkingDirectoryIdentity() {
  const info = await lstat(".");
  if (!info.isDirectory() || info.isSymbolicLink()) fail("STORAGE_TARGET_IDENTITY_MISMATCH", "Bound storage current directory is invalid.");
  return { device: String(info.dev), inode: String(info.ino), realPath: await realpath(".") };
}

async function isWritableByPromotionProcess(path) {
  try {
    await access(path, 0o2);
    return true;
  } catch (error) {
    if (error?.code === "EACCES") return false;
    throw error;
  }
}

async function assertTrustedLinuxStorageBoundary(ctx) {
  if (process.platform !== "linux" || typeof process.getuid !== "function") {
    fail("STORAGE_TARGET_BINDING_UNSUPPORTED", "Trusted storage mutation requires Linux UID permission checks.");
  }
  const promotionUid = process.getuid();
  if (!Number.isInteger(promotionUid) || promotionUid === 0) {
    fail("STORAGE_BOUNDARY_UNPROTECTED", "Storage promotion must run as a dedicated non-root Linux identity.");
  }
  const parentPath = dirname(ctx.auth.target.storage.root);
  await assertNoSymlinkPath(parentPath);
  const [parent, target] = await Promise.all([lstat(parentPath), lstat(ctx.auth.target.storage.root)]);
  if (!parent.isDirectory() || parent.isSymbolicLink() || !target.isDirectory() || target.isSymbolicLink()) {
    fail("STORAGE_BOUNDARY_UNPROTECTED", "Storage boundary requires regular parent and target directories.");
  }
  // On Linux, POSIX ACL named-user and named-group write grants are masked by the
  // group mode bits. Requiring no group/other write therefore excludes such grants
  // for a different UID; the promotion UID is checked separately below.
  if ((parent.mode & 0o022) !== 0 || (target.mode & 0o077) !== 0) {
    fail("STORAGE_BOUNDARY_UNPROTECTED", "Storage boundary directories grant write access outside the dedicated promotion identity.");
  }
  if (Number(parent.uid) !== 0 || Number(target.uid) !== promotionUid) {
    fail("STORAGE_BOUNDARY_UNPROTECTED", "Storage target must be owned by the promotion identity under a root-owned parent.");
  }
  if (await isWritableByPromotionProcess(parentPath)) {
    fail("STORAGE_BOUNDARY_UNPROTECTED", "Promotion identity may rename or replace the storage target through its parent.");
  }
  const parentIdentity = await directoryIdentity(parentPath);
  if (!sameDirectoryIdentity(parentIdentity, ctx.auth.target.storage.parent)) {
    fail("STORAGE_PARENT_IDENTITY_MISMATCH", "Storage boundary parent identity differs from authorization.");
  }
  const targetIdentity = await directoryIdentity(ctx.auth.target.storage.root);
  if (!sameDirectoryIdentity(targetIdentity, ctx.auth.target.storage)) {
    fail("STORAGE_TARGET_IDENTITY_MISMATCH", "Storage boundary target identity differs from authorization.");
  }
  return { promotionUid, parent: parentIdentity, target: targetIdentity };
}

async function withBoundStorageTarget(ctx, operation) {
  if (process.platform !== "linux") fail("STORAGE_TARGET_BINDING_UNSUPPORTED", "Storage target object binding requires Linux directory-handle semantics; this platform fails closed.");
  await assertTrustedLinuxStorageBoundary(ctx);
  const previousWorkingDirectory = process.cwd();
  let entered = false;
  try {
    process.chdir(ctx.auth.target.storage.root);
    entered = true;
    const boundIdentity = await currentWorkingDirectoryIdentity();
    if (!sameDirectoryIdentity(boundIdentity, ctx.auth.target.storage)) {
      fail("STORAGE_TARGET_IDENTITY_MISMATCH", "Storage target entered through pathname differs from the signed directory identity.");
    }
    const assertPathStillMapsToBoundObject = async () => {
      let current;
      try {
        const pathEntry = await lstat(ctx.auth.target.storage.root);
        if (pathEntry.isSymbolicLink() || !pathEntry.isDirectory()) {
          fail("STORAGE_TARGET_IDENTITY_MISMATCH", "Storage target pathname is no longer a regular directory.");
        }
        const realPath = await realpath(ctx.auth.target.storage.root);
        if (resolve(realPath) !== resolve(boundIdentity.realPath)) {
          fail("STORAGE_TARGET_IDENTITY_MISMATCH", "Storage target pathname no longer resolves to the bound directory path.");
        }
        current = { device: String(pathEntry.dev), inode: String(pathEntry.ino), realPath };
      }
      catch { fail("STORAGE_TARGET_IDENTITY_MISMATCH", "Storage target pathname can no longer be resolved safely."); }
      if (!sameDirectoryIdentity(current, boundIdentity)) fail("STORAGE_TARGET_IDENTITY_MISMATCH", "Storage target pathname no longer maps to the bound directory object.");
    };
    return await operation({
      identity: boundIdentity,
      assertPathStillMapsToBoundObject,
      snapshot: () => boundStorageSnapshot(),
    });
  } finally {
    if (entered) process.chdir(previousWorkingDirectory);
  }
}

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", windowsHide: true, ...options });
  if (result.status !== 0) fail("DOCKER_COMMAND_FAILED", "A scoped Docker inspection or operation failed.");
  return String(result.stdout ?? "").trim();
}

function inspectContainer(name) {
  let parsed;
  try { parsed = JSON.parse(docker(["inspect", name]))[0]; } catch { fail("CONTAINER_IDENTITY_UNAVAILABLE", "Target container inspection failed."); }
  const networks = Object.fromEntries(Object.entries(parsed.NetworkSettings?.Networks ?? {}).map(([networkName, value]) => [networkName, {
    ipAddress: value.IPAddress,
    networkId: value.NetworkID,
  }]));
  return {
    name: String(parsed.Name ?? "").replace(/^\//, ""),
    id: parsed.Id,
    image: parsed.Config?.Image,
    imageId: parsed.Image,
    labels: parsed.Config?.Labels ?? {},
    running: parsed.State?.Running === true,
    restartCount: Number(parsed.RestartCount ?? -1),
    networks,
  };
}

function processStartIdentity(pid) {
  if (process.platform === "linux") {
    const statLine = spawnSync("sh", ["-lc", `cat /proc/${Number(pid)}/stat 2>/dev/null`], { encoding: "utf8" });
    if (statLine.status !== 0) return null;
    const fields = String(statLine.stdout).trim().split(/\s+/);
    const boot = spawnSync("sh", ["-lc", "cat /proc/sys/kernel/random/boot_id 2>/dev/null"], { encoding: "utf8" });
    if (fields.length < 22 || boot.status !== 0) return null;
    return sha256(`${String(boot.stdout).trim()}:${fields[21]}`);
  }
  if (process.platform === "win32") {
    const script = `$p=Get-Process -Id ${Number(pid)} -ErrorAction Stop;[string]$p.StartTime.ToUniversalTime().Ticks`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true });
    return result.status === 0 ? sha256(String(result.stdout).trim()) : null;
  }
  return null;
}

async function hostIdentity() {
  let machineMaterial = null;
  if (process.platform === "linux" && await exists("/etc/machine-id")) machineMaterial = (await readFile("/etc/machine-id", "utf8")).trim();
  else machineMaterial = `${os.hostname()}|${os.platform()}|${os.arch()}`;
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    machineIdSha256: sha256(machineMaterial),
  };
}

function connectionOptions(urlString, password) {
  const parsed = new URL(urlString);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    timezone: "Z",
    dateStrings: true,
    multipleStatements: false,
  };
}

async function createMysqlConnection(options) {
  const isolatedRunnerTransport = process.platform === "linux"
    && process.env.MEGADESK_PROMOTION_ISOLATED_REHEARSAL === "YES"
    && options.host === "host.docker.internal"
    && options.port === 33330;
  const attempts = isolatedRunnerTransport ? 3 : 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await mysql.createConnection(isolatedRunnerTransport ? { ...options, connectTimeout: 15_000 } : options);
    } catch (error) {
      lastError = error;
      if (!isolatedRunnerTransport || attempt === attempts || !["ETIMEDOUT", "ECONNREFUSED", "ECONNRESET"].includes(error?.code)) throw error;
      await new Promise(resolvePromise => setTimeout(resolvePromise, attempt * 125));
    }
  }
  throw lastError;
}

async function tableMetadata(connection, schema, table) {
  const [columns] = await connection.execute(
    "SELECT COLUMN_NAME name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
    [schema, table],
  );
  const [indexes] = await connection.execute(
    "SELECT COLUMN_NAME columnName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME='PRIMARY' ORDER BY SEQ_IN_INDEX",
    [schema, table],
  );
  return { columns: columns.map(row => row.name), primary: indexes.map(row => row.columnName) };
}

export async function logicalFingerprint(urlString, password) {
  const options = connectionOptions(urlString, password);
  const database = options.database;
  const plan = JSON.parse(await readFile(PLAN_URL, "utf8"));
  const connection = await createMysqlConnection(options);
  const digest = createHash("sha256");
  try {
    const [tables] = await connection.execute(
      "SELECT TABLE_NAME tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME",
      [database],
    );
    for (const { tableName } of tables) {
      if (AUX_TABLES.has(tableName) || plan.blockedTables.includes(tableName)) continue;
      const meta = await tableMetadata(connection, database, tableName);
      if (!meta.primary.length) fail("NONDETERMINISTIC_TABLE", "A fingerprinted table has no primary key.");
      const safeColumns = meta.columns.filter(column => !plan.forbiddenColumns.includes(column.toLowerCase()));
      const [rows] = await connection.query(
        `SELECT ${safeColumns.map(quote).join(",")} FROM ${quote(database)}.${quote(tableName)} ORDER BY ${meta.primary.map(quote).join(",")}`,
      );
      digest.update(tableName);
      for (const row of rows) digest.update(canonical(row));
    }
    return digest.digest("hex");
  } finally { await connection.end(); }
}

async function mysqlIdentity(urlString, password) {
  const options = connectionOptions(urlString, password);
  const connection = await createMysqlConnection(options);
  try {
    const [server] = await connection.query("SELECT @@server_uuid serverUuid,@@version version,DATABASE() databaseName");
    const [migration] = await connection.query("SELECT COUNT(*) count,MAX(created_at) lastCreatedAt FROM __drizzle_migrations");
    return {
      serverUuid: String(server[0].serverUuid),
      version: String(server[0].version),
      database: String(server[0].databaseName),
      migrationCount: Number(migration[0].count),
      lastCreatedAt: String(migration[0].lastCreatedAt),
    };
  } finally { await connection.end(); }
}

async function assertDatabase(url, password, expected, label) {
  const identity = await mysqlIdentity(url, password);
  for (const field of ["serverUuid", "version", "database", "migrationCount", "lastCreatedAt"]) {
    if (String(identity[field]) !== String(expected[field])) fail("DATABASE_IDENTITY_MISMATCH", `${label} ${field} differs from authorization.`);
  }
  const fingerprint = await logicalFingerprint(url, password);
  if (fingerprint !== expected.fingerprint) fail("DATABASE_FINGERPRINT_MISMATCH", `${label} fingerprint differs from authorization.`);
  return { identity, fingerprint };
}

async function dropDatabase(urlString, password, database) {
  const options = connectionOptions(urlString, password);
  delete options.database;
  const connection = await createMysqlConnection(options);
  try { await connection.query(`DROP DATABASE IF EXISTS ${quote(database)}`); }
  finally { await connection.end(); }
}

async function runDockerInput(args, input, password) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn("docker", args, {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
      env: { ...process.env, MYSQL_PWD: password },
    });
    let stderr = "";
    child.stderr.on("data", chunk => { if (stderr.length < 4096) stderr += chunk.toString("utf8"); });
    child.on("error", () => reject(new OracleMainPromotionError("DOCKER_COMMAND_FAILED", "Could not start scoped Docker command.")));
    child.on("close", code => code === 0 ? resolvePromise() : reject(new OracleMainPromotionError("DATABASE_RESTORE_FAILED", "Scoped database restore failed.")));
    child.stdin.end(input);
  });
}

async function dumpDatabaseToFileDocker(container, user, database, path, password, { partial = false } = {}) {
  await mkdir(dirname(path), { recursive: true });
  const stream = createWriteStream(path, { flags: "wx", mode: 0o600 });
  let stderr = "";
  try {
    await new Promise((resolvePromise, reject) => {
      const args = [
        "exec", "-e", "MYSQL_PWD", container,
        "mysqldump", `-u${user}`, "--single-transaction", "--routines", "--triggers", "--hex-blob",
        "--set-gtid-purged=OFF", "--skip-lock-tables", "--databases", database,
      ];
      const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, MYSQL_PWD: password } });
      child.stderr.on("data", chunk => { if (stderr.length < 4096) stderr += chunk.toString("utf8"); });
      child.stdout.pipe(stream, { end: false });
      stream.once("error", () => {
        child.kill();
        reject(new OracleMainPromotionError("DB_BACKUP_FAILED", "Could not durably write database backup."));
      });
      if (partial) child.stdout.once("data", () => child.kill());
      child.on("error", () => reject(new OracleMainPromotionError("DB_BACKUP_FAILED", "Could not start database backup.")));
      child.on("close", code => code === 0 ? resolvePromise() : reject(new OracleMainPromotionError("DB_BACKUP_FAILED", "Database backup did not complete.")));
    });
    await new Promise((resolvePromise, reject) => stream.end(error => error ? reject(error) : resolvePromise()));
    const handle = await open(path, "r+");
    try { await fsyncHandle(handle, path); } finally { await handle.close(); }
  } finally {
    stream.destroy();
  }
  const info = await stat(path);
  return { path, bytes: info.size, sha256: await fileSha256(path) };
}

async function restoreDumpDocker(container, user, targetDatabase, dump, password, { partial = false } = {}) {
  const bytes = Buffer.isBuffer(dump) ? dump : await readFile(dump);
  const body = bytes.toString("utf8").split(/\r?\n/)
    .filter(line => !/^CREATE DATABASE /.test(line) && !/^USE `[^`]+`;\s*$/.test(line)).join("\n");
  const prefix = `DROP DATABASE IF EXISTS ${quote(targetDatabase)};\nCREATE DATABASE ${quote(targetDatabase)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\nUSE ${quote(targetDatabase)};\n`;
  const sql = partial ? prefix : `${prefix}${body}`;
  await runDockerInput(["exec", "-i", "-e", "MYSQL_PWD", container, "mysql", `-u${user}`, "--default-character-set=utf8mb4"], Buffer.from(sql), password);
  if (partial) fail("INJECTED_FAILURE", "Injected failure during database promotion.");
}

export function directSqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
  if (typeof value === "number" || typeof value === "bigint") {
    if (typeof value === "number" && !Number.isFinite(value)) fail("DB_BACKUP_FAILED", "Direct rehearsal backup encountered a non-finite value.");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "object") {
    let encoded;
    try { encoded = JSON.stringify(value); } catch { fail("DB_BACKUP_FAILED", "Direct rehearsal backup could not serialize a structured database value."); }
    if (typeof encoded !== "string") fail("DB_BACKUP_FAILED", "Direct rehearsal backup encountered an unsupported structured database value.");
    return directSqlLiteral(encoded);
  }
  return `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\0", "\\0").replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\u001a", "\\Z")}'`;
}

export function isGeneratedColumnExtra(value) {
  return /(?:^|\s)(?:VIRTUAL|STORED) GENERATED(?:\s|$)/i.test(String(value ?? ""));
}

async function dumpDatabaseToFileDirect(urlString, password, database, path, { partial = false } = {}) {
  const options = connectionOptions(databaseUrlFor(urlString, database), password);
  const connection = await createMysqlConnection(options);
  const lines = ["SET FOREIGN_KEY_CHECKS=0;"];
  try {
    const [tables] = await connection.execute(
      "SELECT TABLE_NAME tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME",
      [database],
    );
    for (const { tableName } of tables) {
      const [ddlRows] = await connection.query(`SHOW CREATE TABLE ${quote(database)}.${quote(tableName)}`);
      const ddl = ddlRows[0]?.["Create Table"];
      if (typeof ddl !== "string") fail("DB_BACKUP_FAILED", "Direct rehearsal backup could not read table DDL.");
      lines.push(`DROP TABLE IF EXISTS ${quote(tableName)};`, `${ddl};`);
      const [columns] = await connection.query(`SHOW COLUMNS FROM ${quote(database)}.${quote(tableName)}`);
      const fields = columns.filter(column => !isGeneratedColumnExtra(column.Extra)).map(column => String(column.Field));
      if (!fields.length) continue;
      const [rows] = await connection.query(`SELECT ${fields.map(quote).join(",")} FROM ${quote(database)}.${quote(tableName)}`);
      for (const row of rows) {
        lines.push(`INSERT INTO ${quote(tableName)} (${fields.map(quote).join(",")}) VALUES (${fields.map(field => directSqlLiteral(row[field])).join(",")});`);
      }
    }
    lines.push("SET FOREIGN_KEY_CHECKS=1;");
  } finally {
    await connection.end();
  }
  const output = Buffer.from(`${lines.join("\n")}\n`, "utf8");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, partial ? output.subarray(0, Math.max(1, Math.floor(output.length / 2))) : output, { flag: "wx", mode: 0o600 });
  const handle = await open(path, "r+");
  try { await fsyncHandle(handle, path); } finally { await handle.close(); }
  if (partial) fail("DB_BACKUP_FAILED", "Injected partial direct rehearsal database backup.");
  const info = await stat(path);
  return { path, bytes: info.size, sha256: await fileSha256(path) };
}

async function restoreDumpDirect(urlString, targetDatabase, dump, password, { partial = false } = {}) {
  const bytes = Buffer.isBuffer(dump) ? dump : await readFile(dump);
  const body = bytes.toString("utf8").split(/\r?\n/)
    .filter(line => !/^CREATE DATABASE /.test(line) && !/^USE `[^`]+`;\s*$/.test(line)).join("\n");
  const options = connectionOptions(urlString, password);
  delete options.database;
  options.multipleStatements = true;
  const connection = await createMysqlConnection(options);
  try {
    const prefix = `DROP DATABASE IF EXISTS ${quote(targetDatabase)};\nCREATE DATABASE ${quote(targetDatabase)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\nUSE ${quote(targetDatabase)};\n`;
    await connection.query(partial ? prefix : `${prefix}${body}`);
  } catch (error) {
    const driverCode = /^[A-Z0-9_]+$/.test(String(error?.code ?? "")) ? String(error.code) : "MYSQL_DRIVER_ERROR";
    fail("DATABASE_RESTORE_FAILED", `Direct rehearsal database restore failed (${driverCode}).`);
  } finally {
    await connection.end();
  }
  if (partial) fail("INJECTED_FAILURE", "Injected failure during direct rehearsal database promotion.");
}

async function dumpDatabaseToFile(ctx, path, options = {}) {
  if (isIsolatedRunnerRehearsal(ctx.auth)) {
    return dumpDatabaseToFileDirect(ctx.auth.target.mysql.url, ctx.password, ctx.auth.target.mysql.database, path, options);
  }
  return dumpDatabaseToFileDocker(ctx.auth.target.mysql.container.id, ctx.auth.target.mysql.user, ctx.auth.target.mysql.database, path, ctx.password, options);
}

async function restoreDatabase(ctx, targetDatabase, dump, options = {}) {
  if (isIsolatedRunnerRehearsal(ctx.auth)) {
    return restoreDumpDirect(ctx.auth.target.mysql.url, targetDatabase, dump, ctx.password, options);
  }
  return restoreDumpDocker(ctx.auth.target.mysql.container.id, ctx.auth.target.mysql.user, targetDatabase, dump, ctx.password, options);
}

async function verifiedRestore(ctx, dump, database, expectedFingerprint) {
  try {
    await restoreDatabase(ctx, database, Buffer.isBuffer(dump) ? dump : dump.path);
    const url = databaseUrlFor(ctx.auth.target.mysql.url, database);
    const fingerprint = await logicalFingerprint(url, ctx.password);
    if (fingerprint !== expectedFingerprint) fail("BACKUP_RESTORE_VERIFY_FAILED", `Restored verification database fingerprint differs: expected=${expectedFingerprint};observed=${fingerprint}.`);
    return fingerprint;
  } finally {
    await dropDatabase(ctx.auth.target.mysql.url, ctx.password, database);
  }
}

function databaseUrlFor(urlString, database) {
  const parsed = new URL(urlString);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function signedPayloadBytes(authorization) {
  return Buffer.from(canonical(authorization.payload), "utf8");
}

function assertGitCommit(value, label) {
  if (!GIT_COMMIT_RE.test(String(value))) fail("RELEASE_IDENTITY_INVALID", `${label} must be a full lowercase Git commit SHA.`);
  return String(value);
}

export function assertReleaseBinding(authorizedCommit, candidateCommit) {
  const authorized = assertGitCommit(authorizedCommit, "authorized release");
  const candidate = assertGitCommit(candidateCommit, "candidate release");
  if (!equalSecret(authorized, candidate)) {
    fail("RELEASE_IDENTITY_MISMATCH", "The authorized release does not match the candidate Git commit.");
  }
  return authorized;
}

export function assertAuthorizationPayload(payload, now) {
  if (!payload || typeof payload !== "object") fail("CORRUPT_AUTHORIZATION", "Authorization payload is invalid.");
  assertUuid(payload.operationId, "operation ID");
  assertUuid(payload.authorizationId, "authorization ID");
  assertHex(payload.humanAuthorizationSha256, "human authorization hash");
  if (!Number.isFinite(Date.parse(payload.issuedAt)) || !Number.isFinite(Date.parse(payload.expiresAt))
      || now < Date.parse(payload.issuedAt) || now >= Date.parse(payload.expiresAt)) {
    fail("AUTHORIZATION_EXPIRED", "Authorization is not currently valid.");
  }
  if (!payload.release || typeof payload.release !== "object") {
    fail("RELEASE_IDENTITY_REQUIRED", "Authorization must bind an exact Git release commit.");
  }
  assertGitCommit(payload.release.gitCommit, "authorized release");
  if (!payload.freeze || typeof payload.freeze !== "object") {
    fail("FREEZE_EVIDENCE_REQUIRED", "Authorization must bind a signed freeze-evidence artifact.");
  }
  assertUuid(payload.freeze.requestId, "freeze request identity");
  assertUuid(payload.freeze.freezeId, "freeze identity");
  assertHex(payload.freeze.evidenceSha256, "freeze evidence hash");
  if (!payload.candidate?.database || !payload.candidate?.storage) {
    fail("CORRUPT_AUTHORIZATION", "Authorization candidate identity is incomplete.");
  }
  if (!payload.candidate.release || typeof payload.candidate.release !== "object") {
    fail("RELEASE_IDENTITY_REQUIRED", "Authorization must bind the candidate artifact to an exact Git release commit.");
  }
  assertReleaseBinding(payload.release.gitCommit, payload.candidate.release.gitCommit);
  if (payload.candidate.database.fingerprint !== APPROVED_DATABASE_FINGERPRINT
      || payload.candidate.storage.fingerprint !== APPROVED_STORAGE_MANIFEST) {
    fail("APPROVED_CANDIDATE_MISMATCH", "Signed candidate differs from the independently approved fingerprints.");
  }
  if (!Array.isArray(payload.allowedActions) || !payload.singleUse) {
    fail("AUTHORIZATION_POLICY_INVALID", "Authorization must be explicit and single-use.");
  }
  return payload;
}

export async function loadPinnedTrustRoot(path, expectedSha256, label) {
  try {
    await assertNoSymlinkPath(path);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) fail("TRUST_ROOT_UNSAFE", `${label} must be a regular, non-symlink file.`);
    if (process.platform === "linux" && (info.mode & 0o022) !== 0) {
      fail("TRUST_ROOT_UNSAFE", `${label} must not be group or world writable.`);
    }
    const key = await readFile(path);
    if (!equalSecret(sha256(key), expectedSha256)) fail("TRUST_ROOT_PIN_MISMATCH", `${label} differs from the compiled trust root.`);
    return key;
  } catch (error) {
    if (error instanceof OracleMainPromotionError) throw error;
    fail("TRUST_ROOT_UNAVAILABLE", `${label} is unavailable: ${error?.code ?? "UNEXPECTED"}.`);
  }
}

export async function loadAuthorization(environment = process.env, { now = Date.now() } = {}) {
  const authPath = environment.MEGADESK_PROMOTION_AUTHORIZATION_FILE;
  if (!authPath) fail("AUTHORIZATION_REQUIRED", "A signed authorization artifact is required.");
  let raw;
  try {
    await assertNoSymlinkPath(authPath);
    raw = await readFile(authPath);
  } catch (error) {
    if (error instanceof OracleMainPromotionError) throw error;
    fail("AUTHORIZATION_UNAVAILABLE", `Authorization artifact is unavailable: ${error?.code ?? "UNEXPECTED"}.`);
  }
  const key = await loadPinnedTrustRoot(PROMOTION_TRUST_ROOT_PATH, PROMOTION_TRUST_ROOT_SHA256, "promotion trust root");
  let authorization;
  try { authorization = JSON.parse(raw.toString("utf8")); } catch { fail("CORRUPT_AUTHORIZATION", "Authorization artifact is not valid JSON."); }
  if (authorization.kind !== AUTH_KIND || authorization.version !== AUTH_VERSION || typeof authorization.payload !== "object") {
    fail("CORRUPT_AUTHORIZATION", "Authorization kind/version is invalid.");
  }
  let signature;
  try { signature = Buffer.from(authorization.signature, "base64"); } catch { fail("CORRUPT_AUTHORIZATION", "Authorization signature is invalid."); }
  if (!verifySignature(null, signedPayloadBytes(authorization), key, signature)) fail("AUTHORIZATION_SIGNATURE_INVALID", "Authorization signature verification failed.");
  const payload = assertAuthorizationPayload(authorization.payload, now);
  if (payload.operationId !== environment.MEGADESK_PROMOTION_OPERATION_ID || payload.authorizationId !== environment.MEGADESK_PROMOTION_AUTHORIZATION_ID) {
    fail("AUTHORIZATION_CONTEXT_MISMATCH", "Operation or authorization ID differs from the external invocation context.");
  }
  if (sha256(environment.MEGADESK_PROMOTION_HUMAN_AUTHORIZATION ?? "") !== payload.humanAuthorizationSha256) {
    fail("HUMAN_AUTHORIZATION_REQUIRED", "Human authorization proof does not match the signed authorization.");
  }
  return { authorization, raw, key, path: resolve(authPath) };
}

function gitOutput(args, failureCode, message) {
  const result = spawnSync("git", ["-C", REPOSITORY_ROOT, ...args], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) fail(failureCode, `${message}: ${result.error?.code ?? result.stderr?.trim() ?? "UNEXPECTED"}.`);
  return String(result.stdout ?? "").trim();
}

export function candidateGitCommit() {
  const commit = gitOutput(["rev-parse", "--verify", "HEAD^{commit}"], "CANDIDATE_RELEASE_UNAVAILABLE", "Candidate Git HEAD is unavailable");
  assertGitCommit(commit, "candidate Git HEAD");
  const clean = spawnSync("git", ["-C", REPOSITORY_ROOT, "diff-index", "--quiet", "HEAD", "--"], { encoding: "utf8", windowsHide: true });
  if (clean.error) fail("CANDIDATE_RELEASE_UNAVAILABLE", `Candidate Git cleanliness cannot be checked: ${clean.error.code ?? "UNEXPECTED"}.`);
  if (clean.status === 1) fail("CANDIDATE_RELEASE_DIRTY", "Candidate Git checkout has tracked changes.");
  if (clean.status !== 0) fail("CANDIDATE_RELEASE_UNAVAILABLE", `Candidate Git cleanliness cannot be checked: ${clean.stderr?.trim() ?? "UNEXPECTED"}.`);
  return commit;
}

export function assertFreezeEvidencePayload(payload, auth, candidateCommit, now = Date.now()) {
  if (!payload || typeof payload !== "object") fail("FREEZE_EVIDENCE_CORRUPT", "Freeze evidence payload is invalid.");
  if (payload.active !== true) fail("FREEZE_NOT_ACTIVE", "Freeze evidence does not attest an active freeze.");
  if (payload.writersDrained !== true || payload.activeWriters !== 0 || payload.inFlightWrites !== 0) {
    fail("WRITERS_NOT_DRAINED", "Freeze evidence does not attest that all writers are drained.");
  }
  assertUuid(payload.freezeId, "freeze evidence identity");
  assertUuid(payload.requestId, "freeze evidence request identity");
  if (payload.requestId !== auth.freeze.requestId) fail("FREEZE_REQUEST_MISMATCH", "Freeze evidence request differs from authorization.");
  if (payload.freezeId !== auth.freeze.freezeId) fail("FREEZE_IDENTITY_MISMATCH", "Freeze evidence identity differs from authorization.");
  if (payload.operationId !== auth.operationId) fail("FREEZE_OPERATION_MISMATCH", "Freeze evidence operation differs from authorization.");
  const authorizedRelease = assertReleaseBinding(auth.release?.gitCommit, candidateCommit);
  if (payload.release?.gitCommit !== authorizedRelease) fail("FREEZE_RELEASE_MISMATCH", "Freeze evidence release differs from the authorized candidate.");
  if (payload.target?.hostname !== auth.target?.host?.hostname || payload.target?.database !== auth.target?.mysql?.database) {
    fail("FREEZE_TARGET_MISMATCH", "Freeze evidence target differs from authorization.");
  }
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now || now >= expiresAt
      || expiresAt - issuedAt > MAX_FREEZE_EVIDENCE_TTL_MS) {
    fail("FREEZE_EVIDENCE_STALE", "Freeze evidence is not current within the maximum trusted TTL.");
  }
  return payload;
}

export async function loadTrustedFreezeEvidence(ctx, candidateCommit, { now = Date.now() } = {}) {
  const path = ctx.environment.MEGADESK_PROMOTION_FREEZE_EVIDENCE_FILE;
  if (!path) fail("FREEZE_EVIDENCE_REQUIRED", "A signed freeze-evidence artifact is required before destructive promotion.");
  let raw;
  try {
    await assertNoSymlinkPath(path);
    raw = await readFile(path);
  } catch (error) {
    if (error instanceof OracleMainPromotionError) throw error;
    fail("FREEZE_EVIDENCE_UNAVAILABLE", `Freeze evidence is unavailable: ${error?.code ?? "UNEXPECTED"}.`);
  }
  if (!equalSecret(sha256(raw), authFreezeEvidenceSha256(ctx.auth))) {
    fail("FREEZE_EVIDENCE_SUBSTITUTION", "Freeze evidence differs from the artifact signed in authorization.");
  }
  let evidence;
  try { evidence = JSON.parse(raw.toString("utf8")); } catch { fail("FREEZE_EVIDENCE_CORRUPT", "Freeze evidence is not valid JSON."); }
  if (evidence.kind !== FREEZE_EVIDENCE_KIND || evidence.version !== FREEZE_EVIDENCE_VERSION || typeof evidence.payload !== "object") {
    fail("FREEZE_EVIDENCE_CORRUPT", "Freeze evidence kind/version is invalid.");
  }
  let signature;
  try { signature = Buffer.from(evidence.signature, "base64"); } catch { fail("FREEZE_EVIDENCE_CORRUPT", "Freeze evidence signature is invalid."); }
  const key = await loadPinnedTrustRoot(FREEZE_TRUST_ROOT_PATH, FREEZE_TRUST_ROOT_SHA256, "freeze-evidence trust root");
  if (!verifySignature(null, Buffer.from(canonical(evidence.payload), "utf8"), key, signature)) {
    fail("FREEZE_EVIDENCE_SIGNATURE_INVALID", "Freeze evidence signature verification failed.");
  }
  return { evidence, raw, path: resolve(path), payload: assertFreezeEvidencePayload(evidence.payload, ctx.auth, candidateCommit, now) };
}

function authFreezeEvidenceSha256(auth) {
  if (!auth?.freeze || typeof auth.freeze !== "object") fail("FREEZE_EVIDENCE_REQUIRED", "Authorization does not bind freeze evidence.");
  return assertHex(auth.freeze.evidenceSha256, "freeze evidence hash");
}

export function assertTargetPolicy(auth, environment) {
  const mode = environment.MEGADESK_PROMOTION_MODE;
  const targetUrl = new URL(auth.target.mysql.url);
  if (targetUrl.password || decodeURIComponent(targetUrl.pathname.replace(/^\//, "")) !== auth.target.mysql.database
      || decodeURIComponent(targetUrl.username) !== auth.target.mysql.user) {
    fail("MYSQL_URL_IDENTITY_MISMATCH", "MySQL URL must contain the signed user/database and no password.");
  }
  const verificationDatabases = [auth.verification.backupDatabase, auth.verification.candidateDatabase];
  if (new Set([auth.target.mysql.database, ...verificationDatabases]).size !== 3
      || verificationDatabases.some(name => !/^megadesk_test_[a-z0-9_]+$/.test(name))) {
    fail("VERIFICATION_DATABASE_POLICY_MISMATCH", "Verification databases must be distinct disposable databases.");
  }
  if (mode !== "oracle-main" && mode !== "oracle-main-shaped-disposable") fail("PRODUCTION_MODE_REQUIRED", "Explicit promotion mode is required.");
  if (mode === "oracle-main") {
    if (auth.target.class !== "oracle-main" || auth.target.host.hostname !== PRODUCTION_HOSTNAME
        || auth.target.mysql.container.name !== PRODUCTION_MYSQL_CONTAINER || auth.target.mysql.database !== PRODUCTION_DATABASE
        || resolve(auth.target.storage.root) !== resolve(PRODUCTION_STORAGE_ROOT)
        || auth.target.application.container.name !== PRODUCTION_APP_CONTAINER
        || resolve(auth.paths.allowedRoot) !== resolve(PRODUCTION_OPERATIONS_ROOT)
        || resolve(auth.paths.lock) !== resolve(PRODUCTION_LOCK_PATH)) {
      fail("PRODUCTION_TARGET_POLICY_MISMATCH", "Target is not the compiled Oracle MAIN identity.");
    }
    if (targetUrl.port !== "3306" || targetUrl.hostname !== auth.target.mysql.network.ipAddress) {
      fail("PRODUCTION_DATABASE_ROUTE_MISMATCH", "Production database URL must use the authorized target container IP and port.");
    }
  } else if (isIsolatedRunnerRehearsal(auth)) {
    const rehearsal = auth.rehearsal;
    const runId = String(rehearsal.runId ?? "");
    const expectedRoot = `${ISOLATED_REHEARSAL_ROOT_PREFIX}${runId}`;
    const expectedMysql = `megadesk-test-${runId}-mysql`;
    const expectedNetwork = `megadesk-test-${runId}-net`;
    const expectedVolume = `megadesk_test_${runId.replaceAll("-", "_")}_mysql_data`;
    const expectedDatabase = `megadesk_test_${runId.replaceAll("-", "_")}`;
    const port = Number(rehearsal.port);
    const safeRunId = /^oracle-toctou-linux-\d{8}-[a-z0-9]{8,16}$/.test(runId);
    if (environment.MEGADESK_PROMOTION_ISOLATED_REHEARSAL !== "YES" || process.platform !== "linux"
        || !safeRunId || !Number.isInteger(port) || port < 33330 || port > 33399
        || targetUrl.hostname !== "host.docker.internal" || Number(targetUrl.port) !== port
        || auth.target.mysql.database !== expectedDatabase || auth.target.mysql.container.name !== expectedMysql
        || rehearsal.network !== expectedNetwork || rehearsal.volume !== expectedVolume
        || resolve(auth.paths.allowedRoot) !== resolve(expectedRoot)
        || resolve(auth.target.storage.root) !== resolve(expectedRoot, "target")
        || resolve(auth.candidate.storage.root) !== resolve(expectedRoot, "candidate")
        || !isInside(expectedRoot, auth.backup.storage.root) || !isInside(expectedRoot, auth.verification.storageRoot)) {
      fail("ISOLATED_REHEARSAL_POLICY_MISMATCH", "Isolated rehearsal configuration is not an exact, disposable Linux identity.");
    }
  } else {
    if (environment.MEGADESK_PROMOTION_ALLOW_DISPOSABLE !== "YES") fail("DISPOSABLE_MODE_NOT_AUTHORIZED", "Disposable rehearsal requires an explicit secondary guard.");
    if (auth.target.class !== "oracle-main-shaped-disposable"
        || !/^megadesk-test-main-promotion-[a-z0-9-]+$/.test(auth.target.mysql.container.name)
        || !/^megadesk_test_main_promotion_[a-z0-9_]+$/.test(auth.target.mysql.database)
        || !resolve(auth.paths.allowedRoot).toLowerCase().endsWith(REHEARSAL_ROOT_SUFFIX.toLowerCase())
        || !isInside(auth.paths.allowedRoot, auth.target.storage.root)) {
      fail("DISPOSABLE_TARGET_POLICY_MISMATCH", "Disposable target is outside the exact rehearsal namespace.");
    }
    if (targetUrl.hostname !== "127.0.0.1" || targetUrl.port !== "33329") {
      fail("DISPOSABLE_DATABASE_ROUTE_MISMATCH", "Disposable rehearsal must use exact loopback port 33329.");
    }
  }
}

export function assertDestructivePlatform(action, platform = process.platform) {
  if (["promote", "recover", "rollback"].includes(action) && platform !== "linux") {
    fail("STORAGE_TARGET_BINDING_UNSUPPORTED", "Promotion and rollback require Linux storage target binding; this platform fails closed before mutation.");
  }
}

async function mysqlServerIdentity(urlString, password) {
  const options = connectionOptions(urlString, password);
  delete options.database;
  const connection = await createMysqlConnection(options);
  try {
    const [rows] = await connection.query("SELECT @@server_uuid serverUuid,@@version version");
    return { serverUuid: String(rows[0].serverUuid), version: String(rows[0].version) };
  } finally { await connection.end(); }
}

async function assertIdentityEnvelope(ctx, { requirePreState = true } = {}) {
  const { auth } = ctx;
  const host = await hostIdentity();
  for (const field of ["hostname", "platform", "arch", "machineIdSha256"]) {
    if (String(host[field]).toLowerCase() !== String(auth.target.host[field]).toLowerCase()) fail("HOST_IDENTITY_MISMATCH", `Host ${field} differs from authorization.`);
  }
  const directRehearsal = isIsolatedRunnerRehearsal(auth);
  const mysqlContainer = directRehearsal ? auth.target.mysql.container : inspectContainer(auth.target.mysql.container.name);
  const appContainer = directRehearsal ? null : inspectContainer(auth.target.application.container.name);
  if (!directRehearsal) {
    for (const [actual, expected, label] of [
      [mysqlContainer.name, auth.target.mysql.container.name, "MySQL container name"],
      [mysqlContainer.id, auth.target.mysql.container.id, "MySQL container ID"],
      [mysqlContainer.imageId, auth.target.mysql.container.imageId, "MySQL image ID"],
      [appContainer.name, auth.target.application.container.name, "application container name"],
      [appContainer.id, auth.target.application.container.id, "application container ID"],
      [appContainer.imageId, auth.target.application.container.imageId, "application image ID"],
    ]) if (actual !== expected) fail("CONTAINER_IDENTITY_MISMATCH", `${label} differs from authorization.`);
    if (!mysqlContainer.running || !appContainer.running || mysqlContainer.restartCount !== auth.target.mysql.container.restartCount
        || appContainer.restartCount !== auth.target.application.container.restartCount) {
      fail("CONTAINER_STATE_MISMATCH", "Container running/restart identity differs from authorization.");
    }
    for (const [key, value] of Object.entries(auth.target.mysql.container.labels)) {
      if (mysqlContainer.labels[key] !== value) fail("CONTAINER_LABEL_MISMATCH", "MySQL container labels differ from authorization.");
    }
    for (const [key, value] of Object.entries(auth.target.application.container.labels)) {
      if (appContainer.labels[key] !== value) fail("CONTAINER_LABEL_MISMATCH", "Application container labels differ from authorization.");
    }
    const network = mysqlContainer.networks[auth.target.mysql.network.name];
    if (!network || network.networkId !== auth.target.mysql.network.id || network.ipAddress !== auth.target.mysql.network.ipAddress) {
      fail("MYSQL_NETWORK_IDENTITY_MISMATCH", "MySQL container network identity differs from authorization.");
    }
  }
  const parentIdentity = await directoryIdentity(dirname(auth.target.storage.root));
  if (parentIdentity.device !== String(auth.target.storage.parent.device) || parentIdentity.inode !== String(auth.target.storage.parent.inode)
      || resolve(parentIdentity.realPath) !== resolve(auth.target.storage.parent.realPath)) {
    fail("STORAGE_PARENT_IDENTITY_MISMATCH", "Storage parent identity differs from authorization.");
  }
  const server = await mysqlServerIdentity(auth.target.mysql.url, ctx.password);
  if (server.serverUuid !== auth.target.mysql.serverUuid || server.version !== auth.target.mysql.version) {
    fail("MYSQL_SERVER_IDENTITY_MISMATCH", "MySQL server identity differs from authorization.");
  }
  if (!requirePreState) return { host, mysqlContainer, appContainer, parentIdentity, server };
  const storageIdentity = await directoryIdentity(auth.target.storage.root);
  if (storageIdentity.device !== String(auth.target.storage.device) || storageIdentity.inode !== String(auth.target.storage.inode)
      || resolve(storageIdentity.realPath) !== resolve(auth.target.storage.realPath)) {
    fail("STORAGE_ROOT_IDENTITY_MISMATCH", "Storage root identity differs from authorization.");
  }
  const preDatabase = await assertDatabase(auth.target.mysql.url, ctx.password, auth.preState.database, "pre-promotion target");
  const preStorage = await storageSnapshot(auth.target.storage.root);
  if (preStorage.fingerprint !== auth.preState.storage.fingerprint || preStorage.files !== auth.preState.storage.files || preStorage.bytes !== auth.preState.storage.bytes) {
    fail("PRESTATE_STORAGE_MISMATCH", "Pre-promotion storage differs from authorization.");
  }
  return { host, mysqlContainer, appContainer, parentIdentity, storageIdentity, preDatabase, preStorage };
}

function sameDirectoryIdentity(left, right) {
  return left && right && left.device === String(right.device) && left.inode === String(right.inode)
    && resolve(left.realPath) === resolve(right.realPath);
}

function sameStorageSnapshot(left, right) {
  return left && right && left.fingerprint === right.fingerprint && left.files === right.files && left.bytes === right.bytes;
}

function targetEvidence(observed) {
  return {
    host: observed.host,
    mysqlContainer: observed.mysqlContainer,
    appContainer: observed.appContainer,
    parentIdentity: observed.parentIdentity,
    storageIdentity: observed.storageIdentity ?? null,
    database: observed.database ? { identity: observed.database.identity, fingerprint: observed.database.fingerprint } : null,
    storage: observed.storage ? { fingerprint: observed.storage.fingerprint, files: observed.storage.files, bytes: observed.storage.bytes } : null,
  };
}

async function observeTarget(ctx, { database = null, storage = null, requireStorageIdentity = true } = {}) {
  const envelope = await assertIdentityEnvelope(ctx, { requirePreState: false });
  let storageIdentity = null;
  if (requireStorageIdentity) {
    storageIdentity = await directoryIdentity(ctx.auth.target.storage.root);
    if (!sameDirectoryIdentity(storageIdentity, ctx.auth.target.storage)) {
      fail("STORAGE_ROOT_IDENTITY_MISMATCH", "Storage root identity differs from authorization.");
    }
  }
  const observedDatabase = database
    ? await assertDatabase(ctx.auth.target.mysql.url, ctx.password, database, "destructive-boundary target")
    : null;
  const observedStorage = storage ? await storageSnapshot(ctx.auth.target.storage.root) : null;
  if (storage && !sameStorageSnapshot(observedStorage, storage)) {
    fail("DESTRUCTIVE_BOUNDARY_STORAGE_MISMATCH", "Storage differs from the expected destructive-boundary state.");
  }
  return { ...envelope, storageIdentity, database: observedDatabase, storage: observedStorage };
}

function candidateEvidence(ctx) {
  if (!ctx.candidate) return null;
  return {
    database: { sha256: ctx.candidate.database.sha256, identity: ctx.candidate.database.identity, bytes: ctx.candidate.database.bytes.length },
    storage: candidateStorageEvidence(ctx.candidate.storage),
  };
}

async function prepareCandidate(ctx) {
  const database = await readCandidateFile(ctx.auth.candidate.database.dump.path);
  if (database.sha256 !== ctx.auth.candidate.database.dump.sha256) {
    fail("CANDIDATE_DUMP_MISMATCH", "Candidate database artifact differs from the signed SHA-256.");
  }
  const storage = await captureCandidateStorage(ctx.auth.candidate.storage.root);
  if (storage.fingerprint !== APPROVED_STORAGE_MANIFEST || storage.fingerprint !== ctx.auth.candidate.storage.fingerprint
      || storage.files !== ctx.auth.candidate.storage.files || storage.bytes !== ctx.auth.candidate.storage.bytes) {
    fail("CANDIDATE_STORAGE_MISMATCH", "Candidate storage differs from the approved identity.");
  }
  ctx.candidate = { database, storage };
  return ctx.candidate;
}

async function assertCandidateStillBound(ctx) {
  if (!ctx.candidate) fail("CANDIDATE_CAPTURE_REQUIRED", "Candidate must be captured before a destructive boundary.");
  try {
    const database = await readCandidateFile(ctx.auth.candidate.database.dump.path);
    if (database.sha256 !== ctx.candidate.database.sha256 || !sameFileIdentity(database.identity, ctx.candidate.database.identity)) {
      fail("CANDIDATE_SOURCE_CHANGED", "Candidate database identity changed after capture.");
    }
    const storage = await captureCandidateStorage(ctx.auth.candidate.storage.root);
    if (!sameCandidateStorage(storage, ctx.candidate.storage)) {
      fail("CANDIDATE_SOURCE_CHANGED", "Candidate storage identity changed after capture.");
    }
  } catch (error) {
    if (error?.code === "CANDIDATE_SOURCE_CHANGED") throw error;
    fail("CANDIDATE_SOURCE_CHANGED", `Candidate source cannot be revalidated: ${error?.code ?? "UNEXPECTED"}.`);
  }
}

async function testHook(ctx, point) {
  const selected = ctx.environment.MEGADESK_PROMOTION_TEST_HOOK;
  if (!selected || selected !== point) return;
  if ((!isIsolatedRunnerRehearsal(ctx.auth) && ctx.auth.target.class !== "oracle-main-shaped-disposable")
      || ctx.environment.MEGADESK_PROMOTION_ALLOW_DISPOSABLE !== "YES") {
    fail("TEST_CONTROL_FORBIDDEN", "Promotion test hooks are forbidden outside a bounded disposable rehearsal.");
  }
  const hookRoot = resolve(String(ctx.environment.MEGADESK_PROMOTION_TEST_HOOK_ROOT ?? ""));
  if (!ctx.environment.MEGADESK_PROMOTION_TEST_HOOK_ROOT || !isInside(ctx.paths.allowedRoot, hookRoot, true)) {
    fail("UNSAFE_TEST_HOOK", "Promotion test hook path escaped the authorized disposable root.");
  }
  await assertNoSymlinkPath(hookRoot, { allowMissingLeaf: true });
  await mkdir(hookRoot, { recursive: true });
  const ready = resolve(hookRoot, `${point}.ready`);
  const proceed = resolve(hookRoot, `${point}.continue`);
  if (!isInside(hookRoot, ready) || !isInside(hookRoot, proceed)) fail("UNSAFE_TEST_HOOK", "Promotion test hook path is invalid.");
  await durableJson(ready, { kind: "megadesk-promotion-disposable-test-hook", version: 1, point, readyAt: nowIso() }, { exclusive: true });
  const deadline = Date.now() + 30_000;
  while (!await exists(proceed)) {
    if (Date.now() >= deadline) fail("TEST_HOOK_TIMEOUT", `Timed out waiting for disposable test hook ${point}.`);
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  await assertNoSymlinkPath(proceed);
}

async function revalidateDestructiveBoundary(ctx, boundary, expectation, { candidate = true } = {}) {
  if (candidate) await assertCandidateStillBound(ctx);
  const first = await observeTarget(ctx, expectation);
  await writeJournal(ctx, "TARGET_REVALIDATED", { boundary, target: targetEvidence(first), candidate: candidate ? candidateEvidence(ctx) : null });
  await testHook(ctx, `before_${boundary.toLowerCase()}`);
  if (candidate) await assertCandidateStillBound(ctx);
  return observeTarget(ctx, expectation);
}

async function revalidateRollbackBoundary(ctx, boundary, expectation) {
  try {
    return await revalidateDestructiveBoundary(ctx, boundary, { ...expectation, requireStorageIdentity: true }, { candidate: false });
  } catch (error) {
    fail("HUMAN_RECOVERY_REQUIRED", `Rollback target identity is ambiguous at ${boundary}: ${error.code ?? "UNEXPECTED"}.`);
  }
}

export function assertBackupEvidence(ctx) {
  const backup = ctx.backup;
  if (!backup?.database || !backup?.storage) fail("BACKUP_EVIDENCE_REQUIRED", "A fully verified backup is required before destructive promotion.");
  if (resolve(backup.database.path ?? "") !== resolve(ctx.auth.backup.database.path)
      || !Number.isSafeInteger(backup.database.bytes) || backup.database.bytes <= 0) {
    fail("BACKUP_EVIDENCE_INVALID", "Database backup evidence is incomplete or substituted.");
  }
  assertHex(backup.database.sha256, "database backup hash");
  if (!sameStorageSnapshot(backup.storage, ctx.auth.preState.storage)) {
    fail("BACKUP_EVIDENCE_INVALID", "Storage backup evidence differs from the authorized pre-state.");
  }
  if (backup.restoredDb !== ctx.auth.preState.database.fingerprint || backup.restoredStorage !== ctx.auth.preState.storage.fingerprint) {
    fail("BACKUP_EVIDENCE_INVALID", "Backup restore verification does not match the authorized pre-state.");
  }
  return backup;
}

async function assertAuthorizationStillTrusted(ctx) {
  const reloaded = await loadAuthorization(ctx.environment);
  if (!equalSecret(sha256(reloaded.raw), ctx.authorizationSha256)
      || canonical(reloaded.authorization.payload) !== canonical(ctx.auth)) {
    fail("AUTHORIZATION_CHANGED", "Authorization changed after initial verification.");
  }
  assertTargetPolicy(ctx.auth, ctx.environment);
}

export async function assertPromotionDestructiveBoundary(ctx, expectation) {
  assertBackupEvidence(ctx);
  await revalidateDestructiveBoundary(ctx, "DB_PROMOTION", expectation);
  await assertAuthorizationStillTrusted(ctx);
  const candidateCommit = candidateGitCommit();
  assertReleaseBinding(ctx.auth.release?.gitCommit, candidateCommit);
  assertReleaseBinding(ctx.auth.candidate?.release?.gitCommit, candidateCommit);
  const freeze = await loadTrustedFreezeEvidence(ctx, candidateCommit);
  await assertCandidateStillBound(ctx);
  const finalTarget = await observeTarget(ctx, expectation);
  return { candidateCommit, freeze, target: finalTarget };
}

export async function runDestructivePromotion(ctx, expectation, { boundary = assertPromotionDestructiveBoundary, write = promoteDatabase } = {}) {
  await boundary(ctx, expectation);
  return write(ctx);
}

async function assertRollbackDestructiveBoundary(ctx, boundary, expectation) {
  assertBackupEvidence(ctx);
  await revalidateRollbackBoundary(ctx, boundary, expectation);
  await assertAuthorizationStillTrusted(ctx);
  const candidateCommit = candidateGitCommit();
  assertReleaseBinding(ctx.auth.release?.gitCommit, candidateCommit);
  assertReleaseBinding(ctx.auth.candidate?.release?.gitCommit, candidateCommit);
  await loadTrustedFreezeEvidence(ctx, candidateCommit);
  return observeTarget(ctx, expectation);
}

function checksummed(body) {
  return { ...body, checksum: sha256(canonical(body)) };
}

function validateChecksummed(value, kind, version, code) {
  if (!value || value.kind !== kind || value.version !== version || typeof value.checksum !== "string") fail(code, `${kind} is invalid.`);
  const { checksum, ...body } = value;
  if (!equalSecret(checksum, sha256(canonical(body)))) fail(code, `${kind} checksum is invalid.`);
  return { ...body, checksum };
}

async function loadJournal(path) {
  let parsed;
  try { parsed = JSON.parse(await readFile(path, "utf8")); } catch { fail("CORRUPT_JOURNAL", "Transition journal is missing, unreadable, or corrupt."); }
  const journal = validateChecksummed(parsed, JOURNAL_KIND, JOURNAL_VERSION, "CORRUPT_JOURNAL");
  if (!Array.isArray(journal.history) || journal.history.length !== journal.sequence) fail("CORRUPT_JOURNAL", "Transition journal history is incomplete.");
  let previous = null;
  for (let index = 0; index < journal.history.length; index += 1) {
    const entry = journal.history[index];
    if (entry.sequence !== index + 1 || entry.previousChecksum !== previous) fail("CORRUPT_JOURNAL", "Transition journal chain is invalid.");
    const { checksum, ...body } = entry;
    if (!equalSecret(checksum, sha256(canonical(body)))) fail("CORRUPT_JOURNAL", "Transition journal entry checksum is invalid.");
    previous = checksum;
  }
  if (journal.history.at(-1)?.phase !== journal.phase || journal.history.at(-1)?.checksum !== journal.entryChecksum) {
    fail("CORRUPT_JOURNAL", "Transition journal head is invalid.");
  }
  return journal;
}

async function writeJournal(ctx, phase, evidence = {}) {
  const previous = ctx.journal;
  const entryBody = {
    phase,
    sequence: previous ? previous.sequence + 1 : 1,
    previousChecksum: previous?.entryChecksum ?? null,
    evidence,
    recordedAt: nowIso(),
  };
  const entry = { ...entryBody, checksum: sha256(canonical(entryBody)) };
  const body = {
    kind: JOURNAL_KIND,
    version: JOURNAL_VERSION,
    operationId: ctx.auth.operationId,
    authorizationId: ctx.auth.authorizationId,
    phase,
    sequence: entry.sequence,
    entryChecksum: entry.checksum,
    history: [...(previous?.history ?? []), entry],
    updatedAt: nowIso(),
  };
  const value = checksummed(body);
  await durableJson(ctx.paths.journal, value);
  ctx.journal = { ...body, checksum: value.checksum };
  return ctx.journal;
}

async function claimAuthorization(ctx) {
  const path = resolve(ctx.paths.usedAuthorizations, `${ctx.auth.authorizationId}.json`);
  await mkdir(ctx.paths.usedAuthorizations, { recursive: true });
  if (await exists(path)) {
    let claimed;
    try { claimed = validateChecksummed(JSON.parse(await readFile(path, "utf8")), "megadesk-promotion-authorization-claim", 1, "AUTHORIZATION_REPLAY"); }
    catch { fail("AUTHORIZATION_REPLAY", "Authorization claim is corrupt or already consumed."); }
    if (claimed.operationId !== ctx.auth.operationId) fail("AUTHORIZATION_REPLAY", "Authorization was already claimed by another operation.");
    return false;
  }
  const body = { kind: "megadesk-promotion-authorization-claim", version: 1, authorizationId: ctx.auth.authorizationId, operationId: ctx.auth.operationId, claimedAt: nowIso() };
  try { await durableJson(path, checksummed(body), { exclusive: true }); }
  catch (error) {
    if (error?.code === "EXCLUSIVE_FILE_EXISTS") fail("AUTHORIZATION_REPLAY", "Single-use authorization was claimed concurrently.");
    throw error;
  }
  return true;
}

async function assertAuthorizationUnclaimed(ctx) {
  const path = resolve(ctx.paths.usedAuthorizations, `${ctx.auth.authorizationId}.json`);
  if (!await exists(path)) return;
  try { validateChecksummed(JSON.parse(await readFile(path, "utf8")), "megadesk-promotion-authorization-claim", 1, "AUTHORIZATION_REPLAY"); }
  catch { fail("AUTHORIZATION_REPLAY", "Authorization claim is corrupt or already consumed."); }
  fail("AUTHORIZATION_REPLAY", "Single-use authorization was already consumed.");
}

async function acquireLock(ctx, action) {
  const lockRoot = ctx.paths.lock;
  try { await mkdir(lockRoot); }
  catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let owner;
    try { owner = validateChecksummed(JSON.parse(await readFile(resolve(lockRoot, "owner.json"), "utf8")), LOCK_KIND, LOCK_VERSION, "AMBIGUOUS_LOCK_OWNER"); }
    catch { fail("AMBIGUOUS_LOCK_OWNER", "Existing promotion lock cannot be trusted."); }
    if (owner.operationId !== ctx.auth.operationId || owner.authorizationId !== ctx.auth.authorizationId) fail("CONCURRENT_PROMOTION", "Another promotion operation owns the global lock.");
    const currentStart = processStartIdentity(owner.pid);
    if (currentStart) {
      if (currentStart === owner.processStartIdentity) fail("CONCURRENT_PROMOTION", "The authorized operation is already running.");
      fail("AMBIGUOUS_LOCK_OWNER", "PID reuse or process identity ambiguity detected.");
    }
    if (action !== "recover" && action !== "rollback") fail("RECOVERY_REQUIRED", "A stale lock exists; explicit recovery is required.");
    if (Date.now() - Date.parse(owner.createdAt) > ctx.auth.lock.maxStaleAgeMs) fail("STALE_LOCK_EXPIRED", "Stale lock exceeds the authorized recovery bound.");
    await rm(lockRoot, { recursive: true, force: false });
    await mkdir(lockRoot);
  }
  const start = processStartIdentity(process.pid);
  if (!start) fail("PROCESS_IDENTITY_UNAVAILABLE", "Process start identity cannot be established.");
  const host = await hostIdentity();
  const body = {
    kind: LOCK_KIND,
    version: LOCK_VERSION,
    operationId: ctx.auth.operationId,
    authorizationId: ctx.auth.authorizationId,
    pid: process.pid,
    processStartIdentity: start,
    hostMachineIdSha256: host.machineIdSha256,
    nonce: randomUUID(),
    createdAt: nowIso(),
  };
  await durableJson(resolve(lockRoot, "owner.json"), checksummed(body), { exclusive: true });
  ctx.lockOwner = body;
}

async function releaseLock(ctx) {
  if (!ctx.lockOwner) return;
  const owner = validateChecksummed(JSON.parse(await readFile(resolve(ctx.paths.lock, "owner.json"), "utf8")), LOCK_KIND, LOCK_VERSION, "AMBIGUOUS_LOCK_OWNER");
  if (owner.operationId !== ctx.lockOwner.operationId || owner.nonce !== ctx.lockOwner.nonce || owner.processStartIdentity !== ctx.lockOwner.processStartIdentity) {
    fail("LOCK_OWNERSHIP_LOST", "Global lock ownership changed during the operation.");
  }
  await rm(ctx.paths.lock, { recursive: true, force: false });
  ctx.lockOwner = null;
}

function maybeInject(ctx, point) {
  const selected = ctx.environment.MEGADESK_PROMOTION_INJECT_FAILURE ?? "none";
  if (!INJECTION_POINTS.has(selected)) fail("INVALID_INJECTION", "Unknown failure injection point.");
  if (selected !== point) return;
  if (point === "process_crash" && ctx.environment.MEGADESK_PROMOTION_INJECT_HARD_CRASH === "YES") process.exit(97);
  fail("INJECTED_FAILURE", `Injected failure at ${point}.`);
}

async function verifyCandidate(ctx) {
  if (!ctx.candidate) await prepareCandidate(ctx);
  await assertCandidateStillBound(ctx);
  await verifiedRestore(ctx, ctx.candidate.database.bytes, ctx.auth.verification.candidateDatabase, APPROVED_DATABASE_FINGERPRINT);
  return ctx.candidate.storage;
}

async function createAndVerifyBackups(ctx) {
  await revalidateDestructiveBoundary(ctx, "DB_BACKUP", { database: ctx.auth.preState.database, storage: ctx.auth.preState.storage });
  maybeInject(ctx, "before_backup");
  await writeJournal(ctx, "BACKUP_STARTED");
  if (ctx.environment.MEGADESK_PROMOTION_INJECT_FAILURE === "during_db_backup") {
    await dumpDatabaseToFile(ctx, ctx.auth.backup.database.path, { partial: true });
  }
  const dbBackup = await dumpDatabaseToFile(ctx, ctx.auth.backup.database.path);
  await writeJournal(ctx, "DB_BACKUP_CREATED", { databaseBackup: dbBackup });
  await revalidateDestructiveBoundary(ctx, "STORAGE_BACKUP", { database: ctx.auth.preState.database, storage: ctx.auth.preState.storage });
  maybeInject(ctx, "after_db_backup_before_storage_backup");
  if (ctx.environment.MEGADESK_PROMOTION_INJECT_FAILURE === "during_storage_backup") {
    await copyStorage(ctx.auth.target.storage.root, ctx.auth.backup.storage.root, { partial: true });
    fail("INJECTED_FAILURE", "Injected failure during storage backup.");
  }
  await copyStorage(ctx.auth.target.storage.root, ctx.auth.backup.storage.root);
  const storageBackup = await storageSnapshot(ctx.auth.backup.storage.root);
  let restoredStorage;
  try {
    await copyStorage(ctx.auth.backup.storage.root, ctx.auth.verification.storageRoot);
    restoredStorage = await storageSnapshot(ctx.auth.verification.storageRoot);
  } finally {
    await rm(ctx.auth.verification.storageRoot, { recursive: true, force: true });
  }
  if (restoredStorage.fingerprint !== ctx.auth.preState.storage.fingerprint) fail("STORAGE_BACKUP_VERIFY_FAILED", "Storage backup restore verification failed.");
  const restoredDb = await verifiedRestore(ctx, dbBackup, ctx.auth.verification.backupDatabase, ctx.auth.preState.database.fingerprint);
  ctx.backup = { database: dbBackup, storage: storageBackup, restoredDb, restoredStorage: restoredStorage.fingerprint };
  await writeJournal(ctx, "BACKUP_VERIFIED", ctx.backup);
}

async function promoteDatabase(ctx) {
  await writeJournal(ctx, "DB_PROMOTION_STARTED", { candidateDumpSha256: ctx.auth.candidate.database.dump.sha256 });
  ctx.mutationStarted = true;
  await restoreDatabase(ctx, ctx.auth.target.mysql.database, ctx.candidate.database.bytes, {
    partial: ctx.environment.MEGADESK_PROMOTION_INJECT_FAILURE === "during_db_promotion",
  });
  const expected = { ...ctx.auth.preState.database, ...ctx.auth.candidate.database.identity, fingerprint: APPROVED_DATABASE_FINGERPRINT };
  const applied = await assertDatabase(ctx.auth.target.mysql.url, ctx.password, expected, "promoted target");
  await writeJournal(ctx, "DB_PROMOTED", { fingerprint: applied.fingerprint });
}

async function promoteStorage(ctx) {
  const suffix = ctx.auth.operationId.replaceAll("-", "");
  const next = `.megadesk-next-${suffix}`;
  const previous = `.megadesk-pre-${suffix}`;
  return withBoundStorageTarget(ctx, async target => {
    await target.assertPathStillMapsToBoundObject();
    await testHook(ctx, "before_storage_materialization");
    await target.assertPathStillMapsToBoundObject();
    const staged = await materializeCapturedStorageBound(ctx.candidate.storage, next, {
      duringMaterialization: async () => {
        await testHook(ctx, "during_storage_materialization");
        await target.assertPathStillMapsToBoundObject();
      },
    });
    if (staged.fingerprint !== APPROVED_STORAGE_MANIFEST) fail("CANDIDATE_STORAGE_MISMATCH", "Prepared storage differs from approved candidate.");
    await testHook(ctx, "after_storage_materialization");
    await target.assertPathStillMapsToBoundObject();
    await writeJournal(ctx, "STORAGE_SWAP_PREPARED", { next, previous, candidate: staged.fingerprint, target: target.identity });
    await testHook(ctx, "after_storage_journal");
    await target.assertPathStillMapsToBoundObject();
    // The hook is a deterministic adversarial barrier. Revalidate immediately after
    // it: a rename followed by a symlink substitution must abort before touching the
    // directory object that was displaced from the authorized pathname.
    await testHook(ctx, "before_storage_destructive_swap");
    await target.assertPathStillMapsToBoundObject();
    // This is deliberately after the final pathname identity check.  The trusted
    // Linux parent/UID boundary, not another check, prevents an untrusted actor
    // from replacing the target while this deterministic test barrier is open.
    await testHook(ctx, "after_final_identity_validation_before_destructive_mutation");
    await replaceBoundStorageContents(next, previous);
    const archivedPrevious = resolve(dirname(ctx.auth.backup.storage.root), `.megadesk-promoted-original-${suffix}`);
    if (await exists(archivedPrevious)) fail("STORAGE_SWAP_RESIDUE", "Promotion archive destination already exists.");
    await rename(previous, archivedPrevious);
    if (ctx.environment.MEGADESK_PROMOTION_INJECT_FAILURE === "during_storage_promotion") fail("INJECTED_FAILURE", "Injected failure during bound storage swap.");
    await testHook(ctx, "after_storage_destructive_swap");
    try { await target.assertPathStillMapsToBoundObject(); }
    catch { fail("HUMAN_RECOVERY_REQUIRED", "Storage target pathname changed after a bound promotion operation."); }
    const applied = await target.snapshot();
    if (applied.fingerprint !== APPROVED_STORAGE_MANIFEST) fail("STORAGE_PROMOTION_VERIFY_FAILED", "Promoted storage differs from approved candidate.");
    await writeJournal(ctx, "STORAGE_PROMOTED", { fingerprint: applied.fingerprint, previous, target: target.identity });
  });
}

function journalEvidence(ctx, phase) {
  return [...(ctx.journal?.history ?? [])].reverse().find(entry => entry.phase === phase)?.evidence ?? null;
}

function journalRecordsMutation(journal) {
  return journal.history.some(entry => MUTATION_STARTED_PHASES.has(entry.phase));
}

function rollbackExpectedTarget(ctx) {
  const history = ctx.journal?.history ?? [];
  const databasePromoted = history.some(entry => ["DB_PROMOTED", "STORAGE_SWAP_PREPARED", "STORAGE_PROMOTED", "POST_VERIFY", "COMMITTED"].includes(entry.phase));
  const storagePromoted = history.some(entry => ["STORAGE_PROMOTED", "POST_VERIFY", "COMMITTED"].includes(entry.phase));
  return {
    database: databasePromoted
      ? { ...ctx.auth.preState.database, ...ctx.auth.candidate.database.identity, fingerprint: APPROVED_DATABASE_FINGERPRINT }
      : null,
    storage: storagePromoted
      ? { fingerprint: APPROVED_STORAGE_MANIFEST, files: ctx.auth.candidate.storage.files, bytes: ctx.auth.candidate.storage.bytes }
      : ctx.auth.preState.storage,
  };
}

async function restoreBoundStorage(ctx, snapshot, expectedFingerprint) {
  const suffix = ctx.auth.operationId.replaceAll("-", "");
  const next = `.megadesk-rollback-${suffix}`;
  const previous = `.megadesk-failed-${suffix}`;
  try {
    return await withBoundStorageTarget(ctx, async target => {
      await target.assertPathStillMapsToBoundObject();
      await testHook(ctx, "before_rollback_storage_materialization");
      await target.assertPathStillMapsToBoundObject();
      const staged = await materializeCapturedStorageBound(snapshot, next, {
        duringMaterialization: async () => {
          await testHook(ctx, "during_rollback_storage_materialization");
          await target.assertPathStillMapsToBoundObject();
        },
      });
      if (staged.fingerprint !== expectedFingerprint) fail("ROLLBACK_STORAGE_MISMATCH", "Rollback stage differs from the verified pre-state.");
      await writeJournal(ctx, "ROLLBACK_STORAGE_SWAP_PREPARED", { next, previous, target: target.identity, fingerprint: staged.fingerprint });
      await testHook(ctx, "after_rollback_storage_journal");
      await target.assertPathStillMapsToBoundObject();
      await testHook(ctx, "before_rollback_storage_destructive_swap");
      await target.assertPathStillMapsToBoundObject();
      await testHook(ctx, "after_final_rollback_identity_validation_before_destructive_mutation");
      await replaceBoundStorageContents(next, previous);
      const archivedPrevious = resolve(dirname(ctx.auth.backup.storage.root), `.megadesk-rollback-failed-${suffix}`);
      if (await exists(archivedPrevious)) fail("STORAGE_SWAP_RESIDUE", "Rollback archive destination already exists.");
      await rename(previous, archivedPrevious);
      await testHook(ctx, "after_rollback_storage_destructive_swap");
      try { await target.assertPathStillMapsToBoundObject(); }
      catch { fail("HUMAN_RECOVERY_REQUIRED", "Storage target pathname changed after a bound rollback operation."); }
      const restored = await target.snapshot();
      if (restored.fingerprint !== expectedFingerprint) fail("ROLLBACK_STORAGE_MISMATCH", "Bound rollback storage differs from exact pre-state.");
      return restored;
    });
  } catch (error) {
    if (["STORAGE_TARGET_IDENTITY_MISMATCH", "UNSAFE_PATH"].includes(error?.code)) {
      fail("HUMAN_RECOVERY_REQUIRED", `Rollback storage target identity is ambiguous: ${error.code}.`);
    }
    throw error;
  }
}

async function rollbackBoth(ctx) {
  await writeJournal(ctx, "ROLLBACK_STARTED", { from: ctx.journal?.phase ?? null });
  const verified = ctx.backup ?? journalEvidence(ctx, "BACKUP_VERIFIED");
  if (!verified?.database || !verified?.storage) fail("ROLLBACK_EVIDENCE_MISSING", "Verified backup evidence is absent from the durable journal.");
  ctx.backup = verified;
  const backupPath = verified.database.path;
  if (resolve(backupPath) !== resolve(ctx.auth.backup.database.path)) fail("ROLLBACK_BACKUP_SUBSTITUTION", "Database rollback path differs from authorization.");
  if (!await exists(backupPath)) fail("ROLLBACK_BACKUP_MISSING", "Database rollback backup is missing.");
  const backupInfo = await stat(backupPath);
  if (backupInfo.size !== verified.database.bytes || await fileSha256(backupPath) !== verified.database.sha256) {
    fail("ROLLBACK_BACKUP_MISMATCH", "Database rollback backup differs from the verified journal identity.");
  }
  const backupStorage = await storageSnapshot(ctx.auth.backup.storage.root);
  if (backupStorage.fingerprint !== verified.storage.fingerprint || backupStorage.files !== verified.storage.files
      || backupStorage.bytes !== verified.storage.bytes || backupStorage.fingerprint !== ctx.auth.preState.storage.fingerprint) {
    fail("ROLLBACK_BACKUP_MISMATCH", "Storage rollback backup differs from the verified journal identity.");
  }
  const capturedBackupStorage = await captureCandidateStorage(ctx.auth.backup.storage.root);
  if (capturedBackupStorage.fingerprint !== verified.storage.fingerprint || capturedBackupStorage.fingerprint !== ctx.auth.preState.storage.fingerprint) {
    fail("ROLLBACK_BACKUP_MISMATCH", "Captured rollback storage differs from the verified pre-state.");
  }
  const expectedBeforeRollback = rollbackExpectedTarget(ctx);
  await assertRollbackDestructiveBoundary(ctx, "ROLLBACK_DB", expectedBeforeRollback);
  ctx.mutationStarted = true;
  await restoreDatabase(ctx, ctx.auth.target.mysql.database, backupPath);
  await assertRollbackDestructiveBoundary(ctx, "ROLLBACK_STORAGE", { database: ctx.auth.preState.database, storage: expectedBeforeRollback.storage });
  const restoredStorage = await restoreBoundStorage(ctx, capturedBackupStorage, ctx.auth.preState.storage.fingerprint);
  const expectedDb = ctx.auth.preState.database;
  const restoredDb = await assertDatabase(ctx.auth.target.mysql.url, ctx.password, expectedDb, "rolled-back target");
  await writeJournal(ctx, "ROLLED_BACK", { database: restoredDb.fingerprint, storage: restoredStorage.fingerprint });
  return { result: "PASS", phase: "ROLLED_BACK", database: restoredDb.fingerprint, storage: restoredStorage.fingerprint };
}

async function loadContext(action, environment = process.env) {
  const { authorization, raw } = await loadAuthorization(environment);
  const auth = authorization.payload;
  if (!auth.allowedActions.includes(action)) fail("ACTION_NOT_AUTHORIZED", "Requested action is not in the signed authorization.");
  assertTargetPolicy(auth, environment);
  const injection = environment.MEGADESK_PROMOTION_INJECT_FAILURE ?? "none";
  if (!INJECTION_POINTS.has(injection)) fail("INVALID_INJECTION", "Unknown failure injection point.");
  if (auth.target.class === "oracle-main" && (injection !== "none"
      || environment.MEGADESK_PROMOTION_INJECT_HARD_CRASH === "YES"
      || Number(environment.MEGADESK_PROMOTION_TEST_HOLD_AFTER_LOCK_MS ?? 0) !== 0
      || environment.MEGADESK_PROMOTION_TEST_HOOK
      || environment.MEGADESK_PROMOTION_TEST_HOOK_ROOT)) {
    fail("TEST_CONTROL_FORBIDDEN", "Failure injection and test timing controls are forbidden for Oracle MAIN.");
  }
  assertDestructivePlatform(action);
  if (!environment.MEGADESK_PROMOTION_DATABASE_PASSWORD) fail("DATABASE_PASSWORD_REQUIRED", "Database password must be supplied only in process memory.");
  const allowedRoot = resolve(auth.paths.allowedRoot);
  const expectedLock = auth.target.class === "oracle-main"
    ? resolve(PRODUCTION_LOCK_PATH)
    : isIsolatedRunnerRehearsal(auth)
      ? resolve(allowedRoot, "operations", "global-promotion.lock")
      : resolve(allowedRoot, "global-promotion.lock");
  if (resolve(auth.paths.lock) !== expectedLock) {
    fail("INVALID_LOCK_PATH", "Promotion lock must use the canonical global path under the authorized root.");
  }
  for (const path of [auth.paths.stateRoot, auth.paths.journal, auth.paths.usedAuthorizations,
    auth.backup.database.path, auth.backup.storage.root, auth.verification.storageRoot,
    auth.candidate.database.dump.path, auth.candidate.storage.root]) {
    if (!isInside(allowedRoot, path)) fail("PATH_OUTSIDE_AUTHORIZED_ROOT", "An operational path escaped the signed allowed root.");
  }
  const roots = [auth.target.storage.root, auth.candidate.storage.root, auth.backup.storage.root, auth.verification.storageRoot];
  for (let i = 0; i < roots.length; i += 1) for (let j = i + 1; j < roots.length; j += 1) {
    if (pathsOverlap(roots[i], roots[j])) fail("STORAGE_ROLE_COLLISION", "Storage roles overlap.");
  }
  await assertNoSymlinkPath(allowedRoot);
  for (const path of [auth.paths.stateRoot, auth.paths.journal, auth.paths.usedAuthorizations,
    auth.backup.database.path, auth.backup.storage.root, auth.verification.storageRoot,
    auth.candidate.database.dump.path, auth.candidate.storage.root, auth.paths.lock]) {
    await assertNoSymlinkPath(path, { allowMissingLeaf: true });
  }
  const ctx = {
    action,
    auth,
    environment,
    password: environment.MEGADESK_PROMOTION_DATABASE_PASSWORD,
    paths: {
      allowedRoot,
      stateRoot: resolve(auth.paths.stateRoot),
      lock: resolve(auth.paths.lock),
      journal: resolve(auth.paths.journal),
      usedAuthorizations: resolve(auth.paths.usedAuthorizations),
    },
    journal: null,
    lockOwner: null,
    backup: null,
    candidate: null,
    authorizationSha256: sha256(raw),
    mutationStarted: false,
  };
  await mkdir(ctx.paths.stateRoot, { recursive: true });
  if (await exists(ctx.paths.journal)) {
    ctx.journal = await loadJournal(ctx.paths.journal);
    ctx.mutationStarted = !TERMINAL_PHASES.has(ctx.journal.phase) && journalRecordsMutation(ctx.journal);
  }
  return ctx;
}

export async function run(action, environment = process.env) {
  const ctx = await loadContext(action, environment);
  await acquireLock(ctx, action);
  let release = false;
  try {
    const holdMs = Number(ctx.environment.MEGADESK_PROMOTION_TEST_HOLD_AFTER_LOCK_MS ?? 0);
    if (holdMs > 0) {
      if ((!isIsolatedRunnerRehearsal(ctx.auth) && ctx.auth.target.class !== "oracle-main-shaped-disposable") || holdMs > 30_000) {
        fail("UNSAFE_TEST_HOLD", "Test lock hold is allowed only for bounded disposable rehearsals.");
      }
      await new Promise(resolvePromise => setTimeout(resolvePromise, holdMs));
    }
    if (action === "promote") {
      if (ctx.journal) fail("AUTHORIZATION_REPLAY", "Promotion journal already exists for this single-use authorization.");
      await assertAuthorizationUnclaimed(ctx);
    }
    if (action === "promote" || action === "verify") {
      await assertIdentityEnvelope(ctx, { requirePreState: true });
    }
    if (action === "verify") {
      await prepareCandidate(ctx);
      await verifyCandidate(ctx);
      release = true;
      return { result: "PASS", phase: "VERIFIED" };
    }
    if (action === "promote") {
      if (!await claimAuthorization(ctx)) fail("AUTHORIZATION_REPLAY", "Single-use authorization was already claimed.");
      await writeJournal(ctx, "PRECHECK", { approvedDatabase: APPROVED_DATABASE_FINGERPRINT, approvedStorage: APPROVED_STORAGE_MANIFEST });
      await prepareCandidate(ctx);
      await writeJournal(ctx, "CANDIDATE_CAPTURED", { candidate: candidateEvidence(ctx) });
      await testHook(ctx, "after_candidate_capture");
      await createAndVerifyBackups(ctx);
      await verifyCandidate(ctx);
      await writeJournal(ctx, "CANDIDATE_VERIFIED", { database: APPROVED_DATABASE_FINGERPRINT, storage: APPROVED_STORAGE_MANIFEST });
      maybeInject(ctx, "after_backup_before_promotion");
      await runDestructivePromotion(ctx, { database: ctx.auth.preState.database, storage: ctx.auth.preState.storage }, {
        write: async current => {
          await writeJournal(current, "PROMOTION_STARTED");
          return promoteDatabase(current);
        },
      });
      if (ctx.environment.MEGADESK_PROMOTION_INJECT_FAILURE === "process_crash") maybeInject(ctx, "process_crash");
      maybeInject(ctx, "after_db_before_storage");
      const promotedDatabase = { ...ctx.auth.preState.database, ...ctx.auth.candidate.database.identity, fingerprint: APPROVED_DATABASE_FINGERPRINT };
      await revalidateDestructiveBoundary(ctx, "STORAGE_PROMOTION", { database: promotedDatabase, storage: ctx.auth.preState.storage });
      await promoteStorage(ctx);
      maybeInject(ctx, "after_storage_before_post_verify");
      const postPromotionStorage = { fingerprint: APPROVED_STORAGE_MANIFEST, files: ctx.candidate.storage.files, bytes: ctx.candidate.storage.bytes };
      const postVerified = await revalidateDestructiveBoundary(ctx, "POSTVERIFY", { database: promotedDatabase, storage: postPromotionStorage });
      const verifiedDb = postVerified.database;
      const verifiedStorage = postVerified.storage;
      await writeJournal(ctx, "POST_VERIFY", { database: verifiedDb.fingerprint, storage: verifiedStorage.fingerprint });
      maybeInject(ctx, "after_verify_before_committed");
      await revalidateDestructiveBoundary(ctx, "COMMIT", { database: promotedDatabase, storage: postPromotionStorage });
      await writeJournal(ctx, "COMMITTED", { database: verifiedDb.fingerprint, storage: verifiedStorage.fingerprint });
      release = true;
      return { result: "PASS", phase: "COMMITTED", database: verifiedDb.fingerprint, storage: verifiedStorage.fingerprint };
    }
    if (!ctx.journal) fail("RECOVERY_JOURNAL_REQUIRED", "Recovery or rollback requires a durable journal.");
    if (ctx.journal.operationId !== ctx.auth.operationId || ctx.journal.authorizationId !== ctx.auth.authorizationId) {
      fail("JOURNAL_CONTEXT_MISMATCH", "Journal belongs to a different operation or authorization.");
    }
    if (action === "recover") {
      if (TERMINAL_PHASES.has(ctx.journal.phase)) {
        release = true;
        return { result: "PASS", phase: ctx.journal.phase, noOp: true };
      }
      if (!ctx.mutationStarted && PRE_MUTATION_PHASES.has(ctx.journal.phase)) {
        await writeJournal(ctx, "ABORTED", { reason: "pre-mutation recovery" });
        release = true;
        return { result: "PASS", phase: "ABORTED", mutation: "NONE" };
      }
      const result = await rollbackBoth(ctx);
      release = true;
      return result;
    }
    if (action === "rollback") {
      const result = await rollbackBoth(ctx);
      release = true;
      return result;
    }
    fail("INVALID_ACTION", "Use verify, promote, recover, or rollback.");
  } catch (error) {
    if (!ctx.mutationStarted && ctx.journal && !TERMINAL_PHASES.has(ctx.journal.phase)) {
      await writeJournal(ctx, "ABORTED", { reason: error.code ?? "UNEXPECTED", mutation: "NONE" });
      release = true;
    } else if (!ctx.journal || TERMINAL_PHASES.has(ctx.journal.phase)) release = true;
    throw error;
  } finally {
    if (release) await releaseLock(ctx);
  }
}

async function main() {
  const action = process.argv[2];
  const result = await run(action);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export const constants = Object.freeze({
  APPROVED_DATABASE_FINGERPRINT,
  APPROVED_STORAGE_MANIFEST,
  EXPECTED_FREEZE_BOUNDARY,
  AUTH_KIND,
  AUTH_VERSION,
  FREEZE_EVIDENCE_KIND,
  FREEZE_EVIDENCE_VERSION,
  MAX_FREEZE_EVIDENCE_TTL_MS,
  PROMOTION_TRUST_ROOT_PATH,
  FREEZE_TRUST_ROOT_PATH,
  PROMOTION_TRUST_ROOT_SHA256,
  FREEZE_TRUST_ROOT_SHA256,
  REHEARSAL_ROOT_SUFFIX,
  PRODUCTION_HOSTNAME,
  PRODUCTION_DATABASE,
  PRODUCTION_MYSQL_CONTAINER,
  PRODUCTION_APP_CONTAINER,
  PRODUCTION_STORAGE_ROOT,
  PRODUCTION_OPERATIONS_ROOT,
  PRODUCTION_LOCK_PATH,
});

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ error: error.name, code: error.code ?? "UNEXPECTED", message: error.message })}\n`);
    process.exitCode = 1;
  });
}
