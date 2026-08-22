import { describe, expect, it, vi } from "vitest";
import {
  AudioRecordingController,
  extensionForAudioMime,
  type AudioRecordingCallbacks,
  type AudioRecordingContext,
  type AudioRecordingDependencies,
  type PreparedRecordedAudio,
} from "./audioRecordingController";

class FakeTrack {
  stop = vi.fn();
}

class FakeStream {
  readonly track = new FakeTrack();
  getTracks() { return [this.track]; }
}

class FakeRecorder {
  mimeType = "audio/webm;codecs=opus";
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((event: BlobEvent) => unknown) | null = null;
  onstop: ((event: Event) => unknown) | null = null;
  onerror: ((event: ErrorEvent) => unknown) | null = null;
  start = vi.fn(() => { this.state = "recording"; });
  stop = vi.fn(() => { this.state = "inactive"; });
  emit(blob = new Blob(["audio"], { type: this.mimeType })) {
    this.ondataavailable?.({ data: blob } as BlobEvent);
  }
  finish() { this.onstop?.(new Event("stop")); }
  fail() { this.onerror?.(new Event("error") as ErrorEvent); }
}

class FakeReader {
  result: string | ArrayBuffer | null = null;
  readyState = 0;
  onload: ((event: ProgressEvent<FileReader>) => unknown) | null = null;
  onerror: ((event: ProgressEvent<FileReader>) => unknown) | null = null;
  onabort: ((event: ProgressEvent<FileReader>) => unknown) | null = null;
  readAsDataURL = vi.fn(() => { this.readyState = 1; });
  abort = vi.fn(() => { this.readyState = 2; });
  complete(dataUrl = "data:audio/webm;base64,YXVkaW8=") {
    this.result = dataUrl;
    this.readyState = 2;
    this.onload?.({} as ProgressEvent<FileReader>);
  }
  fail() {
    this.readyState = 2;
    this.onerror?.({} as ProgressEvent<FileReader>);
  }
}

