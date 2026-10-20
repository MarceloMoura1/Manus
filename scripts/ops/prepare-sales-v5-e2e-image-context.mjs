import { copyFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { POLICY_RELATIVE_PATH, PROVENANCE_RELATIVE_PATH, loadAndValidateProvenance } from "./validate-sales-v5-e2e-image-provenance.mjs";
import { renderDockerfile } from "./generate-sales-v5-e2e-dockerfile.mjs";

const INTEGRITY_FILE = "qualification-context.json";
const STATIC_PATHS = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "patches"];
const VALIDATOR_PATH = "scripts/ops/validate-sales-v5-e2e-tar.mjs";
const WORKFLOW_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function fail(message) {
  throw new Error(`Contexto de qualificacao invalido: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function inside(root, candidate) {
  return candidate.startsWith(`${root}${path.sep}`);
}

async function copyStrict(source, destination) {
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink()) fail(`symlink nao permitido no contexto: ${source}`);
  if (metadata.isFile()) {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    return;
  }
  if (!metadata.isDirectory()) fail(`tipo nao permitido no contexto: ${source}`);
  await mkdir(destination, { recursive: true });
  for (const entry of (await readdir(source, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    if (entry.isSymbolicLink()) fail(`symlink nao permitido no contexto: ${path.join(source, entry.name)}`);
    await copyStrict(path.join(source, entry.name), path.join(destination, entry.name));
  }
}

async function inventory(root, relative = "") {
  const current = path.join(root, relative);
  const metadata = await lstat(current);
  if (metadata.isSymbolicLink()) fail(`symlink no contexto: ${relative || "."}`);
  if (metadata.isFile()) {
    const bytes = await readFile(current);
    return [{ path: relative.replaceAll(path.sep, "/"), sizeBytes: bytes.length, sha256: sha256(bytes) }];
  }
  if (!metadata.isDirectory()) fail(`tipo inesperado no contexto: ${relative || "."}`);
  const results = [];
  for (const entry of (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    if (child.replaceAll(path.sep, "/") === INTEGRITY_FILE) continue;
    results.push(...await inventory(root, child));
  }
  return results;
}

async function assertOutputAbsent(outputPath) {
  try {
    await stat(outputPath);
    fail(`destino ja existe e nao sera reutilizado: ${outputPath}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Contexto de qualificacao invalido:")) throw error;
    if (error?.code !== "ENOENT") throw error;
  }
}

