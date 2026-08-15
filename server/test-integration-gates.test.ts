import { describe, expect, it } from "vitest";
import { getTestDatabaseUrl, isTestDatabaseEnabled, validateEvolutionTestConfig, validateTestDatabaseUrl } from "./test-integration-gates";

const local = (database: string, host = "localhost") =>
  `mysql://test_user:test_password@${host}:3306/${database}`;

describe("MySQL integration gate", () => {
  it("stays disabled when the flag is absent or differs from 1", () => {
    expect(isTestDatabaseEnabled({})).toBe(false);
    expect(isTestDatabaseEnabled({ RUN_DATABASE_INTEGRATION: "true" })).toBe(false);
  });

  it("requires TEST_DATABASE_URL when explicitly enabled", () => {
    expect(() => getTestDatabaseUrl({ RUN_DATABASE_INTEGRATION: "1" })).toThrow("TEST_DATABASE_URL é obrigatória");
  });

  it("rejects malformed URLs without echoing credentials", () => {
    const secret = "sensitive_password";
    let message = "";
    try { validateTestDatabaseUrl(`not-a-url-${secret}`); } catch (error) { message = error instanceof Error ? error.message : ""; }
    expect(message).toContain("não é uma URL válida");
    expect(message).not.toContain(secret);
  });

  it("rejects unsupported protocols", () => {
    expect(() => validateTestDatabaseUrl("postgres://user:password@localhost/megadesk_test")).toThrow("protocolo mysql");
  });

  it.each(["latest", "contest", "production_test", "customer_test_backup"])("rejects ambiguous database name %s", database => {
    expect(() => validateTestDatabaseUrl(local(database))).toThrow("megadesk_test");
  });

  it.each(["megadesk_test", "megadesk_test_ci"])("accepts safe database name %s", database => {
    expect(validateTestDatabaseUrl(local(database))).toBe(local(database));
  });

  it.each(["localhost", "127.0.0.1", "[::1]", "mysql-test"])("accepts documented test host %s", host => {
    expect(validateTestDatabaseUrl(local("megadesk_test", host))).toBe(local("megadesk_test", host));
  });

  it("rejects a remote host even with a safe database name", () => {
    expect(() => validateTestDatabaseUrl(local("megadesk_test", "db.example.com"))).toThrow("lista segura");
  });
});

describe("Evolution E2E gate", () => {
  it("requires the exact flag and complete configuration", () => {
    expect(() => validateEvolutionTestConfig({})).toThrow("RUN_EVOLUTION_E2E=1");
    expect(() => validateEvolutionTestConfig({ RUN_EVOLUTION_E2E: "1" })).toThrow("URL e chave");
  });

  it("accepts a local test endpoint", () => {
    expect(validateEvolutionTestConfig({
      RUN_EVOLUTION_E2E: "1", EVOLUTION_API_URL: "http://localhost:8081", EVOLUTION_API_KEY: "fake-key",
    })).toEqual({ apiUrl: "http://localhost:8081", apiKey: "fake-key" });
  });

  it("rejects remote endpoints without leaking their key", () => {
    const key = "sensitive-key";
    let message = "";
    try {
      validateEvolutionTestConfig({ RUN_EVOLUTION_E2E: "1", EVOLUTION_API_URL: "https://production.example.com", EVOLUTION_API_KEY: key });
    } catch (error) { message = error instanceof Error ? error.message : ""; }
    expect(message).toContain("lista segura");
    expect(message).not.toContain(key);
  });
});
