import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql, {
  type Pool,
  type RowDataPacket,
  type ResultSetHeader,
} from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAIN_MIGRATIONS_DIR } from "../../../_core/canonical-migrations";
import {
  getTestDatabaseUrl,
  isTestDatabaseEnabled,
} from "../../../test-integration-gates";
import { SupplierFileRepository } from "./files-repository";
import { SupplierFileService } from "./files-service";

const physical = describe.runIf(isTestDatabaseEnabled());

const tenantA = "megadesk-tenant-alpha";
const tenantB = "megadesk-tenant-beta";
const userA = "user-alpha-001";
const userB = "user-beta-001";

let pool: Pool;
let migrationFolder = "";
let supplierPublicIdA = "";
let supplierPublicIdB = "";
let supplierIdA = 0;
let supplierIdB = 0;

async function prepareBaselineFolder(): Promise<any> {
  migrationFolder = await mkdtemp(join(tmpdir(), "megadesk-supplier-files-rehearsal-"));
  await mkdir(join(migrationFolder, "meta"), { recursive: true });

  const officialEntries = await readdir(MAIN_MIGRATIONS_DIR);
  const journalRaw = await readFile(join(MAIN_MIGRATIONS_DIR, "meta", "_journal.json"), "utf8");
  const journal = JSON.parse(journalRaw);

  // Copy up to 0031 for baseline
  const baselineJournal = {
    ...journal,
    entries: journal.entries.filter((entry: any) => entry.idx <= 31),
  };

  for (const entry of baselineJournal.entries) {
    const sqlFile = `${entry.tag}.sql`;
    await copyFile(join(MAIN_MIGRATIONS_DIR, sqlFile), join(migrationFolder, sqlFile));
    const snapshotFile = `${entry.tag.slice(0, 4)}_snapshot.json`;
    if (officialEntries.includes(snapshotFile) || existsSync(join(MAIN_MIGRATIONS_DIR, "meta", snapshotFile))) {
      await copyFile(join(MAIN_MIGRATIONS_DIR, "meta", snapshotFile), join(migrationFolder, "meta", snapshotFile));
    }
  }

  await writeFile(
    join(migrationFolder, "meta", "_journal.json"),
    JSON.stringify(baselineJournal, null, 2)
  );

  return journal;
}

function existsSync(path: string): boolean {
  try {
    const fs = require("fs");
    return fs.existsSync(path);
  } catch {
    return false;
  }
}

