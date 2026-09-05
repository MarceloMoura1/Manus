Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:RuntimeRoot = Join-Path $env:LOCALAPPDATA 'MegaDesk'
$script:StateDirectory = Join-Path $script:RuntimeRoot 'state'
$script:StatePath = Join-Path $script:StateDirectory 'updater-state.json'
$script:LogPath = Join-Path $script:RuntimeRoot 'automation.log'
$script:BackupRoot = Join-Path $script:RuntimeRoot 'backups'
$script:ReleaseRoot = Join-Path $script:RuntimeRoot 'releases'
$script:StagingRoot = Join-Path $script:RuntimeRoot 'staging'
$script:RuntimePort = 3000
$script:CloudflaredConfig = Join-Path $env:USERPROFILE '.cloudflared\config.yml'
$script:AllowedOrigins = 'http://127.0.0.1:3000,http://localhost:3000,https://app.megadesk.online,https://admin.megadesk.online,https://api.megadesk.online'

if ($null -eq ('MegaDeskUpdaterNative' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class MegaDeskUpdaterNative {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint length, uint flags);
}
'@
}

function Initialize-MegaDeskRuntime {
  foreach ($path in @($script:RuntimeRoot, $script:StateDirectory, $script:BackupRoot, $script:ReleaseRoot, $script:StagingRoot)) {
    if (-not (Test-Path -LiteralPath $path)) {
      New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
  }
}

function Set-MegaDeskAutomationPaths {
  <# Test-only override. It is never used by the desktop updater. #>
  param(
    [Parameter(Mandatory = $true)][string]$RuntimeRoot,
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][ValidateRange(1025, 65535)][int]$Port
  )
  if ($Port -eq 3000) { throw 'O modo de teste exige porta diferente de 3000.' }
  $script:RuntimeRoot = [System.IO.Path]::GetFullPath($RuntimeRoot)
  $script:StateDirectory = Join-Path $script:RuntimeRoot 'state'
  $script:StatePath = Join-Path $script:StateDirectory 'updater-state.json'
  $script:LogPath = Join-Path $script:RuntimeRoot 'automation.log'
  $script:BackupRoot = Join-Path $script:RuntimeRoot 'backups'
  $script:ReleaseRoot = Join-Path $script:RuntimeRoot 'releases'
  $script:StagingRoot = Join-Path $script:RuntimeRoot 'staging'
  $script:ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
  $script:RuntimePort = $Port
}

function Get-MegaDeskRuntimeLayout {
  [pscustomobject]@{
    runtimeRoot = $script:RuntimeRoot
    statePath = $script:StatePath
    releaseRoot = $script:ReleaseRoot
    stagingRoot = $script:StagingRoot
    port = $script:RuntimePort
  }
}

function Write-MegaDeskLog {
  param([Parameter(Mandatory = $true)][string]$Message)
  Initialize-MegaDeskRuntime
  $safeMessage = $Message -replace '[\r\n]+', ' '
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $safeMessage
  Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
  Write-Host $Message
}

function Get-MegaDeskState {
  if (-not (Test-Path -LiteralPath $script:StatePath)) {
    return [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null }
  }
  try { $state = Get-Content -LiteralPath $script:StatePath -Raw | ConvertFrom-Json } catch {
    throw 'Arquivo de estado da automacao invalido. Revise %LOCALAPPDATA%\MegaDesk\state\updater-state.json manualmente.'
  }
  if (-not ($state.PSObject.Properties.Name -contains 'schemaVersion') -or $state.schemaVersion -isnot [int] -or [int]$state.schemaVersion -ne 2) {
    throw 'schemaVersion do estado e incompativel; somente a versao 2 e suportada.'
  }
  if ($null -ne $state.cloudflared -and $state.cloudflared.PSObject.Properties.Name -contains 'port' -and $null -ne $state.cloudflared.port) {
    throw 'State cloudflared com porta registrada e incompativel; ownership da porta do Node nao e permitido.'
  }
  if (-not ($state.PSObject.Properties.Name -contains 'node')) { Add-Member -InputObject $state -NotePropertyName node -NotePropertyValue $null }
  if (-not ($state.PSObject.Properties.Name -contains 'cloudflared')) { Add-Member -InputObject $state -NotePropertyName cloudflared -NotePropertyValue $null }
  foreach ($property in @('schemaVersion', 'activeRelease', 'previousRelease', 'operation')) {
    if (-not ($state.PSObject.Properties.Name -contains $property)) { Add-Member -InputObject $state -NotePropertyName $property -NotePropertyValue $null }
  }
  return $state
}

function Save-MegaDeskState {
  param([Parameter(Mandatory = $true)]$State)
  Initialize-MegaDeskRuntime
  $State.schemaVersion = 2
  $tempPath = Join-Path $script:StateDirectory ('.updater-state-{0}.tmp' -f [guid]::NewGuid().ToString('N'))
  try {
    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $tempPath -Encoding UTF8 -NoNewline
    Move-Item -LiteralPath $tempPath -Destination $script:StatePath -Force
  } finally {
    if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force }
  }
}

function New-MegaDeskOperationRecord {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('PREPARING', 'READY', 'SWITCHING', 'ACTIVE', 'ROLLING_BACK', 'FAILED')][string]$Status,
    [Parameter(Mandatory = $true)][ValidateSet('UPDATE', 'BOOTSTRAP_ZERO')][string]$Kind,
    [string]$CandidateSha = '',
    [AllowNull()][string]$BaselineSha = $null,
    [string]$Message = ''
  )
  return [pscustomobject]@{
    kind = $Kind
    status = $Status
    candidateSha = $CandidateSha
    baselineSha = $BaselineSha
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    message = $Message
  }
}

function Set-MegaDeskOperationState {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('PREPARING', 'READY', 'SWITCHING', 'ACTIVE', 'ROLLING_BACK', 'FAILED')][string]$Status,
    [string]$CandidateSha = '',
    [ValidateSet('UPDATE', 'BOOTSTRAP_ZERO')][string]$Kind = '',
    [AllowNull()][string]$BaselineSha = $null,
    [string]$Message = ''
  )
  $state = Get-MegaDeskState
  $previous = if ($null -eq $state.operation) { '' } else { [string]$state.operation.status }
  $allowed = @{ '' = @('PREPARING'); ACTIVE = @('PREPARING'); FAILED = @('PREPARING'); PREPARING = @('READY', 'FAILED'); READY = @('SWITCHING', 'FAILED'); SWITCHING = @('ACTIVE', 'ROLLING_BACK', 'FAILED'); ROLLING_BACK = @('ACTIVE', 'FAILED') }
  if (-not $allowed.ContainsKey($previous) -or $allowed[$previous] -notcontains $Status) { throw "Transicao de estado invalida: $previous -> $Status." }
  $resolvedKind = $Kind
  if ([string]::IsNullOrWhiteSpace($resolvedKind)) {
    $resolvedKind = if ($null -ne $state.operation -and $state.operation.PSObject.Properties.Name -contains 'kind' -and -not [string]::IsNullOrWhiteSpace([string]$state.operation.kind)) { [string]$state.operation.kind } else { 'UPDATE' }
  }
  $resolvedBaselineSha = if ($PSBoundParameters.ContainsKey('BaselineSha')) { $BaselineSha } elseif ($Kind -eq 'UPDATE') { $null } elseif ($null -ne $state.operation -and $state.operation.PSObject.Properties.Name -contains 'baselineSha') { $state.operation.baselineSha } else { $null }
  $state.operation = New-MegaDeskOperationRecord -Status $Status -Kind $resolvedKind -CandidateSha $CandidateSha -BaselineSha $resolvedBaselineSha -Message $Message
  Save-MegaDeskState $state
  return $state
}

function Assert-MegaDeskRecoverableState {
  $state = Get-MegaDeskState
  if ($null -ne $state.operation -and [string]$state.operation.status -in @('PREPARING', 'READY', 'SWITCHING', 'ROLLING_BACK')) {
    throw ("Operacao anterior incompleta ({0}). Estado preservado para recuperacao manual; atualizacao recusada." -f $state.operation.status)
  }
  return $state
}

function Assert-MegaDeskToolchain {
  param([switch]$RequirePnpm)
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $node) { throw 'node.exe nao foi encontrado no PATH.' }
  $nodeVersion = (& node --version 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v22\.') { throw 'Node.js 22 e obrigatorio.' }
  if ($RequirePnpm) {
    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($null -eq $pnpm) { throw 'pnpm nao foi encontrado no PATH.' }
    $pnpmVersion = (& pnpm --version 2>$null).Trim()
    if ($LASTEXITCODE -ne 0 -or $pnpmVersion -ne '10.18.0') { throw 'pnpm 10.18.0 e obrigatorio.' }
  }
}

function Invoke-MegaDeskGit {
  param([Parameter(Mandatory = $true)][string[]]$Arguments, [string]$FailureMessage = 'Comando Git falhou.')
  $output = @(& git @Arguments)
  if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
  return $output
}

function Assert-MegaDeskGitPreflight {
  param([Parameter(Mandatory = $true)][string]$ExpectedBranch)
  $topLevel = (Invoke-MegaDeskGit -Arguments @('rev-parse', '--show-toplevel') -FailureMessage 'Repositorio Git nao identificado.' | Select-Object -First 1).Trim()
  if ([System.IO.Path]::GetFullPath($topLevel) -ine $script:ProjectRoot) { throw 'Repositorio Git inesperado; atualizacao recusada.' }
  Invoke-MegaDeskGit -Arguments @('fetch') -FailureMessage 'git fetch falhou; atualizacao recusada.' | Out-Null
  $branch = (Invoke-MegaDeskGit -Arguments @('branch', '--show-current') -FailureMessage 'Branch Git indisponivel.' | Select-Object -First 1).Trim()
  if ($branch -ne $ExpectedBranch) { throw "Branch nao permitida: $branch." }
  $upstream = (Invoke-MegaDeskGit -Arguments @('rev-parse', '@{u}') -FailureMessage 'Upstream Git nao configurado.' | Select-Object -First 1).Trim()
  $head = (Invoke-MegaDeskGit -Arguments @('rev-parse', 'HEAD') -FailureMessage 'HEAD Git indisponivel.' | Select-Object -First 1).Trim()
  $status = @(Invoke-MegaDeskGit -Arguments @('status', '--porcelain=v1') -FailureMessage 'Nao foi possivel verificar o worktree.')
  if ($status.Count -gt 0) { throw 'Worktree, staging ou arquivos untracked detectados; atualizacao recusada.' }
  $counts = (Invoke-MegaDeskGit -Arguments @('rev-list', '--left-right', '--count', '@{u}...HEAD') -FailureMessage 'Nao foi possivel calcular divergencia Git.' | Select-Object -First 1).Trim() -split '\s+'
  if ($counts.Count -ne 2) { throw 'Formato de divergencia Git inesperado.' }
  $behind = [int]$counts[0]; $ahead = [int]$counts[1]
  if ($behind -ne 0 -or $ahead -ne 0 -or $head -ne $upstream) { throw "Repositorio fora de sincronizacao (behind=$behind, ahead=$ahead); atualizacao recusada." }
  return [pscustomobject]@{ branch = $branch; sha = $head; upstreamSha = $upstream; behind = $behind; ahead = $ahead }
}

function Assert-MegaDeskNoSourceMutation {
  $status = @(Invoke-MegaDeskGit -Arguments @('status', '--porcelain=v1') -FailureMessage 'Nao foi possivel verificar o worktree.')
  if ($status.Count -gt 0) { throw 'Operacao alterou arquivos versionados ou untracked; atualizacao bloqueada.' }
}

function Get-MegaDeskMigrationChanges {
  param([Parameter(Mandatory = $true)][string]$FromSha, [Parameter(Mandatory = $true)][string]$ToSha)
  $paths = @('drizzle/schema.ts', 'drizzle/main-migrations', 'drizzle/tenant-schema.ts', 'drizzle/tenant-migrations', 'scripts/canonical-migrations.ts', 'server/_core/canonical-migrations.ts')
  return @(Invoke-MegaDeskGit -Arguments (@('diff', '--name-only', "$FromSha..$ToSha", '--') + $paths) -FailureMessage 'Falha ao inspecionar alteracoes de banco.')
}

