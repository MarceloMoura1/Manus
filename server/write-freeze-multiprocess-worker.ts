import { WriteFreezeCoordinator } from "./write-freeze";
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";

const root = process.argv[2];
if (!root) throw new Error("write-freeze root is required");

let crashAfterSpoolPersist = false;
let crashBeforeSpoolCommit = false;
const coordinator = new WriteFreezeCoordinator({
  root,
  beforeSpoolCommit: () => {
    if (!crashBeforeSpoolCommit) return;
    process.send?.({ event: "spool-before-commit" });
    process.exit(90);
  },
  afterSpoolPersist: record => {
    if (!crashAfterSpoolPersist) return;
    process.send?.({ event: "spool-persisted", idempotencyKey: record.idempotencyKey });
    process.exit(91);
  },
});
let releaseWriter: (() => Promise<void>) | null = null;

type Command = {
  id: number;
  type: "status" | "begin" | "release" | "activate" | "unfreeze" | "spool" | "spool-crash" | "spool-crash-during-persist" | "replay-crash" | "replay-idempotent";
  timeoutMs?: number;
  providerEventId?: string;
  tenantId?: string;
  integrationId?: string;
};

process.on("message", (command: Command) => {
  void (async () => {
    try {
      let result: unknown;
      if (command.type === "status") result = await coordinator.status();
      if (command.type === "begin") {
        releaseWriter = await coordinator.beginWrite(`physical-worker:${process.pid}`);
        result = { admitted: true };
      }
      if (command.type === "release") {
        await releaseWriter?.();
        releaseWriter = null;
        result = { released: true };
      }
      if (command.type === "activate") {
        await coordinator.activate(`physical-worker:${process.pid}`, command.timeoutMs ?? 5_000);
        result = { activated: true };
      }
      if (command.type === "unfreeze") {
        await coordinator.unfreeze(`physical-worker:${process.pid}`);
        result = { unfrozen: true };
      }
      if (command.type === "spool" || command.type === "spool-crash" || command.type === "spool-crash-during-persist") {
        crashAfterSpoolPersist = command.type === "spool-crash";
        crashBeforeSpoolCommit = command.type === "spool-crash-during-persist";
        const spooled = await coordinator.spoolWebhook({
          provider: "evolution",
          event: "MESSAGES_UPSERT",
          providerEventId: command.providerEventId ?? "physical-event",
          bindings: [{ tenantId: command.tenantId ?? "tenant-physical", integrationId: command.integrationId ?? "integration-physical" }],
          payload: { event: "MESSAGES_UPSERT", data: { id: command.providerEventId ?? "physical-event" } },
        });
        result = { duplicate: spooled.duplicate, idempotencyKey: spooled.record.idempotencyKey };
      }
      if (command.type === "replay-crash" || command.type === "replay-idempotent") {
        const domainDirectory = path.join(root, "physical-domain");
        await mkdir(domainDirectory, { recursive: true });
        const replayed = await coordinator.replayWebhookSpool(async record => {
          const marker = path.join(domainDirectory, `${record.idempotencyKey}.json`);
          try {
            const handle = await open(marker, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
            try {
              await handle.writeFile(JSON.stringify({ idempotencyKey: record.idempotencyKey }), "utf8");
              await handle.sync();
            } finally { await handle.close(); }
          } catch (error: any) {
            if (error?.code !== "EEXIST") throw error;
          }
          if (command.type === "replay-crash") {
            process.send?.({ event: "replay-domain-committed", idempotencyKey: record.idempotencyKey });
            process.exit(92);
          }
        });
        result = { replayed };
      }
      process.send?.({ id: command.id, ok: true, result });
    } catch (error) {
      process.send?.({ id: command.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
});

process.send?.({ ready: true, pid: process.pid });
