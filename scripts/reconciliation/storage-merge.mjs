import { createHash } from "node:crypto";
import { COPYFILE_EXCL } from "node:constants";
import { copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { ReconciliationError, assertStagingDatabaseUrl, sha256 } from "./reconciler.mjs";

function parseCsvLine(line) {
  const result = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { result.push(value); value = ""; }
    else value += character;
  }
  result.push(value);
  return result;
}

export function parseWindowsManifest(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines.shift());
  return lines.map(line => Object.fromEntries(header.map((key, index) => [key, parseCsvLine(line)[index]])));
}

export function parseOracleManifest(text) {
  return text.split(/\r?\n/).filter(Boolean).map(line => {
    const [relative_path, size, sha256Value, mtime_utc] = line.split("\t", 4);
    return { relative_path, size, sha256: sha256Value, mtime_utc };
  });
}

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export function normalizeStoragePath(value) {
  const path = String(value).replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = path.split("/");
  const unsafeSegment = segment => !segment || segment === "." || segment === ".."
    || /[<>:"|?*\u0000-\u001f]/.test(segment)
    || /[ .]$/.test(segment)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment);
  if (!path || path.startsWith("/") || /^[a-z]:\//i.test(path) || segments.some(unsafeSegment) || path.normalize("NFC") !== path) {
    throw new ReconciliationError("UNSAFE_STORAGE_PATH", "Storage manifest contains an unsafe or non-canonical path.", { pathHash: sha256(path) });
  }
  return path;
}

function normalizeManifestEntry(entry, source) {
  const path = normalizeStoragePath(entry.relative_path);
  const size = Number(entry.size);
  const digest = String(entry.sha256).toLowerCase();
  if (!Number.isSafeInteger(size) || size < 0 || !/^[a-f0-9]{64}$/.test(digest)) {
    throw new ReconciliationError("INVALID_STORAGE_MANIFEST_ENTRY", "Storage manifest entry has an invalid size or SHA-256.", { pathHash: sha256(path), source });
  }
  return { source, relativePath: path, size, sha256: digest, mtime: entry.mtime_utc };
}

export function mergeManifestEntries(windowsEntries, oracleEntries) {
  const merged = new Map();
  const caseFolded = new Map();
  const stats = { windowsSource: windowsEntries.length, oracleSource: oracleEntries.length, commonIdentical: 0, windowsOnly: 0, oracleOnly: 0, pathConflicts: 0 };
  for (const [source, entries] of [["ORACLE", oracleEntries], ["WINDOWS", windowsEntries]]) {
    for (const entry of entries) {
      const normalized = normalizeManifestEntry(entry, source);
      const path = normalized.relativePath;
      const folded = path.toLowerCase();
      const spelling = caseFolded.get(folded);
      if (spelling && spelling !== path) {
        throw new ReconciliationError("STORAGE_CASE_COLLISION", "Storage paths differ only by case.", { firstPathHash: sha256(spelling), secondPathHash: sha256(path) });
      }
      caseFolded.set(folded, path);
      const existing = merged.get(path);
      if (!existing) { merged.set(path, normalized); continue; }
      if (existing.source === source || existing.source === "BOTH") {
        throw new ReconciliationError("DUPLICATE_MANIFEST_ENTRY", "A source manifest repeats the same canonical path.", { pathHash: sha256(path), source });
      }
      if (existing.sha256 !== normalized.sha256 || existing.size !== normalized.size) {
        stats.pathConflicts += 1;
        throw new ReconciliationError("STORAGE_PATH_CONFLICT", "Same storage path has incompatible content.", { pathHash: sha256(path), oracleHash: existing.sha256, windowsHash: normalized.sha256 });
      }
      stats.commonIdentical += 1;
      existing.source = "BOTH";
    }
  }
  for (const entry of merged.values()) {
    if (entry.source === "WINDOWS") stats.windowsOnly += 1;
    if (entry.source === "ORACLE") stats.oracleOnly += 1;
  }
  return { entries: [...merged.values()].sort((a, b) => compareText(a.relativePath, b.relativePath)), stats };
}

