import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { assertDistinctDatabaseNames, assertRuntimeMapping, assertStagingDatabaseUrl, sha256, stableValue } from "./reconciler.mjs";

const PLAN_URL = new URL("./reconciliation-plan.json", import.meta.url);
const quote = identifier => `\`${String(identifier).replaceAll("`", "``")}\``;
const databaseName = url => assertStagingDatabaseUrl(url).database;

async function query(connection, sql, values = []) {
  const [rows] = await connection.execute(sql, values);
  return rows;
}

async function tableCount(connection, schema, table, where = "1=1", values = []) {
  const rows = await query(connection, `SELECT COUNT(*) count FROM ${quote(schema)}.${quote(table)} WHERE ${where}`, values);
  return Number(rows[0].count);
}

async function columns(connection, schema, table) {
  return query(connection, "SELECT COLUMN_NAME name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION", [schema, table]);
}

async function primaryKey(connection, schema, table) {
  const rows = await query(connection, "SELECT COLUMN_NAME name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME='PRIMARY' ORDER BY SEQ_IN_INDEX", [schema, table]);
  return rows.map(row => row.name);
}

async function tableFingerprint(connection, schema, table, forbiddenColumns) {
  const safeColumns = (await columns(connection, schema, table)).map(column => column.name)
    .filter(column => !forbiddenColumns.includes(column.toLowerCase()));
  const primary = await primaryKey(connection, schema, table);
  if (!primary.length) throw new Error(`Cannot deterministically fingerprint ${table} without a primary key.`);
  const order = primary.length ? ` ORDER BY ${primary.map(quote).join(",")}` : "";
  const rows = await query(connection, `SELECT ${safeColumns.map(quote).join(",")} FROM ${quote(schema)}.${quote(table)}${order}`);
  return sha256(JSON.stringify(rows.map(stableValue)));
}

async function resolveHash(connection, schema, table, column, expectedHash, where = "1=1", values = []) {
  const rows = await query(connection, `SELECT * FROM ${quote(schema)}.${quote(table)} WHERE ${where}`, values);
  const matches = rows.filter(row => sha256(String(row[column] ?? "").trim().toLowerCase()) === expectedHash);
  if (matches.length !== 1) throw new Error(`Validation mapping for ${table}.${column} resolved ${matches.length} candidates.`);
  return matches[0];
}