const context: AudioRecordingContext = { tenantId: "tenant-a", conversationId: "conversation-a", userEmail: "agent@example.test" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function createHarness(options?: { media?: Promise<FakeStream>; send?: (audio: PreparedRecordedAudio) => Promise<void>; mimeType?: string }) {
  const stream = new FakeStream();
  const recorder = new FakeRecorder();
  if (options?.mimeType) recorder.mimeType = options.mimeType;
  const reader = new FakeReader();
  const phases: string[] = [];
  const notices: Array<[string, "success" | "error"]> = [];
  const sent: PreparedRecordedAudio[] = [];
  const dependencies: AudioRecordingDependencies = {
    getUserMedia: () => options?.media ?? Promise.resolve(stream),
    createRecorder: () => recorder,
    createReader: () => reader,
    isTypeSupported: type => type === "audio/webm;codecs=opus",
    now: () => 1234,
  };
  const callbacks: AudioRecordingCallbacks = {
    onPhaseChange: phase => phases.push(phase),
    onNotice: (message, type) => notices.push([message, type]),
    onSend: async audio => { sent.push(audio); await options?.send?.(audio); },
  };
  return { controller: new AudioRecordingController(dependencies, callbacks), stream, recorder, reader, phases, notices, sent };
}

async function begin(harness: ReturnType<typeof createHarness>) {
  expect(await harness.controller.start(context)).toBe(true);
  harness.recorder.emit();
}

async function settle() { await Promise.resolve(); await Promise.resolve(); }

describe("AudioRecordingController", () => {
  it("records, sends exactly once and preserves the initial destination", async () => {
    const h = createHarness();
    await begin(h);
    expect(h.controller.decide("send")).toBe(true);
    expect(h.controller.decide("cancel")).toBe(false);
    h.recorder.finish();
    h.reader.complete();
    await settle();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ tenantId: "tenant-a", conversationId: "conversation-a", userEmail: "agent@example.test", fileName: "audio-1234.webm" });
    expect(h.stream.track.stop).toHaveBeenCalled();
    expect(h.controller.getPhase()).toBe("idle");
  });

  it("cancels without reading or sending and makes cancel win against a later send", async () => {
    const h = createHarness();
    await begin(h);
    expect(h.controller.decide("cancel")).toBe(true);
    expect(h.controller.decide("send")).toBe(false);
    h.recorder.finish();
    await settle();
    expect(h.reader.readAsDataURL).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);
    expect(h.stream.track.stop).toHaveBeenCalled();
  });

  it("makes send win against repeated send and cancel clicks", async () => {
    const h = createHarness();
    await begin(h);
    expect(h.controller.decide("send")).toBe(true);
    expect(h.controller.decide("send")).toBe(false);
    expect(h.controller.decide("cancel")).toBe(false);
    expect(h.recorder.stop).toHaveBeenCalledTimes(1);
  });

  it("invalidates recording on conversation change or logout and ignores stale stop callbacks", async () => {
    const h = createHarness();
    await begin(h);
    const staleStop = h.recorder.onstop;
    expect(h.controller.invalidate("conversation changed")).toBe(true);
    staleStop?.(new Event("stop"));
    await settle();
    expect(h.sent).toHaveLength(0);
    expect(h.stream.track.stop).toHaveBeenCalled();
  });

  it("invalidates processing and aborts FileReader before its stale callback can send", async () => {
    const h = createHarness();
    await begin(h);
    h.controller.decide("send");
    h.recorder.finish();
    const staleLoad = h.reader.onload;
    expect(h.controller.invalidate()).toBe(true);
    staleLoad?.({} as ProgressEvent<FileReader>);
    await settle();
    expect(h.reader.abort).toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);
  });

  it("stops a late permission stream after cancellation during getUserMedia", async () => {
    const permission = deferred<FakeStream>();
    const h = createHarness({ media: permission.promise });
    const starting = h.controller.start(context);
    expect(h.controller.invalidate()).toBe(true);
    permission.resolve(h.stream);
    expect(await starting).toBe(false);
    expect(h.stream.track.stop).toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);
  });

  it("fails closed when permission is denied", async () => {
    const h = createHarness({ media: Promise.reject(new Error("denied")) });
    expect(await h.controller.start(context)).toBe(false);
    expect(h.controller.getPhase()).toBe("error");
    expect(h.notices.at(-1)?.[1]).toBe("error");
  });

  it("fails closed on recorder error and releases microphone tracks", async () => {
    const h = createHarness();
    await begin(h);
    h.recorder.fail();
    expect(h.controller.getPhase()).toBe("error");
    expect(h.stream.track.stop).toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);
  });

  it("rejects empty, oversized, and unsupported recordings", async () => {
    for (const [blob, mimeType] of [
      [new Blob([], { type: "audio/webm" }), "audio/webm"],
      [new Blob([new Uint8Array(12_000_001)], { type: "audio/webm" }), "audio/webm"],
      [new Blob(["audio"], { type: "audio/x-custom" }), "audio/x-custom"],
    ] as const) {
      const h = createHarness({ mimeType });
      expect(await h.controller.start(context)).toBe(true);
      h.recorder.emit(blob);
      h.controller.decide("send");
      h.recorder.finish();
      await settle();
      expect(h.controller.getPhase()).toBe("error");
      expect(h.sent).toHaveLength(0);
    }
  });

  it("fails closed on FileReader error", async () => {
    const h = createHarness();
    await begin(h);
    h.controller.decide("send");
    h.recorder.finish();
    h.reader.fail();
    expect(h.controller.getPhase()).toBe("error");
    expect(h.sent).toHaveLength(0);
  });

  it("does not start simultaneous recordings", async () => {
    const h = createHarness();
    await begin(h);
    expect(await h.controller.start({ ...context, conversationId: "conversation-b" })).toBe(false);
    expect(h.recorder.start).toHaveBeenCalledTimes(1);
  });

  it("disposes safely during recording and after an already dispatched upload", async () => {
    const upload = deferred<void>();
    const h = createHarness({ send: () => upload.promise });
    await begin(h);
    h.controller.decide("send");
    h.recorder.finish();
    h.reader.complete();
    expect(h.sent).toHaveLength(1);
    h.controller.dispose();
    upload.resolve();
    await settle();
    expect(h.sent).toHaveLength(1);
    expect(h.controller.getGeneration()).toBeNull();
  });

  it("reports upload failure without retrying or retaining the recording", async () => {
    const h = createHarness({ send: () => Promise.reject(new Error("offline")) });
    await begin(h);
    h.controller.decide("send");
    h.recorder.finish();
    h.reader.complete();
    await settle();
    expect(h.sent).toHaveLength(1);
    expect(h.controller.getPhase()).toBe("error");
    expect(h.controller.getGeneration()).toBeNull();
  });

  it("disposes an active recording without processing any captured blob", async () => {
    const h = createHarness();
    await begin(h);
    h.controller.dispose();
    await settle();
    expect(h.stream.track.stop).toHaveBeenCalled();
    expect(h.reader.readAsDataURL).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);
  });

  it("starts a fresh generation after cancellation without reusing old chunks", async () => {
    const h = createHarness();
    await begin(h);
    h.controller.decide("cancel");
    h.recorder.finish();
    expect(await h.controller.start({ ...context, conversationId: "conversation-b" })).toBe(true);
    h.recorder.emit(new Blob(["new-audio"], { type: "audio/webm" }));
    h.controller.decide("send");
    h.recorder.finish();
    h.reader.complete();
    await settle();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].conversationId).toBe("conversation-b");
    expect(h.sent[0].generation).toBe(2);
  });
});

describe("audio MIME mapping", () => {
  it.each([
    ["audio/webm;codecs=opus", "webm"], ["audio/ogg", "ogg"], ["audio/mp4", "m4a"],
    ["audio/mpeg", "mp3"], ["audio/wav", "wav"], ["audio/x-custom", null],
  ])("maps %s to %s", (mimeType, extension) => expect(extensionForAudioMime(mimeType)).toBe(extension));
});