export function resolveStorageReference(storageKey, entries) {
  const key = String(storageKey).replaceAll("\\", "/").replace(/^\.\//, "");
  const matches = entries.filter(entry => {
    if (entry.relativePath === key) return true;
    const file = basename(entry.relativePath);
    return file === key || basename(file, extname(file)) === key;
  });
  if (matches.length > 1) {
    throw new ReconciliationError("AMBIGUOUS_STORAGE_REFERENCE", "Storage key resolves to more than one frozen object.", {
      storageKeyHash: sha256(key),
      candidates: matches.length,
    });
  }
  if (!matches.length) return null;
  return { entry: matches[0], mode: matches[0].relativePath === key ? "EXACT_PATH" : "UNIQUE_OBJECT_ID" };
}

export function assertDistinctStorageRoots(windowsRoot, oracleRoot, targetRoot) {
  const roots = [windowsRoot, oracleRoot, targetRoot].map(root => resolve(root));
  for (let left = 0; left < roots.length; left += 1) {
    for (let right = left + 1; right < roots.length; right += 1) {
      const leftToRight = relative(roots[left], roots[right]);
      const rightToLeft = relative(roots[right], roots[left]);
      if (!leftToRight || !leftToRight.startsWith(`..${sep}`) || !rightToLeft.startsWith(`..${sep}`)) {
        throw new ReconciliationError("OVERLAPPING_STORAGE_ROOTS", "Windows, Oracle, and canonical storage roots must be pairwise disjoint.");
      }
    }
  }
  return roots;
}

async function hashFile(path) {
  const contents = await readFile(path);
  return createHash("sha256").update(contents).digest("hex");
}

function safeResolve(root, relativePath) {
  const base = resolve(root);
  const target = resolve(base, relativePath);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new ReconciliationError("STORAGE_ESCAPE", "Storage target escaped canonical root.");
  return target;
}

async function assertNoSymlinkChain(root, target, expectFile) {
  const base = resolve(root);
  const rootInfo = await lstat(base);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new ReconciliationError("UNSAFE_STORAGE_ROOT", "Storage root must be a real directory.");
  const relativeTarget = relative(base, target);
  if (!relativeTarget && !expectFile) return;
  if (!relativeTarget || relativeTarget.startsWith(`..${sep}`) || relativeTarget === "..") throw new ReconciliationError("STORAGE_ESCAPE", "Storage path escaped its root.");
  let current = base;
  const segments = relativeTarget.split(sep);
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new ReconciliationError("STORAGE_SYMLINK_BLOCKED", "Storage path contains a symbolic link.", { pathHash: sha256(relativeTarget) });
    if (index < segments.length - 1 && !info.isDirectory()) throw new ReconciliationError("INVALID_STORAGE_PARENT", "Storage parent is not a directory.", { pathHash: sha256(relativeTarget) });
    if (index === segments.length - 1 && expectFile && (!info.isFile() || info.nlink > 1)) {
      throw new ReconciliationError("UNSAFE_STORAGE_FILE", "Storage object must be a regular non-hardlinked file.", { pathHash: sha256(relativeTarget) });
    }
  }
}

async function ensureDirectoryChain(root, directory) {
  const base = resolve(root);
  const relativeDirectory = relative(base, directory);
  if (relativeDirectory.startsWith(`..${sep}`) || relativeDirectory === "..") {
    throw new ReconciliationError("STORAGE_ESCAPE", "Storage directory escaped its root.");
  }
  await assertNoSymlinkChain(base, base, false);
  let current = base;
  for (const segment of relativeDirectory ? relativeDirectory.split(sep) : []) {
    current = join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new ReconciliationError("UNSAFE_STORAGE_PARENT", "Storage parent must be a real directory.", { pathHash: sha256(relativeDirectory) });
    }
  }
  await assertNoSymlinkChain(base, directory, false);
}

function sameFileSnapshot(left, right) {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ino === right.ino && left.dev === right.dev;
}

async function verifyStableFile(root, path, entry, code) {
  await assertNoSymlinkChain(root, path, true);
  const before = await lstat(path);
  const digest = await hashFile(path);
  const after = await lstat(path);
  if (!sameFileSnapshot(before, after) || before.size !== entry.size || digest !== entry.sha256) {
    throw new ReconciliationError(code, "Storage object differs from its frozen manifest or changed during verification.", { pathHash: sha256(entry.relativePath), source: entry.source });
  }
  return after;
}

