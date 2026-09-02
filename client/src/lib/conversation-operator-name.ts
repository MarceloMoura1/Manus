const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Keeps legacy email snapshots out of the operator label shown in the timeline. */
export function operatorDisplayName(message: { agentName?: unknown } | null | undefined): string {
  const name = String(message?.agentName ?? "").trim();
  return name && !EMAIL_PATTERN.test(name) ? name : "Operador";
}
