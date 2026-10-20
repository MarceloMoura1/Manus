import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ProvenancePendingError,
  ProvenanceValidationError,
  POLICY_RELATIVE_PATH,
  PROVENANCE_RELATIVE_PATH,
  loadAndValidateProvenance,
  validateEvidenceFiles,
  validateProvenance,
  validateTrustPolicy,
} from "./validate-sales-v5-e2e-image-provenance.mjs";
import { generateDockerfile, renderDockerfile } from "./generate-sales-v5-e2e-dockerfile.mjs";

const digest = character => `sha256:${character.repeat(64)}`;
const sha256 = value => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "megadesk-e2e-provenance-"));
  const files = new Map([
    ["third_party/e2e-chromium/test-browser.tar.gz", Buffer.from("synthetic browser archive")],
    [".github/qualification-provenance/evidence/extracted-files.txt", Buffer.from("synthetic extracted files")],
    [".github/qualification-provenance/evidence/acquisition.json", Buffer.from("synthetic acquisition")],
    [".github/qualification-provenance/evidence/extraction.json", Buffer.from("synthetic extraction")],
    [".github/qualification-provenance/evidence/approval.json", Buffer.from("synthetic approval")],
    [".github/qualification-provenance/evidence/oci-index.json", Buffer.from("synthetic OCI index")],
    [".github/qualification-provenance/evidence/oci-platform-manifest.json", Buffer.from("synthetic OCI platform manifest")],
  ]);
  for (const [relativePath, bytes] of files) {
    const target = path.join(root, relativePath);
    await (await import("node:fs/promises")).mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  const record = relativePath => {
    const bytes = files.get(relativePath);
    return { relativePath, sha256: sha256(bytes), sizeBytes: bytes.length };
  };
  const candidate = {
    sourceImage: {
      repository: "registry.example.test/approved/node",
      indexDigest: digest("a"),
      platformManifestDigest: digest("b"),
      configDigest: digest("c"),
      platform: { os: "linux", architecture: "arm64" },
    },
    playwright: { packageVersion: "1.60.0", chromiumRevision: "1234", browserVersion: "123.0.1" },
    buildInputs: {
      aptSnapshot: "https://snapshot.debian.org/archive/debian/20261019T000000Z/",
      pnpmTarball: { url: "https://packages.example.test/pnpm-10.18.0.tgz", sha256: "d".repeat(64) },
    },
    archive: { ...record("third_party/e2e-chromium/test-browser.tar.gz"), format: "tar.gz", url: "https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/1234/chromium-linux-arm64.zip", extractedFilesManifest: record(".github/qualification-provenance/evidence/extracted-files.txt") },
    evidence: {
      acquisition: record(".github/qualification-provenance/evidence/acquisition.json"),
      extraction: record(".github/qualification-provenance/evidence/extraction.json"),
      approval: record(".github/qualification-provenance/evidence/approval.json"),
      ociIndex: record(".github/qualification-provenance/evidence/oci-index.json"),
      ociPlatformManifest: record(".github/qualification-provenance/evidence/oci-platform-manifest.json"),
    },
    finalImage: null,
  };
  const manifest = {
    schemaVersion: 1,
    status: "approved",
    expected: { platform: { os: "linux", architecture: "arm64" }, nodeVersion: "v22.23.2", pnpmVersion: "10.18.0", playwrightVersion: "1.60.0" },
    candidate,
  };
  const trustPolicy = {
    schemaVersion: 1,
    status: "approved",
    expected: manifest.expected,
    approvedCandidates: [{ sourceImage: candidate.sourceImage, playwright: candidate.playwright, buildInputs: candidate.buildInputs }],
  };
  return { root, manifest, trustPolicy };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("Sales V5 E2E ARM64 provenance", () => {
  it("requires the checked-in approved candidate to match its separate policy and evidence", async () => {
    const manifest = JSON.parse(await readFile(new URL("../../.github/qualification-provenance/sales-v5-e2e-chromium-arm64.json", import.meta.url), "utf8"));
    const trustPolicy = JSON.parse(await readFile(new URL("../../.github/qualification-provenance/sales-v5-e2e-chromium-arm64-policy.json", import.meta.url), "utf8"));
    const validated = validateProvenance(manifest, { requireApproved: true, trustPolicy });
    assert.equal(validated.status, "approved");
    await validateEvidenceFiles(validated, { repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."), requireArchive: false });
    assert.throws(() => validateProvenance(manifest, { requireApproved: true }), error => error instanceof ProvenancePendingError && error.exitCode === 78);
    await assert.rejects(
      loadAndValidateProvenance(path.join(os.tmpdir(), `absent-megadesk-provenance-${process.pid}.json`), { requireApproved: true }),
      error => error instanceof ProvenancePendingError && error.exitCode === 78,
    );
  });

  it("requires an exact approved source, Linux ARM64, and matching Playwright revision", async () => {
      const { root, manifest, trustPolicy } = await fixture();
    try {
      assert.equal(validateProvenance(manifest, { requireApproved: true, trustPolicy }).status, "approved");
      for (const mutate of [
        value => { value.candidate.sourceImage.repository = "registry.example.test/unapproved/node"; },
        value => { value.candidate.sourceImage.platform.architecture = "amd64"; },
        value => { delete value.candidate.sourceImage.configDigest; },
        value => { value.candidate.playwright.chromiumRevision = "other-revision"; },
      ]) {
        const invalid = clone(manifest);
        mutate(invalid);
        assert.throws(() => validateProvenance(invalid, { requireApproved: true, trustPolicy }), ProvenanceValidationError);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a final image claim before real build evidence and incomplete manifests", async () => {
      const { root, manifest, trustPolicy } = await fixture();
    try {
      const claimed = clone(manifest);
      claimed.candidate.finalImage = { digest: digest("e") };
      assert.throws(() => validateProvenance(claimed, { requireApproved: true, trustPolicy }), /finalImage/);
      const incomplete = clone(manifest);
      delete incomplete.candidate.evidence.approval;
      assert.throws(() => validateProvenance(incomplete, { requireApproved: true, trustPolicy }), ProvenanceValidationError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires every archive and evidence file with exact size and SHA-256", async () => {
      const { root, manifest, trustPolicy } = await fixture();
    try {
      const validated = validateProvenance(manifest, { requireApproved: true, trustPolicy });
      await validateEvidenceFiles(validated, { repoRoot: root });
      const invalidSize = clone(manifest);
      invalidSize.candidate.archive.sizeBytes += 1;
      const sizeValidated = validateProvenance(invalidSize, { requireApproved: true, trustPolicy });
      await assert.rejects(validateEvidenceFiles(sizeValidated, { repoRoot: root }), /tamanho divergente/);
      const invalidHash = clone(manifest);
      invalidHash.candidate.archive.extractedFilesManifest.sha256 = "0".repeat(64);
      const hashValidated = validateProvenance(invalidHash, { requireApproved: true, trustPolicy });
      await assert.rejects(validateEvidenceFiles(hashValidated, { repoRoot: root }), /SHA-256 divergente/);
      await rm(path.join(root, manifest.candidate.archive.relativePath));
      await assert.rejects(validateEvidenceFiles(validated, { repoRoot: root }), /ausente/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe evidence paths and policy self-approval", async () => {
    const { root, manifest, trustPolicy } = await fixture();
    try {
      for (const unsafe of [
        "/absolute.tar.gz",
        "third_party/e2e-chromium/../escape.tar.gz",
        "third_party/e2e-chromium/browser\\escape.tar.gz",
        "third_party/e2e-chromium/browser\nRUN malicious.tar.gz",
        "third_party/e2e-chromium/browser name.tar.gz",
      ]) {
        const invalid = clone(manifest);
        invalid.candidate.archive.relativePath = unsafe;
        assert.throws(() => validateProvenance(invalid, { requireApproved: true, trustPolicy }), ProvenanceValidationError);
      }
      const selfApproving = clone(manifest);
      selfApproving.approvedCandidates = trustPolicy.approvedCandidates;
      assert.throws(() => validateProvenance(selfApproving, { requireApproved: true, trustPolicy }), ProvenanceValidationError);
      const pendingPolicy = clone(trustPolicy);
      pendingPolicy.status = "pending";
      pendingPolicy.approvedCandidates = [];
      assert.equal(validateTrustPolicy(pendingPolicy).status, "pending");
      assert.throws(() => validateProvenance(manifest, { requireApproved: true, trustPolicy: pendingPolicy }), ProvenancePendingError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects internal and external evidence symlinks before hashing", async () => {
    const { root, manifest, trustPolicy } = await fixture();
    try {
      const validated = validateProvenance(manifest, { requireApproved: true, trustPolicy });
      const file = manifest.candidate.archive.relativePath;
      const metadata = { isFile: () => true, isSymbolicLink: () => false, size: manifest.candidate.archive.sizeBytes };
      await assert.rejects(
        validateEvidenceFiles(validated, {
          repoRoot: root,
          dependencies: {
            realpath: async value => value,
            lstat: async value => value.endsWith("test-browser.tar.gz") ? { ...metadata, isSymbolicLink: () => true } : metadata,
            readFile: async () => Buffer.alloc(0),
          },
        }),
        /symlink/,
      );
      await assert.rejects(
        validateEvidenceFiles(validated, {
          repoRoot: root,
          dependencies: {
            realpath: async value => value.endsWith("test-browser.tar.gz") ? `${root}-outside` : value,
            lstat: async () => metadata,
            readFile: async () => Buffer.alloc(0),
          },
        }),
        /resolve fora/,
      );
      assert.equal(file, manifest.candidate.archive.relativePath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("generates a deterministic Dockerfile only after complete approval and evidence checks", async () => {
      const { root, manifest, trustPolicy } = await fixture();
    try {
      const manifestPath = path.join(root, PROVENANCE_RELATIVE_PATH);
      const policyPath = path.join(root, POLICY_RELATIVE_PATH);
      const outputA = path.join(root, "out", "Dockerfile.a");
      const outputB = path.join(root, "out", "Dockerfile.b");
      await mkdir(path.dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, JSON.stringify(manifest));
      await writeFile(policyPath, JSON.stringify(trustPolicy));
      const first = await generateDockerfile({ repoRoot: root, outputPath: outputA });
      const second = await generateDockerfile({ repoRoot: root, outputPath: outputB });
      assert.equal(first.dockerfile, second.dockerfile);
      assert.equal(await readFile(outputA, "utf8"), renderDockerfile(validateProvenance(manifest, { requireApproved: true, trustPolicy })));
      assert.match(first.dockerfile, new RegExp(`FROM --platform=linux/arm64 ${manifest.candidate.sourceImage.repository}@${manifest.candidate.sourceImage.platformManifestDigest}`));
      assert.doesNotMatch(first.dockerfile, /ARG NODE_BASE_IMAGE|\$\{NODE_BASE_IMAGE\}/);
      assert.match(first.dockerfile, /COPY \["third_party\/e2e-chromium\/test-browser\.tar\.gz","\/tmp\/chromium\.tar\.gz"\]/);
      assert.match(first.dockerfile, /validate-sales-v5-e2e-tar\.mjs --archive .* --format tar\.gz/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
