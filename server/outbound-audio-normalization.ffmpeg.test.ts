import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  OUTBOUND_AUDIO_FFMPEG_EXECUTABLE,
  OUTBOUND_AUDIO_MIME_TYPE,
  normalizeOutboundAudio,
} from "./outbound-audio-normalization";

const execFileAsync = promisify(execFile);
const ffmpeg = OUTBOUND_AUDIO_FFMPEG_EXECUTABLE;
const ffprobe = process.platform === "linux" ? "/usr/bin/ffprobe" : "ffprobe";

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

describe("outbound audio normalization with physical FFmpeg", () => {
  physicalIt("rebuilds a WebM/Opus timeline whose second packet jumps about 4398 seconds", async () => {
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
      expect(malformedPackets[1]).toBeGreaterThan(4_300);

      const normalized = await normalizeOutboundAudio({
        bytes: await readFile(inputPath),
        mimeType: "audio/webm",
      }, { ffmpegPath: ffmpeg, temporaryParent: root });
      expect(normalized.mimeType).toBe(OUTBOUND_AUDIO_MIME_TYPE);
      expect(normalized.fileName).toBe("audio.ogg");
      await writeFile(outputPath, normalized.bytes);

      const output = await probe(outputPath);
      const outputPackets = packetTimestamps(output);
      const outputDuration = Number(output.format?.duration);
      expect(output.format?.format_name).toContain("ogg");
      expect(output.streams?.[0]).toMatchObject({ codec_name: "opus", sample_rate: "48000" });
      expect(Math.abs(outputPackets[0] ?? Number.POSITIVE_INFINITY)).toBeLessThan(0.1);
      expect(outputPackets.every((pts, index) => index === 0 || pts >= outputPackets[index - 1])).toBe(true);
      expect(outputDuration).toBeGreaterThan(4);
      expect(outputDuration).toBeLessThan(6);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
