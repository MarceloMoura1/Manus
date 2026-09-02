export type ProviderMessageReference = {
  key: Record<string, unknown> & { id: string };
  message: Record<string, unknown>;
};

const MAX_PROVIDER_REFERENCE_BYTES = 512_000;
const MAX_DEPTH = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Evolution sends the original Baileys key and message in its webhook/send
 * response. Keep that quote source compact: binary webhook payloads are never
 * needed by the provider to build a quote and must not enter this column.
 */
function stripBinary(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(item => stripBinary(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === "base64" || key === "mediaData" || key === "dataUrl") continue;
    result[key] = stripBinary(nested, depth + 1);
  }
  return result;
}

export function normalizeProviderMessageReference(value: unknown): ProviderMessageReference | null {
  let raw = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  if (!isRecord(raw) || !isRecord(raw.key) || !isRecord(raw.message)) return null;
  const id = typeof raw.key.id === "string" ? raw.key.id.trim() : "";
  if (!id || id.length > 180) return null;
  const reference: ProviderMessageReference = {
    key: { ...stripBinary(raw.key) as Record<string, unknown>, id },
    message: stripBinary(raw.message) as Record<string, unknown>,
  };
  try {
    if (Buffer.byteLength(JSON.stringify(reference), "utf8") > MAX_PROVIDER_REFERENCE_BYTES) return null;
  } catch {
    return null;
  }
  return reference;
}
