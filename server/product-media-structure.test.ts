import { describe, expect, it } from "vitest";
import fs from "node:fs";

function containsDestructiveSql(sql: string): boolean {
  const statements = sql
    .replace(/-->\s*statement-breakpoint/g, "")
    .split(";")
    .map(statement => statement.trim())
    .filter(Boolean);

  return statements.some(statement =>
    /^(?:DELETE\s+FROM|DROP\b|TRUNCATE\b)/i.test(statement)
    || /^ALTER\s+TABLE\b[\s\S]*\bDROP\s+(?:COLUMN|INDEX|KEY|CONSTRAINT|FOREIGN\s+KEY|PRIMARY\s+KEY)\b/i.test(statement),
  );
}

describe("product media architecture",()=>{
  const source=fs.readFileSync("server/product-media.ts","utf8");
  const sql=fs.readFileSync("drizzle/main-migrations/0016_product_media_tenant_safe.sql","utf8");
  it("uses authenticated tenant scoped binary endpoints without public redirects or base64",()=>{expect(source).toContain("resolveOperationalSessionReadOnly");expect(source).toContain("identity.tenantId");expect(source).toContain("express.raw");expect(source).not.toMatch(/storagePut|res\.redirect|base64/);});
  it("keeps immutable keys and delayed safe reconciliation",()=>{expect(source).toContain("pending_delete");expect(source).toContain("graceMs");expect(source).toContain("p.id IS NULL");expect(source).toContain("resolveMediaPath");});
  it("contains only additive media SQL",()=>{expect(sql).toContain("CREATE TABLE `erp_product_media`");expect(sql).toContain("ADD `primary_media_id`");expect(containsDestructiveSql(sql)).toBe(false);});
  it("distinguishes additive constraints from destructive statements",()=>{
    for(const accepted of [
      "CREATE TABLE child (id bigint PRIMARY KEY, parent_id bigint, FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE RESTRICT);",
      "ALTER TABLE child ADD COLUMN label varchar(80);",
      "ALTER TABLE child ADD CONSTRAINT fk_child_parent FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE CASCADE;",
    ]) expect(containsDestructiveSql(accepted)).toBe(false);

    for(const rejected of [
      "DELETE FROM child WHERE id = 1;",
      "DROP TABLE child;",
      "ALTER TABLE child DROP COLUMN label;",
      "TRUNCATE TABLE child;",
    ]) expect(containsDestructiveSql(rejected)).toBe(true);
  });
  it("enforces tenant, product and single-active invariants physically",()=>{
    expect(sql).toContain("CONSTRAINT `fk_epm_tenant_product` FOREIGN KEY (`client_id`,`product_id`)");
    expect(sql).toContain("CONSTRAINT `fk_erp_products_primary_media` FOREIGN KEY (`client_id`,`id`,`primary_media_id`)");
    expect(sql).toContain("`active_product_id` bigint GENERATED ALWAYS AS");
    expect(sql).toContain("CONSTRAINT `uq_epm_one_active` UNIQUE(`client_id`,`active_product_id`)");
    expect(sql).not.toMatch(/ON DELETE cascade/i);
  });
});
