import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_PRE_EVOLUTION_CAPTURE_MAX_BYTES,
  capturePreEvolutionAudioDiagnostic,
  cleanupPreEvolutionAudioDiagnostic,
  hasPrivatePosixMode,
} from "./audio-pre-evolution-diagnostic";

const roots: string[] = [];
const correlationId = "11111111-1111-4111-8111-111111111111";

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "megadesk-audio-diagnostic-test-"));
  await rm(root, { recursive: true, force: true });
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("pre-Evolution audio diagnostic capture", () => {
  it("persists nothing when the explicit flag is off", async () => {
    const root = await temporaryRoot();
    const result = await capturePreEvolutionAudioDiagnostic({
      bytes: Buffer.from("audio"), mimeType: "audio/webm", tenantId: "tenant-a", environment: {}, root,
    });
    expect(result).toBeNull();
    await expect(readdir(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("captures exactly one byte-identical private exemplar with restricted permissions and safe metadata", async () => {
    const root = await temporaryRoot();
    const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const environment = { MEGADESK_AUDIO_PRE_EVOLUTION_CAPTURE: "1", MEGADESK_AUDIO_PRE_EVOLUTION_CAPTURE_TENANT_ID: "tenant-a" };
    const first = await capturePreEvolutionAudioDiagnostic({
      bytes, mimeType: "audio/webm;codecs=opus", tenantId: "tenant-a", environment, root, logger,
      createCorrelationId: () => correlationId,
    });
    const second = await capturePreEvolutionAudioDiagnostic({
      bytes: Buffer.from("second"), mimeType: "audio/webm", tenantId: "tenant-a", environment, root, logger,
      createCorrelationId: () => "22222222-2222-4222-8222-222222222222",
    });

    expect(first).toEqual({
      correlationId,
      byteLength: bytes.length,
      mimeType: "audio/webm",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      extension: "webm",
    });
    expect(second).toBeNull();
    const target = path.join(root, `${correlationId}.webm`);
    await expect(readFile(target)).resolves.toEqual(bytes);
    if (process.platform !== "win32") {
      expect((await stat(root)).mode & 0o077).toBe(0);
      expect((await stat(target)).mode & 0o077).toBe(0);
    }
    expect((await readdir(root)).sort()).toEqual([".capture-claimed", `${correlationId}.webm`]);
    expect(logger.info).toHaveBeenCalledWith("[AudioPreEvolutionDiagnostic] captured", first);
    const serializedLogs = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(serializedLogs).not.toContain(bytes.toString("base64"));
    expect(serializedLogs).not.toMatch(/tenant|phone|number|client|data:audio/i);
  });

  it("enforces the byte limit and supported audio containers", async () => {
    for (const input of [
      { bytes: Buffer.alloc(0), mimeType: "audio/webm" },
      { bytes: Buffer.alloc(AUDIO_PRE_EVOLUTION_CAPTURE_MAX_BYTES + 1), mimeType: "audio/webm" },
      { bytes: Buffer.from("audio"), mimeType: "audio/x-private" },
    ]) {
      const root = await temporaryRoot();
      await expect(capturePreEvolutionAudioDiagnostic({
        ...input, tenantId: "tenant-a", environment: { MEGADESK_AUDIO_PRE_EVOLUTION_CAPTURE: "1", MEGADESK_AUDIO_PRE_EVOLUTION_CAPTURE_TENANT_ID: "tenant-a" }, root,
      })).resolves.toBeNull();
      await expect(readdir(root)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("removes the authorized exemplar and releases the one-shot claim", async () => {
    const root = await temporaryRoot();
    const environment = { MEGADESK_AUDIO_PRE_EVOLUTION_CAPTURE: "1", MEGADESK_AUDIO_PRE_EVOLUTION_CAPTURE_TENANT_ID: "tenant-a" };
    await capturePreEvolutionAudioDiagnostic({
      bytes: Buffer.from("audio"), mimeType: "audio/ogg", tenantId: "tenant-a", environment, root,
      createCorrelationId: () => correlationId,
    });
    await cleanupPreEvolutionAudioDiagnostic({ correlationId, extension: "ogg", root });
    expect(await readdir(root)).toEqual([]);
  });

  it("rejects group/world-readable modes on the Linux production runtime", () => {
    expect(hasPrivatePosixMode(0o100600, "linux")).toBe(true);
    expect(hasPrivatePosixMode(0o100640, "linux")).toBe(false);
    expect(hasPrivatePosixMode(0o040700, "linux")).toBe(true);
    expect(hasPrivatePosixMode(0o040750, "linux")).toBe(false);
  });

  it("captures only the explicitly authorized tenant without persisting the tenant identity", async () => {
    const root = await temporaryRoot();
    const environment = { MEGADESK_AUDIO_PRE_EVOLUTION_CAPTURE: "1", MEGADESK_AUDIO_PRE_EVOLUTION_CAPTURE_TENANT_ID: "tenant-authorized" };
    await expect(capturePreEvolutionAudioDiagnostic({
      bytes: Buffer.from("other tenant audio"), mimeType: "audio/webm", tenantId: "tenant-other",
      environment, root,
    })).resolves.toBeNull();
    await expect(readdir(root)).rejects.toMatchObject({ code: "ENOENT" });

    const logger = { info: vi.fn(), warn: vi.fn() };
    await expect(capturePreEvolutionAudioDiagnostic({
      bytes: Buffer.from("authorized audio"), mimeType: "audio/webm", tenantId: "tenant-authorized",
      environment, root, logger, createCorrelationId: () => correlationId,
    })).resolves.toMatchObject({ correlationId });
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/tenant-authorized|tenant-other/);
    expect((await readdir(root)).join(" ")).not.toMatch(/tenant-authorized|tenant-other/);
  });
});
