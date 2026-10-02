import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chmod, chown, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import mysql from "mysql2/promise";
import { constants, logicalFingerprint, storageSnapshot } from "./oracle-main-promotion.mjs";
import { mergeStorage } from "./storage-merge.mjs";
import { stableValue } from "./reconciler.mjs";

const GATE_ID = String(process.env.MEGADESK_PROMOTION_REHEARSAL_GATE_ID ?? "");
const CONFIGURED_DISPOSABLE = GATE_ID.length > 0;
const configured = (name, fallback) => CONFIGURED_DISPOSABLE ? String(process.env[name] ?? "") : fallback;
const MYSQL_CONTAINER = configured("MEGADESK_PROMOTION_REHEARSAL_MYSQL_CONTAINER", "megadesk-test-main-promotion-mysql-20261002");
const APP_CONTAINER = configured("MEGADESK_PROMOTION_REHEARSAL_APP_CONTAINER", "megadesk-test-main-promotion-app-20261002");
const VOLUME = configured("MEGADESK_PROMOTION_REHEARSAL_VOLUME", "megadesk_test_main_promotion_mysql_data_20261002");
const NETWORK = configured("MEGADESK_PROMOTION_REHEARSAL_NETWORK", "megadesk_test_main_promotion_net_20261002");
const PORT = Number(configured("MEGADESK_PROMOTION_REHEARSAL_PORT", "33329"));
const MYSQL_HOST = configured("MEGADESK_PROMOTION_REHEARSAL_MYSQL_HOST", "127.0.0.1");
const IMAGE = "mysql@sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b";
const IMAGE_ID = "sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b";
const ROOT = resolve(configured("MEGADESK_PROMOTION_REHEARSAL_ROOT", resolve(os.tmpdir(), constants.REHEARSAL_ROOT_SUFFIX)));
const PASSWORD = configured("MEGADESK_PROMOTION_REHEARSAL_PASSWORD", "Synthetic_OracleMain_9479c73f_2026_ONLY");
const TARGET_DB = configured("MEGADESK_PROMOTION_REHEARSAL_DATABASE", "megadesk_test_main_promotion_main_9479c73f");
const CANDIDATE_DB = CONFIGURED_DISPOSABLE ? `${TARGET_DB}_c` : "megadesk_test_main_promotion_candidate_9479c73f";
const BACKUP_VERIFY_DB = CONFIGURED_DISPOSABLE ? `${TARGET_DB}_b` : "megadesk_test_main_promotion_backup_verify_9479c73f";
const CANDIDATE_VERIFY_DB = CONFIGURED_DISPOSABLE ? `${TARGET_DB}_v` : "megadesk_test_main_promotion_candidate_verify_9479c73f";
const LABELS = {
  "megadesk.test.gate": "oracle-main-promotion-wrapper",
  "megadesk.test.boundary": constants.EXPECTED_FREEZE_BOUNDARY,
};
const EVIDENCE = configured("MEGADESK_PROMOTION_REHEARSAL_EVIDENCE_ROOT", "C:/Users/Marcelo Moura/AppData/Local/MegaDesk/backups/oracle-staging-rehearsal-9479c73f-20261002T031137842Z");
const WINDOWS_MEDIA = configured("MEGADESK_PROMOTION_REHEARSAL_MEDIA_ROOT", "C:/Users/Marcelo Moura/AppData/Local/MegaDesk/media");
const PRE_DUMP = join(EVIDENCE, "promotion-main-pre-0034.sql");
const ORIGINAL_CANDIDATE_DUMP = join(EVIDENCE, "candidate-0036-reconciled.sql");
const ORACLE_ARCHIVE = join(EVIDENCE, "oracle-storage-current.tar.gz");
const ORACLE_MANIFEST = join(EVIDENCE, "oracle-storage-final.tsv");
const WINDOWS_MANIFEST = join(EVIDENCE, "windows-storage-final.csv");
const TARGET_STORAGE = resolve(configured("MEGADESK_PROMOTION_REHEARSAL_STORAGE_ROOT", join(ROOT, "target-storage")));
const CANDIDATE_STORAGE = CONFIGURED_DISPOSABLE ? join(ROOT, "candidate") : join(ROOT, "candidate-storage");
const ORACLE_SOURCE = join(ROOT, "oracle-source");
const CANDIDATE_DUMP = join(ROOT, "candidate-0036-reconciled.sql");
const BACKUPS_ROOT = CONFIGURED_DISPOSABLE ? join(ROOT, "backups") : null;
const OPERATIONS_ROOT = CONFIGURED_DISPOSABLE ? join(ROOT, "operations") : join(ROOT, "operations");
const WRAPPER = resolve("scripts/reconciliation/oracle-main-promotion.mjs");
const REHEARSAL = resolve("scripts/reconciliation/oracle-main-promotion-rehearsal.mjs");
const PROTECTED = ["megadesk-local-mysql", "megadesk-evolution", "megadesk-evolution-db"];
const EXPECTED_PRE_DB = "e11182b204dfb104231ac4e03854b6bed88fc18fc7595291a830a87323252418";
const EXPECTED_PRE_STORAGE = "232f0b11ca3706c6a16c2d5678c334077b4f5a01818a4fcbbadb4c2fb27e870f";
const scope = process.env.MEGADESK_PROMOTION_REHEARSAL_SCOPE ?? "target-toctou";
const BOUND_CASE = CONFIGURED_DISPOSABLE ? String(process.env.MEGADESK_PROMOTION_REHEARSAL_BOUND_CASE ?? "") : "";
const PROMOTION_UID = 65534;
const PROMOTION_GID = 65534;
const ATTACKER_UID = 65533;
const ATTACKER_GID = 65533;

const sha256 = value => createHash("sha256").update(value).digest("hex");
const canonical = value => JSON.stringify(stableValue(value));
const quote = value => `\`${String(value).replaceAll("`", "``")}\``;
const summary = {
  cleanCycles: 0,
  cleanRollbacks: 0,
  failureInjections: [],
  misTargetTests: [],
  concurrentResult: null,
  corruptJournalResult: null,
  toctouTests: [],
  storageBindingPlatform: null,
  trustedBoundary: { attacks: [], rollbackAttack: null, concurrency: null },
  resources: { created: [], removed: [] },
};
let created = { mysql: null, app: null, volume: false, network: false, root: false };

function fail(message) { throw new Error(message); }
function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", windowsHide: true, ...options });
  if (result.status !== 0) fail(`Scoped Docker command failed: ${args.slice(0, 3).join(" ")}`);
  return String(result.stdout ?? "").trim();
}
function dockerExists(kind, name) {
  const args = kind === "container" ? ["container", "inspect", name] : [kind, "inspect", name];
  return spawnSync("docker", args, { stdio: "ignore", windowsHide: true }).status === 0;
}
function inspect(name) {
  const value = JSON.parse(docker(["inspect", name]))[0];
  return {
    id: value.Id,
    name: String(value.Name).replace(/^\//, ""),
    imageId: value.Image,
    restartCount: Number(value.RestartCount),
    running: value.State?.Running === true,
    health: value.State?.Health?.Status ?? "none",
    labels: value.Config?.Labels ?? {},
    networks: Object.fromEntries(Object.entries(value.NetworkSettings?.Networks ?? {}).map(([name, network]) => [name, {
      id: network.NetworkID,
      ipAddress: network.IPAddress,
    }])),
  };
}

async function portIsFree() {
  return new Promise(resolvePromise => {
    const server = net.createServer();
    server.once("error", () => resolvePromise(false));
    server.listen(PORT, "127.0.0.1", () => server.close(() => resolvePromise(true)));
  });
}

async function waitForMysql() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (CONFIGURED_DISPOSABLE) {
      try {
        const connection = await rootConnection();
        await connection.query("SELECT 1");
        await connection.end();
        return;
      } catch {}
      await new Promise(resolvePromise => setTimeout(resolvePromise, 500));
      continue;
    }
    const result = spawnSync("docker", ["exec", "-e", `MYSQL_PWD=${PASSWORD}`, MYSQL_CONTAINER, "mysql", "-uroot", "-Nse", "SELECT 1"], {
      stdio: "ignore", windowsHide: true, env: { ...process.env, MYSQL_PWD: PASSWORD },
    });
    if (result.status === 0) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 500));
  }
  fail("Disposable MySQL did not become ready.");
}

function connection(database = TARGET_DB) {
  return mysql.createConnection({ host: MYSQL_HOST, port: PORT, user: "root", password: PASSWORD, database, timezone: "Z", dateStrings: true });
}

async function rootConnection() {
  return mysql.createConnection({ host: MYSQL_HOST, port: PORT, user: "root", password: PASSWORD, timezone: "Z", dateStrings: true });
}

