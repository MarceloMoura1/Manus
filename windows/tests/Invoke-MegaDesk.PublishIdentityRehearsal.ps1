[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $PSScriptRoot '..\MegaDesk.Automation.psm1'
$module = Import-Module $modulePath -Force -PassThru
$nodeCommand = Get-Command node -ErrorAction Stop
$sha = 'abababababababababababababababababababab'
$nonce = [guid]::NewGuid().ToString('N')
$root = Join-Path ([IO.Path]::GetTempPath()) ('megadesk_identity_rehearsal_' + [guid]::NewGuid().ToString('N'))
$process = $null
$port = 0
$result = [ordered]@{
  environment = 'TEMP_ISOLATED_SYNTHETIC_NODE'
  port = 0
  managedIdentity = 'NOT_RUN'
  stalePid = 'NOT_RUN'
  pidReuse = 'NOT_RUN'
  unknownPortOwner = 'NOT_RUN'
  unknownOwnerKilled = 'UNKNOWN'
  releaseHealthBinding = 'NOT_RUN'
  duplicateListenerCount = -1
  productionPort3000Used = 'NO'
  productionEnvUsed = 'NO'
  cleanup = 'NOT_RUN'
}

try {
  if (Test-Path -LiteralPath $root) { throw 'Raiz descartavel inesperadamente preexistente.' }
  New-Item -ItemType Directory -Path $root | Out-Null
  $runtimeRoot = Join-Path $root 'runtime'
  $projectRoot = Join-Path $root 'project'
  $configRoot = Join-Path $root 'config'
  $scriptPath = Join-Path $runtimeRoot ('releases\{0}\dist\index.js' -f $sha)
  $environmentPath = Join-Path $configRoot '.env.synthetic'
  New-Item -ItemType Directory -Path $projectRoot | Out-Null
  New-Item -ItemType Directory -Path $configRoot | Out-Null
  New-Item -ItemType Directory -Path (Split-Path -Parent $scriptPath) | Out-Null
  Set-Content -LiteralPath $environmentPath -Value 'MEGADESK_REHEARSAL_ONLY=1' -Encoding ASCII -NoNewline
  @'
import http from "node:http";
const sha = process.env.MEGADESK_RELEASE_SHA;
const port = Number(process.env.PORT);
http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/healthz") {
    res.statusCode = 200;
    res.end(JSON.stringify({status:"healthy", release:{sha}}));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({status:"not_found"}));
}).listen(port, "127.0.0.1");
'@ | Set-Content -LiteralPath $scriptPath -Encoding UTF8 -NoNewline

  foreach ($candidatePort in 33120..33220) {
    if ($candidatePort -eq 3000) { continue }
    $listener = @(Get-NetTCPConnection -LocalPort $candidatePort -State Listen -ErrorAction SilentlyContinue)
    if ($listener.Count -eq 0) { $port = $candidatePort; break }
  }
  if ($port -eq 0 -or $port -eq 3000) { throw 'Nenhuma porta isolada segura foi encontrada.' }
  $result.port = $port
  $testToken = [guid]::NewGuid().ToString('N')
  $env:MEGADESK_TEST_TOKEN = $testToken
  Enable-MegaDeskTestContext -TestRoot $root -Token $testToken
  & $module { param($runtime, $project, $config, $testPort) Set-MegaDeskAutomationPaths -RuntimeRoot $runtime -ProjectRoot $project -RuntimeConfigRoot $config -Port $testPort } $runtimeRoot $projectRoot $configRoot $port

  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = [string]$nodeCommand.Source
  $psi.Arguments = '--env-file="{0}" "{1}" --megadesk-runtime-id={2}' -f $environmentPath, $scriptPath, $nonce
  $psi.WorkingDirectory = $root
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['NODE_ENV'] = 'test'
  $psi.EnvironmentVariables['HOST'] = '127.0.0.1'
  $psi.EnvironmentVariables['PORT'] = [string]$port
  $psi.EnvironmentVariables['MEGADESK_RELEASE_SHA'] = $sha
  $process = [Diagnostics.Process]::Start($psi)

  $deadline = (Get-Date).AddSeconds(20)
  $health = $null
  do {
    if ($process.HasExited) { throw ('Node sintetico encerrou com exitCode={0}.' -f $process.ExitCode) }
    try {
      $health = Invoke-RestMethod -Uri ('http://127.0.0.1:{0}/healthz' -f $port) -TimeoutSec 1
      if ([string]$health.status -eq 'healthy') { break }
    } catch { }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)
  if ($null -eq $health -or [string]$health.release.sha -cne $sha) { throw 'Health sintetico nao vinculou o SHA esperado.' }
  $result.releaseHealthBinding = 'PASS'

  $snapshot = Get-CimInstance Win32_Process -Filter ('ProcessId = {0}' -f $process.Id) -ErrorAction Stop
  $snapshotStartUtc = & $module { param($value) (ConvertTo-MegaDeskProcessStartUtc -Value $value).ToString('o') } $snapshot.CreationDate
  $record = [pscustomobject]@{
    pid = [int]$process.Id
    executablePath = [string]$snapshot.ExecutablePath
    startedAtUtc = $snapshotStartUtc
    projectRoot = $configRoot
    configPath = ''
    scriptPath = $scriptPath
    environmentPath = $environmentPath
    releaseSha = $sha
    port = $port
    runtimeInstanceId = $nonce
  }
  if (-not (Test-ManagedProcess -Record $record -Kind node)) {
    $evidence = & $module {
      param($r, $s)
      $parsed = try { @(ConvertFrom-MegaDeskWindowsCommandLine -CommandLine ([string]$s.CommandLine)) } catch { @() }
      [ordered]@{
        executableMatches = Test-MegaDeskSamePath -Left ([string]$s.ExecutablePath) -Right ([string]$r.executablePath)
        argumentCount = $parsed.Count
        commandIdentity = Test-MegaDeskNodeCommandLine -Process $s -Record $r
        staticIdentity = Test-MegaDeskStaticProcessSnapshotIdentity -Record $r -Kind node -Process $s
        portOwned = Test-MegaDeskPortOwnedByProcess -Port ([int]$r.port) -ProcessId ([int]$r.pid)
      }
    } $record $snapshot
    throw ('Identidade composta do Node sintetico nao foi comprovada: {0}' -f ($evidence | ConvertTo-Json -Compress))
  }
  $result.managedIdentity = 'PASS'

  $staleRecord = $record | ConvertTo-Json -Depth 8 | ConvertFrom-Json
  $staleRecord.pid = 2147483000
  $staleStatus = & $module { param($r) Get-MegaDeskManagedProcessStatus -Record $r -Kind node } $staleRecord
  if ($staleStatus -cne 'ABSENT') { throw ('PID stale classificado como {0}.' -f $staleStatus) }
  $result.stalePid = 'PASS_ABSENT'

  $reusedRecord = $record | ConvertTo-Json -Depth 8 | ConvertFrom-Json
  $reusedRecord.startedAtUtc = $process.StartTime.ToUniversalTime().AddMinutes(-1).ToString('o')
  $reuseStatus = & $module { param($r) Get-MegaDeskManagedProcessStatus -Record $r -Kind node } $reusedRecord
  if ($reuseStatus -cne 'IDENTITY_MISMATCH') { throw ('PID reuse sintetico classificado como {0}.' -f $reuseStatus) }
  if ($process.HasExited) { throw 'Processo sintetico foi encerrado durante classificacao de PID reuse.' }
  $result.pidReuse = 'PASS_IDENTITY_MISMATCH_NO_KILL'

  $ownership = & $module { param($p) Get-MegaDeskPortOwnership -Port $p } $port
  if ([string]$ownership.status -cne 'OWNED_BY_EXTERNAL_PROCESS') { throw ('Owner sem record classificado como {0}.' -f $ownership.status) }
  $blocked = $false
  try { & $module { param($p) Assert-MegaDeskPortFree -Port $p -Operation 'rehearsal unknown owner' } $port } catch { $blocked = $true }
  if (-not $blocked -or $process.HasExited) { throw 'Unknown owner nao ficou fail-closed ou foi encerrado.' }
  $result.unknownPortOwner = 'PASS_FAIL_CLOSED'
  $result.unknownOwnerKilled = 'NO'

  $owners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
  $result.duplicateListenerCount = $owners.Count
  if ($owners.Count -ne 1 -or [int]$owners[0] -ne [int]$process.Id) { throw 'Listener sintetico nao possui ownership unico.' }
} finally {
  if ($null -ne $process) {
    try {
      if (-not $process.HasExited) {
        Stop-Process -InputObject $process -ErrorAction Stop
        [void]$process.WaitForExit(10000)
      }
    } finally { $process.Dispose() }
  }
  if (Test-Path -LiteralPath $root) {
    $canonicalRoot = [IO.Path]::GetFullPath($root)
    $canonicalTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $canonicalRoot.StartsWith($canonicalTemp, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($canonicalRoot) -notmatch '^megadesk_identity_rehearsal_[0-9a-f]{32}$') { throw 'Cleanup descartavel recusado por identidade.' }
    Remove-Item -LiteralPath $canonicalRoot -Recurse -Force
  }
  $result.cleanup = if (Test-Path -LiteralPath $root) { 'FAILED' } else { 'PASS' }
}

$result.GetEnumerator() | ForEach-Object { '{0}={1}' -f $_.Key.ToUpperInvariant(), $_.Value }
