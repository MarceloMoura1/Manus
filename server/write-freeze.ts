import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, readFile, readdir, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";

export type FreezeMode = "unfrozen" | "draining" | "active" | "corrupt";

type DurableStateBody = {
  version: 1;
  mode: Exclude<FreezeMode, "corrupt">;
  sequence: number;
  activatedAt: string | null;
  reason: string | null;
};

type DurableState = DurableStateBody & { checksum: string };

export type WebhookBinding = { tenantId: string; integrationId: string };

export type WebhookSpoolInput = {
  provider: "evolution" | "meta";
  event: string;
  providerEventId?: string | null;
  bindings: WebhookBinding[];
  payload: unknown;
  receivedAt?: string;
};

export type WebhookSpoolRecord = {
  version: 1;
  sequence: number;
  idempotencyKey: string;
  provider: WebhookSpoolInput["provider"];
  event: string;
  providerEventId: string | null;
  bindings: WebhookBinding[];
  receivedAt: string;
  payload: unknown;
  payloadSha256: string;
  checksum: string;
};

export type WriteFreezeOptions = {
  root: string;
  maxWebhookBytes?: number;
  maxSpoolBytes?: number;
  maxSpoolEvents?: number;
  processLockTimeoutMs?: number;
  incompleteLockStaleMs?: number;
  beforeSpoolCommit?: () => void | Promise<void>;
  afterSpoolPersist?: (record: WebhookSpoolRecord) => void | Promise<void>;
};

export class WriteFreezeError extends Error {
  constructor(
    message: string,
    readonly code: "WRITE_FREEZE_ACTIVE" | "WRITE_FREEZE_CORRUPT" | "WEBHOOK_SPOOL_FULL" | "INVALID_WEBHOOK",
  ) {
    super(message);
    this.name = "WriteFreezeError";
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stateChecksum(body: DurableStateBody): string {
  return sha256(stableJson(body));
}

function recordChecksum(record: Omit<WebhookSpoolRecord, "checksum">): string {
  return sha256(stableJson(record));
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const directoryHandle = await open(directory, constants.O_RDONLY);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

async function ensureSafeDirectory(root: string, directory: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedDirectory = path.resolve(directory);
  if (!isInside(resolvedRoot, resolvedDirectory)) {
    throw new WriteFreezeError("Diretório fora da raiz do freeze.", "WRITE_FREEZE_CORRUPT");
  }
  await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(resolvedRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new WriteFreezeError("Raiz do freeze não é diretório privado.", "WRITE_FREEZE_CORRUPT");
  }
  let current = resolvedRoot;
  const relative = path.relative(resolvedRoot, resolvedDirectory);
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    try { await mkdir(current, { mode: 0o700 }); }
    catch (error: any) { if (error?.code !== "EEXIST") throw error; }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new WriteFreezeError("Symlink/reparse point rejeitado no freeze.", "WRITE_FREEZE_CORRUPT");
    }
  }
  const [realRoot, realDirectory] = await Promise.all([realpath(resolvedRoot), realpath(resolvedDirectory)]);
  if (!isInside(realRoot, realDirectory)) {
    throw new WriteFreezeError("Escape de diretório detectado no freeze.", "WRITE_FREEZE_CORRUPT");
  }
}

async function durableWrite(root: string, file: string, contents: string, beforeCommit?: () => void | Promise<void>): Promise<void> {
  const directory = path.dirname(file);
  await ensureSafeDirectory(root, directory);
  if (!isInside(path.resolve(root), path.resolve(file))) {
    throw new WriteFreezeError("Arquivo fora da raiz do freeze.", "WRITE_FREEZE_CORRUPT");
  }
  try {
    const existing = await lstat(file);
    if (existing.isSymbolicLink() || !existing.isFile()) throw new WriteFreezeError("Destino inseguro no freeze.", "WRITE_FREEZE_CORRUPT");
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await beforeCommit?.();
  await rename(temporary, file);
  await syncDirectory(directory);
}

function canonicalBindings(bindings: WebhookBinding[]): WebhookBinding[] {
  const normalized = bindings.map(binding => ({
    tenantId: binding.tenantId.trim(),
    integrationId: binding.integrationId.trim(),
  }));
  const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,179}$/;
  if (normalized.length === 0 || normalized.some(binding => !safeIdentifier.test(binding.tenantId) || !safeIdentifier.test(binding.integrationId))) {
    throw new WriteFreezeError("Webhook sem binding autoritativo.", "INVALID_WEBHOOK");
  }
  return [...new Map(normalized.map(binding => [`${binding.tenantId}\u0000${binding.integrationId}`, binding])).values()]
    .sort((a, b) => `${a.tenantId}\u0000${a.integrationId}`.localeCompare(`${b.tenantId}\u0000${b.integrationId}`));
}

type InstallationBody = { version: 1; installationId: string; createdAt: string };
type InstallationRecord = InstallationBody & { checksum: string };
type LockOwnerBody = { version: 1; pid: number; token: string; acquiredAt: string };
type LockOwnerRecord = LockOwnerBody & { checksum: string };
type LeaseBody = { version: 1; id: string; pid: number; label: string; tenantId: string | null; startedAt: string };
type LeaseRecord = LeaseBody & { checksum: string };
type LocalWriter = { label: string; tenantId: string | null; startedAt: string; leaseFile: string };

const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error: any) { return error?.code === "EPERM"; }
}

