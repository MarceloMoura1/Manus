#!/usr/bin/env node
/**
 * Restores a verified compose-consistent backup pair only into a named,
 * disposable Linux/Docker environment.  This is intentionally separate from
 * the production backup script: it has no production defaults and refuses to
 * infer resource names, credentials, ports, or paths.
 */
import { createHash, randomBytes } from "node:crypto";
import { spawn as nodeSpawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { constants as fsConstants, promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA256 = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const ENVIRONMENT_ID = /^restore-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATABASE_NAME = /^megadesk_test_restore_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const SANDBOX_PARENT = "/var/tmp/megadesk-restore";
const MYSQL_IMAGE = "mysql:8.0.46";
const LABEL = "com.megadesk.restore-harness";
const MARKER = ".megadesk-restore-harness.json";

export class RestoreHarnessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RestoreHarnessError";
    this.code = code;
  }
}

function fail(code, message) { throw new RestoreHarnessError(code, message); }
function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function compareCodePoints(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function exactKeys(value, expected, label) {
  if (!isObject(value)) fail("INVALID_SCHEMA", `${label} must be an object.`);
  const actual = Object.keys(value).sort(compareCodePoints);
  const sortedExpected = [...expected].sort(compareCodePoints);
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    fail("INVALID_SCHEMA", `${label} has an unsupported schema.`);
  }
}
function assertSha(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail("INVALID_SHA256", `${label} must be a lowercase SHA-256.`);
}
function assertNonEmpty(value, label) {
  if (typeof value !== "string" || value.length === 0) fail("MISSING_ARGUMENT", `${label} is required.`);
}
function safeRelative(value) {
  return typeof value === "string" && value.length > 0 && !path.posix.isAbsolute(value)
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value)
    && !value.includes("\\") && !value.split("/").some(part => part === "" || part === "." || part === "..");
}
function isWithin(root, target) {
  const relative = path.posix.relative(root, target);
  return relative === "" || (!relative.startsWith("../") && relative !== ".." && !path.posix.isAbsolute(relative));
}
function sanitizeError(error) {
  return error instanceof RestoreHarnessError ? error : new RestoreHarnessError("UNEXPECTED_FAILURE", "restore harness failed without exposing operational input");
}

/** Strict JSON prevents BOM, invalid UTF-8 and duplicate-key ambiguity. */
export function parseStrictJson(bytes, label = "JSON") {
  let source;
  try { source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { fail("INVALID_JSON", `${label} is not valid UTF-8.`); }
  if (source.charCodeAt(0) === 0xfeff) fail("INVALID_JSON", `${label} must not contain a BOM.`);
  let cursor = 0;
  const whitespace = () => { while (/[\u0009\u000a\u000d\u0020]/.test(source[cursor] ?? "")) cursor += 1; };
  const string = () => {
    if (source[cursor] !== '"') fail("INVALID_JSON", `${label} contains an invalid string.`);
    const start = cursor++;
    let escaped = false;
    while (cursor < source.length) {
      const char = source[cursor];
      if (escaped) { escaped = false; cursor += 1; continue; }
      if (!escaped && char === '"') { cursor += 1; try { return JSON.parse(source.slice(start, cursor)); } catch { fail("INVALID_JSON", `${label} contains an invalid string.`); } }
      if (!escaped && char.charCodeAt(0) < 0x20) fail("INVALID_JSON", `${label} contains a control character.`);
      if (char === "\\") escaped = true;
      cursor += 1;
    }
    fail("INVALID_JSON", `${label} is truncated.`);
  };
  const primitive = () => {
    const start = cursor;
    while (cursor < source.length && !/[\u0009\u000a\u000d\u0020,\]}]/.test(source[cursor])) cursor += 1;
    if (start === cursor) fail("INVALID_JSON", `${label} contains an invalid token.`);
    try { return JSON.parse(source.slice(start, cursor)); } catch { fail("INVALID_JSON", `${label} contains an invalid token.`); }
  };
  const value = depth => {
    if (depth > 64) fail("INVALID_JSON", `${label} exceeds maximum nesting.`);
    whitespace();
    if (source[cursor] === '"') return string();
    if (source[cursor] === "{") {
      cursor += 1; whitespace();
      const output = {}; const keys = new Set();
      if (source[cursor] === "}") { cursor += 1; return output; }
      while (true) {
        whitespace(); const key = string();
        if (keys.has(key)) fail("INVALID_JSON", `${label} contains a duplicate key.`);
        keys.add(key); whitespace();
        if (source[cursor] !== ":") fail("INVALID_JSON", `${label} contains an invalid object.`);
        cursor += 1; output[key] = value(depth + 1); whitespace();
        if (source[cursor] === "}") { cursor += 1; return output; }
        if (source[cursor] !== ",") fail("INVALID_JSON", `${label} contains an invalid object.`);
        cursor += 1;
      }
    }
    if (source[cursor] === "[") {
      cursor += 1; whitespace(); const output = [];
      if (source[cursor] === "]") { cursor += 1; return output; }
      while (true) {
        output.push(value(depth + 1)); whitespace();
        if (source[cursor] === "]") { cursor += 1; return output; }
        if (source[cursor] !== ",") fail("INVALID_JSON", `${label} contains an invalid array.`);
        cursor += 1;
      }
    }
    return primitive();
  };
  const parsed = value(0); whitespace();
  if (cursor !== source.length) fail("INVALID_JSON", `${label} contains trailing data.`);
  return parsed;
}

