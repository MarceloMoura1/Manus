import { execFile, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  OUTBOUND_AUDIO_FFMPEG_EXECUTABLE,
  OUTBOUND_AUDIO_FFPROBE_EXECUTABLE,
  OUTBOUND_AUDIO_MIME_TYPE,
  normalizeOutboundAudio,
} from "./outbound-audio-normalization";
import { sendOutboundConversationMediaFromPrivateStorage, writeOutboundConversationMedia } from "./conversation-outbound";
import { readConversationMedia, writeConversationMedia } from "./conversation-media-storage";

const execFileAsync = promisify(execFile);
const ffmpeg = OUTBOUND_AUDIO_FFMPEG_EXECUTABLE;
const ffprobe = OUTBOUND_AUDIO_FFPROBE_EXECUTABLE;

function executableAvailable(executable: string): boolean {
  const result = spawnSync(executable, ["-version"], { stdio: "ignore", windowsHide: true });
  return !result.error && result.status === 0;
}

const physicalIt = executableAvailable(ffmpeg) && executableAvailable(ffprobe) ? it : it.skip;

type Probe = {
  streams?: Array<{ codec_name?: string; sample_rate?: string }>;
  format?: { format_name?: string; duration?: string };
  packets?: Array<{ pts_time?: string; duration_time?: string }>;
};

async function probe(file: string): Promise<Probe> {
  const { stdout } = await execFileAsync(ffprobe, [
    "-v", "error",
    "-show_entries", "format=format_name,duration:stream=codec_name,sample_rate:packet=pts_time,duration_time",
    "-of", "json",
    file,
  ], { encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout) as Probe;
}

function packetTimestamps(value: Probe): number[] {
  return (value.packets ?? []).map(packet => Number(packet.pts_time)).filter(Number.isFinite);
}

function maximumPacketGap(timestamps: number[]): number {
  return timestamps.reduce((maximum, timestamp, index) => index === 0
    ? maximum
    : Math.max(maximum, timestamp - timestamps[index - 1]), 0);
}

describe("outbound audio normalization with physical FFmpeg", () => {
  physicalIt("rebuilds a WebM/Opus timeline containing a gap of about 4398 seconds", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "megadesk-malformed-webm-"));
    const inputPath = path.join(root, "mobile-timestamp-gap.webm");
    const outputPath = path.join(root, "normalized.ogg");
    try {
      // The first encoded frame starts at zero; every subsequent frame is
      // shifted by 4,398 seconds, reproducing the observed mobile container
      // shape without retaining any real customer audio.
      await execFileAsync(ffmpeg, [
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=5",
        "-af", "asetpts=if(lt(N\\,960)\\,N/SR/TB\\,(N/SR+4398)/TB)",
        "-c:a", "libopus", "-application", "voip", "-f", "webm", inputPath,
      ], { encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 });

      const malformed = await probe(inputPath);
      const malformedPackets = packetTimestamps(malformed);
      expect(malformed.format?.format_name).toContain("webm");
      expect(malformed.streams?.[0]).toMatchObject({ codec_name: "opus", sample_rate: "48000" });
      expect(Number(malformed.format?.duration)).toBeGreaterThan(4_300);
      expect(Math.abs(malformedPackets[0] ?? Number.POSITIVE_INFINITY)).toBeLessThan(0.1);
      expect(maximumPacketGap(malformedPackets)).toBeGreaterThan(4_300);

      const normalizationCalls: Buffer[] = [];
      const mediaReference = await writeOutboundConversationMedia({
        clientId: "tenant-a",
        bytes: await readFile(inputPath),
        mimeType: "audio/webm",
        fileName: "mobile-timestamp-gap.webm",
        objectId: randomUUID(),
        kind: "audio",
        mediaSource: "recording",
      }, {
        normalizeAudio: async input => {
          normalizationCalls.push(input.bytes);
          return normalizeOutboundAudio(input, { ffmpegPath: ffmpeg, temporaryParent: root });
        },
        write: input => writeConversationMedia({ ...input, root }),
      });
      const canonical = await readConversationMedia({ clientId: "tenant-a", reference: mediaReference, root });
      expect(mediaReference.mimeType).toBe(OUTBOUND_AUDIO_MIME_TYPE);
      expect(mediaReference.fileName).toBe("audio.ogg");
      expect(mediaReference.byteSize).toBe(canonical.bytes.length);
      expect(mediaReference.sha256).toBe(createHash("sha256").update(canonical.bytes).digest("hex"));
      expect(normalizationCalls).toHaveLength(1);
      await writeFile(outputPath, canonical.bytes);

      const output = await probe(outputPath);
      const outputPackets = packetTimestamps(output);
      const outputDuration = Number(output.format?.duration);
      expect(output.format?.format_name).toContain("ogg");
      expect(output.streams?.[0]).toMatchObject({ codec_name: "opus", sample_rate: "48000" });
      expect(Math.abs(outputPackets[0] ?? Number.POSITIVE_INFINITY)).toBeLessThan(0.1);
      expect(outputPackets.every((pts, index) => index === 0 || pts >= outputPackets[index - 1])).toBe(true);
      expect(outputDuration).toBeGreaterThan(4);
      expect(outputDuration).toBeLessThan(6);

      let providerBytes = Buffer.alloc(0);
      await sendOutboundConversationMediaFromPrivateStorage({
        clientId: "tenant-a",
        mediaReference,
        instanceName: "megadesk-tenant-a",
        number: "5541999999999",
        kind: "audio",
        mediaSource: "recording",
        recordingInput: { mimeType: "audio/webm", byteLength: normalizationCalls[0].length },
      }, {
        read: input => readConversationMedia({ ...input, root }),
        captureAudioDiagnostic: async () => null,
        send: async input => {
          providerBytes = Buffer.from(input.dataUrl.split(",")[1], "base64");
          expect(input).toMatchObject({ mimeType: "audio/ogg", fileName: "audio.ogg" });
          return { key: { id: "provider-physical-audio" }, message: {} };
        },
      });
      expect(providerBytes).toEqual(canonical.bytes);
      expect(normalizationCalls).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
