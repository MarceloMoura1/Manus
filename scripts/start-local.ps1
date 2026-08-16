$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env.local'
if (-not (Test-Path -LiteralPath $envFile)) { throw '.env.local not found. Run pnpm local:env:create first.' }
foreach ($line in Get-Content -LiteralPath $envFile) {
  if ($line -match '^\s*(#|$)') { continue }
  $parts = $line -split '=', 2
  if ($parts.Count -ne 2) { throw 'Invalid .env.local entry.' }
  [Environment]::SetEnvironmentVariable($parts[0], $parts[1], 'Process')
}
$health = docker inspect --format '{{.State.Health.Status}}' megadesk-local-mysql 2>$null
if ($LASTEXITCODE -ne 0 -or $health -ne 'healthy') { throw 'megadesk-local-mysql is not healthy.' }
& pnpm db:validate
if ($LASTEXITCODE -ne 0) { throw 'Canonical migration validation failed.' }
$env:NODE_ENV = 'development'
& pnpm exec tsx watch server/_core/index.ts
