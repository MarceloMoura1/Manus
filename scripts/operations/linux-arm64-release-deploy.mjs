import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rmdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectPayloadEntries,
  extractAndVerifyRuntimeArchive,
  verifyManifest,
} from "./package-runtime-release.mjs";

export const LINUX_DEPLOY_SCHEMA_VERSION = 1;
export const BACKUP_RECEIPT_SCHEMA_VERSION = 1;
export const STAGED_RELEASE_SCHEMA_VERSION = 2;

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const DEPLOYMENT_LEASE_DIRECTORY = ".megadesk-linux-deploy.lock";
const DEPLOYMENT_LEASE_TOKEN = "lease-token";
const STAGED_MANIFEST_FILENAME = "stage-manifest.json";

function fail(message) {
  throw new Error(`LINUX_DEPLOY: ${message}`);
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isSafeRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !path.posix.isAbsolute(value)
    && !value.split("/").some((part) => part === "" || part === "." || part === "..");
}

function isSafeInternalLinkTarget(linkPath, target) {
  if (typeof target !== "string" || target.length === 0 || path.posix.isAbsolute(target) || target.includes("\\")) return false;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(linkPath), target));
  return resolved !== ".." && !resolved.startsWith("../") && !resolved.startsWith("/");
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  const actual = Object.keys(value).sort(compareCodePoints);
  const expected = [...keys].sort(compareCodePoints);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} has an unsupported schema.`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be a lowercase SHA-256.`);
}

