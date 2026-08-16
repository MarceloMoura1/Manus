import { describe, expect, it } from "vitest";
import { validateAdminInput, validateLocalDatabaseUrl } from "../seed-admin.mjs";

describe("secure MegaAdmin bootstrap", () => {
  it("requires the explicitly authorized local database", () => {
    expect(() => validateLocalDatabaseUrl("")).toThrow("required");
    expect(() => validateLocalDatabaseUrl("mysql://user:pass@127.0.0.1:3307/megadesk_test")).toThrow("restricted");
    expect(validateLocalDatabaseUrl("mysql://user:pass@127.0.0.1:3308/megadesk_local")).toContain("megadesk_local");
  });
  it("requires an explicit email and strong password", () => {
    expect(() => validateAdminInput({})).toThrow("ADMIN_EMAIL");
    expect(() => validateAdminInput({ ADMIN_EMAIL: "admin@example.invalid", ADMIN_PASSWORD: "weak" })).toThrow("at least 12");
    expect(validateAdminInput({ ADMIN_EMAIL: " Admin@Example.Invalid ", ADMIN_PASSWORD: "LocalOnly!Strong9" })).toMatchObject({ email: "admin@example.invalid", name: "Administrador" });
  });
});
