import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { describe, expect, it } from "vitest";
import { trpc } from "@/lib/trpc";

describe("personalization query identity", () => {
  it("uses separate TanStack Query keys for each authenticated user", () => {
    const userA = { clientId: "tenant-a", userEmail: "a@example.invalid" };
    const userB = { clientId: "tenant-a", userEmail: "b@example.invalid" };
    const keyA = getQueryKey(trpc.userPersonalization.get, userA, "query");
    const keyB = getQueryKey(trpc.userPersonalization.get, userB, "query");
    expect(keyA).not.toEqual(keyB);

    const queryClient = new QueryClient();
    queryClient.setQueryData(keyA, { backgroundType: "preset", presetId: "solid-blue" });
    queryClient.setQueryData(keyB, { backgroundType: "preset", presetId: "midnight" });
    expect(queryClient.getQueryData(keyA)).toMatchObject({ presetId: "solid-blue" });
    expect(queryClient.getQueryData(keyB)).toMatchObject({ presetId: "midnight" });
  });

  it("passes the authenticated session identity into the real hook query", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/hooks/useUserPersonalization.ts"), "utf8");
    expect(source).toContain("clientId: identity.clientId");
    expect(source).toContain("userEmail: identity.userEmail");
    expect(source).toContain("trpc.userPersonalization.get.useQuery(input");
  });
});
