import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OUTBOUND_AUDIO_FFMPEG_STDERR_MAX_BYTES,
  OUTBOUND_AUDIO_MAX_CONCURRENT_NORMALIZATIONS,
  OUTBOUND_AUDIO_MAX_INPUT_BYTES,
  OUTBOUND_AUDIO_MAX_OUTPUT_BYTES,
  OutboundAudioNormalizationError,
  OutboundAudioNormalizationLimiter,
  normalizeOutboundAudio,
  outboundAudioFfmpegArgs,
  type AudioNormalizerExecFile,
} from "./outbound-audio-normalization";

const parents: string[] = [];

async function temporaryParent(): Promise<string> {
  const parent = await mkdtemp(path.join(os.tmpdir(), "megadesk-audio-normalization-test-"));
  parents.push(parent);
  return parent;
}

afterEach(async () => {
  await Promise.all(parents.splice(0).map(parent => rm(parent, { recursive: true, force: true })));
});

function successfulExec(output = Buffer.from("OggS-normalized"), inspect?: (file: string, args: string[], options: any) => void): AudioNormalizerExecFile {
  return (file, args, options, callback) => {
    inspect?.(file, args, options);
    void writeFile(args.at(-1)!, output).then(() => callback(null), callback);
  };
}

function failingExec(error: Error & { code?: string | number; killed?: boolean; signal?: NodeJS.Signals | null }): AudioNormalizerExecFile {
  return (_file, _args, _options, callback) => queueMicrotask(() => callback(error));
}

