import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

function fail(message) {
  throw new Error(message);
}

function getReleaseArgument() {
  const index = process.argv.indexOf("--release");
  if (index === -1 || !process.argv[index + 1]) {
    fail("Usage: node --experimental-vm-modules Assert-MegaDeskProductionRelease.mjs --release <path>");
  }
  return process.argv[index + 1];
}

function isQuiet() {
  return process.argv.includes("--quiet");
}

function normalizePath(value) {
  const normalized = path.normalize(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function isPathInside(candidate, root) {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedRoot = normalizePath(root);
  return normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot + path.sep);
}

function resolveRelativeSpecifier(entryPath, specifier) {
  if (specifier.startsWith("file:")) {
    return fileURLToPath(specifier);
  }
  return path.resolve(path.dirname(entryPath), specifier);
}

function assertNoEnvironmentFiles(releasePath) {
  const environmentFiles = readdirSync(releasePath, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.startsWith(".env"));
  if (environmentFiles.length > 0) {
    fail("Release contains forbidden environment file: " + environmentFiles[0].name);
  }
}

function assertDeclaredProductionDependencies(releasePath, nodeModulesPath) {
  const packagePath = path.join(releasePath, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8").replace(/^\uFEFF/, ""));
  const dependencies = Object.keys(packageJson.dependencies ?? {});
  if (dependencies.length === 0) {
    fail("Release has no declared production dependencies.");
  }
  for (const dependency of dependencies) {
    const dependencyPath = path.join(nodeModulesPath, dependency);
    if (!existsSync(dependencyPath)) {
      fail("Declared production dependency is missing: " + dependency);
    }
  }
}

function getStaticModuleSpecifiers(entryPath) {
  const source = readFileSync(entryPath, "utf8");
  const module = new vm.SourceTextModule(source, {
    identifier: pathToFileURL(entryPath).href,
  });
  return [...new Set(module.moduleRequests.map(request => request.specifier))];
}

function assertStaticImportResolution(releasePath, nodeModulesPath, entryPath) {
  const requireFromEntry = createRequire(pathToFileURL(entryPath));
  const staticImports = getStaticModuleSpecifiers(entryPath);

  for (const specifier of staticImports) {
    if (specifier.startsWith("node:") || builtinModules.includes(specifier)) {
      continue;
    }

    if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("file:")) {
      const logicalPath = resolveRelativeSpecifier(entryPath, specifier);
      if (!existsSync(logicalPath)) {
        fail("Static runtime import is missing: " + specifier);
      }
      const physicalPath = realpathSync(logicalPath);
      if (!isPathInside(physicalPath, releasePath)) {
        fail("Static runtime import resolves outside the release: " + specifier);
      }
      continue;
    }

    let resolvedPath;
    try {
      resolvedPath = requireFromEntry.resolve(specifier);
    } catch {
      fail("Static production runtime import is unresolved: " + specifier);
    }

    const physicalPath = realpathSync(resolvedPath);
    if (!isPathInside(physicalPath, nodeModulesPath)) {
      fail("Static production runtime import resolves outside release node_modules: " + specifier);
    }
  }

  return staticImports;
}

try {
  const releasePath = realpathSync(getReleaseArgument());
  const nodeModulesPath = realpathSync(path.join(releasePath, "node_modules"));
  const entryPath = path.join(releasePath, "dist", "index.js");

  if (!lstatSync(releasePath).isDirectory()) {
    fail("Release path must be a directory.");
  }
  if (!lstatSync(nodeModulesPath).isDirectory()) {
    fail("Release node_modules path must be a directory.");
  }
  if (!lstatSync(entryPath).isFile()) {
    fail("Release dist/index.js must be a file.");
  }

  assertNoEnvironmentFiles(releasePath);
  assertDeclaredProductionDependencies(releasePath, nodeModulesPath);
  const staticImports = assertStaticImportResolution(releasePath, nodeModulesPath, entryPath);
  if (!isQuiet()) {
    console.log("Production release import check passed: " + staticImports.length + " static imports resolved.");
  }
} catch (error) {
  if (!isQuiet()) {
    console.error("Production release import check failed: " + error.message);
  }
  process.exitCode = 1;
}
