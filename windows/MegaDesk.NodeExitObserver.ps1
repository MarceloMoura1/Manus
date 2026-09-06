[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$RequestPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $PSScriptRoot 'MegaDesk.Automation.psm1'
Import-Module $modulePath -Force
$automationModule = Get-Module 'MegaDesk.Automation'
if ($null -eq $automationModule) { throw 'Modulo de automacao MegaDesk indisponivel para exit telemetry.' }

$diagnosticsRoot = & $automationModule { $script:NodeDiagnosticsRoot }
$canonicalRequestPath = [System.IO.Path]::GetFullPath($RequestPath)
$canonicalDiagnosticsRoot = [System.IO.Path]::GetFullPath($diagnosticsRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
if (-not $canonicalRequestPath.StartsWith($canonicalDiagnosticsRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Solicitacao de exit telemetry fora do diretorio diagnostico permitido.'
}

$request = Get-Content -LiteralPath $canonicalRequestPath -Raw | ConvertFrom-Json
foreach ($property in @('schemaVersion', 'pid', 'invocationId', 'releaseSha', 'creationTime', 'executablePath', 'scriptPath', 'environmentPath', 'exitTelemetryPath')) {
  if (-not ($request.PSObject.Properties.Name -contains $property) -or [string]::IsNullOrWhiteSpace([string]$request.$property)) {
    throw "Solicitacao de exit telemetry sem $property."
  }
}
if ([int]$request.schemaVersion -ne 1) { throw 'schemaVersion de solicitacao de exit telemetry incompativel.' }

$record = [pscustomobject]@{
  pid = [int]$request.pid
  executablePath = [string]$request.executablePath
  startedAtUtc = [string]$request.creationTime
  releaseSha = [string]$request.releaseSha
  scriptPath = [string]$request.scriptPath
  environmentPath = [string]$request.environmentPath
}

$classification = 'UNKNOWN'
$exitCode = $null
$exitCodeAvailable = $false
while ($true) {
  try {
    $identityStatus = & $automationModule {
      param($ExpectedRecord)
      try {
        $snapshot = Get-ProcessSnapshotStrict -ProcessId ([int]$ExpectedRecord.pid)
      } catch {
        return 'UNKNOWN'
      }
      if ($null -eq $snapshot) { return 'PROCESS_DISAPPEARED' }
      if (Test-MegaDeskStaticProcessIdentity -Record $ExpectedRecord -Kind node) { return 'VALID' }
      return 'IDENTITY_LOST'
    } $record
  } catch {
    $identityStatus = 'UNKNOWN'
  }

  if ($identityStatus -eq 'PROCESS_DISAPPEARED') {
    $classification = 'PROCESS_DISAPPEARED'
    break
  }
  if ($identityStatus -eq 'IDENTITY_LOST') {
    $classification = 'IDENTITY_LOST'
    break
  }
  if ($identityStatus -ne 'VALID') {
    Start-Sleep -Seconds 1
    continue
  }

  $process = $null
  try {
    $process = [System.Diagnostics.Process]::GetProcessById([int]$record.pid)
    $expectedCreation = [DateTime]::Parse([string]$record.startedAtUtc).ToUniversalTime()
    $actualCreation = $process.StartTime.ToUniversalTime()
    if ([Math]::Abs(($actualCreation - $expectedCreation).TotalMilliseconds) -gt 1) {
      $classification = 'IDENTITY_LOST'
      break
    }
    $process.WaitForExit()
    try {
      $exitCode = [int]$process.ExitCode
      $exitCodeAvailable = $true
      $classification = 'EXITED_WITH_CODE'
    } catch {
      $classification = 'UNKNOWN'
    }
    break
  } catch {
    if ($null -eq (Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue)) {
      $classification = 'PROCESS_DISAPPEARED'
      break
    }
    Start-Sleep -Seconds 1
  } finally {
    if ($null -ne $process) { $process.Dispose() }
  }
}

$observedExitTime = (Get-Date).ToUniversalTime().ToString('o')
Write-MegaDeskNodeExitTelemetry -Path ([string]$request.exitTelemetryPath) -Pid ([int]$request.pid) -InvocationId ([string]$request.invocationId) -ReleaseSha ([string]$request.releaseSha) -CreationTime ([string]$request.creationTime) -ObservedExitTime $observedExitTime -ExitCode $exitCode -ExitCodeAvailable $exitCodeAvailable -Classification $classification
