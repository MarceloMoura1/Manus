import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXPECTED, qualifySalesV5E2EImage } from "./qualify-sales-v5-e2e-image.mjs";

const browserRoot = "/opt/ms-playwright";
const executable = "/opt/ms-playwright/chromium-1234/chrome-linux/chrome";
const imageProvenance = {
  schemaVersion: 1,
  status: "approved",
  expected: { platform: { os: "linux", architecture: "arm64" }, nodeVersion: "v22.23.2", pnpmVersion: "10.18.0", playwrightVersion: "1.60.0" },
  candidate: {
    sourceImage: { repository: "registry.example.test/approved/node", indexDigest: `sha256:${"a".repeat(64)}`, platformManifestDigest: `sha256:${"b".repeat(64)}`, configDigest: `sha256:${"c".repeat(64)}`, platform: { os: "linux", architecture: "arm64" } },
    playwright: { packageVersion: "1.60.0", chromiumRevision: "1234", browserVersion: "123.0.1" },
    buildInputs: { aptSnapshot: "https://snapshot.debian.org/archive/debian/20261019T000000Z/", pnpmTarball: { url: "https://packages.example.test/pnpm-10.18.0.tgz", sha256: "d".repeat(64) } },
    archive: { relativePath: "third_party/e2e-chromium/test.tar.gz", sha256: "e".repeat(64), sizeBytes: 1, format: "tar.gz", url: "https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/1234/chromium-linux-arm64.zip", extractedFilesManifest: { relativePath: ".github/qualification-provenance/evidence/test.txt", sha256: "f".repeat(64), sizeBytes: 1 } },
    evidence: {
      acquisition: { relativePath: ".github/qualification-provenance/evidence/acquisition.txt", sha256: "1".repeat(64), sizeBytes: 1 },
      extraction: { relativePath: ".github/qualification-provenance/evidence/extraction.txt", sha256: "2".repeat(64), sizeBytes: 1 },
      approval: { relativePath: ".github/qualification-provenance/evidence/approval.txt", sha256: "3".repeat(64), sizeBytes: 1 },
      ociIndex: { relativePath: ".github/qualification-provenance/evidence/oci-index.json", sha256: "4".repeat(64), sizeBytes: 1 },
      ociPlatformManifest: { relativePath: ".github/qualification-provenance/evidence/oci-platform-manifest.json", sha256: "5".repeat(64), sizeBytes: 1 },
    },
    finalImage: null,
  },
};

const trustPolicy = {
  schemaVersion: 1,
  status: "approved",
  expected: imageProvenance.expected,
  approvedCandidates: [{
    sourceImage: imageProvenance.candidate.sourceImage,
    playwright: imageProvenance.candidate.playwright,
    buildInputs: imageProvenance.candidate.buildInputs,
  }],
};

function healthyBrowser() {
  return {
    executablePath: () => executable,
    launch: async () => ({
      newPage: async () => ({
        goto: async () => {},
        title: async () => "megadesk-e2e-arm64",
      }),
      version: async () => "123.0.1",
      close: async () => {},
    }),
  };
}

function healthySharp(input) {
  if (Buffer.isBuffer(input)) {
    return { metadata: async () => ({ format: "png", width: 2, height: 3 }) };
  }
  return { png: () => ({ toBuffer: async () => Buffer.from([137, 80, 78, 71]) }) };
}

function healthyCommand(program, args) {
  const invocation = `${program} ${args.join(" ")}`;
  if (invocation === "pnpm --version") return Promise.resolve({ stdout: EXPECTED.pnpm, stderr: "" });
  if (invocation === "pnpm exec tsx --version") return Promise.resolve({ stdout: "4.20.0", stderr: "" });
  if (invocation === "pnpm exec playwright --version") return Promise.resolve({ stdout: `Version ${EXPECTED.playwright}`, stderr: "" });
  if (invocation === `ldd ${executable}`) return Promise.resolve({ stdout: "linux-vdso.so.1\nlibc.so.6", stderr: "" });
  throw new Error(`comando inesperado: ${invocation}`);
}

function healthyOverrides(overrides = {}) {
  return {
    platform: "linux",
    processArch: "arm64",
    hostArchitecture: "arm64",
    nodeVersion: EXPECTED.node,
    env: { HOME: "/tmp", PLAYWRIGHT_BROWSERS_PATH: browserRoot },
    commandFn: healthyCommand,
    lstatFn: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
    realpathFn: async target => target,
    accessFn: async () => {},
    sha256FileFn: async () => "a".repeat(64),
    chromiumApi: healthyBrowser(),
    sharpApi: healthySharp,
    imageProvenance,
    trustPolicy,
    ...overrides,
  };
}

