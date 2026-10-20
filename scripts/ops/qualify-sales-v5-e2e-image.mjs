import { access, lstat, readFile, realpath } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { validateProvenance } from "./validate-sales-v5-e2e-image-provenance.mjs";

const execFile = promisify(execFileCallback);
export const EXPECTED = Object.freeze({
  node: "v22.23.2",
  pnpm: "10.18.0",
  playwright: "1.60.0",
  browserPath: "/opt/ms-playwright",
  provenancePath: "/opt/megadesk-e2e-image-provenance.json",
  trustPolicyPath: "/opt/megadesk-e2e-trust-policy.json",
  platform: "linux/arm64",
});

function fail(message) {
  throw new Error(`Qualificacao da imagem E2E falhou: ${message}`);
}

function isStrictDescendant(parent, child) {
  const relative = path.relative(parent, child);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function command(program, args) {
  const { stdout, stderr } = await execFile(program, args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
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

async function loadRuntimeDependencies() {
  const [{ chromium }, sharpModule] = await Promise.all([
    import("@playwright/test"),
    import("sharp"),
  ]);
  return { chromiumApi: chromium, sharpApi: sharpModule.default };
}

async function loadImageProvenance({ imageProvenance, trustPolicy, provenancePath, trustPolicyPath, readFileFn }) {
  if (imageProvenance) return validateProvenance(imageProvenance, { requireApproved: true, trustPolicy });
  let raw;
  let policyRaw;
  try {
    raw = await readFileFn(provenancePath, "utf8");
    policyRaw = await readFileFn(trustPolicyPath, "utf8");
  } catch {
    fail("manifesto de proveniencia ou politica aprovada nao esta presente na imagem");
  }
  try {
    return validateProvenance(JSON.parse(raw), { requireApproved: true, trustPolicy: JSON.parse(policyRaw) });
  } catch (error) {
    fail(error instanceof Error ? error.message : "manifesto de proveniencia invalido na imagem");
  }
}

async function assertBrowserPath({ env, lstatFn, realpathFn, accessFn, sha256FileFn, chromiumApi, chromiumRevision }) {
  if (env.HOME !== "/tmp") fail("HOME deve ser /tmp durante a prova do runner");
  if (env.PLAYWRIGHT_BROWSERS_PATH !== EXPECTED.browserPath) {
    fail("PLAYWRIGHT_BROWSERS_PATH deve apontar para o diretorio imutavel da imagem");
  }
  const rootStats = await lstatFn(EXPECTED.browserPath);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) fail("diretorio de browsers deve ser um diretorio real da imagem");
  const root = await realpathFn(EXPECTED.browserPath);
  const executable = chromiumApi.executablePath();
  if (!executable || !isStrictDescendant(root, executable)) fail("Chromium resolveu fora do diretorio de browsers aprovado");
  await accessFn(executable);
  const executableRealPath = await realpathFn(executable);
  if (!isStrictDescendant(root, executableRealPath)) fail("executavel Chromium resolve fora do diretorio de browsers aprovado");
  if (!executableRealPath.includes(`/chromium-${chromiumRevision}/`)) fail("executavel Chromium nao corresponde a revisao aprovada");
  return { root, executable: executableRealPath, sha256: await sha256FileFn(executableRealPath) };
}

async function assertChromium({ executable, commandFn, chromiumApi, browserVersion }) {
  const ldd = await commandFn("ldd", [executable]);
  if (/not found/i.test(`${ldd.stdout}\n${ldd.stderr}`)) fail("Chromium possui biblioteca Linux ausente");
  const browser = await chromiumApi.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto("data:text/html,<title>megadesk-e2e-arm64</title>");
    if (await page.title() !== "megadesk-e2e-arm64") fail("Chromium nao abriu a pagina de prova");
    const observedVersion = await browser.version();
    if (!observedVersion || observedVersion !== browserVersion) fail(`Chromium divergente: ${observedVersion || "ausente"}`);
    return { ldd: ldd.stdout.split("\n").filter(Boolean).length, version: observedVersion };
  } finally {
    await browser.close();
  }
}

async function assertSharp(sharpApi) {
  const png = await sharpApi({ create: { width: 2, height: 3, channels: 4, background: "#336699" } }).png().toBuffer();
  const metadata = await sharpApi(png).metadata();
  if (metadata.format !== "png" || metadata.width !== 2 || metadata.height !== 3 || png.length === 0) {
    fail("sharp nao concluiu a transformacao ARM64 esperada");
  }
  return { bytes: png.length, width: metadata.width, height: metadata.height };
}

// Dependencies are injectable solely for hermetic unit tests. Direct execution
// loads Playwright and sharp only after platform/version gates pass.
export async function qualifySalesV5E2EImage(overrides = {}) {
  const platform = overrides.platform ?? process.platform;
  const processArch = overrides.processArch ?? process.arch;
  const hostArchitecture = overrides.hostArchitecture ?? os.arch();
  const nodeVersion = overrides.nodeVersion ?? process.version;
  const env = overrides.env ?? process.env;
  const commandFn = overrides.commandFn ?? command;
  const lstatFn = overrides.lstatFn ?? lstat;
  const realpathFn = overrides.realpathFn ?? realpath;
  const accessFn = overrides.accessFn ?? access;
  const sha256FileFn = overrides.sha256FileFn ?? sha256File;
  const readFileFn = overrides.readFileFn ?? readFile;

  if (platform !== "linux" || processArch !== "arm64" || hostArchitecture !== "arm64") {
    fail("o processo deve rodar em Linux ARM64 real");
  }
  if (nodeVersion !== EXPECTED.node) fail(`Node divergente: ${nodeVersion}`);
  const imageProvenance = await loadImageProvenance({
    imageProvenance: overrides.imageProvenance,
    trustPolicy: overrides.trustPolicy,
    provenancePath: overrides.provenancePath ?? EXPECTED.provenancePath,
    trustPolicyPath: overrides.trustPolicyPath ?? EXPECTED.trustPolicyPath,
    readFileFn,
  });

  const pnpm = await commandFn("pnpm", ["--version"]);
  if (pnpm.stdout !== EXPECTED.pnpm) fail(`pnpm divergente: ${pnpm.stdout}`);
  const tsx = await commandFn("pnpm", ["exec", "tsx", "--version"]);
  if (!tsx.stdout) fail("tsx nao esta disponivel para migration e runtime no checkout montado");
  const playwright = await commandFn("pnpm", ["exec", "playwright", "--version"]);
  if (playwright.stdout !== `Version ${EXPECTED.playwright}`) fail(`Playwright divergente: ${playwright.stdout}`);

  const loaded = overrides.chromiumApi && overrides.sharpApi ? undefined : await loadRuntimeDependencies();
  const chromiumApi = overrides.chromiumApi ?? loaded.chromiumApi;
  const sharpApi = overrides.sharpApi ?? loaded.sharpApi;
  const browser = await assertBrowserPath({ env, lstatFn, realpathFn, accessFn, sha256FileFn, chromiumApi, chromiumRevision: imageProvenance.candidate.playwright.chromiumRevision });
  const chromiumProbe = await assertChromium({ executable: browser.executable, commandFn, chromiumApi, browserVersion: imageProvenance.candidate.playwright.browserVersion });
  const sharpProbe = await assertSharp(sharpApi);
  return {
    platform: `${platform}/${processArch}`,
    node: nodeVersion,
    pnpm: pnpm.stdout,
    tsx: tsx.stdout,
    playwright: EXPECTED.playwright,
    chromiumRevision: imageProvenance.candidate.playwright.chromiumRevision,
    browserPath: browser.root,
    chromiumExecutableSha256: browser.sha256,
    chromiumLddEntries: chromiumProbe.ldd,
    chromiumVersion: chromiumProbe.version,
    sharp: sharpProbe,
  };
}

async function main() {
  process.stdout.write(`${JSON.stringify(await qualifySalesV5E2EImage())}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Falha desconhecida na qualificacao da imagem E2E.");
    process.exitCode = 1;
  });
}