function validateArtifact(artifact, expectedName, label) {
  exactKeys(artifact, ["name", "sha256", "sizeBytes"], label);
  if (artifact.name !== expectedName || !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0) {
    fail("INVALID_MANIFEST", `${label} does not identify the canonical artifact.`);
  }
  assertSha(artifact.sha256, `${label} digest`);
}

export function validatePairManifest(manifest) {
  exactKeys(manifest, ["database", "freeze", "media", "releaseSha", "runId", "schema", "window"], "Backup manifest");
  if (manifest.schema !== "megadesk-consistent-backup-pair/v1") fail("INVALID_MANIFEST", "Backup manifest schema is unsupported.");
  if (typeof manifest.releaseSha !== "string" || !SHA1.test(manifest.releaseSha)) fail("INVALID_MANIFEST", "Backup manifest release SHA is invalid.");
  if (typeof manifest.runId !== "string" || !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(manifest.runId)) fail("INVALID_MANIFEST", "Backup manifest run id is invalid.");
  exactKeys(manifest.window, ["endedAt", "startedAt"], "Backup manifest window");
  exactKeys(manifest.freeze, ["activeWriters", "freezeStateIncludedInMediaArchive", "inFlightWrites", "mode"], "Backup manifest freeze");
  if (manifest.freeze.mode !== "active" || manifest.freeze.activeWriters !== 0 || manifest.freeze.inFlightWrites !== 0 || manifest.freeze.freezeStateIncludedInMediaArchive !== true) {
    fail("INVALID_MANIFEST", "Backup manifest does not prove a quiescent durable freeze.");
  }
  validateArtifact(manifest.database, "mysql.sql", "Database artifact");
  validateArtifact(manifest.media, "storage.tar", "Media artifact");
  return manifest;
}

async function regularFile(file, label) {
  let info;
  try { info = await fs.lstat(file); } catch { fail("ARTIFACT_MISSING", `${label} is missing.`); }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail("UNSAFE_ARTIFACT", `${label} must be an unlinked regular file.`);
  return info;
}
async function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256"); const source = createReadStream(file);
    source.on("error", reject); source.on("data", chunk => hash.update(chunk)); source.on("end", () => resolve(hash.digest("hex")));
  });
}