function Test-MegaDeskDependencyDiff {
  param([Parameter(Mandatory = $true)][string]$FromSha, [Parameter(Mandatory = $true)][string]$ToSha)
  & git diff --quiet "$FromSha..$ToSha" -- package.json pnpm-lock.yaml
  if ($LASTEXITCODE -eq 0) { return $false }
  if ($LASTEXITCODE -eq 1) { return $true }
  throw 'Falha ao inspecionar dependencias da release.'
}

function Invoke-MegaDeskFrozenInstall {
  & pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'pnpm install --frozen-lockfile falhou; atualizacao bloqueada.' }
  Assert-MegaDeskNoSourceMutation
}

function Test-MegaDeskFullSha {
  param([string]$Sha)
  return $Sha -match '^[0-9a-f]{40}$'
}

function Assert-MegaDeskPathInside {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Root, [string]$Label = 'Caminho')
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  if (-not $fullPath.StartsWith($fullRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "$Label fora do diretorio permitido." }
  return $fullPath
}

function ConvertTo-MegaDeskExtendedPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ($Path.StartsWith('\\?\')) { return $Path }
  $full = [System.IO.Path]::GetFullPath($Path)
  if ($full.StartsWith('\\')) { return '\\?\UNC\' + $full.Substring(2) }
  if ($full -notmatch '^[A-Za-z]:\\') { throw 'Caminho local absoluto obrigatorio para operacao fisica.' }
  return '\\?\' + $full
}

function ConvertFrom-MegaDeskExtendedPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ($Path.StartsWith('\\?\UNC\')) { return [System.IO.Path]::GetFullPath('\\' + $Path.Substring(8)) }
  if ($Path.StartsWith('\\?\')) { return [System.IO.Path]::GetFullPath($Path.Substring(4)) }
  return [System.IO.Path]::GetFullPath($Path)
}

function Test-MegaDeskPhysicalPathExists {
  param([Parameter(Mandatory = $true)][string]$Path)
  $physical = ConvertTo-MegaDeskExtendedPath -Path $Path
  return [IO.File]::Exists($physical) -or [IO.Directory]::Exists($physical)
}

function Get-MegaDeskPhysicalPathAttributes {
  param([Parameter(Mandatory = $true)][string]$Path)
  return [IO.File]::GetAttributes((ConvertTo-MegaDeskExtendedPath -Path $Path))
}

function Get-MegaDeskPhysicalChildPaths {
  param([Parameter(Mandatory = $true)][string]$Path)
  $physical = ConvertTo-MegaDeskExtendedPath -Path $Path
  try {
    return @([IO.Directory]::GetFileSystemEntries($physical) | ForEach-Object { ConvertFrom-MegaDeskExtendedPath -Path $_ })
  } catch {
    throw ("Nao foi possivel enumerar caminho fisico: {0}: {1}" -f $Path, $_.Exception.Message)
  }
}

function Remove-MegaDeskLongPathItem {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][IO.FileAttributes]$Attributes)
  $physical = ConvertTo-MegaDeskExtendedPath -Path $Path
  try {
    if (($Attributes -band [IO.FileAttributes]::ReadOnly) -ne 0) {
      [IO.File]::SetAttributes($physical, [IO.FileAttributes]($Attributes -bxor [IO.FileAttributes]::ReadOnly))
    }
    if (($Attributes -band [IO.FileAttributes]::Directory) -ne 0) {
      [IO.Directory]::Delete($physical, $false)
    } else {
      [IO.File]::Delete($physical)
    }
  } catch {
    throw ("Falha ao remover item sem seguir reparse point: {0}: {1}" -f $Path, $_.Exception.Message)
  }
}

function Remove-MegaDeskTreeNoFollow {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedRoot,
    [string]$Label = 'Arvore temporaria'
  )
  $root = Assert-MegaDeskPathInside -Path $Path -Root $AllowedRoot -Label $Label
  if (-not (Test-MegaDeskPhysicalPathExists -Path $root)) { throw "$Label ausente antes do cleanup." }
  $rootAttributes = Get-MegaDeskPhysicalPathAttributes -Path $root
  if (($rootAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "$Label nao pode ser reparse point para cleanup." }
  if (($rootAttributes -band [IO.FileAttributes]::Directory) -eq 0) { throw "$Label nao e um diretorio para cleanup." }
  if (-not (Test-MegaDeskPhysicalPathInside -Path $root -Root $AllowedRoot)) { throw "$Label fisicamente fora do diretorio permitido." }

  $pending = New-Object 'System.Collections.Generic.Stack[string]'
  $directories = New-Object 'System.Collections.Generic.List[string]'
  $pending.Push($root)
  while ($pending.Count -gt 0) {
    $current = $pending.Pop()
    $currentAttributes = Get-MegaDeskPhysicalPathAttributes -Path $current
    if (($currentAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      Remove-MegaDeskLongPathItem -Path $current -Attributes $currentAttributes
      continue
    }
    if (($currentAttributes -band [IO.FileAttributes]::Directory) -eq 0) {
      Remove-MegaDeskLongPathItem -Path $current -Attributes $currentAttributes
      continue
    }
    $directories.Add($current)
    foreach ($child in @(Get-MegaDeskPhysicalChildPaths -Path $current)) {
      $childPath = Assert-MegaDeskPathInside -Path $child -Root $root -Label $Label
      $attributes = Get-MegaDeskPhysicalPathAttributes -Path $childPath
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Remove-MegaDeskLongPathItem -Path $childPath -Attributes $attributes
        continue
      }
      if (($attributes -band [IO.FileAttributes]::Directory) -ne 0) {
        $pending.Push($childPath)
      } else {
        Remove-MegaDeskLongPathItem -Path $childPath -Attributes $attributes
      }
    }
  }
  for ($index = $directories.Count - 1; $index -ge 0; $index--) {
    $directory = $directories[$index]
    $attributes = Get-MegaDeskPhysicalPathAttributes -Path $directory
    Remove-MegaDeskLongPathItem -Path $directory -Attributes $attributes
  }
  if (Test-MegaDeskPhysicalPathExists -Path $root) { throw "$Label permaneceu apos cleanup: $root" }
}

function Get-MegaDeskCanonicalPhysicalPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  $full = ConvertFrom-MegaDeskExtendedPath -Path $Path
  if (-not (Test-MegaDeskPhysicalPathExists -Path $full)) { throw 'Caminho fisico a canonicalizar nao existe.' }
  $handle = [MegaDeskUpdaterNative]::CreateFile((ConvertTo-MegaDeskExtendedPath -Path $full), [uint32]0, [uint32]7, [IntPtr]::Zero, [uint32]3, [uint32]0x02000000, [IntPtr]::Zero)
  if ($handle.IsInvalid) { throw 'Nao foi possivel abrir handle para canonicalizacao fisica.' }
  try {
    $buffer = New-Object System.Text.StringBuilder 32768
    $length = [MegaDeskUpdaterNative]::GetFinalPathNameByHandle($handle, $buffer, [uint32]$buffer.Capacity, [uint32]0)
    if ($length -eq 0 -or $length -ge $buffer.Capacity) { throw 'Canonicalizacao fisica do caminho falhou.' }
    return (ConvertFrom-MegaDeskExtendedPath -Path $buffer.ToString()).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  } finally {
    $handle.Dispose()
  }
}

function Test-MegaDeskPhysicalPathInside {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Root)
  $canonicalPath = Get-MegaDeskCanonicalPhysicalPath -Path $Path
  $canonicalRoot = Get-MegaDeskCanonicalPhysicalPath -Path $Root
  return $canonicalPath.StartsWith($canonicalRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Get-MegaDeskReparsePointsNoFollow {
  param([Parameter(Mandatory = $true)][string]$Root)
  $root = [System.IO.Path]::GetFullPath($Root)
  $rootAttributes = Get-MegaDeskPhysicalPathAttributes -Path $root
  if (($rootAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Root de runtime nao pode ser reparse point.' }
  $pending = New-Object 'System.Collections.Generic.Stack[string]'
  $reparsePoints = New-Object 'System.Collections.Generic.List[string]'
  $pending.Push($root)
  while ($pending.Count -gt 0) {
    $current = $pending.Pop()
    foreach ($child in @(Get-MegaDeskPhysicalChildPaths -Path $current)) {
      $attributes = Get-MegaDeskPhysicalPathAttributes -Path $child
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        $reparsePoints.Add($child)
        continue
      }
      if (($attributes -band [IO.FileAttributes]::Directory) -ne 0) { $pending.Push($child) }
    }
  }
  return @($reparsePoints)
}

function Get-MegaDeskReleasePath {
  param([Parameter(Mandatory = $true)][string]$Sha)
  if (-not (Test-MegaDeskFullSha $Sha)) { throw 'SHA de release invalido.' }
  Initialize-MegaDeskRuntime
  return (Assert-MegaDeskPathInside -Path (Join-Path $script:ReleaseRoot $Sha) -Root $script:ReleaseRoot -Label 'Release')
}

function Get-MegaDeskRelease {
  param([Parameter(Mandatory = $true)][string]$Sha)
  $releasePath = Get-MegaDeskReleasePath -Sha $Sha
  $metadataPath = Join-Path $releasePath 'release.json'
  if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { throw 'Metadata da release ausente.' }
  try { $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json } catch { throw 'Metadata de release invalido.' }
  if ([string]$metadata.sha -ne $Sha -or [string]$metadata.buildStatus -ne 'ready' -or [string]$metadata.runtime.strategy -ne 'pnpm-deploy-legacy-prod') { throw 'Metadata da release nao representa artefato pronto.' }
  $distPath = Join-Path $releasePath 'dist'
  if (-not (Test-Path -LiteralPath (Join-Path $distPath 'index.js') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $distPath 'public') -PathType Container)) { throw 'Artefatos da release incompletos.' }
  $runtime = Assert-MegaDeskReleaseRuntime -ReleasePath $releasePath -AllowedRoot $script:ReleaseRoot
  return [pscustomobject]@{ sha = $Sha; path = $releasePath; metadata = $metadata; metadataPath = $metadataPath; runtime = $runtime }
}

function Assert-MegaDeskActiveRelease {
  param([Parameter(Mandatory = $true)]$State)
  if ($null -eq $State.activeRelease -or -not (Test-MegaDeskFullSha ([string]$State.activeRelease.sha))) {
    throw 'Release ativa identificada por SHA ausente; compatibilidade de banco nao pode ser provada nesta Fase 1.'
  }
  $release = Get-MegaDeskRelease -Sha ([string]$State.activeRelease.sha)
  if ([System.IO.Path]::GetFullPath([string]$State.activeRelease.path) -ine $release.path) { throw 'State da release ativa possui caminho inconsistente.' }
  return $release
}

function New-MegaDeskReleaseMetadata {
  param([Parameter(Mandatory = $true)][string]$Sha, [Parameter(Mandatory = $true)][string]$Destination)
  [ordered]@{
    sha = $Sha
    shortSha = $Sha.Substring(0, 12)
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    buildStatus = 'ready'
    runtime = [ordered]@{
      strategy = 'pnpm-deploy-legacy-prod'
      dependenciesPath = 'node_modules'
    }
    packageJsonBlob = (Invoke-MegaDeskGit -Arguments @('rev-parse', "${Sha}:package.json") -FailureMessage 'Nao foi possivel registrar metadata de dependencias.' | Select-Object -First 1).Trim()
    pnpmLockBlob = (Invoke-MegaDeskGit -Arguments @('rev-parse', "${Sha}:pnpm-lock.yaml") -FailureMessage 'Nao foi possivel registrar metadata de dependencias.' | Select-Object -First 1).Trim()
  } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $Destination 'release.json') -Encoding UTF8 -NoNewline
}

function Assert-MegaDeskReleaseRuntime {
  param(
    [Parameter(Mandatory = $true)][string]$ReleasePath,
    [Parameter(Mandatory = $true)][string]$AllowedRoot
  )
  $releasePath = Assert-MegaDeskPathInside -Path $ReleasePath -Root $AllowedRoot -Label 'Runtime da release'
  $packagePath = Join-Path $releasePath 'package.json'
  $nodeModulesPath = Join-Path $releasePath 'node_modules'
  if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { throw 'Runtime da release sem package.json.' }
  if (-not (Test-Path -LiteralPath $nodeModulesPath -PathType Container)) { throw 'Runtime da release sem node_modules proprio.' }
  try { $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json } catch { throw 'package.json da release invalido.' }
  if ($null -eq $package.dependencies) { throw 'Runtime da release sem dependencias production declaradas.' }
  $dependencies = @($package.dependencies.PSObject.Properties.Name)
  if ($dependencies.Count -eq 0) { throw 'Runtime da release sem dependencias production declaradas.' }
  foreach ($dependency in $dependencies) {
    if (-not (Test-Path -LiteralPath (Join-Path $nodeModulesPath $dependency) -PathType Container)) {
      throw "Dependencia production ausente na release: $dependency."
    }
  }

  $forbiddenEnvironmentFiles = @(Get-ChildItem -LiteralPath $releasePath -Force -File -Filter '.env*' -ErrorAction Stop)
  if ($forbiddenEnvironmentFiles.Count -gt 0) { throw 'Runtime da release contem arquivo de ambiente proibido.' }

  if (-not (Test-MegaDeskPhysicalPathInside -Path $nodeModulesPath -Root $releasePath)) {
    throw 'Runtime da release possui node_modules fisicamente fora da release.'
  }
  foreach ($dependency in $dependencies) {
    $dependencyPath = Join-Path $nodeModulesPath $dependency
    if (-not (Test-MegaDeskPhysicalPathInside -Path $dependencyPath -Root $nodeModulesPath)) {
      throw "Dependencia production resolve fisicamente fora do runtime: $dependency."
    }
  }
  $links = @(Get-MegaDeskReparsePointsNoFollow -Root $nodeModulesPath)
  foreach ($link in $links) {
    if (-not (Test-MegaDeskPhysicalPathInside -Path $link -Root $nodeModulesPath)) {
      throw 'Runtime da release possui reparse point fisicamente fora da propria release.'
    }
  }
  return [pscustomobject]@{ nodeModulesPath = $nodeModulesPath; dependencyCount = $dependencies.Count; linkCount = $links.Count }
}

function Remove-MegaDeskReleaseEnvironmentFiles {
  param(
    [Parameter(Mandatory = $true)][string]$ReleasePath,
    [Parameter(Mandatory = $true)][string]$AllowedRoot
  )
  $releasePath = Assert-MegaDeskPathInside -Path $ReleasePath -Root $AllowedRoot -Label 'Runtime temporario da release'
  $environmentFiles = @(Get-ChildItem -LiteralPath $releasePath -Force -File -Filter '.env*' -ErrorAction Stop)
  foreach ($environmentFile in $environmentFiles) {
    Remove-Item -LiteralPath $environmentFile.FullName -Force -ErrorAction Stop
  }
}

function Invoke-MegaDeskReleaseDependencyDeploy {
  param([Parameter(Mandatory = $true)][string]$Destination)
  if (Test-Path -LiteralPath $Destination) { throw 'Destino de dependencias da release ja existe.' }
  & pnpm --filter megadesk-platform --prod deploy --legacy $Destination
  if ($LASTEXITCODE -ne 0) { throw 'Preparacao isolada das dependencias production falhou; release candidata recusada.' }
  Remove-MegaDeskReleaseEnvironmentFiles -ReleasePath $Destination -AllowedRoot $script:StagingRoot
  Assert-MegaDeskReleaseRuntime -ReleasePath $Destination -AllowedRoot $script:StagingRoot | Out-Null
}

function Invoke-MegaDeskIsolatedBuild {
  param([Parameter(Mandatory = $true)][string]$Sha)
  $releasePath = Get-MegaDeskReleasePath -Sha $Sha
  if (Test-Path -LiteralPath $releasePath) { return (Get-MegaDeskRelease -Sha $Sha) }
  $stagePath = Assert-MegaDeskPathInside -Path (Join-Path $script:StagingRoot ("{0}-{1}" -f $Sha, [guid]::NewGuid().ToString('N'))) -Root $script:StagingRoot -Label 'Staging'
  $stageDist = Join-Path $stagePath 'dist'
  try {
    Invoke-MegaDeskReleaseDependencyDeploy -Destination $stagePath
    & pnpm exec vite build --outDir (Join-Path $stageDist 'public')
    if ($LASTEXITCODE -ne 0) { throw 'Build isolado do frontend falhou.' }
    & pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=$stageDist
    if ($LASTEXITCODE -ne 0) { throw 'Build isolado do backend falhou.' }
    if (-not (Test-Path -LiteralPath (Join-Path $stageDist 'index.js') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $stageDist 'public') -PathType Container)) { throw 'Build isolado nao produziu artefatos completos.' }
    Assert-MegaDeskReleaseRuntime -ReleasePath $stagePath -AllowedRoot $script:StagingRoot | Out-Null
    New-MegaDeskReleaseMetadata -Sha $Sha -Destination $stagePath
    Move-Item -LiteralPath $stagePath -Destination $releasePath
    return (Get-MegaDeskRelease -Sha $Sha)
  } finally {
    if (Test-MegaDeskPhysicalPathExists -Path $stagePath) { Remove-MegaDeskTreeNoFollow -Path $stagePath -AllowedRoot $script:StagingRoot -Label 'Staging da release' }
  }
}

function Get-ProcessSnapshot {
  param([Parameter(Mandatory = $true)][int]$ProcessId)
  Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $ProcessId) -ErrorAction SilentlyContinue
}

