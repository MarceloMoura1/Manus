import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, mkdir, readFile, readlink, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activateStagedRelease,
  createVerifiedBackup,
  parseStrictJsonBytes,
  rollbackCodeRelease,
  stageVerifiedRelease,
  validateArchiveListing,
  validateBackupReceiptShape,
  validatePinnedManifest,
  verifyArtifactBundle,
  verifyBackupReceipt,
  verifyLocalReleaseHealth,
} from "./linux-arm64-release-deploy.mjs";

const roots = [];
const symlinkTests = process.platform === "win32" ? it.skip : it;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function expectedFor(tarball, manifestBytes) {
  return {
    artifactName: path.basename(tarball),
    tarSha256: sha256("synthetic-runtime-tar"),
    manifestSha256: sha256(manifestBytes),
    commit: "a".repeat(40),
    tree: "b".repeat(40),
  };
}

function manifestFor(tarball) {
  return {
    schemaVersion: 2,
    payloadRoot: "runtime",
    release: { commit: "a".repeat(40), tree: "b".repeat(40), platform: "linux/arm64", node: "v22.23.2", pnpm: "10.18.0" },
    package: { name: path.basename(tarball), size: Buffer.byteLength("synthetic-runtime-tar"), sha256: sha256("synthetic-runtime-tar") },
    files: [{ path: "index.js", type: "file", size: Buffer.byteLength("export default 1;\n"), sha256: sha256("export default 1;\n") }],
  };
}

async function bundleFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "megadesk-linux-deploy-"));
  roots.push(root);
  const tarball = path.join(root, "megadesk-runtime-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-linux-arm64.tar.gz");
  const manifestPath = path.join(root, "runtime.manifest.json");
  await writeFile(tarball, "synthetic-runtime-tar");
  const manifest = manifestFor(tarball);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  await writeFile(manifestPath, manifestBytes);
  return { root, tarball, manifestPath, manifest, expected: expectedFor(tarball, manifestBytes) };
}

function fakeGnuTar(manifest) {
  return async (command, args) => {
    if (command !== "tar") throw new Error("unexpected command");
    if (args[0] === "--version") return { stdout: "tar (GNU tar) 1.35\n", stderr: "" };
    if (args[0] === "-tzf") return { stdout: `runtime/\nruntime/index.js\n`, stderr: "" };
    throw new Error("unexpected tar arguments");
  };
}

async function managedLayout() {
  const root = await mkdtemp(path.join(os.tmpdir(), "megadesk-linux-layout-"));
  roots.push(root);
  const managedRoot = path.join(root, "app");
  await mkdir(path.join(managedRoot, "releases", "old"), { recursive: true });
  await mkdir(path.join(managedRoot, "staging"), { recursive: true });
  await mkdir(path.join(managedRoot, "backups"), { recursive: true });
  await mkdir(path.join(root, "configuration"), { recursive: true });
  await mkdir(path.join(root, "state"), { recursive: true });
  await writeFile(path.join(managedRoot, "releases", "old", "index.js"), "export const active = true;\n");
  await writeFile(path.join(root, "configuration", "runtime.conf"), "synthetic configuration\n");
  await writeFile(path.join(root, "state", "state.json"), "{}\n");
  await symlink("releases/old", path.join(managedRoot, "current"));
  return {
    root,
    managedRoot,
    activeLink: path.join(managedRoot, "current"),
    configurationRoot: path.join(root, "configuration"),
    stateRoot: path.join(root, "state"),
  };
}

async function stageSyntheticRuntime(layout, fixture) {
  return stageVerifiedRelease({
    managedRoot: layout.managedRoot,
    tarball: fixture.tarball,
    manifestPath: fixture.manifestPath,
    expected: fixture.expected,
    commandRunner: fakeGnuTar(fixture.manifest),
    extractor: async ({ destination }) => {
      const runtime = path.join(destination, "runtime");
      await mkdir(runtime, { recursive: true });
      await writeFile(path.join(runtime, "index.js"), "export default 1;\n");
      return { runtime };
    },
  });
}