/** Validates that all three artifacts are one physical backup run, not a mix. */
export async function verifyBackupPair({ manifestPath, mysqlDump, storageTar }) {
  for (const [file, name] of [[manifestPath, "Backup manifest"], [mysqlDump, "Database dump"], [storageTar, "Media archive"]]) await regularFile(file, name);
  if (path.basename(manifestPath) !== "manifest.json" || path.basename(mysqlDump) !== "mysql.sql" || path.basename(storageTar) !== "storage.tar") {
    fail("ARTIFACT_NAME_MISMATCH", "Backup artifacts must use their canonical names.");
  }
  const [physicalManifest, physicalDatabase, physicalMedia] = await Promise.all([path.dirname(await fs.realpath(manifestPath)), path.dirname(await fs.realpath(mysqlDump)), path.dirname(await fs.realpath(storageTar))]);
  if (physicalManifest !== physicalDatabase || physicalManifest !== physicalMedia) fail("ARTIFACT_PAIR_MISMATCH", "Backup artifacts do not belong to one physical run directory.");
  const manifestBytes = await fs.readFile(manifestPath);
  const manifest = validatePairManifest(parseStrictJson(manifestBytes, "Backup manifest"));
  const [databaseInfo, mediaInfo, databaseHash, mediaHash] = await Promise.all([fs.stat(mysqlDump), fs.stat(storageTar), hashFile(mysqlDump), hashFile(storageTar)]);
  if (databaseInfo.size !== manifest.database.sizeBytes || databaseHash !== manifest.database.sha256 || mediaInfo.size !== manifest.media.sizeBytes || mediaHash !== manifest.media.sha256) {
    fail("ARTIFACT_MISMATCH", "Backup artifacts differ from the manifest.");
  }
  return Object.freeze({ manifest, manifestPath: await fs.realpath(manifestPath), mysqlDump: await fs.realpath(mysqlDump), storageTar: await fs.realpath(storageTar), databaseHash, mediaHash });
}

/**
 * Copies the already-validated pair into the private, marker-owned sandbox
 * and validates it again.  Restore never consumes the operator-supplied paths
 * directly, preventing a replacement between the initial hash and import.
 */
export async function materializeVerifiedBackupPair(config, pair) {
  const inputRoot = path.posix.join(config.sandboxRoot, "input");
  await fs.mkdir(inputRoot, { recursive: false, mode: 0o700 });
  const destinations = {
    manifestPath: path.posix.join(inputRoot, "manifest.json"),
    mysqlDump: path.posix.join(inputRoot, "mysql.sql"),
    storageTar: path.posix.join(inputRoot, "storage.tar"),
  };
  try {
    for (const [source, destination] of [[pair.manifestPath, destinations.manifestPath], [pair.mysqlDump, destinations.mysqlDump], [pair.storageTar, destinations.storageTar]]) {
      await fs.copyFile(source, destination, fsConstants.COPYFILE_EXCL);
      await fs.chmod(destination, 0o600);
    }
    return await verifyBackupPair(destinations);
  } catch (error) {
    throw sanitizeError(error);
  }
}

function integerPort(value, label) {
  if (!/^[0-9]+$/.test(String(value ?? ""))) fail("INVALID_PORT", `${label} must be an explicit numeric port.`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) fail("INVALID_PORT", `${label} is outside the allowed range.`);
  return port;
}
function assertSafeSandbox(sandboxRoot, environmentId) {
  if (typeof sandboxRoot !== "string" || !path.posix.isAbsolute(sandboxRoot)) fail("UNSAFE_PATH", "sandbox root must be absolute.");
  const expected = `${SANDBOX_PARENT}/${environmentId}`;
  if (path.posix.normalize(sandboxRoot) !== expected) fail("UNSAFE_PATH", "sandbox root must use the canonical disposable location.");
  return expected;
}

/**
 * Every future resource name is derived from one explicit environment id. This
 * prevents the cleanup path from ever accepting an operator-provided target.
 */
