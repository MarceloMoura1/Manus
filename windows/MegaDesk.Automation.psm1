Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:RuntimeRoot = Join-Path $env:LOCALAPPDATA 'MegaDesk'
$script:StatePath = Join-Path $script:RuntimeRoot 'automation-state.json'
$script:LogPath = Join-Path $script:RuntimeRoot 'automation.log'
$script:BackupRoot = Join-Path $script:RuntimeRoot 'backups'
$script:CloudflaredConfig = Join-Path $env:USERPROFILE '.cloudflared\config.yml'
$script:AllowedOrigins = 'http://127.0.0.1:3000,http://localhost:3000,https://app.megadesk.online,https://admin.megadesk.online,https://api.megadesk.online'

function Initialize-MegaDeskRuntime {
  foreach ($path in @($script:RuntimeRoot, $script:BackupRoot)) {
    if (-not (Test-Path -LiteralPath $path)) {
      New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
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
    return [pscustomobject]@{ node = $null; cloudflared = $null }
  }
  try {
    $state = Get-Content -LiteralPath $script:StatePath -Raw | ConvertFrom-Json
    if (-not ($state.PSObject.Properties.Name -contains 'node')) { Add-Member -InputObject $state -NotePropertyName node -NotePropertyValue $null }
    if (-not ($state.PSObject.Properties.Name -contains 'cloudflared')) { Add-Member -InputObject $state -NotePropertyName cloudflared -NotePropertyValue $null }
    return $state
  } catch {
    throw 'Arquivo de estado da automacao invalido. Revise %LOCALAPPDATA%\MegaDesk\automation-state.json manualmente.'
  }
}

function Save-MegaDeskState {
  param([Parameter(Mandatory = $true)]$State)
  Initialize-MegaDeskRuntime
  if ($null -eq $State.node -and $null -eq $State.cloudflared) {
    if (Test-Path -LiteralPath $script:StatePath) { Remove-Item -LiteralPath $script:StatePath -Force }
    return
  }
  $State | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $script:StatePath -Encoding UTF8
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

function Get-ProcessSnapshot {
  param([Parameter(Mandatory = $true)][int]$ProcessId)
  Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $ProcessId) -ErrorAction SilentlyContinue
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

function Test-ManagedProcess {
  param(
    [Parameter(Mandatory = $true)]$Record,
    [Parameter(Mandatory = $true)][ValidateSet('node', 'cloudflared')][string]$Kind
  )
  if ($null -eq $Record -or -not $Record.pid) { return $false }
  $process = Get-ProcessSnapshot -ProcessId ([int]$Record.pid)
  if ($null -eq $process) { return $false }
  if ([string]::IsNullOrWhiteSpace([string]$process.ExecutablePath)) { return $false }

  $expectedName = if ($Kind -eq 'node') { 'node.exe' } else { 'cloudflared.exe' }
  if ([System.IO.Path]::GetFileName($process.ExecutablePath) -ine $expectedName) { return $false }
  if ([System.IO.Path]::GetFullPath($process.ExecutablePath) -ine [System.IO.Path]::GetFullPath([string]$Record.executablePath)) { return $false }

  $commandLine = [string]$process.CommandLine
  if ($Kind -eq 'node') {
    if ($commandLine -notmatch [regex]::Escape('--env-file=.env.local')) { return $false }
    if ($commandLine -notmatch 'dist[\\/]index\.js') { return $false }
  } else {
    if ($commandLine -notmatch '(?i)\btunnel\b') { return $false }
    if ($commandLine -notmatch '(?i)\brun\s+megadesk\b') { return $false }
    if ($commandLine -notmatch [regex]::Escape([string]$Record.configPath)) { return $false }
  }

  try {
    $actualStart = ConvertTo-MegaDeskProcessStartUtc -Value $process.CreationDate
    $recordedStart = ConvertTo-MegaDeskProcessStartUtc -Value $Record.startedAtUtc
    if ([Math]::Abs(($actualStart - $recordedStart).TotalMilliseconds) -gt 1) { return $false }
  } catch { return $false }
  return $true
}

function Get-PortOwner {
  param([int]$Port = 3000)
  $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $connection) { return $null }
  return Get-ProcessSnapshot -ProcessId ([int]$connection.OwningProcess)
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
  if ($status -ne 'running') {
    Write-MegaDeskLog 'Iniciando somente o container existente megadesk-local-mysql.'
    & docker start megadesk-local-mysql *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao iniciar o container existente megadesk-local-mysql.' }
  }

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

function New-ManagedProcessRecord {
  param($Process, [string]$ExecutablePath, [string]$Kind, [string]$ConfigPath = '')
  $snapshot = $null
  for ($attempt = 0; $attempt -lt 20 -and $null -eq $snapshot; $attempt++) {
    Start-Sleep -Milliseconds 100
    $snapshot = Get-ProcessSnapshot -ProcessId $Process.Id
  }
  if ($null -eq $snapshot) { throw "Processo $Kind encerrou antes de ser registrado." }
  $startedAtUtc = (ConvertTo-MegaDeskProcessStartUtc -Value $snapshot.CreationDate).ToString('o')
  return [pscustomobject]@{
    pid = [int]$Process.Id
    executablePath = [System.IO.Path]::GetFullPath($ExecutablePath)
    startedAtUtc = $startedAtUtc
    projectRoot = $script:ProjectRoot
    configPath = $ConfigPath
  }
}

function Start-MegaDeskNode {
  $state = Get-MegaDeskState
  if ($null -ne $state.node -and (Test-ManagedProcess -Record $state.node -Kind node)) {
    Write-MegaDeskLog 'Processo Node controlado ja esta ativo; nenhuma duplicata foi criada.'
    return $null
  }
  if ($null -ne $state.node) { $state.node = $null; Save-MegaDeskState $state }

  $owner = Get-PortOwner -Port 3000
  if ($null -ne $owner) { throw ("Porta 3000 pertence a processo nao controlado (PID {0}); inicio recusado." -f $owner.ProcessId) }

  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $node) { throw 'node.exe nao foi encontrado no PATH.' }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $node.Source
  $psi.Arguments = '--env-file=.env.local dist/index.js'
  $psi.WorkingDirectory = $script:ProjectRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['NODE_ENV'] = 'production'
  $psi.EnvironmentVariables['HOST'] = '127.0.0.1'
  $psi.EnvironmentVariables['PORT'] = '3000'
  $psi.EnvironmentVariables['TRUST_PROXY_HOPS'] = '1'
  $psi.EnvironmentVariables['MEGADESK_ALLOWED_ORIGINS'] = $script:AllowedOrigins
  $process = [System.Diagnostics.Process]::Start($psi)
  try {
    $state.node = New-ManagedProcessRecord -Process $process -ExecutablePath $node.Source -Kind node
  } catch {
    Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
    throw
  }
  Save-MegaDeskState $state
  Write-MegaDeskLog ("MegaDesk Node iniciado e controlado (PID {0})." -f $process.Id)
  return $state.node
}

function Start-MegaDeskTunnel {
  $state = Get-MegaDeskState
  if ($null -ne $state.cloudflared -and (Test-ManagedProcess -Record $state.cloudflared -Kind cloudflared)) {
    Write-MegaDeskLog 'Cloudflare Tunnel controlado ja esta ativo; nenhuma duplicata foi criada.'
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
  $process = [System.Diagnostics.Process]::Start($psi)
  try {
    $state.cloudflared = New-ManagedProcessRecord -Process $process -ExecutablePath $cloudflared.Source -Kind cloudflared -ConfigPath $script:CloudflaredConfig
  } catch {
    Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
    throw
  }
  Save-MegaDeskState $state
  Write-MegaDeskLog ("Cloudflare Tunnel iniciado e controlado (PID {0})." -f $process.Id)
  return $state.cloudflared
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

function Wait-MegaDeskLocal {
  $deadline = (Get-Date).AddSeconds(90)
  do {
    try {
      if ((Get-HttpStatusCode -Url 'http://127.0.0.1:3000/' -TimeoutSec 3) -eq 200) {
        Write-MegaDeskLog 'MegaDesk local respondeu HTTP 200.'
        return
      }
    } catch { }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw 'MegaDesk local nao respondeu HTTP 200 dentro do prazo.'
}

function Wait-MegaDeskPublicEndpoints {
  param([ValidateRange(1, 60)][int]$TimeoutSeconds = 60, [ValidateRange(0, 5)][int]$PollIntervalSeconds = 1)

  $checks = @(
    @{ Url = 'https://app.megadesk.online/'; Expected = 200; Label = 'app publico' },
    @{ Url = 'https://admin.megadesk.online/'; Expected = 200; Label = 'admin publico' },
    @{ Url = 'https://api.megadesk.online/'; Expected = 404; Label = 'raiz da API' }
  )
  $started = Get-Date
  $deadline = $started.AddSeconds($TimeoutSeconds)
  $attempt = 0
  do {
    $attempt++
    $allReady = $true
    $observations = @()
    foreach ($check in $checks) {
      $state = Get-MegaDeskState
      if ($null -eq $state.node -or -not (Test-ManagedProcess -Record $state.node -Kind node)) {
        throw 'Node controlado encerrou durante o readiness publico.'
      }
      if ($null -eq $state.cloudflared -or -not (Test-ManagedProcess -Record $state.cloudflared -Kind cloudflared)) {
        throw 'Cloudflared controlado encerrou durante o readiness publico.'
      }
      $remainingSeconds = ($deadline - (Get-Date)).TotalSeconds
      if ($remainingSeconds -lt 1) { $allReady = $false; break }
      $requestTimeout = [Math]::Min(3, [Math]::Floor($remainingSeconds))
      try {
        $actual = Get-HttpStatusCode -Url $check.Url -TimeoutSec $requestTimeout
        $observations += ("{0}=HTTP {1}" -f $check.Label, $actual)
        if ($actual -ne $check.Expected) { $allReady = $false }
      } catch {
        $observations += ("{0}=indisponivel" -f $check.Label)
        $allReady = $false
      }
    }
    Write-MegaDeskLog ("Readiness publico tentativa {0}: {1}." -f $attempt, ($observations -join '; '))
    if ($allReady -and $observations.Count -eq $checks.Count) {
      $state = Get-MegaDeskState
      if ($null -eq $state.node -or -not (Test-ManagedProcess -Record $state.node -Kind node)) {
        throw 'Node controlado encerrou durante o readiness publico.'
      }
      if ($null -eq $state.cloudflared -or -not (Test-ManagedProcess -Record $state.cloudflared -Kind cloudflared)) {
        throw 'Cloudflared controlado encerrou durante o readiness publico.'
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
        Write-MegaDeskLog ("Rollback recusou {0}: o state nao pertence a esta invocacao." -f $entry.Kind)
        continue
      }
      $snapshot = Get-ProcessSnapshot -ProcessId ([int]$current.pid)
      if ($null -ne $snapshot) {
        if (-not (Test-ManagedProcess -Record $current -Kind $entry.Kind)) {
          Write-MegaDeskLog ("Rollback preservou {0}: identidade do processo nao confere." -f $entry.Kind)
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
      Write-MegaDeskLog ("Rollback removeu somente {0} iniciado nesta invocacao." -f $entry.Kind)
    } catch {
      $rollbackErrors += $entry.Kind
    }
  }
  if ($rollbackErrors.Count -gt 0) { throw ("Rollback seletivo incompleto para: {0}." -f ($rollbackErrors -join ', ')) }
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
  'Backup-MegaDeskDist', 'Restore-MegaDeskDist'
)