describe("outbound audio normalization", () => {
  it("executes the exact safe FFmpeg timeline-rebuild strategy and returns OGG/Opus metadata", async () => {
    const parent = await temporaryParent();
    const inspect = vi.fn((file: string, args: string[], options: any) => {
      expect(file).toBe("/usr/bin/ffmpeg");
      expect(args).toEqual(outboundAudioFfmpegArgs(args[6], args.at(-1)!));
      expect(args).toEqual([
        "-hide_banner", "-nostdin", "-y", "-fflags", "+genpts+igndts", "-i", args[6],
        "-map", "0:a:0", "-vn", "-af", "asetpts=N/SR/TB", "-c:a", "libopus",
        "-application", "voip", "-f", "ogg", args.at(-1),
      ]);
      expect(options).toMatchObject({ encoding: "buffer", timeout: 30_000,
        maxBuffer: OUTBOUND_AUDIO_FFMPEG_STDERR_MAX_BYTES, windowsHide: true, shell: false, killSignal: "SIGKILL" });
      if (process.platform === "linux") expect(options.env).toEqual({ PATH: "/usr/bin:/bin", LANG: "C" });
    });
    const result = await normalizeOutboundAudio({ bytes: Buffer.from("synthetic-webm"), mimeType: "audio/webm;codecs=opus" }, {
      execute: successfulExec(Buffer.from("OggS-output"), inspect), ffmpegPath: "/usr/bin/ffmpeg", temporaryParent: parent,
      createId: () => randomUUID(),
    });
    expect(result).toEqual({ bytes: Buffer.from("OggS-output"), mimeType: "audio/ogg", fileName: "audio.ogg" });
    expect(inspect).toHaveBeenCalledOnce();
  });

  it("keeps private random workspaces and mode 0600 files while FFmpeg runs", async () => {
    const parent = await temporaryParent();
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    await normalizeOutboundAudio({ bytes: Buffer.from("webm"), mimeType: "audio/webm" }, {
      temporaryParent: parent, createId: () => ids.shift()!, execute: (file, args, options, callback) => {
        void (async () => {
          const workspace = path.dirname(args[6]);
          if (process.platform !== "win32") {
            expect((await stat(workspace)).mode & 0o077).toBe(0);
            expect((await stat(args[6])).mode & 0o077).toBe(0);
            expect((await stat(args.at(-1)!)).mode & 0o077).toBe(0);
          }
          expect(workspace).not.toMatch(/tenant|phone|client/i);
          await writeFile(args.at(-1)!, "OggS");
          callback(null);
        })().catch(callback);
      },
    });
    expect(await readdir(parent)).toEqual([]);
  });

  it("cleans its workspace after a process failure", async () => {
    const parent = await temporaryParent();
    await expect(normalizeOutboundAudio({ bytes: Buffer.from("webm"), mimeType: "audio/webm" }, {
      temporaryParent: parent, execute: failingExec(Object.assign(new Error("private stderr"), { code: 1 })),
    })).rejects.toMatchObject({ stage: "exit", message: "OUTBOUND_AUDIO_NORMALIZATION_FAILED" });
    expect(await readdir(parent)).toEqual([]);
  });

  it.each([
    ["timeout", Object.assign(new Error("timeout"), { killed: true, signal: "SIGKILL" as NodeJS.Signals })],
    ["stderr_limit", Object.assign(new Error("stderr limit"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" })],
    ["signal", Object.assign(new Error("signal"), { signal: "SIGTERM" as NodeJS.Signals })],
    ["spawn", Object.assign(new Error("missing binary"), { code: "ENOENT" })],
  ])("classifies %s without exposing process details", async (stage, error) => {
    const parent = await temporaryParent();
    await expect(normalizeOutboundAudio({ bytes: Buffer.from("audio"), mimeType: "audio/mp4" }, {
      temporaryParent: parent, timeoutMs: 5, execute: failingExec(error),
    })).rejects.toEqual(expect.objectContaining({ stage, message: "OUTBOUND_AUDIO_NORMALIZATION_FAILED" }));
  });

  it("rejects a non-zero exit code", async () => {
    const parent = await temporaryParent();
    await expect(normalizeOutboundAudio({ bytes: Buffer.from("audio"), mimeType: "audio/ogg" }, {
      temporaryParent: parent, execute: failingExec(Object.assign(new Error("ffmpeg failed"), { code: 7 })),
    })).rejects.toBeInstanceOf(OutboundAudioNormalizationError);
  });

  it.each([
    ["missing", async (output: string) => unlink(output)],
    ["empty", async (output: string) => writeFile(output, Buffer.alloc(0))],
    ["oversize", async (output: string) => writeFile(output, Buffer.alloc(OUTBOUND_AUDIO_MAX_OUTPUT_BYTES + 1))],
  ])("rejects %s output and cleans up", async (_case, produce) => {
    const parent = await temporaryParent();
    const execute: AudioNormalizerExecFile = (_file, args, _options, callback) => {
      void produce(args.at(-1)!).then(() => callback(null), callback);
    };
    await expect(normalizeOutboundAudio({ bytes: Buffer.from("audio"), mimeType: "audio/webm" }, {
      temporaryParent: parent, execute,
    })).rejects.toBeInstanceOf(OutboundAudioNormalizationError);
    expect(await readdir(parent)).toEqual([]);
  });

  it("enforces the current 12 MB audio input limit before spawning", async () => {
    const execute = vi.fn();
    await expect(normalizeOutboundAudio({ bytes: Buffer.alloc(OUTBOUND_AUDIO_MAX_INPUT_BYTES + 1), mimeType: "audio/webm" }, { execute }))
      .rejects.toMatchObject({ stage: "validation" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("isolates concurrent calls in distinct private workspaces", async () => {
    const parent = await temporaryParent();
    const workspaces = new Set<string>();
    const execute: AudioNormalizerExecFile = (_file, args, _options, callback) => {
      workspaces.add(path.dirname(args[6]));
      void writeFile(args.at(-1)!, `OggS-${workspaces.size}`).then(() => callback(null), callback);
    };
    const results = await Promise.all([
      normalizeOutboundAudio({ bytes: Buffer.from("one"), mimeType: "audio/webm" }, { temporaryParent: parent, execute }),
      normalizeOutboundAudio({ bytes: Buffer.from("two"), mimeType: "audio/mp4" }, { temporaryParent: parent, execute }),
    ]);
    expect(workspaces.size).toBe(2);
    expect(results.every(result => result.mimeType === "audio/ogg" && result.fileName === "audio.ogg")).toBe(true);
    expect(await readdir(parent)).toEqual([]);
  });

  it("fails closed above the bounded concurrency limit and recovers after completion", async () => {
    const parent = await temporaryParent();
    const limiter = new OutboundAudioNormalizationLimiter(1);
    let firstCallback: ((error: Error | null) => void) | undefined;
    let firstOutput = "";
    let resolveFirstStarted: () => void = () => undefined;
    const firstStarted = new Promise<void>(resolve => { resolveFirstStarted = resolve; });
    const execute: AudioNormalizerExecFile = (_file, args, _options, callback) => {
      firstOutput = args.at(-1)!;
      firstCallback = callback;
      resolveFirstStarted();
    };
    const first = normalizeOutboundAudio({ bytes: Buffer.from("first"), mimeType: "audio/webm" }, { temporaryParent: parent, limiter, execute });
    await firstStarted;
    await expect(normalizeOutboundAudio({ bytes: Buffer.from("second"), mimeType: "audio/webm" }, {
      temporaryParent: parent, limiter, execute: successfulExec(),
    })).rejects.toMatchObject({ stage: "capacity" });
    await writeFile(firstOutput, "OggS-first");
    firstCallback!(null);
    await first;
    expect(limiter.activeCount).toBe(0);
    await expect(normalizeOutboundAudio({ bytes: Buffer.from("third"), mimeType: "audio/webm" }, {
      temporaryParent: parent, limiter, execute: successfulExec(),
    })).resolves.toMatchObject({ mimeType: "audio/ogg" });
  });

  it("releases capacity after failure and after a cleanup failure", async () => {
    const parent = await temporaryParent();
    const limiter = new OutboundAudioNormalizationLimiter(1);
    await expect(normalizeOutboundAudio({ bytes: Buffer.from("bad"), mimeType: "audio/webm" }, {
      temporaryParent: parent, limiter, execute: failingExec(Object.assign(new Error("exit"), { code: 1 })),
    })).rejects.toMatchObject({ stage: "exit" });
    expect(limiter.activeCount).toBe(0);
    await expect(normalizeOutboundAudio({ bytes: Buffer.from("cleanup"), mimeType: "audio/webm" }, {
      temporaryParent: parent, limiter, execute: successfulExec(),
      removeWorkspace: async () => { throw new Error("cleanup unavailable"); },
    })).rejects.toMatchObject({ stage: "cleanup", message: "OUTBOUND_AUDIO_NORMALIZATION_FAILED" });
    expect(limiter.activeCount).toBe(0);
    await expect(normalizeOutboundAudio({ bytes: Buffer.from("retry"), mimeType: "audio/webm" }, {
      temporaryParent: parent, limiter, execute: successfulExec(),
    })).resolves.toMatchObject({ mimeType: "audio/ogg" });
  });

  it("exports the conservative default concurrency limit", () => {
    expect(OUTBOUND_AUDIO_MAX_CONCURRENT_NORMALIZATIONS).toBe(2);
  });
});