export function validateRestoreConfig(options, { platform = process.platform } = {}) {
  if (platform !== "linux") fail("UNSUPPORTED_PLATFORM", "restore harness can run only on Linux.");
  const required = ["environmentId", "sandboxRoot", "databaseName", "mysqlImage", "mysqlPort", "appPort", "runtimeDir"];
  for (const key of required) assertNonEmpty(options?.[key], key);
  const environmentId = options.environmentId;
  if (!ENVIRONMENT_ID.test(environmentId)) fail("INVALID_ENVIRONMENT", "environment id must start with restore- and contain lowercase safe segments.");
  const sandboxRoot = assertSafeSandbox(options.sandboxRoot, environmentId);
  if (!DATABASE_NAME.test(options.databaseName)) fail("PROTECTED_DATABASE", "database name must use the megadesk_test_restore_ prefix.");
  if (options.mysqlImage !== MYSQL_IMAGE) fail("MYSQL_VERSION_MISMATCH", "the restore harness requires mysql:8.0.46 exactly.");
  const mysqlPort = integerPort(options.mysqlPort, "MySQL port"); const appPort = integerPort(options.appPort, "Application port");
  if (mysqlPort === appPort || mysqlPort === 3000 || mysqlPort === 3306 || appPort === 3000 || appPort === 3306) fail("PROTECTED_PORT", "restore ports collide with a protected or duplicate port.");
  if (typeof options.runtimeDir !== "string" || !path.posix.isAbsolute(options.runtimeDir) || isWithin("/opt/megadesk", path.posix.normalize(options.runtimeDir))) {
    fail("UNSAFE_RUNTIME", "candidate runtime must be an approved absolute directory outside production paths.");
  }
  const prefix = `megadesk-${environmentId}`;
  return Object.freeze({
    environmentId, sandboxRoot, databaseName: options.databaseName, mysqlImage: options.mysqlImage, mysqlPort, appPort,
    runtimeDir: path.posix.normalize(options.runtimeDir),
    storageRoot: `${sandboxRoot}/storage`,
    network: `${prefix}-network`, mysqlContainer: `${prefix}-mysql`, appContainer: `${prefix}-app`, mysqlVolume: `${prefix}-mysql-data`,
  });
}

