import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdtemp, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const OUTBOUND_AUDIO_MAX_INPUT_BYTES = 12_000_000;
export const OUTBOUND_AUDIO_MAX_OUTPUT_BYTES = 12_000_000;
export const OUTBOUND_AUDIO_FFMPEG_TIMEOUT_MS = 30_000;
export const OUTBOUND_AUDIO_FFMPEG_STDERR_MAX_BYTES = 64 * 1024;
export const OUTBOUND_AUDIO_MAX_CONCURRENT_NORMALIZATIONS = 2;
export const OUTBOUND_AUDIO_MIME_TYPE = "audio/ogg";
export const OUTBOUND_AUDIO_FILE_NAME = "audio.ogg";
export const OUTBOUND_AUDIO_FFMPEG_EXECUTABLE = process.platform === "linux" ? "/usr/bin/ffmpeg" : "ffmpeg";

type NormalizationFailure =
  | "validation"
  | "capacity"
  | "workspace"
  | "cleanup"
  | "spawn"
  | "timeout"
  | "stderr_limit"
  | "signal"
  | "exit"
  | "output_missing"
  | "output_invalid";

export class OutboundAudioNormalizationError extends Error {
  constructor(public readonly stage: NormalizationFailure) {
    super("OUTBOUND_AUDIO_NORMALIZATION_FAILED");
    this.name = "OutboundAudioNormalizationError";
  }
}

/** Fail-fast in-process guard: no unbounded queue is retained in memory. */
export class OutboundAudioNormalizationLimiter {
  private active = 0;

  constructor(private readonly limit: number = OUTBOUND_AUDIO_MAX_CONCURRENT_NORMALIZATIONS) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("INVALID_AUDIO_NORMALIZATION_LIMIT");
  }

  get activeCount(): number { return this.active; }

  tryAcquire(): () => void {
    if (this.active >= this.limit) throw new OutboundAudioNormalizationError("capacity");
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }
}

const defaultLimiter = new OutboundAudioNormalizationLimiter();

type ProcessFailure = Error & {
  code?: string | number;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
};

export type AudioNormalizerExecFile = (
  file: string,
  args: string[],
  options: {
    encoding: "buffer";
    timeout: number;
    maxBuffer: number;
    windowsHide: true;
    shell: false;
    killSignal: "SIGKILL";
    env?: NodeJS.ProcessEnv;
  },
  callback: (error: ProcessFailure | null) => void,
) => unknown;

const executeFile: AudioNormalizerExecFile = (file, args, options, callback) =>
  execFile(file, args, options, error => callback(error as ProcessFailure | null));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizedMimeType(value: string): string {
  return value.split(";", 1)[0].trim().toLowerCase();
}

function inputExtension(mimeType: string): string {
  return ({
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
  } as Record<string, string>)[mimeType] ?? "audio";
}

export function outboundAudioFfmpegArgs(inputPath: string, outputPath: string): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-fflags", "+genpts+igndts",
    "-i", inputPath,
    "-map", "0:a:0",
    "-vn",
    "-af", "asetpts=N/SR/TB",
    "-c:a", "libopus",
    "-application", "voip",
    "-f", "ogg",
    outputPath,
  ];
}

function processFailureStage(error: ProcessFailure): NormalizationFailure {
  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return "stderr_limit";
  if (error.killed) return "timeout";
  if (error.signal) return "signal";
  if (typeof error.code === "number") return "exit";
  return "spawn";
}

async function writePrivateFile(filePath: string, bytes: Buffer): Promise<void> {
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function executeFfmpeg(input: {
  executable: string;
  args: string[];
  timeoutMs: number;
  execute: AudioNormalizerExecFile;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    try {
      const options = {
        encoding: "buffer",
        timeout: input.timeoutMs,
        maxBuffer: OUTBOUND_AUDIO_FFMPEG_STDERR_MAX_BYTES,
        windowsHide: true,
        shell: false,
        killSignal: "SIGKILL",
        // On the production Linux runtime FFmpeg does not need application
        // credentials. Keep only the fixed system search path in its child env.
        ...(process.platform === "linux" ? { env: { PATH: "/usr/bin:/bin", LANG: "C" } } : {}),
      } as const;
      input.execute(input.executable, input.args, options, error => error
        ? reject(new OutboundAudioNormalizationError(processFailureStage(error)))
        : resolve());
    } catch {
      reject(new OutboundAudioNormalizationError("spawn"));
    }
  });
}