async function restoreDump(database, path) {
  const bytes = await readFile(path);
  const body = bytes.toString("utf8").split(/\r?\n/)
    .filter(line => !/^CREATE DATABASE /.test(line) && !/^USE `[^`]+`;\s*$/.test(line)).join("\n");
  const prefix = `DROP DATABASE IF EXISTS ${quote(database)};\nCREATE DATABASE ${quote(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\nUSE ${quote(database)};\n`;
  if (CONFIGURED_DISPOSABLE) {
    const connection = await mysql.createConnection({ host: MYSQL_HOST, port: PORT, user: "root", password: PASSWORD, timezone: "Z", dateStrings: true, multipleStatements: true });
    try { await connection.query(`${prefix}${body}`); }
    catch { fail(`Disposable direct restore failed for ${database}.`); }
    finally { await connection.end(); }
    return;
  }
  await new Promise((resolvePromise, reject) => {
    let stderr = "";
    const child = spawn("docker", ["exec", "-i", "-e", `MYSQL_PWD=${PASSWORD}`, MYSQL_CONTAINER, "mysql", "-uroot", "--default-character-set=utf8mb4"], {
      stdio: ["pipe", "ignore", "pipe"], windowsHide: true, env: { ...process.env, MYSQL_PWD: PASSWORD },
    });
    child.stderr.on("data", value => { stderr += value.toString("utf8"); });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) return resolvePromise();
      const errorLine = stderr.split(/\r?\n/).find(line => /error|denied|failed|unknown/i.test(line)) ?? "";
      const diagnostic = errorLine.match(/ERROR\s+\d+(?:\s+\([^)]+\))?(?:\s+at line\s+\d+)?/i)?.[0]
        ?? `MYSQL_ERROR_REDACTED_SHA256_${sha256(stderr).slice(0, 16)}_BYTES_${Buffer.byteLength(stderr)}`;
      reject(new Error(`Disposable restore failed for ${database}: ${diagnostic}.`));
    });
    child.stdin.end(Buffer.from(`${prefix}${body}`));
  });
}

async function databaseIdentity(database) {
  const c = await connection(database);
  try {
    const [s] = await c.query("SELECT @@server_uuid serverUuid,@@version version,DATABASE() databaseName");
    const [m] = await c.query("SELECT COUNT(*) count,MAX(created_at) lastCreatedAt FROM __drizzle_migrations");
    return {
      serverUuid: String(s[0].serverUuid), version: String(s[0].version), database: String(s[0].databaseName),
      migrationCount: Number(m[0].count), lastCreatedAt: String(m[0].lastCreatedAt),
    };
  } finally { await c.end(); }
}

async function directoryIdentity(path) {
  const info = await stat(path);
  return { device: String(info.dev), inode: String(info.ino), realPath: await realpath(path) };
}

function sameDirectoryIdentity(left, right) {
  return left && right && left.device === right.device && left.inode === right.inode
    && resolve(left.realPath) === resolve(right.realPath);
}

async function chownPromotionTree(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) fail("Trusted-boundary fixture refuses symbolic links.");
  await chown(path, PROMOTION_UID, PROMOTION_GID);
  if (info.isDirectory()) {
    await chmod(path, 0o700);
    for (const entry of await readdir(path, { withFileTypes: true })) await chownPromotionTree(join(path, entry.name));
  } else if (info.isFile()) {
    await chmod(path, 0o600);
  } else {
    fail("Trusted-boundary fixture accepts only regular files and directories.");
  }
}

async function establishTrustedBoundaryFixture() {
  if (!CONFIGURED_DISPOSABLE) return;
  if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() !== 0) {
    fail("Configured trusted-boundary rehearsal requires a root Linux control plane.");
  }
  await chmod(ROOT, 0o755);
  await mkdir(BACKUPS_ROOT, { recursive: true, mode: 0o700 });
  await mkdir(OPERATIONS_ROOT, { recursive: true, mode: 0o700 });
  for (const path of [TARGET_STORAGE, CANDIDATE_STORAGE, BACKUPS_ROOT, OPERATIONS_ROOT]) await chownPromotionTree(path);
  await chown(CANDIDATE_DUMP, PROMOTION_UID, PROMOTION_GID);
  await chmod(CANDIDATE_DUMP, 0o600);
  const root = await lstat(ROOT);
  if (root.uid !== 0 || (root.mode & 0o022) !== 0) fail("Trusted-boundary parent is not root-owned and non-writable.");
}

async function currentHostIdentity() {
  const material = `${os.hostname()}|${os.platform()}|${os.arch()}`;
  return { hostname: os.hostname(), platform: os.platform(), arch: os.arch(), machineIdSha256: sha256(material) };
}

async function resetTarget() {
  await restoreDump(TARGET_DB, PRE_DUMP);
  await rm(TARGET_STORAGE, { recursive: true, force: true });
  await cp(ORACLE_SOURCE, TARGET_STORAGE, { recursive: true, force: false, errorOnExist: true });
  const db = await logicalFingerprint(`mysql://root@${MYSQL_HOST}:${PORT}/${TARGET_DB}`, PASSWORD);
  const storage = await storageSnapshot(TARGET_STORAGE);
  if (db !== EXPECTED_PRE_DB || storage.fingerprint !== EXPECTED_PRE_STORAGE) {
    fail(`Disposable pre-state reset mismatch: database=${db};storage=${storage.fingerprint}.`);
  }
  await establishTrustedBoundaryFixture();
}

function inspectProtected() {
  if (CONFIGURED_DISPOSABLE) {
    return { runnerDockerSocket: "absent", namespace: "isolated-disposable" };
  }
  return Object.fromEntries(PROTECTED.map(name => {
    const item = inspect(name);
    return [name, { id: item.id, running: item.running, health: item.health, restartCount: item.restartCount }];
  }));
}

async function setup() {
  const configuredNames = /^oracle-toctou-linux-20261002-[a-z0-9]{8,16}$/.test(GATE_ID)
    && MYSQL_CONTAINER === `megadesk-test-${GATE_ID}-mysql`
    && APP_CONTAINER === `megadesk-test-${GATE_ID}-app`
    && VOLUME === `megadesk_test_${GATE_ID.replaceAll("-", "_")}_mysql_data`
    && NETWORK === `megadesk-test-${GATE_ID}-net`
    && TARGET_DB === `megadesk_test_${GATE_ID.replaceAll("-", "_")}`
    && ROOT === `/tmp/megadesk-${GATE_ID}`
    && TARGET_STORAGE === join(ROOT, "target")
    && CANDIDATE_STORAGE === join(ROOT, "candidate")
    && BACKUPS_ROOT === join(ROOT, "backups")
    && OPERATIONS_ROOT === join(ROOT, "operations")
    && EVIDENCE === "/fixtures/evidence"
    && WINDOWS_MEDIA === "/fixtures/media"
    && MYSQL_HOST === "host.docker.internal"
    && PORT === 33330
    && /^[A-Za-z0-9_-]{32,}$/.test(PASSWORD)
    && [TARGET_DB, CANDIDATE_DB, BACKUP_VERIFY_DB, CANDIDATE_VERIFY_DB].every(name => name.length <= 64);
  const legacyNames = /^megadesk-test-main-promotion-[a-z0-9-]+$/.test(MYSQL_CONTAINER)
    && /^megadesk-test-main-promotion-[a-z0-9-]+$/.test(APP_CONTAINER)
    && /^megadesk_test_main_promotion_[a-z0-9_]+$/.test(TARGET_DB)
    && resolve(ROOT) === resolve(os.tmpdir(), constants.REHEARSAL_ROOT_SUFFIX);
  if (CONFIGURED_DISPOSABLE ? !configuredNames : !legacyNames) fail("Disposable names, roots, port, or synthetic credentials failed validation.");
  if (await lstat(ROOT).then(() => true, () => false)) fail("Disposable root already exists.");
  if (CONFIGURED_DISPOSABLE) {
    if (await lstat("/var/run/docker.sock").then(() => true, () => false)) fail("Runner Docker socket must be absent.");
    await waitForMysql();
    await mkdir(ROOT, { recursive: false }); created.root = true;
    await prepareRehearsalArtifacts();
    return;
  }
  if (!await portIsFree()) fail(`Disposable port ${PORT} is not free.`);
  for (const [kind, name] of [["container", MYSQL_CONTAINER], ["container", APP_CONTAINER], ["volume", VOLUME], ["network", NETWORK]]) {
    if (dockerExists(kind, name)) fail(`Disposable ${kind} already exists: ${name}`);
  }
  if (docker(["image", "inspect", IMAGE, "--format", "{{.Id}}"]) !== IMAGE_ID) fail("Pinned MySQL image identity mismatch.");
  await mkdir(ROOT, { recursive: false }); created.root = true;
  docker(["network", "create", "--label", `megadesk.test.gate=${LABELS["megadesk.test.gate"]}`, "--label", `megadesk.test.boundary=${LABELS["megadesk.test.boundary"]}`, NETWORK]);
  created.network = true; summary.resources.created.push(`network:${NETWORK}`);
  docker(["volume", "create", "--label", `megadesk.test.gate=${LABELS["megadesk.test.gate"]}`, "--label", `megadesk.test.boundary=${LABELS["megadesk.test.boundary"]}`, VOLUME]);
  created.volume = true; summary.resources.created.push(`volume:${VOLUME}`);
  const mysqlId = startDisposableMysql();
  created.mysql = mysqlId; summary.resources.created.push(`container:${MYSQL_CONTAINER}`);
  await waitForMysql();
  const appId = startDisposableApp();
  created.app = appId; summary.resources.created.push(`container:${APP_CONTAINER}`);

  await prepareRehearsalArtifacts();
}

async function prepareRehearsalArtifacts() {
  await mkdir(ORACLE_SOURCE, { recursive: true });
  const extract = spawnSync("tar", ["-xzf", ORACLE_ARCHIVE, "-C", ORACLE_SOURCE], { stdio: "ignore", windowsHide: true });
  if (extract.status !== 0) fail("Oracle storage extraction failed.");
  await cp(ORIGINAL_CANDIDATE_DUMP, CANDIDATE_DUMP, { force: false, errorOnExist: true });
  await restoreDump(CANDIDATE_DB, CANDIDATE_DUMP);
  await mkdir(CANDIDATE_STORAGE, { recursive: false });
  const previousIsolatedRunner = process.env.MEGADESK_PROMOTION_ISOLATED_REHEARSAL;
  process.env.STORAGE_TARGET_DATABASE_PASSWORD = PASSWORD;
  if (CONFIGURED_DISPOSABLE) process.env.MEGADESK_PROMOTION_ISOLATED_REHEARSAL = "YES";
  try {
    await mergeStorage({
      windowsManifest: WINDOWS_MANIFEST,
      oracleManifest: ORACLE_MANIFEST,
      windowsRoot: WINDOWS_MEDIA,
      oracleRoot: ORACLE_SOURCE,
      targetRoot: CANDIDATE_STORAGE,
      reportFile: join(ROOT, "candidate-storage-merge-report.json"),
      databaseUrl: `mysql://root:${encodeURIComponent(PASSWORD)}@${MYSQL_HOST}:${PORT}/${CANDIDATE_DB}`,
       isolatedLinuxRunner: CONFIGURED_DISPOSABLE,
    });
  } finally {
    delete process.env.STORAGE_TARGET_DATABASE_PASSWORD;
    if (previousIsolatedRunner === undefined) delete process.env.MEGADESK_PROMOTION_ISOLATED_REHEARSAL;
    else process.env.MEGADESK_PROMOTION_ISOLATED_REHEARSAL = previousIsolatedRunner;
  }
  const candidateDb = await logicalFingerprint(`mysql://root@${MYSQL_HOST}:${PORT}/${CANDIDATE_DB}`, PASSWORD);
  const candidateStorage = await storageSnapshot(CANDIDATE_STORAGE);
  if (candidateDb !== constants.APPROVED_DATABASE_FINGERPRINT || candidateStorage.fingerprint !== constants.APPROVED_STORAGE_MANIFEST) {
    fail("Approved candidate could not be reproduced in the disposable environment.");
  }
  await resetTarget();
}

async function cleanup() {
  if (CONFIGURED_DISPOSABLE) {
    if (created.root && await lstat(ROOT).then(() => true, () => false)) {
      if (resolve(ROOT) !== resolve(`/tmp/megadesk-${GATE_ID}`)) fail("Refused cleanup of ambiguous temporary root.");
      await rm(ROOT, { recursive: true, force: false });
      created.root = false;
      summary.resources.removed.push(`root:${ROOT}`);
    }
    return;
  }
  for (const [name, id, key] of [[APP_CONTAINER, created.app, "app"], [MYSQL_CONTAINER, created.mysql, "mysql"]]) {
    if (!id || !dockerExists("container", name)) continue;
    const item = inspect(name);
    if (item.id !== id || item.labels["megadesk.test.gate"] !== LABELS["megadesk.test.gate"]
        || item.labels["megadesk.test.boundary"] !== LABELS["megadesk.test.boundary"]) fail(`Refused cleanup of ambiguous container ${name}.`);
    docker(["rm", "-f", name]); created[key] = null; summary.resources.removed.push(`container:${name}`);
  }
  if (created.volume && dockerExists("volume", VOLUME)) {
    const labels = JSON.parse(docker(["volume", "inspect", VOLUME]))[0].Labels ?? {};
    if (labels["megadesk.test.gate"] !== LABELS["megadesk.test.gate"] || labels["megadesk.test.boundary"] !== LABELS["megadesk.test.boundary"]) fail("Refused cleanup of ambiguous volume.");
    docker(["volume", "rm", VOLUME]); created.volume = false; summary.resources.removed.push(`volume:${VOLUME}`);
  }
  if (created.network && dockerExists("network", NETWORK)) {
    const labels = JSON.parse(docker(["network", "inspect", NETWORK]))[0].Labels ?? {};
    if (labels["megadesk.test.gate"] !== LABELS["megadesk.test.gate"] || labels["megadesk.test.boundary"] !== LABELS["megadesk.test.boundary"]) fail("Refused cleanup of ambiguous network.");
    docker(["network", "rm", NETWORK]); created.network = false; summary.resources.removed.push(`network:${NETWORK}`);
  }
  if (created.root && await lstat(ROOT).then(() => true, () => false)) {
    const expectedRoot = CONFIGURED_DISPOSABLE ? `/tmp/megadesk-${GATE_ID}` : resolve(os.tmpdir(), constants.REHEARSAL_ROOT_SUFFIX);
    if (resolve(ROOT) !== resolve(expectedRoot)) fail("Refused cleanup of ambiguous temporary root.");
    await rm(ROOT, { recursive: true, force: false }); created.root = false; summary.resources.removed.push(`root:${ROOT}`);
  }
}

function wrapperEnvironment(fixture, extra = {}) {
  return {
    ...process.env,
    MEGADESK_PROMOTION_MODE: "oracle-main-shaped-disposable",
    MEGADESK_PROMOTION_ALLOW_DISPOSABLE: "YES",
    ...(CONFIGURED_DISPOSABLE ? { MEGADESK_PROMOTION_ISOLATED_REHEARSAL: "YES" } : {}),
    MEGADESK_PROMOTION_AUTHORIZATION_FILE: fixture.authorizationPath,
    MEGADESK_PROMOTION_AUTHORIZATION_SHA256: fixture.authorizationSha256,
    MEGADESK_PROMOTION_PUBLIC_KEY_FILE: fixture.publicKeyPath,
    MEGADESK_PROMOTION_PUBLIC_KEY_SHA256: fixture.publicKeySha256,
    MEGADESK_PROMOTION_OPERATION_ID: fixture.payload.operationId,
    MEGADESK_PROMOTION_AUTHORIZATION_ID: fixture.payload.authorizationId,
    MEGADESK_PROMOTION_HUMAN_AUTHORIZATION: fixture.humanAuthorization,
    MEGADESK_PROMOTION_DATABASE_PASSWORD: PASSWORD,
    ...extra,
  };
}

function runWrapper(action, fixture, extra = {}) {
  const identity = CONFIGURED_DISPOSABLE ? { uid: PROMOTION_UID, gid: PROMOTION_GID } : {};
  const result = spawnSync(process.execPath, [WRAPPER, action], { encoding: "utf8", windowsHide: true, env: wrapperEnvironment(fixture, extra), ...identity });
  let output = null;
  try { output = JSON.parse(String((result.status === 0 ? result.stdout : result.stderr) ?? "").trim().split(/\r?\n/).at(-1)); } catch { output = { code: "UNPARSEABLE" }; }
  return { status: result.status, output };
}

function spawnWrapper(action, fixture, extra = {}) {
  const identity = CONFIGURED_DISPOSABLE ? { uid: PROMOTION_UID, gid: PROMOTION_GID } : {};
  return spawn(process.execPath, [WRAPPER, action], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: wrapperEnvironment(fixture, extra), ...identity });
}

async function pathExists(path) {
  try { await lstat(path); return true; } catch { return false; }
}

async function clearStaleFixtureLock(fixture) {
  const expectedLock = CONFIGURED_DISPOSABLE ? join(OPERATIONS_ROOT, "global-promotion.lock") : join(ROOT, "global-promotion.lock");
  if (!CONFIGURED_DISPOSABLE || resolve(fixture.payload.paths.lock) !== resolve(expectedLock)) {
    fail("Refused cleanup of a non-disposable or non-canonical promotion lock.");
  }
  const lock = fixture.payload.paths.lock;
  if (!await pathExists(lock)) return;
  let owner;
  try { owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8")); }
  catch { fail("Refused cleanup of an unreadable disposable promotion lock."); }
  if (owner.operationId !== fixture.payload.operationId || owner.authorizationId !== fixture.payload.authorizationId
      || !Number.isInteger(owner.pid) || owner.pid <= 0) {
    fail("Refused cleanup of a promotion lock not owned by the current disposable fixture.");
  }
  try {
    process.kill(owner.pid, 0);
    fail("Refused cleanup of an active disposable promotion lock.");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  await rm(lock, { recursive: true, force: false });
}

async function waitForPath(path, label, child, diagnostic, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (!await pathExists(path)) {
    if (child.exitCode !== null) {
      let output = { code: "UNPARSEABLE", message: "" };
      try { output = JSON.parse((child.exitCode === 0 ? diagnostic.stdout : diagnostic.stderr).trim().split(/\r?\n/).at(-1)); } catch {}
      fail(`Disposable test hook ${label} process exited first: ${output.code};${output.message ?? ""}`);
    }
    if (Date.now() >= deadline) fail(`Timed out waiting for disposable test hook ${label}.`);
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
}

async function runAtHook(action, fixture, point, mutate) {
  const hookRoot = join(fixture.operationRoot, "toctou-hooks");
  const child = spawnWrapper(action, fixture, {
    MEGADESK_PROMOTION_TEST_HOOK: point,
    MEGADESK_PROMOTION_TEST_HOOK_ROOT: hookRoot,
  });
  const diagnostic = { stdout: "", stderr: "" };
  child.stdout.on("data", value => { diagnostic.stdout += value.toString("utf8"); });
  child.stderr.on("data", value => { diagnostic.stderr += value.toString("utf8"); });
  await waitForPath(join(hookRoot, `${point}.ready`), point, child, diagnostic);
  await mutate();
  await writeFile(join(hookRoot, `${point}.continue`), "continue\n", { flag: "wx", mode: 0o600 });
  return waitChild(child);
}

async function runBoundaryAttacker(operation) {
  if (!CONFIGURED_DISPOSABLE) fail("Boundary attacker is allowed only in the configured disposable Linux rehearsal.");
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [REHEARSAL, "boundary-attack", operation], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      uid: ATTACKER_UID,
      gid: ATTACKER_GID,
      env: {
        MEGADESK_PROMOTION_REHEARSAL_GATE_ID: GATE_ID,
        MEGADESK_PROMOTION_ISOLATED_REHEARSAL: "YES",
      },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", value => { stdout += value.toString("utf8"); });
    child.stderr.on("data", value => { stderr += value.toString("utf8"); });
    child.on("error", reject);
    child.on("close", status => {
      let output;
      try { output = JSON.parse((status === 0 ? stdout : stderr).trim().split(/\r?\n/).at(-1)); } catch { output = { result: "UNPARSEABLE" }; }
      resolvePromise({ status, output });
    });
  });
}

async function boundaryAttackerMain(operation) {
  if (!CONFIGURED_DISPOSABLE || process.platform !== "linux" || process.env.MEGADESK_PROMOTION_ISOLATED_REHEARSAL !== "YES"
      || typeof process.getuid !== "function" || process.getuid() !== ATTACKER_UID) {
    fail("Boundary attacker is unavailable outside its exact disposable identity.");
  }
  if (!new Set(["symlink", "removal", "directory-replacement", "inode-replacement"]).has(operation)) {
    fail("Boundary attacker operation is not approved.");
  }
  const displaced = join(ROOT, `attacker-${operation}-${randomUUID()}`);
  try {
    if (operation === "symlink") {
      await rename(TARGET_STORAGE, displaced);
      await symlink(displaced, TARGET_STORAGE, "dir");
    } else if (operation === "removal") {
      await rm(TARGET_STORAGE, { recursive: true, force: false });
    } else if (operation === "directory-replacement") {
      await rename(TARGET_STORAGE, displaced);
      await mkdir(TARGET_STORAGE, { recursive: false, mode: 0o700 });
    } else {
      await writeFile(join(TARGET_STORAGE, `attacker-inode-${randomUUID()}.probe`), "probe", { flag: "wx", mode: 0o600 });
    }
    process.stdout.write(`${JSON.stringify({ result: "MUTATED", operation })}\n`);
    process.exitCode = 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ result: "DENIED", operation, code: error?.code ?? "UNEXPECTED" })}\n`);
  }
}

function startDisposableApp() {
  return docker(["run", "-d", "--name", APP_CONTAINER, "--network", NETWORK,
    "--label", `megadesk.test.gate=${LABELS["megadesk.test.gate"]}`, "--label", `megadesk.test.boundary=${LABELS["megadesk.test.boundary"]}`,
    "--entrypoint", "sh", IMAGE, "-c", "sleep 86400"]);
}

function startDisposableMysql() {
  return docker(["run", "-d", "--name", MYSQL_CONTAINER, "--network", NETWORK, "-p", `127.0.0.1:${PORT}:3306`,
    "--label", `megadesk.test.gate=${LABELS["megadesk.test.gate"]}`, "--label", `megadesk.test.boundary=${LABELS["megadesk.test.boundary"]}`,
    "-e", `MYSQL_ROOT_PASSWORD=${PASSWORD}`, "-v", `${VOLUME}:/var/lib/mysql`, IMAGE]);
}

async function waitChild(child) {
  return new Promise((resolvePromise, reject) => {
    let stdout = "", stderr = "";
    child.stdout.on("data", value => { stdout += value.toString("utf8"); });
    child.stderr.on("data", value => { stderr += value.toString("utf8"); });
    child.on("error", reject);
    child.on("close", code => {
      let output;
      try { output = JSON.parse((code === 0 ? stdout : stderr).trim().split(/\r?\n/).at(-1)); } catch { output = { code: "UNPARSEABLE" }; }
      resolvePromise({ status: code, output });
    });
  });
}

async function createAuthorization(label, mutate = value => value) {
  const operationId = randomUUID(), authorizationId = randomUUID();
  const operationRoot = join(OPERATIONS_ROOT, `${label}-${operationId}`);
  const stateRoot = join(operationRoot, "state");
  await mkdir(stateRoot, { recursive: true });
  const mysqlContainer = CONFIGURED_DISPOSABLE
    ? { id: String(process.env.MEGADESK_PROMOTION_REHEARSAL_MYSQL_CONTAINER_ID ?? ""), name: MYSQL_CONTAINER, imageId: String(process.env.MEGADESK_PROMOTION_REHEARSAL_MYSQL_IMAGE_ID ?? ""), restartCount: 0, labels: LABELS }
    : inspect(MYSQL_CONTAINER);
  const appContainer = CONFIGURED_DISPOSABLE ? null : inspect(APP_CONTAINER);
  const network = CONFIGURED_DISPOSABLE
    ? { id: String(process.env.MEGADESK_PROMOTION_REHEARSAL_NETWORK_ID ?? ""), ipAddress: "control-plane" }
    : mysqlContainer.networks[NETWORK];
  if (CONFIGURED_DISPOSABLE && (!/^[a-f0-9]{64}$/.test(mysqlContainer.id) || !/^sha256:[a-f0-9]{64}$/.test(mysqlContainer.imageId) || !/^[a-f0-9]{64}$/.test(network.id))) {
    fail("Control-plane identity evidence is invalid.");
  }
  const preDbIdentity = await databaseIdentity(TARGET_DB);
  const candidateDbIdentity = await databaseIdentity(CANDIDATE_DB);
  const preStorage = await storageSnapshot(TARGET_STORAGE);
  const candidateStorage = await storageSnapshot(CANDIDATE_STORAGE);
  const storageIdentity = await directoryIdentity(TARGET_STORAGE);
  const parentIdentity = await directoryIdentity(dirname(TARGET_STORAGE));
  const humanAuthorization = `synthetic-${randomUUID()}-${randomUUID()}`;
  const payload = mutate({
    operationId,
    authorizationId,
    issuedAt: new Date(Date.now() - 5_000).toISOString(),
    expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
    singleUse: true,
    allowedActions: ["verify", "promote", "recover", "rollback"],
    freezeBoundaryId: constants.EXPECTED_FREEZE_BOUNDARY,
    humanAuthorizationSha256: sha256(humanAuthorization),
    lock: { maxStaleAgeMs: 7_200_000 },
    target: {
      class: CONFIGURED_DISPOSABLE ? "oracle-main-isolated-rehearsal" : "oracle-main-shaped-disposable",
      host: await currentHostIdentity(),
      mysql: {
        url: `mysql://root@${MYSQL_HOST}:${PORT}/${TARGET_DB}`,
        user: "root",
        database: TARGET_DB,
        serverUuid: preDbIdentity.serverUuid,
        version: preDbIdentity.version,
        network: { name: NETWORK, id: network.id, ipAddress: network.ipAddress },
        container: { name: MYSQL_CONTAINER, id: mysqlContainer.id, imageId: mysqlContainer.imageId, restartCount: mysqlContainer.restartCount, labels: LABELS },
      },
      application: CONFIGURED_DISPOSABLE ? null : { container: { name: APP_CONTAINER, id: appContainer.id, imageId: appContainer.imageId, restartCount: appContainer.restartCount, labels: LABELS } },
      storage: { root: TARGET_STORAGE, ...storageIdentity, parent: parentIdentity },
    },
    ...(CONFIGURED_DISPOSABLE ? {
      rehearsal: {
        kind: "megadesk-isolated-linux-runner-rehearsal",
        version: 1,
        runId: GATE_ID,
        databaseTransport: "mysql2-direct",
        port: PORT,
        network: NETWORK,
        volume: VOLUME,
      },
    } : {}),
    preState: {
      database: { ...preDbIdentity, fingerprint: EXPECTED_PRE_DB },
      storage: { fingerprint: preStorage.fingerprint, files: preStorage.files, bytes: preStorage.bytes },
    },
    candidate: {
      database: {
        fingerprint: constants.APPROVED_DATABASE_FINGERPRINT,
        dump: { path: CANDIDATE_DUMP, sha256: await fileHash(CANDIDATE_DUMP) },
        identity: { ...candidateDbIdentity, database: TARGET_DB },
      },
      storage: { root: CANDIDATE_STORAGE, fingerprint: candidateStorage.fingerprint, files: candidateStorage.files, bytes: candidateStorage.bytes },
    },
    backup: {
      database: { path: join(CONFIGURED_DISPOSABLE ? BACKUPS_ROOT : operationRoot, `${label}-${operationId}`, "main.sql") },
      storage: { root: join(CONFIGURED_DISPOSABLE ? BACKUPS_ROOT : operationRoot, `${label}-${operationId}`, "storage") },
    },
    verification: { backupDatabase: BACKUP_VERIFY_DB, candidateDatabase: CANDIDATE_VERIFY_DB, storageRoot: join(operationRoot, "verify-storage") },
    paths: {
      allowedRoot: ROOT,
      stateRoot,
      lock: CONFIGURED_DISPOSABLE ? join(OPERATIONS_ROOT, "global-promotion.lock") : join(ROOT, "global-promotion.lock"),
      journal: join(stateRoot, "journal.json"),
      usedAuthorizations: CONFIGURED_DISPOSABLE ? join(OPERATIONS_ROOT, "used-authorizations") : join(ROOT, "used-authorizations"),
    },
  });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signature = sign(null, Buffer.from(canonical(payload)), privateKey).toString("base64");
  const authorization = { kind: constants.AUTH_KIND, version: constants.AUTH_VERSION, payload, signature };
  const publicBytes = Buffer.from(publicKey.export({ type: "spki", format: "pem" }));
  const authorizationBytes = Buffer.from(`${JSON.stringify(authorization, null, 2)}\n`);
  const publicKeyPath = join(operationRoot, "public.pem"), authorizationPath = join(operationRoot, "authorization.json");
  await writeFile(publicKeyPath, publicBytes, { mode: 0o600 });
  await writeFile(authorizationPath, authorizationBytes, { mode: 0o600 });
  if (CONFIGURED_DISPOSABLE) await chownPromotionTree(operationRoot);
  return { payload, humanAuthorization, operationRoot, publicKeyPath, authorizationPath, publicKeySha256: sha256(publicBytes), authorizationSha256: sha256(authorizationBytes) };
}