export function validateTarListing(listing) {
  const seen = new Set(); let freezeState = false;
  for (const raw of String(listing).split(/\r?\n/).filter(Boolean)) {
    const entry = raw.replace(/^\.\//, "").replace(/\/$/, "");
    // `tar --directory <root> .` emits the root marker `./`; it is not a
    // payload member and must not be mistaken for an empty/traversal path.
    if (entry === "") continue;
    if (!safeRelative(entry)) fail("UNSAFE_MEDIA_ARCHIVE", "media archive contains an unsafe path.");
    const canonicalEntry = entry.normalize("NFC");
    if (seen.has(canonicalEntry)) fail("UNSAFE_MEDIA_ARCHIVE", "media archive contains a duplicate path.");
    seen.add(canonicalEntry); if (canonicalEntry === ".write-freeze" || canonicalEntry.startsWith(".write-freeze/")) freezeState = true;
  }
  if (!freezeState) fail("FREEZE_STATE_MISSING", "media archive does not contain durable write-freeze state.");
  return true;
}

/** GNU tar verbose output gives the entry type before extraction. */
export function validateTarVerboseListing(listing) {
  for (const line of String(listing).split(/\r?\n/).filter(Boolean)) {
    const type = line[0];
    if (type !== "-" && type !== "d") {
      fail("UNSAFE_MEDIA_ARCHIVE", "media archive contains a link, device, FIFO, or unsupported entry type.");
    }
  }
  return true;
}

export async function assertGnuTar(command = run) {
  let result;
  try { result = await command("tar", ["--version"]); } catch { fail("GNU_TAR_REQUIRED", "GNU tar is required for restore verification."); }
  if (!String(result.stdout).includes("GNU tar")) fail("GNU_TAR_REQUIRED", "GNU tar is required; no fallback archiver is allowed.");
}

/** Reject a candidate before any sandbox, database, or media mutation begins. */
export async function assertCandidateRuntime(runtimeDir) {
  const info = await fs.lstat(runtimeDir);
  if (!info.isDirectory() || info.isSymbolicLink()) fail("UNSAFE_RUNTIME", "candidate runtime must be a real directory.");
  const probe = path.join(runtimeDir, "dist", "operations", "restore-synthetic-probe.js");
  const probeInfo = await fs.lstat(probe).catch(() => undefined);
  if (!probeInfo?.isFile() || probeInfo.isSymbolicLink()) {
    fail("SYNTHETIC_PROBE_REQUIRED", "candidate runtime does not contain the reviewed synthetic restore probe.");
  }
}

function appEnvironment(config, secrets) {
  const url = `mysql://restore_app:${secrets.appPassword}@mysql-test:3306/${config.databaseName}`;
  return [
    "NODE_ENV=development", "HOST=0.0.0.0", "PORT=3000", "MEGADESK_DISPOSABLE_RUNTIME=1", "RUN_DATABASE_INTEGRATION=1",
    `DATABASE_URL=${url}`, `TEST_DATABASE_URL=${url}`, "MEGADESK_MEDIA_ROOT=/opt/megadesk/storage",
    "MEGADESK_DISPOSABLE_MEDIA_ROOT=/opt/megadesk/storage", `JWT_SECRET=${secrets.jwtSecret}`,
    "DOTENV_CONFIG_PATH=/app/.restore-harness-no-dotenv", "MEGADESK_RESTORE_HARNESS=1",
    `MEGADESK_RESTORE_ENVIRONMENT_ID=${config.environmentId}`,
  ];
}
function syntheticSecrets(random = randomBytes) {
  return { rootPassword: random(32).toString("base64url"), appPassword: random(32).toString("base64url"), jwtSecret: random(48).toString("base64url") };
}

/** The sequence is dependency-injected so tests never invoke Docker or touch a backup. */
export async function runRestoreWorkflow({ config, pair, dependencies, random = randomBytes }) {
  const created = []; const secrets = syntheticSecrets(random);
  try {
    await dependencies.assertAbsent(config);
    await dependencies.assertPortsAvailable(config);
    await dependencies.assertRuntime(config.runtimeDir);
    await dependencies.verifyArchive(pair.storageTar);
    created.push("sandbox"); await dependencies.createSandbox(config);
    const sealedPair = await dependencies.materializePair(config, pair);
    await dependencies.verifyArchive(sealedPair.storageTar);
    created.push("network"); await dependencies.createNetwork(config);
    created.push("volume"); await dependencies.createVolume(config);
    created.push("mysql"); await dependencies.startMySql(config, secrets);
    await dependencies.waitForMySql(config, secrets);
    await dependencies.restoreDatabase(config, sealedPair.mysqlDump, secrets);
    await dependencies.restoreMedia(config, sealedPair.storageTar);
    await dependencies.verifyMedia(config, sealedPair.storageTar);
    created.push("app"); await dependencies.startApplication(config, appEnvironment(config, secrets));
    await dependencies.waitForApplication(config);
    await dependencies.verifySyntheticReferences(config);
    return { status: "RESTORE_PAIR_VERIFIED", releaseSha: pair.manifest.releaseSha, runId: pair.manifest.runId, databaseSha256: pair.databaseHash, mediaSha256: pair.mediaHash, mysqlImage: config.mysqlImage, resources: { app: config.appContainer, mysql: config.mysqlContainer, network: config.network, volume: config.mysqlVolume } };
  } catch (error) {
    throw sanitizeError(error);
  } finally {
    // Only labels/names derived above may be removed. A dependency must verify
    // its marker/label before deleting, including after partial startup.
    try { await dependencies.cleanup(config, [...created].reverse()); }
    catch (cleanupError) { if (!created.length) throw cleanupError; throw new RestoreHarnessError("CLEANUP_UNCONFIRMED", "restore failed and disposable-resource cleanup could not be confirmed"); }
  }
}

async function run(command, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(command, args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] }); let stdout = ""; let stderr = "";
    child.on("error", reject); child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
    child.on("close", code => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const error = new RestoreHarnessError("COMMAND_FAILED", `${command} exited with ${code}`);
        error.exitCode = code;
        reject(error);
      }
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

