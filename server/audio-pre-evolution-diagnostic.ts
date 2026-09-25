import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const AUDIO_PRE_EVOLUTION_CAPTURE_FLAG = "MEGADESK_AUDIO_PRE_EVOLUTION_CAPTURE";
export const AUDIO_PRE_EVOLUTION_CAPTURE_TENANT = "MEGADESK_AUDIO_PRE_EVOLUTION_CAPTURE_TENANT_ID";
export const AUDIO_PRE_EVOLUTION_CAPTURE_MAX_BYTES = 12_000_000;
export const AUDIO_PRE_EVOLUTION_CAPTURE_DIRECTORY = path.join(os.tmpdir(), "megadesk-audio-diagnostic");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXTENSION = /^[a-z0-9]{2,8}$/;
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

type DiagnosticLogger = Pick<Console, "info" | "warn">;

export type AudioPreEvolutionDiagnostic = {
  correlationId: string;
  byteLength: number;
  mimeType: string;
  sha256: string;
  extension: string;
};

export function isAudioPreEvolutionCaptureEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment[AUDIO_PRE_EVOLUTION_CAPTURE_FLAG] === "1";
}

export function hasPrivatePosixMode(mode: number, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" || (mode & 0o077) === 0;
}

function normalizedMime(value: string): string {
  return value.split(";", 1)[0].trim().toLowerCase();
}

function diagnosticPath(root: string, correlationId: string, extension: string): string {
  if (!UUID.test(correlationId) || !EXTENSION.test(extension)) throw new Error("INVALID_AUDIO_DIAGNOSTIC_IDENTITY");
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, `${correlationId}.${extension}`);
  if (!target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("INVALID_AUDIO_DIAGNOSTIC_PATH");
  return target;
}

async function ensurePrivateRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || !hasPrivatePosixMode(info.mode)) {
    throw new Error("UNSAFE_AUDIO_DIAGNOSTIC_DIRECTORY");
  }
}

export async function capturePreEvolutionAudioDiagnostic(input: {
  bytes: Buffer;
  mimeType: string;
  tenantId: string;
  environment?: NodeJS.ProcessEnv;
  root?: string;
  logger?: DiagnosticLogger;
  createCorrelationId?: () => string;
}): Promise<AudioPreEvolutionDiagnostic | null> {
  const environment = input.environment ?? process.env;
  if (!isAudioPreEvolutionCaptureEnabled(environment)
    || !environment[AUDIO_PRE_EVOLUTION_CAPTURE_TENANT]
    || environment[AUDIO_PRE_EVOLUTION_CAPTURE_TENANT] !== input.tenantId) return null;
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length < 1 || input.bytes.length > AUDIO_PRE_EVOLUTION_CAPTURE_MAX_BYTES) return null;

  const mimeType = normalizedMime(input.mimeType);
  const extension = MIME_EXTENSIONS[mimeType];
  if (!extension) return null;

  const root = path.resolve(input.root ?? AUDIO_PRE_EVOLUTION_CAPTURE_DIRECTORY);
  const logger = input.logger ?? console;
  const correlationId = (input.createCorrelationId ?? randomUUID)();
  let claim: Awaited<ReturnType<typeof open>> | null = null;
  let output: Awaited<ReturnType<typeof open>> | null = null;
  try {
    await ensurePrivateRoot(root);
    try {
      claim = await open(path.join(root, ".capture-claimed"), "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
      throw error;
    }
    await claim.writeFile(correlationId, { encoding: "utf8" });
    await claim.sync();
    await claim.close();
    claim = null;

    const target = diagnosticPath(root, correlationId, extension);
    output = await open(target, "wx", 0o600);
    await output.writeFile(input.bytes);
    await output.sync();
    await output.close();
    output = null;

    const diagnostic = {
      correlationId,
      byteLength: input.bytes.length,
      mimeType,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      extension,
    } satisfies AudioPreEvolutionDiagnostic;
    logger.info("[AudioPreEvolutionDiagnostic] captured", diagnostic);
    return diagnostic;
  } catch {
    logger.warn("[AudioPreEvolutionDiagnostic] capture failed", { correlationId });
    return null;
  } finally {
    await output?.close().catch(() => undefined);
    await claim?.close().catch(() => undefined);
  }
}

export async function cleanupPreEvolutionAudioDiagnostic(input: {
  correlationId: string;
  extension: string;
  root?: string;
}): Promise<void> {
  const root = path.resolve(input.root ?? AUDIO_PRE_EVOLUTION_CAPTURE_DIRECTORY);
  const target = diagnosticPath(root, input.correlationId, input.extension);
  await rm(target, { force: true });
  await rm(path.join(root, ".capture-claimed"), { force: true });
}
