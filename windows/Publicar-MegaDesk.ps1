[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$Confirmation
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
Import-Module (Join-Path $PSScriptRoot 'MegaDesk.Automation.psm1') -Force

try {
  if ($PSBoundParameters.ContainsKey('Confirmation')) {
    Invoke-MegaDeskPreparedReleasePublish -ExpectedBranch 'release/updater-v2-bootstrap' -Confirmation $Confirmation
  } else {
    Invoke-MegaDeskPreparedReleasePublish -ExpectedBranch 'release/updater-v2-bootstrap'
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
