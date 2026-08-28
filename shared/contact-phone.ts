export type PhoneNormalization =
  | { status: "empty"; value: null }
  | { status: "invalid"; value: null; reason: string }
  | { status: "valid"; value: string; country: "BR" | "international" };

export function normalizeContactPhone(input: string | null | undefined): PhoneNormalization {
  const raw = (input ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return { status: "empty", value: null };

  const explicitInternational = raw.startsWith("+") && !digits.startsWith("55");
  let value = !explicitInternational && (digits.length === 10 || digits.length === 11) ? `55${digits}` : digits;
  if (value.startsWith("55")) {
    if (value.length === 12 && /[6-9]/.test(value[4])) {
      value = `${value.slice(0, 4)}9${value.slice(4)}`;
    }
    if (value.length !== 12 && value.length !== 13) {
      return { status: "invalid", value: null, reason: "Informe DDD e um telefone brasileiro válido." };
    }
    return { status: "valid", value, country: "BR" };
  }

  if (value.length < 8 || value.length > 15) {
    return { status: "invalid", value: null, reason: "Informe um telefone internacional com DDI e tamanho válido." };
  }
  return { status: "valid", value, country: "international" };
}

export function sameContactPhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeContactPhone(a);
  const right = normalizeContactPhone(b);
  return left.status === "valid" && right.status === "valid" && left.value === right.value;
}
