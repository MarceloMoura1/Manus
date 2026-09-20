import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  MAIN_MIGRATIONS_DIR,
  TENANT_MIGRATIONS_DIR,
  validateCanonicalMigrationFolder,
  validateTenantDatabaseName,
} from "./_core/canonical-migrations";

function sql(folder: string): string {
  return readdirSync(folder)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => readFileSync(resolve(folder, file), "utf8"))
    .join("\n");
}

type AllowedIndexReplacement = {
  drop: string;
  replacement?: string;
};

const ALLOWED_INDEX_REPLACEMENTS: Record<string, readonly AllowedIndexReplacement[]> = {
  "0031_lonely_blockbuster.sql": [
    {
      drop: "ALTER TABLE `erp_purchase_order_items` DROP INDEX `uq_erp_purchase_items_order_product`",
      replacement: "ALTER TABLE `erp_purchase_order_items` ADD CONSTRAINT `uq_erp_purchase_items_order_identity` UNIQUE(`purchase_order_id`,`order_item_identity`)",
    },
    {
      drop: "ALTER TABLE `erp_sale_order_items` DROP INDEX `uq_erp_sale_items_order_product`",
      replacement: "ALTER TABLE `erp_sale_order_items` ADD CONSTRAINT `uq_erp_sale_items_order_identity` UNIQUE(`sale_order_id`,`order_item_identity`)",
    },
  ],
};

function normalizeSqlStatement(value: string): string {
  return value.trim().replace(/;$/, "").replace(/\s+/g, " ");
}

function assertCreationOnlyMigration(fileName: string, migrationSql: string): void {
  const normalizedMigration = normalizeSqlStatement(migrationSql);
  const allowedReplacements = ALLOWED_INDEX_REPLACEMENTS[fileName] ?? [];

  for (const statement of migrationSql.split("--> statement-breakpoint")) {
    const normalizedStatement = normalizeSqlStatement(statement);
    if (!normalizedStatement) continue;

    if (/^(?:DROP\s+(?:TABLE|DATABASE|SCHEMA)|TRUNCATE|DELETE|UPDATE|INSERT)\b/i.test(normalizedStatement)) {
      throw new Error(`Destructive statement is not allowed in ${fileName}: ${normalizedStatement}`);
    }

    if (/\bDROP\s+INDEX\b/i.test(normalizedStatement)) {
      if (!allowedReplacements.some(({ drop }) => drop === normalizedStatement)) {
        throw new Error(`DROP INDEX is not allowlisted in ${fileName}: ${normalizedStatement}`);
      }
      continue;
    }

    if (/\bDROP\s+(?:TABLE|COLUMN|KEY|CONSTRAINT|PRIMARY|FOREIGN\s+KEY)\b/i.test(normalizedStatement)) {
      throw new Error(`Destructive ALTER is not allowed in ${fileName}: ${normalizedStatement}`);
    }
  }

  for (const { replacement } of allowedReplacements) {
    if (replacement && !normalizedMigration.includes(replacement)) {
      throw new Error(`Allowlisted index replacement is incomplete in ${fileName}: ${replacement}`);
    }
  }
}

async function validateTemporaryMainChain(root: string): Promise<string[]> {
  const previousWorkingDirectory = process.cwd();
  process.chdir(root);
  vi.resetModules();
  try {
    const fixtureModule = await import("./_core/canonical-migrations");
    return fixtureModule.validateCanonicalMigrationFolder(fixtureModule.MAIN_MIGRATIONS_DIR);
  } finally {
    process.chdir(previousWorkingDirectory);
    vi.resetModules();
  }
}

