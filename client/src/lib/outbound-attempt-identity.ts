export type OutboundAttemptAttachment = {
  kind: string;
  mimeType: string;
  fileName?: string | null;
  dataUrl: string;
};

export type OutboundAttemptDraft = {
  tenantId: string;
  conversationId: string;
  senderContext: string;
  text: string;
  attachment: OutboundAttemptAttachment | null;
  replyToMessageId: string | null;
};

export type OutboundAttemptState = "created" | "submitted" | "uncertain" | "confirmed" | "expired";
export type StableOutboundAttempt = OutboundAttemptDraft & {
  clientAttemptId: string;
  fingerprint: string;
  state: OutboundAttemptState;
};

type LedgerEntry = {
  version: 1;
  tenantId: string;
  conversationId: string;
  fingerprint: string;
  clientAttemptId: string;
  state: OutboundAttemptState;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export type OutboundAttemptLedgerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> & Partial<Pick<Storage, "length" | "key">>;
type LockRunner = <T>(name: string, operation: () => Promise<T>) => Promise<T>;

export type OutboundAttemptCoordinationErrorCode =
  | "OUTBOUND_ATTEMPT_COORDINATION_UNAVAILABLE"
  | "OUTBOUND_ATTEMPT_LEDGER_CORRUPT";

export class OutboundAttemptCoordinationError extends Error {
  constructor(readonly code: OutboundAttemptCoordinationErrorCode, options?: { cause?: unknown }) {
    super("Não foi possível preparar o envio com segurança. Tente novamente.", options);
    this.name = "OutboundAttemptCoordinationError";
  }
}

const PREFIX = "megadesk_outbound_attempt_v1:";
const ACTIVE_TTL_MS = 24 * 60 * 60 * 1000;
const UNCERTAIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CONFIRMED_TTL_MS = 30 * 1000;
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Streaming hash avoids copying or persisting a potentially large Data URL. */
export function outboundAttemptLogicalFingerprint(draft: OutboundAttemptDraft): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  const add = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193) >>> 0;
      second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
    }
    first = Math.imul(first ^ 0, 0x01000193) >>> 0;
    second = Math.imul(second ^ 0, 0xc2b2ae35) >>> 0;
  };
  add(draft.tenantId);
  add(draft.conversationId);
  add(draft.senderContext.trim().toLowerCase());
  add(draft.text);
  add(draft.replyToMessageId ?? "");
  add(draft.attachment?.kind ?? "text");
  add(draft.attachment?.mimeType.toLowerCase() ?? "");
  add(draft.attachment?.fileName ?? "");
  add(draft.attachment?.dataUrl ?? "");
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function browserStorage(): OutboundAttemptLedgerStorage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function coordinationUnavailable(cause?: unknown): OutboundAttemptCoordinationError {
  return new OutboundAttemptCoordinationError("OUTBOUND_ATTEMPT_COORDINATION_UNAVAILABLE", { cause });
}

function ledgerCorrupt(cause?: unknown): OutboundAttemptCoordinationError {
  return new OutboundAttemptCoordinationError("OUTBOUND_ATTEMPT_LEDGER_CORRUPT", { cause });
}

function browserLockRunner(): LockRunner {
  return async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
    let locks: LockManager | undefined;
    try { locks = typeof navigator === "undefined" ? undefined : navigator.locks; } catch (error) {
      throw coordinationUnavailable(error);
    }
    if (!locks?.request) throw coordinationUnavailable();
    let entered = false;
    try {
      return await locks.request(name, async () => {
        entered = true;
        return operation();
      });
    } catch (error) {
      if (entered && (error instanceof OutboundAttemptCoordinationError
        || (error instanceof Error && error.message === "OUTBOUND_ATTEMPT_EXPIRED_REQUIRES_USER_REVIEW"))) throw error;
      throw coordinationUnavailable(error);
    }
  };
}

function parseEntry(raw: string | null): LedgerEntry | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LedgerEntry>;
    return value.version === 1 && typeof value.tenantId === "string" && typeof value.conversationId === "string"
      && typeof value.fingerprint === "string" && typeof value.clientAttemptId === "string"
      && ["created", "submitted", "uncertain", "confirmed", "expired"].includes(String(value.state))
      && typeof value.createdAt === "number" && typeof value.updatedAt === "number" && typeof value.expiresAt === "number"
      ? value as LedgerEntry : null;
  } catch { return null; }
}

export class OutboundAttemptLedger {
  private readonly lock: LockRunner;

  constructor(
    private readonly storage: OutboundAttemptLedgerStorage | null = browserStorage(),
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) { this.lock = browserLockRunner(); }

  private requireStorage(): OutboundAttemptLedgerStorage {
    if (!this.storage) throw coordinationUnavailable();
    return this.storage;
  }

  private read(key: string): string | null {
    try { return this.requireStorage().getItem(key); } catch (error) {
      if (error instanceof OutboundAttemptCoordinationError) throw error;
      throw coordinationUnavailable(error);
    }
  }

  private remove(key: string): void {
    try { this.requireStorage().removeItem(key); } catch (error) {
      if (error instanceof OutboundAttemptCoordinationError) throw error;
      throw coordinationUnavailable(error);
    }
  }