export class WriteFreezeCoordinator {
  private mode: FreezeMode = "unfrozen";
  private sequence = 0;
  private activatedAt: string | null = null;
  private reason: string | null = null;
  private initialized = false;
  private active = new Map<string, LocalWriter>();
  private serial: Promise<unknown> = Promise.resolve();
  private readonly maxWebhookBytes: number;
  private readonly maxSpoolBytes: number;
  private readonly maxSpoolEvents: number;
  private readonly processLockTimeoutMs: number;
  private readonly incompleteLockStaleMs: number;

  constructor(private readonly options: WriteFreezeOptions) {
    if (!path.isAbsolute(options.root)) throw new Error("Write-freeze root must be absolute.");
    this.maxWebhookBytes = options.maxWebhookBytes ?? 1024 * 1024;
    this.maxSpoolBytes = options.maxSpoolBytes ?? 1024 * 1024 * 1024;
    this.maxSpoolEvents = options.maxSpoolEvents ?? 10_000;
    this.processLockTimeoutMs = options.processLockTimeoutMs ?? 30_000;
    this.incompleteLockStaleMs = options.incompleteLockStaleMs ?? 10_000;
  }

  private get root() { return path.resolve(this.options.root); }
  private get stateFile() { return path.join(this.root, "state.json"); }
  private get installationFile() { return path.join(this.root, "installation.json"); }
  private get locksDirectory() { return path.join(this.root, "locks"); }
  private get leasesDirectory() { return path.join(this.root, "leases"); }
  private get orphanedLeasesDirectory() { return path.join(this.root, "leases-orphaned"); }
  private get pendingDirectory() { return path.join(this.root, "webhooks", "pending"); }
  private get replayedDirectory() { return path.join(this.root, "webhooks", "replayed"); }