describe("canonical migration architecture", () => {
  it("has coherent main and tenant baselines independent from legacy", () => {
    expect(validateCanonicalMigrationFolder(MAIN_MIGRATIONS_DIR).length).toBeGreaterThanOrEqual(1);
    expect(validateCanonicalMigrationFolder(TENANT_MIGRATIONS_DIR).length).toBeGreaterThanOrEqual(1);
    expect(MAIN_MIGRATIONS_DIR).not.toMatch(/legacy|migrations-backup/);
    expect(TENANT_MIGRATIONS_DIR).not.toMatch(/legacy|migrations-backup/);
  });

  it("accepts the real MAIN chain with the one canonical data repair through 0021", () => {
    const files = validateCanonicalMigrationFolder(MAIN_MIGRATIONS_DIR);
    expect(files).toContain("0019_utc_conversation_timestamp_repair.sql");
    expect(files).toContain("0020_nice_microbe.sql");
    expect(files).toContain("0021_concerned_fabian_cortez.sql");
  });

  it("contains creation-only baselines", () => {
    for (const file of readdirSync(MAIN_MIGRATIONS_DIR)) {
      if (!file.endsWith(".sql") || file === "0019_utc_conversation_timestamp_repair.sql" || file === "0030_robust_umar.sql") continue;
      assertCreationOnlyMigration(file, readFileSync(resolve(MAIN_MIGRATIONS_DIR, file), "utf8"));
    }
    expect(sql(TENANT_MIGRATIONS_DIR)).not.toMatch(/^\s*(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im);

    const mediaMigration = readFileSync(
      resolve(MAIN_MIGRATIONS_DIR, "0030_robust_umar.sql"),
      "utf8"
    );
    expect(mediaMigration.match(/\bDROP\s+INDEX\b/gi)).toHaveLength(1);
    expect(mediaMigration).toContain(
      "ALTER TABLE `erp_product_media` DROP INDEX `uq_epm_one_active`"
    );

    const repair = readFileSync(resolve(MAIN_MIGRATIONS_DIR, "0019_utc_conversation_timestamp_repair.sql"), "utf8");
    expect(repair).toContain("CONVERSATION_TIMESTAMP_REPAIR_PRECONDITION_FAILED");
    expect(repair).toContain("UPDATE megadesk_domain_conversations_messages AS m");
    expect(repair).toContain("m.updated_at = m.updated_at");
    expect(repair).toContain("COLLATE utf8mb4_unicode_ci");
    expect(repair).not.toMatch(/\b(?:megadesk_conversation_events|wa_)\b/i);
  });

  it("allows only the audited 0031 index replacements", () => {
    const stockV3Migration = readFileSync(
      resolve(MAIN_MIGRATIONS_DIR, "0031_lonely_blockbuster.sql"),
      "utf8"
    );

    expect(() => assertCreationOnlyMigration("0031_lonely_blockbuster.sql", stockV3Migration)).not.toThrow();
    expect(() => assertCreationOnlyMigration(
      "0031_lonely_blockbuster.sql",
      stockV3Migration.replace("uq_erp_sale_items_order_product", "uq_unapproved_sale_index")
    )).toThrow("DROP INDEX is not allowlisted");
    expect(() => assertCreationOnlyMigration(
      "0031_lonely_blockbuster.sql",
      "DROP TABLE `erp_sale_order_items`;"
    )).toThrow("Destructive statement is not allowed");
    expect(() => assertCreationOnlyMigration(
      "0031_lonely_blockbuster.sql",
      "ALTER TABLE `erp_sale_order_items` DROP COLUMN `product_id`;"
    )).toThrow("Destructive ALTER is not allowed");
    expect(() => assertCreationOnlyMigration(
      "0031_lonely_blockbuster.sql",
      "DELETE FROM `erp_sale_order_items`;"
    )).toThrow("Destructive statement is not allowed");
    expect(() => assertCreationOnlyMigration(
      "0031_lonely_blockbuster.sql",
      "TRUNCATE `erp_sale_order_items`;"
    )).toThrow("Destructive statement is not allowed");
    expect(() => assertCreationOnlyMigration(
      "0032_synthetic.sql",
      "ALTER TABLE `erp_sale_order_items` DROP INDEX `uq_erp_sale_items_order_product`;"
    )).toThrow("DROP INDEX is not allowlisted");
    expect(() => assertCreationOnlyMigration(
      "0031_lonely_blockbuster.sql",
      stockV3Migration.replace("uq_erp_sale_items_order_identity", "uq_missing_sale_replacement")
    )).toThrow("Allowlisted index replacement is incomplete");
  });

  it("keeps the internal Evolution queue in main exactly once", () => {
    const main = sql(MAIN_MIGRATIONS_DIR);
    for (const table of ["evolution_failed_messages", "evolution_queue_config", "evolution_queue_metrics", "evolution_retry_history"]) {
      expect(main.match(new RegExp("CREATE TABLE `" + table + "`", "g"))).toHaveLength(1);
    }
    expect(sql(TENANT_MIGRATIONS_DIR)).not.toContain("evolution_");
    expect(main).not.toContain("evolution_api");
  });

  it("separates public descriptions from system prompts", () => {
    expect(sql(MAIN_MIGRATIONS_DIR)).toContain("`system_prompt` text NOT NULL");
    expect(sql(TENANT_MIGRATIONS_DIR)).toContain("`system_prompt` text NOT NULL");
  });

  it("rejects unsafe tenant database names", () => {
    expect(validateTenantDatabaseName("mdsk_tenant_123")).toBe("mdsk_tenant_123");
    for (const value of ["megadesk_main", "production", "mdsk_", "mdsk-good", "MDsk_test"]) {
      expect(() => validateTenantDatabaseName(value)).toThrow("mdsk_<identificador>");
    }
  });

  it("standard scripts cannot reach db:push or the legacy chain", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["db:push"]).toBeUndefined();
    const commands = Object.values(pkg.scripts).filter((value) => value.includes("drizzle") || value.includes("migration"));
    expect(commands.join("\n")).not.toMatch(/drizzle\/meta|migrations-backup|db:push/);
  });

  it("rejects missing, orphan and snapshot-divergent migration fixtures", () => {
    const root = mkdtempSync(resolve(tmpdir(), "megadesk-migration-validator-"));
    const makeFixture = (sql: string, snapshotTables: Record<string, unknown> = { sample: { name: "sample" } }) => {
      const folder = resolve(root, Math.random().toString(36).slice(2));
      mkdirSync(resolve(folder, "meta"), { recursive: true });
      writeFileSync(resolve(folder, "meta/_journal.json"), JSON.stringify({ entries: [{ idx: 0, tag: "0000_fixture" }] }));
      writeFileSync(resolve(folder, "meta/0000_snapshot.json"), JSON.stringify({ tables: snapshotTables }));
      writeFileSync(resolve(folder, "0000_fixture.sql"), sql);
      return folder;
    };
    try {
      const missing = makeFixture("CREATE TABLE `sample` (`id` int PRIMARY KEY);");
      rmSync(resolve(missing, "0000_fixture.sql"));
      expect(() => validateCanonicalMigrationFolder(missing)).toThrow("Migration esperada ausente");

      const orphan = makeFixture("CREATE TABLE `sample` (`id` int PRIMARY KEY);");
      writeFileSync(resolve(orphan, "0001_orphan.sql"), "CREATE TABLE `other` (`id` int PRIMARY KEY);");
      expect(() => validateCanonicalMigrationFolder(orphan)).toThrow("órfã");

      const divergent = makeFixture("CREATE TABLE `sample` (`id` int PRIMARY KEY);", { other: { name: "other" } });
      expect(() => validateCanonicalMigrationFolder(divergent)).toThrow("Snapshot divergente");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts the real MAIN chain and rejects a second data repair in a temporary MAIN harness", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "megadesk-main-validator-harness-"));
    const fixtureMain = resolve(root, "drizzle/main-migrations");
    try {
      expect(validateCanonicalMigrationFolder(MAIN_MIGRATIONS_DIR)).toContain("0019_utc_conversation_timestamp_repair.sql");
      cpSync(MAIN_MIGRATIONS_DIR, fixtureMain, { recursive: true });
      const journalPath = resolve(fixtureMain, "meta/_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<Record<string, unknown>> };
      journal.entries.push({
        idx: journal.entries.length,
        version: "5",
        when: 0,
        tag: "0022_synthetic_second_data_repair",
        breakpoints: true,
        kind: "data_repair",
        contract: "synthetic_test_only_v1",
      });
      writeFileSync(journalPath, JSON.stringify(journal, null, 2));
      writeFileSync(
        resolve(fixtureMain, "0022_synthetic_second_data_repair.sql"),
        "CREATE PROCEDURE `synthetic_second_data_repair` () SELECT 1;\n",
      );
      writeFileSync(
        resolve(fixtureMain, "meta/0022_snapshot.json"),
        readFileSync(resolve(fixtureMain, "meta/0021_snapshot.json"), "utf8"),
      );
      await expect(validateTemporaryMainChain(root))
        .rejects.toThrow("Data repair só é aceito uma vez na cadeia MAIN.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
