const SAFE_TEST_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "mysql-test"]);
const SAFE_TEST_DATABASE_NAME = /^megadesk_test(?:_[a-z0-9]+(?:_[a-z0-9]+)*)?$/;

function configurationError(message: string): Error {
  return new Error(`Configuração de integração MySQL inválida: ${message}`);
}

export function validateTestDatabaseUrl(value: string | undefined): string {
  if (!value) throw configurationError("TEST_DATABASE_URL é obrigatória.");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw configurationError("TEST_DATABASE_URL não é uma URL válida.");
  }

  if (parsed.protocol !== "mysql:") {
    throw configurationError("somente o protocolo mysql: é aceito.");
  }
  if (!SAFE_TEST_DATABASE_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw configurationError("o host não pertence à lista segura de testes.");
  }

  const databaseName = decodeURIComponent(parsed.pathname.slice(1)).toLowerCase();
  if (!SAFE_TEST_DATABASE_NAME.test(databaseName)) {
    throw configurationError("o banco deve se chamar megadesk_test ou megadesk_test_<identificador>.");
  }
  return value;
}

export function getTestDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.RUN_DATABASE_INTEGRATION !== "1") {
    throw configurationError("RUN_DATABASE_INTEGRATION deve ser exatamente 1.");
  }
  return validateTestDatabaseUrl(environment.TEST_DATABASE_URL);
}

export function isTestDatabaseEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  if (environment.RUN_DATABASE_INTEGRATION !== "1") return false;
  getTestDatabaseUrl(environment);
  return true;
}

export const safeTestDatabaseHosts = Object.freeze([...SAFE_TEST_DATABASE_HOSTS]);

const SAFE_EVOLUTION_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "evolution-test"]);

export function validateEvolutionTestConfig(environment: NodeJS.ProcessEnv = process.env): { apiUrl: string; apiKey: string } {
  if (environment.RUN_EVOLUTION_E2E !== "1") throw new Error("Evolution E2E exige RUN_EVOLUTION_E2E=1.");
  const apiUrl = environment.EVOLUTION_API_URL;
  const apiKey = environment.EVOLUTION_API_KEY;
  if (!apiUrl || !apiKey) throw new Error("Evolution E2E exige URL e chave explícitas de teste.");
  let parsed: URL;
  try { parsed = new URL(apiUrl); } catch { throw new Error("Endpoint Evolution de teste inválido."); }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) throw new Error("Protocolo do endpoint Evolution de teste inválido.");
  if (!SAFE_EVOLUTION_HOSTS.has(parsed.hostname.toLowerCase())) throw new Error("Host Evolution não pertence à lista segura de testes.");
  return { apiUrl, apiKey };
}