function assertGitSha(value, label) {
  if (typeof value !== "string" || !GIT_SHA.test(value)) fail(`${label} must be a full lowercase Git SHA.`);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} is required.`);
}

async function assertRealDirectory(directory, label) {
  let info;
  try {
    info = await lstat(directory);
  } catch {
    fail(`${label} does not exist: ${directory}`);
  }
  if (!info.isDirectory() || info.isSymbolicLink()) fail(`${label} must be a real directory: ${directory}`);
  return path.resolve(directory);
}

async function assertRegularFile(file, label) {
  let info;
  try {
    info = await lstat(file);
  } catch {
    fail(`${label} does not exist: ${file}`);
  }
  if (!info.isFile() || info.isSymbolicLink()) fail(`${label} must be a real regular file: ${file}`);
  return info;
}

function effectiveDeploymentUid() {
  if (process.platform !== "linux" || typeof process.getuid !== "function") {
    fail("Exclusive staging and activation require a Linux POSIX filesystem.");
  }
  const uid = process.getuid();
  if (!Number.isSafeInteger(uid) || uid === 0) {
    fail("Exclusive staging and activation require a dedicated non-root deployment account.");
  }
  return uid;
}

function assertExclusiveOwnership(info, label, uid, { directory = false, regularFile = false } = {}) {
  if (directory && (!info.isDirectory() || info.isSymbolicLink())) fail(`${label} must be a real directory.`);
  if (regularFile && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)) fail(`${label} must be a non-linked regular file.`);
  if (info.uid !== uid) fail(`${label} is not owned by the dedicated deployment account.`);
  if (!info.isSymbolicLink() && (info.mode & 0o022) !== 0) fail(`${label} is writable by group or other users.`);
}

async function assertExclusivePath(target, label, uid, options = {}) {
  let info;
  try {
    info = await lstat(target);
  } catch {
    fail(`${label} does not exist: ${target}`);
  }
  assertExclusiveOwnership(info, label, uid, options);
  return info;
}

async function assertAbsent(target, label) {
  try {
    await lstat(target);
    fail(`${label} already exists: ${target}`);
  } catch (error) {
    if (error?.message?.startsWith("LINUX_DEPLOY:")) throw error;
    if (error?.code !== "ENOENT") throw error;
  }
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(file);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} failed with exit code ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

/**
 * Parses UTF-8 JSON while rejecting BOMs, invalid UTF-8, trailing input and
 * duplicate object keys. The artifact manifest is hash-pinned, but rejecting
 * ambiguous syntax prevents a verifier from accepting a different semantic
 * document than a future producer or auditor.
 */
export function parseStrictJsonBytes(bytes, label = "JSON") {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    fail(`${label} is not valid UTF-8.`);
  }
  if (source.charCodeAt(0) === 0xfeff) fail(`${label} must not start with a UTF-8 BOM.`);

  let index = 0;
  const skipWhitespace = () => {
    while (index < source.length && /[\u0009\u000a\u000d\u0020]/.test(source[index])) index += 1;
  };
  const parseString = () => {
    if (source[index] !== '"') fail(`${label} contains an invalid JSON string.`);
    const start = index;
    index += 1;
    let escaped = false;
    while (index < source.length) {
      const character = source[index];
      if (!escaped && character === '"') {
        index += 1;
        try { return JSON.parse(source.slice(start, index)); } catch { fail(`${label} contains an invalid JSON string.`); }
      }
      if (!escaped && character.charCodeAt(0) < 0x20) fail(`${label} contains a control character in a string.`);
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
      index += 1;
    }
    fail(`${label} is truncated inside a JSON string.`);
  };
  const parsePrimitive = () => {
    const start = index;
    while (index < source.length && !/[\u0009\u000a\u000d\u0020,\]}]/.test(source[index])) index += 1;
    if (start === index) fail(`${label} contains an invalid JSON token.`);
    try { return JSON.parse(source.slice(start, index)); } catch { fail(`${label} contains an invalid JSON token.`); }
  };
  const parseValue = (depth) => {
    if (depth > 64) fail(`${label} exceeds the maximum JSON depth.`);
    skipWhitespace();
    if (source[index] === '"') return parseString();
    if (source[index] === "{") {
      index += 1;
      skipWhitespace();
      const output = {};
      const keys = new Set();
      if (source[index] === "}") { index += 1; return output; }
      while (true) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) fail(`${label} contains a duplicate key: ${key}.`);
        keys.add(key);
        skipWhitespace();
        if (source[index] !== ":") fail(`${label} contains an invalid object.`);
        index += 1;
        output[key] = parseValue(depth + 1);
        skipWhitespace();
        if (source[index] === "}") { index += 1; return output; }
        if (source[index] !== ",") fail(`${label} contains an invalid object.`);
        index += 1;
      }
    }
    if (source[index] === "[") {
      index += 1;
      skipWhitespace();
      const output = [];
      if (source[index] === "]") { index += 1; return output; }
      while (true) {
        output.push(parseValue(depth + 1));
        skipWhitespace();
        if (source[index] === "]") { index += 1; return output; }
        if (source[index] !== ",") fail(`${label} contains an invalid array.`);
        index += 1;
      }
    }
    return parsePrimitive();
  };

  const value = parseValue(0);
  skipWhitespace();
  if (index !== source.length) fail(`${label} has trailing data.`);
  return value;
}

function validateManifestEntry(entry, seen) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("Manifest contains an invalid file entry.");
  if (!isSafeRelativePath(entry.path)) fail("Manifest contains an unsafe entry path.");
  if (seen.has(entry.path)) fail(`Manifest contains a duplicate entry: ${entry.path}`);
  seen.add(entry.path);
  if (entry.type === "file") {
    requireExactKeys(entry, ["path", "sha256", "size", "type"], `Manifest file entry ${entry.path}`);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) fail(`Manifest file size is invalid: ${entry.path}`);
    assertSha256(entry.sha256, `Manifest file digest ${entry.path}`);
    return;
  }
  if (entry.type === "symlink") {
    requireExactKeys(entry, ["path", "sha256", "target", "type"], `Manifest symbolic link ${entry.path}`);
    if (!isSafeInternalLinkTarget(entry.path, entry.target)) fail(`Manifest symbolic link target is unsafe: ${entry.path}`);
    assertSha256(entry.sha256, `Manifest symbolic link digest ${entry.path}`);
    if (entry.sha256 !== sha256Bytes(`symlink\0${entry.target}`)) fail(`Manifest symbolic link digest is inconsistent: ${entry.path}`);
    return;
  }
  fail(`Manifest entry type is unsupported: ${entry.path}`);
}

export function validatePinnedManifest(manifest, expected, tarballInfo) {
  requireExactKeys(manifest, ["files", "package", "payloadRoot", "release", "schemaVersion"], "Manifest");
  if (manifest.schemaVersion !== 2 || manifest.payloadRoot !== "runtime") fail("Manifest schema or payload root is unsupported.");
  requireExactKeys(manifest.release, ["commit", "node", "platform", "pnpm", "tree"], "Manifest release");
  requireExactKeys(manifest.package, ["name", "sha256", "size"], "Manifest package");
  assertGitSha(manifest.release.commit, "Manifest release commit");
  assertGitSha(manifest.release.tree, "Manifest release tree");
  if (manifest.release.commit !== expected.commit || manifest.release.tree !== expected.tree || manifest.release.platform !== "linux/arm64") {
    fail("Manifest release identity differs from the approved candidate.");
  }
  assertNonEmptyString(manifest.release.node, "Manifest Node.js version");
  assertNonEmptyString(manifest.release.pnpm, "Manifest pnpm version");
  if (manifest.package.name !== expected.artifactName || manifest.package.name !== path.basename(tarballInfo.path)) {
    fail("Manifest package name differs from the expected artifact.");
  }
  if (manifest.package.size !== tarballInfo.size || manifest.package.sha256 !== expected.tarSha256) {
    fail("Manifest package metadata differs from the verified TAR.");
  }
  assertSha256(manifest.package.sha256, "Manifest package digest");
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail("Manifest file list is empty.");
  const seen = new Set();
  for (const entry of manifest.files) validateManifestEntry(entry, seen);
  return manifest;
}

export async function assertGnuTar({ commandRunner = run } = {}) {
  let result;
  try {
    result = await commandRunner("tar", ["--version"]);
  } catch {
    fail("GNU tar is required and could not be executed.");
  }
  if (!result.stdout.includes("GNU tar")) fail("GNU tar is required; no fallback archiver is allowed.");
}

function expectedArchiveMembers(manifest) {
  const expected = new Set(manifest.files.map((entry) => `runtime/${entry.path}`));
  const directories = new Set(["runtime"]);
  for (const entry of manifest.files) {
    let directory = path.posix.dirname(entry.path);
    while (directory !== ".") {
      directories.add(`runtime/${directory}`);
      directory = path.posix.dirname(directory);
    }
  }
  return { expected, directories };
}

export function validateArchiveListing(listing, manifest) {
  const { expected, directories } = expectedArchiveMembers(manifest);
  const seen = new Set();
  for (const member of listing.split(/\r?\n/).filter(Boolean)) {
    const normalized = member.replace(/\\/g, "/").replace(/\/$/, "");
    if (!isSafeRelativePath(normalized) || (normalized !== "runtime" && !normalized.startsWith("runtime/"))) {
      fail(`Archive contains an unsafe member path: ${member}`);
    }
    if (seen.has(normalized)) fail(`Archive contains a duplicate member: ${member}`);
    seen.add(normalized);
    if (member.endsWith("/")) {
      if (!directories.has(normalized)) fail(`Archive contains an unexpected directory: ${member}`);
    } else if (!expected.delete(normalized)) {
      fail(`Archive contains an unexpected member: ${member}`);
    }
  }
  if (expected.size !== 0) fail(`Archive is missing manifest members: ${[...expected].sort(compareCodePoints).join(", ")}`);
}

export async function verifyArtifactBundle({ tarball, manifestPath, expected, commandRunner = run }) {
  requireExactKeys(expected, ["artifactName", "commit", "manifestSha256", "tarSha256", "tree"], "Expected artifact identity");
  assertGitSha(expected.commit, "Expected candidate commit");
  assertGitSha(expected.tree, "Expected candidate tree");
  assertSha256(expected.tarSha256, "Expected TAR digest");
  assertSha256(expected.manifestSha256, "Expected manifest digest");
  assertNonEmptyString(expected.artifactName, "Expected artifact name");
  if (path.basename(tarball) !== expected.artifactName) fail("TAR filename differs from the explicit expected artifact name.");
  const tarballInfo = await assertRegularFile(tarball, "TAR artifact");
  await assertRegularFile(manifestPath, "Artifact manifest");
  if (await sha256File(tarball) !== expected.tarSha256) fail("TAR SHA-256 differs from the approved value.");
  const manifestBytes = await readFile(manifestPath);
  if (sha256Bytes(manifestBytes) !== expected.manifestSha256) fail("Manifest SHA-256 differs from the approved value.");
  const manifest = validatePinnedManifest(parseStrictJsonBytes(manifestBytes, "Artifact manifest"), expected, { path: tarball, size: tarballInfo.size });
  await assertGnuTar({ commandRunner });
  const listing = await commandRunner("tar", ["-tzf", tarball]);
  validateArchiveListing(listing.stdout, manifest);
  return {
    manifest,
    manifestBytes,
    tarball: path.resolve(tarball),
    manifestPath: path.resolve(manifestPath),
    size: tarballInfo.size,
  };
}

async function assertManagedRoot(managedRoot) {
  const root = await assertRealDirectory(managedRoot, "Managed deployment root");
  const physical = await realpath(root);
  const rootInfo = await stat(root);
  for (const child of ["releases", "staging", "backups"]) {
    const candidate = path.join(root, child);
    await assertRealDirectory(candidate, `Managed ${child} directory`);
    if (!isPathInside(await realpath(candidate), physical)) fail(`Managed ${child} directory resolves outside the deployment root.`);
    if ((await stat(candidate)).dev !== rootInfo.dev) fail(`Managed ${child} directory must share the deployment root filesystem.`);
  }
  return { root, physical, releases: path.join(root, "releases"), staging: path.join(root, "staging"), backups: path.join(root, "backups") };
}

async function assertExclusiveDeploymentLayout(layout) {
  const uid = effectiveDeploymentUid();
  await assertExclusivePath(layout.root, "Managed deployment root", uid, { directory: true });
  for (const [label, directory] of [["Managed releases directory", layout.releases], ["Managed staging directory", layout.staging], ["Managed backups directory", layout.backups]]) {
    await assertExclusivePath(directory, label, uid, { directory: true });
  }
  return uid;
}

async function acquireDeploymentLease(layout) {
  const uid = await assertExclusiveDeploymentLayout(layout);
  const directory = path.join(layout.root, DEPLOYMENT_LEASE_DIRECTORY);
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail("Deployment lease is unavailable; another operation is active or a stale lease requires audited recovery.");
    }
    throw error;
  }

  const token = randomUUID();
  const tokenPath = path.join(directory, DEPLOYMENT_LEASE_TOKEN);
  try {
    await assertExclusivePath(directory, "Deployment lease", uid, { directory: true });
    await writeFile(tokenPath, token, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await assertExclusivePath(tokenPath, "Deployment lease token", uid, { regularFile: true });
  } catch (error) {
    try { await unlink(tokenPath); } catch { /* Preserve an ambiguous lease for audited recovery. */ }
    try { await rmdir(directory); } catch { /* Preserve an ambiguous lease for audited recovery. */ }
    throw error;
  }
  return { directory, token, tokenPath, uid };
}

async function assertDeploymentLease(lease) {
  await assertExclusivePath(lease.directory, "Deployment lease", lease.uid, { directory: true });
  await assertExclusivePath(lease.tokenPath, "Deployment lease token", lease.uid, { regularFile: true });
  if (await readFile(lease.tokenPath, "utf8") !== lease.token) {
    fail("Deployment lease was replaced or lost during the operation.");
  }
}

async function releaseDeploymentLease(lease) {
  await assertDeploymentLease(lease);
  await unlink(lease.tokenPath);
  try {
    await rmdir(lease.directory);
  } catch (error) {
    fail(`Deployment lease could not be released safely: ${error.code ?? "unknown error"}.`);
  }
}

async function withDeploymentLease(layout, operation) {
  const lease = await acquireDeploymentLease(layout);
  let operationError;
  try {
    return await operation(lease);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await releaseDeploymentLease(lease);
    } catch (releaseError) {
      if (!operationError) throw releaseError;
    }
  }
}

async function assertControlledRuntimeTree(runtime, uid) {
  const root = await assertExclusivePath(runtime, "Staged runtime", uid, { directory: true });
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      const info = await lstat(candidate);
      if (info.isDirectory()) {
        assertExclusiveOwnership(info, "Staged runtime directory", uid, { directory: true });
        await visit(candidate);
      } else if (info.isFile()) {
        assertExclusiveOwnership(info, "Staged runtime file", uid, { regularFile: true });
      } else if (info.isSymbolicLink()) {
        if (info.uid !== uid) fail("Staged runtime symbolic link is not owned by the dedicated deployment account.");
      } else {
        fail("Staged runtime contains an unsupported filesystem type.");
      }
    }
  };
  await visit(runtime);
  return root;
}

async function sealRuntimeTree(runtime, uid) {
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      const info = await lstat(candidate);
      if (info.isDirectory()) {
        assertExclusiveOwnership(info, "Staged runtime directory", uid, { directory: true });
        await visit(candidate);
        await chmod(candidate, info.mode & ~0o222);
      } else if (info.isFile()) {
        assertExclusiveOwnership(info, "Staged runtime file", uid, { regularFile: true });
        await chmod(candidate, info.mode & ~0o222);
      } else if (info.isSymbolicLink()) {
        if (info.uid !== uid) fail("Staged runtime symbolic link is not owned by the dedicated deployment account.");
      } else {
        fail("Staged runtime contains an unsupported filesystem type.");
      }
    }
  };
  await visit(runtime);
  const root = await lstat(runtime);
  await chmod(runtime, root.mode & ~0o222);
}

async function readActiveRelease(layout, activeLink) {
  const resolvedLink = path.resolve(activeLink);
  if (!isPathInside(resolvedLink, layout.root) || path.dirname(resolvedLink) !== layout.root) fail("Active release link must be directly inside the managed root.");
  let info;
  try { info = await lstat(resolvedLink); } catch { fail("Active release link is absent."); }
  if (!info.isSymbolicLink()) fail("Active release pointer must be a symbolic link.");
  const target = await readlink(resolvedLink);
  if (path.isAbsolute(target)) fail("Active release pointer must use a relative target.");
  const lexical = path.resolve(path.dirname(resolvedLink), target);
  if (!isPathInside(lexical, layout.releases)) fail("Active release pointer resolves outside managed releases.");
  const physical = await realpath(resolvedLink);
  if (!isPathInside(physical, await realpath(layout.releases))) fail("Active release pointer physically resolves outside managed releases.");
  await assertRealDirectory(physical, "Active release target");
  return { link: resolvedLink, target, path: physical, relative: path.relative(layout.root, physical).split(path.sep).join("/") };
}

function payloadFingerprint(entries) {
  const canonical = [...entries]
    .sort((left, right) => compareCodePoints(left.path, right.path))
    .map((entry) => entry.type === "file"
      ? { path: entry.path, type: entry.type, size: entry.size, sha256: entry.sha256 }
      : { path: entry.path, type: entry.type, target: entry.target, sha256: entry.sha256 });
  return { entries: canonical.length, sha256: sha256Bytes(JSON.stringify(canonical)) };
}

async function copySnapshotTree({ source, destination, label }) {
  const sourceRoot = await assertRealDirectory(source, `${label} source`);
  const sourceRootInfo = await lstat(sourceRoot);
  await assertAbsent(destination, `${label} backup destination`);
  const sourcePhysical = await realpath(sourceRoot);
  await mkdir(destination, { recursive: false, mode: 0o700 });
  await chmod(destination, sourceRootInfo.mode & 0o777);
  const visit = async (relative = "") => {
    const sourceDirectory = path.join(sourceRoot, relative);
    const names = (await readdir(sourceDirectory, { withFileTypes: true })).map((entry) => entry.name).sort(compareCodePoints);
    for (const name of names) {
      if (!isSafeRelativePath(name)) fail(`${label} contains an unsafe filename.`);
      const childRelative = relative ? path.posix.join(relative, name) : name;
      const from = path.join(sourceRoot, childRelative);
      const to = path.join(destination, childRelative);
      const info = await lstat(from);
      if (info.isDirectory()) {
        if (info.isSymbolicLink()) fail(`${label} contains a symbolic directory.`);
        await mkdir(to, { recursive: false, mode: 0o700 });
        await visit(childRelative);
        await chmod(to, info.mode & 0o777);
      } else if (info.isFile()) {
        if (info.isSymbolicLink()) fail(`${label} contains a symbolic file.`);
        const before = { size: info.size, mtimeMs: info.mtimeMs, mode: info.mode & 0o777 };
        await copyFile(from, to, 1);
        await chmod(to, before.mode);
        const after = await lstat(from);
        if (!after.isFile() || after.isSymbolicLink() || after.size !== before.size || after.mtimeMs !== before.mtimeMs || (after.mode & 0o777) !== before.mode) {
          fail(`${label} changed while its backup was being created.`);
        }
      } else if (info.isSymbolicLink()) {
        const target = await readlink(from);
        if (path.isAbsolute(target)) fail(`${label} contains an absolute symbolic link.`);
        const lexical = path.resolve(path.dirname(from), target);
        if (!isPathInside(lexical, sourceRoot)) fail(`${label} contains a symbolic link that escapes its root.`);
        const physical = await realpath(from);
        if (!isPathInside(physical, sourcePhysical)) fail(`${label} contains a symbolic link that physically escapes its root.`);
        await symlink(target, to);
      } else {
        fail(`${label} contains an unsupported filesystem type.`);
      }
    }
  };
  await visit();
  const entries = await collectPayloadEntries(destination);
  return payloadFingerprint(entries);
}

export function validateBackupReceiptShape(receipt) {
  requireExactKeys(receipt, ["activeRelease", "createdAt", "id", "schemaVersion", "snapshots"], "Backup receipt");
  if (receipt.schemaVersion !== BACKUP_RECEIPT_SCHEMA_VERSION) fail("Backup receipt schema is unsupported.");
  if (typeof receipt.id !== "string" || !/^[a-f0-9-]{36}$/.test(receipt.id)) fail("Backup receipt ID is invalid.");
  if (Number.isNaN(Date.parse(receipt.createdAt))) fail("Backup receipt timestamp is invalid.");
  requireExactKeys(receipt.activeRelease, ["entries", "path", "sha256"], "Backup receipt active release");
  if (!isSafeRelativePath(receipt.activeRelease.path) || !Number.isSafeInteger(receipt.activeRelease.entries) || receipt.activeRelease.entries < 1) fail("Backup receipt active release is invalid.");
  assertSha256(receipt.activeRelease.sha256, "Backup receipt active release digest");
  if (!Array.isArray(receipt.snapshots) || receipt.snapshots.length !== 2) fail("Backup receipt must contain configuration and state snapshots.");
  const roles = new Set();
  for (const snapshot of receipt.snapshots) {
    requireExactKeys(snapshot, ["entries", "path", "role", "sha256"], "Backup receipt snapshot");
    if (!["configuration", "state"].includes(snapshot.role) || roles.has(snapshot.role) || !isSafeRelativePath(snapshot.path)) fail("Backup receipt snapshot role or path is invalid.");
    roles.add(snapshot.role);
    if (!Number.isSafeInteger(snapshot.entries) || snapshot.entries < 0) fail("Backup receipt snapshot entry count is invalid.");
    assertSha256(snapshot.sha256, "Backup receipt snapshot digest");
  }
  return receipt;
}

export async function createVerifiedBackup({ managedRoot, activeLink, configurationRoot, stateRoot }) {
  const layout = await assertManagedRoot(managedRoot);
  return withDeploymentLease(layout, async () => {
    const active = await readActiveRelease(layout, activeLink);
    const activeFingerprint = payloadFingerprint(await collectPayloadEntries(active.path));
    await assertRealDirectory(configurationRoot, "Configuration root");
    await assertRealDirectory(stateRoot, "State root");
    const temporary = await mkdtemp(path.join(layout.backups, ".pending-"));
    const finalDirectory = path.join(layout.backups, `backup-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`);
    try {
      const configuration = await copySnapshotTree({ source: configurationRoot, destination: path.join(temporary, "configuration"), label: "Configuration" });
      const state = await copySnapshotTree({ source: stateRoot, destination: path.join(temporary, "state"), label: "State" });
      const receipt = {
        schemaVersion: BACKUP_RECEIPT_SCHEMA_VERSION,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        activeRelease: { path: active.relative, ...activeFingerprint },
        snapshots: [
          { role: "configuration", path: "configuration", ...configuration },
          { role: "state", path: "state", ...state },
        ],
      };
      await writeFile(path.join(temporary, "backup-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temporary, finalDirectory);
      const receiptPath = path.join(finalDirectory, "backup-receipt.json");
      await verifyBackupReceipt({ managedRoot, activeLink, receiptPath });
      return { directory: finalDirectory, receiptPath, receipt };
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  });
}

export async function verifyBackupReceipt({ managedRoot, activeLink, receiptPath, requireCurrentRelease = true }) {
  const layout = await assertManagedRoot(managedRoot);
  const active = await readActiveRelease(layout, activeLink);
  await assertRegularFile(receiptPath, "Backup receipt");
  const receipt = validateBackupReceiptShape(parseStrictJsonBytes(await readFile(receiptPath), "Backup receipt"));
  const backedUpRelease = path.resolve(layout.root, receipt.activeRelease.path);
  if (!isPathInside(backedUpRelease, layout.releases)) fail("Backup receipt release is outside managed releases.");
  await assertRealDirectory(backedUpRelease, "Backup receipt release");
  const activeFingerprint = payloadFingerprint(await collectPayloadEntries(backedUpRelease));
  if (activeFingerprint.entries !== receipt.activeRelease.entries || activeFingerprint.sha256 !== receipt.activeRelease.sha256) {
    fail("Active release changed after backup creation.");
  }
  if (requireCurrentRelease && receipt.activeRelease.path !== active.relative) fail("Backup receipt does not belong to the current active release.");
  const receiptDirectory = await realpath(path.dirname(receiptPath));
  for (const snapshot of receipt.snapshots) {
    const snapshotPath = path.resolve(receiptDirectory, snapshot.path);
    if (!isPathInside(snapshotPath, receiptDirectory)) fail("Backup snapshot escapes its receipt directory.");
    const fingerprint = payloadFingerprint(await collectPayloadEntries(snapshotPath));
    if (fingerprint.entries !== snapshot.entries || fingerprint.sha256 !== snapshot.sha256) fail(`Backup snapshot integrity differs: ${snapshot.role}.`);
  }
  return receipt;
}

export async function stageVerifiedRelease({ managedRoot, tarball, manifestPath, expected, commandRunner = run, extractor = extractAndVerifyRuntimeArchive }) {
  const layout = await assertManagedRoot(managedRoot);
  return withDeploymentLease(layout, async (lease) => {
    const stageDirectory = path.join(layout.staging, `${expected.commit}-${randomUUID()}`);
    const inputDirectory = path.join(layout.staging, `.input-${randomUUID()}`);
    await assertAbsent(stageDirectory, "Staging destination");
    await assertAbsent(inputDirectory, "Staging input destination");
    try {
      const inputTarball = path.join(inputDirectory, expected.artifactName);
      const inputManifest = path.join(inputDirectory, `${expected.commit}.manifest.json`);
      await assertExclusivePath(tarball, "TAR artifact", lease.uid, { regularFile: true });
      await assertExclusivePath(manifestPath, "Artifact manifest", lease.uid, { regularFile: true });
      await mkdir(inputDirectory, { mode: 0o700 });
      await copyFile(tarball, inputTarball, 1);
      await copyFile(manifestPath, inputManifest, 1);
      await assertExclusivePath(inputTarball, "Private staging TAR", lease.uid, { regularFile: true });
      await assertExclusivePath(inputManifest, "Private staging manifest", lease.uid, { regularFile: true });
      const bundle = await verifyArtifactBundle({ tarball: inputTarball, manifestPath: inputManifest, expected, commandRunner });
      const extracted = await extractor({ tarball: bundle.tarball, manifestPath: bundle.manifestPath, destination: stageDirectory });
      const runtime = path.resolve(extracted.runtime);
      if (!isPathInside(runtime, stageDirectory) || path.basename(runtime) !== "runtime") fail("Extracted runtime has an unexpected location.");
      await assertExclusivePath(stageDirectory, "Stage directory", lease.uid, { directory: true });
      await assertControlledRuntimeTree(runtime, lease.uid);
      const stagedManifestPath = path.join(stageDirectory, STAGED_MANIFEST_FILENAME);
      await writeFile(stagedManifestPath, bundle.manifestBytes, { flag: "wx", mode: 0o400 });
      await assertExclusivePath(stagedManifestPath, "Staged manifest", lease.uid, { regularFile: true });
      if (await sha256File(stagedManifestPath) !== expected.manifestSha256) fail("Staged manifest differs from the approved manifest hash.");
      await verifyManifest({ runtime, manifestPath: stagedManifestPath });
      const fingerprint = payloadFingerprint(await collectPayloadEntries(runtime));
      const receipt = {
        schemaVersion: STAGED_RELEASE_SCHEMA_VERSION,
        id: randomUUID(),
        stagedAt: new Date().toISOString(),
        candidate: {
          commit: expected.commit,
          tree: expected.tree,
          artifactName: expected.artifactName,
          tarSha256: expected.tarSha256,
          manifestSha256: expected.manifestSha256,
        },
        manifest: { path: STAGED_MANIFEST_FILENAME, sha256: expected.manifestSha256 },
        runtime: { path: "runtime", ...fingerprint },
      };
      const receiptPath = path.join(stageDirectory, "stage-receipt.json");
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o400 });
      await assertExclusivePath(receiptPath, "Stage receipt", lease.uid, { regularFile: true });
      await sealRuntimeTree(runtime, lease.uid);
      await assertDeploymentLease(lease);
      return { directory: stageDirectory, runtime, receipt };
    } catch (error) {
      await rm(stageDirectory, { recursive: true, force: true });
      throw error;
    } finally {
      await rm(inputDirectory, { recursive: true, force: true });
    }
  });
}

async function atomicSwitchPointer({ activeLink, targetRelative }) {
  if (!isSafeRelativePath(targetRelative)) fail("New release pointer target is unsafe.");
  const parent = path.dirname(activeLink);
  const temporary = path.join(parent, `.current-${randomUUID()}.next`);
  await assertAbsent(temporary, "Temporary active-release pointer");
  try {
    await symlink(targetRelative, temporary);
    await rename(temporary, activeLink);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function validateStageReceipt(receipt, expected) {
  requireExactKeys(receipt, ["candidate", "id", "manifest", "runtime", "schemaVersion", "stagedAt"], "Stage receipt");
  if (receipt.schemaVersion !== STAGED_RELEASE_SCHEMA_VERSION || typeof receipt.id !== "string" || !/^[a-f0-9-]{36}$/.test(receipt.id) || Number.isNaN(Date.parse(receipt.stagedAt))) {
    fail("Stage receipt schema is unsupported.");
  }
  requireExactKeys(receipt.candidate, ["artifactName", "commit", "manifestSha256", "tarSha256", "tree"], "Stage receipt candidate");
  for (const key of Object.keys(expected)) if (receipt.candidate[key] !== expected[key]) fail("Stage receipt candidate differs from the approved artifact identity.");
  requireExactKeys(receipt.manifest, ["path", "sha256"], "Stage receipt manifest");
  if (receipt.manifest.path !== STAGED_MANIFEST_FILENAME || receipt.manifest.sha256 !== expected.manifestSha256) fail("Stage receipt manifest differs from the approved artifact identity.");
  requireExactKeys(receipt.runtime, ["entries", "path", "sha256"], "Stage receipt runtime");
  if (receipt.runtime.path !== "runtime" || !Number.isSafeInteger(receipt.runtime.entries) || receipt.runtime.entries < 1) fail("Stage receipt runtime is invalid.");
  assertSha256(receipt.runtime.sha256, "Stage receipt runtime digest");
}

/**
 * Changes only the managed `current` symlink. It deliberately does not reload
 * systemd, PM2, Compose, Cloudflared or any database: those identities must be
 * discovered and approved in the remote operational preflight.
 */
export async function activateStagedRelease({ managedRoot, activeLink, stageDirectory, backupReceiptPath, expected }) {
  const layout = await assertManagedRoot(managedRoot);
  return withDeploymentLease(layout, async (lease) => {
    const active = await readActiveRelease(layout, activeLink);
    await verifyBackupReceipt({ managedRoot, activeLink, receiptPath: backupReceiptPath });
    const stage = path.resolve(stageDirectory);
    if (!isPathInside(stage, layout.staging) || !isPathInside(await realpath(stage), await realpath(layout.staging))) fail("Stage directory is outside managed staging.");
    await assertExclusivePath(stage, "Stage directory", lease.uid, { directory: true });
    const receiptPath = path.join(stage, "stage-receipt.json");
    await assertExclusivePath(receiptPath, "Stage receipt", lease.uid, { regularFile: true });
    const receipt = parseStrictJsonBytes(await readFile(receiptPath), "Stage receipt");
    validateStageReceipt(receipt, expected);
    const stagedManifestPath = path.join(stage, receipt.manifest.path);
    await assertExclusivePath(stagedManifestPath, "Staged manifest", lease.uid, { regularFile: true });
    const stagedManifestBytes = await readFile(stagedManifestPath);
    if (sha256Bytes(stagedManifestBytes) !== receipt.manifest.sha256 || receipt.manifest.sha256 !== expected.manifestSha256) {
      fail("Staged manifest differs from the approved artifact identity.");
    }
    const runtime = path.join(stage, receipt.runtime.path);
    await assertControlledRuntimeTree(runtime, lease.uid);
    const fingerprint = payloadFingerprint(await collectPayloadEntries(runtime));
    if (fingerprint.entries !== receipt.runtime.entries || fingerprint.sha256 !== receipt.runtime.sha256) {
      fail("Staged runtime differs from the receipt recorded during staging.");
    }
    await verifyManifest({ runtime, manifestPath: stagedManifestPath });
    await sealRuntimeTree(runtime, lease.uid);
    await assertDeploymentLease(lease);
    const release = path.join(layout.releases, expected.commit);
    await assertAbsent(release, "Candidate release destination");
    await rename(runtime, release);
    const targetRelative = path.relative(layout.root, release).split(path.sep).join("/");
    try {
      await atomicSwitchPointer({ activeLink: active.link, targetRelative });
    } catch (error) {
      await rename(release, runtime);
      throw error;
    }
    return { previous: active.relative, active: targetRelative, release };
  });
}

export async function rollbackCodeRelease({ managedRoot, activeLink, backupReceiptPath }) {
  const layout = await assertManagedRoot(managedRoot);
  return withDeploymentLease(layout, async () => {
    const receipt = await verifyBackupReceipt({ managedRoot, activeLink, receiptPath: backupReceiptPath, requireCurrentRelease: false });
    const previous = path.resolve(layout.root, receipt.activeRelease.path);
    if (!isPathInside(previous, layout.releases)) fail("Rollback target is outside managed releases.");
    await assertRealDirectory(previous, "Rollback release target");
    await atomicSwitchPointer({ activeLink: path.resolve(activeLink), targetRelative: receipt.activeRelease.path });
    return { active: receipt.activeRelease.path, rolledBackAt: new Date().toISOString() };
  });
}

/** Verifies only a loopback health endpoint; public readiness remains an operational check. */
export async function verifyLocalReleaseHealth({ url, expectedCommit, fetchImpl = globalThis.fetch, timeoutMs = 10_000 }) {
  assertGitSha(expectedCommit, "Expected health release commit");
  let endpoint;
  try { endpoint = new URL(url); } catch { fail("Health URL is invalid."); }
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname)) {
    fail("Health URL must be an explicit HTTP loopback endpoint.");
  }
  if (endpoint.pathname !== "/healthz" || endpoint.search || endpoint.hash) fail("Health URL must target exactly /healthz.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 90_000) fail("Health timeout is invalid.");
  const response = await fetchImpl(endpoint, { redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  if (!response?.ok || response.status !== 200) fail("Health endpoint did not return HTTP 200.");
  let payload;
  try { payload = await response.json(); } catch { fail("Health endpoint did not return JSON."); }
  if (payload?.status !== "healthy" || payload?.release?.sha !== expectedCommit) {
    fail("Health endpoint does not report the expected release SHA.");
  }
  return { url: endpoint.toString(), releaseSha: expectedCommit };
}

function parseArguments(argumentsList) {
  const [command, ...rest] = argumentsList;
  if (!["verify", "stage", "backup", "activate", "rollback", "health"].includes(command)) {
    fail("Usage: linux-arm64-release-deploy.mjs <verify|stage|backup|activate|rollback|health> --key value ...");
  }
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined || Object.hasOwn(options, key)) fail("Command arguments must be unique --key value pairs.");
    options[key] = value;
  }
  return { command, options };
}

function expectedFromOptions(options) {
  return {
    artifactName: options["--expected-artifact-name"],
    tarSha256: options["--expected-tar-sha256"],
    manifestSha256: options["--expected-manifest-sha256"],
    commit: options["--expected-commit"],
    tree: options["--expected-tree"],
  };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "verify") {
    const result = await verifyArtifactBundle({ tarball: options["--tar"], manifestPath: options["--manifest"], expected: expectedFromOptions(options) });
    process.stdout.write(`LINUX_DEPLOY_VERIFY=PASS commit=${result.manifest.release.commit} tree=${result.manifest.release.tree}\n`);
    return;
  }
  if (command === "backup") {
    const result = await createVerifiedBackup({ managedRoot: options["--managed-root"], activeLink: options["--active-link"], configurationRoot: options["--configuration-root"], stateRoot: options["--state-root"] });
    process.stdout.write(`LINUX_DEPLOY_BACKUP=PASS receipt=${result.receiptPath}\n`);
    return;
  }
  if (command === "stage") {
    const result = await stageVerifiedRelease({ managedRoot: options["--managed-root"], tarball: options["--tar"], manifestPath: options["--manifest"], expected: expectedFromOptions(options) });
    process.stdout.write(`LINUX_DEPLOY_STAGE=PASS stage=${result.directory}\n`);
    return;
  }
  if (command === "activate") {
    const result = await activateStagedRelease({ managedRoot: options["--managed-root"], activeLink: options["--active-link"], stageDirectory: options["--stage"], backupReceiptPath: options["--backup-receipt"], expected: expectedFromOptions(options) });
    process.stdout.write(`LINUX_DEPLOY_ACTIVATE=PASS active=${result.active}\n`);
    return;
  }
  if (command === "health") {
    const result = await verifyLocalReleaseHealth({ url: options["--url"], expectedCommit: options["--expected-commit"] });
    process.stdout.write(`LINUX_DEPLOY_HEALTH=PASS release=${result.releaseSha}\n`);
    return;
  }
  const result = await rollbackCodeRelease({ managedRoot: options["--managed-root"], activeLink: options["--active-link"], backupReceiptPath: options["--backup-receipt"] });
  process.stdout.write(`LINUX_DEPLOY_ROLLBACK=PASS active=${result.active}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