  private write(key: string, value: string): void {
    try {
      const storage = this.requireStorage();
      storage.setItem(key, value);
      if (storage.getItem(key) !== value) throw new Error("OUTBOUND_ATTEMPT_LEDGER_WRITE_NOT_DURABLE");
    } catch (error) {
      if (error instanceof OutboundAttemptCoordinationError) throw error;
      throw coordinationUnavailable(error);
    }
  }

  private proveWritable(key: string, timestamp: number): void {
    const probeKey = `${key}:probe`;
    const probeValue = `probe:${timestamp}`;
    try {
      this.write(probeKey, probeValue);
    } catch (error) {
      try { this.remove(probeKey); } catch { /* preserve the original typed failure */ }
      throw error;
    }
    this.remove(probeKey);
  }

  private entry(key: string): LedgerEntry | null {
    const raw = this.read(key);
    if (raw === null) return null;
    const entry = parseEntry(raw);
    if (!entry) throw ledgerCorrupt();
    return entry;
  }

  private cleanup(timestamp: number): void {
    const storage = this.requireStorage();
    let length: number | undefined;
    try { length = storage.length; } catch (error) { throw coordinationUnavailable(error); }
    if (typeof length !== "number" || typeof storage.key !== "function") return;
    const expired: string[] = [];
    for (let index = 0; index < length; index += 1) {
      let key: string | null;
      try { key = storage.key(index); } catch (error) { throw coordinationUnavailable(error); }
      if (!key?.startsWith(PREFIX) || key.endsWith(":lock")) continue;
      if (key.endsWith(":probe")) continue;
      const entry = this.entry(key);
      if (!entry) continue;
      if ((entry.state === "confirmed" && entry.expiresAt <= timestamp)
        || (entry.state === "expired" && entry.updatedAt + TOMBSTONE_TTL_MS <= timestamp)) expired.push(key);
    }
    expired.forEach(key => this.remove(key));
  }

  async claim(draft: OutboundAttemptDraft): Promise<StableOutboundAttempt> {
    const fingerprint = outboundAttemptLogicalFingerprint(draft);
    const key = `${PREFIX}${encodeURIComponent(draft.tenantId)}:${fingerprint}`;
    return this.lock(key, async () => {
      const timestamp = this.now();
      this.proveWritable(key, timestamp);
      this.cleanup(timestamp);
      const existing = this.entry(key);
      if (existing && existing.tenantId === draft.tenantId && existing.conversationId === draft.conversationId) {
        if (existing.state !== "expired" && existing.expiresAt > timestamp) {
          return { ...draft, clientAttemptId: existing.clientAttemptId, fingerprint, state: existing.state };
        }
        this.write(key, JSON.stringify({ ...existing, state: "expired", updatedAt: timestamp }));
        throw new Error("OUTBOUND_ATTEMPT_EXPIRED_REQUIRES_USER_REVIEW");
      }
      const entry: LedgerEntry = {
        version: 1, tenantId: draft.tenantId, conversationId: draft.conversationId, fingerprint,
        clientAttemptId: this.createId(), state: "created", createdAt: timestamp, updatedAt: timestamp,
        expiresAt: timestamp + ACTIVE_TTL_MS,
      };
      this.write(key, JSON.stringify(entry));
      return { ...draft, clientAttemptId: entry.clientAttemptId, fingerprint, state: entry.state };
    });
  }

  async transition(attempt: Pick<StableOutboundAttempt, "tenantId" | "fingerprint" | "clientAttemptId">, state: OutboundAttemptState): Promise<void> {
    const key = `${PREFIX}${encodeURIComponent(attempt.tenantId)}:${attempt.fingerprint}`;
    await this.lock(key, async () => {
      const timestamp = this.now();
      this.proveWritable(key, timestamp);
      const current = this.entry(key);
      if (!current || current.clientAttemptId !== attempt.clientAttemptId) throw coordinationUnavailable();
      this.write(key, JSON.stringify({ ...current, state, updatedAt: timestamp,
        expiresAt: timestamp + (state === "uncertain" ? UNCERTAIN_TTL_MS
          : state === "confirmed" ? CONFIRMED_TTL_MS : ACTIVE_TTL_MS) }));
    });
  }

  async complete(attempt: Pick<StableOutboundAttempt, "tenantId" | "fingerprint" | "clientAttemptId">): Promise<void> {
    await this.transition(attempt, "confirmed");
  }

  async release(attempt: Pick<StableOutboundAttempt, "tenantId" | "fingerprint" | "clientAttemptId">): Promise<void> {
    const key = `${PREFIX}${encodeURIComponent(attempt.tenantId)}:${attempt.fingerprint}`;
    await this.lock(key, async () => {
      const timestamp = this.now();
      this.proveWritable(key, timestamp);
      const current = this.entry(key);
      if (current?.clientAttemptId === attempt.clientAttemptId) this.remove(key);
    });
  }
}

export const outboundAttemptLedger = new OutboundAttemptLedger();

export function isDefinitiveOutboundClientFailure(error: unknown): boolean {
  const candidate = error as { data?: { code?: unknown }; shape?: { data?: { code?: unknown } } } | null;
  const code = candidate?.data?.code ?? candidate?.shape?.data?.code;
  return ["BAD_REQUEST", "BAD_GATEWAY", "PAYLOAD_TOO_LARGE", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(String(code));
}
