import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ErpDomainError } from "../errors";
import {
  assertRestoreSyntheticProbeEnvironment,
  RestoreSyntheticProbeError,
  runSyntheticProbe,
  type SyntheticProbeDependencies,
} from "./restore-synthetic-probe";

const bytes = Buffer.from("MegaDesk restore synthetic media probe v1\n", "utf8");
const sha256 = createHash("sha256").update(bytes).digest("hex");

function failureCode(task: () => void): string | undefined {
  try { task(); } catch (error) {
    return error instanceof RestoreSyntheticProbeError ? error.code : undefined;
  }
  return undefined;
}

function dependencies(overrides: Partial<SyntheticProbeDependencies> = {}): SyntheticProbeDependencies {
  let removed = false;
  return {
    async createFixture() {
      return {
        admin: { clientId: "restore-probe-a", userId: "admin", userName: "Admin", role: "admin" },
        viewer: { clientId: "restore-probe-a", userId: "viewer", userName: "Viewer", role: "viewer" },
        otherTenant: { clientId: "restore-probe-b", userId: "other", userName: "Other", role: "admin" },
        salePublicId: "11111111-1111-4111-8111-111111111111",
        cleanup: async () => undefined,
      };
    },
    async upload(identity) {
      if (identity.role !== "admin") throw new ErpDomainError("FORBIDDEN", "synthetic viewer denial");
      return { publicId: "22222222-2222-4222-8222-222222222222", sha256 };
    },
    async download(identity) {
      if (identity.clientId === "restore-probe-b") throw new ErpDomainError("NOT_FOUND", "synthetic tenant denial");
      if (removed) throw new ErpDomainError("NOT_FOUND", "synthetic missing media");
      return { bytes };
    },
    async removeObject() { removed = true; },
    ...overrides,
  };
}

describe("restore synthetic sale-document probe", () => {
  it("proves the canonical metadata-to-media read, authorization, tenant isolation, and missing-object path", async () => {
    await expect(runSyntheticProbe(dependencies())).resolves.toEqual({ sha256 });
  });

  it("fails closed when metadata and object bytes have different hashes", async () => {
    await expect(runSyntheticProbe(dependencies({
      async upload() { return { publicId: "22222222-2222-4222-8222-222222222222", sha256: "0".repeat(64) }; },
    }))).rejects.toMatchObject({ code: "PROBE_HASH_MISMATCH" } satisfies Partial<RestoreSyntheticProbeError>);
  });

  it("fails when the canonical service does not enforce authorization or the missing-reference result", async () => {
    await expect(runSyntheticProbe(dependencies({
      async upload() { return { publicId: "22222222-2222-4222-8222-222222222222", sha256 }; },
    }))).rejects.toMatchObject({ code: "PROBE_EXPECTED_DENIAL" } satisfies Partial<RestoreSyntheticProbeError>);

    await expect(runSyntheticProbe(dependencies({
      async download() { return { bytes }; },
    }))).rejects.toMatchObject({ code: "PROBE_EXPECTED_DENIAL" } satisfies Partial<RestoreSyntheticProbeError>);
  });

  it("rejects missing restore opt-in, production-shaped targets, and external-service configuration", () => {
    expect(failureCode(() => assertRestoreSyntheticProbeEnvironment({}))).toBe("PROBE_ENVIRONMENT_REQUIRED");
    const safe = {
      MEGADESK_RESTORE_HARNESS: "1", MEGADESK_RESTORE_PROBE: "1", MEGADESK_RESTORE_ENVIRONMENT_ID: "restore-v5-proof",
      NODE_ENV: "development", RUN_DATABASE_INTEGRATION: "1", DATABASE_URL: "mysql://synthetic:synthetic@mysql-test:3306/megadesk_test_restore_v5_proof",
      TEST_DATABASE_URL: "mysql://synthetic:synthetic@mysql-test:3306/megadesk_test_restore_v5_proof",
      MEGADESK_MEDIA_ROOT: "/opt/megadesk/storage", MEGADESK_DISPOSABLE_MEDIA_ROOT: "/opt/megadesk/storage",
    };
    expect(() => assertRestoreSyntheticProbeEnvironment(safe)).not.toThrow();
    expect(failureCode(() => assertRestoreSyntheticProbeEnvironment({ ...safe, DATABASE_URL: "mysql://synthetic:synthetic@mysql-test:3306/megadesk_local" }))).toBe("PROBE_DATABASE_UNSAFE");
    expect(failureCode(() => assertRestoreSyntheticProbeEnvironment({ ...safe, EVOLUTION_API_KEY: "not-allowed" }))).toBe("PROBE_ENVIRONMENT_UNSAFE");
  });
});
