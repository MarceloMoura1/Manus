#requires -Version 5.1
[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'MegaDesk.Automation.psm1') -Force

$diagnosticsRoot = Join-Path (Join-Path $env:LOCALAPPDATA 'MegaDesk') 'diagnostics'
$maxReportBytes = 65536
$containers = @('megadesk-evolution', 'megadesk-evolution-db')

function Test-SafeEndpoint {
  param([Parameter(Mandatory = $true)][string]$Uri, [int[]]$AcceptedStatus = @(200))
  $started = [DateTime]::UtcNow
  try {
    $request = [System.Net.HttpWebRequest]::Create($Uri)
    $request.Method = 'GET'; $request.AllowAutoRedirect = $false; $request.Timeout = 4000
    try { $response = $request.GetResponse() } catch [System.Net.WebException] { $response = $_.Exception.Response; if ($null -eq $response) { throw } }
    $status = [int]$response.StatusCode; $response.Close()
    return [ordered]@{ reachable = ($AcceptedStatus -contains $status); status = $status; latencyMs = [int]([DateTime]::UtcNow - $started).TotalMilliseconds }
  } catch { return [ordered]@{ reachable = $false; status = $null; latencyMs = $null } }
}

function Get-SafeContainerState {
  param([Parameter(Mandatory = $true)][string]$Name)
  $raw = & docker inspect --format '{{json .State}}' $Name 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { return [ordered]@{ found=$false; running=$false; health='unknown'; restartCount=$null } }
  $state = $raw | ConvertFrom-Json
  $restartRaw = & docker inspect --format '{{.RestartCount}}' $Name 2>$null
  $health = 'not_configured'; if ($null -ne $state.Health) { $health = [string]$state.Health.Status }
  return [ordered]@{ found=$true; running=[bool]$state.Running; health=$health; restartCount=if($LASTEXITCODE -eq 0){[int]$restartRaw}else{$null} }
}

function Get-SafeEvolutionFlags {
  $result = [ordered]@{ localCacheDisabled=$null; redisDisabled=$null; instancePreserved=$null }
  $raw = & docker inspect --format '{{json .Config.Env}}' 'megadesk-evolution' 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { return $result }
  foreach ($entry in ($raw | ConvertFrom-Json)) {
    if ($entry -eq 'CACHE_LOCAL_ENABLED=false') { $result.localCacheDisabled=$true }
    elseif ($entry -like 'CACHE_LOCAL_ENABLED=*') { $result.localCacheDisabled=$false }
    elseif ($entry -eq 'CACHE_REDIS_ENABLED=false') { $result.redisDisabled=$true }
    elseif ($entry -like 'CACHE_REDIS_ENABLED=*') { $result.redisDisabled=$false }
    elseif ($entry -eq 'DEL_INSTANCE=false') { $result.instancePreserved=$true }
    elseif ($entry -like 'DEL_INSTANCE=*') { $result.instancePreserved=$false }
  }
  return $result
}

function Get-SafeLogCounts {
  $counts=[ordered]@{ providerIdentifierValidation=0; prismaValidation=0; webhookFailure=0; authenticationFailure=0 }
  $lines=& docker logs --tail 300 'megadesk-evolution' 2>&1
  if ($LASTEXITCODE -ne 0) { return $counts }
  foreach($line in $lines){$value=[string]$line;if($value -match '(?i)unknown argument.{0,40}lid'){ $counts.providerIdentifierValidation++ };if($value -match 'PrismaClientValidationError'){ $counts.prismaValidation++ };if($value -match '(?i)webhook.{0,80}(fail|error)'){ $counts.webhookFailure++ };if($value -match '(?i)(unauthorized|authentication failed)'){ $counts.authenticationFailure++ }}
  return $counts
}

$state=Get-MegaDeskState
$nodeManaged=$false; if($null -ne $state.node){$nodeManaged=Test-ManagedProcess -Record $state.node -Kind node}
$tunnelManaged=$false; if($null -ne $state.cloudflared){$tunnelManaged=Test-ManagedProcess -Record $state.cloudflared -Kind cloudflared}
$portOwner=Get-PortOwner -Port 3000
$dockerAvailable=$false
try { & docker info *> $null; $dockerAvailable=($LASTEXITCODE -eq 0) } catch { $dockerAvailable=$false }
$containerStates=[ordered]@{}; $flags=[ordered]@{localCacheDisabled=$null;redisDisabled=$null;instancePreserved=$null};$logCounts=[ordered]@{providerIdentifierValidation=0;prismaValidation=0;webhookFailure=0;authenticationFailure=0}
if($dockerAvailable){foreach($name in $containers){$containerStates[$name]=Get-SafeContainerState -Name $name};$flags=Get-SafeEvolutionFlags;$logCounts=Get-SafeLogCounts}
$restartLoop=$false;foreach($entry in $containerStates.GetEnumerator()){if($null -ne $entry.Value.restartCount -and $entry.Value.restartCount -ge 3){$restartLoop=$true}}

$report=[ordered]@{
  schemaVersion=1; readOnly=$true; timestamp=(Get-Date).ToUniversalTime().ToString('o'); maxBytes=$maxReportBytes
  runtime=[ordered]@{port3000Listening=($null -ne $portOwner);nodeManaged=$nodeManaged;cloudflaredManaged=$tunnelManaged}
  endpoints=[ordered]@{local=(Test-SafeEndpoint 'http://127.0.0.1:3000');app=(Test-SafeEndpoint 'https://app.megadesk.online');admin=(Test-SafeEndpoint 'https://admin.megadesk.online');apiRoot=(Test-SafeEndpoint 'https://api.megadesk.online' @(404))}
  docker=[ordered]@{available=$dockerAvailable;containers=$containerStates;restartLoop=$restartLoop}
  criticalFlags=$flags;recentErrorCategories=$logCounts
  notice='Diagnostico exclusivamente read-only. Nao contem mensagens, identificadores de contato, payloads, credenciais ou command lines.'
}
$json=$report|ConvertTo-Json -Depth 7
$bytes=[Text.Encoding]::UTF8.GetByteCount($json);if($bytes -gt $maxReportBytes){throw 'Relatorio sanitizado excedeu o limite de tamanho.'}
if(-not(Test-Path -LiteralPath $diagnosticsRoot)){New-Item -ItemType Directory -Path $diagnosticsRoot -Force|Out-Null}
$path=Join-Path $diagnosticsRoot ('diagnostico-{0}.json' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
[IO.File]::WriteAllText($path,$json,(New-Object Text.UTF8Encoding($false)))
Write-Host 'Diagnostico read-only concluido.';Write-Host ('Relatorio sanitizado: {0}' -f $path)