export function createDockerDependencies(command = run) {
  const labels = config => ["--label", `${LABEL}=${config.environmentId}`];
  const assertPortAvailable = port => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new RestoreHarnessError("PORT_UNAVAILABLE", "a requested disposable port is unavailable.")));
    server.listen(port, "127.0.0.1", () => server.close(error => error ? reject(error) : resolve()));
  });
  const assertLabeledIfPresent = async (kind, name, config) => {
    const template = kind === "container" ? `{{ index .Config.Labels \"${LABEL}\" }}` : `{{ index .Labels \"${LABEL}\" }}`;
    let result;
    try { result = await command("docker", ["inspect", "--format", template, name]); }
    catch (error) {
      if (error instanceof RestoreHarnessError && error.code === "COMMAND_FAILED" && error.exitCode === 1) return false;
      throw error;
    }
    if (result.stdout.trim() !== config.environmentId) fail("OWNERSHIP_UNCONFIRMED", `refusing to remove an unowned ${kind}.`);
    return true;
  };
  return {
    async assertAbsent(config) {
      for (const name of [config.mysqlContainer, config.appContainer, config.network, config.mysqlVolume]) {
        try { await command("docker", ["inspect", name]); fail("RESOURCE_COLLISION", "a requested disposable resource already exists."); }
        catch (error) {
          if (error instanceof RestoreHarnessError && error.code === "COMMAND_FAILED" && error.exitCode === 1) continue;
          throw error;
        }
      }
      try { await fs.lstat(config.sandboxRoot); fail("RESOURCE_COLLISION", "the disposable sandbox already exists."); }
      catch (error) { if (error instanceof RestoreHarnessError) throw error; if (error?.code !== "ENOENT") throw error; }
    },
    async assertPortsAvailable(config) { for (const port of [config.mysqlPort, config.appPort]) await assertPortAvailable(port); },
    async assertRuntime(runtimeDir) { await assertCandidateRuntime(runtimeDir); },
    async verifyArchive(storageTar) {
      await assertGnuTar(command);
      const [listing, verbose] = await Promise.all([
        command("tar", ["--list", "--quoting-style=escape", "--file", storageTar]),
        command("tar", ["--list", "--verbose", "--numeric-owner", "--quoting-style=escape", "--file", storageTar]),
      ]);
      validateTarListing(listing.stdout); validateTarVerboseListing(verbose.stdout);
    },
    async createSandbox(config) { await fs.mkdir(config.sandboxRoot, { recursive: false, mode: 0o700 }); await fs.mkdir(config.storageRoot, { mode: 0o700 }); await fs.writeFile(path.posix.join(config.sandboxRoot, MARKER), JSON.stringify({ environmentId: config.environmentId }), { flag: "wx", mode: 0o600 }); },
    async materializePair(config, pair) { return materializeVerifiedBackupPair(config, pair); },
    async createNetwork(config) { await command("docker", ["network", "create", "--internal", ...labels(config), config.network]); },
    async createVolume(config) { await command("docker", ["volume", "create", ...labels(config), config.mysqlVolume]); },
    async startMySql(config, secrets) { await command("docker", ["run", "-d", "--name", config.mysqlContainer, ...labels(config), "--network", config.network, "--network-alias", "mysql-test", "--publish", `127.0.0.1:${config.mysqlPort}:3306`, "--mount", `type=volume,src=${config.mysqlVolume},dst=/var/lib/mysql`, "--env", `MYSQL_DATABASE=${config.databaseName}`, "--env", "MYSQL_USER=restore_app", "--env", `MYSQL_PASSWORD=${secrets.appPassword}`, "--env", `MYSQL_ROOT_PASSWORD=${secrets.rootPassword}`, config.mysqlImage]); },
    async waitForMySql(config, secrets) { await command("docker", ["exec", "-i", "--env", `MYSQL_PWD=${secrets.rootPassword}`, config.mysqlContainer, "mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", "--silent"]); },
    async restoreDatabase(config, dump, secrets) { await command("docker", ["exec", "-i", "--env", `MYSQL_PWD=${secrets.rootPassword}`, config.mysqlContainer, "mysql", "-uroot"], { input: await fs.readFile(dump) }); },
    async restoreMedia(config, archive) { await command("tar", ["--extract", "--numeric-owner", "--acls", "--xattrs", "--same-owner", "--same-permissions", "--directory", config.storageRoot, "--file", archive]); },
    async verifyMedia(config, archive) { await command("tar", ["--compare", "--numeric-owner", "--acls", "--xattrs", "--directory", config.storageRoot, "--file", archive]); },
    async startApplication(config, environment) { const args = ["run", "-d", "--name", config.appContainer, ...labels(config), "--network", config.network, "--publish", `127.0.0.1:${config.appPort}:3000`, "--read-only", "--tmpfs", "/tmp", "--mount", `type=bind,src=${config.runtimeDir},dst=/app,readonly`, "--mount", `type=bind,src=${config.storageRoot},dst=/opt/megadesk/storage`, ...environment.flatMap(value => ["--env", value]), "node:22.23.2-bookworm-slim", "node", "/app/dist/index.js"]; await command("docker", args); },
    async waitForApplication(config) { await command("docker", ["exec", "-i", config.appContainer, "node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"]); },
    async verifySyntheticReferences(config) {
      await command("docker", ["exec", "-i", "--env", "MEGADESK_RESTORE_PROBE=1", config.appContainer, "node", "/app/dist/operations/restore-synthetic-probe.js"]);
    },
    async cleanup(config, created) {
      if (!created.length) return;
      if (created.includes("app") && await assertLabeledIfPresent("container", config.appContainer, config)) await command("docker", ["rm", "--force", config.appContainer]);
      if (created.includes("mysql") && await assertLabeledIfPresent("container", config.mysqlContainer, config)) await command("docker", ["rm", "--force", config.mysqlContainer]);
      if (created.includes("volume") && await assertLabeledIfPresent("volume", config.mysqlVolume, config)) await command("docker", ["volume", "rm", config.mysqlVolume]);
      if (created.includes("network") && await assertLabeledIfPresent("network", config.network, config)) await command("docker", ["network", "rm", config.network]);
      if (created.includes("sandbox")) {
        try {
          const marker = parseStrictJson(await fs.readFile(path.posix.join(config.sandboxRoot, MARKER)), "Sandbox marker");
          if (marker.environmentId !== config.environmentId) fail("OWNERSHIP_UNCONFIRMED", "sandbox marker does not match the requested environment.");
          await fs.rm(config.sandboxRoot, { recursive: true, force: false });
        } catch (error) { if (error?.code !== "ENOENT") throw error; }
      }
    },
  };
}

