import { pathToFileURL } from "node:url";

// Compatibility guard for the first qualification draft. Image, APT and pnpm
// origins are no longer command-line inputs because Docker resolves FROM
// before any RUN instruction can validate an argument.
export function rejectLegacyBuildInputs() {
  throw new Error(
    "Entradas livres de build foram removidas: use o manifesto de proveniencia aprovado e o gerador deterministico.",
  );
}

export function validateQualificationInputs() {
  return rejectLegacyBuildInputs();
}

function parseArguments() {
  return {};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(validateQualificationInputs(parseArguments(process.argv.slice(2))))}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Falha ao validar entradas da imagem E2E.");
    process.exitCode = 2;
  }
}
