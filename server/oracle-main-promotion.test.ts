import { afterEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertAuthorizationPayload,
  assertBackupEvidence,
  assertDestructivePlatform,
  assertFreezeEvidencePayload,
  assertReleaseBinding,
  assertTargetPolicy,
  constants,
  directSqlLiteral,
  isGeneratedColumnExtra,
  loadAuthorization,
  loadPinnedTrustRoot,
  loadTrustedFreezeEvidence,
  runDestructivePromotion,
  storageSnapshot,
} from "../scripts/reconciliation/oracle-main-promotion.mjs";

const roots: string[] = [];
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function isolatedRehearsalAuthorization(runId = "oracle-toctou-linux-20261002-abcdef12") {
  const root = `/tmp/megadesk-${runId}`;
  const database = `megadesk_test_${runId.replaceAll("-", "_")}`;
  return {
    rehearsal: {
      kind: "megadesk-isolated-linux-runner-rehearsal",
      version: 1,
      runId,
      databaseTransport: "mysql2-direct",
      port: 33330,
      network: `megadesk-test-${runId}-net`,
      volume: `megadesk_test_${runId.replaceAll("-", "_")}_mysql_data`,
    },
    target: {
      class: "oracle-main-isolated-rehearsal",
      host: {},
      mysql: {
        container: { name: `megadesk-test-${runId}-mysql` },
        database,
        user: "root",
        url: `mysql://root@host.docker.internal:33330/${database}`,
      },
      storage: { root: `${root}/target` },
    },
    candidate: { storage: { root: `${root}/candidate` } },
    backup: { storage: { root: `${root}/backups/storage` } },
    verification: {
      backupDatabase: `${database}_b`,
      candidateDatabase: `${database}_v`,
      storageRoot: `${root}/operations/verify-storage`,
    },
    paths: { allowedRoot: root },
  };
}

function stable(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map(key => [key, stable((value as Record<string, unknown>)[key])]));
  }
  return value;
}

const human = "synthetic-human-authorization-proof-for-tests-only";
const gitCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const operationId = "11111111-1111-4111-8111-111111111111";
const authorizationId = "22222222-2222-4222-8222-222222222222";
const freezeRequestId = "44444444-4444-4444-8444-444444444444";
const freezeId = "33333333-3333-4333-8333-333333333333";
const testNow = Date.parse("2030-01-01T00:05:00.000Z");

const trustedFreezeEvidence = {
  kind: "megadesk-oracle-write-freeze-evidence",
  version: 1,
  payload: {
    active: true,
    activeWriters: 0,
    expiresAt: "2030-01-01T00:10:00.000Z",
    freezeId,
    inFlightWrites: 0,
    issuedAt: "2030-01-01T00:00:00.000Z",
    operationId,
    requestId: freezeRequestId,
    release: { gitCommit },
    target: { database: "megadesk_local", hostname: "megadesk-prod-01" },
    version: 1,
    writersDrained: true,
  },
  signature: "6sy2SFz69VHi+hQZ50PpWxyHoKeDifG6AM87prJoWbgnVjcpeBhFweMBGf3+6ygWnVytoWLY4xYJmvFT1efSAg==",
};

function authorizationPayload(overrides: Record<string, unknown> = {}) {
  return {
    operationId,
    authorizationId,
    issuedAt: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:15:00.000Z",
    singleUse: true,
    allowedActions: ["promote"],
    humanAuthorizationSha256: sha256(human),
    release: { gitCommit },
    freeze: { requestId: freezeRequestId, freezeId, evidenceSha256: sha256(freezeEvidenceBytes()) },
    candidate: {
      release: { gitCommit },
      database: { fingerprint: constants.APPROVED_DATABASE_FINGERPRINT },
      storage: { fingerprint: constants.APPROVED_STORAGE_MANIFEST },
    },
    target: {
      host: { hostname: "megadesk-prod-01" },
      mysql: { database: "megadesk_local" },
    },
    ...overrides,
  };
}

