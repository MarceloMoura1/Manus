import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { POLICY_RELATIVE_PATH, PROVENANCE_RELATIVE_PATH, loadAndValidateProvenance } from "./validate-sales-v5-e2e-image-provenance.mjs";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const INDEX_MEDIA_TYPE = "application/vnd.oci.image.index.v1+json";
const MANIFEST_MEDIA_TYPE = "application/vnd.oci.image.manifest.v1+json";

function fail(message) {
  throw new Error(`Vinculo OCI invalido: ${message}`);
}

function hash(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function json(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${label} nao e JSON valido`);
  }
}

function descriptor(value, label) {
  if (!value || typeof value !== "object" || typeof value.digest !== "string" || !DIGEST.test(value.digest)) fail(`${label} possui digest invalido`);
  return value;
}

export function validateOciBinding({ indexBytes, platformManifestBytes, sourceImage }) {
  if (!sourceImage || sourceImage.platform?.os !== "linux" || sourceImage.platform?.architecture !== "arm64") fail("politica exige plataforma linux/arm64");
  if (hash(indexBytes) !== sourceImage.indexDigest) fail("digest do indice diverge da politica aprovada");
  if (hash(platformManifestBytes) !== sourceImage.platformManifestDigest) fail("digest do manifesto de plataforma diverge da politica aprovada");
  const index = json(indexBytes, "indice OCI");
  if (index.schemaVersion !== 2 || index.mediaType !== INDEX_MEDIA_TYPE || !Array.isArray(index.manifests)) fail("indice OCI possui formato ou media type invalido");
  const matches = index.manifests.filter(entry => entry?.platform?.os === "linux" && entry?.platform?.architecture === "arm64");
  if (matches.length !== 1) fail("indice OCI deve conter exatamente um descritor linux/arm64");
  const arm64Descriptor = descriptor(matches[0], "descritor linux/arm64");
  if (arm64Descriptor.mediaType !== MANIFEST_MEDIA_TYPE || arm64Descriptor.digest !== sourceImage.platformManifestDigest) fail("descritor linux/arm64 nao aponta para o manifesto aprovado");
  const platformManifest = json(platformManifestBytes, "manifesto OCI de plataforma");
  if (platformManifest.schemaVersion !== 2 || platformManifest.mediaType !== MANIFEST_MEDIA_TYPE) fail("manifesto OCI de plataforma possui formato ou media type invalido");
  if (descriptor(platformManifest.config, "config OCI").digest !== sourceImage.configDigest) fail("manifesto de plataforma nao aponta para configDigest aprovado");
  return Object.freeze({ indexDigest: sourceImage.indexDigest, platformManifestDigest: sourceImage.platformManifestDigest, configDigest: sourceImage.configDigest, platform: "linux/arm64" });
}

function cliOptions(argv) {
  if ((argv.length !== 4 && argv.length !== 5) || argv[0] !== "--index" || argv[2] !== "--platform-manifest" || (argv.length === 5 && argv[4] !== "--allow-external-archive")) {
    fail("uso: --index <indice.json> --platform-manifest <manifest.json> [--allow-external-archive]");
  }
  return { index: argv[1], platformManifest: argv[3], requireArchive: argv[4] !== "--allow-external-archive" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = cliOptions(process.argv.slice(2));
    const repoRoot = process.cwd();
    const provenance = await loadAndValidateProvenance(path.join(repoRoot, PROVENANCE_RELATIVE_PATH), {
      requireApproved: true,
      verifyEvidence: true,
      requireArchive: options.requireArchive,
      repoRoot,
      policyPath: path.join(repoRoot, POLICY_RELATIVE_PATH),
    });
    process.stdout.write(`${JSON.stringify(validateOciBinding({ indexBytes: await readFile(options.index), platformManifestBytes: await readFile(options.platformManifest), sourceImage: provenance.candidate.sourceImage }))}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Falha ao validar OCI.");
    process.exitCode = 2;
  }
}