  private async synchronized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serial.then(operation, operation);
    this.serial = result.then(() => undefined, () => undefined);
    return result;
  }

  private async cleanupSimpleDirectory(directory: string): Promise<void> {
    try {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile()) throw new WriteFreezeError("Lock interprocesso contém entrada insegura.", "WRITE_FREEZE_CORRUPT");
        await unlink(path.join(directory, entry.name));
      }
      await rmdir(directory);
      await syncDirectory(path.dirname(directory));
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  private async lockCanBeRecovered(lockDirectory: string): Promise<boolean> {
    const info = await lstat(lockDirectory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new WriteFreezeError("Lock interprocesso inseguro.", "WRITE_FREEZE_CORRUPT");
    }
    try {
      const owner = JSON.parse(await readFile(path.join(lockDirectory, "owner.json"), "utf8")) as LockOwnerRecord;
      const { checksum, ...body } = owner;
      if (body.version !== 1 || !Number.isSafeInteger(body.pid) || body.pid <= 0 || checksum !== sha256(stableJson(body))) {
        return Date.now() - info.mtimeMs >= this.incompleteLockStaleMs;
      }
      return !processIsAlive(body.pid);
    } catch (error: any) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      return Date.now() - info.mtimeMs >= this.incompleteLockStaleMs;
    }
  }

  private async withProcessLock<T>(name: "state" | "replay", operation: () => Promise<T>): Promise<T> {
    await ensureSafeDirectory(this.root, this.locksDirectory);
    const lockDirectory = path.join(this.locksDirectory, `${name}.lock`);
    const deadline = Date.now() + this.processLockTimeoutMs;
    const token = randomUUID();
    while (true) {
      try {
        await mkdir(lockDirectory, { mode: 0o700 });
        const ownerBody: LockOwnerBody = { version: 1, pid: process.pid, token, acquiredAt: new Date().toISOString() };
        await durableWrite(this.root, path.join(lockDirectory, "owner.json"), `${stableJson({ ...ownerBody, checksum: sha256(stableJson(ownerBody)) })}\n`);
        break;
      } catch (error: any) {
        if (error?.code !== "EEXIST") throw error;
        if (await this.lockCanBeRecovered(lockDirectory)) {
          const staleDirectory = `${lockDirectory}.stale-${randomUUID()}`;
          try {
            await rename(lockDirectory, staleDirectory);
            await this.cleanupSimpleDirectory(staleDirectory);
            continue;
          } catch (recoveryError: any) {
            if (!["ENOENT", "EACCES", "EPERM"].includes(recoveryError?.code)) throw recoveryError;
          }
        }
        if (Date.now() >= deadline) {
          throw new WriteFreezeError(`Timeout no lock interprocesso ${name}.`, "WRITE_FREEZE_CORRUPT");
        }
        await delay(10 + Math.floor(Math.random() * 15));
      }
    }
    try {
      return await operation();
    } finally {
      await this.cleanupSimpleDirectory(lockDirectory);
    }
  }

  private async refreshState(createIfMissing = false): Promise<void> {
    let stateExists = true;
    let installationExists = true;
    try { await access(this.stateFile); } catch (error: any) { if (error?.code === "ENOENT") stateExists = false; else throw error; }
    try { await access(this.installationFile); } catch (error: any) { if (error?.code === "ENOENT") installationExists = false; else throw error; }

    if (!stateExists && !installationExists && createIfMissing) {
      const installationBody: InstallationBody = { version: 1, installationId: randomUUID(), createdAt: new Date().toISOString() };
      await durableWrite(this.root, this.installationFile, `${stableJson({ ...installationBody, checksum: sha256(stableJson(installationBody)) })}\n`);
      this.mode = "unfrozen";
      this.sequence = 0;
      this.activatedAt = null;
      this.reason = null;
      await this.persistState();
      return;
    }
    if (!stateExists || !installationExists) {
      this.mode = "corrupt";
      return;
    }
    try {
      const [stateInfo, installationInfo] = await Promise.all([lstat(this.stateFile), lstat(this.installationFile)]);
      if (!stateInfo.isFile() || stateInfo.isSymbolicLink() || !installationInfo.isFile() || installationInfo.isSymbolicLink()) {
        this.mode = "corrupt";
        return;
      }
      const installation = JSON.parse(await readFile(this.installationFile, "utf8")) as InstallationRecord;
      const { checksum: installationChecksum, ...installationBody } = installation;
      if (installationBody.version !== 1 || typeof installationBody.installationId !== "string"
        || !installationBody.installationId || installationChecksum !== sha256(stableJson(installationBody))) {
        this.mode = "corrupt";
        return;
      }
      const parsed = JSON.parse(await readFile(this.stateFile, "utf8")) as DurableState;
      const { checksum, ...body } = parsed;
      if (body.version !== 1 || !["unfrozen", "draining", "active"].includes(body.mode)
        || !Number.isSafeInteger(body.sequence) || body.sequence < 0 || checksum !== stateChecksum(body)) {
        this.mode = "corrupt";
        return;
      }
      this.mode = body.mode;
      this.sequence = body.sequence;
      this.activatedAt = body.activatedAt;
      this.reason = body.reason;
    } catch {
      this.mode = "corrupt";
    }
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.synchronized(async () => {
      if (this.initialized) return;
      await this.withProcessLock("state", () => this.refreshState(true));
      this.initialized = true;
    });
  }

  private async persistState(): Promise<void> {
    if (this.mode === "corrupt") throw new WriteFreezeError("Estado do freeze corrompido.", "WRITE_FREEZE_CORRUPT");
    const body: DurableStateBody = {
      version: 1,
      mode: this.mode,
      sequence: this.sequence,
      activatedAt: this.activatedAt,
      reason: this.reason,
    };
    await durableWrite(this.root, this.stateFile, `${stableJson({ ...body, checksum: stateChecksum(body) })}\n`);
  }

  private async leaseFiles(reclaimDead = false): Promise<string[]> {
    await ensureSafeDirectory(this.root, this.leasesDirectory);
    const entries = await readdir(this.leasesDirectory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (!entry.name.endsWith(".json")) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) throw new WriteFreezeError("Lease inseguro detectado.", "WRITE_FREEZE_CORRUPT");
      const leaseFile = path.join(this.leasesDirectory, entry.name);
      let lease: LeaseRecord;
      try { lease = JSON.parse(await readFile(leaseFile, "utf8")) as LeaseRecord; }
      catch { throw new WriteFreezeError("Lease truncado ou ilegível.", "WRITE_FREEZE_CORRUPT"); }
      const { checksum, ...body } = lease;
      if (body.version !== 1 || !Number.isSafeInteger(body.pid) || body.pid <= 0
        || typeof body.id !== "string" || `${body.id}.json` !== entry.name || checksum !== sha256(stableJson(body))) {
        throw new WriteFreezeError("Integridade do lease inválida.", "WRITE_FREEZE_CORRUPT");
      }
      if (reclaimDead && !processIsAlive(body.pid)) {
        await ensureSafeDirectory(this.root, this.orphanedLeasesDirectory);
        await rename(leaseFile, path.join(this.orphanedLeasesDirectory, entry.name));
        await Promise.all([syncDirectory(this.leasesDirectory), syncDirectory(this.orphanedLeasesDirectory)]);
        continue;
      }
      files.push(entry.name);
    }
    return files.sort();
  }

  private async releaseLease(id: string, leaseFile: string): Promise<void> {
    try { await unlink(leaseFile); }
    catch (error: any) { if (error?.code !== "ENOENT") throw error; }
    await syncDirectory(this.leasesDirectory);
    this.active.delete(id);
  }

  async beginWrite(label: string, tenantId: string | null = null): Promise<() => Promise<void>> {
    await this.initialize();
    return this.synchronized(() => this.withProcessLock("state", async () => {
      await this.refreshState();
      if (this.mode === "corrupt") throw new WriteFreezeError("Escrita negada: estado de freeze inválido.", "WRITE_FREEZE_CORRUPT");
      if (this.mode !== "unfrozen") throw new WriteFreezeError("Escrita negada: write freeze ativo.", "WRITE_FREEZE_ACTIVE");
      const id = randomUUID();
      const startedAt = new Date().toISOString();
      const leaseFile = path.join(this.leasesDirectory, `${id}.json`);
      const leaseBody: LeaseBody = { version: 1, id, pid: process.pid, label, tenantId, startedAt };
      await durableWrite(this.root, leaseFile, `${stableJson({ ...leaseBody, checksum: sha256(stableJson(leaseBody)) })}\n`);
      this.active.set(id, { label, tenantId, startedAt, leaseFile });
      let releasePromise: Promise<void> | null = null;
      return async () => {
        releasePromise ??= this.synchronized(() => this.withProcessLock("state", () => this.releaseLease(id, leaseFile)));
        await releasePromise;
      };
    }));
  }

  async withWriteLease<T>(label: string, operation: () => Promise<T>, tenantId: string | null = null): Promise<T> {
    const release = await this.beginWrite(label, tenantId);
    try { return await operation(); } finally { await release(); }
  }

  async activate(reason: string, timeoutMs = 60_000): Promise<void> {
    await this.initialize();
    await this.synchronized(() => this.withProcessLock("state", async () => {
      await this.refreshState();
      if (this.mode === "corrupt") throw new WriteFreezeError("Estado do freeze corrompido.", "WRITE_FREEZE_CORRUPT");
      if (this.mode === "active") return;
      this.mode = "draining";
      this.reason = reason;
      this.activatedAt = new Date().toISOString();
      await this.persistState();
    }));

    const deadline = Date.now() + timeoutMs;
    while (true) {
      const activated = await this.synchronized(() => this.withProcessLock("state", async () => {
        await this.refreshState();
        if (this.mode !== "draining") throw new Error("Ativação do freeze abortada.");
        if ((await this.leaseFiles(true)).length > 0) return false;
        this.mode = "active";
        await this.persistState();
        return true;
      }));
      if (activated) return;
      if (Date.now() >= deadline) throw new Error("Timeout aguardando writers ativos; freeze permanece DRAINING.");
      await delay(20);
    }
  }

  async unfreeze(reason: string): Promise<void> {
    await this.initialize();
    await this.synchronized(() => this.withProcessLock("state", async () => {
      await this.refreshState();
      if (this.mode === "corrupt") throw new WriteFreezeError("Estado do freeze corrompido; reparo explícito exigido.", "WRITE_FREEZE_CORRUPT");
      this.mode = "unfrozen";
      this.reason = reason;
      this.activatedAt = null;
      await this.persistState();
    }));
  }

  async status() {
    await this.initialize();
    const state = await this.synchronized(() => this.withProcessLock("state", async () => {
      await this.refreshState();
      const activeWriters = this.mode === "corrupt" ? -1 : (await this.leaseFiles()).length;
      return {
        mode: this.mode,
        writeFreezeActive: this.mode === "active" || this.mode === "draining" || this.mode === "corrupt",
        activeWriters,
        inFlightWrites: activeWriters,
        writers: [...this.active.values()].map(({ leaseFile: _leaseFile, ...writer }) => writer),
        activatedAt: this.activatedAt,
        reason: this.reason,
      };
    }));
    const spool = await this.spoolUsage();
    return { ...state, webhooksSpooled: spool.events, webhookSpoolBytes: spool.bytes };
  }

  private async pendingFiles(): Promise<string[]> {
    await ensureSafeDirectory(this.root, this.pendingDirectory);
    const entries = await readdir(this.pendingDirectory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (!entry.name.endsWith(".json")) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) throw new WriteFreezeError("Entrada insegura no spool.", "WRITE_FREEZE_CORRUPT");
      files.push(entry.name);
    }
    return files.sort();
  }

  private async spoolUsage(): Promise<{ events: number; bytes: number }> {
    const files = await this.pendingFiles();
    let bytes = 0;
    for (const file of files) bytes += (await lstat(path.join(this.pendingDirectory, file))).size;
    return { events: files.length, bytes };
  }

  async spoolWebhook(input: WebhookSpoolInput): Promise<{ record: WebhookSpoolRecord; duplicate: boolean }> {
    await this.initialize();
    return this.synchronized(() => this.withProcessLock("state", async () => {
      await this.refreshState();
      if (this.mode === "unfrozen") throw new Error("Spool permitido somente durante freeze.");
      if (this.mode === "corrupt") throw new WriteFreezeError("Estado do freeze corrompido.", "WRITE_FREEZE_CORRUPT");
      if (!/^[A-Z][A-Z0-9_]{0,79}$/.test(input.event)) throw new WriteFreezeError("Evento de webhook inválido.", "INVALID_WEBHOOK");
      const providerEventId = input.providerEventId?.trim() || null;
      if (providerEventId && (providerEventId.length > 8192 || /[\u0000-\u001f\u007f]/.test(providerEventId))) {
        throw new WriteFreezeError("Identidade de webhook inválida.", "INVALID_WEBHOOK");
      }
      const payloadJson = stableJson(input.payload);
      if (typeof payloadJson !== "string") throw new WriteFreezeError("Payload de webhook inválido.", "INVALID_WEBHOOK");
      const payloadBytes = Buffer.byteLength(payloadJson);
      if (payloadBytes > this.maxWebhookBytes) throw new WriteFreezeError("Webhook excede o limite.", "INVALID_WEBHOOK");
      const bindings = canonicalBindings(input.bindings);
      const payloadSha256 = sha256(payloadJson);
      const identity = stableJson({ provider: input.provider, event: input.event, providerIdentity: providerEventId || payloadSha256, bindings });
      const idempotencyKey = sha256(identity);
      const pending = await this.pendingFiles();
      const existing = pending.find(file => file.endsWith(`-${idempotencyKey}.json`));
      if (existing) return { record: await this.readAndVerifyRecord(path.join(this.pendingDirectory, existing)), duplicate: true };
      const maxOnDisk = pending.reduce((max, file) => Math.max(max, Number(file.split("-")[0]) || 0), 0);
      const nextSequence = Math.max(this.sequence, maxOnDisk) + 1;
      const base = {
        version: 1 as const,
        sequence: nextSequence,
        idempotencyKey,
        provider: input.provider,
        event: input.event,
        providerEventId,
        bindings,
        receivedAt: input.receivedAt ?? new Date().toISOString(),
        payload: input.payload,
        payloadSha256,
      };
      const record: WebhookSpoolRecord = { ...base, checksum: recordChecksum(base) };
      const serialized = `${stableJson(record)}\n`;
      const usage = await this.spoolUsage();
      if (usage.events >= this.maxSpoolEvents || usage.bytes + Buffer.byteLength(serialized) > this.maxSpoolBytes) {
        throw new WriteFreezeError("Spool de webhook atingiu o limite.", "WEBHOOK_SPOOL_FULL");
      }
      this.sequence = nextSequence;
      const filename = `${String(record.sequence).padStart(16, "0")}-${idempotencyKey}.json`;
      await durableWrite(this.root, path.join(this.pendingDirectory, filename), serialized, this.options.beforeSpoolCommit);
      await this.persistState();
      await this.options.afterSpoolPersist?.(record);
      return { record, duplicate: false };
    }));
  }

  private async readAndVerifyRecord(file: string): Promise<WebhookSpoolRecord> {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || !isInside(this.root, path.resolve(file))) {
      throw new WriteFreezeError("Entrada insegura no spool.", "WRITE_FREEZE_CORRUPT");
    }
    const record = JSON.parse(await readFile(file, "utf8")) as WebhookSpoolRecord;
    const { checksum, ...body } = record;
    if (record.version !== 1 || checksum !== recordChecksum(body) || record.payloadSha256 !== sha256(stableJson(record.payload))) {
      throw new WriteFreezeError("Integridade do spool inválida.", "WRITE_FREEZE_CORRUPT");
    }
    canonicalBindings(record.bindings);
    return record;
  }

  async replayWebhookSpool(processRecord: (record: WebhookSpoolRecord) => Promise<void>, limit = 100): Promise<number> {
    await this.initialize();
    return this.withProcessLock("replay", async () => {
      let replayed = 0;
      for (const file of (await this.pendingFiles()).slice(0, limit)) {
        const source = path.join(this.pendingDirectory, file);
        const record = await this.readAndVerifyRecord(source);
        await this.withWriteLease(`webhook-replay:${record.provider}`, () => processRecord(record));
        await ensureSafeDirectory(this.root, this.replayedDirectory);
        const destination = path.join(this.replayedDirectory, file);
        try { await access(destination); throw new WriteFreezeError("Colisão no replay.", "WRITE_FREEZE_CORRUPT"); }
        catch (error: any) { if (error?.code !== "ENOENT") throw error; }
        await rename(source, destination);
        await Promise.all([syncDirectory(this.pendingDirectory), syncDirectory(this.replayedDirectory)]);
        replayed += 1;
      }
      return replayed;
    });
  }
}

