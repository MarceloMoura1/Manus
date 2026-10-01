[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateScript({ [IO.Path]::IsPathRooted($_) })][string]$RuntimeUserProfile,
  [Parameter(Mandatory = $true)][ValidateScript({ [IO.Path]::IsPathRooted($_) })][string]$RuntimeLocalAppData,
  [Parameter(Mandatory = $true)][ValidateScript({ [IO.Path]::IsPathRooted($_) })][string]$RuntimeAppData,
  [Parameter(Mandatory = $true)][string]$ToolPathPrefix,
  [ValidateRange(30, 3600)][int]$PollSeconds = 300,
  [ValidateRange(1, 3600)][int]$DependencyTimeoutSeconds = 1800,
  [switch]$Once
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$toolDirectories = @($ToolPathPrefix -split [regex]::Escape([string][IO.Path]::PathSeparator) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if ($toolDirectories.Count -eq 0) { throw 'PATH deterministico do autostart esta vazio.' }

foreach ($path in @($RuntimeUserProfile, $RuntimeLocalAppData, $RuntimeAppData) + $toolDirectories) {
  if (-not (Test-Path -LiteralPath $path -PathType Container)) {
    throw "Diretorio obrigatorio do autostart nao encontrado: $path"
  }
}

$env:USERPROFILE = [IO.Path]::GetFullPath($RuntimeUserProfile)
$env:LOCALAPPDATA = [IO.Path]::GetFullPath($RuntimeLocalAppData)
$env:APPDATA = [IO.Path]::GetFullPath($RuntimeAppData)
$resolvedToolDirectories = @($toolDirectories | ForEach-Object { [IO.Path]::GetFullPath($_) } | Select-Object -Unique)
$env:PATH = (($resolvedToolDirectories + @($env:PATH)) -join [IO.Path]::PathSeparator)

$modulePath = Join-Path $PSScriptRoot 'MegaDesk.Automation.psm1'
Import-Module $modulePath -Force
Enable-MegaDeskOperationalContext

$runtimeRoot = Join-Path $env:LOCALAPPDATA 'MegaDesk'
$logPath = Join-Path $runtimeRoot 'autostart.log'
$launcherPath = Join-Path $PSScriptRoot 'Iniciar-MegaDesk.ps1'
$powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

function Write-MegaDeskAutostartLog {
  param([Parameter(Mandatory = $true)][string]$Message)
  $safeMessage = $Message -replace '[\r\n]+', ' '
  Add-Content -LiteralPath $logPath -Value ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $safeMessage) -Encoding UTF8
}

