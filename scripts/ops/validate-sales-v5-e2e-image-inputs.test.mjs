import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { rejectLegacyBuildInputs, validateQualificationInputs } from "./validate-sales-v5-e2e-image-inputs.mjs";

const base = "registry.example.test/megadesk/node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const snapshot = "https://snapshot.debian.org/archive/debian/20261019T000000Z/";
const pnpmTarballUrl = "https://packages.example.test/pnpm-10.18.0.tgz";
const pnpmTarballSha256 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("Legacy free-form qualification input contract", () => {
  it("rejects even formerly valid free-form image, APT, and pnpm values", () => {
    assert.throws(() => validateQualificationInputs({ nodeBaseImage: base, aptSnapshot: snapshot, pnpmTarballUrl, pnpmTarballSha256 }), /Entradas livres de build foram removidas/);
  });

  for (const nodeBaseImage of [
    "node:22-bookworm",
    "registry.example.test/node:22-bookworm@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "node@sha256:short",
    "registry.example.test/node@sha256:<approved-digest>",
    "registry.example.test/node@sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  ]) {
    it(`rejects an ambiguous base image reference: ${nodeBaseImage}`, () => {
      assert.throws(() => validateQualificationInputs({ nodeBaseImage, aptSnapshot: snapshot, pnpmTarballUrl, pnpmTarballSha256 }), /Entradas livres de build foram removidas/);
    });
  }

  for (const aptSnapshot of [
    "https://deb.debian.org/debian/",
    "https://snapshot.debian.org/archive/debian/latest/",
    "https://snapshot.debian.org/archive/debian/20261019T000000Z",
  ]) {
    it(`rejects a mutable or malformed snapshot: ${aptSnapshot}`, () => {
      assert.throws(() => validateQualificationInputs({ nodeBaseImage: base, aptSnapshot, pnpmTarballUrl, pnpmTarballSha256 }), /Entradas livres de build foram removidas/);
    });
  }

  it("rejects an unverified pnpm source or checksum", () => {
    assert.throws(() => validateQualificationInputs({ nodeBaseImage: base, aptSnapshot: snapshot, pnpmTarballUrl: "https://packages.example.test/pnpm-latest.tgz", pnpmTarballSha256 }), /Entradas livres de build foram removidas/);
    assert.throws(() => validateQualificationInputs({ nodeBaseImage: base, aptSnapshot: snapshot, pnpmTarballUrl, pnpmTarballSha256: "short" }), /Entradas livres de build foram removidas/);
  });

  it("rejects every missing required immutable input", () => {
    for (const key of ["nodeBaseImage", "aptSnapshot", "pnpmTarballUrl", "pnpmTarballSha256"]) {
      const candidate = { nodeBaseImage: base, aptSnapshot: snapshot, pnpmTarballUrl, pnpmTarballSha256 };
      candidate[key] = undefined;
      assert.throws(() => validateQualificationInputs(candidate), /Entradas livres de build foram removidas/);
    }
  });
});

describe("Sales V5 E2E legacy build inputs", () => {
  it("rejects the former free-form image, APT, and pnpm inputs", () => {
    assert.throws(() => rejectLegacyBuildInputs(), /Entradas livres de build foram removidas/);
  });

  it("rejects arbitrary legacy CLI inputs with a nonzero exit status", () => {
    const script = fileURLToPath(new URL("./validate-sales-v5-e2e-image-inputs.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script, "--node-base-image", "evil:latest"], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Entradas livres de build foram removidas/);
  });
});