export function parseCli(argv) {
  const output = { execute: false };
  const names = { "--environment-id": "environmentId", "--sandbox-root": "sandboxRoot", "--database-name": "databaseName", "--mysql-image": "mysqlImage", "--mysql-port": "mysqlPort", "--app-port": "appPort", "--runtime-dir": "runtimeDir", "--manifest": "manifestPath", "--mysql-dump": "mysqlDump", "--storage-tar": "storageTar" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]; if (token === "--execute") { output.execute = true; continue; }
    const key = names[token]; if (!key) fail("INVALID_ARGUMENT", `unsupported argument: ${token}`);
    const value = argv[++index]; if (!value || value.startsWith("--")) fail("MISSING_ARGUMENT", `missing value for ${token}`); output[key] = value;
  }
  return output;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  if (!options.execute) { process.stdout.write("PLAN_ONLY: add --execute only for an approved named disposable restore environment.\n"); return; }
  if (typeof process.getuid === "function" && process.getuid() !== 0) fail("INSUFFICIENT_PRIVILEGE", "restore harness requires a controlled root-owned Linux restore host to preserve media metadata.");
  const config = validateRestoreConfig(options); const pair = await verifyBackupPair(options);
  const result = await runRestoreWorkflow({ config, pair, dependencies: createDockerDependencies() });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch(error => {
  process.stderr.write(`RESTORE_HARNESS_FAILED=${sanitizeError(error).code}\n`); process.exitCode = 1;
});