function Test-MegaDeskDockerEngine {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell 5 can promote native stderr to a terminating
    # NativeCommandError while the engine pipe is still absent at boot.
    $ErrorActionPreference = 'SilentlyContinue'
    $null = & docker info *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

function Request-MegaDeskDockerDesktopStart {
  $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
  if ($null -eq $dockerCommand -or [string]::IsNullOrWhiteSpace([string]$dockerCommand.Source)) {
    throw 'docker.exe nao foi encontrado no PATH deterministico do autostart.'
  }
  Write-MegaDeskAutostartLog 'Docker Engine indisponivel; solicitando start pelo Docker Desktop CLI.'
  $request = Start-Process -FilePath $dockerCommand.Source -ArgumentList @('desktop', 'start', '--detach', '--timeout', '120') -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 2
  if ($request.HasExited) {
    if ($request.ExitCode -ne 0) {
      Write-MegaDeskAutostartLog ("Docker Desktop CLI retornou exitCode={0}; o bootstrap oficial fara retry limitado." -f $request.ExitCode)
    } else {
      Write-MegaDeskAutostartLog 'Docker Desktop CLI aceitou a solicitacao de start.'
    }
  } else {
    Write-MegaDeskAutostartLog ("Docker Desktop CLI segue em background; pid={0}; o bootstrap oficial observara a prontidao." -f $request.Id)
  }
}

function Test-MegaDeskActiveRuntimeHealthy {
  try {
    $state = Get-MegaDeskState
    $sha = [string]$state.activeRelease.sha
    if ($state.schemaVersion -ne 2 -or [string]$state.operation.status -cne 'ACTIVE' -or $sha -notmatch '^[0-9a-f]{40}$') { return $false }
    if ($null -eq $state.node -or [string]$state.node.releaseSha -cne $sha -or $null -eq $state.cloudflared) { return $false }
    if (-not (Test-ManagedProcess -Record $state.node -Kind node)) { return $false }
    if (-not (Test-ManagedProcess -Record $state.cloudflared -Kind cloudflared)) { return $false }

    foreach ($url in @(
        'http://127.0.0.1:3000/healthz',
        'https://app.megadesk.online/healthz',
        'https://admin.megadesk.online/healthz'
      )) {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 0 -ErrorAction Stop
      if ([int]$response.StatusCode -ne 200) { return $false }
      $payload = $response.Content | ConvertFrom-Json -ErrorAction Stop
      if ([string]$payload.status -cne 'healthy' -or [string]$payload.release.sha -cne $sha) { return $false }
    }
    return $true
  } catch {
    return $false
  }
}

function Invoke-MegaDeskOfficialStartup {
  $arguments = @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', $launcherPath,
    '-NoBrowser',
    '-DependencyTimeoutSeconds', [string]$DependencyTimeoutSeconds,
    '-DependencyMaxBackoffSeconds', '30'
  )
  # Do not pipe the launcher output. Long-lived descendants can inherit the
  # pipe handle and keep this supervisor blocked after the launcher exits.
  # Process.WaitForExit observes only the direct launcher process.
  $process = Start-Process -FilePath $powerShellPath -ArgumentList $arguments -WindowStyle Hidden -PassThru
  try {
    $process.WaitForExit()
    return [int]$process.ExitCode
  } finally {
    $process.Dispose()
  }
}

$mutex = New-Object System.Threading.Mutex($false, 'Global\MegaDesk.RuntimeSupervisor')
$acquired = $false
try {
  try { $acquired = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $acquired = $true }
  if (-not $acquired) {
    Write-MegaDeskAutostartLog 'Outra instancia do supervisor ja esta ativa; nenhuma duplicata foi criada.'
    exit 0
  }

  Write-MegaDeskAutostartLog 'Supervisor de runtime iniciado.'
  do {
    try {
      $dockerReady = Test-MegaDeskDockerEngine
      if (-not $dockerReady) {
        Request-MegaDeskDockerDesktopStart
      }
      if ($dockerReady -and (Test-MegaDeskActiveRuntimeHealthy)) {
        Write-MegaDeskAutostartLog 'Health periodico confirmou o runtime ACTIVE sem reinvocar o lifecycle.'
      } else {
        Write-MegaDeskAutostartLog 'event=SUPERVISOR_RECOVERY_STARTED action=INVOKE_OFFICIAL_STARTUP.'
        $exitCode = Invoke-MegaDeskOfficialStartup
        if ($exitCode -eq 0) {
          Write-MegaDeskAutostartLog 'Bootstrap oficial confirmou o runtime ACTIVE.'
        } else {
          Write-MegaDeskAutostartLog ("event=SUPERVISOR_RECOVERY_BLOCKED exit_code={0}; nova tentativa sera limitada pelo supervisor." -f $exitCode)
        }
      }
    } catch {
      Write-MegaDeskAutostartLog ('Falha sanitizada no ciclo do supervisor: ' + (($_.Exception.Message) -replace '[\r\n]+', ' '))
    }
    if ($Once) { break }
    Start-Sleep -Seconds $PollSeconds
  } while ($true)
} finally {
  if ($acquired) { try { $mutex.ReleaseMutex() } catch { } }
  $mutex.Dispose()
}
