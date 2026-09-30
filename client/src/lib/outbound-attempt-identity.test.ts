import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OutboundAttemptCoordinationError,
  OutboundAttemptLedger,
  outboundAttemptLogicalFingerprint,
  type OutboundAttemptLedgerStorage,
} from "./outbound-attempt-identity";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    values };
}

const draft = { tenantId: "tenant-a", conversationId: "conversation-a", senderContext: "operator@example.test",
  text: "hello", attachment: null, replyToMessageId: null };

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function installWebLocks(options: { failBeforeCallback?: boolean } = {}) {
  const chains = new Map<string, Promise<void>>();
  const request = vi.fn(async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
    if (options.failBeforeCallback) throw new Error("Web Locks unavailable");
    const previous = chains.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    chains.set(name, previous.then(() => current));
    await previous;
    try { return await operation(); } finally { release(); }
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request } } });
  return request;
}

function removeWebLocks() {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
}

function restoreNavigator() {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
}

describe("durable outbound attempt ledger", () => {
  beforeEach(() => { installWebLocks(); });
  afterEach(() => {
    restoreNavigator();
    vi.restoreAllMocks();
  });

  it("uses the real Web Locks coordinator to issue one identity to two concurrent tabs", async () => {
    const shared = storage();
    const createId = vi.fn().mockReturnValueOnce("attempt-shared").mockReturnValueOnce("attempt-forbidden");
    const [a, b] = await Promise.all([
      new OutboundAttemptLedger(shared, () => 100, createId).claim(draft),
      new OutboundAttemptLedger(shared, () => 100, createId).claim(draft),
    ]);
    expect(a.clientAttemptId).toBe("attempt-shared");
    expect(b.clientAttemptId).toBe("attempt-shared");
    expect(createId).toHaveBeenCalledOnce();
  });

  it("fails closed before creating a provider-eligible attempt when Web Locks is unavailable", async () => {
    removeWebLocks();
    const createId = vi.fn(() => "attempt-forbidden");
    const provider = vi.fn();
    const ledger = new OutboundAttemptLedger(storage(), () => 100, createId);
    await expect(ledger.claim(draft)).rejects.toMatchObject({ code: "OUTBOUND_ATTEMPT_COORDINATION_UNAVAILABLE" });
    expect(createId).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it("fails both adversarial tabs closed when no safe coordinator exists", async () => {
    removeWebLocks();
    const createId = vi.fn(() => "attempt-forbidden");
    const results = await Promise.allSettled([
      new OutboundAttemptLedger(storage(), () => 100, createId).claim(draft),
      new OutboundAttemptLedger(storage(), () => 100, createId).claim(draft),
    ]);
    expect(results.map(result => result.status)).toEqual(["rejected", "rejected"]);
    expect(createId).not.toHaveBeenCalled();
  });

  it("fails closed without a transient UUID when durable storage is unavailable", async () => {
    const createId = vi.fn(() => "attempt-forbidden");
    const ledger = new OutboundAttemptLedger(null, () => 100, createId);
    await expect(ledger.claim(draft)).rejects.toBeInstanceOf(OutboundAttemptCoordinationError);
    expect(createId).not.toHaveBeenCalled();
  });

  it("fails closed before creating an ID when storage reads work but writes fail", async () => {
    const shared = storage();
    const failing: OutboundAttemptLedgerStorage = {
      ...shared,
      setItem: () => { throw new DOMException("quota exceeded", "QuotaExceededError"); },
    };
    const createId = vi.fn(() => "attempt-forbidden");
    const ledger = new OutboundAttemptLedger(failing, () => 100, createId);
    await expect(ledger.claim(draft)).rejects.toMatchObject({ code: "OUTBOUND_ATTEMPT_COORDINATION_UNAVAILABLE" });
    expect(createId).not.toHaveBeenCalled();
  });

  it("fails closed with a sanitized typed error when storage reads throw", async () => {
    const failing: OutboundAttemptLedgerStorage = {
      getItem: () => { throw new DOMException("blocked", "SecurityError"); },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const createId = vi.fn(() => "attempt-forbidden");
    const ledger = new OutboundAttemptLedger(failing, () => 100, createId);
    await expect(ledger.claim(draft)).rejects.toMatchObject({
      code: "OUTBOUND_ATTEMPT_COORDINATION_UNAVAILABLE",
      message: "Não foi possível preparar o envio com segurança. Tente novamente.",
    });
    expect(createId).not.toHaveBeenCalled();
  });

  it("fails closed without deleting an ambiguous corrupt ledger entry", async () => {
    const shared = storage();
    const fingerprint = outboundAttemptLogicalFingerprint(draft);
    const key = `megadesk_outbound_attempt_v1:${encodeURIComponent(draft.tenantId)}:${fingerprint}`;
    shared.values.set(key, "{not-json");
    const createId = vi.fn(() => "attempt-forbidden");
    const ledger = new OutboundAttemptLedger(shared, () => 100, createId);
    await expect(ledger.claim(draft)).rejects.toMatchObject({ code: "OUTBOUND_ATTEMPT_LEDGER_CORRUPT" });
    expect(createId).not.toHaveBeenCalled();
    expect(shared.values.get(key)).toBe("{not-json");
  });

  it("rehydrates the same uncertain identity after F5, remount and navigation without storing payload", async () => {
    const shared = storage();
    const first = new OutboundAttemptLedger(shared, () => 100, () => "attempt-original");
    const claimed = await first.claim(draft);
    await first.transition(claimed, "uncertain");
    for (const now of [200, 300, 400]) {
      const remounted = new OutboundAttemptLedger(shared, () => now, () => "attempt-forbidden");
      await expect(remounted.claim(draft)).resolves.toMatchObject({ clientAttemptId: "attempt-original", state: "uncertain" });
    }
    expect([...shared.values.values()].join(" ")).not.toContain("hello");
  });

  it("uses the same real coordinator for concurrent recorded-audio attempts", async () => {
    const shared = storage();
    const audioDraft = { ...draft, text: "", attachment: { kind: "audio", mimeType: "audio/webm",
      fileName: "recording.webm", dataUrl: "data:audio/webm;base64,AAAA" } };
    const ids = vi.fn().mockReturnValueOnce("audio-attempt").mockReturnValueOnce("audio-duplicate");
    const [a, b] = await Promise.all([
      new OutboundAttemptLedger(shared, () => 100, ids).claim(audioDraft),
      new OutboundAttemptLedger(shared, () => 100, ids).claim(audioDraft),
    ]);
    expect(a.clientAttemptId).toBe("audio-attempt");
    expect(b.clientAttemptId).toBe("audio-attempt");
    expect(ids).toHaveBeenCalledOnce();
  });

  it("fails closed when Web Locks rejects before granting exclusive access", async () => {
    installWebLocks({ failBeforeCallback: true });
    const createId = vi.fn(() => "attempt-forbidden");
    const ledger = new OutboundAttemptLedger(storage(), () => 100, createId);
    await expect(ledger.claim(draft)).rejects.toMatchObject({ code: "OUTBOUND_ATTEMPT_COORDINATION_UNAVAILABLE" });
    expect(createId).not.toHaveBeenCalled();
  });

  it("fails closed instead of minting a new ID when an uncertain attempt expires", async () => {
    const shared = storage();
    let now = 100;
    const createId = vi.fn(() => "attempt-original");
    const ledger = new OutboundAttemptLedger(shared, () => now, createId);
    const claimed = await ledger.claim(draft);
    await ledger.transition(claimed, "uncertain");
    now += 8 * 24 * 60 * 60 * 1000;
    await expect(ledger.claim(draft)).rejects.toThrow("OUTBOUND_ATTEMPT_EXPIRED_REQUIRES_USER_REVIEW");
    expect(createId).toHaveBeenCalledOnce();
  });

  it("binds recorded audio bytes without persisting its Data URL", () => {
    const first = { ...draft, attachment: { kind: "audio", mimeType: "audio/webm", fileName: "recording.webm",
      dataUrl: "data:audio/webm;base64,AAAA" } };
    const second = { ...first, attachment: { ...first.attachment, dataUrl: "data:audio/webm;base64,AAAB" } };
    expect(outboundAttemptLogicalFingerprint(first)).not.toBe(outboundAttemptLogicalFingerprint(second));
  });

  it("keeps a short confirmed tombstone for late tabs then permits an intentional later send", async () => {
    const shared = storage();
    const ids = ["attempt-one", "attempt-two"];
    let now = 100;
    const ledger = new OutboundAttemptLedger(shared, () => now, () => ids.shift()!);
    const first = await ledger.claim(draft);
    await ledger.complete(first);
    expect((await ledger.claim(draft)).clientAttemptId).toBe("attempt-one");
    now += 31_000;
    expect((await ledger.claim(draft)).clientAttemptId).toBe("attempt-two");
  });
});
