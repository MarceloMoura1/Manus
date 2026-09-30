import { afterEach, describe, expect, it, vi } from "vitest";

const contextMocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(async () => { throw new Error("no oauth session"); }),
  resolveOperationalSession: vi.fn(async () => null),
}));

vi.mock("./sdk", () => ({ sdk: { authenticateRequest: contextMocks.authenticateRequest } }));
vi.mock("./megadesk-session", async importOriginal => {
  const actual = await importOriginal<typeof import("./megadesk-session")>();
  return { ...actual, resolveOperationalSession: contextMocks.resolveOperationalSession };
});

import { createContext } from "./context";

function request(headers: Record<string, string> = {}) {
  return { headers, cookies: {} } as any;
}

describe("tRPC context test identity boundary", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.clearAllMocks();
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
});