async function expectActiveReleaseUntouched(layout, fixture) {
  await expect(readlink(layout.activeLink)).resolves.toBe("releases/old");
  await expect(lstat(path.join(layout.managedRoot, "releases", fixture.expected.commit))).rejects.toMatchObject({ code: "ENOENT" });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("linux ARM64 release deployment primitives", () => {
  it("rejects malformed, ambiguous and non-canonical manifest JSON before schema validation", () => {
    expect(() => parseStrictJsonBytes(Buffer.from("\uFEFF{}"), "manifest")).toThrow("BOM");
    expect(() => parseStrictJsonBytes(Buffer.from([0xff, 0xfe]), "manifest")).toThrow("UTF-8");
    expect(() => parseStrictJsonBytes(Buffer.from('{"a":1,"a":2}'), "manifest")).toThrow("duplicate key");
    expect(() => parseStrictJsonBytes(Buffer.from('{"a":'), "manifest")).toThrow();
    expect(() => parseStrictJsonBytes(Buffer.from('{} trailing'), "manifest")).toThrow("trailing");
  });

  it("requires the exact candidate identity, hashes, package metadata and GNU tar", async () => {
    const fixture = await bundleFixture();
    await expect(verifyArtifactBundle({ tarball: fixture.tarball, manifestPath: fixture.manifestPath, expected: fixture.expected, commandRunner: fakeGnuTar(fixture.manifest) }))
      .resolves.toMatchObject({ size: Buffer.byteLength("synthetic-runtime-tar") });

    await expect(verifyArtifactBundle({
      tarball: fixture.tarball,
      manifestPath: fixture.manifestPath,
      expected: { ...fixture.expected, tarSha256: "0".repeat(64) },
      commandRunner: fakeGnuTar(fixture.manifest),
    })).rejects.toThrow("TAR SHA-256 differs");

    await expect(verifyArtifactBundle({
      tarball: fixture.tarball,
      manifestPath: fixture.manifestPath,
      expected: fixture.expected,
      commandRunner: async () => ({ stdout: "bsdtar 3.7\n", stderr: "" }),
    })).rejects.toThrow("GNU tar is required");
  });

  it("rejects a substituted manifest before invoking the archiver or creating a staging path", async () => {
    const fixture = await bundleFixture();
    await writeFile(fixture.manifestPath, `${JSON.stringify({ ...fixture.manifest, payloadRoot: "substituted" })}\n`);
    let tarWasInvoked = false;
    await expect(verifyArtifactBundle({
      tarball: fixture.tarball,
      manifestPath: fixture.manifestPath,
      expected: fixture.expected,
      commandRunner: async () => { tarWasInvoked = true; return { stdout: "tar (GNU tar)\n", stderr: "" }; },
    })).rejects.toThrow("Manifest SHA-256 differs");
    expect(tarWasInvoked).toBe(false);
  });

  it("rejects extra manifest fields, unsafe symlinks and duplicate or extra archive members", () => {
    const manifest = manifestFor("megadesk-runtime-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-linux-arm64.tar.gz");
    const expected = { artifactName: manifest.package.name, tarSha256: manifest.package.sha256, manifestSha256: "c".repeat(64), commit: "a".repeat(40), tree: "b".repeat(40) };
    expect(() => validatePinnedManifest({ ...manifest, unexpected: true }, expected, { path: manifest.package.name, size: manifest.package.size })).toThrow("unsupported schema");
    const unsafe = structuredClone(manifest);
    unsafe.files = [{ path: "link", type: "symlink", target: "../../outside", sha256: sha256("symlink\0../../outside") }];
    expect(() => validatePinnedManifest(unsafe, expected, { path: manifest.package.name, size: manifest.package.size })).toThrow("unsafe");
    expect(() => validateArchiveListing("runtime/\nruntime/index.js\nruntime/index.js\n", manifest)).toThrow("duplicate member");
    expect(() => validateArchiveListing("runtime/\nruntime/index.js\nruntime/unexpected.js\n", manifest)).toThrow("unexpected member");
  });

  it("rejects incomplete backup receipts and invalid managed destinations without mutation", async () => {
    expect(() => validateBackupReceiptShape({})).toThrow("unsupported schema");
    const fixture = await bundleFixture();
    await expect(stageVerifiedRelease({
      managedRoot: fixture.root,
      tarball: fixture.tarball,
      manifestPath: fixture.manifestPath,
      expected: fixture.expected,
      commandRunner: fakeGnuTar(fixture.manifest),
    })).rejects.toThrow("Managed releases directory does not exist");
  });

  it("requires an exact loopback health response tied to the candidate SHA", async () => {
    const expectedCommit = "a".repeat(40);
    const fetchOk = async () => ({ ok: true, status: 200, json: async () => ({ status: "healthy", release: { sha: expectedCommit } }) });
    await expect(verifyLocalReleaseHealth({ url: "http://127.0.0.1:3000/healthz", expectedCommit, fetchImpl: fetchOk }))
      .resolves.toMatchObject({ releaseSha: expectedCommit });
    await expect(verifyLocalReleaseHealth({
      url: "http://127.0.0.1:3000/healthz",
      expectedCommit,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: "healthy", release: { sha: "b".repeat(40) } }) }),
    })).rejects.toThrow("expected release SHA");
    await expect(verifyLocalReleaseHealth({ url: "https://app.megadesk.online/healthz", expectedCommit, fetchImpl: fetchOk }))
      .rejects.toThrow("loopback");
  });

  symlinkTests("creates a verifiable backup before staging, rejects altered backups, and preserves the active release", async () => {
    const layout = await managedLayout();
    await chmod(path.join(layout.configurationRoot, "runtime.conf"), 0o640);
    await chmod(path.join(layout.stateRoot, "state.json"), 0o600);
    const backup = await createVerifiedBackup(layout);
    await expect(verifyBackupReceipt({ ...layout, receiptPath: backup.receiptPath })).resolves.toMatchObject({ id: backup.receipt.id });
    await expect(readFile(path.join(layout.managedRoot, "releases", "old", "index.js"), "utf8")).resolves.toContain("active");
    await expect(lstat(path.join(backup.directory, "configuration", "runtime.conf"))).resolves.toMatchObject({ mode: expect.any(Number) });
    expect((await lstat(path.join(backup.directory, "configuration", "runtime.conf"))).mode & 0o777).toBe(0o640);
    expect((await lstat(path.join(backup.directory, "state", "state.json"))).mode & 0o777).toBe(0o600);
    await writeFile(path.join(backup.directory, "state", "state.json"), "tampered\n");
    await expect(verifyBackupReceipt({ ...layout, receiptPath: backup.receiptPath })).rejects.toThrow("snapshot integrity differs");
  });

  symlinkTests("refuses activation without a valid backup and rolls the managed code pointer back atomically", async () => {
    const layout = await managedLayout();
    const backup = await createVerifiedBackup(layout);
    const fixture = await bundleFixture();
    const staged = await stageSyntheticRuntime(layout, fixture);
    await expect(activateStagedRelease({
      managedRoot: layout.managedRoot,
      activeLink: layout.activeLink,
      stageDirectory: staged.directory,
      backupReceiptPath: path.join(layout.root, "missing.json"),
      expected: fixture.expected,
    })).rejects.toThrow("Backup receipt does not exist");
    const activated = await activateStagedRelease({
      managedRoot: layout.managedRoot,
      activeLink: layout.activeLink,
      stageDirectory: staged.directory,
      backupReceiptPath: backup.receiptPath,
      expected: fixture.expected,
    });
    expect(activated.active).toBe(`releases/${fixture.expected.commit}`);
    await expect(activateStagedRelease({
      managedRoot: layout.managedRoot,
      activeLink: layout.activeLink,
      stageDirectory: staged.directory,
      backupReceiptPath: backup.receiptPath,
      expected: fixture.expected,
    })).rejects.toThrow("Backup receipt does not belong to the current active release");
    await expect(readlink(layout.activeLink)).resolves.toBe(`releases/${fixture.expected.commit}`);
    await expect(rollbackCodeRelease({ managedRoot: layout.managedRoot, activeLink: layout.activeLink, backupReceiptPath: backup.receiptPath }))
      .resolves.toMatchObject({ active: "releases/old" });
    await unlink(path.join(layout.managedRoot, "releases", "old", "index.js"));
    await expect(rollbackCodeRelease({ managedRoot: layout.managedRoot, activeLink: layout.activeLink, backupReceiptPath: backup.receiptPath }))
      .rejects.toThrow("Active release changed after backup creation");
  });

  symlinkTests("seals the staged runtime and rejects a runtime changed after staging without moving current", async () => {
    const layout = await managedLayout();
    const backup = await createVerifiedBackup(layout);
    const fixture = await bundleFixture();
    const staged = await stageSyntheticRuntime(layout, fixture);
    const runtimeFile = path.join(staged.runtime, "index.js");
    expect((await lstat(runtimeFile)).mode & 0o222).toBe(0);
    await expect(writeFile(runtimeFile, "tampered\n")).rejects.toMatchObject({ code: "EACCES" });
    await chmod(runtimeFile, 0o644);
    await writeFile(runtimeFile, "tampered\n");

    await expect(activateStagedRelease({
      managedRoot: layout.managedRoot,
      activeLink: layout.activeLink,
      stageDirectory: staged.directory,
      backupReceiptPath: backup.receiptPath,
      expected: fixture.expected,
    })).rejects.toThrow("Staged runtime differs from the receipt");
    await expectActiveReleaseUntouched(layout, fixture);
  });

  symlinkTests("rejects a staged manifest or receipt modified after staging without moving current", async () => {
    const layout = await managedLayout();
    const backup = await createVerifiedBackup(layout);
    const fixture = await bundleFixture();
    const manifestStage = await stageSyntheticRuntime(layout, fixture);
    const stagedManifest = path.join(manifestStage.directory, "stage-manifest.json");
    await chmod(stagedManifest, 0o600);
    await writeFile(stagedManifest, `${JSON.stringify({ ...fixture.manifest, payloadRoot: "other" })}\n`);

    await expect(activateStagedRelease({
      managedRoot: layout.managedRoot,
      activeLink: layout.activeLink,
      stageDirectory: manifestStage.directory,
      backupReceiptPath: backup.receiptPath,
      expected: fixture.expected,
    })).rejects.toThrow("Staged manifest differs from the approved artifact identity");
    await expectActiveReleaseUntouched(layout, fixture);

    const receiptStage = await stageSyntheticRuntime(layout, fixture);
    const receiptPath = path.join(receiptStage.directory, "stage-receipt.json");
    await chmod(receiptPath, 0o600);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt.runtime.sha256 = "0".repeat(64);
    await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);

    await expect(activateStagedRelease({
      managedRoot: layout.managedRoot,
      activeLink: layout.activeLink,
      stageDirectory: receiptStage.directory,
      backupReceiptPath: backup.receiptPath,
      expected: fixture.expected,
    })).rejects.toThrow("Staged runtime differs from the receipt");
    await expectActiveReleaseUntouched(layout, fixture);
  });

  symlinkTests("fails closed when a concurrent or abandoned deployment lease exists", async () => {
    const layout = await managedLayout();
    const backup = await createVerifiedBackup(layout);
    const fixture = await bundleFixture();
    const staged = await stageSyntheticRuntime(layout, fixture);
    const lockDirectory = path.join(layout.managedRoot, ".megadesk-linux-deploy.lock");
    await mkdir(lockDirectory, { mode: 0o700 });

    await expect(activateStagedRelease({
      managedRoot: layout.managedRoot,
      activeLink: layout.activeLink,
      stageDirectory: staged.directory,
      backupReceiptPath: backup.receiptPath,
      expected: fixture.expected,
    })).rejects.toThrow("Deployment lease is unavailable");
    await expectActiveReleaseUntouched(layout, fixture);
  });
});
