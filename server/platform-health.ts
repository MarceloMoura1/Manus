import { randomUUID } from "node:crypto";

export type PlatformLevel = "operational" | "attention" | "degraded" | "unavailable";
export type IntegrationState = "connected" | "disconnected" | "connecting" | "qr_required" | "provider_unavailable" | "webhook_degraded" | "repairing";

export type SafeHttpSignal = { status: number | null; reachable: boolean; latencyMs: number | null };
export type PlatformHealthSignals = {
  megadesk: { local: boolean; app: SafeHttpSignal; admin: SafeHttpSignal; api: SafeHttpSignal };
  evolution: {
    providerReachable: boolean;
    expectedInstances: number;
    foundInstances: number;
    states: IntegrationState[];
    webhookEnabled: boolean;
    canonicalEventsComplete: boolean;
    consecutiveWebhookFailures: number | null;
    warningCounts: { prisma: number | null; lid: number | null };
    restartCount: number | null;
  };
  critical: { localCacheDisabled: boolean | null; redisDisabled: boolean | null; instancePreserved: boolean | null; webhookAuthenticated: boolean };
};

export const HEALTH_THRESHOLDS = Object.freeze({ recurringLid: 3, webhookFailures: 3, restartLoop: 3 });

const rank: Record<PlatformLevel, number> = { operational: 0, attention: 1, degraded: 2, unavailable: 3 };
function maxLevel(...levels: PlatformLevel[]): PlatformLevel {
  return levels.reduce((current, item) => rank[item] > rank[current] ? item : current, "operational");
}

export function classifyPlatformHealth(signals: PlatformHealthSignals): { level: PlatformLevel; warnings: string[]; failures: string[]; recommendations: string[] } {
  let level: PlatformLevel = "operational";
  const warnings: string[] = [];
  const failures: string[] = [];
  const recommendations: string[] = [];
  if (!signals.megadesk.local || !signals.megadesk.app.reachable || !signals.megadesk.admin.reachable || !signals.megadesk.api.reachable) {
    level = "unavailable"; failures.push("MEGADESK_ENDPOINT_UNAVAILABLE"); recommendations.push("Execute o diagnóstico Windows se o MegaAdmin não estiver acessível.");
  }
  if (!signals.evolution.providerReachable) {
    level = maxLevel(level, "unavailable"); failures.push("EVOLUTION_PROVIDER_UNAVAILABLE"); recommendations.push("Verifique a disponibilidade do provedor antes de tentar conectar.");
  } else if (signals.evolution.states.includes("disconnected")) {
    level = maxLevel(level, "unavailable"); failures.push("WHATSAPP_DISCONNECTED"); recommendations.push("Use o fluxo normal Ir para conectar.");
  }
  if (signals.evolution.states.some(state => state === "webhook_degraded") || (signals.evolution.consecutiveWebhookFailures !== null && signals.evolution.consecutiveWebhookFailures >= HEALTH_THRESHOLDS.webhookFailures)) {
    level = maxLevel(level, "degraded"); failures.push("WEBHOOK_DEGRADED"); recommendations.push("Execute o diagnóstico e, se confirmado, use Reparar integração.");
  }
  if (signals.evolution.warningCounts.lid !== null && signals.evolution.warningCounts.lid >= HEALTH_THRESHOLDS.recurringLid) {
    level = maxLevel(level, "degraded"); failures.push("LID_ERRORS_RECURRING");
  } else if ((signals.evolution.warningCounts.lid ?? 0) > 0 || (signals.evolution.warningCounts.prisma ?? 0) > 0 || signals.evolution.states.includes("connecting")) {
    level = maxLevel(level, "attention"); warnings.push("PROVIDER_WARNING_ISOLATED");
  }
  if ([signals.critical.localCacheDisabled, signals.critical.redisDisabled, signals.critical.instancePreserved].some(value => value === false)
    || !signals.critical.webhookAuthenticated || !signals.evolution.canonicalEventsComplete) {
    level = maxLevel(level, "degraded"); failures.push("CRITICAL_CONFIGURATION_DIVERGENT");
  }
  if (signals.evolution.restartCount !== null && signals.evolution.restartCount >= HEALTH_THRESHOLDS.restartLoop) {
    level = maxLevel(level, "unavailable"); failures.push("RESTART_LOOP");
  }
  warnings.push("BACKUP_NOT_VERIFIABLE_BY_APPLICATION");
  level = maxLevel(level, "attention");
  return { level, warnings: [...new Set(warnings)], failures: [...new Set(failures)], recommendations: [...new Set(recommendations)] };
}

export function createSanitizedHealthReport(input: { checkpoint: string | null; signals: PlatformHealthSignals; checkedAt?: string; correlationId?: string }) {
  const assessment = classifyPlatformHealth(input.signals);
  return {
    schemaVersion: 1,
    timestamp: input.checkedAt ?? new Date().toISOString(),
    correlationId: input.correlationId ?? randomUUID(),
    version: "1.0.0",
    checkpoint: input.checkpoint,
    state: assessment.level,
    http: {
      local: input.signals.megadesk.local,
      app: input.signals.megadesk.app,
      admin: input.signals.megadesk.admin,
      api: input.signals.megadesk.api,
    },
    evolution: {
      providerReachable: input.signals.evolution.providerReachable,
      expectedInstances: input.signals.evolution.expectedInstances,
      foundInstances: input.signals.evolution.foundInstances,
      states: input.signals.evolution.states,
      webhookEnabled: input.signals.evolution.webhookEnabled,
      canonicalEventsComplete: input.signals.evolution.canonicalEventsComplete,
      consecutiveWebhookFailures: input.signals.evolution.consecutiveWebhookFailures,
      warningCounts: input.signals.evolution.warningCounts,
      restartCount: input.signals.evolution.restartCount,
    },
    critical: input.signals.critical,
    backup: { verifiableByApplication: false, externalToRepository: true },
    warnings: assessment.warnings,
    failures: assessment.failures,
    recommendations: assessment.recommendations,
  } as const;
}

export function serializeSanitizedHealthReport(report: ReturnType<typeof createSanitizedHealthReport>, maxBytes = 64 * 1024): string {
  const serialized = JSON.stringify(report, null, 2);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) throw new Error("SANITIZED_REPORT_TOO_LARGE");
  return serialized;
}
