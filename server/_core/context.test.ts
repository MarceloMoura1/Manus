import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const contextMocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(async () => { throw new Error("no oauth session"); }),
  resolveOperationalSessionReadOnly: vi.fn(async () => null),
}));

vi.mock("./sdk", () => ({ sdk: { authenticateRequest: contextMocks.authenticateRequest } }));
vi.mock("./megadesk-session", async importOriginal => {
  const actual = await importOriginal<typeof import("./megadesk-session")>();
  return { ...actual, resolveOperationalSessionReadOnly: contextMocks.resolveOperationalSessionReadOnly };
});

import { createContext } from "./context";
import { setWriteFreezeCoordinatorForTests, WriteFreezeCoordinator } from "../write-freeze";

const roots: string[] = [];

function request(headers: Record<string, string> = {}) {
  return { headers, cookies: {} } as any;
}

describe("tRPC context test identity boundary", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    setWriteFreezeCoordinatorForTests(null);
    vi.clearAllMocks();
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  it("ignores x-allow-test-user outside the test environment", async () => {
    process.env.NODE_ENV = "production";
    const ctx = await createContext({ req: request({ "x-allow-test-user": "true" }), res: {} as any });
    expect(ctx.user).toBeNull();
    expect(ctx.tenantId).toBeUndefined();
  });

  it("keeps the explicit synthetic identity available to isolated tests", async () => {
    process.env.NODE_ENV = "test";
    const ctx = await createContext({ req: request({ "x-allow-test-user": "true" }), res: {} as any });
    expect(ctx.user).toMatchObject({ loginMethod: "development", role: "user" });
  });

  it("blocks the hidden OAuth session touch during ACTIVE while keeping operational reads available", async () => {
    process.env.NODE_ENV = "test";
    const root = await mkdtemp(path.join(tmpdir(), "megadesk-context-freeze-"));
    roots.push(root);
    const freeze = new WriteFreezeCoordinator({ root });
    setWriteFreezeCoordinatorForTests(freeze);
    contextMocks.resolveOperationalSessionReadOnly.mockResolvedValueOnce({
      sessionId: "session-read-only",
      userId: "user-read-only",
      tenantId: "tenant-read-only",
      userEmail: "read@example.invalid",
      userName: "Read Only",
      role: "agent",
      permissions: ["tickets:read"],
    });
    await freeze.activate("context-read-test");

    const ctx = await createContext({ req: request(), res: {} as any });

    expect(contextMocks.authenticateRequest).not.toHaveBeenCalled();
    expect(contextMocks.resolveOperationalSessionReadOnly).toHaveBeenCalledOnce();
    expect(ctx).toMatchObject({ user: null, tenantId: "tenant-read-only", operationalSessionId: "session-read-only" });
  });
});
