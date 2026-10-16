import net from "node:net";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateTestDatabaseUrl } from "../test-integration-gates";

const DISPOSABLE_DATABASE_NAME = /^megadesk_test_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const LOCAL_LISTEN_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const PLATFORM_ENVIRONMENT_KEYS = [
  "APPDATA", "COMSPEC", "HOMEDRIVE", "HOMEPATH", "HOME", "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS", "OS", "Path", "PATH", "PATHEXT", "SystemRoot",
  "TEMP", "TMP", "USERPROFILE", "WINDIR",
] as const;

export type DisposableRuntimeConfig = Readonly<{
  databaseUrl: string;
  host: string;
  mediaRoot: string;
  port: number;
}>;

export type PortProbe = (host: string, port: number) => Promise<boolean>;

function configurationError(message: string): Error {
  return new Error(`Configuração do runtime descartável inválida: ${message}`);
}

function isStrictDescendant(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function parseDatabaseName(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  return decodeURIComponent(parsed.pathname.slice(1));
}

function parseListenPort(value: string | undefined): number {
  if (!value || !/^[0-9]+$/.test(value)) {
    throw configurationError("PORT deve ser uma porta numérica explícita.");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw configurationError("PORT deve estar entre 1024 e 65535.");
  }
  return port;
}

function assertSafeEmptyMediaRoot(value: string | undefined): string {
  if (!value) throw configurationError("MEGADESK_DISPOSABLE_MEDIA_ROOT é obrigatória.");

  let rootInfo: ReturnType<typeof lstatSync>;
  let canonicalRoot: string;
  let canonicalTemporaryRoot: string;
  try {
    const resolvedRoot = path.resolve(value);
    rootInfo = lstatSync(resolvedRoot);
    canonicalRoot = realpathSync(resolvedRoot);
    canonicalTemporaryRoot = realpathSync(path.resolve(os.tmpdir()));
  } catch {
    throw configurationError("a raiz de mídia deve existir antes da inicialização.");
  }

  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw configurationError("a raiz de mídia deve ser um diretório real, nunca um link simbólico.");
  }
  if (!isStrictDescendant(canonicalTemporaryRoot, canonicalRoot)) {
    throw configurationError("a raiz de mídia deve ficar dentro do diretório temporário aprovado.");
  }
  try {
    if (readdirSync(canonicalRoot).length !== 0) {
      throw configurationError("a raiz de mídia deve iniciar vazia e exclusiva.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Configuração do runtime descartável")) throw error;
    throw configurationError("não foi possível inspecionar a raiz de mídia.");
  }
  return canonicalRoot;
}

/** True only when the operator explicitly opted into the disposable runtime. */
export function isDisposableRuntimeEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.MEGADESK_DISPOSABLE_RUNTIME === "1";
}

/** Validates every invariant before the HTTP server is constructed; no database is opened. */
export function assertDisposableRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): DisposableRuntimeConfig {
  if (!isDisposableRuntimeEnabled(environment)) {
    throw configurationError("MEGADESK_DISPOSABLE_RUNTIME deve ser exatamente 1.");
  }
  if (environment.NODE_ENV !== "development") {
    throw configurationError("NODE_ENV deve ser development.");
  }
  if (environment.RUN_DATABASE_INTEGRATION !== "1") {
    throw configurationError("RUN_DATABASE_INTEGRATION deve ser exatamente 1.");
  }

  const databaseUrl = validateTestDatabaseUrl(environment.TEST_DATABASE_URL);
  if (!DISPOSABLE_DATABASE_NAME.test(parseDatabaseName(databaseUrl))) {
    throw configurationError("o banco deve seguir estritamente o formato megadesk_test_<identificador> em minúsculas.");
  }
  if (environment.DATABASE_URL !== databaseUrl) {
    throw configurationError("DATABASE_URL deve ser idêntica a TEST_DATABASE_URL.");
  }
  if (environment.MAIN_DATABASE_URL) {
    throw configurationError("MAIN_DATABASE_URL não é permitida no runtime descartável.");
  }

  const host = environment.HOST?.trim();
  if (!host || !LOCAL_LISTEN_HOSTS.has(host)) {
    throw configurationError("HOST deve ser localhost, 127.0.0.1 ou ::1.");
  }

  const jwtSecret = environment.JWT_SECRET?.trim();
  if (!jwtSecret || jwtSecret.length < 32) {
    throw configurationError("JWT_SECRET efêmero é obrigatório e deve ter ao menos 32 caracteres.");
  }

  const mediaRoot = assertSafeEmptyMediaRoot(environment.MEGADESK_DISPOSABLE_MEDIA_ROOT);
  if (environment.MEGADESK_MEDIA_ROOT !== mediaRoot) {
    throw configurationError("MEGADESK_MEDIA_ROOT deve ser idêntica à raiz descartável validada.");
  }

  return Object.freeze({
    databaseUrl,
    host,
    mediaRoot,
    port: parseListenPort(environment.PORT),
  });
}

export function shouldStartTicketAttachmentReconciler(environment: NodeJS.ProcessEnv = process.env): boolean {
  return !isDisposableRuntimeEnabled(environment);
}

export function assertNoProjectEnvironmentFiles(
  projectRoot: string,
  exists: (candidate: string) => boolean,
): void {
  for (const fileName of [".env", ".env.local", ".env.development", ".env.development.local"]) {
    if (exists(path.join(projectRoot, fileName))) {
      throw configurationError("arquivos .env locais não são permitidos no runtime descartável.");
    }
  }
}

export function createSanitizedDisposableEnvironment(
  parent: NodeJS.ProcessEnv,
  config: DisposableRuntimeConfig,
  jwtSecret: string,
  projectRoot: string,
): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {};
  for (const key of PLATFORM_ENVIRONMENT_KEYS) {
    const value = parent[key];
    if (value !== undefined) child[key] = value;
  }

  child.DATABASE_URL = config.databaseUrl;
  child.DOTENV_CONFIG_PATH = path.join(projectRoot, ".disposable-runtime-no-dotenv");
  child.HOST = config.host;
  child.JWT_SECRET = jwtSecret;
  child.MEGADESK_DISPOSABLE_MEDIA_ROOT = config.mediaRoot;
  child.MEGADESK_DISPOSABLE_RUNTIME = "1";
  child.MEGADESK_MEDIA_ROOT = config.mediaRoot;
  child.NODE_ENV = "development";
  child.PORT = String(config.port);
  child.RUN_DATABASE_INTEGRATION = "1";
  child.TEST_DATABASE_URL = config.databaseUrl;
  return child;
}

async function bindabilityProbe(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => server.close(error => resolve(!error)));
  });
}

/** Checks bindability without constructing the MegaDesk application. */
export async function assertDisposablePortAvailable(
  config: Pick<DisposableRuntimeConfig, "host" | "port">,
  probe: PortProbe = bindabilityProbe,
): Promise<void> {
  if (!await probe(config.host, config.port)) {
    throw configurationError("a porta local explícita não está disponível.");
  }
}
