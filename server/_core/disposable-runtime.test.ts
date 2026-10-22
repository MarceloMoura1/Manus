import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertDisposablePortAvailable,
  assertDisposableRuntimeConfig,
  assertNoProjectEnvironmentFiles,
  createSanitizedDisposableEnvironment,
  isDisposableRuntimeEnabled,
  shouldStartTicketAttachmentReconciler,
} from "./disposable-runtime";
import {
  prepareLauncherEnvironment,
  runDisposableTestRuntime,
  safeFailureMessage,
} from "../../scripts/start-disposable-test-runtime.mjs";

async function emptyMediaRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "megadesk-disposable-runtime-"));
}

function environment(mediaRoot: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const databaseUrl = "mysql://synthetic:synthetic@127.0.0.1:3307/megadesk_test_quote_pdf";
  return {
    DATABASE_URL: databaseUrl,
    HOST: "127.0.0.1",
    JWT_SECRET: "synthetic-jwt-secret-with-at-least-thirty-two-characters",
    MEGADESK_DISPOSABLE_MEDIA_ROOT: mediaRoot,
    MEGADESK_DISPOSABLE_RUNTIME: "1",
    MEGADESK_MEDIA_ROOT: mediaRoot,
    NODE_ENV: "development",
    PORT: "43123",
    RUN_DATABASE_INTEGRATION: "1",
    TEST_DATABASE_URL: databaseUrl,
    ...overrides,
  };
}

