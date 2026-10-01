import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFreezeAwareWebhookHandler,
  createWriteFreezeHttpMiddleware,
  setWriteFreezeCoordinatorForTests,
  WriteFreezeCoordinator,
  WriteFreezeError,
} from "./write-freeze";
import { publicProcedure, router } from "./_core/trpc";

const roots: string[] = [];

async function coordinator(options: Partial<ConstructorParameters<typeof WriteFreezeCoordinator>[0]> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "megadesk-write-freeze-test-"));
  roots.push(root);
  return new WriteFreezeCoordinator({ root, ...options });
}

const webhook = (tenantId = "tenant-a", providerEventId = "provider-1") => ({
  provider: "evolution" as const,
  event: "MESSAGES_UPSERT",
  providerEventId,
  bindings: [{ tenantId, integrationId: `integration-${tenantId}` }],
  payload: { event: "MESSAGES_UPSERT", data: { id: providerEventId } },
});

afterEach(async () => {
  setWriteFreezeCoordinatorForTests(null);
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("write freeze causal boundary", () => {
  it("blocks a mutation during freeze while allowing a query", async () => {
    const freeze = await coordinator();
    setWriteFreezeCoordinatorForTests(freeze);
    let writes = 0;
    const testRouter = router({
      read: publicProcedure.query(() => "ok"),
      write: publicProcedure.mutation(() => ++writes),
    });
    const caller = testRouter.createCaller({ user: null, req: {} as never, res: {} as never });
    await freeze.activate("test");

    await expect(caller.read()).resolves.toBe("ok");
    await expect(caller.write()).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(writes).toBe(0);
  });

  it("drains a writer admitted before freeze and denies every later writer", async () => {
    const freeze = await coordinator();
    const release = await freeze.beginWrite("before");
    let activated = false;
    const activation = freeze.activate("boundary").then(() => { activated = true; });
    await new Promise(resolve => setTimeout(resolve, 10));

    await expect(freeze.beginWrite("after")).rejects.toBeInstanceOf(WriteFreezeError);
    expect(activated).toBe(false);
    release();
    await activation;
    expect((await freeze.status()).activeWriters).toBe(0);
  });

  it("has a deterministic concurrent boundary", async () => {
    const freeze = await coordinator();
    const admitted = await Promise.all(Array.from({ length: 12 }, (_, index) => freeze.beginWrite(`writer-${index}`)));
    const activation = freeze.activate("concurrent");
    await new Promise(resolve => setTimeout(resolve, 10));
    const denied = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => freeze.beginWrite(`late-${index}`)));
    expect(denied.every(result => result.status === "rejected")).toBe(true);
    admitted.forEach(release => release());
    await activation;
    expect(await freeze.status()).toMatchObject({ mode: "active", activeWriters: 0, inFlightWrites: 0 });
  });

  it("holds a single boundary under hundreds of contending writers", async () => {
    const freeze = await coordinator();
    const admitted = await Promise.all(Array.from({ length: 200 }, (_, index) => freeze.beginWrite(`burst-${index}`)));
    const activation = freeze.activate("high-contention", 10_000);
    await new Promise(resolve => setTimeout(resolve, 25));
    const denied = await Promise.allSettled(Array.from({ length: 200 }, (_, index) => freeze.beginWrite(`post-boundary-${index}`)));
    expect(denied).toHaveLength(200);
    expect(denied.every(result => result.status === "rejected")).toBe(true);
    expect(await freeze.status()).toMatchObject({ mode: "draining", activeWriters: 200, inFlightWrites: 200 });
    await Promise.all(admitted.map(release => release()));
    await activation;
    expect(await freeze.status()).toMatchObject({ mode: "active", activeWriters: 0, inFlightWrites: 0 });
  }, 30_000);

  it("serializes concurrent lease release against activation scans", async () => {
    for (let round = 0; round < 10; round++) {
      const freeze = await coordinator();
      const leases = await Promise.all(Array.from({ length: 40 }, (_, index) => freeze.beginWrite(`release-race-${round}-${index}`)));
      const activation = freeze.activate(`release-race-${round}`, 10_000);
      await Promise.all(leases.map((release, index) => new Promise<void>((resolve, reject) => {
        setTimeout(() => { void release().then(resolve, reject); }, index % 5);
      })));
      await expect(activation).resolves.toBeUndefined();
      expect(await freeze.status()).toMatchObject({ mode: "active", activeWriters: 0, inFlightWrites: 0 });
    }
  }, 30_000);

  it("supports unfreeze and abort during drain without losing the spool", async () => {
    const freeze = await coordinator();
    await freeze.activate("freeze");
    await freeze.spoolWebhook(webhook());
    await freeze.unfreeze("abort");
    const release = await freeze.beginWrite("restored");
    release();
    expect((await freeze.status()).webhooksSpooled).toBe(1);

    const held = await freeze.beginWrite("held");
    const activation = freeze.activate("will-abort");
    await new Promise(resolve => setTimeout(resolve, 10));
    await freeze.unfreeze("abort-drain");
    held();
    await expect(activation).rejects.toThrow("abortada");
    expect((await freeze.status()).mode).toBe("unfrozen");
  });
});
describe("durable webhook quarantine", () => {
  it("persists before returning and deduplicates sequential and concurrent deliveries", async () => {
    const freeze = await coordinator();
    await freeze.activate("webhooks");
    const first = await freeze.spoolWebhook(webhook());
    const duplicate = await freeze.spoolWebhook(webhook());
    const sameProviderIdentity = await freeze.spoolWebhook({ ...webhook(), payload: { event: "MESSAGES_UPSERT", data: { id: "provider-1", redelivered: true } } });
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => freeze.spoolWebhook(webhook())));

    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(sameProviderIdentity.duplicate).toBe(true);
    expect(concurrent.every(result => result.record.idempotencyKey === first.record.idempotencyKey)).toBe(true);
    expect((await freeze.status()).webhooksSpooled).toBe(1);
    const files = await readdir(path.join((freeze as any).options.root, "webhooks", "pending"));
    const persisted = JSON.parse(await readFile(path.join((freeze as any).options.root, "webhooks", "pending", files[0]), "utf8"));
    expect(persisted.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects invalid bindings, oversized payloads and bounded-storage overflow", async () => {
    const invalid = await coordinator();
    await invalid.activate("invalid");
    await expect(invalid.spoolWebhook({ ...webhook(), bindings: [] })).rejects.toMatchObject({ code: "INVALID_WEBHOOK" });

    const oversized = await coordinator({ maxWebhookBytes: 32 });
    await oversized.activate("oversized");
    await expect(oversized.spoolWebhook({ ...webhook(), payload: { value: "x".repeat(100) } })).rejects.toMatchObject({ code: "INVALID_WEBHOOK" });

    const bounded = await coordinator({ maxSpoolEvents: 1 });
    await bounded.activate("bounded");
    await bounded.spoolWebhook(webhook("tenant-a", "one"));
    await expect(bounded.spoolWebhook(webhook("tenant-a", "two"))).rejects.toMatchObject({ code: "WEBHOOK_SPOOL_FULL" });
  });

  it("keeps tenant binding in the identity and prevents cross-tenant collapse", async () => {
    const freeze = await coordinator();
    await freeze.activate("tenant-bound");
    const a = await freeze.spoolWebhook(webhook("tenant-a", "same-provider-id"));
    const b = await freeze.spoolWebhook(webhook("tenant-b", "same-provider-id"));
    expect(a.record.idempotencyKey).not.toBe(b.record.idempotencyKey);
    expect((await freeze.status()).webhooksSpooled).toBe(2);
  });

  it("replays explicitly, in sequence, once per durable logical record", async () => {
    const freeze = await coordinator();
    await freeze.activate("replay");
    await freeze.spoolWebhook(webhook("tenant-a", "one"));
    await freeze.spoolWebhook(webhook("tenant-a", "two"));
    await freeze.unfreeze("promoted");
    const replayed: string[] = [];
    expect(await freeze.replayWebhookSpool(async record => { replayed.push(record.providerEventId!); })).toBe(2);
    expect(replayed).toEqual(["one", "two"]);
    expect(await freeze.replayWebhookSpool(async () => { throw new Error("must not run"); })).toBe(0);
  });

  it("survives restart in fail-closed mode", async () => {
    const freeze = await coordinator();
    const root = (freeze as any).options.root as string;
    await freeze.activate("restart");
    await freeze.spoolWebhook(webhook());
    const restarted = new WriteFreezeCoordinator({ root });
    await expect(restarted.beginWrite("after-restart")).rejects.toMatchObject({ code: "WRITE_FREEZE_ACTIVE" });
    expect(await restarted.status()).toMatchObject({ mode: "active", webhooksSpooled: 1 });
  });

  it("fails closed when durable state integrity is corrupted", async () => {
    const freeze = await coordinator();
    const root = (freeze as any).options.root as string;
    await freeze.activate("corrupt-test");
    await writeFile(path.join(root, "state.json"), "{\"mode\":\"unfrozen\"}\n");
    const restarted = new WriteFreezeCoordinator({ root });
    await expect(restarted.beginWrite("must-deny")).rejects.toMatchObject({ code: "WRITE_FREEZE_CORRUPT" });
  });

  it("is crash-consistent between durable persist and provider ACK", async () => {
    let crash = true;
    const freeze = await coordinator({ afterSpoolPersist: () => { if (crash) throw new Error("simulated crash before ACK"); } });
    const root = (freeze as any).options.root as string;
    await freeze.activate("crash");
    await expect(freeze.spoolWebhook(webhook())).rejects.toThrow("simulated crash");
    crash = false;
    const restarted = new WriteFreezeCoordinator({ root });
    const retry = await restarted.spoolWebhook(webhook());
    expect(retry.duplicate).toBe(true);
    expect((await restarted.status()).webhooksSpooled).toBe(1);
  });
});
describe("HTTP alternate-path enforcement", () => {
  async function listen(app: express.Express): Promise<{ server: Server; base: string }> {
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    return { server, base: `http://127.0.0.1:${address.port}` };
  }

  it("keeps health/read paths available and blocks unsafe REST plus the write-capable OAuth GET", async () => {
    const freeze = await coordinator();
    const app = express();
    app.use(express.json());
    app.use(createWriteFreezeHttpMiddleware(freeze));
    let writes = 0;
    app.get("/healthz", (_req, res) => res.json({ ok: true }));
    app.get("/read", (_req, res) => res.json({ value: "stable" }));
    app.post("/alternate", (_req, res) => { writes += 1; res.json({ ok: true }); });
    app.get("/api/oauth/callback", (_req, res) => { writes += 1; res.end(); });
    const { server, base } = await listen(app);
    try {
      await freeze.activate("http");
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
      expect((await fetch(`${base}/read`)).status).toBe(200);
      expect((await fetch(`${base}/alternate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(503);
      expect((await fetch(`${base}/api/oauth/callback`)).status).toBe(503);
      expect(writes).toBe(0);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it("ACKs a frozen webhook only after a durable spool record exists", async () => {
    let persistedAtAck = false;
    const freeze = await coordinator({ afterSpoolPersist: () => { persistedAtAck = true; } });
    const app = express();
    app.use(express.json());
    app.post("/webhook/evolution", createFreezeAwareWebhookHandler(
      async () => ({ provider: "evolution", event: "MESSAGES_UPSERT", providerEventId: "http-1", bindings: [{ tenantId: "tenant-a", integrationId: "instance-a" }] }),
      async (_req, res) => { res.json({ status: "processed" }); },
      freeze,
    ));
    const { server, base } = await listen(app);
    try {
      await freeze.activate("webhook-http");
      const response = await fetch(`${base}/webhook/evolution`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: { id: "http-1" } }) });
      expect(response.status).toBe(202);
      expect(persistedAtAck).toBe(true);
      expect((await freeze.status()).webhooksSpooled).toBe(1);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