describe("Sales V5 E2E ARM64 image qualification probe", () => {
  it("accepts a complete simulated ARM64 qualification", async () => {
    const result = await qualifySalesV5E2EImage(healthyOverrides());
    assert.equal(result.platform, "linux/arm64");
    assert.equal(result.chromiumExecutableSha256, "a".repeat(64));
    assert.equal(result.chromiumVersion, "123.0.1");
    assert.deepEqual(result.sharp, { bytes: 4, width: 2, height: 3 });
  });

  it("rejects a missing browser executable or an incorrect browser path", async () => {
    await assert.rejects(
      qualifySalesV5E2EImage(healthyOverrides({ chromiumApi: { ...healthyBrowser(), executablePath: () => "" } })),
      /Chromium resolveu/,
    );
    await assert.rejects(
      qualifySalesV5E2EImage(healthyOverrides({ env: { HOME: "/tmp", PLAYWRIGHT_BROWSERS_PATH: "/tmp/browsers" } })),
      /PLAYWRIGHT_BROWSERS_PATH/,
    );
  });

  it("rejects missing Linux libraries and a browser unable to render a data page", async () => {
    await assert.rejects(
      qualifySalesV5E2EImage(healthyOverrides({ commandFn: async (program, args) => program === "ldd" ? { stdout: "libnss3.so => not found", stderr: "" } : healthyCommand(program, args) })),
      /biblioteca Linux ausente/,
    );
    await assert.rejects(
      qualifySalesV5E2EImage(healthyOverrides({ chromiumApi: { ...healthyBrowser(), launch: async () => { throw new Error("launch failed"); } } })),
      /launch failed/,
    );
  });

  it("rejects a wrong ARM64 platform or required runtime versions", async () => {
    await assert.rejects(qualifySalesV5E2EImage(healthyOverrides({ processArch: "x64" })), /Linux ARM64/);
    await assert.rejects(qualifySalesV5E2EImage(healthyOverrides({ nodeVersion: "v22.0.0" })), /Node divergente/);
    await assert.rejects(
      qualifySalesV5E2EImage(healthyOverrides({ commandFn: async (program, args) => program === "pnpm" && args[0] === "--version" ? { stdout: "10.17.0", stderr: "" } : healthyCommand(program, args) })),
      /pnpm divergente/,
    );
    await assert.rejects(
      qualifySalesV5E2EImage(healthyOverrides({ commandFn: async (program, args) => program === "pnpm" && args.join(" ") === "exec playwright --version" ? { stdout: "Version 1.59.0", stderr: "" } : healthyCommand(program, args) })),
      /Playwright divergente/,
    );
  });

  it("rejects a failed real sharp transformation", async () => {
    const brokenSharp = () => ({ png: () => ({ toBuffer: async () => { throw new Error("sharp transform failed"); } }) });
    await assert.rejects(qualifySalesV5E2EImage(healthyOverrides({ sharpApi: brokenSharp })), /sharp transform failed/);
  });

  it("rejects a browser that does not match the approved Chromium revision", async () => {
    const mismatched = structuredClone(imageProvenance);
    const mismatchedPolicy = structuredClone(trustPolicy);
    mismatched.candidate.playwright.chromiumRevision = "999";
    mismatchedPolicy.approvedCandidates[0].playwright.chromiumRevision = "999";
    await assert.rejects(qualifySalesV5E2EImage(healthyOverrides({ imageProvenance: mismatched, trustPolicy: mismatchedPolicy })), /revisao Chromium aprovada/);
  });

  it("rejects an absent or divergent Chromium browser version", async () => {
    await assert.rejects(
      qualifySalesV5E2EImage(healthyOverrides({ chromiumApi: { ...healthyBrowser(), launch: async () => ({ ...await healthyBrowser().launch(), version: async () => "" }) } })),
      /Chromium divergente/,
    );
    await assert.rejects(
      qualifySalesV5E2EImage(healthyOverrides({ chromiumApi: { ...healthyBrowser(), launch: async () => ({ ...await healthyBrowser().launch(), version: async () => "124.0.0" }) } })),
      /Chromium divergente/,
    );
  });
});
