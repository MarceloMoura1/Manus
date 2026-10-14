import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRuntime } from "./assemble-runtime-release.mjs";

const MANIFEST_SCHEMA_VERSION = 2;

function fail(message) {
  throw new Error(message);
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isSafeRelativePath(relative) {
  return typeof relative === "string"
    && relative.length > 0
    && !path.isAbsolute(relative)
    && !relative.split(/[\\/]/).some((part) => part === "" || part === "." || part === "..");
}

async function assertRealDirectory(directory, label) {
  let info;
  try {
    info = await lstat(directory);
  } catch {
    fail(`${label} does not exist: ${directory}`);
  }
  if (!info.isDirectory() || info.isSymbolicLink()) fail(`${label} must be a real directory: ${directory}`);
}

async function assertAbsent(target, label) {
  try {
    await lstat(target);
    fail(`${label} already exists: ${target}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(file);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function symlinkIntegrity(target) {
  return createHash("sha256").update(`symlink\0${target}`, "utf8").digest("hex");
}

async function inspectSymlink({ root, physicalRoot, absolute, relative }) {
  const target = await readlink(absolute);
  if (path.isAbsolute(target)) fail(`Payload symbolic link must be relative: ${relative}`);

  const lexicalTarget = path.resolve(path.dirname(absolute), target);
  if (!isPathInside(lexicalTarget, root)) {
    fail(`Payload symbolic link lexically escapes the payload: ${relative}`);
  }

  let resolvedTarget;
  try {
    resolvedTarget = await realpath(absolute);
  } catch (error) {
    if (error?.code === "ELOOP") fail(`Payload symbolic link cycle detected: ${relative}`);
    fail(`Payload symbolic link is broken: ${relative}`);
  }
  if (!isPathInside(resolvedTarget, physicalRoot)) {
    fail(`Payload symbolic link resolves outside the payload: ${relative}`);
  }

  return { path: relative, type: "symlink", target, sha256: symlinkIntegrity(target) };
}

export async function collectPayloadEntries(runtime) {
  const root = path.resolve(runtime);
  await assertRealDirectory(root, "Payload root");
  const physicalRoot = await realpath(root);
  const entries = [];

  async function walk(relative = "") {
    const directory = path.join(root, relative);
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const childRelative = relative ? path.posix.join(relative, child.name) : child.name;
      const childAbsolute = path.join(root, childRelative);
      const info = await lstat(childAbsolute);
      if (info.isSymbolicLink()) {
        entries.push(await inspectSymlink({ root, physicalRoot, absolute: childAbsolute, relative: childRelative }));
      } else if (info.isDirectory()) {
        await walk(childRelative);
      } else if (info.isFile()) {
        entries.push({
          path: childRelative,
          type: "file",
          size: info.size,
          sha256: await sha256File(childAbsolute),
        });
      } else {
        fail(`Payload contains an unsupported entry: ${childRelative}`);
      }
    }
  }

  await walk();
  return entries;
}

function assertManifestEntry(entry, seen) {
  if (!entry || typeof entry !== "object" || !isSafeRelativePath(entry.path)) {
    fail("Manifest contains an unsafe entry path.");
  }
  if (seen.has(entry.path)) fail(`Manifest contains a duplicate entry: ${entry.path}`);
  seen.add(entry.path);
  if (entry.type === "file") {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) {
      fail(`Manifest file entry is invalid: ${entry.path}`);
    }
    return;
  }
  if (entry.type === "symlink") {
    if (typeof entry.target !== "string" || path.isAbsolute(entry.target) || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) {
      fail(`Manifest symbolic link entry is invalid: ${entry.path}`);
    }
    if (entry.sha256 !== symlinkIntegrity(entry.target)) {
      fail(`Manifest symbolic link integrity is invalid: ${entry.path}`);
    }
    return;
  }
  fail(`Manifest entry has an unsupported type: ${entry.path}`);
}

function assertPackageInfo(packageInfo) {
  if (!packageInfo || !isSafeRelativePath(packageInfo.name) || !Number.isSafeInteger(packageInfo.size) || packageInfo.size <= 0 || !/^[a-f0-9]{64}$/.test(packageInfo.sha256 ?? "")) {
    fail("Package metadata is invalid.");
  }
}

function assertManifestEntries(entries) {
  const seen = new Set();
  for (const entry of entries) assertManifestEntry(entry, seen);
  return seen;
}

function compareEntries(actual, expected) {
  const expectedByPath = new Map();
  assertManifestEntries(expected);
  for (const entry of expected) {
    expectedByPath.set(entry.path, entry);
  }
  if (actual.length !== expectedByPath.size) fail("Payload entry count differs from the manifest.");
  for (const entry of actual) {
    const expectedEntry = expectedByPath.get(entry.path);
    if (!expectedEntry) fail(`Payload contains an unexpected entry: ${entry.path}`);
    if (entry.type !== expectedEntry.type) fail(`Payload entry type differs from the manifest: ${entry.path}`);
    if (entry.type === "file") {
      if (entry.size !== expectedEntry.size || entry.sha256 !== expectedEntry.sha256) {
        fail(`Payload file integrity differs from the manifest: ${entry.path}`);
      }
    } else if (entry.target !== expectedEntry.target || entry.sha256 !== expectedEntry.sha256) {
      fail(`Payload symbolic link integrity differs from the manifest: ${entry.path}`);
    }
  }
}

export async function createManifest({ runtime, release, packageInfo }) {
  const runtimePath = path.resolve(runtime);
  if (!release || typeof release !== "object") fail("Release metadata is required.");
  for (const field of ["commit", "tree", "platform", "node", "pnpm"]) {
    if (!release[field] || typeof release[field] !== "string") fail(`Missing release metadata: ${field}`);
  }
  assertPackageInfo(packageInfo);
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    payloadRoot: path.basename(runtimePath),
    release,
    package: packageInfo,
    files: await collectPayloadEntries(runtimePath),
  };
}

export async function writeManifest(manifestPath, manifest) {
  await assertAbsent(manifestPath, "Manifest destination");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export async function verifyManifest({ runtime, manifestPath }) {
  const manifest = await readAndValidateManifest(manifestPath);
  const runtimePath = path.resolve(runtime);
  if (manifest.payloadRoot !== path.basename(runtimePath)) fail("Manifest payload root does not match the runtime directory.");
  const actual = await collectPayloadEntries(runtimePath);
  compareEntries(actual, manifest.files);
  return { regularFiles: actual.filter((entry) => entry.type === "file").length, symlinks: actual.filter((entry) => entry.type === "symlink").length };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} failed with exit code ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

async function tarIsGnu() {
  try {
    const result = await run("tar", ["--version"]);
    return result.stdout.includes("GNU tar");
  } catch {
    return false;
  }
}

export async function createRuntimeArchive({ runtime, tarball }) {
  const runtimePath = path.resolve(runtime);
  await collectPayloadEntries(runtimePath);
  const tarballPath = path.resolve(tarball);
  await assertAbsent(tarballPath, "Archive destination");
  const parent = path.dirname(runtimePath);
  const rootName = path.basename(runtimePath);
  const args = [];
  if (await tarIsGnu()) args.push("--sort=name", "--mtime=UTC 1970-01-01", "--owner=0", "--group=0", "--numeric-owner");
  args.push("-C", parent, "-czf", tarballPath, rootName);
  await run("tar", args);
  const archiveInfo = await stat(tarballPath);
  if (!archiveInfo.isFile() || archiveInfo.size === 0) fail("Archive was not created as a non-empty regular file.");
  return { name: path.basename(tarballPath), size: archiveInfo.size, sha256: await sha256File(tarballPath) };
}

function assertArchiveMemberPath(member, payloadRoot) {
  const normalized = member.replace(/\\/g, "/").replace(/\/$/, "");
  if (!isSafeRelativePath(normalized) || (normalized !== payloadRoot && !normalized.startsWith(`${payloadRoot}/`))) {
    fail(`Archive contains an unsafe member path: ${member}`);
  }
}

function assertArchiveMembers(listing, manifest) {
  const expected = new Set(manifest.files.map((entry) => `${manifest.payloadRoot}/${entry.path}`));
  const allowedDirectories = new Set([manifest.payloadRoot]);
  for (const entry of manifest.files) {
    let directory = path.posix.dirname(entry.path);
    while (directory !== ".") {
      allowedDirectories.add(`${manifest.payloadRoot}/${directory}`);
      directory = path.posix.dirname(directory);
    }
  }
  for (const member of listing.stdout.split(/\r?\n/).filter(Boolean)) {
    assertArchiveMemberPath(member, manifest.payloadRoot);
    const normalized = member.replace(/\\/g, "/").replace(/\/$/, "");
    if (member.endsWith("/")) {
      if (!allowedDirectories.has(normalized)) fail(`Archive contains an unexpected directory: ${member}`);
      continue;
    }
    if (expected.has(normalized)) {
      expected.delete(normalized);
      continue;
    }
    fail(`Archive contains an unexpected member: ${member}`);
  }
  if (expected.size > 0) fail(`Archive is missing manifest members: ${[...expected].sort().join(", ")}`);
}

async function readAndValidateManifest(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION || !Array.isArray(manifest.files)) {
    fail("Manifest schema is unsupported.");
  }
  if (!isSafeRelativePath(manifest.payloadRoot)) fail("Manifest payload root is unsafe.");
  assertPackageInfo(manifest.package);
  assertManifestEntries(manifest.files);
  return manifest;
}

export async function extractAndVerifyRuntimeArchive({ tarball, destination, manifestPath }) {
  const tarballPath = path.resolve(tarball);
  const destinationPath = path.resolve(destination);
  await assertAbsent(destinationPath, "Extraction destination");
  const manifest = await readAndValidateManifest(manifestPath);
  if (path.basename(tarballPath) !== manifest.package.name) fail("Archive name does not match manifest package metadata.");
  const archiveInfo = await stat(tarballPath);
  if (!archiveInfo.isFile() || archiveInfo.size !== manifest.package.size || await sha256File(tarballPath) !== manifest.package.sha256) {
    fail("Archive integrity differs from manifest package metadata.");
  }
  const listing = await run("tar", ["-tzf", tarballPath]);
  assertArchiveMembers(listing, manifest);
  await mkdir(destinationPath, { recursive: false, mode: 0o700 });
  try {
    await run("tar", ["-xzf", tarballPath, "-C", destinationPath]);
    const runtime = path.join(destinationPath, manifest.payloadRoot);
    const result = await verifyManifest({ runtime, manifestPath });
    return { runtime, ...result };
  } catch (error) {
    await rm(destinationPath, { recursive: true, force: true });
    throw error;
  }
}

function parseArguments(argumentsList) {
  const [command, ...argumentsAfterCommand] = argumentsList;
  if (command !== "package" && command !== "verify") {
    fail("Usage: package-runtime-release.mjs package --runtime <dir> --tar <file> --manifest <file> --extract <empty-dir> --commit <sha> --tree <tree> --node <version> --pnpm <version> | verify --runtime <dir> --manifest <file>");
  }
  const options = {};
  for (let index = 0; index < argumentsAfterCommand.length; index += 2) {
    const flag = argumentsAfterCommand[index];
    const value = argumentsAfterCommand[index + 1];
    if (!flag?.startsWith("--") || !value || options[flag]) fail("Invalid package-runtime-release arguments.");
    options[flag] = value;
  }
  if (!options["--runtime"] || !options["--manifest"]) fail("Runtime and manifest are required.");
  if (command === "package") {
    for (const field of ["--tar", "--extract", "--commit", "--tree", "--node", "--pnpm"]) if (!options[field]) fail(`Missing ${field} for package.`);
  }
  return { command, options };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const { command, options } = parseArguments(process.argv.slice(2));
    if (command === "verify") {
      const result = await verifyManifest({ runtime: options["--runtime"], manifestPath: options["--manifest"] });
      process.stdout.write(`RUNTIME_MANIFEST_VERIFY=PASS files=${result.regularFiles} symlinks=${result.symlinks}\n`);
    } else {
      await validateRuntime(options["--runtime"]);
      const packageInfo = await createRuntimeArchive({ runtime: options["--runtime"], tarball: options["--tar"] });
      const manifest = await createManifest({
        runtime: options["--runtime"],
        packageInfo,
        release: {
          commit: options["--commit"],
          tree: options["--tree"],
          platform: "linux/arm64",
          node: options["--node"],
          pnpm: options["--pnpm"],
        },
      });
      await writeManifest(options["--manifest"], manifest);
      const result = await extractAndVerifyRuntimeArchive({
        tarball: options["--tar"],
        destination: options["--extract"],
        manifestPath: options["--manifest"],
      });
      process.stdout.write(`RUNTIME_PACKAGE=PASS tar=${packageInfo.name} sha256=${packageInfo.sha256} files=${result.regularFiles} symlinks=${result.symlinks} extracted=${result.runtime}\n`);
    }
  } catch (error) {
    process.stderr.write(`RUNTIME_PACKAGE=FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