async function assertExternalArchive(archiveSource, archive) {
  if (typeof archiveSource !== "string" || !archiveSource) fail("arquivo Chromium externo obrigatorio");
  let metadata;
  try {
    metadata = await lstat(archiveSource);
  } catch {
    fail("arquivo Chromium externo ausente");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail("arquivo Chromium externo deve ser regular e nao pode ser symlink");
  if (metadata.size !== archive.sizeBytes) fail("arquivo Chromium externo possui tamanho divergente");
  const bytes = await readFile(archiveSource);
  if (sha256(bytes) !== archive.sha256) fail("arquivo Chromium externo possui SHA-256 divergente");
  try {
    return await realpath(archiveSource);
  } catch {
    fail("arquivo Chromium externo nao pode ser resolvido");
  }
}

export async function verifyQualificationContext(contextPath) {
  const integrityPath = path.join(contextPath, INTEGRITY_FILE);
  let document;
  try {
    document = JSON.parse(await readFile(integrityPath, "utf8"));
  } catch {
    fail("manifesto de integridade ausente ou invalido");
  }
  if (document.schemaVersion !== 1 || !Array.isArray(document.files) || typeof document.dockerfileSha256 !== "string" || !/^[a-f0-9]{64}$/.test(document.dockerfileSha256)) {
    fail("manifesto de integridade possui estrutura invalida");
  }
  const actual = await inventory(contextPath);
  if (JSON.stringify(actual) !== JSON.stringify(document.files)) fail("arquivos do contexto foram alterados apos o congelamento");
  const dockerfile = await readFile(path.join(contextPath, "Dockerfile.e2e-arm64"));
  if (sha256(dockerfile) !== document.dockerfileSha256) fail("Dockerfile gerado foi alterado apos o congelamento");
  return Object.freeze({ files: actual.length, dockerfileSha256: document.dockerfileSha256 });
}

export async function prepareQualificationContext({ repoRoot = process.cwd(), outputPath, archiveSource } = {}) {
  if (typeof outputPath !== "string" || !outputPath) fail("caminho de saida obrigatorio");
  const root = path.resolve(repoRoot);
  const output = path.resolve(outputPath);
  if (inside(root, output)) fail("contexto nao pode ser criado dentro do checkout");
  await assertOutputAbsent(output);
  const validated = await loadAndValidateProvenance(path.join(root, PROVENANCE_RELATIVE_PATH), {
    requireApproved: true,
    verifyEvidence: true,
    requireArchive: false,
    repoRoot: root,
    policyPath: path.join(root, POLICY_RELATIVE_PATH),
  });
  const externalArchive = await assertExternalArchive(archiveSource, validated.candidate.archive);
  const temporary = `${output}.partial-${randomUUID()}`;
  let temporaryCreated = false;
  try {
    await mkdir(temporary, { recursive: false });
    temporaryCreated = true;
    const paths = [
      ...STATIC_PATHS,
      PROVENANCE_RELATIVE_PATH,
      POLICY_RELATIVE_PATH,
      validated.candidate.archive.extractedFilesManifest.relativePath,
      validated.candidate.evidence.acquisition.relativePath,
      validated.candidate.evidence.extraction.relativePath,
      validated.candidate.evidence.approval.relativePath,
      validated.candidate.evidence.ociIndex.relativePath,
      validated.candidate.evidence.ociPlatformManifest.relativePath,
    ];
    for (const relativePath of [...new Set(paths)].sort((left, right) => left.localeCompare(right, "en"))) {
      const source = path.resolve(root, relativePath);
      if (!inside(root, source)) fail(`caminho fora da raiz: ${relativePath}`);
      await copyStrict(source, path.join(temporary, relativePath));
    }
    // The workflow checkout supplies the reviewed validator; project inputs
    // remain pinned to the separate immutable project commit.
    await copyStrict(path.join(WORKFLOW_ROOT, VALIDATOR_PATH), path.join(temporary, VALIDATOR_PATH));
    await copyStrict(externalArchive, path.join(temporary, validated.candidate.archive.relativePath));
    // Render only from copied-and-revalidated evidence. This prevents a source
    // tree change after the first validation from changing Docker build inputs.
    const stagedValidated = await loadAndValidateProvenance(path.join(temporary, PROVENANCE_RELATIVE_PATH), {
      requireApproved: true,
      verifyEvidence: true,
      repoRoot: temporary,
      policyPath: path.join(temporary, POLICY_RELATIVE_PATH),
    });
    const dockerfile = renderDockerfile(stagedValidated);
    await writeFile(path.join(temporary, "Dockerfile.e2e-arm64"), dockerfile, "utf8");
    const files = await inventory(temporary);
    const document = { schemaVersion: 1, files, dockerfileSha256: sha256(Buffer.from(dockerfile, "utf8")) };
    await writeFile(path.join(temporary, INTEGRITY_FILE), `${JSON.stringify(document)}\n`, "utf8");
    await verifyQualificationContext(temporary);
    await rename(temporary, output);
    return Object.freeze({ outputPath: output, ...await verifyQualificationContext(output) });
  } catch (error) {
    if (temporaryCreated) await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function cliOptions(argv) {
  if (argv.length === 4 && argv[0] === "--output" && argv[2] === "--archive-source") return { outputPath: argv[1], archiveSource: argv[3] };
  if (argv.length === 2 && argv[0] === "--verify") return { verify: argv[1] };
  fail("uso: --output <diretorio-novo> --archive-source <arquivo-chromium> | --verify <contexto>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = cliOptions(process.argv.slice(2));
    const result = options.verify ? await verifyQualificationContext(options.verify) : await prepareQualificationContext(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Falha ao preparar contexto.");
    process.exitCode = error && typeof error === "object" && "exitCode" in error ? error.exitCode : 2;
  }
}
