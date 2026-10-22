import { cp, lstat, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  throw new Error(message);
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function assertDirectory(directory, label) {
  let info;
  try {
    info = await lstat(directory);
  } catch {
    fail(`${label} does not exist: ${directory}`);
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail(`${label} must be a real directory: ${directory}`);
  }
}

async function assertFile(file, label) {
  let info;
  try {
    info = await stat(file);
  } catch {
    fail(`${label} is missing: ${file}`);
  }
  if (!info.isFile() || info.size === 0) {
    fail(`${label} must be a non-empty file: ${file}`);
  }
}

async function assertDistribution(distributionPath, label) {
  await assertDirectory(distributionPath, `${label} dist`);
  await assertFile(path.join(distributionPath, "index.js"), `${label} dist/index.js`);
  await assertDirectory(path.join(distributionPath, "public"), `${label} dist/public`);
  await assertFile(path.join(distributionPath, "public", "index.html"), `${label} dist/public/index.html`);
  await assertDirectory(path.join(distributionPath, "public", "assets"), `${label} dist/public/assets`);
}

async function removeRootEnvironmentFiles(runtimePath) {
  const removed = [];
  for (const entry of await readdir(runtimePath, { withFileTypes: true })) {
    if (!entry.name.startsWith(".env")) continue;
    const candidate = path.join(runtimePath, entry.name);
    const info = await lstat(candidate);
    if (!info.isFile() || info.isSymbolicLink()) {
      fail(`Runtime environment entry is not a removable regular file: ${entry.name}`);
    }
    await rm(candidate, { force: false });
    removed.push(entry.name);
  }
  return removed.sort();
}

async function assertNoRootEnvironmentFiles(runtimePath) {
  const environmentFiles = (await readdir(runtimePath, { withFileTypes: true }))
    .filter((entry) => entry.name.startsWith(".env"));
  if (environmentFiles.length > 0) {
    fail(`Runtime contains a forbidden environment entry: ${environmentFiles[0].name}`);
  }
}

async function assertSymlinksStayInside(runtimePath) {
  const physicalRuntime = await realpath(runtimePath);
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      const info = await lstat(candidate);
      if (info.isSymbolicLink()) {
        let target;
        try {
          target = await realpath(candidate);
        } catch {
          fail(`Runtime contains a dangling symbolic link: ${candidate}`);
        }
        if (!isPathInside(target, physicalRuntime)) {
          fail(`Runtime symbolic link resolves outside the release: ${candidate}`);
        }
        continue;
      }
      if (info.isDirectory()) await walk(candidate);
      else if (!info.isFile()) fail(`Runtime contains an unsupported entry: ${candidate}`);
    }
  }
  await walk(runtimePath);
}

async function assertDeclaredDependencies(runtimePath) {
  const packagePath = path.join(runtimePath, "package.json");
  await assertFile(packagePath, "Runtime package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const dependencies = Object.keys(packageJson.dependencies ?? {});
  if (dependencies.length === 0) fail("Runtime has no declared production dependencies.");

  const nodeModulesPath = path.join(runtimePath, "node_modules");
  await assertDirectory(nodeModulesPath, "Runtime node_modules");
  const physicalNodeModules = await realpath(nodeModulesPath);
  for (const dependency of dependencies) {
    const dependencyPath = path.join(nodeModulesPath, dependency);
    let logicalDependency;
    try {
      logicalDependency = await lstat(dependencyPath);
    } catch {
      fail(`Runtime dependency is missing: ${dependency}`);
    }
    if (!logicalDependency.isDirectory() && !logicalDependency.isSymbolicLink()) {
      fail(`Runtime dependency must be a directory or symbolic link: ${dependency}`);
    }
    let physicalDependency;
    try {
      physicalDependency = await realpath(dependencyPath);
    } catch {
      fail(`Runtime dependency is a dangling symbolic link: ${dependency}`);
    }
    const physicalInfo = await stat(physicalDependency);
    if (!physicalInfo.isDirectory()) {
      fail(`Runtime dependency does not resolve to a directory: ${dependency}`);
    }
    if (!isPathInside(physicalDependency, physicalNodeModules)) {
      fail(`Runtime dependency resolves outside node_modules: ${dependency}`);
    }
  }
  return dependencies.length;
}

export async function validateRuntime(runtime) {
  const runtimePath = path.resolve(runtime);
  await assertDirectory(runtimePath, "Runtime");
  await assertNoRootEnvironmentFiles(runtimePath);
  await assertDistribution(path.join(runtimePath, "dist"), "Runtime");
  const dependencyCount = await assertDeclaredDependencies(runtimePath);
  await assertSymlinksStayInside(runtimePath);
  return { runtimePath, dependencyCount };
}

export async function assembleRuntime({ source, runtime }) {
  const sourcePath = path.resolve(source);
  const runtimePath = path.resolve(runtime);
  await assertDirectory(sourcePath, "Build source");
  await assertDirectory(runtimePath, "Runtime destination");
  if (sourcePath === runtimePath) fail("Build source and runtime destination must differ.");

  const sourceDist = path.join(sourcePath, "dist");
  const runtimeDist = path.join(runtimePath, "dist");
  await assertDistribution(sourceDist, "Build source");
  try {
    await lstat(runtimeDist);
    fail(`Runtime destination already contains dist: ${runtimeDist}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await assertDeclaredDependencies(runtimePath);

  const removedEnvironmentFiles = await removeRootEnvironmentFiles(runtimePath);
  const temporaryDist = path.join(runtimePath, `.runtime-dist-assembly-${process.pid}-${Date.now()}`);
  try {
    await cp(sourceDist, temporaryDist, { recursive: true, force: false, errorOnExist: true, dereference: false });
    await assertDistribution(temporaryDist, "Assembled runtime");
    await assertSymlinksStayInside(temporaryDist);
    await rename(temporaryDist, runtimeDist);
    const validation = await validateRuntime(runtimePath);
    return { ...validation, removedEnvironmentFiles };
  } finally {
    await rm(temporaryDist, { recursive: true, force: true });
  }
}

export function parseArguments(argumentsList) {
  const normalizedArguments = argumentsList[0] === "--" ? argumentsList.slice(1) : argumentsList;
  if (normalizedArguments.length !== 4) {
    fail("Usage: node scripts/operations/assemble-runtime-release.mjs --source <built-checkout> --runtime <pnpm-deploy-destination>");
  }
  const options = {};
  for (let index = 0; index < normalizedArguments.length; index += 2) {
    const flag = normalizedArguments[index];
    const value = normalizedArguments[index + 1];
    if ((flag !== "--source" && flag !== "--runtime") || !value || options[flag]) {
      fail("Usage: node scripts/operations/assemble-runtime-release.mjs --source <built-checkout> --runtime <pnpm-deploy-destination>");
    }
    options[flag] = value;
  }
  if (!options["--source"] || !options["--runtime"]) {
    fail("Usage: node scripts/operations/assemble-runtime-release.mjs --source <built-checkout> --runtime <pnpm-deploy-destination>");
  }
  return { source: options["--source"], runtime: options["--runtime"] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const result = await assembleRuntime(parseArguments(process.argv.slice(2)));
    process.stdout.write(`RUNTIME_ASSEMBLY=PASS runtime=${result.runtimePath} dependencies=${result.dependencyCount} removedEnv=${result.removedEnvironmentFiles.length}\n`);
  } catch (error) {
    process.stderr.write(`RUNTIME_ASSEMBLY=FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
