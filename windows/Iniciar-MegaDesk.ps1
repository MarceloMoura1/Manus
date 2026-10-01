[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [ValidateRange(0, 3600)][int]$DependencyTimeoutSeconds = 900,
  [ValidateRange(1, 60)][int]$DependencyMaxBackoffSeconds = 30
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'MegaDesk.Automation.psm1') -Force
Enable-MegaDeskOperationalContext

try {
  Invoke-WithMegaDeskLifecycleLock {
    $startedNodeRecord = $null
    $startedTunnelRecord = $null
    try {
      Write-MegaDeskLog 'Inicio seguro do MegaDesk solicitado.'
      Resolve-MegaDeskActiveRuntimeRecovery | Out-Null
      $state = Get-MegaDeskState
      $activeRelease = Assert-MegaDeskStartupState -State $state
      Assert-MegaDeskToolchain
      Wait-MegaDeskDockerAndMySql -TimeoutSeconds $DependencyTimeoutSeconds -MaxBackoffSeconds $DependencyMaxBackoffSeconds | Out-Null
      Assert-CloudflaredConfig
      $startedNodeRecord = Start-MegaDeskNode -AuthorizationMode ACTIVE_START -ReleaseSha ([string]$activeRelease.sha)
      $current = Get-MegaDeskState
      if ($null -eq $current.node -or [string]$current.node.releaseSha -cne [string]$activeRelease.sha -or -not (Test-MegaDeskStaticProcessIdentity -Record $current.node -Kind node)) {
        throw 'Inicio recusado: identidade estatica do Node nao corresponde a activeRelease.'
      }
      Wait-MegaDeskLocal -ExpectedReleaseSha ([string]$activeRelease.sha) -NodeRecord $current.node
      $current = Get-MegaDeskState
      if ($null -eq $current.node -or [string]$current.node.releaseSha -cne [string]$activeRelease.sha -or -not (Test-ManagedProcess -Record $current.node -Kind node)) {
        throw 'Inicio recusado: Node gerenciado nao corresponde a activeRelease apos health local.'
      }
      $startedTunnelRecord = Start-MegaDeskTunnel -AuthorizationMode ACTIVE_START -ReleaseSha ([string]$activeRelease.sha)
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
      throw $startupError
    }
  }
} catch {
  Write-MegaDeskLog ("Falha no inicio seguro: {0}" -f $_.Exception.Message)
  Write-Error $_.Exception.Message
  exit 1
}
