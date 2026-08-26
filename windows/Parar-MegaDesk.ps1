[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'MegaDesk.Automation.psm1') -Force

try {
  Write-MegaDeskLog 'Parada segura do MegaDesk solicitada.'
  Stop-MegaDeskManagedProcess -Kind node
  Stop-MegaDeskManagedProcess -Kind cloudflared
  $owner = Get-PortOwner -Port 3000
  if ($null -ne $owner) { throw ("Porta 3000 continua ocupada pelo PID {0}; o processo nao foi encerrado por nao pertencer a automacao." -f $owner.ProcessId) }
  Write-MegaDeskLog 'Porta 3000 livre. MySQL, Evolution, containers e volumes permaneceram intactos.'
} catch {
  Write-MegaDeskLog ("Parada segura incompleta: {0}" -f $_.Exception.Message)
  Write-Error $_.Exception.Message
  exit 1
}
