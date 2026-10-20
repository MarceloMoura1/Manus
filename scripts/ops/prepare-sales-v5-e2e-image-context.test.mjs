import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { verifyQualificationContext } from "./prepare-sales-v5-e2e-image-context.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "megadesk-e2e-context-"));
  const dockerfile = Buffer.from("FROM example.invalid@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n");
  const packageJson = Buffer.from('{"private":true}\n');
  await writeFile(path.join(directory, "Dockerfile.e2e-arm64"), dockerfile);
  await writeFile(path.join(directory, "package.json"), packageJson);
  const files = [
    { path: "Dockerfile.e2e-arm64", sizeBytes: dockerfile.length, sha256: hash(dockerfile) },
    { path: "package.json", sizeBytes: packageJson.length, sha256: hash(packageJson) },
  ];
  await writeFile(path.join(directory, "qualification-context.json"), `${JSON.stringify({ schemaVersion: 1, files, dockerfileSha256: hash(dockerfile) })}\n`);
  return directory;
}

describe("frozen Sales V5 E2E Docker context", () => {
  it("accepts an unchanged context and rejects a changed or added build input", async () => {
    const directory = await fixture();
    try {
      assert.deepEqual(await verifyQualificationContext(directory), { files: 2, dockerfileSha256: hash(Buffer.from("FROM example.invalid@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n")) });
      await writeFile(path.join(directory, "package.json"), '{"private":false}\n');
      await assert.rejects(verifyQualificationContext(directory), /arquivos do contexto foram alterados/);
      await writeFile(path.join(directory, "package.json"), '{"private":true}\n');
      await writeFile(path.join(directory, "unexpected-input"), "mutated");
      await assert.rejects(verifyQualificationContext(directory), /arquivos do contexto foram alterados/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a Dockerfile whose bytes differ from its separately recorded hash", async () => {
    const directory = await fixture();
    try {
      const replacement = Buffer.from("FROM scratch\n");
      await writeFile(path.join(directory, "Dockerfile.e2e-arm64"), replacement);
      const packageJson = Buffer.from('{"private":true}\n');
      const files = [
        { path: "Dockerfile.e2e-arm64", sizeBytes: replacement.length, sha256: hash(replacement) },
        { path: "package.json", sizeBytes: packageJson.length, sha256: hash(packageJson) },
      ];
      await writeFile(path.join(directory, "qualification-context.json"), `${JSON.stringify({ schemaVersion: 1, files, dockerfileSha256: "b".repeat(64) })}\n`);
      await assert.rejects(verifyQualificationContext(directory), /Dockerfile gerado foi alterado/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