function Get-ProcessSnapshotStrict {
  param([Parameter(Mandatory = $true)][int]$ProcessId)
  Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $ProcessId) -ErrorAction Stop
}

function ConvertTo-MegaDeskProcessStartUtc {
  param([Parameter(Mandatory = $true)][AllowNull()]$Value)

  try {
    if ($Value -is [System.DateTime]) {
      return ([System.DateTime]$Value).ToUniversalTime()
    }
    if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace($Value)) {
      throw 'Tipo de timestamp nao suportado.'
    }
    if ($Value -match '^\d{14}\.\d{6}[+-]\d{3}$') {
      return [Management.ManagementDateTimeConverter]::ToDateTime($Value).ToUniversalTime()
    }

    $parsed = [System.DateTimeOffset]::MinValue
    if ([System.DateTimeOffset]::TryParseExact(
        $Value,
        'o',
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::RoundtripKind,
        [ref]$parsed
      )) {
      return $parsed.UtcDateTime
    }
    throw 'Formato de timestamp nao suportado.'
  } catch {
    throw 'Horario de criacao do processo invalido; identidade recusada.'
  }
}

function ConvertTo-MegaDeskCanonicalPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Caminho vazio nao pode identificar processo gerenciado.' }
  return [System.IO.Path]::GetFullPath($Path.Replace('/', '\'))
}

function Test-MegaDeskSamePath {
  param([Parameter(Mandatory = $true)][string]$Left, [Parameter(Mandatory = $true)][string]$Right)
  try {
    return [string]::Equals((ConvertTo-MegaDeskCanonicalPath -Path $Left), (ConvertTo-MegaDeskCanonicalPath -Path $Right), [StringComparison]::OrdinalIgnoreCase)
  } catch {
    return $false
  }
}

function ConvertFrom-MegaDeskWindowsCommandLine {
  param([Parameter(Mandatory = $true)][string]$CommandLine)
  $arguments = New-Object 'System.Collections.Generic.List[string]'
  $length = $CommandLine.Length
  $index = 0
  while ($index -lt $length) {
    while ($index -lt $length -and [char]::IsWhiteSpace($CommandLine[$index])) { $index++ }
    if ($index -ge $length) { break }

    $argument = New-Object System.Text.StringBuilder
    $insideQuotes = $false
    while ($index -lt $length) {
      if (-not $insideQuotes -and [char]::IsWhiteSpace($CommandLine[$index])) { break }

      $backslashCount = 0
      while ($index -lt $length -and $CommandLine[$index] -eq '\') {
        $backslashCount++
        $index++
      }

      if ($index -lt $length -and $CommandLine[$index] -eq '"') {
        if ($backslashCount -gt 0) { [void]$argument.Append('\', [int]($backslashCount / 2)) }
        if (($backslashCount % 2) -eq 0) { $insideQuotes = -not $insideQuotes } else { [void]$argument.Append('"') }
        $index++
        continue
      }

      if ($backslashCount -gt 0) { [void]$argument.Append('\', $backslashCount) }
      if ($index -lt $length) {
        [void]$argument.Append($CommandLine[$index])
        $index++
      }
    }
    if ($insideQuotes) { throw 'Command line do processo possui aspas sem fechamento.' }
    $arguments.Add($argument.ToString())
  }
  return @($arguments)
}

function Test-MegaDeskNodeCommandLine {
  param([Parameter(Mandatory = $true)]$Process, [Parameter(Mandatory = $true)]$Record)
  if ([string]::IsNullOrWhiteSpace([string]$Process.CommandLine)) { return $false }
  if (-not ($Record.PSObject.Properties.Name -contains 'environmentPath') -or [string]::IsNullOrWhiteSpace([string]$Record.environmentPath)) { return $false }
  if (-not ($Record.PSObject.Properties.Name -contains 'scriptPath') -or [string]::IsNullOrWhiteSpace([string]$Record.scriptPath)) { return $false }

  try {
    if ($Record.PSObject.Properties.Name -contains 'releaseSha' -and -not [string]::IsNullOrWhiteSpace([string]$Record.releaseSha)) {
      if (-not (Test-MegaDeskFullSha ([string]$Record.releaseSha)) -or -not (Test-MegaDeskSamePath -Left ([string]$Record.scriptPath) -Right (Join-Path (Get-MegaDeskReleasePath -Sha ([string]$Record.releaseSha)) 'dist\index.js'))) { return $false }
    } elseif (-not (Test-MegaDeskSamePath -Left ([string]$Record.scriptPath) -Right (Join-Path $script:ProjectRoot 'dist\index.js'))) {
      return $false
    }
    $arguments = @(ConvertFrom-MegaDeskWindowsCommandLine -CommandLine ([string]$Process.CommandLine))
    if ($arguments.Count -ne 3) { return $false }
    if (-not (Test-MegaDeskSamePath -Left $arguments[0] -Right ([string]$Record.executablePath))) { return $false }
    if ($arguments[1].Length -le '--env-file='.Length -or -not $arguments[1].StartsWith('--env-file=', [StringComparison]::Ordinal)) { return $false }
    if (-not (Test-MegaDeskSamePath -Left $arguments[1].Substring('--env-file='.Length) -Right ([string]$Record.environmentPath))) { return $false }
    if (-not (Test-MegaDeskSamePath -Left $arguments[2] -Right ([string]$Record.scriptPath))) { return $false }
    return $true
  } catch {
    return $false
  }
}

function Test-MegaDeskStaticProcessIdentity {
  param(
    [Parameter(Mandatory = $true)]$Record,
    [Parameter(Mandatory = $true)][string]$Kind
  )
  if ($Kind -notin @('node', 'cloudflared')) { return $false }
  if ($null -eq $Record -or -not $Record.pid) { return $false }
  $process = Get-ProcessSnapshot -ProcessId ([int]$Record.pid)
  if ($null -eq $process) { return $false }
  if ([string]::IsNullOrWhiteSpace([string]$process.ExecutablePath)) { return $false }

  $expectedName = if ($Kind -eq 'node') { 'node.exe' } else { 'cloudflared.exe' }
  if ([System.IO.Path]::GetFileName($process.ExecutablePath) -ine $expectedName) { return $false }
  if (-not (Test-MegaDeskSamePath -Left ([string]$process.ExecutablePath) -Right ([string]$Record.executablePath))) { return $false }

  if ($Kind -eq 'node') {
    if (-not (Test-MegaDeskNodeCommandLine -Process $process -Record $Record)) { return $false }
  } else {
    if ([string]::IsNullOrWhiteSpace([string]$Record.configPath)) { return $false }
    try {
      $arguments = @(ConvertFrom-MegaDeskWindowsCommandLine -CommandLine ([string]$process.CommandLine))
      if ($arguments.Count -ne 6) { return $false }
      if (-not (Test-MegaDeskSamePath -Left $arguments[0] -Right ([string]$Record.executablePath))) { return $false }
      if ($arguments[1] -cne 'tunnel' -or $arguments[2] -cne '--config' -or $arguments[4] -cne 'run' -or $arguments[5] -cne 'megadesk') { return $false }
      if (-not (Test-MegaDeskSamePath -Left $arguments[3] -Right ([string]$Record.configPath))) { return $false }
    } catch {
      return $false
    }
  }

  try {
    $actualStart = ConvertTo-MegaDeskProcessStartUtc -Value $process.CreationDate
    $recordedStart = ConvertTo-MegaDeskProcessStartUtc -Value $Record.startedAtUtc
    if ([Math]::Abs(($actualStart - $recordedStart).TotalMilliseconds) -gt 1) { return $false }
  } catch { return $false }
  return $true
}

function Test-MegaDeskPortOwnedByProcess {
  param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port,
    [Parameter(Mandatory = $true)][int]$ProcessId
  )
  try {
    $owners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | ForEach-Object { [int]$_.OwningProcess } | Select-Object -Unique)
  } catch {
    return $false
  }
  return $owners.Count -eq 1 -and $owners[0] -eq $ProcessId
}

function Test-ManagedProcess {
  param(
    [Parameter(Mandatory = $true)]$Record,
    [Parameter(Mandatory = $true)][string]$Kind
  )
  if (-not (Test-MegaDeskStaticProcessIdentity -Record $Record -Kind $Kind)) { return $false }
  switch ($Kind) {
    'node' {
      try {
        if (-not ($Record.PSObject.Properties.Name -contains 'port')) { return $false }
        $port = [int]$Record.port
        if ($port -lt 1 -or $port -gt 65535) { return $false }
        return Test-MegaDeskPortOwnedByProcess -Port $port -ProcessId ([int]$Record.pid)
      } catch {
        return $false
      }
    }
    'cloudflared' {
      if ($Record.PSObject.Properties.Name -contains 'port' -and $null -ne $Record.port) { return $false }
      return $true
    }
    default {
      return $false
    }
  }
}

function Get-MegaDeskPortOwnership {
  param(
    [ValidateRange(1, 65535)][int]$Port = $script:RuntimePort,
    $ManagedRecord = $null,
    [ValidateSet('node', 'cloudflared')][string]$ManagedKind = 'node'
  )
  try {
    $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
  } catch {
    return [pscustomobject]@{ status = 'UNKNOWN'; port = $Port; process = $null; reason = 'Falha ao consultar listeners da porta.' }
  }
  if ($connections.Count -eq 0) { return [pscustomobject]@{ status = 'FREE'; port = $Port; process = $null; reason = '' } }

  $processIds = @($connections | ForEach-Object { [int]$_.OwningProcess } | Select-Object -Unique)
  if ($processIds.Count -ne 1 -or $processIds[0] -le 0) {
    return [pscustomobject]@{ status = 'UNKNOWN'; port = $Port; process = $null; reason = 'Listener sem ownership de processo inequivoca.' }
  }
  $processId = $processIds[0]
  try {
    $process = Get-ProcessSnapshotStrict -ProcessId $processId
  } catch {
    return [pscustomobject]@{ status = 'UNKNOWN'; port = $Port; process = $null; reason = 'Falha ao consultar o processo dono da porta.' }
  }
  if ($null -eq $process -or [int]$process.ProcessId -ne $processId -or [string]::IsNullOrWhiteSpace([string]$process.ExecutablePath) -or [string]::IsNullOrWhiteSpace([string]$process.CommandLine) -or $null -eq $process.CreationDate) {
    return [pscustomobject]@{ status = 'UNKNOWN'; port = $Port; process = $null; reason = 'Dados do processo dono da porta estao incompletos.' }
  }
  $recordMatchesPortOwner = $false
  if ($null -ne $ManagedRecord) {
    try { $recordMatchesPortOwner = [int]$ManagedRecord.pid -eq $processId } catch { $recordMatchesPortOwner = $false }
  }
  $recordMatchesQueriedPort = $false
  if ($null -ne $ManagedRecord) {
    try { $recordMatchesQueriedPort = [int]$ManagedRecord.port -eq $Port } catch { $recordMatchesQueriedPort = $false }
  }
  if ($recordMatchesPortOwner -and $recordMatchesQueriedPort -and (Test-MegaDeskStaticProcessIdentity -Record $ManagedRecord -Kind $ManagedKind)) {
    return [pscustomobject]@{ status = 'OWNED_BY_MANAGED_PROCESS'; port = $Port; process = $process; reason = '' }
  }
  return [pscustomobject]@{ status = 'OWNED_BY_EXTERNAL_PROCESS'; port = $Port; process = $process; reason = '' }
}

function Assert-MegaDeskPortFree {
  param([ValidateRange(1, 65535)][int]$Port = $script:RuntimePort, [string]$Operation = 'operacao')
  $ownership = Get-MegaDeskPortOwnership -Port $Port
  if ($ownership.status -eq 'FREE') { return $ownership }
  if ($ownership.status -eq 'UNKNOWN') { throw ("Nao foi possivel provar que a porta {0} esta livre durante {1}; operacao recusada." -f $Port, $Operation) }
  throw ("Porta {0} pertence a processo nao controlado (PID {1}); {2} recusada." -f $Port, $ownership.process.ProcessId, $Operation)
}

function Get-PortOwner {
  param([ValidateRange(1, 65535)][int]$Port = 3000)
  $ownership = Get-MegaDeskPortOwnership -Port $Port
  if ($ownership.status -eq 'FREE') { return $null }
  if ($ownership.status -eq 'UNKNOWN') { throw ("Nao foi possivel determinar o ownership da porta {0}; estado incerto preservado." -f $Port) }
  return $ownership.process
}

function Assert-MegaDeskArtifacts {
  foreach ($relative in @('dist\index.js', 'dist\public', '.env.local')) {
    $path = Join-Path $script:ProjectRoot $relative
    if (-not (Test-Path -LiteralPath $path)) { throw "Artefato obrigatorio ausente: $relative" }
  }
}

function Assert-DockerAndMySql {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if ($null -eq $docker) { throw 'docker.exe nao foi encontrado no PATH.' }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop/engine nao esta disponivel.' }

  $composePath = Join-Path $script:ProjectRoot 'docker-compose.local.yml'
  $serviceDeclaration = Select-String -LiteralPath $composePath -Pattern '^\s{2}megadesk-local-mysql:\s*$' -Quiet
  if (-not $serviceDeclaration) { throw 'Servico megadesk-local-mysql ausente do docker-compose.local.yml.' }

  $containerId = (& docker inspect --format '{{.Id}}' megadesk-local-mysql 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $containerId) {
    throw 'Container megadesk-local-mysql ausente. A automacao se recusa a criar ou recriar banco/volume.'
  }

  $status = (& docker inspect --format '{{.State.Status}}' megadesk-local-mysql 2>$null).Trim()
  $health = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' megadesk-local-mysql 2>$null).Trim()
  if ($status -ne 'running') { throw 'megadesk-local-mysql nao esta em execucao; a automacao se recusa a iniciar, parar ou recriar Docker/MySQL.' }

  $deadline = (Get-Date).AddSeconds(120)
  do {
    $health = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' megadesk-local-mysql 2>$null).Trim()
    if ($health -eq 'healthy') { return }
    if ($health -eq 'unhealthy') { throw 'megadesk-local-mysql esta unhealthy; nenhuma recriacao foi tentada.' }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw 'Timeout aguardando health do megadesk-local-mysql.'
}

function Assert-CloudflaredConfig {
  if (-not (Test-Path -LiteralPath $script:CloudflaredConfig -PathType Leaf)) { throw 'config.yml do cloudflared nao encontrado.' }
  $configText = Get-Content -LiteralPath $script:CloudflaredConfig -Raw
  $requiredPatterns = @(
    '(?m)^\s*tunnel\s*:',
    '(?m)^\s*credentials-file\s*:',
    '(?ms)^\s*-\s*hostname\s*:\s*app\.megadesk\.online\s*$.*?^\s*service\s*:\s*http://(?:127\.0\.0\.1|localhost):3000/?\s*$',
    '(?ms)^\s*-\s*hostname\s*:\s*admin\.megadesk\.online\s*$.*?^\s*service\s*:\s*http://(?:127\.0\.0\.1|localhost):3000/?\s*$',
    '(?ms)^\s*-\s*hostname\s*:\s*api\.megadesk\.online\s*$\s*^\s*path\s*:\s*\^/api/\.\*\s*$\s*^\s*service\s*:\s*http://(?:127\.0\.0\.1|localhost):3000/?\s*$',
    '(?ms)^\s*-\s*hostname\s*:\s*api\.megadesk\.online\s*$\s*^\s*service\s*:\s*http_status:404\s*$',
    '(?m)^\s*-\s*service\s*:\s*http_status:404\s*$'
  )
  foreach ($pattern in $requiredPatterns) {
    if ($configText -notmatch $pattern) {
      throw 'config.yml do cloudflared nao possui todos os hostnames/servicos esperados.'
    }
  }
}

function New-MegaDeskNodeLaunchSpec {
  param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [Parameter(Mandatory = $true)][string]$EnvironmentPath,
    [Parameter(Mandatory = $true)][string]$ScriptPath
  )
  $canonicalExecutable = ConvertTo-MegaDeskCanonicalPath -Path $ExecutablePath
  $canonicalEnvironment = ConvertTo-MegaDeskCanonicalPath -Path $EnvironmentPath
  $canonicalScript = ConvertTo-MegaDeskCanonicalPath -Path $ScriptPath
  return [pscustomobject]@{
    executablePath = $canonicalExecutable
    environmentPath = $canonicalEnvironment
    scriptPath = $canonicalScript
    arguments = '--env-file="{0}" "{1}"' -f $canonicalEnvironment, $canonicalScript
  }
}

function Start-MegaDeskProcess {
  param([Parameter(Mandatory = $true)][System.Diagnostics.ProcessStartInfo]$StartInfo)
  return [System.Diagnostics.Process]::Start($StartInfo)
}

function New-ManagedProcessRecord {
  param($Process, [string]$ExecutablePath, [ValidateSet('node', 'cloudflared')][string]$Kind, [string]$ConfigPath = '', [string]$ScriptPath = '', [string]$EnvironmentPath = '', [string]$ReleaseSha = '', [Nullable[int]]$Port = $null)
  if ($Kind -eq 'node' -and ($null -eq $Port -or $Port -lt 1 -or $Port -gt 65535)) { throw 'Node exige porta valida no record de identidade.' }
  if ($Kind -eq 'cloudflared' -and $null -ne $Port) { throw 'Cloudflared nao pode registrar ownership da porta do Node.' }
  $snapshot = $null
  for ($attempt = 0; $attempt -lt 20 -and $null -eq $snapshot; $attempt++) {
    Start-Sleep -Milliseconds 100
    $snapshot = Get-ProcessSnapshot -ProcessId $Process.Id
  }
  if ($null -eq $snapshot) { throw "Processo $Kind encerrou antes de ser registrado." }
  $startedAtUtc = (ConvertTo-MegaDeskProcessStartUtc -Value $snapshot.CreationDate).ToString('o')
  return [pscustomobject]@{
    pid = [int]$Process.Id
    executablePath = ConvertTo-MegaDeskCanonicalPath -Path $ExecutablePath
    startedAtUtc = $startedAtUtc
    projectRoot = $script:ProjectRoot
    configPath = $ConfigPath
    scriptPath = if ([string]::IsNullOrWhiteSpace($ScriptPath)) { '' } else { ConvertTo-MegaDeskCanonicalPath -Path $ScriptPath }
    environmentPath = if ([string]::IsNullOrWhiteSpace($EnvironmentPath)) { '' } else { ConvertTo-MegaDeskCanonicalPath -Path $EnvironmentPath }
    releaseSha = $ReleaseSha
    port = if ($Kind -eq 'node') { [int]$Port } else { $null }
  }
}

function Start-MegaDeskNode {
  param([string]$ReleaseSha = '', [ValidateRange(1025, 65535)][int]$Port = $script:RuntimePort)
  $state = Get-MegaDeskState
  if ($null -ne $state.node -and (Test-ManagedProcess -Record $state.node -Kind node)) {
    Write-MegaDeskLog 'Processo Node controlado ja esta ativo; nenhuma duplicata foi criada.'
    return $null
  }
  if ($null -ne $state.node) { $state.node = $null; Save-MegaDeskState $state }

  Assert-MegaDeskPortFree -Port $Port -Operation 'inicio do Node' | Out-Null

  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $node) { throw 'node.exe nao foi encontrado no PATH.' }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $node.Source
  $scriptPath = Join-Path $script:ProjectRoot 'dist\index.js'
  $workingDirectory = $script:ProjectRoot
  if (-not [string]::IsNullOrWhiteSpace($ReleaseSha)) {
    $release = Get-MegaDeskRelease -Sha $ReleaseSha
    $scriptPath = Join-Path $release.path 'dist\index.js'
    $workingDirectory = $release.path
  }
  if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw 'Artefato Node da release nao encontrado.' }
  $environmentFile = Join-Path $script:ProjectRoot '.env.local'
  if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) { throw '.env.local obrigatorio ausente fora da release.' }
  $launch = New-MegaDeskNodeLaunchSpec -ExecutablePath $node.Source -EnvironmentPath $environmentFile -ScriptPath $scriptPath
  $psi.FileName = $launch.executablePath
  $psi.Arguments = $launch.arguments
  $psi.WorkingDirectory = $workingDirectory
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['NODE_ENV'] = 'production'
  $psi.EnvironmentVariables['HOST'] = '127.0.0.1'
  $psi.EnvironmentVariables['PORT'] = [string]$Port
  $psi.EnvironmentVariables['TRUST_PROXY_HOPS'] = '1'
  $psi.EnvironmentVariables['MEGADESK_ALLOWED_ORIGINS'] = $script:AllowedOrigins
  if (-not [string]::IsNullOrWhiteSpace($ReleaseSha)) { $psi.EnvironmentVariables['MEGADESK_RELEASE_SHA'] = $ReleaseSha }
  $process = Start-MegaDeskProcess -StartInfo $psi
  try {
    $record = New-ManagedProcessRecord -Process $process -ExecutablePath $launch.executablePath -Kind node -ScriptPath $launch.scriptPath -EnvironmentPath $launch.environmentPath -ReleaseSha $ReleaseSha -Port $Port
  } catch {
    throw ("CRITICO: identidade do Node iniciado nao pode ser comprovada: {0}. Nenhum encerramento por PID foi tentado; intervencao manual e necessaria." -f $_.Exception.Message)
  }
  try {
    $state.node = $record
    Save-MegaDeskState $state
  } catch {
    $stateFailure = $_.Exception.Message
    try {
      Stop-MegaDeskExactManagedProcess -Record $record -Kind node
    } catch {
      throw ("CRITICO: state do Node iniciado nao pode ser persistido: {0}. Compensacao automatica nao pode ser provada: {1}. Intervencao manual e necessaria." -f $stateFailure, $_.Exception.Message)
    }
    throw ("State do Node iniciado nao pode ser persistido; candidate compensada localmente: {0}." -f $stateFailure)
  }
  try { Write-MegaDeskLog ("MegaDesk Node iniciado e controlado (PID {0})." -f $process.Id) } catch { }
  return $record
}

