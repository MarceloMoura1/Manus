import { describe, expect, it, vi, beforeEach } from "vitest";
import { ensureTenantNicheColumns, resetTenantNicheColumnsEnsuredState } from "./db";

describe("ensureTenantNicheColumns", () => {
  beforeEach(() => {
    resetTenantNicheColumnsEnsuredState();
  });

  it("executes ALTER TABLE when niche_profile and enabled_modules are missing", async () => {
    const executedQueries: string[] = [];
    const pool = {
      execute: vi.fn().mockImplementation(async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes("information_schema.COLUMNS")) {
          // Retorna apenas colunas legadas
          return [[{ columnName: "client_id" }, { columnName: "company" }]];
        }
        return [[]];
      }),
    };

    await ensureTenantNicheColumns(pool as any);

    expect(executedQueries.some((q) => q.includes("ADD COLUMN niche_profile"))).toBe(true);
    expect(executedQueries.some((q) => q.includes("ADD COLUMN enabled_modules"))).toBe(true);
  });

  it("does not execute ALTER TABLE when columns already exist", async () => {
    const executedQueries: string[] = [];
    const pool = {
      execute: vi.fn().mockImplementation(async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes("information_schema.COLUMNS")) {
          return [[
            { columnName: "client_id" },
            { columnName: "niche_profile" },
            { columnName: "enabled_modules" },
          ]];
        }
        return [[]];
      }),
    };

    await ensureTenantNicheColumns(pool as any);

    expect(executedQueries.some((q) => q.includes("ADD COLUMN niche_profile"))).toBe(false);
    expect(executedQueries.some((q) => q.includes("ADD COLUMN enabled_modules"))).toBe(false);
  });

  it("ignores ER_DUP_FIELDNAME error gracefully", async () => {
    const pool = {
      execute: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("information_schema.COLUMNS")) {
          return [[{ columnName: "client_id" }]];
        }
        const err: any = new Error("Duplicate column name");
        err.code = "ER_DUP_FIELDNAME";
        throw err;
      }),
    };

    await expect(ensureTenantNicheColumns(pool as any)).resolves.toBeUndefined();
  });
});
