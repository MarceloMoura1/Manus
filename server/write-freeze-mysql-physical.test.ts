import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WriteFreezeCoordinator } from "./write-freeze";

const enabled = process.env.MEGADESK_WRITE_FREEZE_MYSQL_PHYSICAL === "1";
const describePhysical = enabled ? describe : describe.skip;
const temporaryRoots: string[] = [];

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

describePhysical("disposable MySQL and business-storage stability rehearsal", () => {
  let connection: mysql.Connection;

  beforeAll(async () => {
    connection = await mysql.createConnection({
      host: "127.0.0.1",
      port: 43318,
      user: "freeze_test",
      password: "synthetic_user_freeze_20261001",
      database: "megadesk_test_write_freeze_adversarial",
      multipleStatements: false,
    });
  });

  afterAll(async () => {
    await connection?.end();
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  it("keeps the physical DB and storage stable while denying writes and isolating spool traffic", async () => {
    await connection.execute("CREATE TABLE business_records (id INT PRIMARY KEY, tenant_id VARCHAR(64) NOT NULL, kind VARCHAR(64) NOT NULL, amount_cents INT NOT NULL, payload_json JSON NOT NULL)");
    await connection.execute("INSERT INTO business_records (id, tenant_id, kind, amount_cents, payload_json) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)", [
      1, "tenant-a", "purchase", 12500, JSON.stringify({ supplier: "supplier-a", status: "approved" }),
      2, "tenant-a", "ticket", 0, JSON.stringify({ status: "open", priority: "high" }),
      3, "tenant-b", "stock", 4500, JSON.stringify({ sku: "SKU-1", quantity: 9 }),
    ]);

    const root = await mkdtemp(path.join(tmpdir(), "megadesk-freeze-mysql-physical-"));
    temporaryRoots.push(root);
    const freezeRoot = path.join(root, "freeze-control");
    const businessStorage = path.join(root, "business-storage");
    await mkdir(businessStorage, { recursive: true });
    await writeFile(path.join(businessStorage, "tenant-a-ticket-2.bin"), Buffer.from("representative-business-attachment"));
    await writeFile(path.join(businessStorage, "tenant-b-stock-3.json"), JSON.stringify({ sku: "SKU-1", count: 9 }));
    const freeze = new WriteFreezeCoordinator({ root: freezeRoot });

    const databaseFingerprint = async () => {
      const [rows] = await connection.query("SELECT id, tenant_id, kind, amount_cents, CAST(payload_json AS CHAR) AS payload_json FROM business_records ORDER BY id");
      return sha256(JSON.stringify(rows));
    };
    const storageManifest = async () => {
      const entries = await Promise.all((await readdir(businessStorage)).sort().map(async name => ({ name, sha256: sha256(await readFile(path.join(businessStorage, name))) })));
      return sha256(JSON.stringify(entries));
    };

    const databaseA = await databaseFingerprint();
    const storageA = await storageManifest();
    await freeze.activate("physical-disposable-stability");
    const denied = await Promise.allSettled(Array.from({ length: 100 }, (_, index) => freeze.withWriteLease(`mysql-write-${index}`, async () => {
      await connection.execute("INSERT INTO business_records (id, tenant_id, kind, amount_cents, payload_json) VALUES (?, ?, ?, ?, ?)", [1000 + index, "tenant-denied", "forbidden", index, JSON.stringify({ forbidden: true })]);
      await writeFile(path.join(businessStorage, `forbidden-${index}.bin`), "forbidden");
    })));
    expect(denied.every(result => result.status === "rejected")).toBe(true);
    for (let index = 0; index < 20; index++) {
      await freeze.spoolWebhook({
        provider: "evolution",
        event: "MESSAGES_UPSERT",
        providerEventId: `mysql-stability-${index}`,
        bindings: [{ tenantId: "tenant-a", integrationId: "integration-a" }],
        payload: { index, state: "quarantined" },
      });
    }
    const [health] = await connection.query("SELECT 1 AS ok");
    const [countRows] = await connection.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM business_records");
    expect(health).toBeTruthy();
    expect(Number(countRows[0].count)).toBe(3);
    await new Promise(resolve => setTimeout(resolve, 250));

    const databaseB = await databaseFingerprint();
    const storageB = await storageManifest();
    expect(databaseB).toBe(databaseA);
    expect(storageB).toBe(storageA);
    expect((await freeze.status()).webhooksSpooled).toBe(20);

    await freeze.unfreeze("physical-controlled-return");
    await freeze.withWriteLease("mysql-controlled-return", async () => {
      await connection.execute("INSERT INTO business_records (id, tenant_id, kind, amount_cents, payload_json) VALUES (?, ?, ?, ?, ?)", [4, "tenant-a", "post-freeze", 1, JSON.stringify({ restored: true })]);
    });
    expect(Number((await connection.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM business_records"))[0][0].count)).toBe(4);
    expect((await freeze.status()).webhooksSpooled).toBe(20);

    console.log(`DATABASE_FINGERPRINT_A=${databaseA}`);
    console.log(`DATABASE_FINGERPRINT_B=${databaseB}`);
    console.log(`STORAGE_MANIFEST_A=${storageA}`);
    console.log(`STORAGE_MANIFEST_B=${storageB}`);
    console.log("SPOOL_EVENTS_DURING_STABILITY_TEST=20");
  }, 30_000);
});