function Start-MegaDeskTunnel {
  $state = Get-MegaDeskState
  if ($null -ne $state.cloudflared -and (Test-ManagedProcess -Record $state.cloudflared -Kind cloudflared)) {
    try { Write-MegaDeskLog 'Cloudflare Tunnel controlado ja esta ativo; nenhuma duplicata foi criada.' } catch { }
    return $null
  }
  if ($null -ne $state.cloudflared) { $state.cloudflared = $null; Save-MegaDeskState $state }

  $cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($null -eq $cloudflared) { throw 'cloudflared.exe nao foi encontrado no PATH.' }
  $existing = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue
  if ($existing) { throw 'Existe cloudflared nao controlado em execucao; inicio duplicado recusado.' }

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $cloudflared.Source
  $psi.Arguments = 'tunnel --config "{0}" run megadesk' -f $script:CloudflaredConfig
  $psi.WorkingDirectory = $script:ProjectRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $process = Start-MegaDeskProcess -StartInfo $psi
  try {
    $record = New-ManagedProcessRecord -Process $process -ExecutablePath $cloudflared.Source -Kind cloudflared -ConfigPath $script:CloudflaredConfig
  } catch {
    throw ("CRITICO: identidade do Cloudflared iniciado nao pode ser comprovada: {0}. Nenhum encerramento por PID foi tentado; cleanup automatico inseguro foi recusado e intervencao manual pode ser necessaria." -f $_.Exception.Message)
  }
  try {
    $state.cloudflared = $record
    Save-MegaDeskState $state
  } catch {
    $stateFailure = $_.Exception.Message
    try {
      Stop-MegaDeskExactManagedProcess -Record $record -Kind cloudflared
    } catch {
      throw ("CRITICO: state do Cloudflared iniciado nao pode ser persistido: {0}. Compensacao automatica nao pode ser provada: {1}. Intervencao manual e necessaria." -f $stateFailure, $_.Exception.Message)
    }
    throw ("State do Cloudflared iniciado nao pode ser persistido; tunnel compensado localmente: {0}." -f $stateFailure)
  }
  try { Write-MegaDeskLog ("Cloudflare Tunnel iniciado e controlado (PID {0})." -f $process.Id) } catch { }
  return $record
}