function defaultRoot(): string {
  const explicit = process.env.MEGADESK_WRITE_FREEZE_ROOT?.trim();
  if (explicit) return path.resolve(explicit);
  const media = process.env.MEGADESK_MEDIA_ROOT?.trim();
  if (media) return path.join(path.resolve(media), ".write-freeze");
  if (process.env.NODE_ENV === "test") return path.join(tmpdir(), `megadesk-write-freeze-vitest-${process.pid}`);
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) return path.join(path.resolve(localAppData), "MegaDesk", "write-freeze");
  return path.join(process.cwd(), ".megadesk-write-freeze");
}

let singleton: WriteFreezeCoordinator | null = null;
export function getWriteFreezeCoordinator(): WriteFreezeCoordinator {
  return singleton ??= new WriteFreezeCoordinator({ root: defaultRoot() });
}
export function setWriteFreezeCoordinatorForTests(coordinator: WriteFreezeCoordinator | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Test override indisponível fora de testes.");
  singleton = coordinator;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}
function isSpecialAllowedPath(req: Request): boolean {
  return req.path === "/api/client-error"
    || matchesRoute(req.path, "/api/internal/write-freeze")
    || matchesRoute(req.path, "/api/ws/whatsapp")
    || matchesRoute(req.path, "/api/webhooks/meta")
    || matchesRoute(req.path, "/webhook/evolution")
    || matchesRoute(req.path, "/api/trpc");
}