function freezeEvidenceBytes(evidence = trustedFreezeEvidence) {
  return Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
}

async function attackerAuthorizationFixture(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "megadesk-promotion-auth-test-"));
  roots.push(root);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicPath = path.join(root, "public.pem");
  const authorizationPath = path.join(root, "authorization.json");
  const payload = authorizationPayload(overrides);
  const signature = sign(null, Buffer.from(JSON.stringify(stable(payload))), privateKey).toString("base64");
  const authorization = { kind: constants.AUTH_KIND, version: constants.AUTH_VERSION, payload, signature };
  const raw = Buffer.from(`${JSON.stringify(authorization, null, 2)}\n`);
  const publicBytes = Buffer.from(publicKey.export({ type: "spki", format: "pem" }));
  await writeFile(publicPath, publicBytes, { mode: 0o600 });
  await writeFile(authorizationPath, raw, { mode: 0o600 });
  return {
    authorizationPath,
    publicPath,
    raw,
    publicBytes,
    environment: {
      MEGADESK_PROMOTION_AUTHORIZATION_FILE: authorizationPath,
      MEGADESK_PROMOTION_PUBLIC_KEY_FILE: publicPath,
      MEGADESK_PROMOTION_PUBLIC_KEY_SHA256: sha256(publicBytes),
      MEGADESK_PROMOTION_OPERATION_ID: operationId,
      MEGADESK_PROMOTION_AUTHORIZATION_ID: authorizationId,
      MEGADESK_PROMOTION_HUMAN_AUTHORIZATION: human,
    },
  };
}