function Get-HttpStatusCode {
  param([Parameter(Mandatory = $true)][string]$Url, [int]$TimeoutSec = 15)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -MaximumRedirection 5
    return [int]$response.StatusCode
  } catch [System.Net.WebException] {
    if ($null -ne $_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    throw "Falha de rede ao consultar endpoint esperado."
  }
}

function Get-MegaDeskHealth {
  param([Parameter(Mandatory = $true)][string]$Url, [int]$TimeoutSec = 15)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -MaximumRedirection 0
    if ([int]$response.StatusCode -ne 200) { throw 'Health retornou status inesperado.' }
    $payload = $response.Content | ConvertFrom-Json
    if ([string]$payload.status -ne 'healthy') { throw 'Health nao reportou estado healthy.' }
    return $payload
  } catch {
    throw 'Health versionado indisponivel ou invalido.'
  }
}

function Wait-MegaDeskLocal {
  param([string]$ExpectedReleaseSha = '', [ValidateRange(1025, 65535)][int]$Port = $script:RuntimePort, [ValidateRange(1, 90)][int]$TimeoutSeconds = 90)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      if ([string]::IsNullOrWhiteSpace($ExpectedReleaseSha)) {
        if ((Get-HttpStatusCode -Url ("http://127.0.0.1:{0}/" -f $Port) -TimeoutSec 3) -eq 200) {
          Write-MegaDeskLog 'MegaDesk local respondeu HTTP 200.'
          return
        }
      } else {
        $health = Get-MegaDeskHealth -Url ("http://127.0.0.1:{0}/healthz" -f $Port) -TimeoutSec 3
        if ([string]$health.release.sha -ne $ExpectedReleaseSha) { throw 'Health local retornou SHA diferente da release candidata.' }
        Write-MegaDeskLog ("Health local confirmou a release {0}." -f $ExpectedReleaseSha)
        return
      }
    } catch { }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw 'MegaDesk local nao respondeu HTTP 200 dentro do prazo.'
}

function Wait-MegaDeskPublicEndpoints {
  param(
    [ValidateRange(1, 60)][int]$TimeoutSeconds = 60,
    [ValidateRange(0, 5)][int]$PollIntervalSeconds = 1,
    [string]$ExpectedReleaseSha = '',
    [object[]]$Checks = @(),
    [switch]$TestMode
  )

  if ($TestMode -and $script:RuntimePort -eq 3000) { throw 'TestMode exige porta temporaria.' }

  if ($Checks.Count -eq 0) {
    $checks = if ([string]::IsNullOrWhiteSpace($ExpectedReleaseSha)) {
      @(@{ Url = 'https://app.megadesk.online/'; Expected = 200; Label = 'app publico' }, @{ Url = 'https://admin.megadesk.online/'; Expected = 200; Label = 'admin publico' }, @{ Url = 'https://api.megadesk.online/'; Expected = 404; Label = 'raiz da API' })
    } else {
      @(@{ Url = 'https://app.megadesk.online/healthz'; Expected = 200; Label = 'health app publico' }, @{ Url = 'https://admin.megadesk.online/healthz'; Expected = 200; Label = 'health admin publico' }, @{ Url = 'https://api.megadesk.online/'; Expected = 404; Label = 'raiz da API' })
    }
  } else { $checks = $Checks }
  $started = Get-Date
  $deadline = $started.AddSeconds($TimeoutSeconds)
  $attempt = 0
  do {
    $attempt++
    $allReady = $true
    $observations = @()
    foreach ($check in $checks) {
      if (-not $TestMode) {
        $state = Get-MegaDeskState
        if ($null -eq $state.node -or -not (Test-ManagedProcess -Record $state.node -Kind node)) {
          throw 'Node controlado encerrou durante o readiness publico.'
        }
        if ($null -eq $state.cloudflared -or -not (Test-ManagedProcess -Record $state.cloudflared -Kind cloudflared)) {
          throw 'Cloudflared controlado encerrou durante o readiness publico.'
        }
      }
      $remainingSeconds = ($deadline - (Get-Date)).TotalSeconds
      if ($remainingSeconds -lt 1) { $allReady = $false; break }
      $requestTimeout = [Math]::Min(3, [Math]::Floor($remainingSeconds))
      try {
        if (-not [string]::IsNullOrWhiteSpace($ExpectedReleaseSha) -and $check.Label -like 'health*') {
          $health = Get-MegaDeskHealth -Url $check.Url -TimeoutSec $requestTimeout
          if ([string]$health.release.sha -ne $ExpectedReleaseSha) { throw 'Health publico retornou SHA diferente da release candidata.' }
          $actual = 200
        } else {
          $actual = Get-HttpStatusCode -Url $check.Url -TimeoutSec $requestTimeout
        }
        $observations += ("{0}=HTTP {1}" -f $check.Label, $actual)
        if ($actual -ne $check.Expected) { $allReady = $false }
      } catch {
        $observations += ("{0}=indisponivel" -f $check.Label)
        $allReady = $false
      }
    }
    Write-MegaDeskLog ("Readiness publico tentativa {0}: {1}." -f $attempt, ($observations -join '; '))
    if ($allReady -and $observations.Count -eq $checks.Count) {
      if (-not $TestMode) {
        $state = Get-MegaDeskState
        if ($null -eq $state.node -or -not (Test-ManagedProcess -Record $state.node -Kind node)) {
          throw 'Node controlado encerrou durante o readiness publico.'
        }
        if ($null -eq $state.cloudflared -or -not (Test-ManagedProcess -Record $state.cloudflared -Kind cloudflared)) {
          throw 'Cloudflared controlado encerrou durante o readiness publico.'
        }
      }
      $elapsed = [Math]::Round(((Get-Date) - $started).TotalSeconds, 1)
      Write-MegaDeskLog ("Readiness publico concluido em {0} tentativa(s), apos {1} segundo(s)." -f $attempt, $elapsed)
      return
    }
    $remainingSeconds = ($deadline - (Get-Date)).TotalSeconds
    if ($remainingSeconds -lt 1) { break }
    if ($PollIntervalSeconds -gt 0) { Start-Sleep -Seconds ([Math]::Min($PollIntervalSeconds, [Math]::Floor($remainingSeconds))) }
  } while ((Get-Date) -lt $deadline)
  throw ("Readiness publico nao convergiu em {0} segundo(s), apos {1} tentativa(s)." -f $TimeoutSeconds, $attempt)
}

