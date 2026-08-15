import { describe, expect, it, vi } from "vitest";
import { cacheStateAfterSuccessfulPersistence, inMemoryState, REQUIRED_MAIN_COLUMNS, REQUIRED_MAIN_TABLES, verifyMainSchema } from "./db";

const completeColumns = Object.entries(REQUIRED_MAIN_COLUMNS).flatMap(([tableName, columns]) =>
  columns.map((columnName) => ({ tableName, columnName }))
);

describe("main schema readiness", () => {
  it("accepts a complete canonical schema", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([REQUIRED_MAIN_TABLES.map((tableName) => ({ tableName }))])
      .mockResolvedValueOnce([completeColumns]);
    await expect(verifyMainSchema({ execute } as never)).resolves.toBeUndefined();
  });

  it("rejects a partial schema without executing runtime DDL", async () => {
    const execute = vi.fn().mockResolvedValue([[{ tableName: "users" }]]);
    await expect(verifyMainSchema({ execute } as never)).rejects.toThrow("SCHEMA_MAIN_NOT_READY");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatch(/^SELECT /);
  });

  it("rejects a canonical table with an essential column missing", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([REQUIRED_MAIN_TABLES.map((tableName) => ({ tableName }))])
      .mockResolvedValueOnce([completeColumns.filter((row) => row.columnName !== "system_prompt")]);
    await expect(verifyMainSchema({ execute } as never)).rejects.toThrow("megadesk_domain_bot_scripts.system_prompt");
  });

  it("does not expose a cache update when persistence fails", async () => {
    const before = inMemoryState;
    const state = { clients: [{ clientId: "not-persisted" }], conversations: [], tickets: [], botScripts: [], operationalRecords: [], auditLogs: [] };
    await expect(cacheStateAfterSuccessfulPersistence(state, async () => { throw new Error("SCHEMA_MAIN_NOT_READY"); })).rejects.toThrow("SCHEMA_MAIN_NOT_READY");
    expect(inMemoryState).toBe(before);
  });
});
