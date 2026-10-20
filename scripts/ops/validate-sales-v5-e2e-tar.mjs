import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const BLOCK_SIZE = 512;
const MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
const SAFE_COMPONENT = /^\.?[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ZIP_LOCAL_FILE = 0x04034b50;
const ZIP_CENTRAL_FILE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;
const MAX_ZIP_ENTRIES = 4096;

function fail(message) {
  throw new Error(`Arquivo Chromium invalido: ${message}`);
}

function allZero(bytes) {
  return bytes.every(byte => byte === 0);
}

function ascii(bytes, label) {
  const terminator = bytes.indexOf(0);
  const used = terminator === -1 ? bytes : bytes.subarray(0, terminator);
  const remainder = terminator === -1 ? Buffer.alloc(0) : bytes.subarray(terminator + 1);
  if (!allZero(remainder) || used.some(byte => byte < 0x20 || byte > 0x7e)) fail(`${label} possui bytes nao ASCII seguros`);
  return used.toString("ascii");
}

function octal(bytes, label) {
  const raw = bytes.toString("ascii");
  if (!/^[\0 0-7]*$/.test(raw)) fail(`${label} nao e octal canonico`);
  const value = raw.replace(/[\0 ]/g, "");
  if (!value) return 0;
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(`${label} excede limite seguro`);
  return parsed;
}

function canonicalPath(value, label, allowDirectorySuffix = false) {
  const stripped = allowDirectorySuffix && value.endsWith("/") ? value.slice(0, -1) : value;
  if (!stripped || stripped.startsWith("/") || stripped.includes("\\") || !stripped.split("/").every(part => SAFE_COMPONENT.test(part) && part !== "." && part !== "..")) {
    fail(`${label} nao e caminho relativo seguro`);
  }
  return stripped;
}

function headerChecksum(header) {
  const declared = octal(header.subarray(148, 156), "checksum do header");
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  const calculated = copy.reduce((sum, byte) => sum + byte, 0);
  if (declared !== calculated) fail("checksum do header diverge");
}

function parseHeader(header, offset) {
  headerChecksum(header);
  if (ascii(header.subarray(257, 263), "magic USTAR") !== "ustar") fail("somente headers POSIX USTAR sao permitidos; PAX e GNU long-name sao recusados");
  const name = ascii(header.subarray(0, 100), "nome TAR");
  const prefix = ascii(header.subarray(345, 500), "prefixo TAR");
  const typeFlag = String.fromCharCode(header[156] || 0);
  if (typeFlag !== "\0" && typeFlag !== "0" && typeFlag !== "5") fail(`tipo TAR nao permitido no offset ${offset}`);
  const linkName = ascii(header.subarray(157, 257), "linkname TAR");
  if (linkName) fail("links TAR nao sao permitidos");
  const mode = octal(header.subarray(100, 108), "modo TAR");
  if ((mode & 0o7000) !== 0) fail("modo TAR possui bits especiais");
  const fullName = prefix ? `${prefix}/${name}` : name;
  const directory = typeFlag === "5";
  return { path: canonicalPath(fullName, "nome TAR", directory), directory, size: octal(header.subarray(124, 136), "tamanho TAR") };
}

function paddedSize(size) {
  return Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
}

export function validateTarBytes(compressedBytes) {
  let bytes;
  try {
    bytes = gunzipSync(compressedBytes, { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
  } catch {
    fail("gzip invalido ou maior que o limite estrutural");
  }
  if (bytes.length < BLOCK_SIZE * 2 || bytes.length % BLOCK_SIZE !== 0) fail("TAR deve terminar em blocos de 512 bytes");
  const entries = [];
  const names = new Map();
  let offset = 0;
  let terminated = false;
  while (offset < bytes.length) {
    const header = bytes.subarray(offset, offset + BLOCK_SIZE);
    if (allZero(header)) {
      if (offset + BLOCK_SIZE >= bytes.length || !allZero(bytes.subarray(offset + BLOCK_SIZE, offset + BLOCK_SIZE * 2))) fail("TAR nao possui terminador de dois blocos nulos");
      if (!allZero(bytes.subarray(offset))) fail("TAR contem dados apos o terminador");
      terminated = true;
      break;
    }
    const entry = parseHeader(header, offset);
    if (names.has(entry.path)) fail(`entrada TAR duplicada: ${entry.path}`);
    for (const parent of entry.path.split("/").slice(0, -1).map((_, index, segments) => segments.slice(0, index + 1).join("/"))) {
      if (names.get(parent) === "file") fail(`arquivo TAR colide com diretorio pai: ${entry.path}`);
    }
    names.set(entry.path, entry.directory ? "directory" : "file");
    const next = offset + BLOCK_SIZE + paddedSize(entry.size);
    if (next > bytes.length) fail(`entrada TAR truncada: ${entry.path}`);
    entries.push(entry);
    offset = next;
  }
  if (!terminated || entries.length === 0 || !entries.some(entry => !entry.directory)) fail("TAR deve conter arquivos regulares e terminador valido");
  return Object.freeze(entries.map(entry => Object.freeze(entry)));
}

function zipFail(message) {
  fail(`ZIP ${message}`);
}

function requireZipRange(bytes, offset, size, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > bytes.length) {
    zipFail(`${label} esta truncado`);
  }
}

function zipAsciiPath(bytes, label) {
  const value = bytes.toString("utf8");
  if (!Buffer.from(value, "utf8").equals(bytes)) zipFail(`${label} nao e UTF-8 canonico`);
  return canonicalPath(value, label, value.endsWith("/"));
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zipEndOfCentralDirectory(bytes) {
  const start = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = bytes.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength !== bytes.length) continue;
    const disk = bytes.readUInt16LE(offset + 4);
    const directoryDisk = bytes.readUInt16LE(offset + 6);
    const entriesThisDisk = bytes.readUInt16LE(offset + 8);
    const entries = bytes.readUInt16LE(offset + 10);
    const directorySize = bytes.readUInt32LE(offset + 12);
    const directoryOffset = bytes.readUInt32LE(offset + 16);
    if (disk !== 0 || directoryDisk !== 0 || entriesThisDisk !== entries) zipFail("multi-disco nao e permitido");
    if (entries === ZIP64_SENTINEL_16 || directorySize === ZIP64_SENTINEL_32 || directoryOffset === ZIP64_SENTINEL_32) zipFail("ZIP64 nao e permitido");
    if (entries === 0 || entries > MAX_ZIP_ENTRIES) zipFail("quantidade de entradas fora do limite");
    requireZipRange(bytes, directoryOffset, directorySize, "diretorio central");
    if (directoryOffset + directorySize !== offset) zipFail("diretorio central possui limites inconsistentes");
    return { entries, directoryOffset, directorySize };
  }
  zipFail("nao possui fim de diretorio central valido");
}

function zipUnixType(versionMadeBy, externalAttributes) {
  const system = versionMadeBy >>> 8;
  if (system !== 3) return null;
  return (externalAttributes >>> 16) & 0o170000;
}

function zipEntryData(bytes, entry) {
  requireZipRange(bytes, entry.localOffset, 30, `header local de ${entry.path}`);
  if (bytes.readUInt32LE(entry.localOffset) !== ZIP_LOCAL_FILE) zipFail(`header local invalido: ${entry.path}`);
  const flags = bytes.readUInt16LE(entry.localOffset + 6);
  const method = bytes.readUInt16LE(entry.localOffset + 8);
  const nameLength = bytes.readUInt16LE(entry.localOffset + 26);
  const extraLength = bytes.readUInt16LE(entry.localOffset + 28);
  if (flags !== entry.flags || method !== entry.method) zipFail(`header local diverge: ${entry.path}`);
  requireZipRange(bytes, entry.localOffset + 30, nameLength + extraLength, `nome local de ${entry.path}`);
  const localName = zipAsciiPath(bytes.subarray(entry.localOffset + 30, entry.localOffset + 30 + nameLength), `nome local de ${entry.path}`);
  if (localName !== entry.path) zipFail(`nome local diverge: ${entry.path}`);
  const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
  requireZipRange(bytes, dataOffset, entry.compressedSize, `dados de ${entry.path}`);
  return bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
}

function decodeZipEntry(bytes, entry) {
  if (entry.directory) return Buffer.alloc(0);
  const compressed = zipEntryData(bytes, entry);
  let value;
  try {
    value = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
  } catch {
    zipFail(`dados comprimidos invalidos: ${entry.path}`);
  }
  if (value.length !== entry.uncompressedSize) zipFail(`tamanho descomprimido diverge: ${entry.path}`);
  if (crc32(value) !== entry.crc32) zipFail(`CRC32 diverge: ${entry.path}`);
  return value;
}

// Parses only normal single-disk ZIP archives. The official Playwright ZIP is
// structurally checked before `unzip` is allowed to write any file. ZIP64,
// encrypted entries, data descriptors and non-regular Unix types are rejected
// rather than being handled permissively.
export function validateZipBytes(bytes) {
  const directory = zipEndOfCentralDirectory(bytes);
  const names = new Map();
  const entries = [];
  let offset = directory.directoryOffset;
  const end = directory.directoryOffset + directory.directorySize;
  let uncompressedBytes = 0;
  for (let index = 0; index < directory.entries; index += 1) {
    requireZipRange(bytes, offset, 46, "cabecalho do diretorio central");
    if (bytes.readUInt32LE(offset) !== ZIP_CENTRAL_FILE) zipFail("assinatura do diretorio central invalida");
    const versionMadeBy = bytes.readUInt16LE(offset + 4);
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const crc = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const disk = bytes.readUInt16LE(offset + 34);
    const externalAttributes = bytes.readUInt32LE(offset + 38);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const length = 46 + nameLength + extraLength + commentLength;
    requireZipRange(bytes, offset, length, "entrada do diretorio central");
    if (flags & 0x0001 || flags & 0x0008) zipFail("entradas criptografadas ou com data descriptor nao sao permitidas");
    if (method !== 0 && method !== 8) zipFail(`metodo de compressao nao permitido: ${method}`);
    if (disk !== 0 || compressedSize === ZIP64_SENTINEL_32 || uncompressedSize === ZIP64_SENTINEL_32 || localOffset === ZIP64_SENTINEL_32) zipFail("entrada multi-disco ou ZIP64 nao permitida");
    const extra = bytes.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength);
    for (let extraOffset = 0; extraOffset < extra.length;) {
      if (extraOffset + 4 > extra.length) zipFail("campo extra truncado");
      const header = extra.readUInt16LE(extraOffset);
      const size = extra.readUInt16LE(extraOffset + 2);
      if (extraOffset + 4 + size > extra.length) zipFail("campo extra invalido");
      if (header === 0x0001) zipFail("campo extra ZIP64 nao permitido");
      extraOffset += 4 + size;
    }
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const rawNameText = rawName.toString("utf8");
    const directoryEntry = rawNameText.endsWith("/");
    const entryPath = zipAsciiPath(rawName, "nome ZIP");
    const unixType = zipUnixType(versionMadeBy, externalAttributes);
    if (unixType !== null && unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000) zipFail(`tipo Unix nao permitido: ${entryPath}`);
    if (directoryEntry && unixType === 0o100000) zipFail(`diretorio ZIP declarado como arquivo: ${entryPath}`);
    if (!directoryEntry && unixType === 0o040000) zipFail(`arquivo ZIP declarado como diretorio: ${entryPath}`);
    if (names.has(entryPath)) zipFail(`entrada ZIP duplicada: ${entryPath}`);
    for (const parent of entryPath.split("/").slice(0, -1).map((_, parentIndex, segments) => segments.slice(0, parentIndex + 1).join("/"))) {
      if (names.get(parent) === "file") zipFail(`arquivo ZIP colide com diretorio pai: ${entryPath}`);
    }
    if (directoryEntry && (compressedSize !== 0 || uncompressedSize !== 0)) zipFail(`diretorio ZIP possui dados: ${entryPath}`);
    uncompressedBytes += uncompressedSize;
    if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes > MAX_UNCOMPRESSED_BYTES) zipFail("conteudo descomprimido excede o limite");
    const entry = Object.freeze({ path: entryPath, directory: directoryEntry, flags, method, crc32: crc, compressedSize, uncompressedSize, localOffset });
    names.set(entryPath, directoryEntry ? "directory" : "file");
    entries.push(entry);
    offset += length;
  }
  if (offset !== end || !entries.some(entry => !entry.directory)) zipFail("diretorio central possui tamanho invalido ou nao contem arquivos");
  return Object.freeze(entries);
}

