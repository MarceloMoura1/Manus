import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDisposablePortAvailable,
  assertDisposableRuntimeConfig,
  assertNoProjectEnvironmentFiles,
  createSanitizedDisposableEnvironment,
} from "../server/_core/disposable-runtime.ts";

const require = createRequire(import.meta.url);
const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");

function resolveTsxCli() {
  try {
    return require.resolve("tsx/cli");
  } catch {
    throw new Error("O launcher descartável exige a dependência local tsx.");
  }
}

export function safeFailureMessage() {
  return "Preflight do runtime descartável falhou; nenhuma URL ou segredo foi registrado.";
}

export function prepareLauncherEnvironment(environment) {
  if (!environment.MEGADESK_TEST_RUNTIME_PORT) {
    throw new Error("A porta explícita do runtime descartável é obrigatória.");
  }
  if (environment.DATABASE_URL && environment.DATABASE_URL !== environment.TEST_DATABASE_URL) {
    throw new Error("DATABASE_URL preexistente diverge do alvo descartável.");
  }
  if (environment.MAIN_DATABASE_URL) {
    throw new Error("MAIN_DATABASE_URL não é aceita pelo launcher descartável.");
  }

  let canonicalMediaRoot;
  try {
    canonicalMediaRoot = realpathSync(environment.MEGADESK_DISPOSABLE_MEDIA_ROOT ?? "");
  } catch {
    throw new Error("A raiz de mídia descartável não pode ser resolvida.");
  }
  const { JWT_SECRET: _inheritedJwtSecret, ...withoutInheritedJwtSecret } = environment;
  return {
    ...withoutInheritedJwtSecret,
    DATABASE_URL: environment.TEST_DATABASE_URL,
    HOST: "127.0.0.1",
    MEGADESK_DISPOSABLE_MEDIA_ROOT: canonicalMediaRoot,
    MEGADESK_MEDIA_ROOT: canonicalMediaRoot,
    NODE_ENV: "development",
    PORT: environment.MEGADESK_TEST_RUNTIME_PORT,
  };
}

export async function runDisposableTestRuntime({
  environment = process.env,
  exists = existsSync,
  spawnProcess = spawn,
  portProbe,
  makeSecret = () => randomBytes(48).toString("base64url"),
} = {}) {
  assertNoProjectEnvironmentFiles(projectRoot, exists);
  const ephemeralJwtSecret = makeSecret();
  const launcherEnvironment = {
    ...prepareLauncherEnvironment(environment),
    JWT_SECRET: ephemeralJwtSecret,
  };
  const config = assertDisposableRuntimeConfig(launcherEnvironment);
  await assertDisposablePortAvailable(config, portProbe);

  const childEnvironment = createSanitizedDisposableEnvironment(
    launcherEnvironment,
    config,
    ephemeralJwtSecret,
    projectRoot,
  );
  const child = spawnProcess(
    process.execPath,
    [resolveTsxCli(), "watch", "server/_core/index.ts"],
    { cwd: projectRoot, env: childEnvironment, stdio: "inherit", windowsHide: true },
  );

  let stopped = false;
  const stopChild = signal => {
    if (stopped || child.killed) return;
    stopped = true;
    child.kill(signal);
  };
  const onSigint = () => stopChild("SIGINT");
  const onSigterm = () => stopChild("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    stopChild("SIGTERM");
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
if (invokedDirectly) {
  runDisposableTestRuntime().then(
    result => { process.exitCode = result.code ?? (result.signal ? 1 : 0); },
    () => {
      console.error(`[disposable-test] ${safeFailureMessage()}`);
      process.exitCode = 1;
    },
  );
}
