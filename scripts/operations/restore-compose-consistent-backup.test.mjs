import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  RestoreHarnessError,
  assertCandidateRuntime,
  createDockerDependencies,
  materializeVerifiedBackupPair,
  parseStrictJson,
  runRestoreWorkflow,
  parseCli,
  validatePairManifest,
  validateRestoreConfig,
  validateTarListing,
  validateTarVerboseListing,
  verifyBackupPair,
} from "./restore-compose-consistent-backup.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
function manifest(database, media) {
  return {
    schema: "megadesk-consistent-backup-pair/v1", releaseSha: "417db3742056f8cedc005867bba765fdcd77c0a7", runId: "compose-417db3742056-20261017-010203-deadbeef",
    window: { startedAt: "2026-10-17T01:02:03.000Z", endedAt: "2026-10-17T01:02:04.000Z" },
    freeze: { mode: "active", activeWriters: 0, inFlightWrites: 0, freezeStateIncludedInMediaArchive: true },
    database: { name: "mysql.sql", sizeBytes: database.length, sha256: sha(database) }, media: { name: "storage.tar", sizeBytes: media.length, sha256: sha(media) },
  };
}
function options(overrides = {}) {
  return { environmentId: "restore-v5-proof", sandboxRoot: "/var/tmp/megadesk-restore/restore-v5-proof", databaseName: "megadesk_test_restore_v5_proof", mysqlImage: "mysql:8.0.46", mysqlPort: "33312", appPort: "43132", runtimeDir: "/var/tmp/approved-runtime/v5", ...overrides };
}

