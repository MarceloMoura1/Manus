import { describe, expect, it, vi } from "vitest";
import { parseDatabaseTimestamp, PersistedDataIntegrityError } from "./timestamp";

describe("WhatsApp repository safety contracts", () => {
  it("parses the persisted MySQL timestamp format", () => {
    expect(parseDatabaseTimestamp("2026-08-15 12:30:45", "field").toISOString()).toBe("2026-08-15T12:30:45.000Z");
  });

  it("never returns Invalid Date for malformed persisted data", () => {
    expect(() => parseDatabaseTimestamp("not-a-date", "field")).toThrow(PersistedDataIntegrityError);
    expect(() => parseDatabaseTimestamp("2026-99-99 12:30:45", "field")).toThrow(PersistedDataIntegrityError);
  });
});
