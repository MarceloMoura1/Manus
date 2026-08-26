[CmdletBinding()]
param([switch]$NoBrowser)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'MegaDesk.Automation.psm1') -Force

$startedNodeRecord = $null
$startedTunnelRecord = $null
try {
  Write-MegaDeskLog 'Inicio seguro do MegaDesk solicitado.'
  Assert-MegaDeskToolchain
  Assert-DockerAndMySql
  Assert-MegaDeskArtifacts
  Assert-CloudflaredConfig
  $startedNodeRecord = Start-MegaDeskNode
  Wait-MegaDeskLocal
  $startedTunnelRecord = Start-MegaDeskTunnel
  Wait-MegaDeskPublicEndpoints
  if (-not $NoBrowser) {
    Start-Process 'https://app.megadesk.online/'
    Start-Process 'https://admin.megadesk.online/'
  }
  Write-MegaDeskLog 'MegaDesk iniciado e validado com sucesso.'
} catch {
  $startupError = $_.Exception.Message
  try {
    Undo-MegaDeskInvocation -StartedNodeRecord $startedNodeRecord -StartedTunnelRecord $startedTunnelRecord
  } catch {
    Write-MegaDeskLog ("Falha sanitizada durante rollback seletivo: {0}" -f $_.Exception.Message)
  }
  Write-MegaDeskLog ("Falha no inicio seguro: {0}" -f $startupError)
  Write-Error $startupError
  exit 1
}
