import { afterEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertTargetPolicy, constants, directSqlLiteral, isGeneratedColumnExtra, run, storageSnapshot } from "../scripts/reconciliation/oracle-main-promotion.mjs";

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

async function authorizationFixture(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "megadesk-promotion-auth-test-"));
  roots.push(root);
  const allowedRoot = path.join(root, constants.REHEARSAL_ROOT_SUFFIX);
  await mkdir(allowedRoot, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicPath = path.join(root, "public.pem");
  const authorizationPath = path.join(root, "authorization.json");
  const human = "synthetic-human-authorization-proof-for-tests-only";
  const payload = {
    operationId: "11111111-1111-4111-8111-111111111111",
    authorizationId: "22222222-2222-4222-8222-222222222222",
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    singleUse: true,
    allowedActions: ["verify"],
    freezeBoundaryId: constants.EXPECTED_FREEZE_BOUNDARY,
    humanAuthorizationSha256: sha256(human),
    candidate: {
      database: { fingerprint: constants.APPROVED_DATABASE_FINGERPRINT },
      storage: { fingerprint: constants.APPROVED_STORAGE_MANIFEST },
    },
    target: {
      class: "oracle-main-shaped-disposable",
      host: {},
      mysql: { container: { name: "megadesk-test-main-promotion-unit" }, database: "megadesk_test_main_promotion_unit", url: "mysql://root@127.0.0.1:33329/megadesk_test_main_promotion_unit", user: "root" },
      storage: { root: path.join(allowedRoot, "target") },
      application: { container: { name: "megadesk-test-main-promotion-app-unit" } },
    },
    verification: { backupDatabase: "megadesk_test_backup_verify_unit", candidateDatabase: "megadesk_test_candidate_verify_unit" },
    paths: { allowedRoot },
    ...overrides,
  };
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
      MEGADESK_PROMOTION_AUTHORIZATION_SHA256: sha256(raw),
      MEGADESK_PROMOTION_PUBLIC_KEY_FILE: publicPath,
      MEGADESK_PROMOTION_PUBLIC_KEY_SHA256: sha256(publicBytes),
      MEGADESK_PROMOTION_OPERATION_ID: payload.operationId,
      MEGADESK_PROMOTION_AUTHORIZATION_ID: payload.authorizationId,
      MEGADESK_PROMOTION_HUMAN_AUTHORIZATION: human,
      MEGADESK_PROMOTION_MODE: "oracle-main-shaped-disposable",
      MEGADESK_PROMOTION_ALLOW_DISPOSABLE: "YES",
      MEGADESK_PROMOTION_DATABASE_PASSWORD: "synthetic-only",
    },
  };
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
  });

  it("rejects an authorization artifact that differs from its external hash pin", async () => {
    const fixture = await authorizationFixture();
    await expect(run("verify", { ...fixture.environment, MEGADESK_PROMOTION_AUTHORIZATION_SHA256: "0".repeat(64) }))
      .rejects.toMatchObject({ code: "AUTHORIZATION_PIN_MISMATCH" });
  });

  it("rejects a validly signed artifact that tries to self-authorize another candidate", async () => {
    const fixture = await authorizationFixture({
      candidate: {
        database: { fingerprint: "1".repeat(64) },
        storage: { fingerprint: constants.APPROVED_STORAGE_MANIFEST },
      },
    });
    await expect(run("verify", fixture.environment)).rejects.toMatchObject({ code: "APPROVED_CANDIDATE_MISMATCH" });
  });

  it("rejects a corrupted signature even when the artifact hash is externally repinned", async () => {
    const fixture = await authorizationFixture();
    const parsed = JSON.parse(fixture.raw.toString("utf8"));
    parsed.signature = Buffer.alloc(64, 7).toString("base64");
    const corrupted = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
    await writeFile(fixture.authorizationPath, corrupted);
    await expect(run("verify", { ...fixture.environment, MEGADESK_PROMOTION_AUTHORIZATION_SHA256: sha256(corrupted) }))
      .rejects.toMatchObject({ code: "AUTHORIZATION_SIGNATURE_INVALID" });
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

  it("forbids failure injection before any production identity inspection", async () => {
    const operationRoot = constants.PRODUCTION_OPERATIONS_ROOT;
    const fixture = await authorizationFixture({
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
        allowedRoot: operationRoot,
        lock: constants.PRODUCTION_LOCK_PATH,
      },
    });
    await expect(run("verify", {
      ...fixture.environment,
      MEGADESK_PROMOTION_MODE: "oracle-main",
      MEGADESK_PROMOTION_ALLOW_DISPOSABLE: "NO",
      MEGADESK_PROMOTION_INJECT_FAILURE: "before_backup",
    })).rejects.toMatchObject({ code: "TEST_CONTROL_FORBIDDEN" });
  });

  it("forbids candidate and target timing hooks in production mode before any target access", async () => {
    const fixture = await authorizationFixture({
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
      paths: { allowedRoot: constants.PRODUCTION_OPERATIONS_ROOT, lock: constants.PRODUCTION_LOCK_PATH },
    });
    await expect(run("verify", {
      ...fixture.environment,
      MEGADESK_PROMOTION_MODE: "oracle-main",
      MEGADESK_PROMOTION_ALLOW_DISPOSABLE: "NO",
      MEGADESK_PROMOTION_TEST_HOOK: "before_db_promotion",
      MEGADESK_PROMOTION_TEST_HOOK_ROOT: path.join(tmpdir(), "not-authorized"),
    })).rejects.toMatchObject({ code: "TEST_CONTROL_FORBIDDEN" });
  });

  it.runIf(process.platform !== "linux")("fails closed before target inspection when the platform cannot bind a storage directory object", async () => {
    const fixture = await authorizationFixture({ allowedActions: ["promote"] });
    await expect(run("promote", fixture.environment)).rejects.toMatchObject({ code: "STORAGE_TARGET_BINDING_UNSUPPORTED" });
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
