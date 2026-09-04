[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{40}$')][string]$CandidateSha,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{40}$')][string]$MigrationBaselineSha,
  [switch]$RunTests
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
Import-Module (Join-Path $PSScriptRoot 'MegaDesk.Automation.psm1') -Force

try {
  Invoke-MegaDeskBootstrapZero -ExpectedBranch 'wip/conversations-0013-lifecycle' -CandidateSha $CandidateSha -MigrationBaselineSha $MigrationBaselineSha -RunTests:$RunTests
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