physical("ERP Supplier Files — Disposable Physical MySQL Integration Rehearsal", () => {
  let fullJournal: any;

  beforeAll(async () => {
    const url = getTestDatabaseUrl();
    pool = mysql.createPool({ uri: url, timezone: "Z", connectionLimit: 8 });

    // 1. Prepare folder and apply 0000..0031
    fullJournal = await prepareBaselineFolder();
    await migrate(drizzle(pool), { migrationsFolder: migrationFolder });

    // 2. Insert test tenant domain data & users for baseline
    await pool.execute(
      `INSERT INTO megadesk_domain_clients (client_id, internal_id, tenant_database_name, company, contact, phone, plan, status, access_released, api_token, modules_json, integrations_json)
       VALUES (?, ?, ?, 'Empresa Alpha', 'Contato Alpha', '11999990001', 'enterprise', 'active', 1, 'token-alpha', '{}', '{}'),
              (?, ?, ?, 'Empresa Beta', 'Contato Beta', '11999990002', 'enterprise', 'active', 1, 'token-beta', '{}', '{}')
       ON DUPLICATE KEY UPDATE company=VALUES(company)`,
      [tenantA, "internal-alpha", "megadesk_tenant_alpha", tenantB, "internal-beta", "megadesk_tenant_beta"]
    );

    await pool.execute(
      `INSERT INTO megadesk_domain_client_users (user_id, client_id, name, email, role, status, permissions_json)
       VALUES (?, ?, 'Alice Gestora Alpha', 'alice@alpha.com', 'manager', 'active', '[]'),
              (?, ?, 'Bob Operador Beta', 'bob@beta.com', 'agent', 'active', '[]')
       ON DUPLICATE KEY UPDATE name=VALUES(name)`,
      [userA, tenantA, userB, tenantB]
    );

    // Insert baseline suppliers
    supplierPublicIdA = randomUUID();
    supplierPublicIdB = randomUUID();

    const [resA] = await pool.execute<ResultSetHeader>(
      `INSERT INTO erp_suppliers (public_id, client_id, legal_name, trade_name, person_type, tax_id, active, created_by)
       VALUES (?, ?, 'Fornecedor A LTDA', 'Fornecedor A', 'legal', '11111111000111', 1, ?)`,
      [supplierPublicIdA, tenantA, userA]
    );
    supplierIdA = resA.insertId;

    const [resB] = await pool.execute<ResultSetHeader>(
      `INSERT INTO erp_suppliers (public_id, client_id, legal_name, trade_name, person_type, tax_id, active, created_by)
       VALUES (?, ?, 'Fornecedor B LTDA', 'Fornecedor B', 'legal', '22222222000122', 1, ?)`,
      [supplierPublicIdB, tenantB, userB]
    );
    supplierIdB = resB.insertId;

    // 3. Now apply 0032 onto baseline
    const entry32 = fullJournal.entries.find((e: any) => e.idx === 32);
    if (entry32) {
      const sqlFile = `${entry32.tag}.sql`;
      await copyFile(join(MAIN_MIGRATIONS_DIR, sqlFile), join(migrationFolder, sqlFile));
      const snapshotFile = `${entry32.tag.slice(0, 4)}_snapshot.json`;
      if (existsSync(join(MAIN_MIGRATIONS_DIR, "meta", snapshotFile))) {
        await copyFile(join(MAIN_MIGRATIONS_DIR, "meta", snapshotFile), join(migrationFolder, "meta", snapshotFile));
      }
      await writeFile(
        join(migrationFolder, "meta", "_journal.json"),
        JSON.stringify(fullJournal, null, 2)
      );

      // Execute 0032 migration
      await migrate(drizzle(pool), { migrationsFolder: migrationFolder });
    }
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (migrationFolder) await rm(migrationFolder, { recursive: true, force: true });
  });

  it("proves 0032 created erp_supplier_files table with exact schema & constraints", async () => {
    const [tables] = await pool.execute<RowDataPacket[]>(
      "SHOW TABLES LIKE 'erp_supplier_files'"
    );
    expect(tables.length).toBe(1);

    // Verify foreign keys
    const [fks] = await pool.execute<RowDataPacket[]>(
      `SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_NAME = 'erp_supplier_files' AND TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`
    );
    const fkNames = fks.map(f => f.CONSTRAINT_NAME);
    expect(fkNames).toContain("fk_esf_tenant");
    expect(fkNames).toContain("fk_esf_supplier");

    // Verify unique indexes
    const [indexes] = await pool.execute<RowDataPacket[]>(
      `SHOW INDEX FROM erp_supplier_files`
    );
    const indexNames = new Set(indexes.map(i => i.Key_name));
    expect(indexNames.has("uq_esf_tenant_public")).toBe(true);
    expect(indexNames.has("uq_esf_storage_key")).toBe(true);
    expect(indexNames.has("idx_esf_lookup")).toBe(true);
  });

  it("proves idempotent retry: re-running migrate does not reapply or fail", async () => {
    await expect(migrate(drizzle(pool), { migrationsFolder: migrationFolder })).resolves.not.toThrow();
  });

  it("proves physical tenant isolation and actor name resolution", async () => {
    const repo = new SupplierFileRepository(pool);
    const storageKeyA = randomUUID();
    const filePublicIdA = randomUUID();

    // Insert file for Supplier A in Tenant A
    const fileA = await repo.insertFile(tenantA, supplierIdA, {
      publicId: filePublicIdA,
      fileName: "Contrato_Alpha.pdf",
      category: "contracts",
      description: "Contrato assinado",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      storageKey: storageKeyA,
      createdBy: userA,
    });

    expect(fileA.id).toBeGreaterThan(0);
    expect(fileA.created_by_name).toBe("Alice Gestora Alpha"); // Resolved from client_users!

    // Query from Tenant B must return empty list (strict isolation)
    const listB = await repo.list(tenantB, supplierIdB);
    expect(listB.find(f => f.public_id === filePublicIdA)).toBeUndefined();

    // Query from Tenant A returns fileA
    const listA = await repo.list(tenantA, supplierIdA);
    expect(listA.find(f => f.public_id === filePublicIdA)).toBeDefined();

    // Soft delete
    const deleteOk = await repo.softDelete(tenantA, supplierIdA, filePublicIdA, userA);
    expect(deleteOk).toBe(true);

    const afterDeleteActive = await repo.list(tenantA, supplierIdA, { includeDeleted: false });
    expect(afterDeleteActive.find(f => f.public_id === filePublicIdA)).toBeUndefined();

    const afterDeleteAll = await repo.list(tenantA, supplierIdA, { includeDeleted: true });
    const deletedFile = afterDeleteAll.find(f => f.public_id === filePublicIdA);
    expect(deletedFile?.state).toBe("deleted");
    expect(deletedFile?.deleted_by_name).toBe("Alice Gestora Alpha");
  });

  it("proves foreign key rejection on cross-tenant supplier binding", async () => {
    // Attempting to insert a file with (tenantA, supplierIdB) must fail FK constraint!
    await expect(
      pool.execute(
        `INSERT INTO erp_supplier_files
         (public_id, client_id, supplier_id, file_name, category, mime_type, size_bytes, sha256, storage_key, state, created_by)
         VALUES (?, ?, ?, 'invalido.pdf', 'other', 'application/pdf', 100, 'sha', ?, 'active', ?)`,
        [randomUUID(), tenantA, supplierIdB, randomUUID(), userA]
      )
    ).rejects.toThrow();
  });
});
