[CmdletBinding()]
param([switch]$RunTests)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Import-Module (Join-Path $PSScriptRoot 'MegaDesk.Automation.psm1') -Force
Set-Location -LiteralPath $projectRoot

function Invoke-CheckedCommand {
  param([scriptblock]$Command, [string]$FailureMessage)
  & $Command
  if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
}

try {
  Assert-MegaDeskToolchain -RequirePnpm
  $branch = (& git branch --show-current).Trim()
  $head = (& git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel consultar a versao Git.' }
  Write-Host "Branch atual: $branch"
  Write-Host "Commit atual: $head"
  Write-Host 'Paths alterados:'
  $status = @(& git status --short)
  if ($status.Count -eq 0) { Write-Host '  (nenhum)' } else { $status | ForEach-Object { Write-Host "  $_" } }

  $protected = @(& git status --porcelain=v1 -- drizzle/schema.ts drizzle)
  $protected = @($protected | Where-Object { $_ -match 'drizzle/schema\.ts|drizzle[/\\].*\.sql|drizzle[/\\]meta[/\\]' })
  if ($protected.Count -gt 0) {
    throw 'Schema/migration/snapshot/journal pendente detectado. Pare e execute operacao separada, autorizada e com backup.'
  }

  $confirmation = Read-Host 'Digite PUBLICAR para validar, compilar e publicar localmente'
  if ($confirmation -cne 'PUBLICAR') { throw 'Atualizacao cancelada; confirmacao exata nao recebida.' }

  $state = Get-MegaDeskState
  $portOwner = Get-PortOwner -Port 3000
  $managedNodeActive = $null -ne $state.node -and (Test-ManagedProcess -Record $state.node -Kind node)
  if ($null -ne $portOwner -and -not $managedNodeActive) {
    throw ("Porta 3000 pertence a processo nao controlado (PID {0}); publicacao recusada." -f $portOwner.ProcessId)
  }

  Invoke-CheckedCommand -Command { git diff --check } -FailureMessage 'git diff --check falhou.'
  Invoke-CheckedCommand -Command { pnpm check } -FailureMessage 'pnpm check falhou.'
  if ($RunTests) {
    Invoke-CheckedCommand -Command { pnpm test } -FailureMessage 'pnpm test falhou.'
  } else {
    Write-MegaDeskLog 'Suite completa nao executada; use -RunTests para habilita-la explicitamente.'
  }

  $backup = Backup-MegaDeskDist
  $distRestored = $false
  try {
    Invoke-CheckedCommand -Command { pnpm run build } -FailureMessage 'pnpm run build falhou.'
    Assert-MegaDeskArtifacts
    if ($managedNodeActive) {
      Stop-MegaDeskManagedProcess -Kind node
      $startedNodeRecord = $null
      try {
        $startedNodeRecord = Start-MegaDeskNode
        Wait-MegaDeskLocal
        Wait-MegaDeskPublicEndpoints -TimeoutSeconds 60 -PollIntervalSeconds 1
      } catch {
        $publishError = $_.Exception
        if ($null -ne $startedNodeRecord) {
          Undo-MegaDeskInvocation -StartedNodeRecord $startedNodeRecord
        }
        Restore-MegaDeskDist -BackupPath $backup
        $distRestored = $true
        Start-MegaDeskNode | Out-Null
        Wait-MegaDeskLocal
        throw $publishError
      }
      Write-MegaDeskLog 'Atualizacao local publicada. Node reiniciado; MySQL e tunnel foram preservados.'
    } else {
      Write-MegaDeskLog 'Dist atualizado com MegaDesk desligado; nenhum processo foi iniciado.'
    }
  } catch {
    if (-not $distRestored) { Restore-MegaDeskDist -BackupPath $backup }
    throw
  }

  Write-Host 'Observacao: variaveis VITE_* foram incorporadas no build e exigem novo build para futuras alteracoes.'
} catch {
  Write-MegaDeskLog ("Atualizacao nao publicada: {0}" -f $_.Exception.Message)
  Write-Error $_.Exception.Message
  exit 1
}