describe("compose backup restore harness", () => {
  it("keeps plan-only as the default and requires an explicit execution flag", () => {
    expect(parseCli([])).toEqual({ execute: false });
    expect(parseCli(["--execute", "--environment-id", "restore-v5-proof"])).toMatchObject({ execute: true, environmentId: "restore-v5-proof" });
    expect(() => parseCli(["--unexpected"])).toThrow("unsupported");
  });
  it("rejects ambiguous JSON encodings and duplicate keys", () => {
    expect(() => parseStrictJson(Buffer.from("\ufeff{}"))).toThrow(RestoreHarnessError);
    expect(() => parseStrictJson(Buffer.from('{"a":1,"a":2}'))).toThrow("duplicate");
    expect(() => parseStrictJson(Buffer.from([0xc3, 0x28]))).toThrow("UTF-8");
  });

  it("requires the exact verified backup-pair manifest", () => {
    const valid = manifest(Buffer.from("database"), Buffer.from("media"));
    expect(validatePairManifest(valid).runId).toContain("compose-");
    expect(() => validatePairManifest({ ...valid, media: { ...valid.media, name: "other.tar" } })).toThrow("canonical");
    expect(() => validatePairManifest({ ...valid, freeze: { ...valid.freeze, activeWriters: 1 } })).toThrow("quiescent");
  });

  it("validates an on-disk pair and rejects files from separate runs", async () => {
    const run = await mkdtemp(path.join(os.tmpdir(), "restore-pair-")); const other = await mkdtemp(path.join(os.tmpdir(), "restore-other-"));
    try {
      const database = Buffer.from("database"); const media = Buffer.from("media");
      await writeFile(path.join(run, "mysql.sql"), database); await writeFile(path.join(run, "storage.tar"), media); await writeFile(path.join(run, "manifest.json"), JSON.stringify(manifest(database, media)));
      await expect(verifyBackupPair({ manifestPath: path.join(run, "manifest.json"), mysqlDump: path.join(run, "mysql.sql"), storageTar: path.join(run, "storage.tar") })).resolves.toMatchObject({ databaseHash: sha(database), mediaHash: sha(media) });
      await writeFile(path.join(other, "storage.tar"), media);
      await expect(verifyBackupPair({ manifestPath: path.join(run, "manifest.json"), mysqlDump: path.join(run, "mysql.sql"), storageTar: path.join(other, "storage.tar") })).rejects.toThrow("one physical run");
      await expect(verifyBackupPair({ manifestPath: path.join(run, "manifest.json"), mysqlDump: path.join(run, "missing.sql"), storageTar: path.join(run, "storage.tar") })).rejects.toThrow("missing");
      await writeFile(path.join(run, "mysql.sql"), "changed");
      await expect(verifyBackupPair({ manifestPath: path.join(run, "manifest.json"), mysqlDump: path.join(run, "mysql.sql"), storageTar: path.join(run, "storage.tar") })).rejects.toThrow("differ from the manifest");
    } finally { await rm(run, { recursive: true, force: true }); await rm(other, { recursive: true, force: true }); }
  });

  it("seals a verified backup pair into the marker-owned sandbox before restore", async () => {
    const run = await mkdtemp(path.join(os.tmpdir(), "restore-source-")); const sandbox = await mkdtemp(path.join(os.tmpdir(), "restore-sandbox-"));
    try {
      const database = Buffer.from("database"); const media = Buffer.from("media");
      await writeFile(path.join(run, "mysql.sql"), database); await writeFile(path.join(run, "storage.tar"), media); await writeFile(path.join(run, "manifest.json"), JSON.stringify(manifest(database, media)));
      const source = await verifyBackupPair({ manifestPath: path.join(run, "manifest.json"), mysqlDump: path.join(run, "mysql.sql"), storageTar: path.join(run, "storage.tar") });
      const sealed = await materializeVerifiedBackupPair({ sandboxRoot: sandbox }, source);
      expect(path.basename(sealed.manifestPath)).toBe("manifest.json");
      expect(path.basename(path.dirname(sealed.manifestPath))).toBe("input");
      expect(sealed.databaseHash).toBe(sha(database));
      await writeFile(path.join(run, "mysql.sql"), "replaced-after-copy");
      expect(sealed.databaseHash).toBe(sha(database));
    } finally { await rm(run, { recursive: true, force: true }); await rm(sandbox, { recursive: true, force: true }); }
  });

  it("rejects production-shaped destinations, wrong MySQL and colliding ports", () => {
    expect(validateRestoreConfig(options(), { platform: "linux" }).mysqlContainer).toBe("megadesk-restore-v5-proof-mysql");
    expect(() => validateRestoreConfig(options({ databaseName: "megadesk_local" }), { platform: "linux" })).toThrow("megadesk_test_restore");
    expect(() => validateRestoreConfig(options({ sandboxRoot: "/opt/megadesk/storage" }), { platform: "linux" })).toThrow("canonical disposable");
    expect(() => validateRestoreConfig(options({ mysqlImage: "mysql:latest" }), { platform: "linux" })).toThrow("8.0.46");
    expect(() => validateRestoreConfig(options({ appPort: "33312" }), { platform: "linux" })).toThrow("protected or duplicate");
  });

  it("rejects traversal, duplicates and a missing durable freeze state in media", () => {
    expect(validateTarListing("./\n./.write-freeze\nobjects/a\n")).toBe(true);
    expect(() => validateTarListing(".write-freeze\n../escape\n")).toThrow("unsafe");
    expect(() => validateTarListing(".write-freeze\n file-with-leading-space\n")).toThrow("unsafe");
    expect(() => validateTarListing("objects/a\nobjects/a\n.write-freeze\n")).toThrow("duplicate");
    expect(() => validateTarListing(".write-freeze\nobjects/é\nobjects/é\n")).toThrow("duplicate");
    expect(() => validateTarListing("objects/a\n")).toThrow("freeze");
    expect(validateTarVerboseListing("drwx------ 0/0 0 2026-10-17 00:00 .write-freeze/\n-rw------- 0/0 1 2026-10-17 00:00 objects/a\n")).toBe(true);
    expect(() => validateTarVerboseListing("lrwxrwxrwx 0/0 0 2026-10-17 00:00 objects/link -> /etc/passwd\n")).toThrow("link");
  });

  it("cleans only resources created by this invocation after a partial failure", async () => {
    const config = validateRestoreConfig(options(), { platform: "linux" }); const calls = [];
    const deps = Object.fromEntries(["assertAbsent", "assertPortsAvailable", "assertRuntime", "verifyArchive", "createSandbox", "materializePair", "createNetwork", "createVolume", "startMySql", "waitForMySql", "restoreDatabase", "restoreMedia", "verifyMedia", "startApplication", "waitForApplication", "verifySyntheticReferences"].map(name => [name, async (_config, pair) => { calls.push(name); if (name === "restoreMedia") throw new Error("synthetic media failure"); return name === "materializePair" ? pair : undefined; }]));
    deps.cleanup = async (_config, created) => { calls.push(`cleanup:${created.join(",")}`); };
    const pair = { manifest: manifest(Buffer.from("database"), Buffer.from("media")), mysqlDump: "/safe/mysql.sql", storageTar: "/safe/storage.tar" };
    await expect(runRestoreWorkflow({ config, pair, dependencies: deps, random: size => Buffer.alloc(size, 1) })).rejects.toThrow("restore harness failed");
    expect(calls.at(-1)).toBe("cleanup:mysql,volume,network,sandbox");
  });

  it("requires the reviewed synthetic probe in the candidate before any restore resources exist", async () => {
    const runtime = await mkdtemp(path.join(os.tmpdir(), "restore-runtime-"));
    try {
      await expect(assertCandidateRuntime(runtime)).rejects.toMatchObject({ code: "SYNTHETIC_PROBE_REQUIRED" });
      await (await import("node:fs/promises")).mkdir(path.join(runtime, "dist", "operations"), { recursive: true });
      await writeFile(path.join(runtime, "dist", "operations", "restore-synthetic-probe.js"), "// synthetic probe");
      await expect(assertCandidateRuntime(runtime)).resolves.toBeUndefined();
    } finally { await rm(runtime, { recursive: true, force: true }); }
  });

  it("does not report a verified restoration until the synthetic probe succeeds", async () => {
    const config = validateRestoreConfig(options(), { platform: "linux" }); const noop = async () => {};
    const deps = { assertAbsent: noop, assertPortsAvailable: noop, assertRuntime: noop, verifyArchive: noop, createSandbox: noop, materializePair: async (_config, pair) => pair, createNetwork: noop, createVolume: noop, startMySql: noop, waitForMySql: noop, restoreDatabase: noop, restoreMedia: noop, verifyMedia: noop, startApplication: noop, waitForApplication: noop, verifySyntheticReferences: async () => { throw new RestoreHarnessError("PROBE_HASH_MISMATCH", "probe mismatch"); }, cleanup: noop };
    const pair = { manifest: manifest(Buffer.from("database"), Buffer.from("media")), mysqlDump: "/safe/mysql.sql", storageTar: "/safe/storage.tar" };
    await expect(runRestoreWorkflow({ config, pair, dependencies: deps })).rejects.toMatchObject({ code: "PROBE_HASH_MISMATCH" });
  });

  it("cleans only its created resources when application startup or a media reference check fails", async () => {
    const config = validateRestoreConfig(options(), { platform: "linux" }); const cleanup = [];
    for (const failure of ["startApplication", "verifySyntheticReferences"]) {
      const noop = async () => {};
      const deps = { assertAbsent: noop, assertPortsAvailable: noop, assertRuntime: noop, verifyArchive: noop, createSandbox: noop, materializePair: async (_config, pair) => pair, createNetwork: noop, createVolume: noop, startMySql: noop, waitForMySql: noop, restoreDatabase: noop, restoreMedia: noop, verifyMedia: noop, startApplication: noop, waitForApplication: noop, verifySyntheticReferences: noop, cleanup: async (_config, created) => cleanup.push(`${failure}:${created.join(",")}`) };
      deps[failure] = async () => { throw new RestoreHarnessError(failure === "startApplication" ? "APPLICATION_NOT_READY" : "MEDIA_REFERENCE_MISSING", "synthetic failure"); };
      const pair = { manifest: manifest(Buffer.from("database"), Buffer.from("media")), mysqlDump: "/safe/mysql.sql", storageTar: "/safe/storage.tar" };
      await expect(runRestoreWorkflow({ config, pair, dependencies: deps })).rejects.toBeInstanceOf(RestoreHarnessError);
    }
    expect(cleanup).toEqual([
      "startApplication:app,mysql,volume,network,sandbox",
      "verifySyntheticReferences:app,mysql,volume,network,sandbox",
    ]);
  });

  it("uses the correct label location for container, volume, and network cleanup", async () => {
    const config = validateRestoreConfig(options(), { platform: "linux" }); const calls = [];
    const dependencies = createDockerDependencies(async (command, args) => {
      calls.push([command, args]);
      if (args[0] === "inspect") return { stdout: `${config.environmentId}\n`, stderr: "" };
      return { stdout: "", stderr: "" };
    });
    await dependencies.cleanup(config, ["app", "mysql", "volume", "network"]);
    const inspectFormats = calls.filter(([, args]) => args[0] === "inspect").map(([, args]) => args[2]);
    expect(inspectFormats).toEqual([
      '{{ index .Config.Labels "com.megadesk.restore-harness" }}',
      '{{ index .Config.Labels "com.megadesk.restore-harness" }}',
      '{{ index .Labels "com.megadesk.restore-harness" }}',
      '{{ index .Labels "com.megadesk.restore-harness" }}',
    ]);
  });
});
