[CmdletBinding()]
param([switch]$RunTests)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
Import-Module (Join-Path $PSScriptRoot 'MegaDesk.Automation.psm1') -Force

try {
  Invoke-MegaDeskUpdaterV2 -ExpectedBranch 'release/updater-v2-bootstrap' -RunTests:$RunTests
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
