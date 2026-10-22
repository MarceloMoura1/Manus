import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectPayloadEntries,
  createManifest,
  createRuntimeArchive,
  extractAndVerifyRuntimeArchive,
  verifyManifest,
  writeManifest,
} from "./package-runtime-release.mjs";

const temporaryRoots = [];
const linkTests = process.platform === "win32" ? it.skip : it;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "megadesk-runtime-package-"));
  temporaryRoots.push(root);
  const runtime = path.join(root, "runtime");
  await mkdir(path.join(runtime, ".pnpm", "example@1", "node_modules", "example"), { recursive: true });
  await writeFile(path.join(runtime, ".pnpm", "example@1", "node_modules", "example", "index.js"), "export const example = true;\n");
  await writeFile(path.join(runtime, "regular.txt"), "original\n");
  return { root, runtime };
}

async function relativeLink(target, linkPath) {
  await symlink(path.relative(path.dirname(linkPath), target), linkPath);
}

function archiveWithSingleMember(name) {
  const header = Buffer.alloc(512);
  const octal = (value, width) => `${value.toString(8).padStart(width - 1, "0")}\0`;
  header.write(name, 0, 100, "utf8");
  header.write(octal(0o644, 8), 100, 8, "ascii");
  header.write(octal(0, 8), 108, 8, "ascii");
  header.write(octal(0, 8), 116, 8, "ascii");
  header.write(octal(0, 12), 124, 12, "ascii");
  header.write(octal(0, 12), 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = [...header].reduce((total, value) => total + value, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return gzipSync(Buffer.concat([header, Buffer.alloc(1024)]));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function manifestFor(runtime, root) {
  const tarball = path.join(root, "runtime.tar.gz");
  const packageInfo = await createRuntimeArchive({ runtime, tarball });
  const manifest = await createManifest({
    runtime,
    packageInfo,
    release: { commit: "a".repeat(40), tree: "b".repeat(40), platform: "linux/arm64", node: "v22.23.2", pnpm: "10.18.0" },
  });
  const manifestPath = path.join(root, "runtime.manifest.json");
  await writeManifest(manifestPath, manifest);
  return { tarball, manifestPath, manifest };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("packageRuntimeRelease", () => {
  linkTests("preserves a valid internal pnpm symlink through TAR and clean extraction", async () => {
    const { root, runtime } = await fixture();
    const target = path.join(runtime, ".pnpm", "example@1", "node_modules", "example");
    await relativeLink(target, path.join(runtime, "example"));

    const { tarball, manifestPath } = await manifestFor(runtime, root);
    const extracted = await extractAndVerifyRuntimeArchive({ tarball, manifestPath, destination: path.join(root, "extract") });

    expect(extracted.symlinks).toBe(1);
    expect(await readFile(path.join(extracted.runtime, "example", "index.js"), "utf8")).toContain("example");
  });

  linkTests("accepts a valid chain of internal symlinks", async () => {
    const { root, runtime } = await fixture();
    const target = path.join(runtime, ".pnpm", "example@1", "node_modules", "example");
    await relativeLink(target, path.join(runtime, "first"));
    await relativeLink(path.join(runtime, "first"), path.join(runtime, "second"));

    const { manifestPath } = await manifestFor(runtime, root);
    await expect(verifyManifest({ runtime, manifestPath })).resolves.toMatchObject({ symlinks: 2 });
  });

  linkTests("rejects absolute, escaping, broken, chained-escaping and cyclic links", async () => {
    const cases = [
      { name: "absolute", target: path.resolve(os.tmpdir(), "outside") },
      { name: "escape", target: "../outside" },
      { name: "broken", target: "missing" },
    ];
    for (const testCase of cases) {
      const { runtime } = await fixture();
      await symlink(testCase.target, path.join(runtime, testCase.name));
      await expect(collectPayloadEntries(runtime)).rejects.toThrow();
    }

    const chained = await fixture();
    await symlink("../outside", path.join(chained.runtime, "first"));
    await symlink("first", path.join(chained.runtime, "second"));
    await expect(collectPayloadEntries(chained.runtime)).rejects.toThrow();

    const cyclic = await fixture();
    await symlink("second", path.join(cyclic.runtime, "first"));
    await symlink("first", path.join(cyclic.runtime, "second"));
    await expect(collectPayloadEntries(cyclic.runtime)).rejects.toThrow("cycle");
  });

  it("detects a modified regular file after manifest generation", async () => {
    const { root, runtime } = await fixture();
    const { manifestPath } = await manifestFor(runtime, root);
    await writeFile(path.join(runtime, "regular.txt"), "modified\n");
    await expect(verifyManifest({ runtime, manifestPath })).rejects.toThrow("integrity differs");
  });

  linkTests("detects a modified symbolic link and rejects it before creating an archive", async () => {
    const { root, runtime } = await fixture();
    const target = path.join(runtime, ".pnpm", "example@1", "node_modules", "example");
    const link = path.join(runtime, "example");
    await relativeLink(target, link);
    const { manifestPath } = await manifestFor(runtime, root);
    await rm(link);
    await symlink("regular.txt", link);
    await expect(verifyManifest({ runtime, manifestPath })).rejects.toThrow("symbolic link integrity differs");

    const unsafe = path.join(runtime, "unsafe");
    await symlink("../outside", unsafe);
    await expect(createRuntimeArchive({ runtime, tarball: path.join(root, "unsafe.tar.gz") })).rejects.toThrow();
  });

  it("rejects modified archives and unsafe manifest or archive paths before extraction", async () => {
    const { root, runtime } = await fixture();
    const { tarball, manifestPath } = await manifestFor(runtime, root);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files.push({ path: "../escape", type: "file", size: 0, sha256: "0".repeat(64) });
    const maliciousManifest = path.join(root, "malicious.manifest.json");
    await writeFile(maliciousManifest, `${JSON.stringify(manifest)}\n`);
    await expect(verifyManifest({ runtime, manifestPath: maliciousManifest })).rejects.toThrow("unsafe entry path");

    const unsafeManifestDestination = path.join(root, "unsafe-manifest-extract");
    await expect(extractAndVerifyRuntimeArchive({ tarball, manifestPath: maliciousManifest, destination: unsafeManifestDestination })).rejects.toThrow("unsafe entry path");
    await expect(lstat(unsafeManifestDestination)).rejects.toMatchObject({ code: "ENOENT" });

    await writeFile(tarball, "tampered archive");
    const modifiedArchiveDestination = path.join(root, "modified-archive-extract");
    await expect(extractAndVerifyRuntimeArchive({ tarball, manifestPath, destination: modifiedArchiveDestination })).rejects.toThrow("Archive integrity differs");
    await expect(lstat(modifiedArchiveDestination)).rejects.toMatchObject({ code: "ENOENT" });

    const unsafeArchive = archiveWithSingleMember("../outside.txt");
    const unsafeArchivePath = path.join(root, "unsafe-runtime.tar.gz");
    await writeFile(unsafeArchivePath, unsafeArchive);
    const unsafeArchiveManifest = {
      schemaVersion: 2,
      payloadRoot: "runtime",
      release: { commit: "a".repeat(40), tree: "b".repeat(40), platform: "linux/arm64", node: "v22.23.2", pnpm: "10.18.0" },
      package: { name: path.basename(unsafeArchivePath), size: unsafeArchive.length, sha256: sha256(unsafeArchive) },
      files: [],
    };
    const unsafeArchiveManifestPath = path.join(root, "unsafe-runtime.manifest.json");
    await writeFile(unsafeArchiveManifestPath, `${JSON.stringify(unsafeArchiveManifest)}\n`);
    const unsafeArchiveDestination = path.join(root, "unsafe-archive-extract");
    await expect(extractAndVerifyRuntimeArchive({ tarball: unsafeArchivePath, manifestPath: unsafeArchiveManifestPath, destination: unsafeArchiveDestination })).rejects.toThrow("unsafe member path");
    await expect(lstat(unsafeArchiveDestination)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
