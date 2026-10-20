import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { recordOciLayout } from "./record-sales-v5-e2e-oci-layout.mjs";

const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function fixture({ architecture = "arm64", mutateManifest = false, omitIndexMediaType = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "megadesk-oci-layout-"));
  const config = Buffer.from(JSON.stringify({ os: "linux", architecture }));
  const configDigest = hash(config);
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json", config: { digest: configDigest } }));
  const manifestDigest = hash(manifest);
  const index = Buffer.from(JSON.stringify({ schemaVersion: 2, ...(omitIndexMediaType ? {} : { mediaType: "application/vnd.oci.image.index.v1+json" }), manifests: [{ mediaType: "application/vnd.oci.image.manifest.v1+json", digest: mutateManifest ? `sha256:${"0".repeat(64)}` : manifestDigest, platform: { os: "linux", architecture } }] }));
  for (const [value, bytes] of [[configDigest, config], [manifestDigest, manifest]]) {
    const target = path.join(root, "blobs", "sha256", value.slice("sha256:".length));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await writeFile(path.join(root, "index.json"), index);
  return root;
}

describe("final ARM64 OCI image layout recording", () => {
  it("records a verified index, platform manifest, and config digest", async () => {
    const root = await fixture();
    try {
      const result = await recordOciLayout(root);
      assert.equal(result.platform, "linux/arm64");
      assert.match(result.ociIndexDigest, /^sha256:[a-f0-9]{64}$/);
      assert.match(result.platformManifestDigest, /^sha256:[a-f0-9]{64}$/);
      assert.match(result.configDigest, /^sha256:[a-f0-9]{64}$/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts an OCI layout index without the optional mediaType", async () => {
    const root = await fixture({ omitIndexMediaType: true });
    try { assert.equal((await recordOciLayout(root)).platform, "linux/arm64"); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  for (const [name, options] of [["wrong architecture", { architecture: "amd64" }], ["missing manifest blob", { mutateManifest: true }]]) {
    it(`fails closed for ${name}`, async () => {
      const root = await fixture(options);
      try {
        await assert.rejects(recordOciLayout(root), /OCI|ARM64|ausente/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});
