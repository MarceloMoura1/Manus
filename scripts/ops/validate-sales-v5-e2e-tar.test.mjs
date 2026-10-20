import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { deflateRawSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { extractedManifestFromZip, parseExtractedManifest, validateTarBytes, validateZipBytes, verifyExtractedTree } from "./validate-sales-v5-e2e-tar.mjs";

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const body = Buffer.from(entry.body ?? "", "utf8");
    const compressed = entry.method === 0 ? body : deflateRawSync(body);
    const flags = entry.flags ?? 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(entry.method ?? 8, 8);
    header.writeUInt32LE(crc32(body), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE((3 << 8) | 20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(flags, 8);
    record.writeUInt16LE(entry.method ?? 8, 10);
    record.writeUInt32LE(crc32(body), 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(body.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

function field(buffer, offset, length, value) {
  Buffer.from(value, "ascii").copy(buffer, offset, 0, Math.min(length, Buffer.byteLength(value)));
}

function octal(buffer, offset, length, value) {
  field(buffer, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}

function header({ name, prefix = "", type = "0", body = Buffer.alloc(0), mode = 0o644 }) {
  const value = Buffer.alloc(512);
  field(value, 0, 100, name);
  octal(value, 100, 8, mode);
  octal(value, 124, 12, body.length);
  value.fill(0x20, 148, 156);
  value[156] = type.charCodeAt(0);
  field(value, 257, 6, "ustar\0");
  field(value, 263, 2, "00");
  field(value, 345, 155, prefix);
  const checksum = value.reduce((sum, byte) => sum + byte, 0);
  field(value, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return value;
}

function archive(entries) {
  const blocks = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? "", "utf8");
    blocks.push(header({ ...entry, body }), body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

describe("Chromium archive structural validation", () => {
  it("accepts only regular files and directories with safe unique USTAR names", () => {
    const entries = validateTarBytes(archive([
      { name: "chromium", type: "5", mode: 0o755 },
      { name: "chrome", prefix: "chromium", body: "browser", mode: 0o755 },
    ]));
    assert.deepEqual(entries.map(entry => entry.path), ["chromium", "chromium/chrome"]);
  });

  it("accepts a safe ZIP and derives a deterministic extracted-file manifest", () => {
    const bytes = zip([
      { name: "chrome-linux/", method: 0, mode: 0o040755 },
      { name: "chrome-linux/chrome", body: "browser", mode: 0o100755 },
    ]);
    assert.deepEqual(validateZipBytes(bytes).map(entry => entry.path), ["chrome-linux", "chrome-linux/chrome"]);
    const digest = createHash("sha256").update("browser").digest("hex");
    assert.equal(extractedManifestFromZip(bytes, { prefix: "chromium-1223" }), `${digest} 7 chromium-1223/chrome-linux/chrome\n`);
  });

  for (const [name, entries] of [
    ["traversal", [{ name: "../chrome", body: "bad" }]],
    ["duplicate", [{ name: "chrome", body: "first" }, { name: "chrome", body: "second" }]],
    ["symbolic link", [{ name: "link", body: "chrome", mode: 0o120777 }]],
    ["encrypted entry", [{ name: "chrome", body: "bad", flags: 1 }]],
  ]) {
    it(`rejects unsafe ZIP ${name} before extraction`, () => {
      assert.throws(() => validateZipBytes(zip(entries)), /ZIP|caminho/);
    });
  }

  for (const [name, entries] of [
    ["duplicate", [{ name: "chrome", body: "first" }, { name: "chrome", body: "second" }]],
    ["traversal", [{ name: "../chrome", body: "bad" }]],
    ["control", [{ name: "chrome\nRUN", body: "bad" }]],
    ["FIFO", [{ name: "pipe", type: "6" }]],
    ["symbolic link", [{ name: "link", type: "2" }]],
    ["hard link", [{ name: "link", type: "1" }]],
    ["PAX header", [{ name: "PaxHeader", type: "x", body: "16 path=chrome\n" }]],
  ]) {
    it(`rejects ${name} entries before extraction`, () => {
      assert.throws(() => validateTarBytes(archive(entries)), /TAR/);
    });
  }

  it("requires the extracted tree to match every path, size, and SHA-256", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "megadesk-e2e-extracted-"));
    try {
      await mkdir(path.join(root, "chromium"));
      const bytes = Buffer.from("browser");
      await writeFile(path.join(root, "chromium", "chrome"), bytes);
      const digest = createHash("sha256").update(bytes).digest("hex");
      await assert.doesNotReject(verifyExtractedTree(root, `${digest} ${bytes.length} chromium/chrome\n`));
      await assert.rejects(verifyExtractedTree(root, `${digest} ${bytes.length + 1} chromium/chrome\n`), /tamanho/);
      await assert.rejects(verifyExtractedTree(root, `${digest} ${bytes.length} chromium/other\n`), /sem manifesto/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts the approved manifest's hash-sorted lines while rejecting duplicates and reordered lines", async () => {
    const text = await readFile(new URL("../../.github/qualification-provenance/evidence/playwright-v1.60.0-chromium-1223-linux-arm64-extracted-files.txt", import.meta.url), "utf8");
    const entries = parseExtractedManifest(text);
    assert.ok(entries.size > 2);
    const lines = text.trimEnd().split("\n");
    assert.throws(() => parseExtractedManifest(`${lines[1]}\n${lines[0]}\n`), /ordem canonica/);
    assert.throws(() => parseExtractedManifest(`${lines[0]}\n${lines[0]}\n`), /caminhos unicos/);
  });
});
