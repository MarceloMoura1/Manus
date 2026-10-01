import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type WorkerCommandOptions = {
  timeoutMs?: number;
  commandTimeoutMs?: number;
  providerEventId?: string;
  tenantId?: string;
  integrationId?: string;
};
type Worker = { child: ChildProcess; command(type: string, options?: WorkerCommandOptions): Promise<any> };
const roots: string[] = [];
const children: ChildProcess[] = [];
let commandId = 0;
const WORKER_READY_TIMEOUT_MS = 5_000;
const ACTIVATION_TIMEOUT_MS = 5_000;
const INCOMPLETE_LOCK_STALE_MS = 10_000;
const SCHEDULER_FILESYSTEM_MARGIN_MS = 4_000;
const DRAINING_POLL_INTERVAL_MS = 20;
const DRAINING_OBSERVATION_BUDGET_MS = ACTIVATION_TIMEOUT_MS + SCHEDULER_FILESYSTEM_MARGIN_MS;
const DRAINING_CRASH_TEST_TIMEOUT_MS = (3 * WORKER_READY_TIMEOUT_MS)
  + (2 * ACTIVATION_TIMEOUT_MS)
  + INCOMPLETE_LOCK_STALE_MS
  + DRAINING_OBSERVATION_BUDGET_MS
  + SCHEDULER_FILESYSTEM_MARGIN_MS;
const LOCK_RECOVERY_COMMAND_TIMEOUT_MS = INCOMPLETE_LOCK_STALE_MS + SCHEDULER_FILESYSTEM_MARGIN_MS;
const CHILD_EXIT_TIMEOUT_MS = 5_000;

async function spawnWorker(root: string): Promise<Worker> {
  const child = fork(fileURLToPath(new URL("./write-freeze-multiprocess-worker.ts", import.meta.url)), [root], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("worker start timeout")), WORKER_READY_TIMEOUT_MS);
    child.once("message", message => {
      clearTimeout(timer);
      if ((message as any)?.ready) resolve(); else reject(new Error("worker did not become ready"));
    });
    child.once("exit", code => reject(new Error(`worker exited during start: ${code}`)));
  });
  return {
    child,
    command(type: string, options: WorkerCommandOptions = {}) {
      const id = ++commandId;
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          child.off("message", listener);
          child.off("exit", exitListener);
        };
        const timer = setTimeout(
          () => { cleanup(); reject(new Error(`worker command timeout: ${type}`)); },
          options.commandTimeoutMs ?? 10_000,
        );
        const listener = (message: any) => {
          if (message?.id !== id) return;
          cleanup();
          message.ok ? resolve(message.result) : reject(new Error(message.error));
        };
        const exitListener = (code: number | null) => { cleanup(); reject(new Error(`worker exited during ${type}: ${code}`)); };
        child.on("message", listener);
        child.once("exit", exitListener);
        child.send({ id, type, ...options });
      });
    },
  };
}