async function fileHash(path) { return sha256(await readFile(path)); }

async function assertTarget(expectedDb, expectedStorage) {
  const db = await logicalFingerprint(`mysql://root@${MYSQL_HOST}:${PORT}/${TARGET_DB}`, PASSWORD);
  const storage = (await storageSnapshot(TARGET_STORAGE)).fingerprint;
  if (db !== expectedDb || storage !== expectedStorage) fail(`Target verification mismatch: ${db}/${storage}`);
  return { db, storage };
}

async function cleanCycle(index) {
  await resetTarget();
  const fixture = await createAuthorization(`cycle-${index}`);
  const promoted = runWrapper("promote", fixture);
  if (promoted.status !== 0 || promoted.output.phase !== "COMMITTED") {
    let journalPhase = "NO_JOURNAL";
    try { journalPhase = JSON.parse(await readFile(fixture.payload.paths.journal, "utf8")).phase ?? "UNKNOWN"; } catch {}
    fail(`Clean promotion cycle ${index} failed: ${promoted.output.code};message=${promoted.output.message ?? ""};journal=${journalPhase}`);
  }
  await assertTarget(constants.APPROVED_DATABASE_FINGERPRINT, constants.APPROVED_STORAGE_MANIFEST);
  summary.cleanCycles += 1;
  const rolledBack = runWrapper("rollback", fixture);
  if (rolledBack.status !== 0 || rolledBack.output.phase !== "ROLLED_BACK") fail(`Clean rollback cycle ${index} failed: ${rolledBack.output.code}`);
  await assertTarget(EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
  summary.cleanRollbacks += 1;
  const replay = runWrapper("promote", fixture);
  if (replay.status === 0 || replay.output.code !== "AUTHORIZATION_REPLAY") fail(`Single-use authorization replay returned ${replay.output.code}.`);
}

async function injectedFailure(point) {
  await resetTarget();
  const fixture = await createAuthorization(`failure-${point}`);
  const failed = runWrapper("promote", fixture, {
    MEGADESK_PROMOTION_INJECT_FAILURE: point,
    ...(point === "process_crash" ? { MEGADESK_PROMOTION_INJECT_HARD_CRASH: "YES" } : {}),
  });
  if (failed.status === 0) fail(`Failure injection ${point} silently succeeded.`);
  const recovered = runWrapper("recover", fixture);
  if (recovered.status !== 0 || !["ABORTED", "ROLLED_BACK"].includes(recovered.output.phase)) fail(`Recovery failed for ${point}: ${recovered.output.code}`);
  await assertTarget(EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
  summary.failureInjections.push({ point, recovery: recovered.output.phase });
}

async function concurrencyTest() {
  await resetTarget();
  const fixture = await createAuthorization("concurrency");
  const competingFixture = await createAuthorization("concurrency-competing");
  const first = spawnWrapper("promote", fixture, { MEGADESK_PROMOTION_TEST_HOLD_AFTER_LOCK_MS: "3000", MEGADESK_PROMOTION_INJECT_FAILURE: "before_backup" });
  await new Promise(resolvePromise => setTimeout(resolvePromise, 600));
  const second = runWrapper("promote", competingFixture);
  if (second.status === 0 || second.output.code !== "CONCURRENT_PROMOTION") fail(`Concurrent invocation was not rejected: ${second.output.code}`);
  const firstResult = await waitChild(first);
  if (firstResult.status === 0 || firstResult.output.code !== "INJECTED_FAILURE") fail("Lock owner did not stop at the injected boundary.");
  const recovered = runWrapper("recover", fixture);
  if (recovered.status !== 0 || recovered.output.phase !== "ABORTED") fail("Concurrent test recovery failed.");
  await assertTarget(EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
  summary.concurrentResult = "PASS_REJECTED_SECOND_OWNER";
}

async function corruptJournalTest() {
  await resetTarget();
  const fixture = await createAuthorization("corrupt-journal");
  const failed = runWrapper("promote", fixture, { MEGADESK_PROMOTION_INJECT_FAILURE: "after_db_before_storage" });
  if (failed.status === 0) fail("Corrupt journal setup did not fail at the requested boundary.");
  await writeFile(fixture.payload.paths.journal, "{corrupt\n");
  const recovered = runWrapper("recover", fixture);
  if (recovered.status === 0 || recovered.output.code !== "CORRUPT_JOURNAL") fail("Corrupt journal was not fail-closed.");
  summary.corruptJournalResult = "PASS_FAIL_CLOSED_HUMAN_RECOVERY_REQUIRED";
  await resetTarget();
}

async function misTarget(label, mutate, expectedCodes, afterAuthorization) {
  await resetTarget();
  const fixture = await createAuthorization(`mistarget-${label}`, mutate);
  if (afterAuthorization) await afterAuthorization(fixture);
  const before = await assertTarget(EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
  const result = runWrapper("promote", fixture);
  if (result.status === 0 || !expectedCodes.includes(result.output.code)) fail(`Mis-target ${label} returned ${result.output.code}.`);
  const after = await assertTarget(EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
  if (before.db !== after.db || before.storage !== after.storage) fail(`Mis-target ${label} mutated target.`);
  summary.misTargetTests.push({ label, code: result.output.code });
}

async function adversarialTests() {
  await misTarget("hostname", value => ({ ...value, target: { ...value.target, host: { ...value.target.host, hostname: "wrong-host" } } }), ["HOST_IDENTITY_MISMATCH"]);
  await misTarget("container", value => ({ ...value, target: { ...value.target, mysql: { ...value.target.mysql, container: { ...value.target.mysql.container, id: "0".repeat(64) } } } }), ["CONTAINER_IDENTITY_MISMATCH"]);
  await misTarget("database", value => ({
    ...value,
    target: {
      ...value.target,
      mysql: {
        ...value.target.mysql,
        url: `mysql://root@127.0.0.1:${PORT}/${CANDIDATE_DB}`,
        database: CANDIDATE_DB,
      },
    },
  }), ["DATABASE_IDENTITY_MISMATCH"]);
  await misTarget("storage-root", value => ({
    ...value,
    target: { ...value.target, storage: { ...value.target.storage, root: CANDIDATE_STORAGE } },
  }), ["STORAGE_ROLE_COLLISION", "STORAGE_ROOT_IDENTITY_MISMATCH"]);
  await misTarget("migration", value => ({ ...value, preState: { ...value.preState, database: { ...value.preState.database, migrationCount: 999 } } }), ["DATABASE_IDENTITY_MISMATCH"]);
  await misTarget("pre-fingerprint", value => ({ ...value, preState: { ...value.preState, database: { ...value.preState.database, fingerprint: "2".repeat(64) } } }), ["DATABASE_FINGERPRINT_MISMATCH"]);
  await misTarget("storage-manifest", value => ({ ...value, preState: { ...value.preState, storage: { ...value.preState.storage, fingerprint: "3".repeat(64) } } }), ["PRESTATE_STORAGE_MISMATCH"]);
  await misTarget("candidate-fingerprint", value => ({ ...value, candidate: { ...value.candidate, database: { ...value.candidate.database, fingerprint: "4".repeat(64) } } }), ["APPROVED_CANDIDATE_MISMATCH"]);
  await misTarget("application-identity", value => ({ ...value, target: { ...value.target, application: { container: { ...value.target.application.container, id: "5".repeat(64) } } } }), ["CONTAINER_IDENTITY_MISMATCH"]);
  await misTarget("expired-authorization", value => ({ ...value, issuedAt: new Date(Date.now() - 7_200_000).toISOString(), expiresAt: new Date(Date.now() - 3_600_000).toISOString() }), ["AUTHORIZATION_EXPIRED"]);
  await misTarget("path-escape", value => ({ ...value, candidate: { ...value.candidate, storage: { ...value.candidate.storage, root: dirname(ROOT) } } }), ["PATH_OUTSIDE_AUTHORIZED_ROOT"]);

  await resetTarget();
  const humanFixture = await createAuthorization("mistarget-human-authorization");
  humanFixture.humanAuthorization = `wrong-${randomUUID()}`;
  const humanResult = runWrapper("promote", humanFixture);
  if (humanResult.status === 0 || humanResult.output.code !== "HUMAN_AUTHORIZATION_REQUIRED") fail(`Wrong human authorization returned ${humanResult.output.code}.`);
  await assertTarget(EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
  summary.misTargetTests.push({ label: "human-authorization", code: humanResult.output.code });

  await resetTarget();
  const symlinkFixture = await createAuthorization("mistarget-storage-symlink");
  const symlinkPath = join(CANDIDATE_STORAGE, "__promotion_symlink_probe");
  await symlink(ORACLE_SOURCE, symlinkPath, "junction");
  const symlinkResult = runWrapper("promote", symlinkFixture);
  const symlinkInfo = await lstat(symlinkPath);
  if (!symlinkInfo.isSymbolicLink()) fail("Disposable junction was not represented as a symbolic link.");
  await rm(symlinkPath, { recursive: true, force: false });
  if (symlinkResult.status === 0 || !["STORAGE_SYMLINK", "UNSAFE_PATH"].includes(symlinkResult.output.code)) fail("Storage symlink/junction was not rejected.");
  const symlinkRecovered = runWrapper("recover", symlinkFixture);
  if (symlinkRecovered.status !== 0 || symlinkRecovered.output.phase !== "ABORTED") fail("Storage symlink/junction recovery failed.");
  await assertTarget(EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
  const restoredCandidate = await storageSnapshot(CANDIDATE_STORAGE);
  if (restoredCandidate.fingerprint !== constants.APPROVED_STORAGE_MANIFEST) fail("Candidate storage changed during symlink test.");
  summary.misTargetTests.push({ label: "storage-symlink-junction", code: symlinkResult.output.code });

  await resetTarget();
  const prestateFixture = await createAuthorization("mistarget-prestate-substitution");
  const prestateConnection = await connection(TARGET_DB);
  try { await prestateConnection.query("CREATE TABLE promotion_substitution_probe(id INT PRIMARY KEY)"); } finally { await prestateConnection.end(); }
  const prestateResult = runWrapper("promote", prestateFixture);
  if (prestateResult.status === 0 || prestateResult.output.code !== "DATABASE_FINGERPRINT_MISMATCH") fail("Pre-state substitution was not rejected.");
  await resetTarget();
  await assertTarget(EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
  summary.misTargetTests.push({ label: "prestate-substitution", code: prestateResult.output.code });

  await resetTarget();
  const authFixture = await createAuthorization("corrupt-authorization");
  const parsed = JSON.parse(await readFile(authFixture.authorizationPath, "utf8"));
  parsed.signature = Buffer.alloc(64, 9).toString("base64");
  const corrupted = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
  await writeFile(authFixture.authorizationPath, corrupted);
  authFixture.authorizationSha256 = sha256(corrupted);
  const corruptAuth = runWrapper("promote", authFixture);
  if (corruptAuth.status === 0 || corruptAuth.output.code !== "AUTHORIZATION_SIGNATURE_INVALID") fail("Corrupt authorization was not rejected.");
  await assertTarget(EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
  summary.misTargetTests.push({ label: "corrupt-authorization", code: corruptAuth.output.code });

  await resetTarget();
  const candidateFixture = await createAuthorization("candidate-substitution");
  const original = await readFile(CANDIDATE_DUMP);
  await writeFile(CANDIDATE_DUMP, Buffer.concat([original, Buffer.from("\n-- changed after authorization\n")]));
  const substituted = runWrapper("promote", candidateFixture);
  await writeFile(CANDIDATE_DUMP, original);
  if (substituted.status === 0 || substituted.output.code !== "CANDIDATE_DUMP_MISMATCH") fail("Candidate substitution was not rejected.");
  const recovered = runWrapper("recover", candidateFixture);
  if (recovered.status !== 0 || recovered.output.phase !== "ABORTED") fail("Candidate substitution recovery failed.");
  await assertTarget(EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
  summary.misTargetTests.push({ label: "candidate-substitution", code: substituted.output.code });
}

async function candidateToctou(label, mutate, restore) {
  await resetTarget();
  const fixture = await createAuthorization(`candidate-toctou-${label}`);
  let result;
  try {
    result = await runAtHook("promote", fixture, "after_candidate_capture", mutate);
  } finally {
    await restore();
  }
  if (result.status === 0 || result.output.code !== "CANDIDATE_SOURCE_CHANGED") {
    fail(`Candidate TOCTOU ${label} did not fail closed: ${result.output.code}.`);
  }
  const recovered = runWrapper("recover", fixture);
  if (recovered.status !== 0 || recovered.output.phase !== "ABORTED") fail(`Candidate TOCTOU ${label} did not terminate as an abort.`);
  await assertTarget(EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
  summary.toctouTests.push({ family: "candidate", label, result: result.output.code, mutation: "NONE" });
}

async function targetToctou(label, point, mutate, restore, expectedDb = EXPECTED_PRE_DB, expectedStorage = EXPECTED_PRE_STORAGE, recovery = "ABORTED") {
  await resetTarget();
  const fixture = await createAuthorization(`target-toctou-${label}`);
  let result;
  try {
    result = await runAtHook("promote", fixture, point, mutate);
  } finally {
    await restore();
  }
  if (result.status === 0 || !["CONTAINER_IDENTITY_MISMATCH", "CONTAINER_STATE_MISMATCH", "DATABASE_FINGERPRINT_MISMATCH", "DESTRUCTIVE_BOUNDARY_STORAGE_MISMATCH", "STORAGE_ROOT_IDENTITY_MISMATCH", "UNSAFE_PATH"].includes(result.output.code)) {
    fail(`Target TOCTOU ${label} did not fail closed: ${result.output.code}.`);
  }
  await assertTarget(expectedDb, expectedStorage);
  const recovered = runWrapper("recover", fixture);
  if (recovery === "ABORTED") {
    if (recovered.status !== 0 || recovered.output.phase !== "ABORTED") fail(`Target TOCTOU ${label} did not terminate as an abort.`);
  } else if (recovered.status === 0 || recovered.output.code !== "HUMAN_RECOVERY_REQUIRED") {
    fail(`Target TOCTOU ${label} did not require human recovery.`);
  }
  summary.toctouTests.push({ family: "target", label, result: result.output.code, recovery, expectedDb, expectedStorage });
}

async function toctouTests({ candidate = true, target = true, targetCases = null } = {}) {
  if (candidate) {
  const originalDump = await readFile(CANDIDATE_DUMP);
  await candidateToctou("database-replaced-after-capture", async () => {
    await writeFile(CANDIDATE_DUMP, Buffer.concat([originalDump, Buffer.from("\n-- candidate replacement after capture\n")]));
  }, async () => { await writeFile(CANDIDATE_DUMP, originalDump); });

  const storageProbe = join(CANDIDATE_STORAGE, "__toctou_storage_probe.bin");
  await candidateToctou("storage-replaced-after-capture", async () => {
    await writeFile(storageProbe, "candidate storage replacement");
  }, async () => { if (await pathExists(storageProbe)) await rm(storageProbe, { force: false }); });

  await candidateToctou("same-path-different-content", async () => {
    await writeFile(CANDIDATE_DUMP, Buffer.concat([originalDump, Buffer.from("\n-- same pathname different content\n")]));
  }, async () => { await writeFile(CANDIDATE_DUMP, originalDump); });

  const dumpSwap = join(ROOT, "candidate-dump-swap.sql");
  await candidateToctou("same-content-rename-swap", async () => {
    await rename(CANDIDATE_DUMP, dumpSwap);
    await writeFile(CANDIDATE_DUMP, originalDump, { flag: "wx" });
  }, async () => {
    if (await pathExists(CANDIDATE_DUMP)) await rm(CANDIDATE_DUMP, { force: false });
    if (await pathExists(dumpSwap)) await rename(dumpSwap, CANDIDATE_DUMP);
  });

  const storageOriginal = join(ROOT, "candidate-storage-original");
  await candidateToctou("storage-symlink-junction-swap", async () => {
    await rename(CANDIDATE_STORAGE, storageOriginal);
    await symlink(storageOriginal, CANDIDATE_STORAGE, "junction");
  }, async () => {
    if (await pathExists(CANDIDATE_STORAGE)) await rm(CANDIDATE_STORAGE, { recursive: true, force: false });
    if (await pathExists(storageOriginal)) await rename(storageOriginal, CANDIDATE_STORAGE);
  });
  }

  if (target) {
  const shouldRunTarget = label => targetCases === null || targetCases.includes(label);
  if (shouldRunTarget("database-substitution-before-db-promotion")) {
  await targetToctou("database-substitution-before-db-promotion", "before_db_promotion", async () => {
    const c = await connection(TARGET_DB);
    try { await c.query("CREATE TABLE toctou_database_substitution(id INT PRIMARY KEY)"); } finally { await c.end(); }
  }, async () => { await resetTarget(); });
  }

  if (shouldRunTarget("storage-substitution-before-db-promotion")) {
  const targetStorageProbe = join(TARGET_STORAGE, "__toctou_target_probe.bin");
  await targetToctou("storage-substitution-before-db-promotion", "before_db_promotion", async () => {
    await writeFile(targetStorageProbe, "target storage substitution");
  }, async () => { if (await pathExists(targetStorageProbe)) await rm(targetStorageProbe, { force: false }); });
  }

  if (shouldRunTarget("target-symlink-junction-swap")) {
  const targetOriginal = join(ROOT, "target-storage-original");
  await targetToctou("target-symlink-junction-swap", "before_db_promotion", async () => {
    await rename(TARGET_STORAGE, targetOriginal);
    await symlink(targetOriginal, TARGET_STORAGE, "junction");
  }, async () => {
    if (await pathExists(TARGET_STORAGE)) await rm(TARGET_STORAGE, { recursive: true, force: false });
    if (await pathExists(targetOriginal)) await rename(targetOriginal, TARGET_STORAGE);
  });
  }

  if (shouldRunTarget("application-container-recreated")) {
  await targetToctou("application-container-recreated", "before_db_backup", async () => {
    docker(["rm", "-f", APP_CONTAINER]);
    created.app = startDisposableApp();
  }, async () => {}, EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
  }

  if (shouldRunTarget("mysql-same-name-new-id")) {
  await targetToctou("mysql-same-name-new-id", "before_db_backup", async () => {
    docker(["rm", "-f", MYSQL_CONTAINER]);
    created.mysql = startDisposableMysql();
    await waitForMysql();
  }, async () => {}, EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
  }

  if (shouldRunTarget("between-db-storage-container-recreation")) {
  await resetTarget();
  const partialFixture = await createAuthorization("target-toctou-between-db-storage");
  const partial = await runAtHook("promote", partialFixture, "before_storage_promotion", async () => {
    docker(["rm", "-f", APP_CONTAINER]);
    created.app = startDisposableApp();
  });
  if (partial.status === 0 || partial.output.code !== "CONTAINER_IDENTITY_MISMATCH") fail(`Target change between DB and storage did not fail closed: ${partial.output.code}.`);
  await assertTarget(constants.APPROVED_DATABASE_FINGERPRINT, EXPECTED_PRE_STORAGE);
  const partialRecovery = runWrapper("recover", partialFixture);
  if (partialRecovery.status === 0 || partialRecovery.output.code !== "HUMAN_RECOVERY_REQUIRED") fail("Ambiguous partial target did not require human recovery.");
  summary.toctouTests.push({ family: "target", label: "between-db-storage-container-recreation", result: partial.output.code, recovery: partialRecovery.output.code, forwardProgress: "NO" });
  await resetTarget();
  }
  }
}

async function replaceTargetWithFreshPreState(label) {
  const displaced = join(ROOT, `target-storage-displaced-${label}-${randomUUID()}`);
  await rename(TARGET_STORAGE, displaced);
  await cp(ORACLE_SOURCE, TARGET_STORAGE, { recursive: true, force: false, errorOnExist: true });
  return async () => {
    if (await pathExists(TARGET_STORAGE)) await rm(TARGET_STORAGE, { recursive: true, force: false });
    if (await pathExists(displaced)) await rename(displaced, TARGET_STORAGE);
  };
}

async function replaceTargetWithSymlink(label) {
  const displaced = join(ROOT, `target-storage-symlink-${label}-${randomUUID()}`);
  await rename(TARGET_STORAGE, displaced);
  await symlink(displaced, TARGET_STORAGE, "dir");
  const replacementBaseline = await storageSnapshot(displaced);
  const restore = async () => {
    if (await pathExists(TARGET_STORAGE)) await rm(TARGET_STORAGE, { recursive: true, force: false });
    if (await pathExists(displaced)) await rename(displaced, TARGET_STORAGE);
  };
  // The pathname under test intentionally becomes unsafe.  Verify the object
  // it points to directly so the harness can distinguish a fail-closed
  // rejection from an accidental mutation, without traversing the link.
  restore.assertReplacementUntouched = async () => {
    const storage = await storageSnapshot(displaced);
    if (storage.fingerprint !== replacementBaseline.fingerprint) {
      fail(`Bound symlink replacement ${label} was mutated after ${restore.resultCode ?? "unknown"}.`);
    }
  };
  return restore;
}

async function boundPromotionSwap(label, point, mutate) {
  await resetTarget();
  const fixture = await createAuthorization(`bound-promotion-${label}`);
  let restore = null;
  try {
    const result = await runAtHook("promote", fixture, point, async () => { restore = await mutate(label); });
    if (restore) restore.resultCode = result.output.code;
    if (result.status === 0 || !["STORAGE_TARGET_IDENTITY_MISMATCH", "UNSAFE_PATH", "HUMAN_RECOVERY_REQUIRED"].includes(result.output.code)) {
      fail(`Bound promotion ${label} did not fail closed at the bound target: ${result.output.code}.`);
    }
    if (restore?.assertReplacementUntouched) {
      const db = await logicalFingerprint(`mysql://root@${MYSQL_HOST}:${PORT}/${TARGET_DB}`, PASSWORD);
      if (db !== constants.APPROVED_DATABASE_FINGERPRINT) fail(`Bound promotion ${label} mutated the target database.`);
      await restore.assertReplacementUntouched();
    } else {
      await assertTarget(constants.APPROVED_DATABASE_FINGERPRINT, EXPECTED_PRE_STORAGE);
    }
    const recovered = runWrapper("recover", fixture);
    if (recovered.status === 0 || recovered.output.code !== "HUMAN_RECOVERY_REQUIRED") fail(`Bound promotion ${label} recovery was not fail-closed.`);
    summary.toctouTests.push({ family: "bound-promotion", label, point, result: result.output.code, unauthorizedTargetMutated: "NO" });
  } finally {
    if (restore) await restore();
    await resetTarget();
    await clearStaleFixtureLock(fixture);
  }
}

async function boundRollbackSwap(label, point, mutate) {
  await resetTarget();
  const fixture = await createAuthorization(`bound-rollback-${label}`);
  const partial = runWrapper("promote", fixture, { MEGADESK_PROMOTION_INJECT_FAILURE: "after_db_before_storage" });
  if (partial.status === 0 || partial.output.code !== "INJECTED_FAILURE") fail(`Bound rollback ${label} setup did not stop after DB promotion.`);
  let restore = null;
  try {
    const result = await runAtHook("recover", fixture, point, async () => { restore = await mutate(label); });
    if (result.status === 0 || !["STORAGE_TARGET_IDENTITY_MISMATCH", "HUMAN_RECOVERY_REQUIRED"].includes(result.output.code)) {
      fail(`Bound rollback ${label} did not fail closed at the bound target: ${result.output.code}.`);
    }
    const storage = (await storageSnapshot(TARGET_STORAGE)).fingerprint;
    if (storage !== EXPECTED_PRE_STORAGE) fail(`Bound rollback ${label} mutated a replacement target.`);
    summary.toctouTests.push({ family: "bound-rollback", label, point, result: result.output.code, unauthorizedTargetMutated: "NO" });
  } finally {
    if (restore) await restore();
    await resetTarget();
    await clearStaleFixtureLock(fixture);
  }
}

async function postValidationBoundaryAttacks() {
  for (const operation of ["symlink", "removal", "directory-replacement", "inode-replacement"]) {
    await resetTarget();
    const fixture = await createAuthorization(`post-validation-${operation}`);
    const original = await directoryIdentity(TARGET_STORAGE);
    let attack = null;
    const promoted = await runAtHook("promote", fixture, "after_final_identity_validation_before_destructive_mutation", async () => {
      attack = await runBoundaryAttacker(operation);
    });
    if (attack?.status !== 0 || attack.output?.result !== "DENIED") {
      fail(`Post-validation ${operation} attack was not denied by the OS boundary.`);
    }
    if (promoted.status !== 0 || promoted.output.phase !== "COMMITTED") {
      fail(`Authorized promotion did not complete after denied ${operation} attack: ${promoted.output.code}.`);
    }
    const after = await directoryIdentity(TARGET_STORAGE);
    if (!sameDirectoryIdentity(original, after)) fail(`Post-validation ${operation} changed the bound target inode.`);
    await assertTarget(constants.APPROVED_DATABASE_FINGERPRINT, constants.APPROVED_STORAGE_MANIFEST);
    const rolledBack = runWrapper("rollback", fixture);
    if (rolledBack.status !== 0 || rolledBack.output.phase !== "ROLLED_BACK") {
      fail(`Post-validation ${operation} rollback failed: ${rolledBack.output.code}.`);
    }
    await assertTarget(EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
    summary.trustedBoundary.attacks.push({ operation, attack: attack.output.code, authorizedOperation: promoted.output.phase, originalInode: "UNCHANGED", replacement: "NOT_CREATED", unauthorizedPathMutated: "NO" });
  }

  await resetTarget();
  const rollbackFixture = await createAuthorization("post-validation-rollback");
  const partial = runWrapper("promote", rollbackFixture, { MEGADESK_PROMOTION_INJECT_FAILURE: "after_db_before_storage" });
  if (partial.status === 0 || partial.output.code !== "INJECTED_FAILURE") fail("Post-validation rollback setup did not stop after database promotion.");
  const original = await directoryIdentity(TARGET_STORAGE);
  let attack = null;
  const recovered = await runAtHook("recover", rollbackFixture, "after_final_rollback_identity_validation_before_destructive_mutation", async () => {
    attack = await runBoundaryAttacker("inode-replacement");
  });
  if (attack?.status !== 0 || attack.output?.result !== "DENIED") fail("Post-validation rollback inode attack was not denied by the OS boundary.");
  if (recovered.status !== 0 || recovered.output.phase !== "ROLLED_BACK") fail(`Authorized rollback did not complete after denied attack: ${recovered.output.code}.`);
  const after = await directoryIdentity(TARGET_STORAGE);
  if (!sameDirectoryIdentity(original, after)) fail("Post-validation rollback changed the bound target inode.");
  await assertTarget(EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
  summary.trustedBoundary.rollbackAttack = { attack: attack.output.code, authorizedOperation: recovered.output.phase, originalInode: "UNCHANGED", unauthorizedPathMutated: "NO" };
}

async function authorizedBoundaryConcurrencyTest() {
  await resetTarget();
  const firstFixture = await createAuthorization("trusted-boundary-concurrency-first");
  const secondFixture = await createAuthorization("trusted-boundary-concurrency-second");
  const point = "after_final_identity_validation_before_destructive_mutation";
  const hookRoot = join(firstFixture.operationRoot, "toctou-hooks");
  const first = spawnWrapper("promote", firstFixture, {
    MEGADESK_PROMOTION_TEST_HOOK: point,
    MEGADESK_PROMOTION_TEST_HOOK_ROOT: hookRoot,
  });
  const diagnostic = { stdout: "", stderr: "" };
  first.stdout.on("data", value => { diagnostic.stdout += value.toString("utf8"); });
  first.stderr.on("data", value => { diagnostic.stderr += value.toString("utf8"); });
  await waitForPath(join(hookRoot, `${point}.ready`), point, first, diagnostic);
  const second = runWrapper("promote", secondFixture);
  if (second.status === 0 || second.output.code !== "CONCURRENT_PROMOTION") {
    fail(`Concurrent authorized promotion was not rejected: ${second.output.code}.`);
  }
  await writeFile(join(hookRoot, `${point}.continue`), "continue\n", { flag: "wx", mode: 0o600 });
  const firstResult = await waitChild(first);
  if (firstResult.status !== 0 || firstResult.output.phase !== "COMMITTED") {
    fail(`First authorized promotion did not complete: ${firstResult.output.code}.`);
  }
  await assertTarget(constants.APPROVED_DATABASE_FINGERPRINT, constants.APPROVED_STORAGE_MANIFEST);
  const rolledBack = runWrapper("rollback", firstFixture);
  if (rolledBack.status !== 0 || rolledBack.output.phase !== "ROLLED_BACK") fail(`Concurrent boundary rollback failed: ${rolledBack.output.code}.`);
  await assertTarget(EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
  summary.trustedBoundary.concurrency = "PASS_REJECTED_SECOND_SAME_UID_OWNER";
}

async function boundStorageTargetToctouTests() {
  if (BOUND_CASE && BOUND_CASE !== "symlink-substitution") fail("Configured isolated rehearsal bound case is not approved.");
  for (const [label, point] of [
    ["swap-before-materialization", "before_storage_materialization"],
    ["swap-during-materialization", "during_storage_materialization"],
    ["swap-after-materialization", "after_storage_materialization"],
    ["swap-after-journal", "after_storage_journal"],
    ["swap-immediately-before-destructive-swap", "before_storage_destructive_swap"],
    ["swap-immediately-after-destructive-swap", "after_storage_destructive_swap"],
    ["storage-root-recreation", "before_storage_destructive_swap"],
  ]) {
    if (!BOUND_CASE) await boundPromotionSwap(label, point, replaceTargetWithFreshPreState);
  }
  if (!BOUND_CASE || BOUND_CASE === "symlink-substitution") {
    await boundPromotionSwap("symlink-substitution", "before_storage_destructive_swap", replaceTargetWithSymlink);
  }
  for (const [label, point] of [
    ["storage-target-before-rollback-db", "before_rollback_db"],
    ["storage-target-between-rollback-db-storage", "before_rollback_storage_materialization"],
    ["storage-target-before-rollback-swap", "before_rollback_storage_destructive_swap"],
    ["storage-target-after-rollback-swap", "after_rollback_storage_destructive_swap"],
  ]) {
    if (!BOUND_CASE) await boundRollbackSwap(label, point, replaceTargetWithFreshPreState);
  }
}

async function storageBindingPlatformFailClosed() {
  await resetTarget();
  const fixture = await createAuthorization("storage-binding-platform");
  const result = runWrapper("promote", fixture);
  if (process.platform === "linux") {
    if (result.status === 0 || result.output.code === "STORAGE_TARGET_BINDING_UNSUPPORTED") fail("Linux rehearsal did not exercise the bound storage path.");
    return;
  }
  if (result.status === 0 || result.output.code !== "STORAGE_TARGET_BINDING_UNSUPPORTED") fail(`Unsupported platform did not fail closed: ${result.output.code}.`);
  await assertTarget(EXPECTED_PRE_DB, EXPECTED_PRE_STORAGE);
  summary.storageBindingPlatform = "UNSUPPORTED_FAIL_CLOSED_NO_TARGET_MUTATION";
}

async function main() {
  const protectedBefore = inspectProtected();
  let mainError = null;
  try {
    await setup();
    if (CONFIGURED_DISPOSABLE) {
      if (scope !== "linux-causal") fail("Configured isolated rehearsal requires the linux-causal scope.");
      await cleanCycle(1);
      await postValidationBoundaryAttacks();
      await authorizedBoundaryConcurrencyTest();
      await boundStorageTargetToctouTests();
    } else if (process.platform !== "linux") {
      await storageBindingPlatformFailClosed();
    } else if (scope === "full") {
      await cleanCycle(1);
      await cleanCycle(2);
      for (const point of [
        "before_backup", "during_db_backup", "after_db_backup_before_storage_backup", "during_storage_backup",
        "after_backup_before_promotion", "during_db_promotion", "after_db_before_storage", "during_storage_promotion",
        "after_storage_before_post_verify", "after_verify_before_committed", "process_crash",
      ]) await injectedFailure(point);
      await concurrencyTest();
      await adversarialTests();
      await corruptJournalTest();
      await toctouTests();
      await boundStorageTargetToctouTests();
    } else {
      await toctouTests();
      await boundStorageTargetToctouTests();
    }
  } catch (error) {
    mainError = error;
  }
  let cleanupError = null;
  try { await cleanup(); } catch (error) { cleanupError = error; }
  const protectedAfter = inspectProtected();
  const protectedStable = canonical(protectedBefore) === canonical(protectedAfter);
  const resourcesAbsent = CONFIGURED_DISPOSABLE
    ? !await lstat(ROOT).then(() => true, () => false)
    : !dockerExists("container", MYSQL_CONTAINER) && !dockerExists("container", APP_CONTAINER)
      && !dockerExists("volume", VOLUME) && !dockerExists("network", NETWORK) && await portIsFree();
  const result = {
    result: !mainError && !cleanupError && protectedStable && resourcesAbsent ? "PASS" : "BLOCKED",
    error: mainError?.message ?? cleanupError?.message ?? null,
    cleanCycles: summary.cleanCycles,
    cleanRollbacks: summary.cleanRollbacks,
    failureInjectionCount: summary.failureInjections.length,
    failureInjections: summary.failureInjections,
    misTargetCount: summary.misTargetTests.length,
    misTargetTests: summary.misTargetTests,
    concurrentResult: summary.concurrentResult,
    corruptJournalResult: summary.corruptJournalResult,
    storageBindingPlatform: summary.storageBindingPlatform,
    trustedBoundary: summary.trustedBoundary,
    toctouTests: summary.toctouTests,
    toctouCount: summary.toctouTests.length,
    promotedDatabaseFingerprint: constants.APPROVED_DATABASE_FINGERPRINT,
    promotedStorageManifest: constants.APPROVED_STORAGE_MANIFEST,
    protectedResourcesStable: protectedStable,
    disposableResourcesAbsent: resourcesAbsent,
    resources: summary.resources,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.result !== "PASS") process.exitCode = 1;
}

const invokedBoundaryAttack = process.argv[2] === "boundary-attack";
const entrypoint = invokedBoundaryAttack ? boundaryAttackerMain(process.argv[3]) : main();
entrypoint.catch(error => {
  process.stderr.write(`${JSON.stringify({ result: "BLOCKED", error: error.message })}\n`);
  process.exitCode = 1;
});
