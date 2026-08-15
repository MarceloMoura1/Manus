export type EvolutionConfig = { apiUrl: string; apiKey: string };

function requiredEnvironmentVariable(name: "EVOLUTION_API_URL" | "EVOLUTION_API_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Configuração da Evolution inválida: defina ${name}.`);
  return value;
}

export function getEvolutionConfig(): EvolutionConfig {
  const rawUrl = requiredEnvironmentVariable("EVOLUTION_API_URL");
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new Error("Configuração da Evolution inválida: EVOLUTION_API_URL deve ser uma URL válida."); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Configuração da Evolution inválida: EVOLUTION_API_URL deve usar HTTP(S) e não pode conter credenciais.");
  }
  parsed.search = "";
  parsed.hash = "";
  return {
    apiUrl: parsed.toString().replace(/\/$/, ""),
    apiKey: requiredEnvironmentVariable("EVOLUTION_API_KEY"),
  };
}

export function getEvolutionSafeOrigin(): string {
  const url = new URL(getEvolutionConfig().apiUrl);
  return `${url.protocol}//${url.host}`;
}