async function copyAndVerify(entry, windowsRoot, oracleRoot, targetRoot) {
  const sourceRoots = entry.source === "BOTH" ? [oracleRoot, windowsRoot] : [entry.source === "WINDOWS" ? windowsRoot : oracleRoot];
  const sources = sourceRoots.map(sourceRoot => ({ sourceRoot, source: safeResolve(sourceRoot, entry.relativePath) }));
  const target = safeResolve(targetRoot, entry.relativePath);
  const sourceSnapshots = [];
  for (const item of sources) {
    sourceSnapshots.push({ ...item, snapshot: await verifyStableFile(item.sourceRoot, item.source, entry, "STORAGE_SOURCE_HASH_MISMATCH") });
  }
  await ensureDirectoryChain(targetRoot, dirname(target));
  try {
    await verifyStableFile(targetRoot, target, entry, "STORAGE_TARGET_CONFLICT");
    for (const item of sourceSnapshots) {
      const current = await lstat(item.source);
      if (!sameFileSnapshot(item.snapshot, current)) throw new ReconciliationError("STORAGE_SOURCE_CHANGED_DURING_COPY", "Storage source changed during replay verification.", { pathHash: sha256(entry.relativePath) });
    }
    return "replayed";
  } catch (error) {
    if (error instanceof ReconciliationError) throw error;
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await copyFile(sources[0].source, target, COPYFILE_EXCL);
  } catch (error) {
    if (error.code === "EEXIST") throw new ReconciliationError("STORAGE_TARGET_RACE", "Canonical storage target appeared during copy.", { pathHash: sha256(entry.relativePath) });
    throw error;
  }
  await verifyStableFile(targetRoot, target, entry, "STORAGE_COPY_HASH_MISMATCH");
  for (const item of sourceSnapshots) {
    const current = await lstat(item.source);
    if (!sameFileSnapshot(item.snapshot, current)) throw new ReconciliationError("STORAGE_SOURCE_CHANGED_DURING_COPY", "Storage source changed during copy.", { pathHash: sha256(entry.relativePath) });
  }
  return "copied";
}