function Test-SameManagedProcessRecord {
  param([Parameter(Mandatory = $true)]$Left, [Parameter(Mandatory = $true)]$Right)
  if ([int]$Left.pid -ne [int]$Right.pid) { return $false }
  if ([System.IO.Path]::GetFullPath([string]$Left.executablePath) -ine [System.IO.Path]::GetFullPath([string]$Right.executablePath)) { return $false }
  try {
    $leftStart = ConvertTo-MegaDeskProcessStartUtc -Value $Left.startedAtUtc
    $rightStart = ConvertTo-MegaDeskProcessStartUtc -Value $Right.startedAtUtc
    return [Math]::Abs(($leftStart - $rightStart).TotalMilliseconds) -le 1
  } catch { return $false }
}

function Stop-MegaDeskExactManagedProcess {
  param(
    [Parameter(Mandatory = $true)]$Record,
    [Parameter(Mandatory = $true)][ValidateSet('node', 'cloudflared')][string]$Kind
  )
  $snapshot = Get-ProcessSnapshot -ProcessId ([int]$Record.pid)
  if ($null -eq $snapshot) { return }
  if (-not (Test-ManagedProcess -Record $Record -Kind $Kind)) {
    throw "Identidade do processo $Kind iniciado nao pode ser comprovada; encerramento recusado."
  }
  Stop-Process -Id ([int]$Record.pid) -ErrorAction Stop
  Wait-Process -Id ([int]$Record.pid) -Timeout 20 -ErrorAction SilentlyContinue
  if ($null -ne (Get-ProcessSnapshot -ProcessId ([int]$Record.pid))) {
    throw "Processo $Kind iniciado nao encerrou durante compensacao local."
  }
}

function Undo-MegaDeskInvocation {
  param($StartedNodeRecord = $null, $StartedTunnelRecord = $null)

  $rollbackErrors = @()
  foreach ($entry in @(
      @{ Kind = 'cloudflared'; Record = $StartedTunnelRecord },
      @{ Kind = 'node'; Record = $StartedNodeRecord }
    )) {
    if ($null -eq $entry.Record) { continue }
    try {
      $state = Get-MegaDeskState
      $current = $state.($entry.Kind)
      if ($null -eq $current -or -not (Test-SameManagedProcessRecord -Left $current -Right $entry.Record)) {
        $cause = 'cleanup recusado: o state nao pertence a esta invocacao.'
        $rollbackErrors += ("{0}: {1}" -f $entry.Kind, $cause)
        try { Write-MegaDeskLog ("Rollback incompleto para {0}: {1}" -f $entry.Kind, $cause) } catch { }
        continue
      }
      $snapshot = Get-ProcessSnapshot -ProcessId ([int]$current.pid)
      if ($null -ne $snapshot) {
        if (-not (Test-ManagedProcess -Record $current -Kind $entry.Kind)) {
          $cause = 'cleanup recusado: identidade gerenciada do processo nao pode ser comprovada; processo preservado.'
          $rollbackErrors += ("{0}: {1}" -f $entry.Kind, $cause)
          try { Write-MegaDeskLog ("Rollback incompleto para {0}: {1}" -f $entry.Kind, $cause) } catch { }
          continue
        }
        Stop-Process -Id ([int]$current.pid) -ErrorAction Stop
        Wait-Process -Id ([int]$current.pid) -Timeout 20 -ErrorAction SilentlyContinue
        if ($null -ne (Get-ProcessSnapshot -ProcessId ([int]$current.pid))) {
          throw ("Rollback nao conseguiu encerrar {0}." -f $entry.Kind)
        }
      }
      $state.($entry.Kind) = $null
      Save-MegaDeskState $state
      try { Write-MegaDeskLog ("Rollback removeu somente {0} iniciado nesta invocacao." -f $entry.Kind) } catch { }
    } catch {
      $cause = $_.Exception.Message
      $rollbackErrors += ("{0}: {1}" -f $entry.Kind, $cause)
      try { Write-MegaDeskLog ("Rollback incompleto para {0}: {1}" -f $entry.Kind, $cause) } catch { }
    }
  }
  if ($rollbackErrors.Count -gt 0) { throw ("Rollback seletivo incompleto: {0}." -f ($rollbackErrors -join ' | ')) }
}

function Stop-MegaDeskManagedProcess {
  param([Parameter(Mandatory = $true)][ValidateSet('node', 'cloudflared')][string]$Kind)
  $state = Get-MegaDeskState
  $record = $state.$Kind
  if ($null -eq $record) {
    Write-MegaDeskLog ("Nenhum processo {0} registrado pela automacao." -f $Kind)
    return
  }
  if (-not (Test-ManagedProcess -Record $record -Kind $Kind)) {
    throw ("Identidade do processo {0} nao confere; encerramento recusado e estado preservado." -f $Kind)
  }
  Stop-Process -Id ([int]$record.pid) -ErrorAction Stop
  Wait-Process -Id ([int]$record.pid) -Timeout 20 -ErrorAction SilentlyContinue
  if ($null -ne (Get-ProcessSnapshot -ProcessId ([int]$record.pid))) { throw ("Processo {0} nao encerrou." -f $Kind) }
  $state.$Kind = $null
  Save-MegaDeskState $state
  Write-MegaDeskLog ("Processo {0} controlado foi encerrado." -f $Kind)
}

function Assert-MegaDeskTestChecks {
  param([object[]]$Checks)
  if ($Checks.Count -eq 0) { throw 'TestMode exige health checks locais explicitos.' }
  foreach ($check in $Checks) {
    $uri = [uri][string]$check.Url
    if ($uri.Host -notin @('127.0.0.1', 'localhost')) { throw 'TestMode aceita somente checks locais.' }
  }
}

function Invoke-MegaDeskReleaseRollback {
  param(
    [Parameter(Mandatory = $true)]$PreviousRelease,
    $StartedCandidateRecord = $null,
    [object[]]$PublicChecks = @(),
    [switch]$TestMode,
    [ValidateRange(1, 90)][int]$LocalTimeoutSeconds = 90,
    [ValidateRange(1, 60)][int]$PublicTimeoutSeconds = 60
  )
  try {
    Set-MegaDeskOperationState -Status 'ROLLING_BACK' -CandidateSha ([string]$PreviousRelease.sha) -Message 'Rollback de codigo iniciado.' | Out-Null
    if ($null -ne $StartedCandidateRecord) { Undo-MegaDeskInvocation -StartedNodeRecord $StartedCandidateRecord }
    Assert-MegaDeskPortFree -Port $script:RuntimePort -Operation 'rollback' | Out-Null
    Start-MegaDeskNode -ReleaseSha ([string]$PreviousRelease.sha) -Port $script:RuntimePort | Out-Null
    Wait-MegaDeskLocal -ExpectedReleaseSha ([string]$PreviousRelease.sha) -Port $script:RuntimePort -TimeoutSeconds $LocalTimeoutSeconds
    Wait-MegaDeskPublicEndpoints -ExpectedReleaseSha ([string]$PreviousRelease.sha) -Checks $PublicChecks -TestMode:$TestMode -TimeoutSeconds $PublicTimeoutSeconds
    $state = Get-MegaDeskState
    $state.activeRelease = [pscustomobject]@{ sha = $PreviousRelease.sha; path = $PreviousRelease.path; activatedAt = (Get-Date).ToUniversalTime().ToString('o') }
    $state.operation = [pscustomobject]@{ status = 'ACTIVE'; candidateSha = $PreviousRelease.sha; updatedAt = (Get-Date).ToUniversalTime().ToString('o'); message = 'Rollback de codigo confirmado por health local e publico.' }
    Save-MegaDeskState $state
    Write-MegaDeskLog ("Rollback confirmou a release anterior {0}." -f $PreviousRelease.sha)
  } catch {
    try { Set-MegaDeskOperationState -Status 'FAILED' -CandidateSha ([string]$PreviousRelease.sha) -Message 'Rollback nao confirmado.' | Out-Null } catch { }
    throw ("CRITICO: rollback da release anterior nao foi confirmado: {0}" -f $_.Exception.Message)
  }
}

function Invoke-MegaDeskReleaseSwitch {
  param(
    [Parameter(Mandatory = $true)]$CandidateRelease,
    [Parameter(Mandatory = $true)]$PreviousRelease,
    [object[]]$PublicChecks = @(),
    [switch]$TestMode,
    [ValidateRange(1, 90)][int]$LocalTimeoutSeconds = 90,
    [ValidateRange(1, 60)][int]$PublicTimeoutSeconds = 60
  )
  if ($TestMode) { Assert-MegaDeskTestChecks -Checks $PublicChecks }
  $startedCandidateRecord = $null
  $oldProcessStopped = $false
  try {
    Set-MegaDeskOperationState -Status 'SWITCHING' -CandidateSha ([string]$CandidateRelease.sha) -Message 'Switch de codigo iniciado.' | Out-Null
    $state = Get-MegaDeskState
    if ($null -ne $state.node) {
      if (-not (Test-ManagedProcess -Record $state.node -Kind node) -or [string]$state.node.releaseSha -ne [string]$PreviousRelease.sha) {
        throw 'Node ativo nao corresponde a release ativa registrada; switch recusado.'
      }
      Stop-MegaDeskManagedProcess -Kind node
      $oldProcessStopped = $true
    } else {
      Assert-MegaDeskPortFree -Port $script:RuntimePort -Operation 'switch' | Out-Null
    }
    Assert-MegaDeskPortFree -Port $script:RuntimePort -Operation 'switch apos parada do runtime gerenciado' | Out-Null
    $startedCandidateRecord = Start-MegaDeskNode -ReleaseSha ([string]$CandidateRelease.sha) -Port $script:RuntimePort
    Wait-MegaDeskLocal -ExpectedReleaseSha ([string]$CandidateRelease.sha) -Port $script:RuntimePort -TimeoutSeconds $LocalTimeoutSeconds
    Wait-MegaDeskPublicEndpoints -ExpectedReleaseSha ([string]$CandidateRelease.sha) -Checks $PublicChecks -TestMode:$TestMode -TimeoutSeconds $PublicTimeoutSeconds
    $state = Get-MegaDeskState
    $state.previousRelease = [pscustomobject]@{ sha = $PreviousRelease.sha; path = $PreviousRelease.path; activatedAt = $state.activeRelease.activatedAt }
    $state.activeRelease = [pscustomobject]@{ sha = $CandidateRelease.sha; path = $CandidateRelease.path; activatedAt = (Get-Date).ToUniversalTime().ToString('o') }
    $state.operation = [pscustomobject]@{ status = 'ACTIVE'; candidateSha = $CandidateRelease.sha; updatedAt = (Get-Date).ToUniversalTime().ToString('o'); message = 'Release candidata confirmada por health local e publico.' }
    Save-MegaDeskState $state
    Write-MegaDeskLog ("Release {0} marcada como ativa." -f $CandidateRelease.sha)
  } catch {
    $switchError = $_.Exception.Message
    if ($oldProcessStopped -or $null -ne $startedCandidateRecord) {
      Invoke-MegaDeskReleaseRollback -PreviousRelease $PreviousRelease -StartedCandidateRecord $startedCandidateRecord -PublicChecks $PublicChecks -TestMode:$TestMode -LocalTimeoutSeconds $LocalTimeoutSeconds -PublicTimeoutSeconds $PublicTimeoutSeconds
    } else {
      Set-MegaDeskOperationState -Status 'FAILED' -CandidateSha ([string]$CandidateRelease.sha) -Message 'Switch recusado antes de interromper a release ativa.' | Out-Null
    }
    throw $switchError
  }
}