async function terminateAndReap(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
    };
    const onExit = () => { cleanup(); resolve(); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`worker cleanup timeout: ${child.pid ?? "unknown"}`));
    }, CHILD_EXIT_TIMEOUT_MS);
    child.once("exit", onExit);
    if (!child.kill("SIGKILL") && (child.exitCode !== null || child.signalCode !== null)) {
      cleanup();
      resolve();
    }
  });
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(terminateAndReap));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("write freeze physical multi-process coordination", () => {
  it("does not activate until a writer in another Node process drains", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "megadesk-freeze-multiprocess-"));
    roots.push(root);
    const writer = await spawnWorker(root);
    const freezer = await spawnWorker(root);
    await writer.command("begin");

    let settled = false;
    const activation = freezer.command("activate", { timeoutMs: 5_000 }).then(result => { settled = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(settled).toBe(false);

    await writer.command("release");
    await expect(activation).resolves.toEqual({ activated: true });
    await expect(writer.command("begin")).rejects.toThrow("write freeze ativo");
    expect(await writer.command("status")).toMatchObject({ mode: "active", activeWriters: 0 });
  });

  it("remains fail-closed in another process after the activating process is killed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "megadesk-freeze-restart-"));
    roots.push(root);
    const activating = await spawnWorker(root);
    await activating.command("activate");
    activating.child.kill("SIGKILL");
    await new Promise(resolve => activating.child.once("exit", resolve));

    const restarted = await spawnWorker(root);
    expect(await restarted.command("status")).toMatchObject({ mode: "active" });
    await expect(restarted.command("begin")).rejects.toThrow("write freeze ativo");
  });

  it("persists DRAINING across freezer crash and completes after the remote writer releases", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "megadesk-freeze-draining-crash-"));
    roots.push(root);
    const writer = await spawnWorker(root);
    const freezer = await spawnWorker(root);
    const observer = await spawnWorker(root);
    await writer.command("begin");
    const activation = freezer.command("activate", { timeoutMs: ACTIVATION_TIMEOUT_MS }).catch(() => undefined);
    const observationDeadline = Date.now() + DRAINING_OBSERVATION_BUDGET_MS;
    let drainingObserved = false;
    while (Date.now() < observationDeadline) {
      if ((await observer.command("status")).mode === "draining") {
        drainingObserved = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, DRAINING_POLL_INTERVAL_MS));
    }
    expect(drainingObserved).toBe(true);
    expect(await observer.command("status")).toMatchObject({ mode: "draining", activeWriters: 1 });
    freezer.child.kill("SIGKILL");
    await new Promise(resolve => freezer.child.once("exit", resolve));
    await activation;
    await expect(observer.command("begin", { commandTimeoutMs: LOCK_RECOVERY_COMMAND_TIMEOUT_MS })).rejects.toThrow("write freeze ativo");
    await writer.command("release");
    await observer.command("activate", { timeoutMs: ACTIVATION_TIMEOUT_MS });
    expect(await observer.command("status")).toMatchObject({ mode: "active", activeWriters: 0 });
  // Three sequential readiness windows + two activation windows + the 10 s
  // incomplete-lock stale bound + polling + 4 s of scheduler/filesystem margin.
  }, DRAINING_CRASH_TEST_TIMEOUT_MS);

  it("reclaims only a proven-dead writer lease while activating", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "megadesk-freeze-writer-crash-"));
    roots.push(root);
    const writer = await spawnWorker(root);
    await writer.command("begin");
    writer.child.kill("SIGKILL");
    await new Promise(resolve => writer.child.once("exit", resolve));
    const freezer = await spawnWorker(root);
    await expect(freezer.command("activate", { timeoutMs: 5_000 })).resolves.toEqual({ activated: true });
    expect(await freezer.command("status")).toMatchObject({ mode: "active", activeWriters: 0 });
  });

  it("deduplicates concurrent physical spooling across processes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "megadesk-freeze-spool-concurrent-"));
    roots.push(root);
    const first = await spawnWorker(root);
    const second = await spawnWorker(root);
    await first.command("activate");
    const results = await Promise.all([first.command("spool"), second.command("spool")]);
    expect(results.map(result => result.duplicate).sort()).toEqual([false, true]);
    expect(results[0].idempotencyKey).toBe(results[1].idempotencyKey);
    expect(await second.command("status")).toMatchObject({ webhooksSpooled: 1 });
  });

  it("recovers the durable event after a physical crash before ACK", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "megadesk-freeze-spool-crash-"));
    roots.push(root);
    const crashing = await spawnWorker(root);
    await crashing.command("activate");
    const persisted = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("spool persist signal timeout")), 5_000);
      crashing.child.on("message", message => {
        if ((message as any)?.event !== "spool-persisted") return;
        clearTimeout(timer);
        resolve(message);
      });
    });
    crashing.child.send({ id: ++commandId, type: "spool-crash", providerEventId: "crash-before-ack" });
    const signal = await persisted;
    await new Promise(resolve => crashing.child.once("exit", resolve));

    const restarted = await spawnWorker(root);
    const redelivery = await restarted.command("spool", { providerEventId: "crash-before-ack" });
    expect(redelivery).toEqual({ duplicate: true, idempotencyKey: signal.idempotencyKey });
    expect(await restarted.command("status")).toMatchObject({ mode: "active", webhooksSpooled: 1 });
  });

  it("does not expose a partial record when killed after fsync but before atomic rename", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "megadesk-freeze-spool-mid-commit-"));
    roots.push(root);
    const crashing = await spawnWorker(root);
    await crashing.command("activate");
    const interrupted = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("spool before-commit signal timeout")), 5_000);
      crashing.child.on("message", message => {
        if ((message as any)?.event !== "spool-before-commit") return;
        clearTimeout(timer);
        resolve();
      });
    });
    crashing.child.send({ id: ++commandId, type: "spool-crash-during-persist", providerEventId: "mid-commit" });
    await interrupted;
    await new Promise(resolve => crashing.child.once("exit", resolve));

    const restarted = await spawnWorker(root);
    expect(await restarted.command("status")).toMatchObject({ mode: "active", webhooksSpooled: 0 });
    const redelivery = await restarted.command("spool", { providerEventId: "mid-commit" });
    expect(redelivery.duplicate).toBe(false);
    expect(await restarted.command("status")).toMatchObject({ webhooksSpooled: 1 });
  });

  it("recovers a replay crash through a durable downstream idempotency identity", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "megadesk-freeze-replay-crash-"));
    roots.push(root);
    const first = await spawnWorker(root);
    await first.command("activate");
    const spooled = await first.command("spool", { providerEventId: "replay-crash" });
    await first.command("unfreeze");
    const committed = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("replay commit signal timeout")), 5_000);
      first.child.on("message", message => {
        if ((message as any)?.event !== "replay-domain-committed") return;
        clearTimeout(timer);
        resolve(message);
      });
    });
    first.child.send({ id: ++commandId, type: "replay-crash" });
    expect((await committed).idempotencyKey).toBe(spooled.idempotencyKey);
    await new Promise(resolve => first.child.once("exit", resolve));

    const restarted = await spawnWorker(root);
    await expect(restarted.command("replay-idempotent")).resolves.toEqual({ replayed: 1 });
    await expect(restarted.command("replay-idempotent")).resolves.toEqual({ replayed: 0 });
    expect(await readdir(path.join(root, "physical-domain"))).toHaveLength(1);
    expect(await readdir(path.join(root, "webhooks", "pending"))).toHaveLength(0);
    expect(await readdir(path.join(root, "webhooks", "replayed"))).toHaveLength(1);
  });
});
