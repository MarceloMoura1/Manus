import { assistantRoutinesRepository } from "./routines-repository";
import { executeRoutine } from "./routine-executor";

export function getCurrentSaoPauloTimeAndDay(date = new Date()): {
  timeString: string;
  dayKey: string;
} {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  let hour = "00";
  let minute = "00";
  let weekdayStr = "";
  for (const p of parts) {
    if (p.type === "hour") hour = p.value.padStart(2, "0");
    if (p.type === "minute") minute = p.value.padStart(2, "0");
    if (p.type === "weekday") weekdayStr = p.value.toLowerCase();
  }
  const timeString = `${hour}:${minute}`;

  let dayKey = "seg";
  if (weekdayStr.includes("dom")) dayKey = "dom";
  else if (weekdayStr.includes("seg")) dayKey = "seg";
  else if (weekdayStr.includes("ter")) dayKey = "ter";
  else if (weekdayStr.includes("qua")) dayKey = "qua";
  else if (weekdayStr.includes("qui")) dayKey = "qui";
  else if (weekdayStr.includes("sex")) dayKey = "sex";
  else if (weekdayStr.includes("sáb") || weekdayStr.includes("sab")) dayKey = "sab";

  return { timeString, dayKey };
}

let schedulerTimer: NodeJS.Timeout | null = null;
let isChecking = false;

export async function checkAndRunScheduledRoutines(
  currentTimeOverride?: { timeString: string; dayKey: string }
): Promise<number> {
  if (isChecking) return 0;
  isChecking = true;

  try {
    const { timeString, dayKey } = currentTimeOverride || getCurrentSaoPauloTimeAndDay();
    const activeRoutines = await assistantRoutinesRepository.getActiveRoutines();
    let triggeredCount = 0;

    for (const routine of activeRoutines) {
      if (!routine.isActive) continue;

      // Verifica dia da semana
      const days = Array.isArray(routine.scheduleDays) ? routine.scheduleDays : [];
      if (!days.includes(dayKey)) continue;

      // Verifica horário programado (ex: "08:30")
      if (routine.scheduleTime !== timeString) continue;

      // Evita execução duplicada no mesmo minuto
      if (routine.lastRunAt) {
        const diffMs = Date.now() - new Date(routine.lastRunAt).getTime();
        if (diffMs < 65000) {
          continue;
        }
      }

      triggeredCount++;
      // Dispara em background sem travar o loop
      executeRoutine(routine).catch((err) => {
        console.error(`[RoutineScheduler] Erro ao disparar rotina ${routine.id}:`, err?.message || err);
      });
    }

    return triggeredCount;
  } catch (error: any) {
    console.error("[RoutineScheduler] Erro no ciclo de verificação:", error?.message || error);
    return 0;
  } finally {
    isChecking = false;
  }
}

export function startRoutineScheduler(intervalMs = 60000): void {
  if (schedulerTimer) return;
  if (process.env.VITEST === "true") return;

  console.log("[RoutineScheduler] Agendador de rotinas autônomas iniciado.");
  schedulerTimer = setInterval(() => {
    checkAndRunScheduledRoutines().catch(() => {});
  }, intervalMs);

  schedulerTimer.unref();
}

export function stopRoutineScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log("[RoutineScheduler] Agendador de rotinas encerrado.");
  }
}