async function writeFreezeEvidence(evidence = trustedFreezeEvidence) {
  const root = await mkdtemp(path.join(tmpdir(), "megadesk-promotion-freeze-test-"));
  roots.push(root);
  const evidencePath = path.join(root, "freeze-evidence.json");
  await writeFile(evidencePath, freezeEvidenceBytes(evidence), { mode: 0o600 });
  return evidencePath;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("Oracle MAIN promotion trust boundary", () => {
  it("serializes structured direct-backup values as valid JSON SQL strings", () => {
    expect(directSqlLiteral({ enabled: true, labels: ["alpha", "beta"] })).toBe("'{\"enabled\":true,\"labels\":[\"alpha\",\"beta\"]}'");
  });

  it("keeps default-generated timestamp columns in direct backups", () => {
    expect(isGeneratedColumnExtra("DEFAULT_GENERATED on update CURRENT_TIMESTAMP")).toBe(false);
    expect(isGeneratedColumnExtra("VIRTUAL GENERATED")).toBe(true);
    expect(isGeneratedColumnExtra("STORED GENERATED")).toBe(true);
  });

  it("pins the independently approved candidate identities in code", () => {
    expect(constants.APPROVED_DATABASE_FINGERPRINT).toBe("594d3c32ce5df222b37abbb8a9ba09afae2ed21505bd66e1f2452046a2f0f048");
    expect(constants.APPROVED_STORAGE_MANIFEST).toBe("0f7298fe9036af2d10ab9a5ad3765f0fd01f344fa820d284222e23646aadce86");
    expect(constants.EXPECTED_FREEZE_BOUNDARY).toBe("9479c73fe1cf4f8b91ebe38dafd6a106");
    expect(constants.AUTH_VERSION).toBe(2);
    expect(constants.MAX_FREEZE_EVIDENCE_TTL_MS).toBe(15 * 60 * 1000);
  });

  it("loads only the compiled promotion trust root", async () => {
    const root = await loadPinnedTrustRoot(
      constants.PROMOTION_TRUST_ROOT_PATH,
      constants.PROMOTION_TRUST_ROOT_SHA256,
      "unit promotion root",
    );
    expect(sha256(root)).toBe(constants.PROMOTION_TRUST_ROOT_SHA256);
  });

  it("rejects a self-signed authorization even when invocation supplies its matching public key and pin", async () => {
    const fixture = await attackerAuthorizationFixture();
    await expect(loadAuthorization(fixture.environment, { now: testNow }))
      .rejects.toMatchObject({ code: "AUTHORIZATION_SIGNATURE_INVALID" });
  });

  it("does not restore trust through obsolete environment public-key overrides", async () => {
    const fixture = await attackerAuthorizationFixture({
      candidate: {
        database: { fingerprint: "1".repeat(64) },
        storage: { fingerprint: constants.APPROVED_STORAGE_MANIFEST },
      },
    });
    await expect(loadAuthorization({
      ...fixture.environment,
      MEGADESK_PROMOTION_PUBLIC_KEY_FILE: fixture.publicPath,
      MEGADESK_PROMOTION_PUBLIC_KEY_SHA256: sha256(fixture.publicBytes),
    }, { now: testNow })).rejects.toMatchObject({ code: "AUTHORIZATION_SIGNATURE_INVALID" });
  });

  it("rejects a corrupted authorization signature", async () => {
    const fixture = await attackerAuthorizationFixture();
    const parsed = JSON.parse(fixture.raw.toString("utf8"));
    parsed.signature = Buffer.alloc(64, 7).toString("base64");
    const corrupted = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
    await writeFile(fixture.authorizationPath, corrupted);
    await expect(loadAuthorization(fixture.environment, { now: testNow }))
      .rejects.toMatchObject({ code: "AUTHORIZATION_SIGNATURE_INVALID" });
  });

  it("requires one exact valid release SHA and approved candidate artifacts in authorization", () => {
    expect(() => assertAuthorizationPayload(authorizationPayload(), testNow)).not.toThrow();
    expect(() => assertAuthorizationPayload(authorizationPayload({ release: undefined }), testNow))
      .toThrowError(expect.objectContaining({ code: "RELEASE_IDENTITY_REQUIRED" }));
    expect(() => assertAuthorizationPayload(authorizationPayload({ release: { gitCommit: "not-a-commit" } }), testNow))
      .toThrowError(expect.objectContaining({ code: "RELEASE_IDENTITY_INVALID" }));
    expect(() => assertAuthorizationPayload(authorizationPayload({
      candidate: { release: { gitCommit: "b".repeat(40) }, database: { fingerprint: constants.APPROVED_DATABASE_FINGERPRINT }, storage: { fingerprint: constants.APPROVED_STORAGE_MANIFEST } },
    }), testNow)).toThrowError(expect.objectContaining({ code: "RELEASE_IDENTITY_MISMATCH" }));
    expect(() => assertAuthorizationPayload(authorizationPayload({
      candidate: { release: { gitCommit }, database: { fingerprint: "1".repeat(64) }, storage: { fingerprint: constants.APPROVED_STORAGE_MANIFEST } },
    }), testNow)).toThrowError(expect.objectContaining({ code: "APPROVED_CANDIDATE_MISMATCH" }));
    expect(() => assertReleaseBinding(gitCommit, "b".repeat(40)))
      .toThrowError(expect.objectContaining({ code: "RELEASE_IDENTITY_MISMATCH" }));
  });

  it("requires exact freeze artifact binding before considering its signed assertions", async () => {
    const evidencePath = await writeFreezeEvidence();
    const ctx = { auth: authorizationPayload(), environment: { MEGADESK_PROMOTION_FREEZE_EVIDENCE_FILE: evidencePath } };
    await expect(loadTrustedFreezeEvidence({ ...ctx, auth: authorizationPayload({
      freeze: { requestId: freezeRequestId, freezeId, evidenceSha256: "0".repeat(64) },
    }) }, gitCommit, { now: testNow })).rejects.toMatchObject({ code: "FREEZE_EVIDENCE_SUBSTITUTION" });
    expect(() => assertFreezeEvidencePayload(trustedFreezeEvidence.payload, ctx.auth, gitCommit, testNow)).not.toThrow();
  });

  it("rejects freeze evidence with an invalid signature", async () => {
    const corrupted = { ...trustedFreezeEvidence, signature: Buffer.alloc(64, 9).toString("base64") };
    const evidencePath = await writeFreezeEvidence(corrupted);
    const ctx = {
      auth: authorizationPayload({ freeze: { requestId: freezeRequestId, freezeId, evidenceSha256: sha256(freezeEvidenceBytes(corrupted)) } }),
      environment: { MEGADESK_PROMOTION_FREEZE_EVIDENCE_FILE: evidencePath },
    };
    await expect(loadTrustedFreezeEvidence(ctx, gitCommit, { now: testNow }))
      .rejects.toMatchObject({ code: "FREEZE_EVIDENCE_SIGNATURE_INVALID" });
  });

  it("fails closed when freeze evidence is absent, stale, inactive, or not drained", async () => {
    const auth = authorizationPayload();
    await expect(loadTrustedFreezeEvidence({ auth, environment: {} }, gitCommit, { now: testNow }))
      .rejects.toMatchObject({ code: "FREEZE_EVIDENCE_REQUIRED" });
    expect(() => assertFreezeEvidencePayload({ ...trustedFreezeEvidence.payload, active: false }, auth, gitCommit, testNow))
      .toThrowError(expect.objectContaining({ code: "FREEZE_NOT_ACTIVE" }));
    expect(() => assertFreezeEvidencePayload({ ...trustedFreezeEvidence.payload, writersDrained: false }, auth, gitCommit, testNow))
      .toThrowError(expect.objectContaining({ code: "WRITERS_NOT_DRAINED" }));
    expect(() => assertFreezeEvidencePayload({ ...trustedFreezeEvidence.payload, expiresAt: "2030-01-01T00:20:00.000Z" }, auth, gitCommit, testNow))
      .toThrowError(expect.objectContaining({ code: "FREEZE_EVIDENCE_STALE" }));
  });

  it("rejects freeze evidence bound to another operation, release, target, or freeze identity", () => {
    const auth = authorizationPayload();
    expect(() => assertFreezeEvidencePayload({ ...trustedFreezeEvidence.payload, operationId: "44444444-4444-4444-8444-444444444444" }, auth, gitCommit, testNow))
      .toThrowError(expect.objectContaining({ code: "FREEZE_OPERATION_MISMATCH" }));
    expect(() => assertFreezeEvidencePayload({ ...trustedFreezeEvidence.payload, requestId: "55555555-5555-4555-8555-555555555555" }, auth, gitCommit, testNow))
      .toThrowError(expect.objectContaining({ code: "FREEZE_REQUEST_MISMATCH" }));
    expect(() => assertFreezeEvidencePayload({ ...trustedFreezeEvidence.payload, freezeId: "44444444-4444-4444-8444-444444444444" }, auth, gitCommit, testNow))
      .toThrowError(expect.objectContaining({ code: "FREEZE_IDENTITY_MISMATCH" }));
    expect(() => assertFreezeEvidencePayload({ ...trustedFreezeEvidence.payload, release: { gitCommit: "b".repeat(40) } }, auth, gitCommit, testNow))
      .toThrowError(expect.objectContaining({ code: "FREEZE_RELEASE_MISMATCH" }));
    expect(() => assertFreezeEvidencePayload({ ...trustedFreezeEvidence.payload, target: { hostname: "other", database: "other" } }, auth, gitCommit, testNow))
      .toThrowError(expect.objectContaining({ code: "FREEZE_TARGET_MISMATCH" }));
  });

  it("requires restore-verified backup evidence before a destructive boundary", () => {
    const preState = {
      database: { fingerprint: "1".repeat(64) },
      storage: { fingerprint: "2".repeat(64), files: 3, bytes: 9 },
    };
    const ctx = {
      auth: { backup: { database: { path: path.join(tmpdir(), "trusted-backup.sql") } }, preState },
      backup: {
        database: { path: path.join(tmpdir(), "trusted-backup.sql"), bytes: 1, sha256: "3".repeat(64) },
        storage: preState.storage,
        restoredDb: preState.database.fingerprint,
        restoredStorage: preState.storage.fingerprint,
      },
    };
    expect(() => assertBackupEvidence(ctx)).not.toThrow();
    expect(() => assertBackupEvidence({ ...ctx, backup: null })).toThrowError(expect.objectContaining({ code: "BACKUP_EVIDENCE_REQUIRED" }));
    expect(() => assertBackupEvidence({ ...ctx, backup: { ...ctx.backup, storage: { ...preState.storage, fingerprint: "4".repeat(64) } } }))
      .toThrowError(expect.objectContaining({ code: "BACKUP_EVIDENCE_INVALID" }));
  });

  it("performs zero writes for each central destructive-boundary rejection", async () => {
    for (const code of ["FREEZE_EVIDENCE_REQUIRED", "BACKUP_EVIDENCE_REQUIRED", "DATABASE_FINGERPRINT_MISMATCH", "PRESTATE_STORAGE_MISMATCH", "RELEASE_IDENTITY_MISMATCH"]) {
      let writes = 0;
      const denied = Object.assign(new Error(code), { code });
      await expect(runDestructivePromotion({}, {}, {
        boundary: async () => { throw denied; },
        write: async () => { writes += 1; },
      })).rejects.toMatchObject({ code });
      expect(writes).toBe(0);
    }
  });

  it("pins production operations and the global lock to the compiled cutover root", () => {
    const auth = {
      target: {
        class: "oracle-main",
        host: { hostname: constants.PRODUCTION_HOSTNAME },
        mysql: {
          container: { name: constants.PRODUCTION_MYSQL_CONTAINER },
          database: constants.PRODUCTION_DATABASE,
          user: "root",
          url: `mysql://root@172.30.0.2:3306/${constants.PRODUCTION_DATABASE}`,
          network: { ipAddress: "172.30.0.2" },
        },
        application: { container: { name: constants.PRODUCTION_APP_CONTAINER } },
        storage: { root: constants.PRODUCTION_STORAGE_ROOT },
      },
      verification: {
        backupDatabase: "megadesk_test_main_backup_verify_unit",
        candidateDatabase: "megadesk_test_main_candidate_verify_unit",
      },
      paths: {
        allowedRoot: constants.PRODUCTION_OPERATIONS_ROOT,
        lock: constants.PRODUCTION_LOCK_PATH,
      },
    };
    expect(() => assertTargetPolicy(auth, { MEGADESK_PROMOTION_MODE: "oracle-main" })).not.toThrow();
    expect(() => assertTargetPolicy({ ...auth, paths: { ...auth.paths, allowedRoot: "/tmp/unit-operation" } }, { MEGADESK_PROMOTION_MODE: "oracle-main" }))
      .toThrowError(expect.objectContaining({ code: "PRODUCTION_TARGET_POLICY_MISMATCH" }));
    expect(() => assertTargetPolicy({ ...auth, paths: { ...auth.paths, lock: `${auth.paths.allowedRoot}/local.lock` } }, { MEGADESK_PROMOTION_MODE: "oracle-main" }))
      .toThrowError(expect.objectContaining({ code: "PRODUCTION_TARGET_POLICY_MISMATCH" }));
    expect(() => assertTargetPolicy({ ...auth, paths: { ...auth.paths, allowedRoot: `${constants.PRODUCTION_OPERATIONS_ROOT}/unit-operation` } }, { MEGADESK_PROMOTION_MODE: "oracle-main" }))
      .toThrowError(expect.objectContaining({ code: "PRODUCTION_TARGET_POLICY_MISMATCH" }));
    expect(() => assertTargetPolicy({ ...auth, target: { ...auth.target, host: { hostname: "not-oracle" } } }, { MEGADESK_PROMOTION_MODE: "oracle-main" }))
      .toThrowError(expect.objectContaining({ code: "PRODUCTION_TARGET_POLICY_MISMATCH" }));
    expect(() => assertTargetPolicy({ ...auth, target: { ...auth.target, mysql: { ...auth.target.mysql, database: "megadesk_test_wrong", url: "mysql://root@172.30.0.2:3306/megadesk_test_wrong" } } }, { MEGADESK_PROMOTION_MODE: "oracle-main" }))
      .toThrowError(expect.objectContaining({ code: "PRODUCTION_TARGET_POLICY_MISMATCH" }));
  });

  it("rejects Windows before any destructive production path", () => {
    expect(() => assertDestructivePlatform("promote", "win32"))
      .toThrowError(expect.objectContaining({ code: "STORAGE_TARGET_BINDING_UNSUPPORTED" }));
    expect(() => assertDestructivePlatform("rollback", "win32"))
      .toThrowError(expect.objectContaining({ code: "STORAGE_TARGET_BINDING_UNSUPPORTED" }));
    expect(() => assertDestructivePlatform("verify", "win32")).not.toThrow();
  });

  it("fails closed for an isolated rehearsal whose signed identities are not jointly derived", () => {
    const auth = isolatedRehearsalAuthorization();
    expect(() => assertTargetPolicy({
      ...auth,
      rehearsal: { ...auth.rehearsal, network: "megadesk-test-other-net" },
    }, {
      MEGADESK_PROMOTION_MODE: "oracle-main-shaped-disposable",
      MEGADESK_PROMOTION_ALLOW_DISPOSABLE: "YES",
      MEGADESK_PROMOTION_ISOLATED_REHEARSAL: "YES",
    })).toThrowError(expect.objectContaining({ code: "ISOLATED_REHEARSAL_POLICY_MISMATCH" }));
  });

  it.runIf(process.platform === "linux")("accepts a fully derived isolated rehearsal only with its explicit guard", () => {
    const auth = isolatedRehearsalAuthorization();
    expect(() => assertTargetPolicy(auth, {
      MEGADESK_PROMOTION_MODE: "oracle-main-shaped-disposable",
      MEGADESK_PROMOTION_ALLOW_DISPOSABLE: "YES",
      MEGADESK_PROMOTION_ISOLATED_REHEARSAL: "YES",
    })).not.toThrow();
    expect(() => assertTargetPolicy(auth, {
      MEGADESK_PROMOTION_MODE: "oracle-main-shaped-disposable",
      MEGADESK_PROMOTION_ALLOW_DISPOSABLE: "YES",
    })).toThrowError(expect.objectContaining({ code: "ISOLATED_REHEARSAL_POLICY_MISMATCH" }));
  });

});

describe("promotion storage fingerprint", () => {
  it("is content-domain deterministic and detects content changes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "megadesk-promotion-storage-test-"));
    roots.push(root);
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "nested", "a.bin"), "one");
    const first = await storageSnapshot(root);
    const second = await storageSnapshot(root);
    expect(second.fingerprint).toBe(first.fingerprint);
    await writeFile(path.join(root, "nested", "a.bin"), "two");
    expect((await storageSnapshot(root)).fingerprint).not.toBe(first.fingerprint);
  });

  it("fails closed on a symbolic link", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "megadesk-promotion-symlink-test-"));
    roots.push(root);
    const outside = await mkdtemp(path.join(tmpdir(), "megadesk-promotion-symlink-outside-"));
    roots.push(outside);
    try {
      await symlink(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    } catch (error: any) {
      if (process.platform === "win32" && error?.code === "EPERM") return;
      throw error;
    }
    await expect(storageSnapshot(root)).rejects.toMatchObject({ code: "STORAGE_SYMLINK" });
  });
});
