[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
Import-Module (Join-Path $PSScriptRoot 'MegaDesk.Automation.psm1') -Force

try {
  Invoke-MegaDeskBootstrapFailedRecovery | Out-Null
  Write-Host 'Recovery Bootstrap Zero concluido; state V2 esta EMPTY.'
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
