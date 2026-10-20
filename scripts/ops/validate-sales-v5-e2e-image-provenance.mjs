import { lstat, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PROVENANCE_RELATIVE_PATH = ".github/qualification-provenance/sales-v5-e2e-chromium-arm64.json";
export const POLICY_RELATIVE_PATH = ".github/qualification-provenance/sales-v5-e2e-chromium-arm64-policy.json";
export const EXPECTED = Object.freeze({
  nodeVersion: "v22.23.2",
  pnpmVersion: "10.18.0",
  playwrightVersion: "1.60.0",
  platform: Object.freeze({ os: "linux", architecture: "arm64" }),
  browserPath: "/opt/ms-playwright",
});

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REPOSITORY = /^(?!.*(?:<|>|placeholder))(?:[a-z0-9][a-z0-9._-]*(?::[0-9]{1,5})?\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const SNAPSHOT = /^https:\/\/snapshot\.debian\.org\/archive\/debian\/\d{8}T\d{6}Z\/$/;
const PNPM_URL = /^https:\/\/[^/@?#]+(?:\/[^?#]+)*\/pnpm-10\.18\.0\.tgz$/;
const PLAYWRIGHT_CHROMIUM_ARM64_URL = /^https:\/\/cdn\.playwright\.dev\/dbazure\/download\/playwright\/builds\/chromium\/[0-9]+\/chromium-linux-arm64\.zip$/;
const SAFE_PATH = /^(?:\.?[A-Za-z0-9][A-Za-z0-9._-]*)(?:\/(?:\.?[A-Za-z0-9][A-Za-z0-9._-]*))*$/;
const BROWSER_VERSION = /^\d+(?:\.\d+){1,3}$/;
const CHROMIUM_REVISION = /^\d+$/;

export class ProvenancePendingError extends Error {
  constructor(message = "BLOCKED_CHROMIUM_PROVENANCE: a proveniencia Chromium ARM64 ainda esta pendente") {
    super(message);
    this.name = "ProvenancePendingError";
    this.exitCode = 78;
  }
}

export class ProvenanceValidationError extends Error {
  constructor(message) {
    super(`Proveniencia E2E ARM64 invalida: ${message}`);
    this.name = "ProvenanceValidationError";
    this.exitCode = 2;
  }
}

function fail(message) {
  throw new ProvenanceValidationError(message);
}

function object(value, label, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} deve ser objeto`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${label} possui campos ausentes ou inesperados`);
}

function text(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} deve ser texto nao vazio`);
  return value;
}

function digest(value, label, prefixed = true) {
  if (typeof value !== "string" || !(prefixed ? DIGEST : SHA256).test(value)) fail(`${label} deve conter SHA-256 minusculo`);
  return value;
}

function platform(value, label) {
  object(value, label, ["architecture", "os"]);
  if (value.os !== "linux" || value.architecture !== "arm64") fail(`${label} deve ser linux/arm64`);
  return Object.freeze({ os: value.os, architecture: value.architecture });
}

function relative(value, label, prefix) {
  const result = text(value, label);
  if (!SAFE_PATH.test(result) || result.includes("\\") || !result.startsWith(prefix) || path.posix.normalize(result) !== result) {
    fail(`${label} deve ser caminho POSIX ASCII seguro sob ${prefix}`);
  }
  return result;
}

function sourceImage(value, label) {
  object(value, label, ["configDigest", "indexDigest", "platform", "platformManifestDigest", "repository"]);
  const repository = text(value.repository, `${label}.repository`);
  if (!REPOSITORY.test(repository)) fail(`${label}.repository nao pertence a origem valida`);
  return Object.freeze({
    repository,
    indexDigest: digest(value.indexDigest, `${label}.indexDigest`),
    platformManifestDigest: digest(value.platformManifestDigest, `${label}.platformManifestDigest`),
    configDigest: digest(value.configDigest, `${label}.configDigest`),
    platform: platform(value.platform, `${label}.platform`),
  });
}

function playwright(value, label) {
  object(value, label, ["browserVersion", "chromiumRevision", "packageVersion"]);
  if (value.packageVersion !== EXPECTED.playwrightVersion) fail(`${label}.packageVersion deve ser ${EXPECTED.playwrightVersion}`);
  const chromiumRevision = text(value.chromiumRevision, `${label}.chromiumRevision`);
  const browserVersion = text(value.browserVersion, `${label}.browserVersion`);
  if (!CHROMIUM_REVISION.test(chromiumRevision)) fail(`${label}.chromiumRevision deve ser numerica`);
  if (!BROWSER_VERSION.test(browserVersion)) fail(`${label}.browserVersion deve ser versao numerica Chromium`);
  return Object.freeze({
    packageVersion: value.packageVersion,
    chromiumRevision,
    browserVersion,
  });
}

function buildInputs(value, label) {
  object(value, label, ["aptSnapshot", "pnpmTarball"]);
  if (typeof value.aptSnapshot !== "string" || !SNAPSHOT.test(value.aptSnapshot)) fail(`${label}.aptSnapshot deve ser um Debian Snapshot datado`);
  object(value.pnpmTarball, `${label}.pnpmTarball`, ["sha256", "url"]);
  if (typeof value.pnpmTarball.url !== "string" || !PNPM_URL.test(value.pnpmTarball.url)) fail(`${label}.pnpmTarball.url deve ser origem HTTPS fixada de pnpm-10.18.0.tgz`);
  return Object.freeze({
    aptSnapshot: value.aptSnapshot,
    pnpmTarball: Object.freeze({ url: value.pnpmTarball.url, sha256: digest(value.pnpmTarball.sha256, `${label}.pnpmTarball.sha256`, false) }),
  });
}

function fileRecord(value, label, prefix) {
  object(value, label, ["relativePath", "sha256", "sizeBytes"]);
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes <= 0) fail(`${label}.sizeBytes deve ser inteiro positivo`);
  return Object.freeze({
    relativePath: relative(value.relativePath, `${label}.relativePath`, prefix),
    sha256: digest(value.sha256, `${label}.sha256`, false),
    sizeBytes: value.sizeBytes,
  });
}

function archive(value, label) {
  object(value, label, ["extractedFilesManifest", "format", "relativePath", "sha256", "sizeBytes", "url"]);
  if (value.format !== "tar.gz" && value.format !== "zip") fail(`${label}.format deve ser tar.gz ou zip`);
  const record = fileRecord({ relativePath: value.relativePath, sha256: value.sha256, sizeBytes: value.sizeBytes }, label, "third_party/e2e-chromium/");
  if ((value.format === "tar.gz" && !record.relativePath.endsWith(".tar.gz")) || (value.format === "zip" && !record.relativePath.endsWith(".zip"))) {
    fail(`${label}.relativePath nao corresponde ao formato declarado`);
  }
  if (typeof value.url !== "string" || !PLAYWRIGHT_CHROMIUM_ARM64_URL.test(value.url)) fail(`${label}.url deve ser a origem oficial Playwright Chromium Linux ARM64`);
  return Object.freeze({ ...record, format: value.format, url: value.url, extractedFilesManifest: fileRecord(value.extractedFilesManifest, `${label}.extractedFilesManifest`, ".github/qualification-provenance/evidence/") });
}

function evidence(value, label) {
  object(value, label, ["acquisition", "approval", "extraction", "ociIndex", "ociPlatformManifest"]);
  return Object.freeze({
    acquisition: fileRecord(value.acquisition, `${label}.acquisition`, ".github/qualification-provenance/evidence/"),
    extraction: fileRecord(value.extraction, `${label}.extraction`, ".github/qualification-provenance/evidence/"),
    approval: fileRecord(value.approval, `${label}.approval`, ".github/qualification-provenance/evidence/"),
    ociIndex: fileRecord(value.ociIndex, `${label}.ociIndex`, ".github/qualification-provenance/evidence/"),
    ociPlatformManifest: fileRecord(value.ociPlatformManifest, `${label}.ociPlatformManifest`, ".github/qualification-provenance/evidence/"),
  });
}

function policy(value, label) {
  object(value, label, ["buildInputs", "playwright", "sourceImage"]);
  return Object.freeze({ sourceImage: sourceImage(value.sourceImage, `${label}.sourceImage`), playwright: playwright(value.playwright, `${label}.playwright`), buildInputs: buildInputs(value.buildInputs, `${label}.buildInputs`) });
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateExpected(value) {
  object(value, "expected", ["nodeVersion", "platform", "playwrightVersion", "pnpmVersion"]);
  if (value.nodeVersion !== EXPECTED.nodeVersion || value.pnpmVersion !== EXPECTED.pnpmVersion || value.playwrightVersion !== EXPECTED.playwrightVersion) fail("expected possui versao Node, pnpm ou Playwright divergente");
  platform(value.platform, "expected.platform");
}

export function validateTrustPolicy(value) {
  object(value, "trustPolicy", ["approvedCandidates", "expected", "schemaVersion", "status"]);
  if (value.schemaVersion !== 1) fail("trustPolicy.schemaVersion deve ser 1");
  validateExpected(value.expected);
  if (!Array.isArray(value.approvedCandidates)) fail("trustPolicy.approvedCandidates deve ser lista");
  if (value.status === "pending") {
    if (value.approvedCandidates.length !== 0) fail("trustPolicy pending nao pode conter candidatos aprovados");
    return Object.freeze({ status: "pending", approvedCandidates: [] });
  }
  if (value.status !== "approved" || value.approvedCandidates.length === 0) fail("trustPolicy approved exige candidatos expressamente aprovados");
  return Object.freeze({ status: "approved", approvedCandidates: value.approvedCandidates.map((entry, index) => policy(entry, `trustPolicy.approvedCandidates[${index}]`)) });
}

function pending(manifest) {
  object(manifest.candidate, "candidate", ["archive", "buildInputs", "evidence", "finalImage", "playwright", "sourceImage"]);
  const { candidate } = manifest;
  object(candidate.playwright, "candidate.playwright", ["browserVersion", "chromiumRevision", "packageVersion"]);
  if (candidate.playwright.packageVersion !== EXPECTED.playwrightVersion || candidate.playwright.browserVersion !== null || candidate.playwright.chromiumRevision !== null || candidate.sourceImage !== null || candidate.buildInputs.aptSnapshot !== null || candidate.buildInputs.pnpmTarball !== null || candidate.archive !== null || candidate.evidence.acquisition !== null || candidate.evidence.extraction !== null || candidate.evidence.approval !== null || candidate.evidence.ociIndex !== null || candidate.evidence.ociPlatformManifest !== null || candidate.finalImage !== null) {
    fail("manifest pending deve conter somente versao Playwright conhecida; toda proveniencia e imagem final devem ser nulas");
  }
  return Object.freeze({ status: "pending", expected: EXPECTED });
}

export function validateProvenance(manifest, { requireApproved = false, trustPolicy = undefined } = {}) {
  object(manifest, "manifest", ["candidate", "expected", "schemaVersion", "status"]);
  if (manifest.schemaVersion !== 1) fail("schemaVersion deve ser 1");
  validateExpected(manifest.expected);
  if (manifest.status === "pending") {
    const result = pending(manifest);
    if (requireApproved) throw new ProvenancePendingError();
    return result;
  }
  if (manifest.status !== "approved") fail("status deve ser pending ou approved");
  if (!trustPolicy) throw new ProvenancePendingError("BLOCKED_CHROMIUM_PROVENANCE: politica de confianca aprovada esta ausente");
  const validatedPolicy = validateTrustPolicy(trustPolicy);
  if (validatedPolicy.status !== "approved") throw new ProvenancePendingError("BLOCKED_CHROMIUM_PROVENANCE: politica de confianca ainda esta pendente");
  object(manifest.candidate, "candidate", ["archive", "buildInputs", "evidence", "finalImage", "playwright", "sourceImage"]);
  if (manifest.candidate.finalImage !== null) fail("finalImage deve permanecer nulo antes de existir evidencia externa de build e qualificacao");
  const candidate = Object.freeze({
    sourceImage: sourceImage(manifest.candidate.sourceImage, "candidate.sourceImage"),
    playwright: playwright(manifest.candidate.playwright, "candidate.playwright"),
    buildInputs: buildInputs(manifest.candidate.buildInputs, "candidate.buildInputs"),
    archive: archive(manifest.candidate.archive, "candidate.archive"),
    evidence: evidence(manifest.candidate.evidence, "candidate.evidence"),
    finalImage: null,
  });
  if (!candidate.archive.url.includes(`/chromium/${candidate.playwright.chromiumRevision}/`)) {
    fail("candidate.archive.url deve apontar para a revisao Chromium aprovada");
  }
  const candidatePolicy = { sourceImage: candidate.sourceImage, playwright: candidate.playwright, buildInputs: candidate.buildInputs };
  if (!validatedPolicy.approvedCandidates.some(entry => same(entry, candidatePolicy))) fail("origem, plataforma, revisao Chromium ou build inputs nao pertencem a politica de aprovacao");
  return Object.freeze({ status: "approved", expected: EXPECTED, trustPolicy: validatedPolicy, candidate });
}

function isInside(root, target) {
  return target.startsWith(`${root}${path.sep}`);
}

async function resolveInside(repoRoot, relativePath, dependencies) {
  let root;
  try {
    root = await dependencies.realpath(path.resolve(repoRoot));
  } catch {
    fail("raiz de evidencias nao existe ou nao pode ser resolvida");
  }
  const lexical = path.resolve(root, relativePath);
  if (!isInside(root, lexical)) fail(`caminho de evidencia fora do repositorio: ${relativePath}`);
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    let metadata;
    try {
      metadata = await dependencies.lstat(current);
    } catch {
      fail(`artefato ou evidencia ausente: ${relativePath}`);
    }
    if (metadata.isSymbolicLink()) fail(`artefato ou evidencia usa symlink: ${relativePath}`);
  }
  let resolved;
  try {
    resolved = await dependencies.realpath(lexical);
  } catch {
    fail(`artefato ou evidencia ausente: ${relativePath}`);
  }
  if (!isInside(root, resolved)) fail(`artefato ou evidencia resolve fora do repositorio: ${relativePath}`);
  return lexical;
}

async function assertFile(record, repoRoot, dependencies) {
  const target = await resolveInside(repoRoot, record.relativePath, dependencies);
  let metadata;
  try {
    metadata = await dependencies.lstat(target);
  } catch {
    fail(`artefato ou evidencia ausente: ${record.relativePath}`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`artefato ou evidencia nao e arquivo regular: ${record.relativePath}`);
  if (metadata.size !== record.sizeBytes) fail(`tamanho divergente: ${record.relativePath}`);
  const bytes = await dependencies.readFile(target);
  if (createHash("sha256").update(bytes).digest("hex") !== record.sha256) fail(`SHA-256 divergente: ${record.relativePath}`);
}

export async function validateEvidenceFiles(validated, { repoRoot = process.cwd(), requireArchive = true, dependencies = { readFile, lstat, realpath } } = {}) {
  if (!validated || validated.status !== "approved") throw new ProvenancePendingError();
  const values = [
    ...(requireArchive ? [validated.candidate.archive] : []),
    validated.candidate.archive.extractedFilesManifest,
    validated.candidate.evidence.acquisition,
    validated.candidate.evidence.extraction,
    validated.candidate.evidence.approval,
    validated.candidate.evidence.ociIndex,
    validated.candidate.evidence.ociPlatformManifest,
  ];
  await Promise.all(values.map(value => assertFile(value, repoRoot, dependencies)));
  return Object.freeze({ verifiedArtifacts: values.map(value => value.relativePath) });
}

async function readJson(filePath, missingMessage) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    throw new ProvenancePendingError(missingMessage);
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail("manifest nao contem JSON valido");
  }
}

export async function loadAndValidateProvenance(manifestPath = path.join(process.cwd(), PROVENANCE_RELATIVE_PATH), { requireApproved = false, verifyEvidence = false, requireArchive = true, repoRoot = process.cwd(), policyPath = path.join(repoRoot, POLICY_RELATIVE_PATH), dependencies } = {}) {
  const parsed = await readJson(manifestPath, "BLOCKED_CHROMIUM_PROVENANCE: o manifesto de proveniencia esta ausente");
  if (parsed.status === "pending") return validateProvenance(parsed, { requireApproved });
  const trustPolicy = await readJson(policyPath, "BLOCKED_CHROMIUM_PROVENANCE: a politica de confianca esta ausente");
  const validated = validateProvenance(parsed, { requireApproved, trustPolicy });
  if (verifyEvidence) await validateEvidenceFiles(validated, { repoRoot, requireArchive, dependencies });
  return validated;
}

function cliOptions(argv) {
  const result = { requireApproved: false, verifyEvidence: false, requireArchive: true };
  for (const argument of argv) {
    if (argument === "--require-approved") result.requireApproved = true;
    else if (argument === "--verify-evidence") result.verifyEvidence = true;
    else if (argument === "--allow-external-archive") result.requireArchive = false;
    else fail("uso: [--require-approved] [--verify-evidence] [--allow-external-archive]");
  }
  if (!result.verifyEvidence && !result.requireArchive) fail("--allow-external-archive exige --verify-evidence");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = cliOptions(process.argv.slice(2));
  const repoRoot = process.cwd();
  loadAndValidateProvenance(path.join(repoRoot, PROVENANCE_RELATIVE_PATH), { ...options, repoRoot, policyPath: path.join(repoRoot, POLICY_RELATIVE_PATH) })
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => {
      console.error(error instanceof Error ? error.message : "Falha de proveniencia.");
      process.exitCode = error && typeof error === "object" && "exitCode" in error ? error.exitCode : 2;
    });
}