async function validateForeignKeys(connection, schema) {
  const rows = await query(connection, `SELECT CONSTRAINT_NAME constraintName,TABLE_NAME childTable,
      REFERENCED_TABLE_NAME parentTable,COLUMN_NAME childColumn,REFERENCED_COLUMN_NAME parentColumn,
      ORDINAL_POSITION ordinalPosition
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION`, [schema]);
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.childTable}\u0000${row.constraintName}`;
    if (!groups.has(key)) groups.set(key, { ...row, pairs: [] });
    groups.get(key).pairs.push({ child: row.childColumn, parent: row.parentColumn });
  }
  const tableColumns = new Map();
  const getColumns = async table => {
    if (!tableColumns.has(table)) tableColumns.set(table, new Set((await columns(connection, schema, table)).map(item => item.name)));
    return tableColumns.get(table);
  };
  const failures = [];
  let crossTenantErrors = 0;
  for (const group of groups.values()) {
    const join = group.pairs.map(pair => `c.${quote(pair.child)}=p.${quote(pair.parent)}`).join(" AND ");
    const referenced = group.pairs.map(pair => `c.${quote(pair.child)} IS NOT NULL`).join(" AND ");
    const orphanRows = await query(connection, `SELECT COUNT(*) count FROM ${quote(schema)}.${quote(group.childTable)} c
      LEFT JOIN ${quote(schema)}.${quote(group.parentTable)} p ON ${join}
      WHERE ${referenced} AND p.${quote(group.pairs[0].parent)} IS NULL`);
    const orphans = Number(orphanRows[0].count);
    if (orphans) failures.push({ constraint: group.constraintName, childTable: group.childTable, parentTable: group.parentTable, orphans });
    const childColumns = await getColumns(group.childTable);
    const parentColumns = await getColumns(group.parentTable);
    const childTenant = childColumns.has("client_id") ? "client_id" : childColumns.has("clientId") ? "clientId" : null;
    const parentTenant = parentColumns.has("client_id") ? "client_id" : parentColumns.has("clientId") ? "clientId" : null;
    if (childTenant && parentTenant) {
      const mismatchRows = await query(connection, `SELECT COUNT(*) count FROM ${quote(schema)}.${quote(group.childTable)} c
        JOIN ${quote(schema)}.${quote(group.parentTable)} p ON ${join}
        WHERE c.${quote(childTenant)}<>p.${quote(parentTenant)}`);
      crossTenantErrors += Number(mismatchRows[0].count);
    }
  }
  return { constraints: groups.size, orphanRows: failures.reduce((sum, item) => sum + item.orphans, 0), failures, crossTenantErrors };
}

async function validateUniqueIndexes(connection, schema) {
  const rows = await query(connection, `SELECT TABLE_NAME tableName,INDEX_NAME indexName,COLUMN_NAME columnName
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND NON_UNIQUE=0 AND INDEX_NAME<>'PRIMARY'
    ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`, [schema]);
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.tableName}\u0000${row.indexName}`;
    if (!groups.has(key)) groups.set(key, { table: row.tableName, index: row.indexName, fields: [] });
    groups.get(key).fields.push(row.columnName);
  }
  const failures = [];
  for (const group of groups.values()) {
    const fields = group.fields.map(quote).join(",");
    const nonNull = group.fields.map(field => `${quote(field)} IS NOT NULL`).join(" AND ");
    const duplicates = await query(connection, `SELECT COUNT(*) count FROM (
      SELECT ${fields} FROM ${quote(schema)}.${quote(group.table)} WHERE ${nonNull}
      GROUP BY ${fields} HAVING COUNT(*)>1
    ) duplicate_groups`);
    if (Number(duplicates[0].count)) failures.push({ table: group.table, index: group.index, duplicateGroups: Number(duplicates[0].count) });
  }
  return { indexes: groups.size, duplicateGroups: failures.reduce((sum, item) => sum + item.duplicateGroups, 0), failures };
}

async function prefixCounts(connection, schema, prefix) {
  const tables = await query(connection, "SELECT TABLE_NAME tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME LIKE ? ORDER BY TABLE_NAME", [schema, `${prefix}%`]);
  const result = {};
  for (const { tableName } of tables) result[tableName] = await tableCount(connection, schema, tableName);
  return result;
}

