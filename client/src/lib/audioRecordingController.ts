export type AudioRecordingPhase =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "stopping"
  | "processing"
  | "sending"
  | "cancelled"
  | "error";

export type AudioRecordingContext = {
  tenantId: string;
  conversationId: string;
  userEmail: string;
};

export type PreparedRecordedAudio = AudioRecordingContext & {
  generation: number;
  startedAt: number;
  dataUrl: string;
  mimeType: string;
  fileName: string;
};

type AudioDecision = "send" | "cancel";
type TrackLike = { stop(): void };
type StreamLike = { getTracks(): TrackLike[] };
type RecorderLike = {
  mimeType: string;
  state: "inactive" | "recording" | "paused";
  ondataavailable: ((event: BlobEvent) => unknown) | null;
  onstop: ((event: Event) => unknown) | null;
  onerror: ((event: ErrorEvent) => unknown) | null;
  start(timeslice?: number): void;
  stop(): void;
};
type ReaderLike = {
  result: string | ArrayBuffer | null;
  readyState: number;
  onload: ((event: ProgressEvent<FileReader>) => unknown) | null;
  onerror: ((event: ProgressEvent<FileReader>) => unknown) | null;
  onabort: ((event: ProgressEvent<FileReader>) => unknown) | null;
  readAsDataURL(blob: Blob): void;
  abort(): void;
};

type RecordingSession = AudioRecordingContext & {
  generation: number;
  startedAt: number;
  decision: AudioDecision | null;
  invalidated: boolean;
  stopRequested: boolean;
  chunks: Blob[];
  stream?: StreamLike;
  recorder?: RecorderLike;
  reader?: ReaderLike;
};

export type AudioRecordingDependencies = {
  getUserMedia: () => Promise<StreamLike>;
  createRecorder: (stream: StreamLike, mimeType?: string) => RecorderLike;
  createReader: () => ReaderLike;
  isTypeSupported: (mimeType: string) => boolean;
  now?: () => number;
};

export type AudioRecordingCallbacks = {
  onPhaseChange: (phase: AudioRecordingPhase) => void;
  onSend: (audio: PreparedRecordedAudio) => Promise<void>;
  onNotice: (message: string, type: "success" | "error") => void;
};

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};
const MAX_AUDIO_BYTES = 12_000_000;
const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"] as const;

export function extensionForAudioMime(mimeType: string): string | null {
  return MIME_EXTENSIONS[mimeType.toLowerCase().split(";", 1)[0].trim()] ?? null;
}

export function browserAudioRecordingDependencies(): AudioRecordingDependencies {
  return {
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
    createRecorder: (stream, mimeType) => new MediaRecorder(stream as MediaStream, mimeType ? { mimeType } : undefined),
    createReader: () => new FileReader(),
    isTypeSupported: mimeType => MediaRecorder.isTypeSupported(mimeType),
  };
}

export class AudioRecordingController {
  private phase: AudioRecordingPhase = "idle";
  private generation = 0;
  private current: RecordingSession | null = null;

  constructor(private readonly dependencies: AudioRecordingDependencies, private readonly callbacks: AudioRecordingCallbacks) {}

  getPhase(): AudioRecordingPhase { return this.phase; }
  getGeneration(): number | null { return this.current?.generation ?? null; }

  async start(context: AudioRecordingContext): Promise<boolean> {
    if (this.phase !== "idle" && this.phase !== "cancelled" && this.phase !== "error") return false;
    if (!context.tenantId || !context.conversationId) return false;
    if (this.current) this.cleanup(this.current, "cancelled", true);

    const session: RecordingSession = {
      ...context,
      generation: ++this.generation,
      startedAt: (this.dependencies.now ?? Date.now)(),
      decision: null,
      invalidated: false,
      stopRequested: false,
      chunks: [],
    };
    this.current = session;
    this.setPhase("requesting_permission");

    let stream: StreamLike;
    try {
      stream = await this.dependencies.getUserMedia();
    } catch {
      if (this.isCurrent(session)) {
        this.callbacks.onNotice("Permita o acesso ao microfone para gravar áudio.", "error");
        this.cleanup(session, "error", false);
      }
      return false;
    }

    if (!this.isCurrent(session)) {
      this.stopTracks(stream);
      return false;
    }

    session.stream = stream;
    let recorder: RecorderLike;
    try {
      const mimeType = PREFERRED_MIME_TYPES.find(type => this.dependencies.isTypeSupported(type));
      recorder = this.dependencies.createRecorder(stream, mimeType);
    } catch {
      this.callbacks.onNotice("Não foi possível iniciar a gravação de áudio.", "error");
      this.cleanup(session, "error", false);
      return false;
    }
    if (!this.isCurrent(session)) {
      this.stopTracks(stream);
      return false;
    }

    session.recorder = recorder;
    recorder.ondataavailable = event => {
      if (this.isCurrent(session) && event.data.size > 0) session.chunks.push(event.data);
    };
    recorder.onstop = () => { void this.handleStopped(session); };
    recorder.onerror = () => {
      if (!this.isCurrent(session)) return;
      this.callbacks.onNotice("Não foi possível gravar o áudio.", "error");
      this.cleanup(session, "error", false);
    };
    try {
      recorder.start(250);
      this.setPhase("recording");
      return true;
    } catch {
      this.callbacks.onNotice("Não foi possível iniciar a gravação de áudio.", "error");
      this.cleanup(session, "error", false);
      return false;
    }
  }

