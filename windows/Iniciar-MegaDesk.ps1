[CmdletBinding()]
param([switch]$NoBrowser)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'MegaDesk.Automation.psm1') -Force

$startedNodeRecord = $null
$startedTunnelRecord = $null
try {
  Write-MegaDeskLog 'Inicio seguro do MegaDesk solicitado.'
  $state = Get-MegaDeskState
  if ($null -eq $state.operation -or [string]$state.operation.status -cne 'ACTIVE') {
    throw 'Inicio recusado: state V2 nao esta ACTIVE.'
  }
  $activeRelease = Assert-MegaDeskActiveRelease -State $state
  Assert-MegaDeskToolchain
  Assert-DockerAndMySql
  Assert-CloudflaredConfig
  $startedNodeRecord = Start-MegaDeskNode -ReleaseSha ([string]$activeRelease.sha)
  $current = Get-MegaDeskState
  if ($null -eq $current.node -or [string]$current.node.releaseSha -cne [string]$activeRelease.sha -or -not (Test-MegaDeskStaticProcessIdentity -Record $current.node -Kind node)) {
    throw 'Inicio recusado: identidade estatica do Node nao corresponde a activeRelease.'
  }
  Wait-MegaDeskLocal -ExpectedReleaseSha ([string]$activeRelease.sha) -NodeRecord $current.node
  $current = Get-MegaDeskState
  if ($null -eq $current.node -or [string]$current.node.releaseSha -cne [string]$activeRelease.sha -or -not (Test-ManagedProcess -Record $current.node -Kind node)) {
    throw 'Inicio recusado: Node gerenciado nao corresponde a activeRelease apos health local.'
  }
  $startedTunnelRecord = Start-MegaDeskTunnel
  $current = Get-MegaDeskState
  if ($null -eq $current.cloudflared -or -not (Test-ManagedProcess -Record $current.cloudflared -Kind cloudflared)) {
    throw 'Inicio recusado: Cloudflared gerenciado nao esta valido.'
  }
  Wait-MegaDeskPublicEndpoints -ExpectedReleaseSha ([string]$activeRelease.sha)
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
