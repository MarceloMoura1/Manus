import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ReconciliationError,
  assertCanonicalMappingShape,
  assertDistinctDatabaseNames,
  assertNoSecretMaterial,
  assertPendingReceiptTtl,
  assertRuntimeMapping,
  assertParentMapping,
  assertStagingDatabaseName,
  assertStagingDatabaseUrl,
  assertTenantSafe,
  classifyPendingReceipt,
  classifyDuplicate,
  payloadHash,
} from "../scripts/reconciliation/reconciler.mjs";
import { assertDistinctStorageRoots, mergeManifestEntries, mergeStorage, normalizeStoragePath, resolveStorageReference } from "../scripts/reconciliation/storage-merge.mjs";

const hash = (character: string) => character.repeat(64);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

describe("deterministic reconciliation safety primitives", () => {
  it("rejects any database name outside the disposable namespace", () => {
    expect(() => assertStagingDatabaseName("megadesk_local")).toThrowError(ReconciliationError);
    expect(() => assertStagingDatabaseName("megadesk_test_reconciliation_a")).not.toThrow();
  });

  it("rejects a disposable-looking database on a non-loopback host", () => {
    expect(() => assertStagingDatabaseUrl("mysql://synthetic@db.example/megadesk_test_reconciliation_a")).toThrowError(
      expect.objectContaining({ code: "NON_LOCAL_STAGING_HOST" }),
    );
    expect(() => assertStagingDatabaseUrl("mysql://synthetic@127.0.0.1/megadesk_test_reconciliation_a")).not.toThrow();
  });

  it("rejects a tautological validation topology", () => {
    expect(() => assertDistinctDatabaseNames({ source: "megadesk_test_a", baseline: "megadesk_test_b", target: "megadesk_test_b" })).toThrowError(
      expect.objectContaining({ code: "DATABASE_ROLE_COLLISION" }),
    );
  });

  it("fails closed on an incompatible tenant mapping", () => {
    expect(() => assertTenantSafe("tenant-b", "tenant-a", "canonical-a")).toThrowError(
      expect.objectContaining({ code: "CROSS_TENANT_SOURCE" }),
    );
  });

  it("blocks a child whose parent has not been mapped", () => {
    expect(() => assertParentMapping("conversation-a", new Map(), "conversation_id")).toThrowError(
      expect.objectContaining({ code: "MISSING_PARENT" }),
    );
  });

  it("treats equal external payload as replay and changed payload as conflict", () => {
    const original = payloadHash({ external_message_id: "provider-1", message: "a" });
    expect(classifyDuplicate(original, original)).toBe("REPLAY");
    expect(classifyDuplicate(original, payloadHash({ external_message_id: "provider-1", message: "b" }))).toBe("CONFLICT");
  });

  it("enforces monotonic pending receipt state", () => {
    const current = { receipt_id: "oracle", client_id: "canonical", status: "delivered", status_rank: 3, replay_state: "replayed" };
    expect(classifyPendingReceipt(current, { ...current, receipt_id: "windows", status: "sent", status_rank: 2 })).toBe("PRESERVE");
    expect(classifyPendingReceipt(current, { ...current, receipt_id: "windows" })).toBe("REPLAY");
    expect(classifyPendingReceipt(current, { ...current, receipt_id: "windows", status: "read", status_rank: 4 })).toBe("ADVANCE");
    expect(classifyPendingReceipt(current, { ...current, receipt_id: "windows", status: "read", status_rank: 30 })).toBe("CONFLICT");
    expect(classifyPendingReceipt(current, { ...current, receipt_id: "windows", status: "failed", status_rank: 6 })).toBe("PRESERVE");
    expect(classifyPendingReceipt({ ...current, status: "sent", status_rank: 2 }, { ...current, status: "failed", status_rank: 6 })).toBe("ADVANCE");
  });

  it("rejects invalid pending receipt TTLs and replay-state regression", () => {
    expect(() => assertPendingReceiptTtl({ received_at: "2026-01-01T01:00:00Z", expires_at: "2026-01-01T00:59:59Z" })).toThrowError(
      expect.objectContaining({ code: "INVALID_PENDING_RECEIPT_TTL" }),
    );
    const current = { status: "delivered", status_rank: 3, replay_state: "replayed" };
    expect(classifyPendingReceipt(current, { ...current, status: "read", status_rank: 4, replay_state: "pending" })).toBe("CONFLICT");
  });

  it("rejects nested credential material instead of merely excluding it from hashes", () => {
    expect(() => assertNoSecretMaterial({ metadata_json: JSON.stringify({ nested: { cloudflareTunnelToken: "secret" } }) })).toThrowError(
      expect.objectContaining({ code: "SECRET_MATERIAL_BLOCKED" }),
    );
    expect(() => assertNoSecretMaterial({ metadata_json: JSON.stringify({ nested: { theme: "dark" } }) })).not.toThrow();
  });

  it("CONTRACT distinguishes provider message payload from operational credentials", () => {
    const providerPayload = { provider_message_reference: JSON.stringify({
      key: { id: "provider-id" }, message: { messageContextInfo: { messageSecret: "message-payload" } },
    }) };
    expect(() => assertNoSecretMaterial(providerPayload)).not.toThrow();
    expect(() => assertNoSecretMaterial({
      provider_message_reference: JSON.stringify({ key: { id: "provider-id" }, clientSecret: "credential" }),
    })).toThrowError(expect.objectContaining({ code: "SECRET_MATERIAL_BLOCKED" }));
  });

  it("rejects malformed canonical mappings", () => {
    expect(() => assertCanonicalMappingShape({ wrong_id: "x" }, ["message_id"])).toThrowError(
      expect.objectContaining({ code: "CORRUPT_MAPPING" }),
    );
    expect(assertCanonicalMappingShape({ message_id: "x" }, ["message_id"])).toEqual({ message_id: "x" });
  });

  it("accepts only the exact pseudonymous runtime mapping shape", () => {
    const mapping = {
      sourceTenantSha256: hash("a"), targetTenantSha256: hash("b"),
      sourceAdminEmailSha256: hash("c"), targetAdminEmailSha256: hash("d"),
    };
    expect(assertRuntimeMapping(mapping)).toEqual(mapping);
    expect(() => assertRuntimeMapping({ ...mapping, note: "ignored input" })).toThrowError(
      expect.objectContaining({ code: "INVALID_RUNTIME_MAPPING" }),
    );
  });

  it("excludes credential material from deterministic payload hashes", () => {
    const left = payloadHash({ id: "u1", role: "admin", password_hash: "secret-a" }, ["password_hash"]);
    const right = payloadHash({ id: "u1", role: "admin", password_hash: "secret-b" }, ["password_hash"]);
    expect(left).toBe(right);
    expect(payloadHash({ id: "u1", cloudflare_tunnel_token: "a" })).toBe(payloadHash({ id: "u1", cloudflare_tunnel_token: "b" }));
    expect(() => assertNoSecretMaterial({ password_hash: "secret" })).toThrowError(
      expect.objectContaining({ code: "SECRET_MATERIAL_BLOCKED" }),
    );
  });

  it("rejects a storage path collision with different hashes", () => {
    const windows = [{ relative_path: "objects/a.webp", size: "1", sha256: hash("a"), mtime_utc: "now" }];
    const oracle = [{ relative_path: "objects/a.webp", size: "1", sha256: hash("b"), mtime_utc: "before" }];
    expect(() => mergeManifestEntries(windows, oracle)).toThrowError(
      expect.objectContaining({ code: "STORAGE_PATH_CONFLICT" }),
    );
  });

  it("merges disjoint storage manifests without inventing identity", () => {
    const result = mergeManifestEntries(
      [{ relative_path: "windows/a", size: "2", sha256: hash("a"), mtime_utc: "now" }],
      [{ relative_path: "oracle/b", size: "3", sha256: hash("b"), mtime_utc: "before" }],
    );
    expect(result.stats).toMatchObject({ windowsOnly: 1, oracleOnly: 1, pathConflicts: 0 });
    expect(result.entries).toHaveLength(2);
  });

  it("rejects traversal, absolute, non-normalized, and case-fold-colliding storage paths", () => {
    for (const invalid of ["../escape", "a/../escape", "/absolute", "C:/absolute", "e\u0301/file", "file:stream", "dir/name.", "CON/file"]) {
      expect(() => normalizeStoragePath(invalid)).toThrowError(ReconciliationError);
    }
    expect(() => mergeManifestEntries(
      [{ relative_path: "Objects/A.webp", size: "1", sha256: hash("a"), mtime_utc: "now" }],
      [{ relative_path: "objects/a.webp", size: "1", sha256: hash("a"), mtime_utc: "before" }],
    )).toThrowError(expect.objectContaining({ code: "STORAGE_CASE_COLLISION" }));
  });

  it("rejects overlapping storage roots and omission of database-reference validation", async () => {
    expect(() => assertDistinctStorageRoots("C:/staging/windows", "C:/staging/oracle", "C:/staging/windows/canonical")).toThrowError(
      expect.objectContaining({ code: "OVERLAPPING_STORAGE_ROOTS" }),
    );
    await expect(mergeStorage({ windowsRoot: "C:/a", oracleRoot: "C:/b", targetRoot: "C:/c" } as any))
      .rejects.toMatchObject({ code: "STORAGE_DATABASE_REQUIRED" });
  });

  it("resolves a database object id only when exactly one frozen object matches", () => {
    const entries = [{ relativePath: "tenants/t1/files/unique-object.webp" }];
    expect(resolveStorageReference("unique-object", entries)).toMatchObject({ mode: "UNIQUE_OBJECT_ID" });
    expect(() => resolveStorageReference("same", [
      { relativePath: "a/same.webp" },
      { relativePath: "b/same.bin" },
    ])).toThrowError(expect.objectContaining({ code: "AMBIGUOUS_STORAGE_REFERENCE" }));
  });

  it("CAUSAL validates both physical copies of a common manifest object", async () => {
    const root = await mkdtemp(join(tmpdir(), "megadesk-reconciliation-storage-"));
    try {
      const windowsRoot = join(root, "windows");
      const oracleRoot = join(root, "oracle");
      const targetRoot = join(root, "target");
      await mkdir(join(windowsRoot, "objects"), { recursive: true });
      await mkdir(join(oracleRoot, "objects"), { recursive: true });
      await mkdir(targetRoot);
      await writeFile(join(windowsRoot, "objects", "a.bin"), "evil");
      await writeFile(join(oracleRoot, "objects", "a.bin"), "safe");
      const expected = digest("safe");
      const windowsManifest = join(root, "windows.csv");
      const oracleManifest = join(root, "oracle.tsv");
      await writeFile(windowsManifest, `relative_path,size,sha256,mtime_utc\nobjects/a.bin,4,${expected},now\n`);
      await writeFile(oracleManifest, `objects/a.bin\t4\t${expected}\tnow\n`);
      await expect(mergeStorage({ windowsManifest, oracleManifest, windowsRoot, oracleRoot, targetRoot, reportFile: join(root, "report.json"), allowNoDatabaseForUnitTest: true }))
        .rejects.toMatchObject({ code: "STORAGE_SOURCE_HASH_MISMATCH" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("CAUSAL rejects a hardlinked source object", async () => {
    const root = await mkdtemp(join(tmpdir(), "megadesk-reconciliation-hardlink-"));
    try {
      const windowsRoot = join(root, "windows");
      const oracleRoot = join(root, "oracle");
      const targetRoot = join(root, "target");
      await mkdir(join(windowsRoot, "objects"), { recursive: true });
      await mkdir(oracleRoot);
      await mkdir(targetRoot);
      const source = join(windowsRoot, "objects", "a.bin");
      await writeFile(source, "safe");
      await link(source, join(windowsRoot, "objects", "alias.bin"));
      const windowsManifest = join(root, "windows.csv");
      const oracleManifest = join(root, "oracle.tsv");
      await writeFile(windowsManifest, `relative_path,size,sha256,mtime_utc\nobjects/a.bin,4,${digest("safe")},now\n`);
      await writeFile(oracleManifest, "");
      await expect(mergeStorage({ windowsManifest, oracleManifest, windowsRoot, oracleRoot, targetRoot, reportFile: join(root, "report.json"), allowNoDatabaseForUnitTest: true }))
        .rejects.toMatchObject({ code: "UNSAFE_STORAGE_FILE" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
