import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { POLICY_RELATIVE_PATH, PROVENANCE_RELATIVE_PATH, loadAndValidateProvenance } from "./validate-sales-v5-e2e-image-provenance.mjs";

function shell(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function dockerCopy(source, destination) {
  return `COPY ${JSON.stringify([source, destination])}`;
}

export function renderDockerfile(validated) {
  if (!validated || validated.status !== "approved") throw new Error("Geracao exige proveniencia aprovada");
  const { sourceImage, buildInputs, archive } = validated.candidate;
  const sourceReference = `${sourceImage.repository}@${sourceImage.platformManifestDigest}`;
  const archiveDestination = archive.format === "zip" ? "/tmp/chromium.zip" : "/tmp/chromium.tar.gz";
  const extractDirectory = `/opt/ms-playwright/chromium-${validated.candidate.playwright.chromiumRevision}`;
  const archiveInstall = archive.format === "zip"
    ? `node /usr/local/lib/validate-sales-v5-e2e-tar.mjs --archive ${archiveDestination} --format zip; \\
    unzip -tq ${archiveDestination}; \\
    install -d -m 0755 ${extractDirectory}; \\
    unzip -qq ${archiveDestination} -d ${extractDirectory}; \\
    chmod 0755 ${extractDirectory}/chrome-linux/chrome;`
    : `node /usr/local/lib/validate-sales-v5-e2e-tar.mjs --archive ${archiveDestination} --format tar.gz; \\
    tar -xzf ${archiveDestination} --no-same-owner --no-same-permissions -C /opt/ms-playwright;`;
  return `# syntax=docker/dockerfile:1.7
# Generated from ${PROVENANCE_RELATIVE_PATH}. Do not hand-edit.
FROM --platform=linux/arm64 ${sourceReference}

ENV DEBIAN_FRONTEND=noninteractive \\
    HOME=/tmp \\
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

RUN set -eux; \\
    rm -f /etc/apt/sources.list; \\
    rm -f /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; \\
    printf 'deb [check-valid-until=no] %s bookworm main\\n' ${shell(buildInputs.aptSnapshot)} > /etc/apt/sources.list; \\
    apt-get -o Acquire::Check-Valid-Until=false update; \\
    apt-get install -y --no-install-recommends ca-certificates curl unzip fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libegl1 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libwayland-client0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2; \\
    rm -rf /var/lib/apt/lists/*; \\
    test "$(node --version)" = ${shell(validated.expected.nodeVersion)}; \\
    command -v corepack; \\
    curl --fail --location --proto '=https' --tlsv1.2 --output /tmp/pnpm.tgz ${shell(buildInputs.pnpmTarball.url)}; \\
    printf '%s  %s\\n' ${shell(buildInputs.pnpmTarball.sha256)} /tmp/pnpm.tgz | sha256sum --check --status; \\
    corepack disable pnpm; \\
    npm install --global --ignore-scripts /tmp/pnpm.tgz; \\
    rm -f /tmp/pnpm.tgz; \\
    test "$(pnpm --version)" = ${shell(validated.expected.pnpmVersion)}; \\
    install -d -m 0755 /opt/ms-playwright

${dockerCopy(archive.relativePath, archiveDestination)}
${dockerCopy(archive.extractedFilesManifest.relativePath, "/tmp/extracted-files.manifest")}
${dockerCopy("scripts/ops/validate-sales-v5-e2e-tar.mjs", "/usr/local/lib/validate-sales-v5-e2e-tar.mjs")}
${dockerCopy(PROVENANCE_RELATIVE_PATH, "/opt/megadesk-e2e-image-provenance.json")}
${dockerCopy(POLICY_RELATIVE_PATH, "/opt/megadesk-e2e-trust-policy.json")}
RUN set -eux; \\
    test "$(stat -c %s ${archiveDestination})" = ${shell(String(archive.sizeBytes))}; \\
    printf '%s  %s\\n' ${shell(archive.sha256)} ${archiveDestination} | sha256sum --check --status; \\
    test "$(stat -c %s /tmp/extracted-files.manifest)" = ${shell(String(archive.extractedFilesManifest.sizeBytes))}; \\
    printf '%s  %s\\n' ${shell(archive.extractedFilesManifest.sha256)} /tmp/extracted-files.manifest | sha256sum --check --status; \\
    ${archiveInstall} \\
    node /usr/local/lib/validate-sales-v5-e2e-tar.mjs --verify-extracted --root /opt/ms-playwright --manifest /tmp/extracted-files.manifest; \\
    rm -f ${archiveDestination} /tmp/extracted-files.manifest

WORKDIR /opt/megadesk-e2e-image-build
${dockerCopy("package.json", "./")}
${dockerCopy("pnpm-lock.yaml", "./")}
${dockerCopy("pnpm-workspace.yaml", "./")}
${dockerCopy("patches", "./patches")}
RUN set -eux; \\
    pnpm install --frozen-lockfile; \\
    test "$(node -p \\\"require('@playwright/test/package.json').version\\\")" = ${shell(validated.expected.playwrightVersion)}

WORKDIR /workspace
USER 0:0
`;
}

export async function generateDockerfile({ repoRoot = process.cwd(), outputPath, dependencies } = {}) {
  if (typeof outputPath !== "string" || outputPath.length === 0) throw new Error("Geracao exige caminho de saida");
  const validated = await loadAndValidateProvenance(path.join(repoRoot, PROVENANCE_RELATIVE_PATH), {
    requireApproved: true,
    verifyEvidence: true,
    repoRoot,
    policyPath: path.join(repoRoot, POLICY_RELATIVE_PATH),
    dependencies,
  });
  const dockerfile = renderDockerfile(validated);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, dockerfile, "utf8");
  return Object.freeze({ outputPath, sourceReference: `${validated.candidate.sourceImage.repository}@${validated.candidate.sourceImage.platformManifestDigest}`, dockerfile });
}

function cliOptions(argv) {
  if (argv.length !== 2 || argv[0] !== "--output") throw new Error("uso: --output <Dockerfile>");
  return { outputPath: argv[1] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = cliOptions(process.argv.slice(2));
    generateDockerfile({ ...options, repoRoot: process.cwd() })
      .then(result => process.stdout.write(`${JSON.stringify({ outputPath: result.outputPath, sourceReference: result.sourceReference })}\n`))
      .catch(error => {
        console.error(error instanceof Error ? error.message : "Falha ao gerar Dockerfile.");
        process.exitCode = error && typeof error === "object" && "exitCode" in error ? error.exitCode : 2;
      });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Falha ao interpretar argumentos.");
    process.exitCode = 2;
  }
}