/**
 * Rebuilds a continuous audio timeline from decoded samples. The private source
 * object is not changed, and the temporary workspace contains no tenant or user
 * identity. Any failure aborts the provider send; the original bytes are never
 * used as a fallback.
 */
export async function normalizeOutboundAudio(
  input: { bytes: Buffer; mimeType: string },
  dependencies: {
    execute?: AudioNormalizerExecFile;
    ffmpegPath?: string;
    temporaryParent?: string;
    timeoutMs?: number;
    createId?: () => string;
    limiter?: OutboundAudioNormalizationLimiter;
    removeWorkspace?: (workspace: string) => Promise<void>;
  } = {},
): Promise<{ bytes: Buffer; mimeType: typeof OUTBOUND_AUDIO_MIME_TYPE; fileName: typeof OUTBOUND_AUDIO_FILE_NAME }> {
  const mimeType = normalizedMimeType(input.mimeType);
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length < 1
    || input.bytes.length > OUTBOUND_AUDIO_MAX_INPUT_BYTES
    || !/^audio\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mimeType)) {
    throw new OutboundAudioNormalizationError("validation");
  }

  const parent = path.resolve(dependencies.temporaryParent ?? os.tmpdir());
  let workspace: string | null = null;
  const release = (dependencies.limiter ?? defaultLimiter).tryAcquire();
  try {
    workspace = await mkdtemp(path.join(parent, "megadesk-audio-normalize-"));
    if (path.dirname(workspace) !== parent || !path.basename(workspace).startsWith("megadesk-audio-normalize-")) {
      throw new OutboundAudioNormalizationError("workspace");
    }
    await chmod(workspace, 0o700);
    const workspaceInfo = await lstat(workspace);
    if (!workspaceInfo.isDirectory() || workspaceInfo.isSymbolicLink()
      || (process.platform !== "win32" && (workspaceInfo.mode & 0o077) !== 0)) {
      throw new OutboundAudioNormalizationError("workspace");
    }

    const createId = dependencies.createId ?? randomUUID;
    const inputId = createId();
    const outputId = createId();
    if (!UUID.test(inputId) || !UUID.test(outputId) || inputId === outputId) {
      throw new OutboundAudioNormalizationError("workspace");
    }
    const inputPath = path.join(workspace, `${inputId}.${inputExtension(mimeType)}`);
    const outputPath = path.join(workspace, `${outputId}.ogg`);
    await writePrivateFile(inputPath, input.bytes);
    await writePrivateFile(outputPath, Buffer.alloc(0));

    await executeFfmpeg({
      executable: dependencies.ffmpegPath ?? OUTBOUND_AUDIO_FFMPEG_EXECUTABLE,
      args: outboundAudioFfmpegArgs(inputPath, outputPath),
      timeoutMs: dependencies.timeoutMs ?? OUTBOUND_AUDIO_FFMPEG_TIMEOUT_MS,
      execute: dependencies.execute ?? executeFile,
    });

    let outputInfo;
    try {
      outputInfo = await lstat(outputPath);
    } catch {
      throw new OutboundAudioNormalizationError("output_missing");
    }
    if (!outputInfo.isFile() || outputInfo.isSymbolicLink()
      || outputInfo.size < 1 || outputInfo.size > OUTBOUND_AUDIO_MAX_OUTPUT_BYTES) {
      throw new OutboundAudioNormalizationError("output_invalid");
    }
    await chmod(outputPath, 0o600);
    const output = await readFile(outputPath);
    if (output.length !== outputInfo.size) throw new OutboundAudioNormalizationError("output_invalid");
    return { bytes: output, mimeType: OUTBOUND_AUDIO_MIME_TYPE, fileName: OUTBOUND_AUDIO_FILE_NAME };
  } catch (error) {
    if (error instanceof OutboundAudioNormalizationError) throw error;
    throw new OutboundAudioNormalizationError(workspace ? "output_invalid" : "workspace");
  } finally {
    let cleanupError: OutboundAudioNormalizationError | null = null;
    if (workspace) {
      try {
        if (dependencies.removeWorkspace) await dependencies.removeWorkspace(workspace);
        else await rm(workspace, { recursive: true, force: true });
      } catch {
        cleanupError = new OutboundAudioNormalizationError("cleanup");
      }
    }
    release();
    if (cleanupError) throw cleanupError;
  }
}
