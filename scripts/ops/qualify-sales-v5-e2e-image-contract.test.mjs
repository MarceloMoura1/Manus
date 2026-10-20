import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptsDirectory, "..", "..");

async function text(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("Sales V5 E2E ARM64 image qualification contracts", () => {
  it("keeps the checked-in Dockerfile non-buildable and free of dynamic base arguments", async () => {
    const dockerfile = await text("Dockerfile.e2e-arm64");
    const generator = await text("scripts/ops/generate-sales-v5-e2e-dockerfile.mjs");
    assert.match(dockerfile, /^FROM scratch$/m);
    assert.match(dockerfile, /RUN \["\/bin\/false"\]/);
    assert.doesNotMatch(dockerfile, /^ARG\s+NODE_BASE_IMAGE/m);
    assert.doesNotMatch(dockerfile, /^FROM .*\$\{/m);
    assert.doesNotMatch(dockerfile, /NODE_BASE_IMAGE|--build-arg/);
    assert.doesNotMatch(generator, /argv\[0\]\s*===\s*["']--(?:manifest|policy)["']|NODE_BASE_IMAGE|--build-arg/);
    assert.match(generator, /path\.join\(repoRoot, PROVENANCE_RELATIVE_PATH\)/);
    assert.match(generator, /path\.join\(repoRoot, POLICY_RELATIVE_PATH\)/);
  });

  it("keeps the future workflow manual, minimally privileged, pinned, and non-publishing", async () => {
    const workflow = await text(".github/workflows/qualify-sales-v5-e2e-image-arm64.yml");
    assert.ok(workflow.includes("workflow_dispatch:"));
    assert.ok(workflow.includes("contents: read"));
    // Inspect executable YAML lines rather than explanatory comments, which
    // intentionally mention packages:write as a permission that is absent.
    assert.doesNotMatch(workflow, /^\s*packages:\s*write\s*$/mi);
    assert.doesNotMatch(workflow, /^\s*docker\s+(?:login|push)\b/mi);
    assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./i);
    assert.ok(workflow.includes("runs-on: ubuntu-24.04-arm"));
    assert.match(workflow, /uses:\s*actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
    assert.match(workflow, /uses:\s*actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
    assert.match(workflow, /uses:\s*pnpm\/action-setup@9fd676a19091d4595eefd76e4bd31c97133911f1/);
    assert.match(workflow, /uses:\s*actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
    assert.doesNotMatch(workflow, /^\s*uses:\s*[^\n@]+@v\d+/m);
    assert.ok(workflow.includes("persist-credentials: false"));
    assert.ok(workflow.includes("EXPECTED_NODE: v22.23.2"));
    assert.ok(workflow.includes("EXPECTED_PNPM: 10.18.0"));
    assert.ok(workflow.includes('test "$(node --version)" = "$EXPECTED_NODE"'));
    assert.ok(workflow.includes('test "$(pnpm --version)" = "$EXPECTED_PNPM"'));
    assert.ok(workflow.includes("--require-approved"));
    assert.ok(workflow.includes("--verify-evidence"));
    assert.ok(workflow.includes("--allow-external-archive"));
    assert.ok(workflow.indexOf("--require-approved") < workflow.indexOf("docker build"));
    assert.ok(workflow.includes("prepare-sales-v5-e2e-image-context.mjs"));
    assert.ok(workflow.includes("validate-sales-v5-e2e-oci.mjs"));
    assert.doesNotMatch(workflow, /node_base_image|apt_snapshot|pnpm_tarball|--build-arg|NODE_BASE_IMAGE/);
    assert.ok(workflow.includes("test \"$(uname -m)\" = aarch64"));
    assert.ok(workflow.includes("test \"$(docker info --format '{{.OSType}}/{{.Architecture}}')\" = linux/arm64"));
    assert.ok(workflow.includes("--network none --read-only --cap-drop ALL"));
    assert.ok(workflow.includes("--security-opt no-new-privileges:true"));
    assert.ok(workflow.includes('base_platform="$(docker image inspect "$source_reference" --format \'{{.Os}}/{{.Architecture}}\')"'));
    assert.ok(workflow.includes('final_platform="$(docker image inspect "$LOCAL_IMAGE" --format \'{{.Os}}/{{.Architecture}}\')"'));
    assert.ok(workflow.includes('test "$base_platform" = linux/arm64'));
    assert.ok(workflow.includes('test "$final_platform" = linux/arm64'));
    assert.ok(workflow.includes("approvedSourceReference="));
    assert.ok(workflow.includes("finalId={{.Id}}"));
    assert.ok(workflow.indexOf("Validate approved Chromium provenance before Docker") < workflow.indexOf("pnpm install --frozen-lockfile"));
    assert.ok(workflow.indexOf("Validate approved Chromium provenance before Docker") < workflow.indexOf("Acquire exactly the approved Chromium archive before Docker"));
    assert.ok(workflow.indexOf("Acquire exactly the approved Chromium archive before Docker") < workflow.indexOf("docker build"));
    assert.match(workflow, /printf '%s  %s\\n' "\$expected_sha" "\$archive" \| sha256sum --check --status/);
    assert.match(workflow, /docker buildx build --pull=false --platform linux\/arm64 --output "type=oci,dest=\$oci_archive"/);
    assert.match(workflow, /record-sales-v5-e2e-oci-layout\.mjs/);
  });

  it("excludes operator environment files and dependency output from the Docker context", async () => {
    const dockerignore = await text(".dockerignore");
    assert.ok(dockerignore.includes("**"));
    assert.ok(dockerignore.includes("!package.json"));
    assert.ok(dockerignore.includes("!pnpm-lock.yaml"));
    assert.ok(dockerignore.includes("!.github/qualification-provenance/**"));
    assert.ok(dockerignore.includes("!third_party/e2e-chromium/**"));
    assert.ok(!dockerignore.includes("!.env"));
  });

  it("pins and isolates the project checkout and checks inputs before installation and context creation", async () => {
    const workflow = await text(".github/workflows/qualify-sales-v5-e2e-image-arm64.yml");
    const commit = "6d39f5944a39258e9e0411992c18f48742ad5f4c";
    assert.match(workflow, new RegExp(`PROJECT_COMMIT: ${commit}`));
    assert.match(workflow, new RegExp(`ref: ${commit}\\n\\s+path: project\\n\\s+persist-credentials: false`));
    assert.equal((workflow.match(/uses:\s*actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/g) || []).length, 2);
    assert.doesNotMatch(workflow, /^\s*ref:\s*(?:main|refs\/heads\/|v\d)/m);
    assert.match(workflow, /git -C project rev-parse HEAD\)" = "\$PROJECT_COMMIT"/);
    assert.match(workflow, /git -C project status --porcelain --untracked-files=all/);
    assert.match(workflow, /diff -r --no-dereference \.github\/qualification-provenance project\/\.github\/qualification-provenance/);
    assert.match(workflow, /cmp "scripts\/ops\/\$file" "project\/scripts\/ops\/\$file"/);
    assert.match(workflow, /working-directory: project\n\s+run: pnpm install --frozen-lockfile/);
    assert.match(workflow, /cd project\n\s+test "\$\(git rev-parse HEAD\)" = "\$PROJECT_COMMIT"/);
    assert.match(workflow, /git ls-files --others --ignored --exclude-standard -- patches \.github\/qualification-provenance scripts\/ops/);
    assert.match(workflow, /src="\$GITHUB_WORKSPACE\/project",dst=\/workspace,readonly/);
    assert.ok(workflow.indexOf("Verify fixed project and qualification inputs") < workflow.indexOf("Validate approved Chromium provenance before Docker"));
    assert.ok(workflow.indexOf("Validate approved Chromium provenance before Docker") < workflow.indexOf("Install frozen checkout dependencies after provenance approval"));
    assert.ok(workflow.indexOf("Install frozen checkout dependencies after provenance approval") < workflow.indexOf("Freeze and verify the sole Docker build context"));
  });

  it("rejects mutated workflow contracts for mobile refs, ambiguous checkouts, contaminated inputs and wrong directories", async () => {
    const workflow = await text(".github/workflows/qualify-sales-v5-e2e-image-arm64.yml");
    function assertIsolation(value) {
      assert.match(value, /ref: 6d39f5944a39258e9e0411992c18f48742ad5f4c\n\s+path: project\n\s+persist-credentials: false/);
      assert.match(value, /git -C project status --porcelain --untracked-files=all/);
      assert.match(value, /git ls-files --others --ignored --exclude-standard -- patches \.github\/qualification-provenance scripts\/ops/);
      assert.match(value, /working-directory: project\n\s+run: pnpm install --frozen-lockfile/);
      assert.match(value, /cd project\n\s+test "\$\(git rev-parse HEAD\)" = "\$PROJECT_COMMIT"/);
      assert.match(value, /src="\$GITHUB_WORKSPACE\/project",dst=\/workspace,readonly/);
    }
    assertIsolation(workflow);
    for (const [before, after] of [
      ["ref: 6d39f5944a39258e9e0411992c18f48742ad5f4c", "ref: main"],
      ["path: project", "path: another"],
      ["git -C project status --porcelain --untracked-files=all", "true"],
      ["git ls-files --others --ignored --exclude-standard -- patches .github/qualification-provenance scripts/ops", "true"],
      ["working-directory: project", "working-directory: ."],
      ["cd project\n", "cd .\n"],
      ['src="$GITHUB_WORKSPACE/project",dst=/workspace,readonly', 'src="$GITHUB_WORKSPACE",dst=/workspace,readonly'],
    ]) {
      assert.ok(workflow.includes(before));
      assert.throws(() => assertIsolation(workflow.replace(before, after)));
    }
  });
});
