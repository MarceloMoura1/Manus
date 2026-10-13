import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assembleRuntime, validateRuntime } from "./assemble-runtime-release.mjs";

const temporaryRoots = [];

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "megadesk-runtime-assembly-"));
  temporaryRoots.push(root);
  const source = path.join(root, "source");
  const runtime = path.join(root, "runtime");
  await mkdir(path.join(source, "dist", "public", "assets"), { recursive: true });
  await mkdir(path.join(runtime, "node_modules", "example"), { recursive: true });
  await writeFile(path.join(source, "dist", "index.js"), "export const release = 'candidate';\n");
  await writeFile(path.join(source, "dist", "public", "index.html"), "<!doctype html><html></html>\n");
  await writeFile(path.join(source, "dist", "public", "assets", "app.js"), "console.log('asset');\n");
  await writeFile(path.join(runtime, "package.json"), `${JSON.stringify({ dependencies: { example: "1.0.0" } })}\n`);
  await writeFile(path.join(runtime, "node_modules", "example", "package.json"), `${JSON.stringify({ name: "example", version: "1.0.0" })}\n`);
  return { root, source, runtime };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("assembleRuntime", () => {
  it("copies the built dist after deploy and removes root environment files", async () => {
    const { source, runtime } = await fixture();
    await writeFile(path.join(runtime, ".env.example"), "not-a-secret\n");
    await writeFile(path.join(runtime, ".env.local"), "also-not-a-secret\n");

    const result = await assembleRuntime({ source, runtime });

    expect(result.dependencyCount).toBe(1);
    expect(result.removedEnvironmentFiles).toEqual([".env.example", ".env.local"]);
    await expect(readFile(path.join(runtime, "dist", "index.js"), "utf8")).resolves.toContain("candidate");
    await expect(validateRuntime(runtime)).resolves.toMatchObject({ dependencyCount: 1 });
  });

  it("fails before producing a runtime when the source build is incomplete", async () => {
    const { source, runtime } = await fixture();
    await rm(path.join(source, "dist", "public", "assets"), { recursive: true, force: true });

    await expect(assembleRuntime({ source, runtime })).rejects.toThrow("Build source dist/public/assets does not exist");
    await expect(readFile(path.join(runtime, "dist", "index.js"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an existing dist instead of overwriting an ambiguous runtime", async () => {
    const { source, runtime } = await fixture();
    await mkdir(path.join(runtime, "dist"));

    await expect(assembleRuntime({ source, runtime })).rejects.toThrow("already contains dist");
  });
});