export function extractedManifestFromZip(bytes, { prefix = "" } = {}) {
  if (typeof prefix !== "string" || (prefix && (!SAFE_COMPONENT.test(prefix) || prefix.includes("/") || prefix === "." || prefix === ".."))) fail("prefixo de extracao ZIP invalido");
  const files = [];
  for (const entry of validateZipBytes(bytes)) {
    if (entry.directory) continue;
    const value = decodeZipEntry(bytes, entry);
    const relativePath = prefix ? `${prefix}/${entry.path}` : entry.path;
    files.push(`${createHash("sha256").update(value).digest("hex")} ${value.length} ${relativePath}`);
  }
  return `${files.sort((left, right) => left.localeCompare(right, "en")).join("\n")}\n`;
}

function parseExtractedManifest(text) {
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  if (lines.length === 0 || lines.some(line => !line)) fail("manifesto extraido esta vazio ou possui linhas em branco");
  const entries = new Map();
  let previous = "";
  for (const line of lines) {
    const match = /^([a-f0-9]{64}) ([0-9]+) (.+)$/.exec(line);
    if (!match) fail("manifesto extraido possui formato invalido");
    const [, sha256, sizeText, rawPath] = match;
    const relativePath = canonicalPath(rawPath, "caminho do manifesto");
    const size = Number.parseInt(sizeText, 10);
    if (!Number.isSafeInteger(size) || size < 0 || !SHA256.test(sha256)) fail("manifesto extraido possui tamanho ou hash invalido");
    if (entries.has(relativePath) || (previous && previous >= relativePath)) fail("manifesto extraido deve ter caminhos unicos em ordem lexica");
    entries.set(relativePath, { sha256, size });
    previous = relativePath;
  }
  return entries;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", chunk => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

async function walkFiles(root, relative = "") {
  const current = path.join(root, relative);
  const metadata = await lstat(current);
  if (metadata.isSymbolicLink()) fail(`arvore extraida contem symlink: ${relative || "."}`);
  if (!metadata.isDirectory()) fail(`raiz ou diretorio extraido invalido: ${relative || "."}`);
  const result = [];
  const children = await readdir(current, { withFileTypes: true });
  for (const child of children.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    if (!SAFE_COMPONENT.test(child.name) || child.name === "." || child.name === "..") fail(`arvore extraida possui nome inseguro: ${child.name}`);
    const childRelative = relative ? `${relative}/${child.name}` : child.name;
    const childPath = path.join(root, childRelative);
    const childMetadata = await lstat(childPath);
    if (childMetadata.isSymbolicLink() || (!childMetadata.isDirectory() && !childMetadata.isFile())) fail(`arvore extraida possui tipo nao permitido: ${childRelative}`);
    if (childMetadata.isDirectory()) result.push(...await walkFiles(root, childRelative));
    else result.push({ relativePath: childRelative, size: childMetadata.size, absolutePath: childPath });
  }
  return result;
}

export async function verifyExtractedTree(root, manifestText) {
  const expected = parseExtractedManifest(manifestText);
  const actual = await walkFiles(root);
  if (actual.length !== expected.size) fail("quantidade de arquivos extraidos diverge do manifesto");
  for (const file of actual) {
    const record = expected.get(file.relativePath);
    if (!record) fail(`arquivo extraido sem manifesto: ${file.relativePath}`);
    if (record.size !== file.size) fail(`tamanho extraido divergente: ${file.relativePath}`);
    if (record.sha256 !== await sha256File(file.absolutePath)) fail(`SHA-256 extraido divergente: ${file.relativePath}`);
  }
  return Object.freeze({ files: actual.length });
}

function cliOptions(argv) {
  if (argv.length === 4 && argv[0] === "--archive" && argv[2] === "--format" && (argv[3] === "tar.gz" || argv[3] === "zip")) return { archive: argv[1], format: argv[3] };
  if (argv.length === 6 && argv[0] === "--create-extracted-manifest" && argv[1] === "--archive" && argv[3] === "--output" && typeof argv[5] === "string") return { createManifest: true, archive: argv[2], output: argv[4], prefix: argv[5] };
  if (argv.length === 5 && argv[0] === "--verify-extracted" && argv[1] === "--root" && argv[3] === "--manifest") return { root: argv[2], manifest: argv[4] };
  fail("uso: --archive <arquivo> --format <tar.gz|zip> | --create-extracted-manifest --archive <arquivo.zip> --output <manifesto> <prefixo> | --verify-extracted --root <diretorio> --manifest <arquivo>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = cliOptions(process.argv.slice(2));
    if (options.createManifest) {
      const { writeFile } = await import("node:fs/promises");
      const manifest = extractedManifestFromZip(await readFile(options.archive), { prefix: options.prefix });
      await writeFile(options.output, manifest, "utf8");
      process.stdout.write(`${JSON.stringify({ files: manifest.split("\n").filter(Boolean).length })}\n`);
    } else if (options.archive) {
      const entries = options.format === "zip" ? validateZipBytes(await readFile(options.archive)) : validateTarBytes(await readFile(options.archive));
      process.stdout.write(`${JSON.stringify({ entries: entries.length })}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(await verifyExtractedTree(options.root, await readFile(options.manifest, "utf8")))}\n`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Falha ao validar TAR Chromium.");
    process.exitCode = 2;
  }
}
