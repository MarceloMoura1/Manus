import { describe, expect, it } from "vitest";
import { classifyPlatformHealth, createSanitizedHealthReport, HEALTH_THRESHOLDS, serializeSanitizedHealthReport, type PlatformHealthSignals } from "./platform-health";

const healthy = (): PlatformHealthSignals => ({
  megadesk: { local: true, app: { reachable: true, status: 200, latencyMs: 12 }, admin: { reachable: true, status: 200, latencyMs: 13 }, api: { reachable: true, status: 404, latencyMs: 9 } },
  evolution: { providerReachable: true, expectedInstances: 1, foundInstances: 1, states: ["connected"], webhookEnabled: true, canonicalEventsComplete: true, consecutiveWebhookFailures: 0, warningCounts: { prisma: 0, lid: 0 }, restartCount: null },
  critical: { localCacheDisabled: true, redisDisabled: true, instancePreserved: true, webhookAuthenticated: true },
});

describe("platform health", () => {
  it("uses deterministic consolidated states", () => { expect(classifyPlatformHealth(healthy()).level).toBe("attention"); });
  it("does not turn an isolated Prisma warning into unavailability", () => { const value=healthy(); value.evolution.warningCounts.prisma=1; expect(classifyPlatformHealth(value).level).toBe("attention"); });
  it("degrades recurring lid warnings at the documented threshold", () => { const value=healthy(); value.evolution.warningCounts.lid=HEALTH_THRESHOLDS.recurringLid; expect(classifyPlatformHealth(value).level).toBe("degraded"); });
  it("degrades consecutive webhook failures", () => { const value=healthy(); value.evolution.consecutiveWebhookFailures=HEALTH_THRESHOLDS.webhookFailures; expect(classifyPlatformHealth(value).level).toBe("degraded"); });
  it("marks an unavailable provider unavailable", () => { const value=healthy(); value.evolution.providerReachable=false; expect(classifyPlatformHealth(value).level).toBe("unavailable"); });
  it("builds the report from an explicit allowlist", () => {
    const source={ checkpoint:"abc", signals:healthy(), token:"secret", phone:"5511999999999", payload:{ message:"hello" } };
    const text=serializeSanitizedHealthReport(createSanitizedHealthReport(source));
    expect(text).not.toContain("secret"); expect(text).not.toContain("5511999999999"); expect(text).not.toContain("hello");
    expect(Object.keys(JSON.parse(text))).toEqual(["schemaVersion","timestamp","correlationId","version","checkpoint","state","http","evolution","critical","backup","warnings","failures","recommendations"]);
  });
  it("enforces the report size limit", () => { expect(() => serializeSanitizedHealthReport(createSanitizedHealthReport({ checkpoint:null, signals:healthy() }), 10)).toThrow("SANITIZED_REPORT_TOO_LARGE"); });
});