function Resolve-MegaDeskCommitSha {
  param([Parameter(Mandatory = $true)][string]$Sha, [Parameter(Mandatory = $true)][string]$Label)
  if (-not (Test-MegaDeskFullSha $Sha)) { throw "$Label deve ser um SHA completo de 40 caracteres hexadecimais." }
  $resolved = @(Invoke-MegaDeskGit -Arguments @('rev-parse', ("{0}^{{commit}}" -f $Sha)) -FailureMessage ("Nao foi possivel resolver o SHA de {0}." -f $Label) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
  if ($resolved.Count -ne 1 -or -not (Test-MegaDeskFullSha ([string]$resolved[0])) -or [string]::Compare([string]$resolved[0], $Sha, $true) -ne 0) {
    throw "$Label nao resolve exatamente para o SHA informado."
  }
  return ([string]$resolved[0]).ToLowerInvariant()
}

function Assert-MegaDeskBootstrapZeroInputs {
  param(
    [Parameter(Mandatory = $true)][string]$CandidateSha,
    [Parameter(Mandatory = $true)][string]$MigrationBaselineSha,
    [Parameter(Mandatory = $true)][string]$CurrentHeadSha
  )
  $candidate = Resolve-MegaDeskCommitSha -Sha $CandidateSha -Label 'CandidateSha'
  $baseline = Resolve-MegaDeskCommitSha -Sha $MigrationBaselineSha -Label 'MigrationBaselineSha'
  if ($candidate -eq $baseline) { throw 'MigrationBaselineSha deve ser diferente de CandidateSha.' }
  if ($candidate -ne $CurrentHeadSha.ToLowerInvariant()) { throw 'CandidateSha deve corresponder exatamente ao HEAD aprovado pelo preflight.' }
  Invoke-MegaDeskGit -Arguments @('merge-base', '--is-ancestor', $baseline, $candidate) -FailureMessage 'MigrationBaselineSha nao e ancestral de CandidateSha; comparacao de migrations recusada.' | Out-Null
  return [pscustomobject]@{ candidateSha = $candidate; baselineSha = $baseline }
}

function Assert-MegaDeskBootstrapZeroState {
  param(
    [Parameter(Mandatory = $true)]$State,
    [Parameter(Mandatory = $true)][string]$CandidateSha,
    [Parameter(Mandatory = $true)][string]$MigrationBaselineSha
  )
  if ($null -ne $State.activeRelease) { throw 'Bootstrap Zero recusado: ja existe activeRelease valida ou registrada.' }
  if ($null -ne $State.previousRelease) { throw 'Bootstrap Zero recusado: previousRelease sem activeRelease e estado ambiguo.' }
  if ($null -eq $State.operation) {
    if ($null -ne $State.node) { throw 'Bootstrap Zero recusado: processo Node registrado sem activeRelease.' }
    if ($null -ne $State.cloudflared) { throw 'Bootstrap Zero recusado: processo Cloudflared registrado sem activeRelease.' }
    return [pscustomobject]@{ status = 'EMPTY'; release = $null }
  }
  if (-not ($State.operation.PSObject.Properties.Name -contains 'kind') -or [string]$State.operation.kind -ne 'BOOTSTRAP_ZERO') {
    throw 'Bootstrap Zero recusado: existe operacao V2 incompativel ou ambigua.'
  }
  if ([string]$State.operation.candidateSha -ne $CandidateSha -or -not ($State.operation.PSObject.Properties.Name -contains 'baselineSha') -or [string]$State.operation.baselineSha -ne $MigrationBaselineSha) {
    throw 'Bootstrap Zero recusado: parametros nao correspondem a operacao Bootstrap pendente.'
  }
  switch ([string]$State.operation.status) {
    'READY' {
      if ($null -ne $State.node) { throw 'Bootstrap Zero READY possui processo Node registrado; estado ambiguo.' }
      return [pscustomobject]@{ status = 'READY'; release = (Get-MegaDeskRelease -Sha $CandidateSha) }
    }
    'SWITCHING' { return [pscustomobject]@{ status = 'SWITCHING'; release = (Get-MegaDeskRelease -Sha $CandidateSha) } }
    'PREPARING' { throw 'Bootstrap Zero anterior ficou em PREPARING; release nao e presumida completa e a recuperacao manual e obrigatoria.' }
    'FAILED' { throw 'Bootstrap Zero anterior falhou; nenhuma reinicializacao automatica e permitida.' }
    'ACTIVE' { throw 'Bootstrap Zero ACTIVE sem activeRelease e estado ambiguo.' }
    default { throw 'Bootstrap Zero possui status de operacao invalido.' }
  }
}

function Assert-MegaDeskBootstrapFailedRecoveryState {
  param([Parameter(Mandatory = $true)]$State)

  if ($State.schemaVersion -isnot [int] -or [int]$State.schemaVersion -ne 2) { throw 'Recovery recusado: schemaVersion V2 invalido.' }
  if ($null -ne $State.activeRelease) { throw 'Recovery recusado: activeRelease existe.' }
  if ($null -ne $State.previousRelease) { throw 'Recovery recusado: previousRelease existe.' }
  if ($null -ne $State.node) { throw 'Recovery recusado: processo Node ainda esta registrado.' }
  if ($null -ne $State.cloudflared) { throw 'Recovery recusado: processo Cloudflared ainda esta registrado.' }
  if ($null -eq $State.operation) { throw 'Recovery recusado: nao existe operacao Bootstrap Zero FAILED.' }

  $operation = $State.operation
  foreach ($property in @('kind', 'status', 'candidateSha', 'baselineSha')) {
    if (-not ($operation.PSObject.Properties.Name -contains $property)) { throw "Recovery recusado: operacao FAILED sem $property." }
  }
  if ([string]$operation.kind -cne 'BOOTSTRAP_ZERO') { throw 'Recovery recusado: operacao nao e BOOTSTRAP_ZERO.' }
  if ([string]$operation.status -cne 'FAILED') { throw 'Recovery recusado: status da operacao nao e FAILED.' }
  if (-not (Test-MegaDeskFullSha ([string]$operation.candidateSha))) { throw 'Recovery recusado: CandidateSha falho invalido.' }
  if (-not (Test-MegaDeskFullSha ([string]$operation.baselineSha))) { throw 'Recovery recusado: MigrationBaselineSha falho invalido.' }

  $candidateSha = [string]$operation.candidateSha
  $releasePath = Assert-MegaDeskPathInside -Path (Join-Path $script:ReleaseRoot $candidateSha) -Root $script:ReleaseRoot -Label 'Release candidata falha'
  if (Test-MegaDeskPhysicalPathExists -Path $releasePath) { throw 'Recovery recusado: release candidata falha ainda existe.' }

  if (Test-MegaDeskPhysicalPathExists -Path $script:StagingRoot) {
    $stagingAttributes = Get-MegaDeskPhysicalPathAttributes -Path $script:StagingRoot
    if (($stagingAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($stagingAttributes -band [IO.FileAttributes]::Directory) -eq 0) {
      throw 'Recovery recusado: staging root invalido ou reparse point.'
    }
    $candidatePattern = '^{0}(?:-[0-9a-f]{{32}})?$' -f [regex]::Escape($candidateSha)
    $residual = @(Get-MegaDeskPhysicalChildPaths -Path $script:StagingRoot | Where-Object { [IO.Path]::GetFileName($_) -match $candidatePattern })
    if ($residual.Count -ne 0) { throw 'Recovery recusado: staging residual da CandidateSha falha existe.' }
  }

  $portOwnership = Get-MegaDeskPortOwnership -Port $script:RuntimePort
  if ($portOwnership.status -eq 'UNKNOWN') { throw 'Recovery recusado: ownership da porta do runtime nao foi provado.' }
  if ($portOwnership.status -eq 'OWNED_BY_MANAGED_PROCESS') { throw 'Recovery recusado: porta do runtime pertence a processo gerenciado.' }

  return [pscustomobject]@{ candidateSha = $candidateSha; priorStatus = [string]$operation.status; portStatus = [string]$portOwnership.status }
}

function Invoke-MegaDeskBootstrapFailedRecovery {
  $state = Get-MegaDeskState
  $recovery = Assert-MegaDeskBootstrapFailedRecoveryState -State $state
  Write-MegaDeskLog ("Recovery Bootstrap Zero iniciado para CandidateSha falho {0}; status anterior {1}." -f $recovery.candidateSha, $recovery.priorStatus)

  $state.node = $null
  $state.cloudflared = $null
  $state.activeRelease = $null
  $state.previousRelease = $null
  $state.operation = $null
  Save-MegaDeskState $state

  Write-MegaDeskLog ("Recovery Bootstrap Zero concluido; state V2 retornou a EMPTY sem reutilizar CandidateSha {0}." -f $recovery.candidateSha)
  return [pscustomobject]@{ status = 'EMPTY'; clearedCandidateSha = $recovery.candidateSha; portStatus = $recovery.portStatus }
}

function Complete-MegaDeskBootstrapZeroActivation {
  param(
    [Parameter(Mandatory = $true)]$CandidateRelease,
    [Parameter(Mandatory = $true)][string]$MigrationBaselineSha
  )
  $state = Get-MegaDeskState
  if ($null -ne $state.activeRelease -or $null -ne $state.previousRelease -or $null -eq $state.operation -or [string]$state.operation.kind -ne 'BOOTSTRAP_ZERO' -or [string]$state.operation.status -ne 'SWITCHING' -or [string]$state.operation.candidateSha -ne [string]$CandidateRelease.sha -or [string]$state.operation.baselineSha -ne $MigrationBaselineSha) {
    throw 'Bootstrap Zero nao pode promover state divergente.'
  }
  if ($null -eq $state.node -or [string]$state.node.releaseSha -ne [string]$CandidateRelease.sha -or -not (Test-ManagedProcess -Record $state.node -Kind node)) {
    throw 'Bootstrap Zero nao pode promover candidate sem identidade Node gerenciada valida.'
  }
  if ($null -eq $state.cloudflared -or -not (Test-ManagedProcess -Record $state.cloudflared -Kind cloudflared)) {
    throw 'Bootstrap Zero nao pode promover candidate sem Cloudflared gerenciado valido.'
  }
  $state.activeRelease = [pscustomobject]@{ sha = $CandidateRelease.sha; path = $CandidateRelease.path; activatedAt = (Get-Date).ToUniversalTime().ToString('o') }
  $state.previousRelease = $null
  $state.operation = New-MegaDeskOperationRecord -Status 'ACTIVE' -Kind 'BOOTSTRAP_ZERO' -CandidateSha $CandidateRelease.sha -BaselineSha $MigrationBaselineSha -Message 'Bootstrap Zero confirmado por health local e publico.'
  Save-MegaDeskState $state
  try { Write-MegaDeskLog ("Bootstrap Zero marcou a release {0} como ativa." -f $CandidateRelease.sha) } catch { }
}

function Resolve-MegaDeskBootstrapZeroOperation {
  param(
    [Parameter(Mandatory = $true)]$State,
    [Parameter(Mandatory = $true)][string]$CandidateSha,
    [Parameter(Mandatory = $true)][string]$MigrationBaselineSha,
    [object[]]$PublicChecks = @(),
    [switch]$TestMode,
    [ValidateRange(1, 90)][int]$LocalTimeoutSeconds = 90,
    [ValidateRange(1, 60)][int]$PublicTimeoutSeconds = 60
  )
  $resolution = Assert-MegaDeskBootstrapZeroState -State $State -CandidateSha $CandidateSha -MigrationBaselineSha $MigrationBaselineSha
  if ($resolution.status -ne 'SWITCHING') { return $resolution }

  $current = Get-MegaDeskState
  if ($null -eq $current.node -or [string]$current.node.releaseSha -ne $CandidateSha -or -not (Test-ManagedProcess -Record $current.node -Kind node)) {
    throw 'Bootstrap Zero SWITCHING e ambiguo: a identidade do candidate nao foi comprovada.'
  }
  Wait-MegaDeskLocal -ExpectedReleaseSha $CandidateSha -Port $script:RuntimePort -TimeoutSeconds $LocalTimeoutSeconds
  Wait-MegaDeskPublicEndpoints -ExpectedReleaseSha $CandidateSha -Checks $PublicChecks -TestMode:$TestMode -TimeoutSeconds $PublicTimeoutSeconds
  Complete-MegaDeskBootstrapZeroActivation -CandidateRelease $resolution.release -MigrationBaselineSha $MigrationBaselineSha
  return [pscustomobject]@{ status = 'ACTIVE'; release = $resolution.release }
}

function Invoke-MegaDeskBootstrapQualityGates {
  param([switch]$RunTests)
  & git diff --check
  if ($LASTEXITCODE -ne 0) { throw 'git diff --check falhou.' }
  & pnpm check
  if ($LASTEXITCODE -ne 0) { throw 'pnpm check falhou.' }
  if ($RunTests) {
    & pnpm test
    if ($LASTEXITCODE -ne 0) { throw 'pnpm test falhou.' }
  } else {
    Write-MegaDeskLog 'Suite completa nao executada no Bootstrap Zero; use -RunTests para habilita-la explicitamente.'
  }
}

function Invoke-MegaDeskBootstrapZero {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedBranch,
    [Parameter(Mandatory = $true)][string]$CandidateSha,
    [Parameter(Mandatory = $true)][string]$MigrationBaselineSha,
    [switch]$RunTests,
    [object[]]$PublicChecks = @(),
    [switch]$TestMode,
    [ValidateRange(1, 90)][int]$LocalTimeoutSeconds = 90,
    [ValidateRange(1, 60)][int]$PublicTimeoutSeconds = 60
  )
  if ($TestMode) { Assert-MegaDeskTestChecks -Checks $PublicChecks }
  $candidate = $null
  $startedCandidateRecord = $null
  $startedTunnelRecord = $null
  try {
    Assert-MegaDeskToolchain -RequirePnpm
    Assert-CloudflaredConfig
    $git = Assert-MegaDeskGitPreflight -ExpectedBranch $ExpectedBranch
    $input = Assert-MegaDeskBootstrapZeroInputs -CandidateSha $CandidateSha -MigrationBaselineSha $MigrationBaselineSha -CurrentHeadSha $git.sha
    $candidate = $input.candidateSha
    $baseline = $input.baselineSha
    $state = Get-MegaDeskState
    $resolution = Resolve-MegaDeskBootstrapZeroOperation -State $state -CandidateSha $candidate -MigrationBaselineSha $baseline -PublicChecks $PublicChecks -TestMode:$TestMode -LocalTimeoutSeconds $LocalTimeoutSeconds -PublicTimeoutSeconds $PublicTimeoutSeconds
    if ($resolution.status -eq 'ACTIVE') { return $resolution.release }

    if ($resolution.status -eq 'EMPTY') {
      Set-MegaDeskOperationState -Status 'PREPARING' -Kind 'BOOTSTRAP_ZERO' -CandidateSha $candidate -BaselineSha $baseline -Message 'Bootstrap Zero iniciou a preparacao da release candidata.' | Out-Null
      $migrationChanges = @(Get-MegaDeskMigrationChanges -FromSha $baseline -ToSha $candidate | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
      if ($migrationChanges.Count -gt 0) { throw 'Bootstrap Zero bloqueado: candidate contem alteracao de banco.' }
      if (Test-MegaDeskDependencyDiff -FromSha $baseline -ToSha $candidate) {
        Write-MegaDeskLog 'Dependencias mudaram desde a baseline explicita; executando install frozen controlado.'
        Invoke-MegaDeskFrozenInstall
      }
      Invoke-MegaDeskBootstrapQualityGates -RunTests:$RunTests
      $candidateRelease = Invoke-MegaDeskIsolatedBuild -Sha $candidate
      Assert-MegaDeskNoSourceMutation
      Set-MegaDeskOperationState -Status 'READY' -Kind 'BOOTSTRAP_ZERO' -CandidateSha $candidate -BaselineSha $baseline -Message 'Bootstrap Zero preparou uma release artifact-valid; ainda nao esta ativa.' | Out-Null
    } else {
      $candidateRelease = $resolution.release
    }

    $confirmation = Read-Host 'Digite INICIALIZAR para iniciar a primeira release imutavel'
    if ($confirmation -cne 'INICIALIZAR') { throw 'Bootstrap Zero cancelado; confirmacao exata nao recebida.' }
    $candidateRelease = Get-MegaDeskRelease -Sha $candidate
    Set-MegaDeskOperationState -Status 'SWITCHING' -Kind 'BOOTSTRAP_ZERO' -CandidateSha $candidate -BaselineSha $baseline -Message 'Bootstrap Start da primeira release iniciado.' | Out-Null
    $current = Get-MegaDeskState
    if ($null -ne $current.activeRelease -or $null -ne $current.previousRelease -or $null -ne $current.node) { throw 'Bootstrap Start recusado: state mudou antes do inicio do candidate.' }
    Assert-MegaDeskPortFree -Port $script:RuntimePort -Operation 'Bootstrap Start' | Out-Null
    $startedCandidateRecord = Start-MegaDeskNode -ReleaseSha $candidate -Port $script:RuntimePort
    if ($null -eq $startedCandidateRecord) { throw 'Bootstrap Start nao recebeu identidade do candidate iniciado.' }
    Wait-MegaDeskLocal -ExpectedReleaseSha $candidate -Port $script:RuntimePort -TimeoutSeconds $LocalTimeoutSeconds
    $startedTunnelRecord = Start-MegaDeskTunnel
    Wait-MegaDeskPublicEndpoints -ExpectedReleaseSha $candidate -Checks $PublicChecks -TestMode:$TestMode -TimeoutSeconds $PublicTimeoutSeconds
    Complete-MegaDeskBootstrapZeroActivation -CandidateRelease $candidateRelease -MigrationBaselineSha $baseline
    return $candidateRelease
  } catch {
    $failure = $_.Exception.Message
    if ($null -ne $startedCandidateRecord -or $null -ne $startedTunnelRecord) {
      try { Undo-MegaDeskInvocation -StartedNodeRecord $startedCandidateRecord -StartedTunnelRecord $startedTunnelRecord } catch { $failure = "$failure Encerramento seletivo do candidate falhou: $($_.Exception.Message)" }
    }
    try {
      $current = Get-MegaDeskState
      if ($null -ne $current.operation -and [string]$current.operation.kind -eq 'BOOTSTRAP_ZERO' -and [string]$current.operation.status -in @('PREPARING', 'READY', 'SWITCHING')) {
        $failedCandidateSha = if ($null -eq $candidate) { $CandidateSha } else { $candidate }
        Set-MegaDeskOperationState -Status 'FAILED' -Kind 'BOOTSTRAP_ZERO' -CandidateSha $failedCandidateSha -BaselineSha $MigrationBaselineSha -Message 'Bootstrap Zero falhou; nao existe rollback automatico anterior.' | Out-Null
      }
    } catch { }
    try { Write-MegaDeskLog ("Bootstrap Zero bloqueado ou falhou: {0}" -f $failure) } catch { }
    throw ("Bootstrap Zero falhou; nao existe rollback automatico anterior: {0}" -f $failure)
  }
}

function Invoke-MegaDeskUpdaterV2 {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedBranch,
    [switch]$RunTests
  )
  $candidateSha = ''
  try {
    Assert-MegaDeskToolchain -RequirePnpm
    $git = Assert-MegaDeskGitPreflight -ExpectedBranch $ExpectedBranch
    $state = Assert-MegaDeskRecoverableState
    $activeRelease = Assert-MegaDeskActiveRelease -State $state
    $candidateSha = $git.sha
    Set-MegaDeskOperationState -Status 'PREPARING' -Kind 'UPDATE' -CandidateSha $candidateSha -Message 'Preflight do updater v2 iniciado.' | Out-Null

    $migrationChanges = @(Get-MegaDeskMigrationChanges -FromSha $activeRelease.sha -ToSha $candidateSha | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($migrationChanges.Count -gt 0) {
      throw 'Atualizacao contem alteracao de banco. Publicacao bloqueada ate execucao do fluxo seguro de migrations.'
    }
    if (Test-MegaDeskDependencyDiff -FromSha $activeRelease.sha -ToSha $candidateSha) {
      Write-MegaDeskLog 'Dependencias mudaram entre releases; executando install frozen controlado.'
      Invoke-MegaDeskFrozenInstall
    }
    & git diff --check
    if ($LASTEXITCODE -ne 0) { throw 'git diff --check falhou.' }
    & pnpm check
    if ($LASTEXITCODE -ne 0) { throw 'pnpm check falhou.' }
    if ($RunTests) {
      & pnpm test
      if ($LASTEXITCODE -ne 0) { throw 'pnpm test falhou.' }
    } else {
      Write-MegaDeskLog 'Suite completa nao executada; use -RunTests para habilita-la explicitamente.'
    }

    $candidateRelease = Invoke-MegaDeskIsolatedBuild -Sha $candidateSha
    Assert-MegaDeskNoSourceMutation
    Set-MegaDeskOperationState -Status 'READY' -CandidateSha $candidateSha -Message 'Release candidata pronta para switch.' | Out-Null
    Write-Host ''
    Write-Host 'MegaDesk Updater v2'
    Write-Host ("Versao ativa:     {0}" -f $activeRelease.sha)
    Write-Host ("Versao candidata: {0}" -f $candidateRelease.sha)
    Write-Host 'Git: OK'
    Write-Host 'Banco: SEM ALTERACAO DE MIGRATION'
    Write-Host 'Build: READY'
    $confirmation = Read-Host 'Digite PUBLICAR para iniciar o switch controlado'
    if ($confirmation -cne 'PUBLICAR') { throw 'Atualizacao cancelada; confirmacao exata nao recebida.' }
    Invoke-MegaDeskReleaseSwitch -CandidateRelease $candidateRelease -PreviousRelease $activeRelease
    Write-MegaDeskLog ("Atualizacao v2 concluida com release ativa {0}." -f $candidateRelease.sha)
  } catch {
    $failure = $_.Exception.Message
    try {
      $current = Get-MegaDeskState
      if ($null -ne $current.operation -and [string]$current.operation.status -in @('PREPARING', 'READY')) {
        Set-MegaDeskOperationState -Status 'FAILED' -CandidateSha $candidateSha -Message 'Preparacao ou confirmacao falhou.' | Out-Null
      }
    } catch { }
    Write-MegaDeskLog ("Atualizacao v2 bloqueada ou falhou: {0}" -f $failure)
    throw $failure
  }
}

function Backup-MegaDeskDist {
  $dist = Join-Path $script:ProjectRoot 'dist'
  if (-not (Test-Path -LiteralPath $dist)) { return $null }
  Initialize-MegaDeskRuntime
  $backup = Join-Path $script:BackupRoot ('dist-{0}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  Copy-Item -LiteralPath $dist -Destination $backup -Recurse
  Write-MegaDeskLog 'Backup recuperavel do dist anterior criado fora do repositorio.'
  return $backup
}

function Restore-MegaDeskDist {
  param([string]$BackupPath)
  $dist = Join-Path $script:ProjectRoot 'dist'
  $expectedDist = [System.IO.Path]::GetFullPath((Join-Path $script:ProjectRoot 'dist'))
  if ([System.IO.Path]::GetFullPath($dist) -ne $expectedDist) { throw 'Destino dist inesperado; restauracao recusada.' }
  if ((Test-Path -LiteralPath $dist) -and ((Get-Item -LiteralPath $dist -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'dist e um reparse point; restauracao destrutiva recusada.'
  }
  if (Test-Path -LiteralPath $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
  if ($BackupPath -and (Test-Path -LiteralPath $BackupPath)) {
    Copy-Item -LiteralPath $BackupPath -Destination $dist -Recurse
    Write-MegaDeskLog 'dist anterior restaurado apos falha.'
  } else {
    Write-MegaDeskLog 'Build parcial removido; nao havia dist anterior para restaurar.'
  }
}

Export-ModuleMember -Function @(
  'Write-MegaDeskLog', 'Get-MegaDeskState', 'Test-ManagedProcess', 'Get-PortOwner', 'Assert-MegaDeskToolchain',
  'Assert-MegaDeskArtifacts', 'Assert-DockerAndMySql', 'Assert-CloudflaredConfig',
  'Start-MegaDeskNode', 'Start-MegaDeskTunnel', 'Wait-MegaDeskLocal',
  'Wait-MegaDeskPublicEndpoints', 'Undo-MegaDeskInvocation', 'Stop-MegaDeskManagedProcess',
  'Backup-MegaDeskDist', 'Restore-MegaDeskDist', 'Invoke-MegaDeskUpdaterV2', 'Invoke-MegaDeskBootstrapZero',
  'Invoke-MegaDeskBootstrapFailedRecovery'
)