export function createWriteFreezeHttpMiddleware(coordinator = getWriteFreezeCoordinator()): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const specialWriteGet = req.method === "GET" && req.path === "/api/oauth/callback";
    if ((!specialWriteGet && SAFE_METHODS.has(req.method)) || isSpecialAllowedPath(req)) return next();
    void coordinator.beginWrite(`http:${req.method}:${req.path}`).then(release => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        void release().catch(() => console.error("[Write Freeze] Falha ao liberar lease HTTP; freeze permanecerá fail-closed."));
      };
      res.once("finish", finish);
      res.once("close", finish);
      next();
    }).catch(error => {
      const code = error instanceof WriteFreezeError ? error.code : "WRITE_FREEZE_ACTIVE";
      res.status(503).json({ error: code });
    });
  };
}

export type PreparedWebhook = Omit<WebhookSpoolInput, "payload" | "receivedAt">;

export function createFreezeAwareWebhookHandler(
  prepare: (req: Request) => Promise<PreparedWebhook>,
  normalHandler: (req: Request, res: Response) => Promise<void>,
  coordinator = getWriteFreezeCoordinator(),
): RequestHandler {
  return (req, res) => {
    void coordinator.beginWrite(`webhook:${req.path}`).then(async release => {
      try { await normalHandler(req, res); }
      finally { await release(); }
    }).catch(async error => {
      if (!(error instanceof WriteFreezeError)) {
        res.status(503).json({ error: "WEBHOOK_UNAVAILABLE" });
        return;
      }
      try {
        const prepared = await prepare(req);
        const result = await coordinator.spoolWebhook({ ...prepared, payload: req.body });
        res.status(202).json({ status: "spooled", idempotencyKey: result.record.idempotencyKey, duplicate: result.duplicate });
      } catch (spoolError) {
        const status = spoolError instanceof WriteFreezeError && spoolError.code === "INVALID_WEBHOOK" ? 400 : 503;
        res.status(status).json({ error: spoolError instanceof WriteFreezeError ? spoolError.code : "WEBHOOK_SPOOL_FAILED" });
      }
    });
  };
}

