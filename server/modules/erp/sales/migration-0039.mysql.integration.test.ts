import { afterAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import mysql, { type RowDataPacket } from "mysql2/promise";
import {
  applyCanonicalMigrations,
  MAIN_MIGRATIONS_DIR,
} from "../../../_core/canonical-migrations";
import {
  getTestDatabaseUrl,
  isTestDatabaseEnabled,
} from "../../../test-integration-gates";

const physical = describe.runIf(isTestDatabaseEnabled());
const execFileAsync = promisify(execFile);
let rehearsalRoot = "";

physical.sequential("main migration 0039 physical upgrade", () => {
  afterAll(async () => {
    if (rehearsalRoot) await rm(rehearsalRoot, { recursive: true, force: true });
  });

  it("applies canonical 0039 over a disposable schema at 0038", async () => {
    const databaseUrl = getTestDatabaseUrl();
    const pool = mysql.createPool(databaseUrl);
    try {
      const [tablesBefore] = await pool.execute<RowDataPacket[]>(
        "SELECT COUNT(*) total FROM information_schema.tables WHERE table_schema=DATABASE()"
      );
      expect(Number(tablesBefore[0].total)).toBe(0);

      const rehearsalParent = resolve(process.cwd(), "tmp/migration-rehearsals");
      await mkdir(rehearsalParent, { recursive: true });
      rehearsalRoot = await mkdtemp(join(rehearsalParent, "main-0038-"));
      const rehearsalMigrations = join(rehearsalRoot, "drizzle/main-migrations");
      const rehearsalMeta = join(rehearsalMigrations, "meta");
      await mkdir(rehearsalMeta, { recursive: true });
      await mkdir(join(rehearsalRoot, "scripts"), { recursive: true });
      await mkdir(join(rehearsalRoot, "server/_core"), { recursive: true });

      const journalPath = join(MAIN_MIGRATIONS_DIR, "meta", "_journal.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
        entries: Array<{ tag: string }>;
      };
      const entriesThrough0038 = journal.entries.filter(entry =>
        Number(entry.tag.slice(0, 4)) <= 38
      );
      expect(entriesThrough0038.at(-1)?.tag).toBe("0038_quick_lenny_balinger");

      for (const entry of entriesThrough0038) {
        await cp(
          join(MAIN_MIGRATIONS_DIR, `${entry.tag}.sql`),
          join(rehearsalMigrations, `${entry.tag}.sql`)
        );
        const snapshot = `${entry.tag.slice(0, 4)}_snapshot.json`;
        await cp(join(MAIN_MIGRATIONS_DIR, "meta", snapshot), join(rehearsalMeta, snapshot));
      }
      await writeFile(
        join(rehearsalMeta, basename(journalPath)),
        `${JSON.stringify({ ...journal, entries: entriesThrough0038 }, null, 2)}\n`,
        "utf8"
      );

      for (const relativePath of [
        "drizzle.config.ts",
        "drizzle.main.config.ts",
        "scripts/canonical-migrations.ts",
        "server/_core/canonical-migrations.ts",
      ]) {
        await cp(resolve(process.cwd(), relativePath), join(rehearsalRoot, relativePath));
      }

      const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
      const migrationCli = join(rehearsalRoot, "scripts/canonical-migrations.ts");
      await execFileAsync(
        process.execPath,
        ["--import", "tsx", migrationCli, "apply-main"],
        {
          cwd: rehearsalRoot,
          env: {
            ...process.env,
            ALLOW_MAIN_MIGRATION: "1",
            MEGADESK_DISPOSABLE_MIGRATION: "1",
            MEGADESK_DISPOSABLE_MIGRATION_TARGET_URL: databaseUrl,
            MEGADESK_MIGRATION_EXPECTED_DATABASE: databaseName,
          },
          timeout: 80_000,
          windowsHide: true,
        }
      );
      const [before0039] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) total FROM information_schema.columns
         WHERE table_schema=DATABASE() AND table_name='erp_sale_orders' AND column_name='document_type'`
      );
      expect(Number(before0039[0].total)).toBe(0);
      const [migrationCountBefore] = await pool.execute<RowDataPacket[]>(
        "SELECT COUNT(*) total FROM `__drizzle_migrations`"
      );
      expect(Number(migrationCountBefore[0].total)).toBe(entriesThrough0038.length);

      await applyCanonicalMigrations(databaseUrl, MAIN_MIGRATIONS_DIR);
      const [columns] = await pool.execute<RowDataPacket[]>(
        `SELECT column_name columnName FROM information_schema.columns
         WHERE table_schema=DATABASE() AND table_name='erp_sale_orders'
           AND column_name IN ('document_type','commercial_status','commercial_date','seller_user_id','charges_cents','archived_at')`
      );
      expect(columns.map(row => String(row.columnName)).sort()).toEqual([
        "archived_at",
        "charges_cents",
        "commercial_date",
        "commercial_status",
        "document_type",
        "seller_user_id",
      ]);
      const [sequenceTable] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) total FROM information_schema.tables
         WHERE table_schema=DATABASE() AND table_name='erp_sale_document_sequences'`
      );
      expect(Number(sequenceTable[0].total)).toBe(1);
      const [migrationCountAfter] = await pool.execute<RowDataPacket[]>(
        "SELECT COUNT(*) total FROM `__drizzle_migrations`"
      );
      expect(Number(migrationCountAfter[0].total)).toBe(journal.entries.length);
    } finally {
      await pool.end();
    }
  }, 90_000);
});
