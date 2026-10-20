import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const OCI_INDEX = "application/vnd.oci.image.index.v1+json";
const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json";

function fail(message) {
  throw new Error(`Layout OCI final invalido: ${message}`);
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function parse(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${label} nao e JSON valido`);
  }
}

function blobPath(root, value) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("descritor OCI possui digest invalido");
  return path.join(root, "blobs", "sha256", value.slice("sha256:".length));
}

async function regularFile(filePath, label) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch {
    fail(`${label} esta ausente`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`${label} deve ser arquivo regular`);
  return readFile(filePath);
}

export async function recordOciLayout(root) {
  const indexBytes = await regularFile(path.join(root, "index.json"), "index.json");
  const index = parse(indexBytes, "indice OCI");
  if (index.schemaVersion !== 2 || (index.mediaType !== undefined && index.mediaType !== OCI_INDEX) || !Array.isArray(index.manifests)) fail("index.json possui formato invalido");
  const matches = index.manifests.filter(entry => entry?.platform?.os === "linux" && entry?.platform?.architecture === "arm64");
  if (matches.length !== 1) fail("indice OCI final deve conter exatamente um descritor linux/arm64");
  const descriptor = matches[0];
  if (descriptor.mediaType !== OCI_MANIFEST || typeof descriptor.digest !== "string" || !DIGEST.test(descriptor.digest)) fail("descritor ARM64 invalido");
  const manifestBytes = await regularFile(blobPath(root, descriptor.digest), "manifesto ARM64 OCI");
  if (digest(manifestBytes) !== descriptor.digest) fail("digest do manifesto ARM64 diverge");
  const manifest = parse(manifestBytes, "manifesto ARM64 OCI");
  if (manifest.schemaVersion !== 2 || manifest.mediaType !== OCI_MANIFEST || !manifest.config || typeof manifest.config.digest !== "string" || !DIGEST.test(manifest.config.digest)) {
    fail("manifesto ARM64 nao possui config valida");
  }
  const configBytes = await regularFile(blobPath(root, manifest.config.digest), "config ARM64 OCI");
  if (digest(configBytes) !== manifest.config.digest) fail("digest da config ARM64 diverge");
  const config = parse(configBytes, "config ARM64 OCI");
  if (config.os !== "linux" || config.architecture !== "arm64") fail("config OCI final nao e linux/arm64");
  return Object.freeze({
    ociIndexDigest: digest(indexBytes),
    platformManifestDigest: descriptor.digest,
    configDigest: manifest.config.digest,
    platform: "linux/arm64",
  });
}

function options(argv) {
  if (argv.length !== 4 || argv[0] !== "--root" || argv[2] !== "--output") fail("uso: --root <layout-oci> --output <relatorio-novo.json>");
  return { root: argv[1], output: argv[3] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { root, output } = options(process.argv.slice(2));
    const result = await recordOciLayout(root);
    await writeFile(output, `${JSON.stringify(result)}\n`, { encoding: "utf8", flag: "wx" });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Falha ao registrar layout OCI final.");
    process.exitCode = 2;
  }
}