describe("disposable runtime guard", () => {
  it("accepts an explicit local disposable configuration and blocks the reconciler", async () => {
    const mediaRoot = await emptyMediaRoot();
    try {
      const config = assertDisposableRuntimeConfig(environment(mediaRoot));
      expect(config.port).toBe(43123);
      expect(config.host).toBe("127.0.0.1");
      expect(shouldStartTicketAttachmentReconciler(environment(mediaRoot))).toBe(false);
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing opt-in", { MEGADESK_DISPOSABLE_RUNTIME: undefined }],
    ["protected database", { TEST_DATABASE_URL: "mysql://synthetic:synthetic@127.0.0.1:3307/megadesk_local" }],
    ["remote database host", { TEST_DATABASE_URL: "mysql://synthetic:synthetic@example.invalid:3307/megadesk_test_quote_pdf" }],
    ["noncanonical database name", { TEST_DATABASE_URL: "mysql://synthetic:synthetic@127.0.0.1:3307/megadesk_test_Quote" }],
    ["database URL mismatch", { DATABASE_URL: "mysql://synthetic:synthetic@127.0.0.1:3307/megadesk_test_other" }],
    ["main database variable", { MAIN_DATABASE_URL: "mysql://synthetic:synthetic@127.0.0.1:3307/megadesk_test_other" }],
    ["nonlocal listen host", { HOST: "0.0.0.0" }],
    ["invalid port", { PORT: "not-a-port" }],
  ])("fails closed for %s", async (_caseName, overrides) => {
    const mediaRoot = await emptyMediaRoot();
    try {
      expect(() => assertDisposableRuntimeConfig(environment(mediaRoot, overrides))).toThrow("inválida");
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });

  it("rejects a media root outside the temporary directory and a nonempty root", async () => {
    const mediaRoot = await emptyMediaRoot();
    try {
      expect(() => assertDisposableRuntimeConfig(environment(path.resolve(process.cwd())))).toThrow("diretório temporário aprovado");
      await writeFile(path.join(mediaRoot, "unexpected.txt"), "synthetic");
      expect(() => assertDisposableRuntimeConfig(environment(mediaRoot))).toThrow("vazia e exclusiva");
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });

  it("rejects an occupied port through the launcher probe without binding a server in the test", async () => {
    const mediaRoot = await emptyMediaRoot();
    try {
      const config = assertDisposableRuntimeConfig(environment(mediaRoot));
      await expect(assertDisposablePortAvailable(config, async () => false)).rejects.toThrow("não está disponível");
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });

  it("sanitizes the child environment without retaining external-service credentials", async () => {
    const mediaRoot = await emptyMediaRoot();
    try {
      const config = assertDisposableRuntimeConfig(environment(mediaRoot));
      const child = createSanitizedDisposableEnvironment({
        ...environment(mediaRoot),
        BUILT_IN_FORGE_API_KEY: "must-not-propagate",
        BUILT_IN_FORGE_API_URL: "https://storage.invalid",
        EVOLUTION_API_KEY: "must-not-propagate",
        EVOLUTION_API_URL: "https://evolution.invalid",
        OAUTH_SERVER_URL: "https://oauth.invalid",
        PATH: "synthetic-path",
      }, config, "ephemeral-secret-that-is-long-enough-for-the-test", "/synthetic/project");
      expect(child.DATABASE_URL).toBe(config.databaseUrl);
      expect(child.TEST_DATABASE_URL).toBe(config.databaseUrl);
      expect(child.JWT_SECRET).toBe("ephemeral-secret-that-is-long-enough-for-the-test");
      expect(child.BUILT_IN_FORGE_API_KEY).toBeUndefined();
      expect(child.BUILT_IN_FORGE_API_URL).toBeUndefined();
      expect(child.EVOLUTION_API_KEY).toBeUndefined();
      expect(child.EVOLUTION_API_URL).toBeUndefined();
      expect(child.OAUTH_SERVER_URL).toBeUndefined();
      expect(child.PATH).toBe("synthetic-path");
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });

  it("maps the dedicated launcher port and never reports inherited sensitive values", async () => {
    const mediaRoot = await emptyMediaRoot();
    try {
      const input = {
        ...environment(mediaRoot),
        MEGADESK_TEST_RUNTIME_PORT: "43124",
        OAUTH_SERVER_URL: "https://oauth.invalid",
        PORT: "3000",
      };
      const prepared = prepareLauncherEnvironment(input);
      expect(prepared.HOST).toBe("127.0.0.1");
      expect(prepared.PORT).toBe("43124");
      expect(prepared.DATABASE_URL).toBe(input.TEST_DATABASE_URL);
      expect(prepared.MEGADESK_MEDIA_ROOT).toBe(prepared.MEGADESK_DISPOSABLE_MEDIA_ROOT);
      expect(prepared.JWT_SECRET).toBeUndefined();
      expect(() => prepareLauncherEnvironment({ ...input, DATABASE_URL: "mysql://synthetic:synthetic@127.0.0.1:3307/megadesk_local" })).toThrow(
        "diverge do alvo descartável",
      );
      expect(safeFailureMessage()).not.toContain("oauth.invalid");
      expect(safeFailureMessage()).not.toContain("synthetic");
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });

  it("passes only an ephemeral JWT and sanitized values to the simulated child process", async () => {
    const mediaRoot = await emptyMediaRoot();
    try {
      let childEnvironment: NodeJS.ProcessEnv | undefined;
      const result = await runDisposableTestRuntime({
        environment: {
          ...environment(mediaRoot),
          BUILT_IN_FORGE_API_KEY: "must-not-propagate",
          JWT_SECRET: "inherited-value-that-must-not-reach-the-child-process",
          MEGADESK_TEST_RUNTIME_PORT: "43124",
          OAUTH_SERVER_URL: "https://oauth.invalid",
        },
        exists: () => false,
        makeSecret: () => "fresh-ephemeral-jwt-secret-for-the-synthetic-child",
        portProbe: async () => true,
        spawnProcess: (_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
          childEnvironment = options.env;
          const child = new EventEmitter() as EventEmitter & { killed: boolean; kill(signal: NodeJS.Signals): boolean };
          child.killed = false;
          child.kill = () => { child.killed = true; return true; };
          queueMicrotask(() => child.emit("exit", 0, null));
          return child as never;
        },
      });
      expect(result).toEqual({ code: 0, signal: null });
      expect(childEnvironment?.JWT_SECRET).toBe("fresh-ephemeral-jwt-secret-for-the-synthetic-child");
      expect(childEnvironment?.JWT_SECRET).not.toBe("inherited-value-that-must-not-reach-the-child-process");
      expect(childEnvironment?.DATABASE_URL).toBe(childEnvironment?.TEST_DATABASE_URL);
      expect(childEnvironment?.BUILT_IN_FORGE_API_KEY).toBeUndefined();
      expect(childEnvironment?.OAUTH_SERVER_URL).toBeUndefined();
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });

  it("preserves normal runtime behavior when the disposable opt-in is absent", () => {
    expect(isDisposableRuntimeEnabled({})).toBe(false);
    expect(shouldStartTicketAttachmentReconciler({ NODE_ENV: "development" })).toBe(true);
  });

  it("rejects project-local env files without reading their contents", () => {
    expect(() => assertNoProjectEnvironmentFiles("/synthetic/project", candidate => candidate.endsWith(".env.local"))).toThrow(
      "arquivos .env locais não são permitidos",
    );
    expect(() => assertNoProjectEnvironmentFiles("/synthetic/project", () => false)).not.toThrow();
  });
});
