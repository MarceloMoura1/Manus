import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { validateOciBinding } from "./validate-sales-v5-e2e-oci.mjs";

const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const configDigest = `sha256:${"c".repeat(64)}`;

function fixture() {
  const platformManifestBytes = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: configDigest, size: 1 },
    layers: [],
  }));
  const platformManifestDigest = digest(platformManifestBytes);
  const indexBytes = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [{ mediaType: "application/vnd.oci.image.manifest.v1+json", digest: platformManifestDigest, size: platformManifestBytes.length, platform: { os: "linux", architecture: "arm64" } }],
  }));
  return {
    indexBytes,
    platformManifestBytes,
    sourceImage: { indexDigest: digest(indexBytes), platformManifestDigest, configDigest, platform: { os: "linux", architecture: "arm64" } },
  };
}

describe("OCI source binding", () => {
  it("accepts only the approved index, ARM64 descriptor, platform manifest, and config digest", () => {
    const candidate = fixture();
    assert.deepEqual(validateOciBinding(candidate), {
      indexDigest: candidate.sourceImage.indexDigest,
      platformManifestDigest: candidate.sourceImage.platformManifestDigest,
      configDigest,
      platform: "linux/arm64",
    });
  });

  it("rejects a non-ARM64 descriptor, changed platform digest, or changed config digest", () => {
    const candidate = fixture();
    const wrongArchitecture = JSON.parse(candidate.indexBytes);
    wrongArchitecture.manifests[0].platform.architecture = "amd64";
    assert.throws(() => validateOciBinding({ ...candidate, indexBytes: Buffer.from(JSON.stringify(wrongArchitecture)) }), /indice/);
    assert.throws(() => validateOciBinding({ ...candidate, platformManifestBytes: Buffer.from("{}") }), /digest do manifesto/);
    const wrongConfig = JSON.parse(candidate.platformManifestBytes);
    wrongConfig.config.digest = `sha256:${"d".repeat(64)}`;
    const wrongPlatformBytes = Buffer.from(JSON.stringify(wrongConfig));
    const wrongIndex = JSON.parse(candidate.indexBytes);
    wrongIndex.manifests[0].digest = digest(wrongPlatformBytes);
    const wrongIndexBytes = Buffer.from(JSON.stringify(wrongIndex));
    assert.throws(() => validateOciBinding({
      indexBytes: wrongIndexBytes,
      platformManifestBytes: wrongPlatformBytes,
      sourceImage: { ...candidate.sourceImage, indexDigest: digest(wrongIndexBytes), platformManifestDigest: digest(wrongPlatformBytes) },
    }), /configDigest/);
  });
});