async function databaseReferences(databaseUrl, schema) {
  if (!databaseUrl) return [];
  const connection = await mysql.createConnection({ uri: databaseUrl, timezone: "Z", dateStrings: true });
  try {
    const [columns] = await connection.execute(
      `SELECT TABLE_NAME tableName,COLUMN_NAME columnName FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=? AND COLUMN_NAME IN ('storage_key','thumbnail_storage_key','conversation_background_image_key')
        ORDER BY TABLE_NAME,COLUMN_NAME`, [schema]);
    const references = [];
    for (const column of columns) {
      const [values] = await connection.execute(`SELECT DISTINCT \`${column.columnName}\` storageKey FROM \`${schema}\`.\`${column.tableName}\` WHERE \`${column.columnName}\` IS NOT NULL AND \`${column.columnName}\`<>'' ORDER BY \`${column.columnName}\``);
      for (const value of values) references.push({ table: column.tableName, column: column.columnName, storageKey: String(value.storageKey).replaceAll("\\", "/").replace(/^\.\//, "") });
    }
    return references;
  } finally { await connection.end(); }
}

export async function mergeStorage(options) {
  assertDistinctStorageRoots(options.windowsRoot, options.oracleRoot, options.targetRoot);
  if (!options.databaseUrl && !options.allowNoDatabaseForUnitTest) {
    throw new ReconciliationError("STORAGE_DATABASE_REQUIRED", "A disposable staging database is required to validate storage references.");
  }
  const windowsEntries = parseWindowsManifest(await readFile(options.windowsManifest, "utf8"));
  const oracleEntries = parseOracleManifest(await readFile(options.oracleManifest, "utf8"));
  const merged = mergeManifestEntries(windowsEntries, oracleEntries);
  const report = { version: 1, startedAt: new Date().toISOString(), ...merged.stats, final: merged.entries.length, copied: 0, replayed: 0, objects: [] };
  const schema = options.databaseUrl ? assertStagingDatabaseUrl(options.databaseUrl).database : null;
  const references = await databaseReferences(options.databaseUrl, schema);
  report.databaseReferences = references.length;
  const resolvedReferences = references.map(reference => ({ reference, resolved: resolveStorageReference(reference.storageKey, merged.entries) }));
  report.referencesResolvedExact = resolvedReferences.filter(item => item.resolved?.mode === "EXACT_PATH").length;
  report.referencesResolvedByObjectId = resolvedReferences.filter(item => item.resolved?.mode === "UNIQUE_OBJECT_ID").length;
  report.missingDatabaseObjects = resolvedReferences.filter(item => !item.resolved).map(({ reference }) => ({
    table: reference.table,
    column: reference.column,
    storageKeyHash: sha256(reference.storageKey),
  }));
  if (report.missingDatabaseObjects.length) {
    report.result = "FAIL";
    report.finishedAt = new Date().toISOString();
    await writeFile(options.reportFile, JSON.stringify(report, null, 2), { encoding: "utf8", mode: 0o600 });
    throw new ReconciliationError("MISSING_STORAGE_OBJECT", "Database references are missing from the frozen storage union.", { missing: report.missingDatabaseObjects.length });
  }
  for (const entry of merged.entries) {
    const action = await copyAndVerify(entry, options.windowsRoot, options.oracleRoot, options.targetRoot);
    report[action] += 1;
    report.objects.push({ source: entry.source, originalPathHash: sha256(entry.relativePath), canonicalPathHash: sha256(entry.relativePath), size: entry.size, sha256: entry.sha256, action });
  }
  const referrersByPath = new Map();
  for (const item of resolvedReferences.filter(item => item.resolved)) {
    const path = item.resolved.entry.relativePath;
    if (!referrersByPath.has(path)) referrersByPath.set(path, []);
    referrersByPath.get(path).push({ table: item.reference.table, column: item.reference.column, resolution: item.resolved.mode });
  }
  for (const object of report.objects) {
    const entry = merged.entries.find(candidate => sha256(candidate.relativePath) === object.canonicalPathHash);
    const referrers = entry ? referrersByPath.get(entry.relativePath) ?? [] : [];
    object.referenced = referrers.length > 0;
    object.referrers = referrers;
    const tenantMatch = entry?.relativePath.match(/(?:^|\/)tenants\/([^/]+)\//);
    object.tenantHash = tenantMatch ? sha256(tenantMatch[1]) : null;
  }
  report.orphansPreserved = report.objects.filter(object => !object.referenced).length;
  report.result = report.missingDatabaseObjects.length ? "FAIL" : "PASS";
  report.finishedAt = new Date().toISOString();
  await writeFile(options.reportFile, JSON.stringify(report, null, 2), { encoding: "utf8", mode: 0o600 });
  return report;
}

async function main() {
  const required = ["STORAGE_WINDOWS_MANIFEST", "STORAGE_ORACLE_MANIFEST", "STORAGE_WINDOWS_ROOT", "STORAGE_ORACLE_ROOT", "STORAGE_TARGET_ROOT", "STORAGE_REPORT_FILE", "STORAGE_TARGET_DATABASE_URL"];
  for (const name of required) if (!process.env[name]) throw new Error(`${name} is required.`);
  const report = await mergeStorage({ windowsManifest: process.env.STORAGE_WINDOWS_MANIFEST, oracleManifest: process.env.STORAGE_ORACLE_MANIFEST, windowsRoot: process.env.STORAGE_WINDOWS_ROOT, oracleRoot: process.env.STORAGE_ORACLE_ROOT, targetRoot: process.env.STORAGE_TARGET_ROOT, reportFile: process.env.STORAGE_REPORT_FILE, databaseUrl: process.env.STORAGE_TARGET_DATABASE_URL });
  process.stdout.write(`${JSON.stringify({ final: report.final, copied: report.copied, replayed: report.replayed, pathConflicts: report.pathConflicts, missingDatabaseObjects: report.missingDatabaseObjects.length })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ error: error.name, code: error.code ?? "UNEXPECTED", message: error.message, details: error.details ?? {} })}\n`);
  process.exitCode = 1;
});