export async function validateStaging(options) {
  const plan = JSON.parse(await readFile(PLAN_URL, "utf8"));
  const mapping = assertRuntimeMapping(JSON.parse(await readFile(options.mappingFile, "utf8")));
  const sourceSchema = databaseName(options.sourceUrl);
  const baselineSchema = databaseName(options.baselineUrl);
  const targetSchema = databaseName(options.targetUrl);
  assertDistinctDatabaseNames({ source: sourceSchema, baseline: baselineSchema, target: targetSchema });
  const source = await mysql.createConnection({ uri: options.sourceUrl, timezone: "Z", dateStrings: true });
  const baseline = await mysql.createConnection({ uri: options.baselineUrl, timezone: "Z", dateStrings: true });
  const target = await mysql.createConnection({ uri: options.targetUrl, timezone: "Z", dateStrings: true });
  const report = { version: 1, sourceSchema, baselineSchema, targetSchema, startedAt: new Date().toISOString(), failures: [] };
  try {
    const sourceTenant = await resolveHash(source, sourceSchema, "megadesk_domain_clients", "client_id", mapping.sourceTenantSha256);
    const baselineTenant = await resolveHash(baseline, baselineSchema, "megadesk_domain_clients", "client_id", mapping.targetTenantSha256);
    const targetTenant = await resolveHash(target, targetSchema, "megadesk_domain_clients", "client_id", mapping.targetTenantSha256);
    const sourceUser = await resolveHash(source, sourceSchema, "megadesk_domain_client_users", "email", mapping.sourceAdminEmailSha256, "client_id=?", [sourceTenant.client_id]);
    const targetUser = await resolveHash(target, targetSchema, "megadesk_domain_client_users", "email", mapping.targetAdminEmailSha256, "client_id=?", [targetTenant.client_id]);
    report.mapping = { tenant: sha256(sourceTenant.client_id) === mapping.sourceTenantSha256 && sha256(targetTenant.client_id) === mapping.targetTenantSha256, user: String(sourceUser.role) === String(targetUser.role) && String(sourceUser.status) === String(targetUser.status) };

    const migrationRows = await query(target, "SELECT COUNT(*) count,MAX(created_at) lastCreatedAt,SUM(created_at=1790308790520) migration0035,SUM(created_at=1790786929102) migration0036,SUM(created_at>1790786929102) after0036 FROM __drizzle_migrations");
    report.migrations = { count: Number(migrationRows[0].count), lastCreatedAt: String(migrationRows[0].lastCreatedAt), migration0035: Number(migrationRows[0].migration0035), migration0036: Number(migrationRows[0].migration0036), after0036: Number(migrationRows[0].after0036) };
    report.foreignKeys = await validateForeignKeys(target, targetSchema);
    report.uniqueIndexes = await validateUniqueIndexes(target, targetSchema);

    const oracleTables = Object.entries(plan.entities).filter(([, entity]) => entity.authority === "ORACLE_BASE").map(([table]) => table);
    report.oracleBase = { tables: {}, rowsBaseline: 0, rowsTarget: 0, preserved: true };
    for (const table of oracleTables) {
      const baselineCount = await tableCount(baseline, baselineSchema, table);
      const targetCount = await tableCount(target, targetSchema, table);
      const baselineFingerprint = await tableFingerprint(baseline, baselineSchema, table, plan.forbiddenColumns);
      const targetFingerprint = await tableFingerprint(target, targetSchema, table, plan.forbiddenColumns);
      const preserved = baselineCount === targetCount && baselineFingerprint === targetFingerprint;
      report.oracleBase.tables[table] = { baselineCount, targetCount, preserved, fingerprint: targetFingerprint };
      report.oracleBase.rowsBaseline += baselineCount;
      report.oracleBase.rowsTarget += targetCount;
      report.oracleBase.preserved &&= preserved;
    }

    report.tenants = { baseline: await tableCount(baseline, baselineSchema, "megadesk_domain_clients"), target: await tableCount(target, targetSchema, "megadesk_domain_clients"), mappedTenantRows: await tableCount(target, targetSchema, "megadesk_domain_clients", "client_id=?", [targetTenant.client_id]) };
    report.messages = { oracleSource: await tableCount(baseline, baselineSchema, "megadesk_domain_conversations_messages", "client_id=?", [baselineTenant.client_id]), windowsSource: await tableCount(source, sourceSchema, "megadesk_domain_conversations_messages", "client_id=?", [sourceTenant.client_id]), final: await tableCount(target, targetSchema, "megadesk_domain_conversations_messages", "client_id=?", [targetTenant.client_id]) };
    report.pendingReceipts = { windowsSource: await tableCount(source, sourceSchema, "megadesk_conversation_pending_receipts", "client_id=?", [sourceTenant.client_id]), final: await tableCount(target, targetSchema, "megadesk_conversation_pending_receipts", "client_id=?", [targetTenant.client_id]) };
    const targetMovements = await tableCount(target, targetSchema, "erp_stock_movements", "client_id=?", [targetTenant.client_id]);
    const baselineMovements = await tableCount(baseline, baselineSchema, "erp_stock_movements", "client_id=?", [baselineTenant.client_id]);
    report.inventory = {
      products: await tableCount(target, targetSchema, "erp_products", "client_id=?", [targetTenant.client_id]),
      items: await tableCount(target, targetSchema, "erp_inventory_items", "client_id=?", [targetTenant.client_id]),
      itemBalances: await tableCount(target, targetSchema, "erp_inventory_item_balances", "client_id=?", [targetTenant.client_id]),
      stockBalances: await tableCount(target, targetSchema, "erp_stock_balances", "client_id=?", [targetTenant.client_id]),
      movements: targetMovements,
      syntheticMovementsCreated: targetMovements - baselineMovements,
      policy: "ORACLE_SNAPSHOT_AND_LEDGER_PRESERVED_NO_RECONSTRUCTION",
    };
    report.purchaseCounts = await prefixCounts(target, targetSchema, "erp_purchase_");
    report.financialCounts = await prefixCounts(target, targetSchema, "erp_financial_");
    const blockedMappings = await query(target, `SELECT COUNT(*) count FROM ${quote(targetSchema)}._reconciliation_entity_map WHERE entity_type IN (${plan.blockedTables.map(() => "?").join(",")})`, plan.blockedTables);
    const auditMissing = await query(target, `SELECT COUNT(*) count FROM ${quote(targetSchema)}._reconciliation_entity_map m LEFT JOIN ${quote(targetSchema)}._reconciliation_audit a ON a.entity_type=m.entity_type AND a.source_id_hash=m.source_id_hash WHERE a.id IS NULL`);
    report.audit = { mappings: await tableCount(target, targetSchema, "_reconciliation_entity_map"), events: await tableCount(target, targetSchema, "_reconciliation_audit"), mappingsWithoutAudit: Number(auditMissing[0].count), blockedEntityMappings: Number(blockedMappings[0].count) };

    const checks = [
      [report.mapping.tenant, "tenant mapping"], [report.mapping.user, "user mapping"],
      [report.migrations.count === 37 && report.migrations.lastCreatedAt === "1790786929102" && report.migrations.migration0035 === 1 && report.migrations.migration0036 === 1 && report.migrations.after0036 === 0, "migration journal"],
      [report.foreignKeys.orphanRows === 0, "foreign-key orphans"], [report.foreignKeys.crossTenantErrors === 0, "cross-tenant foreign keys"],
      [report.uniqueIndexes.duplicateGroups === 0, "unique indexes"], [report.oracleBase.preserved, "Oracle base preservation"],
      [report.tenants.baseline === report.tenants.target && report.tenants.target === 3, "Oracle tenants preserved"],
      [report.messages.final === report.messages.oracleSource + report.messages.windowsSource, "message union"],
      [report.pendingReceipts.windowsSource === 1 && report.pendingReceipts.final === 1, "pending receipt"],
      [report.inventory.syntheticMovementsCreated === 0, "synthetic inventory movements"],
      [Object.values(report.purchaseCounts).every(count => count === 0), "purchase tables remain empty"],
      [Object.values(report.financialCounts).every(count => count === 0), "financial tables remain empty"],
      [report.audit.mappingsWithoutAudit === 0 && report.audit.blockedEntityMappings === 0, "audit and blocked entities"],
    ];
    report.failures = checks.filter(([passed]) => !passed).map(([, name]) => name);
    report.result = report.failures.length ? "FAIL" : "PASS";
    report.finishedAt = new Date().toISOString();
    await writeFile(options.reportFile, JSON.stringify(report, null, 2), { encoding: "utf8", mode: 0o600 });
    return report;
  } finally {
    await source.end(); await baseline.end(); await target.end();
  }
}

async function main() {
  const required = ["RECON_SOURCE_URL", "RECON_BASELINE_URL", "RECON_TARGET_URL", "RECON_MAPPING_FILE", "RECON_VALIDATION_REPORT_FILE"];
  for (const name of required) if (!process.env[name]) throw new Error(`${name} is required.`);
  const report = await validateStaging({ sourceUrl: process.env.RECON_SOURCE_URL, baselineUrl: process.env.RECON_BASELINE_URL, targetUrl: process.env.RECON_TARGET_URL, mappingFile: process.env.RECON_MAPPING_FILE, reportFile: process.env.RECON_VALIDATION_REPORT_FILE });
  process.stdout.write(`${JSON.stringify({ result: report.result, failures: report.failures, foreignKeys: report.foreignKeys, uniqueIndexes: report.uniqueIndexes, messages: report.messages, inventory: report.inventory })}\n`);
  if (report.result !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ error: error.name, message: error.message })}\n`);
    process.exitCode = 1;
  });
}