  decide(decision: AudioDecision): boolean {
    const session = this.current;
    if (!session || this.phase !== "recording" || session.decision !== null || session.invalidated) return false;
    session.decision = decision;
    session.stopRequested = true;
    this.setPhase("stopping");
    try {
      if (session.recorder?.state !== "inactive") session.recorder?.stop();
      else void this.handleStopped(session);
    } catch {
      if (decision === "cancel") this.cleanup(session, "cancelled", false);
      else {
        this.callbacks.onNotice("Não foi possível finalizar a gravação.", "error");
        this.cleanup(session, "error", false);
      }
    }
    return true;
  }

  invalidate(message?: string): boolean {
    const session = this.current;
    if (!session || this.phase === "idle" || this.phase === "cancelled" || this.phase === "error" || this.phase === "sending") return false;
    session.invalidated = true;
    if (session.decision === null) session.decision = "cancel";
    this.cleanup(session, "cancelled", true);
    if (message) this.callbacks.onNotice(message, "success");
    return true;
  }

  dispose(): void {
    const session = this.current;
    if (!session) return;
    session.invalidated = true;
    this.cleanup(session, "cancelled", this.phase !== "sending");
  }

  private async handleStopped(session: RecordingSession): Promise<void> {
    if (!this.isCurrent(session)) return;
    this.stopTracks(session.stream);
    session.stream = undefined;
    if (session.invalidated || session.decision !== "send") {
      if (session.decision === "cancel" && !session.invalidated) this.callbacks.onNotice("Gravação cancelada.", "success");
      this.cleanup(session, "cancelled", false);
      return;
    }

    this.setPhase("processing");
    const mimeType = session.recorder?.mimeType || "";
    const extension = extensionForAudioMime(mimeType);
    const blob = new Blob(session.chunks, { type: mimeType });
    session.chunks.length = 0;
    if (!extension) {
      this.callbacks.onNotice("Formato de áudio não suportado.", "error");
      this.cleanup(session, "error", false);
      return;
    }
    if (!blob.size) {
      this.callbacks.onNotice("Nenhum áudio foi gravado.", "error");
      this.cleanup(session, "error", false);
      return;
    }
    if (blob.size > MAX_AUDIO_BYTES) {
      this.callbacks.onNotice("O áudio excede o limite permitido.", "error");
      this.cleanup(session, "error", false);
      return;
    }

    const reader = this.dependencies.createReader();
    session.reader = reader;
    reader.onload = () => {
      if (!this.isCurrent(session) || session.invalidated || session.decision !== "send" || typeof reader.result !== "string") return;
      this.setPhase("sending");
      const payload: PreparedRecordedAudio = {
        tenantId: session.tenantId,
        conversationId: session.conversationId,
        userEmail: session.userEmail,
        generation: session.generation,
        startedAt: session.startedAt,
        dataUrl: reader.result,
        mimeType,
        fileName: `audio-${session.startedAt}.${extension}`,
      };
      void this.callbacks.onSend(payload).then(
        () => { if (this.isCurrent(session)) this.cleanup(session, "idle", false); },
        () => {
          if (!this.isCurrent(session)) return;
          this.callbacks.onNotice("Erro ao enviar áudio.", "error");
          this.cleanup(session, "error", false);
        },
      );
    };
    reader.onerror = () => {
      if (!this.isCurrent(session)) return;
      this.callbacks.onNotice("Não foi possível ler o áudio.", "error");
      this.cleanup(session, "error", false);
    };
    reader.onabort = () => { if (this.isCurrent(session) && !session.invalidated) this.cleanup(session, "cancelled", false); };
    reader.readAsDataURL(blob);
  }

  private cleanup(session: RecordingSession, finalPhase: AudioRecordingPhase, stopRecorder: boolean): void {
    session.invalidated = true;
    const reader = session.reader;
    if (reader) {
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
      if (reader.readyState === 1) { try { reader.abort(); } catch { /* already settled */ } }
    }
    session.reader = undefined;
    const recorder = session.recorder;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (stopRecorder && !session.stopRequested && recorder.state !== "inactive") {
        session.stopRequested = true;
        try { recorder.stop(); } catch { /* fail closed */ }
      }
    }
    session.recorder = undefined;
    this.stopTracks(session.stream);
    session.stream = undefined;
    session.chunks.length = 0;
    if (this.current === session) this.current = null;
    this.setPhase(finalPhase);
  }

  private isCurrent(session: RecordingSession): boolean {
    return this.current === session && !session.invalidated && session.generation === this.generation;
  }
  private stopTracks(stream?: StreamLike): void { stream?.getTracks().forEach(track => { try { track.stop(); } catch { /* idempotent cleanup */ } }); }
  private setPhase(phase: AudioRecordingPhase): void { this.phase = phase; this.callbacks.onPhaseChange(phase); }
}
