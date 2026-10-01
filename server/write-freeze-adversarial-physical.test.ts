import { createServer, request as httpRequest, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createFreezeAwareWebhookHandler, WriteFreezeCoordinator } from "./write-freeze";

const roots: string[] = [];

async function fixture(options: Partial<ConstructorParameters<typeof WriteFreezeCoordinator>[0]> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "megadesk-freeze-adversarial-"));
  roots.push(root);
  return { root, freeze: new WriteFreezeCoordinator({ root, ...options }) };
}

function webhook(providerEventId: string, tenantId = "tenant-a", integrationId = "integration-a", payload: unknown = { ok: true }) {
  return {
    provider: "evolution" as const,
    event: "MESSAGES_UPSERT",
    providerEventId,
    bindings: [{ tenantId, integrationId }],
    payload,
  };
}

async function listen(app: express.Express): Promise<{ server: Server; base: string }> {
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>(resolve => server.close(() => resolve()));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("physical spool durability and deterministic bounds", () => {
  it("accepts exactly 1 MiB and rejects one byte more", async () => {
    const exact = await fixture();
    await exact.freeze.activate("exact-bound");
    const atLimit = "x".repeat(1024 * 1024 - 2);
    await expect(exact.freeze.spoolWebhook(webhook("exact", "tenant-a", "integration-a", atLimit))).resolves.toMatchObject({ duplicate: false });

    const over = await fixture();
    await over.freeze.activate("over-bound");
    const overLimit = "x".repeat(1024 * 1024 - 1);
    await expect(over.freeze.spoolWebhook(webhook("over", "tenant-a", "integration-a", overLimit))).rejects.toMatchObject({ code: "INVALID_WEBHOOK" });
  });

  it("enforces the physical 10,000-event cap without allocating payload data", async () => {
    const { root, freeze } = await fixture();
    await freeze.activate("event-cap");
    const pending = path.join(root, "webhooks", "pending");
    await mkdir(pending, { recursive: true });
    for (let offset = 0; offset < 10_000; offset += 250) {
      await Promise.all(Array.from({ length: 250 }, (_, index) => {
        const sequence = offset + index + 1;
        return writeFile(path.join(pending, `${String(sequence).padStart(16, "0")}-capacity-${sequence}.json`), "");
      }));
    }
    await expect(freeze.spoolWebhook(webhook("event-10001"))).rejects.toMatchObject({ code: "WEBHOOK_SPOOL_FULL" });
    expect((await freeze.status()).webhooksSpooled).toBe(10_000);
  }, 30_000);

  it("enforces the 1 GiB aggregate boundary using a sparse physical file", async () => {
    const { root, freeze } = await fixture();
    await freeze.activate("byte-cap");
    await freeze.status();
    const capacity = path.join(root, "webhooks", "pending", "0000000000000001-capacity.json");
    await writeFile(capacity, "");
    await truncate(capacity, 1024 * 1024 * 1024);
    await expect(freeze.spoolWebhook(webhook("beyond-aggregate"))).rejects.toMatchObject({ code: "WEBHOOK_SPOOL_FULL" });
    expect((await freeze.status()).webhookSpoolBytes).toBe(1024 * 1024 * 1024);
  });

  it("fails closed on truncated records, checksum substitution, and corrupt installation metadata", async () => {
    const truncated = await fixture();
    await truncated.freeze.activate("truncated");
    await truncated.freeze.spoolWebhook(webhook("truncated"));
    await truncated.freeze.unfreeze("replay");
    const [truncatedName] = await readdir(path.join(truncated.root, "webhooks", "pending"));
    await writeFile(path.join(truncated.root, "webhooks", "pending", truncatedName), "{\"version\":1");
    await expect(truncated.freeze.replayWebhookSpool(async () => undefined)).rejects.toBeInstanceOf(Error);

    const substituted = await fixture();
    await substituted.freeze.activate("substituted");
    await substituted.freeze.spoolWebhook(webhook("substituted"));
    await substituted.freeze.unfreeze("replay");
    const [substitutedName] = await readdir(path.join(substituted.root, "webhooks", "pending"));
    const substitutedFile = path.join(substituted.root, "webhooks", "pending", substitutedName);
    const record = JSON.parse(await readFile(substitutedFile, "utf8"));
    record.payload = { tampered: true };
    await writeFile(substitutedFile, JSON.stringify(record));
    await expect(substituted.freeze.replayWebhookSpool(async () => undefined)).rejects.toMatchObject({ code: "WRITE_FREEZE_CORRUPT" });

    const metadata = await fixture();
    await metadata.freeze.status();
    await writeFile(path.join(metadata.root, "installation.json"), "{\"version\":1}\n");
    const restarted = new WriteFreezeCoordinator({ root: metadata.root });
    await expect(restarted.beginWrite("must-fail-closed")).rejects.toMatchObject({ code: "WRITE_FREEZE_CORRUPT" });
  });

  it("ignores residual temporary files but fails closed when the pending directory is unavailable", async () => {
    const residual = await fixture();
    await residual.freeze.activate("residual");
    await residual.freeze.spoolWebhook(webhook("durable"));
    await writeFile(path.join(residual.root, "webhooks", "pending", "interrupted.tmp"), "partial");
    const restarted = new WriteFreezeCoordinator({ root: residual.root });
    expect(await restarted.status()).toMatchObject({ mode: "active", webhooksSpooled: 1 });

    const unavailable = await fixture();
    await unavailable.freeze.activate("unavailable");
    await unavailable.freeze.status();
    const pending = path.join(unavailable.root, "webhooks", "pending");
    const moved = path.join(unavailable.root, "webhooks", "pending-away");
    await rename(pending, moved);
    await writeFile(pending, "not-a-directory");
    await expect(unavailable.freeze.spoolWebhook(webhook("must-not-ack"))).rejects.toBeInstanceOf(Error);
  });
});

describe("spool binding, replay, and filesystem security", () => {
  it("separates equal identities across tenants and integrations", async () => {
    const { freeze } = await fixture();
    await freeze.activate("bindings");
    const a = await freeze.spoolWebhook(webhook("same", "tenant-a", "integration-a", { same: true }));
    const b = await freeze.spoolWebhook(webhook("same", "tenant-b", "integration-a", { same: true }));
    const c = await freeze.spoolWebhook(webhook("same", "tenant-a", "integration-b", { same: true }));
    expect(new Set([a.record.idempotencyKey, b.record.idempotencyKey, c.record.idempotencyKey]).size).toBe(3);
  });

  it("rejects traversal and malformed tenant/integration identifiers", async () => {
    const { freeze } = await fixture();
    await freeze.activate("identifier-security");
    for (const [tenantId, integrationId] of [["../tenant", "integration"], ["tenant", "..\\integration"], ["tenant/escape", "integration"], ["tenant", "bad\u0000id"], ["", "integration"]]) {
      await expect(freeze.spoolWebhook(webhook("invalid", tenantId, integrationId))).rejects.toMatchObject({ code: "INVALID_WEBHOOK" });
    }
  });

  it("rejects a junction/symlink escape for the pending spool", async () => {
    const { root, freeze } = await fixture();
    await freeze.status();
    const outside = await mkdtemp(path.join(tmpdir(), "megadesk-freeze-outside-"));
    roots.push(outside);
    const pending = path.join(root, "webhooks", "pending");
    await rm(pending, { recursive: true, force: true });
    await symlink(outside, pending, process.platform === "win32" ? "junction" : "dir");
    await freeze.activate("symlink-escape");
    await expect(freeze.spoolWebhook(webhook("escape"))).rejects.toMatchObject({ code: "WRITE_FREEZE_CORRUPT" });
    expect(await readdir(outside)).toHaveLength(0);
  });

  it("keeps failed and partial replay recoverable, ordered, and explicit-only", async () => {
    const { root, freeze } = await fixture();
    await freeze.activate("explicit-replay");
    for (const id of ["one", "two", "three"]) await freeze.spoolWebhook(webhook(id));
    await freeze.unfreeze("ready");
    expect((await freeze.status()).webhooksSpooled).toBe(3);
    const restarted = new WriteFreezeCoordinator({ root });
    expect((await restarted.status()).webhooksSpooled).toBe(3);

    const attempts: string[] = [];
    await expect(restarted.replayWebhookSpool(async record => {
      attempts.push(record.providerEventId!);
      if (record.providerEventId === "two") throw new Error("synthetic downstream failure");
    })).rejects.toThrow("synthetic downstream failure");
    expect(attempts).toEqual(["one", "two"]);
    expect((await restarted.status()).webhooksSpooled).toBe(2);

    const retry: string[] = [];
    expect(await restarted.replayWebhookSpool(async record => { retry.push(record.providerEventId!); })).toBe(2);
    expect(retry).toEqual(["two", "three"]);
    expect(await restarted.replayWebhookSpool(async () => { throw new Error("unexpected automatic duplicate"); })).toBe(0);
  });
});

describe("causal webhook failure and non-production stability", () => {
  it("never ACKs or performs a domain write when preparation, persistence, size, or JSON parsing fails", async () => {
    const variants = [
      { prepare: async () => { throw new Error("invalid binding proof"); }, options: {}, body: JSON.stringify({ ok: true }), expected: 503 },
      { prepare: async () => ({ provider: "evolution" as const, event: "MESSAGES_UPSERT", providerEventId: "oversized", bindings: [{ tenantId: "tenant", integrationId: "integration" }] }), options: { maxWebhookBytes: 8 }, body: JSON.stringify({ payload: "too-large" }), expected: 400 },
    ];
    for (const variant of variants) {
      const { freeze } = await fixture(variant.options);
      await freeze.activate("causal-failure");
      let domainWrites = 0;
      const app = express();
      app.use(express.json({ limit: "2mb" }));
      app.post("/hook", createFreezeAwareWebhookHandler(variant.prepare as any, async (_req, res) => { domainWrites += 1; res.sendStatus(200); }, freeze));
      const { server, base } = await listen(app);
      try {
        const response = await fetch(`${base}/hook`, { method: "POST", headers: { "content-type": "application/json" }, body: variant.body });
        expect(response.status).toBe(variant.expected);
        expect(domainWrites).toBe(0);
        expect((await freeze.status()).webhooksSpooled).toBe(0);
      } finally { await close(server); }
    }

    const malformed = await fixture();
    await malformed.freeze.activate("malformed-json");
    let malformedDomainWrites = 0;
    const app = express();
    app.use(express.json());
    app.post("/hook", createFreezeAwareWebhookHandler(async () => ({ provider: "evolution", event: "MESSAGES_UPSERT", providerEventId: "malformed", bindings: [{ tenantId: "tenant", integrationId: "integration" }] }), async (_req, res) => { malformedDomainWrites += 1; res.sendStatus(200); }, malformed.freeze));
    app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.sendStatus(400));
    const { server, base } = await listen(app);
    try {
      const response = await fetch(`${base}/hook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{invalid" });
      expect(response.status).toBe(400);
      expect(malformedDomainWrites).toBe(0);
      expect((await malformed.freeze.status()).webhooksSpooled).toBe(0);
    } finally { await close(server); }
  });

  it("rejects a chunked oversized request before ACK or domain processing", async () => {
    const { freeze } = await fixture({ maxWebhookBytes: 32 });
    await freeze.activate("chunked-oversized");
    let domainWrites = 0;
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.post("/hook", createFreezeAwareWebhookHandler(async () => ({ provider: "evolution", event: "MESSAGES_UPSERT", providerEventId: "chunked", bindings: [{ tenantId: "tenant", integrationId: "integration" }] }), async (_req, res) => { domainWrites += 1; res.sendStatus(200); }, freeze));
    const { server, base } = await listen(app);
    try {
      const url = new URL(`${base}/hook`);
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest({ hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: { "content-type": "application/json", "transfer-encoding": "chunked" } }, res => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        });
        req.on("error", reject);
        req.write('{"payload":"');
        req.write("x".repeat(100));
        req.end('"}');
      });
      expect(status).toBe(400);
      expect(domainWrites).toBe(0);
      expect((await freeze.status()).webhooksSpooled).toBe(0);
    } finally { await close(server); }
  });

  it("keeps representative business DB/storage fixtures stable while spool changes separately", async () => {
    const { root, freeze } = await fixture();
    const business = path.join(root, "representative-business-fixture");
    const db = path.join(business, "logical-db.json");
    const storage = path.join(business, "storage");
    await mkdir(storage, { recursive: true });
    await writeFile(db, JSON.stringify({ tenants: [{ id: "tenant-a", status: "active" }], tickets: [{ id: 1, status: "open" }], purchases: [{ id: 7, total: 12500 }] }));
    await writeFile(path.join(storage, "attachment-a.bin"), Buffer.from("representative-attachment"));
    const digest = async (file: string) => createHash("sha256").update(await readFile(file)).digest("hex");
    const manifest = async () => (await Promise.all((await readdir(storage)).sort().map(async name => `${name}:${await digest(path.join(storage, name))}`))).join("\n");
    const databaseA = await digest(db);
    const storageA = createHash("sha256").update(await manifest()).digest("hex");

    await freeze.activate("stability");
    const denied = await Promise.allSettled(Array.from({ length: 100 }, (_, index) => freeze.withWriteLease(`representative-write-${index}`, async () => {
      await writeFile(db, JSON.stringify({ corrupted: index }));
      await writeFile(path.join(storage, `forbidden-${index}.bin`), "forbidden");
    })));
    expect(denied.every(result => result.status === "rejected")).toBe(true);
    for (let index = 0; index < 20; index++) await freeze.spoolWebhook(webhook(`stability-${index}`));
    expect(JSON.parse(await readFile(db, "utf8")).tickets[0].status).toBe("open");
    expect(await readdir(storage)).toEqual(["attachment-a.bin"]);

    const databaseB = await digest(db);
    const storageB = createHash("sha256").update(await manifest()).digest("hex");
    expect(databaseB).toBe(databaseA);
    expect(storageB).toBe(storageA);
    expect((await freeze.status()).webhooksSpooled).toBe(20);

    await freeze.unfreeze("stability-abort");
    await freeze.withWriteLease("controlled-return", async () => writeFile(db, JSON.stringify({ restored: true })));
    expect(await digest(db)).not.toBe(databaseA);
    expect((await freeze.status()).webhooksSpooled).toBe(20);
  });
});