function tokenMatches(received: unknown, expected: string): boolean {
  if (typeof received !== "string") return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isLoopback(req: Request): boolean {
  const address = req.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function registerWriteFreezeControlRoutes(app: Express, coordinator = getWriteFreezeCoordinator()): void {
  const authorize = (req: Request, res: Response): boolean => {
    const token = process.env.MEGADESK_WRITE_FREEZE_CONTROL_TOKEN?.trim();
    if (!token || token.length < 32 || !isLoopback(req) || !tokenMatches(req.headers["x-megadesk-freeze-token"], token)) {
      res.status(404).end();
      return false;
    }
    return true;
  };
  app.get("/api/internal/write-freeze/status", async (req, res) => {
    if (!authorize(req, res)) return;
    res.json(await coordinator.status());
  });
  app.post("/api/internal/write-freeze/activate", async (req, res) => {
    if (!authorize(req, res)) return;
    try { await coordinator.activate(String(req.body?.reason ?? "authorized-cutover")); res.json(await coordinator.status()); }
    catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "activation failed" }); }
  });
  app.post("/api/internal/write-freeze/unfreeze", async (req, res) => {
    if (!authorize(req, res)) return;
    try { await coordinator.unfreeze(String(req.body?.reason ?? "authorized-abort")); res.json(await coordinator.status()); }
    catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "unfreeze failed" }); }
  });
}
