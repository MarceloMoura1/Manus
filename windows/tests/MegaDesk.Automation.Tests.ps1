$modulePath = Join-Path $PSScriptRoot '..\MegaDesk.Automation.psm1'
Import-Module $modulePath -Force
$moduleName = 'MegaDesk.Automation'

function Get-IsolatedTestPort {
  foreach ($port in 32120..32180) {
    if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { return $port }
  }
  throw 'Nenhuma porta temporaria livre para o teste do updater.'
}

function New-BootstrapReleaseRuntimeFixture {
  param([string]$ReleaseRoot, [string]$Sha)
  $releasePath = Join-Path $ReleaseRoot $Sha
  New-Item -ItemType Directory -Path (Join-Path $releasePath 'dist\public') -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $releasePath 'dist\index.js') -Value 'export {}' -NoNewline
  New-Item -ItemType Directory -Path (Join-Path $releasePath 'node_modules\dotenv') -Force | Out-Null
  [ordered]@{ name = 'bootstrap-fixture'; dependencies = [ordered]@{ dotenv = '1.0.0' } } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $releasePath 'package.json') -Encoding UTF8 -NoNewline
  [ordered]@{ sha = $Sha; buildStatus = 'ready'; runtime = [ordered]@{ strategy = 'pnpm-deploy-legacy-prod'; dependenciesPath = 'node_modules' } } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $releasePath 'release.json') -Encoding UTF8 -NoNewline
  return $releasePath
}

Describe 'MegaDesk Bootstrap Zero' {
  BeforeEach {
    $script:port = Get-IsolatedTestPort
    $script:runtimeRoot = Join-Path $TestDrive 'bootstrap-runtime'
    $script:projectRoot = Join-Path $TestDrive 'bootstrap-project'
    New-Item -ItemType Directory -Path $script:projectRoot -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $script:projectRoot '.env.local') -Value '' -NoNewline
    & (Get-Module $moduleName) { param($runtimeRoot, $projectRoot, $port) Set-MegaDeskAutomationPaths -RuntimeRoot $runtimeRoot -ProjectRoot $projectRoot -Port $port } $script:runtimeRoot $script:projectRoot $script:port
  }

  It 'launches Bootstrap Zero only for the approved release branch' {
    $launcher = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\Inicializar-UpdaterV2.ps1') -Raw
    $launcher | Should Match "Invoke-MegaDeskBootstrapZero -ExpectedBranch 'release/updater-v2-bootstrap'"
    $launcher | Should Not Match "Invoke-MegaDeskBootstrapZero -ExpectedBranch 'wip/conversations-0013-lifecycle'"
  }

  It 'accepts only an empty V2 state for a new Bootstrap Zero operation' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $baseline = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    $global:MegaDeskBootstrapCandidate = $candidate
    $global:MegaDeskBootstrapBaseline = $baseline
    InModuleScope $moduleName {
      $state = Get-MegaDeskState
      (Assert-MegaDeskBootstrapZeroState -State $state -CandidateSha $global:MegaDeskBootstrapCandidate -MigrationBaselineSha $global:MegaDeskBootstrapBaseline).status | Should Be 'EMPTY'
    }
  }

  It 'rejects active or orphaned previous releases before Bootstrap Zero' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $baseline = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    $global:MegaDeskBootstrapCandidate = $candidate
    $global:MegaDeskBootstrapBaseline = $baseline
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapCandidate
      $baseline = $global:MegaDeskBootstrapBaseline
      $active = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = [pscustomobject]@{ sha = $candidate }; previousRelease = $null; operation = $null }
      { Assert-MegaDeskBootstrapZeroState -State $active -CandidateSha $candidate -MigrationBaselineSha $baseline } | Should Throw
      $orphanedPrevious = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = [pscustomobject]@{ sha = $baseline }; operation = $null }
      { Assert-MegaDeskBootstrapZeroState -State $orphanedPrevious -CandidateSha $candidate -MigrationBaselineSha $baseline } | Should Throw
    }
  }

  It 'rejects malformed candidate and baseline SHAs before any Git resolution' {
    InModuleScope $moduleName {
      Mock Invoke-MegaDeskGit { throw 'Git nao deveria ser chamado.' }
      { Resolve-MegaDeskCommitSha -Sha 'nao-e-um-sha' -Label 'CandidateSha' } | Should Throw
      Assert-MockCalled Invoke-MegaDeskGit -Times 0 -Exactly -Scope It
    }
  }

  It 'requires distinct, canonical and ancestral Bootstrap SHAs' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $baseline = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    $global:MegaDeskBootstrapCandidate = $candidate
    $global:MegaDeskBootstrapBaseline = $baseline
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapCandidate
      $baseline = $global:MegaDeskBootstrapBaseline
      $global:MegaDeskMergeBaseMode = 'ANCESTRAL'
      Mock Resolve-MegaDeskCommitSha { param($Sha) $Sha.ToLowerInvariant() }
      Mock Invoke-MegaDeskGit {
        param($Arguments)
        if ($Arguments[0] -eq 'merge-base' -and $global:MegaDeskMergeBaseMode -eq 'NON_ANCESTRAL') { throw 'nao ancestral' }
      }
      (Assert-MegaDeskBootstrapZeroInputs -CandidateSha $candidate -MigrationBaselineSha $baseline -CurrentHeadSha $candidate).candidateSha | Should Be $candidate
      { Assert-MegaDeskBootstrapZeroInputs -CandidateSha $candidate -MigrationBaselineSha $candidate -CurrentHeadSha $candidate } | Should Throw
      { Assert-MegaDeskBootstrapZeroInputs -CandidateSha $candidate -MigrationBaselineSha $baseline -CurrentHeadSha 'cccccccccccccccccccccccccccccccccccccccc' } | Should Throw
      $global:MegaDeskMergeBaseMode = 'NON_ANCESTRAL'
      { Assert-MegaDeskBootstrapZeroInputs -CandidateSha $candidate -MigrationBaselineSha $baseline -CurrentHeadSha $candidate } | Should Throw
    }
  }

  It 'blocks main, tenant and canonical migration paths for Bootstrap Zero' {
    $global:MegaDeskMigrationCases = @('drizzle/main-migrations/0001.sql', 'drizzle/tenant-migrations/0001.sql', 'scripts/canonical-migrations.ts', 'server/_core/canonical-migrations.ts')
    InModuleScope $moduleName {
      foreach ($path in $global:MegaDeskMigrationCases) {
        Mock Invoke-MegaDeskGit { @($path) }
        @(Get-MegaDeskMigrationChanges -FromSha 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' -ToSha 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') | Should Be @($path)
      }
    }
  }

  It 'revalidates a READY artifact and never promotes it merely for being prepared' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $baseline = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    $releasePath = New-BootstrapReleaseRuntimeFixture -ReleaseRoot (Join-Path $script:runtimeRoot 'releases') -Sha $candidate
    $global:MegaDeskBootstrapCandidate = $candidate
    $global:MegaDeskBootstrapBaseline = $baseline
    $global:MegaDeskBootstrapReleasePath = $releasePath
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapCandidate
      $baseline = $global:MegaDeskBootstrapBaseline
      $state = [pscustomobject]@{
        schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null
        operation = [pscustomobject]@{ kind = 'BOOTSTRAP_ZERO'; status = 'READY'; candidateSha = $candidate; baselineSha = $baseline }
      }
      $resolution = Resolve-MegaDeskBootstrapZeroOperation -State $state -CandidateSha $candidate -MigrationBaselineSha $baseline -TestMode -PublicChecks @(@{ Url = 'http://127.0.0.1:32120/healthz'; Expected = 200; Label = 'health isolated' })
      $resolution.status | Should Be 'READY'
      $state.activeRelease | Should Be $null
      $state.previousRelease | Should Be $null
    }
  }

  It 'fails closed for PREPARING, FAILED and ambiguous SWITCHING Bootstrap states' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $baseline = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    $global:MegaDeskBootstrapCandidate = $candidate
    $global:MegaDeskBootstrapBaseline = $baseline
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapCandidate
      $baseline = $global:MegaDeskBootstrapBaseline
      foreach ($status in @('PREPARING', 'FAILED')) {
        $state = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = [pscustomobject]@{ kind = 'BOOTSTRAP_ZERO'; status = $status; candidateSha = $candidate; baselineSha = $baseline } }
        { Resolve-MegaDeskBootstrapZeroOperation -State $state -CandidateSha $candidate -MigrationBaselineSha $baseline } | Should Throw
      }
      $switching = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = [pscustomobject]@{ kind = 'BOOTSTRAP_ZERO'; status = 'SWITCHING'; candidateSha = $candidate; baselineSha = $baseline } }
      Mock Get-MegaDeskRelease { [pscustomobject]@{ sha = $candidate; path = 'C:\isolated\candidate' } }
      { Resolve-MegaDeskBootstrapZeroOperation -State $switching -CandidateSha $candidate -MigrationBaselineSha $baseline } | Should Throw
    }
  }

  It 'promotes the first release only after managed identity and health checks succeed' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $baseline = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    $release = [pscustomobject]@{ sha = $candidate; path = 'C:\isolated\candidate' }
    $global:MegaDeskBootstrapCandidate = $candidate
    $global:MegaDeskBootstrapBaseline = $baseline
    $global:MegaDeskBootstrapRelease = $release
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapCandidate
      $baseline = $global:MegaDeskBootstrapBaseline
      $release = $global:MegaDeskBootstrapRelease
      $script:testState = [pscustomobject]@{
        schemaVersion = 2; cloudflared = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }; activeRelease = $null; previousRelease = $null
        node = [pscustomobject]@{ pid = 4242; releaseSha = $candidate }
        operation = [pscustomobject]@{ kind = 'BOOTSTRAP_ZERO'; status = 'SWITCHING'; candidateSha = $candidate; baselineSha = $baseline }
      }
      Mock Get-MegaDeskState { $script:testState }
      Mock Save-MegaDeskState { param($State) $script:testState = $State }
      Mock Get-MegaDeskRelease { $release }
      Mock Test-ManagedProcess { $true }
      Mock Wait-MegaDeskLocal { }
      Mock Wait-MegaDeskPublicEndpoints { }
      Resolve-MegaDeskBootstrapZeroOperation -State $script:testState -CandidateSha $candidate -MigrationBaselineSha $baseline -TestMode -PublicChecks @(@{ Url = 'http://127.0.0.1:32120/healthz'; Expected = 200; Label = 'health isolated' }) | Out-Null
      $script:testState.activeRelease.sha | Should Be $candidate
      $script:testState.previousRelease | Should Be $null
      $script:testState.operation.status | Should Be 'ACTIVE'
      Assert-MockCalled Wait-MegaDeskLocal -Times 1 -Exactly
      Assert-MockCalled Wait-MegaDeskPublicEndpoints -Times 1 -Exactly
    }
  }

  It 'marks Bootstrap Zero FAILED without inventing rollback when candidate health fails' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $baseline = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    $release = [pscustomobject]@{ sha = $candidate; path = 'C:\isolated\candidate' }
    $global:MegaDeskBootstrapCandidate = $candidate
    $global:MegaDeskBootstrapBaseline = $baseline
    $global:MegaDeskBootstrapRelease = $release
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapCandidate
      $baseline = $global:MegaDeskBootstrapBaseline
      $release = $global:MegaDeskBootstrapRelease
      $script:testState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null }
      Mock Assert-MegaDeskToolchain { }
      Mock Assert-CloudflaredConfig { }
      Mock Assert-MegaDeskGitPreflight { [pscustomobject]@{ sha = $global:MegaDeskBootstrapCandidate } }
      Mock Assert-MegaDeskBootstrapZeroInputs { [pscustomobject]@{ candidateSha = $global:MegaDeskBootstrapCandidate; baselineSha = $global:MegaDeskBootstrapBaseline } }
      Mock Get-MegaDeskState { $script:testState }
      Mock Save-MegaDeskState { param($State) $script:testState = $State }
      Mock Get-MegaDeskMigrationChanges { @() }
      Mock Test-MegaDeskDependencyDiff { $false }
      Mock Invoke-MegaDeskBootstrapQualityGates { }
      Mock Invoke-MegaDeskIsolatedBuild { $release }
      Mock Assert-MegaDeskNoSourceMutation { }
      Mock Read-Host { 'INICIALIZAR' }
      Mock Get-MegaDeskRelease { $release }
      Mock Assert-MegaDeskPortFree { }
      Mock Get-Command { [pscustomobject]@{ Source = 'C:\runtime\node.exe' } }
      Mock Test-Path { $true }
      Mock Start-MegaDeskProcess { [pscustomobject]@{ Id = 4242 } }
      Mock New-ManagedProcessRecord { [pscustomobject]@{ pid = 4242; releaseSha = $candidate; executablePath = 'C:\runtime\node.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); port = 32120 } }
      Mock Wait-MegaDeskLocal { throw 'health SHA divergente' }
      Mock Undo-MegaDeskInvocation {
        $script:testState.node = $null
      }
      { Invoke-MegaDeskBootstrapZero -ExpectedBranch 'release/updater-v2-bootstrap' -CandidateSha $candidate -MigrationBaselineSha $baseline -TestMode -PublicChecks @(@{ Url = 'http://127.0.0.1:32120/healthz'; Expected = 200; Label = 'health isolated' }) } | Should Throw
      $script:testState.activeRelease | Should Be $null
      $script:testState.previousRelease | Should Be $null
      $script:testState.operation.status | Should Be 'FAILED'
      Assert-MockCalled Undo-MegaDeskInvocation -Times 1 -Exactly -Scope It
    }
  }

  It 'does not bypass public readiness during Bootstrap Start' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $baseline = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    $global:MegaDeskBootstrapCandidate = $candidate
    $global:MegaDeskBootstrapBaseline = $baseline
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapCandidate
      $baseline = $global:MegaDeskBootstrapBaseline
      $state = [pscustomobject]@{ schemaVersion = 2; node = [pscustomobject]@{ pid = 4242; releaseSha = $candidate }; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = [pscustomobject]@{ kind = 'BOOTSTRAP_ZERO'; status = 'SWITCHING'; candidateSha = $candidate; baselineSha = $baseline } }
      Mock Get-MegaDeskRelease { [pscustomobject]@{ sha = $candidate; path = 'C:\isolated\candidate' } }
      Mock Get-MegaDeskState { $state }
      Mock Test-ManagedProcess { $true }
      Mock Wait-MegaDeskLocal { }
      Mock Wait-MegaDeskPublicEndpoints { throw 'Cloudflared gerenciado ausente.' }
      { Resolve-MegaDeskBootstrapZeroOperation -State $state -CandidateSha $candidate -MigrationBaselineSha $baseline -TestMode -PublicChecks @(@{ Url = 'http://127.0.0.1:32120/healthz'; Expected = 200; Label = 'health isolated' }) } | Should Throw
      Assert-MockCalled Wait-MegaDeskPublicEndpoints -Times 1 -Exactly -Scope It
    }
  }

  It 'declares CandidateSha and MigrationBaselineSha as mandatory Bootstrap inputs' {
    $command = Get-Command Invoke-MegaDeskBootstrapZero
    foreach ($name in @('CandidateSha', 'MigrationBaselineSha')) {
      @($command.Parameters[$name].Attributes | Where-Object { $_ -is [System.Management.Automation.ParameterAttribute] -and $_.Mandatory }).Count | Should Be 1
    }
  }

  It 'fails Bootstrap Start before launching a candidate when port ownership is unknown' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $baseline = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    $release = [pscustomobject]@{ sha = $candidate; path = 'C:\isolated\candidate' }
    $global:MegaDeskBootstrapCandidate = $candidate
    $global:MegaDeskBootstrapBaseline = $baseline
    $global:MegaDeskBootstrapRelease = $release
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapCandidate
      $baseline = $global:MegaDeskBootstrapBaseline
      $release = $global:MegaDeskBootstrapRelease
      $script:testState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null }
      Mock Assert-MegaDeskToolchain { }
      Mock Assert-CloudflaredConfig { }
      Mock Assert-MegaDeskGitPreflight { [pscustomobject]@{ sha = $global:MegaDeskBootstrapCandidate } }
      Mock Assert-MegaDeskBootstrapZeroInputs { [pscustomobject]@{ candidateSha = $global:MegaDeskBootstrapCandidate; baselineSha = $global:MegaDeskBootstrapBaseline } }
      Mock Get-MegaDeskState { $script:testState }
      Mock Save-MegaDeskState { param($State) $script:testState = $State }
      Mock Get-MegaDeskMigrationChanges { @() }
      Mock Test-MegaDeskDependencyDiff { $false }
      Mock Invoke-MegaDeskBootstrapQualityGates { }
      Mock Invoke-MegaDeskIsolatedBuild { $release }
      Mock Assert-MegaDeskNoSourceMutation { }
      Mock Read-Host { 'INICIALIZAR' }
      Mock Get-MegaDeskRelease { $release }
      Mock Assert-MegaDeskPortFree { throw 'ownership UNKNOWN' }
      Mock Start-MegaDeskProcess { throw 'nao deve iniciar' }
      { Invoke-MegaDeskBootstrapZero -ExpectedBranch 'release/updater-v2-bootstrap' -CandidateSha $candidate -MigrationBaselineSha $baseline -TestMode -PublicChecks @(@{ Url = 'http://127.0.0.1:32120/healthz'; Expected = 200; Label = 'health isolated' }) } | Should Throw
      $script:testState.activeRelease | Should Be $null
      $script:testState.previousRelease | Should Be $null
      $script:testState.operation.status | Should Be 'FAILED'
      Assert-MockCalled Start-MegaDeskProcess -Times 0 -Exactly -Scope It
    }
  }

  It 'compensates the exact Node candidate locally when state persistence fails after start' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $record = [pscustomobject]@{ pid = 4242; releaseSha = $candidate; executablePath = 'C:\runtime\node.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); port = 32120 }
    $global:MegaDeskBootstrapCandidate = $candidate
    $global:MegaDeskBootstrapRecord = $record
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapCandidate
      $record = $global:MegaDeskBootstrapRecord
      $script:testState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null }
      Mock Get-MegaDeskState { $script:testState }
      Mock Assert-MegaDeskPortFree { }
      Mock Get-Command { [pscustomobject]@{ Source = 'C:\runtime\node.exe' } }
      Mock Get-MegaDeskRelease { [pscustomobject]@{ path = 'C:\isolated\candidate' } }
      Mock Test-Path { $true }
      Mock Start-MegaDeskProcess { [pscustomobject]@{ Id = 4242 } }
      Mock New-ManagedProcessRecord { $record }
      Mock Save-MegaDeskState { throw 'state write failed' }
      Mock Stop-MegaDeskExactManagedProcess { }
      { Start-MegaDeskNode -ReleaseSha $candidate -Port 32120 } | Should Throw
      Assert-MockCalled Stop-MegaDeskExactManagedProcess -Times 1 -Exactly -Scope It
      Assert-MockCalled Stop-MegaDeskExactManagedProcess -ParameterFilter { $Record -eq $global:MegaDeskBootstrapRecord -and $Kind -eq 'node' } -Times 1 -Exactly -Scope It
    }
  }

  It 'does not stop by PID when strong identity capture fails after process start' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $global:MegaDeskBootstrapCandidate = $candidate
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapCandidate
      Mock Get-MegaDeskState { [pscustomobject]@{ node = $null } }
      Mock Assert-MegaDeskPortFree { }
      Mock Get-Command { [pscustomobject]@{ Source = 'C:\runtime\node.exe' } }
      Mock Get-MegaDeskRelease { [pscustomobject]@{ path = 'C:\isolated\candidate' } }
      Mock Test-Path { $true }
      Mock Start-MegaDeskProcess { [pscustomobject]@{ Id = 4242 } }
      Mock New-ManagedProcessRecord { throw 'creation time indisponivel' }
      Mock Stop-Process { }
      $failure = $null
      try { Start-MegaDeskNode -ReleaseSha $candidate -Port 32120 } catch { $failure = $_.Exception.Message }
      $failure | Should Match 'identidade do Node iniciado nao pode ser comprovada'
      Assert-MockCalled Stop-Process -Times 0 -Exactly -Scope It
    }
  }

  It 'refuses to kill an ambiguous candidate after state persistence fails' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $record = [pscustomobject]@{ pid = 4242; releaseSha = $candidate; executablePath = 'C:\runtime\node.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); port = 32120 }
    $global:MegaDeskBootstrapCandidate = $candidate
    $global:MegaDeskBootstrapRecord = $record
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapCandidate
      $record = $global:MegaDeskBootstrapRecord
      $script:testState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null }
      Mock Get-MegaDeskState { $script:testState }
      Mock Assert-MegaDeskPortFree { }
      Mock Get-Command { [pscustomobject]@{ Source = 'C:\runtime\node.exe' } }
      Mock Get-MegaDeskRelease { [pscustomobject]@{ path = 'C:\isolated\candidate' } }
      Mock Test-Path { $true }
      Mock Start-MegaDeskProcess { [pscustomobject]@{ Id = 4242 } }
      Mock New-ManagedProcessRecord { $record }
      Mock Save-MegaDeskState { throw 'state write failed' }
      Mock Stop-MegaDeskExactManagedProcess { throw 'identidade nao comprovada' }
      $failure = $null
      try { Start-MegaDeskNode -ReleaseSha $candidate -Port 32120 } catch { $failure = $_.Exception.Message }
      $failure | Should Match 'state do Node iniciado nao pode ser persistido'
      $failure | Should Match 'identidade nao comprovada'
      Assert-MockCalled Stop-MegaDeskExactManagedProcess -Times 1 -Exactly -Scope It
    }
  }

  It 'never stops a process when local compensation cannot prove its managed identity' {
    $record = [pscustomobject]@{ pid = 4242; port = 32120 }
    $global:MegaDeskBootstrapRecord = $record
    InModuleScope $moduleName {
      Mock Get-ProcessSnapshot { [pscustomobject]@{ ProcessId = 4242 } }
      Mock Test-ManagedProcess { $false }
      Mock Stop-Process { }
      { Stop-MegaDeskExactManagedProcess -Record $global:MegaDeskBootstrapRecord -Kind node } | Should Throw
      Assert-MockCalled Stop-Process -Times 0 -Exactly -Scope It
    }
  }

  It 'persists a managed Cloudflared record and ignores post-save logging failure' {
    $record = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }
    $global:MegaDeskBootstrapTunnelRecord = $record
    InModuleScope $moduleName {
      $record = $global:MegaDeskBootstrapTunnelRecord
      $script:testState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null }
      Mock Get-MegaDeskState { $script:testState }
      Mock Test-ManagedProcess { $false }
      Mock Get-Command { [pscustomobject]@{ Source = 'C:\runtime\cloudflared.exe' } }
      Mock Get-CimInstance { $null }
      Mock Start-MegaDeskProcess { [pscustomobject]@{ Id = 5252 } }
      Mock New-ManagedProcessRecord { $record }
      Mock Save-MegaDeskState { param($State) $script:testState = $State }
      Mock Write-MegaDeskLog { throw 'log indisponivel' }

      $result = Start-MegaDeskTunnel

      $result | Should Be $record
      $script:testState.cloudflared | Should Be $record
      $result.port | Should Be $null
      Assert-MockCalled Start-MegaDeskProcess -Times 1 -Exactly -Scope It
      Assert-MockCalled Save-MegaDeskState -Times 1 -Exactly -Scope It
    }
  }

  It 'does not stop Cloudflared by PID when strong identity capture fails' {
    InModuleScope $moduleName {
      $script:testState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null }
      Mock Get-MegaDeskState { $script:testState }
      Mock Test-ManagedProcess { $false }
      Mock Get-Command { [pscustomobject]@{ Source = 'C:\runtime\cloudflared.exe' } }
      Mock Get-CimInstance { $null }
      Mock Start-MegaDeskProcess { [pscustomobject]@{ Id = 5252 } }
      Mock New-ManagedProcessRecord { throw 'creation time indisponivel' }
      Mock Stop-Process { }

      $failure = $null
      try { Start-MegaDeskTunnel } catch { $failure = $_.Exception.Message }

      $failure | Should Match 'identidade do Cloudflared iniciado nao pode ser comprovada'
      Assert-MockCalled Stop-Process -Times 0 -Exactly -Scope It
    }
  }

  It 'compensates the in-memory Cloudflared record when its state save fails' {
    $record = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }
    $global:MegaDeskBootstrapTunnelRecord = $record
    InModuleScope $moduleName {
      $record = $global:MegaDeskBootstrapTunnelRecord
      $script:testState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null }
      Mock Get-MegaDeskState { $script:testState }
      Mock Test-ManagedProcess { $false }
      Mock Get-Command { [pscustomobject]@{ Source = 'C:\runtime\cloudflared.exe' } }
      Mock Get-CimInstance { $null }
      Mock Start-MegaDeskProcess { [pscustomobject]@{ Id = 5252 } }
      Mock New-ManagedProcessRecord { $record }
      Mock Save-MegaDeskState { throw 'state tunnel write failed' }
      Mock Stop-MegaDeskExactManagedProcess { }

      $failure = $null
      try { Start-MegaDeskTunnel } catch { $failure = $_.Exception.Message }

      $failure | Should Match 'state do Cloudflared iniciado nao pode ser persistido'
      Assert-MockCalled Stop-MegaDeskExactManagedProcess -ParameterFilter { $Record -eq $global:MegaDeskBootstrapTunnelRecord -and $Kind -eq 'cloudflared' } -Times 1 -Exactly -Scope It
    }
  }

  It 'preserves the state and cleanup causes when Cloudflared persistence compensation fails' {
    $record = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }
    $global:MegaDeskBootstrapTunnelRecord = $record
    InModuleScope $moduleName {
      $record = $global:MegaDeskBootstrapTunnelRecord
      $script:testState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null }
      Mock Get-MegaDeskState { $script:testState }
      Mock Test-ManagedProcess { $false }
      Mock Get-Command { [pscustomobject]@{ Source = 'C:\runtime\cloudflared.exe' } }
      Mock Get-CimInstance { $null }
      Mock Start-MegaDeskProcess { [pscustomobject]@{ Id = 5252 } }
      Mock New-ManagedProcessRecord { $record }
      Mock Save-MegaDeskState { throw 'state tunnel write failed' }
      Mock Stop-MegaDeskExactManagedProcess { throw 'identidade do tunnel nao comprovada' }

      $failure = $null
      try { Start-MegaDeskTunnel } catch { $failure = $_.Exception.Message }

      $failure | Should Match 'state tunnel write failed'
      $failure | Should Match 'identidade do tunnel nao comprovada'
    }
  }

  It 'blocks an unrecorded external Cloudflared without adopting or stopping it' {
    InModuleScope $moduleName {
      $script:testState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null }
      Mock Get-MegaDeskState { $script:testState }
      Mock Test-ManagedProcess { $false }
      Mock Get-Command { [pscustomobject]@{ Source = 'C:\runtime\cloudflared.exe' } }
      Mock Get-CimInstance { [pscustomobject]@{ ProcessId = 5252 } }
      Mock Start-MegaDeskProcess { throw 'nao deve iniciar' }
      Mock Stop-Process { }

      { Start-MegaDeskTunnel } | Should Throw
      Assert-MockCalled Start-MegaDeskProcess -Times 0 -Exactly -Scope It
      Assert-MockCalled Stop-Process -Times 0 -Exactly -Scope It
    }
  }

  It 'reuses a strongly identified V2 Cloudflared without marking it as newly started' {
    $record = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }
    $global:MegaDeskBootstrapTunnelRecord = $record
    InModuleScope $moduleName {
      $record = $global:MegaDeskBootstrapTunnelRecord
      $script:testState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $record; activeRelease = $null; previousRelease = $null; operation = $null }
      Mock Get-MegaDeskState { $script:testState }
      Mock Test-ManagedProcess { $true }
      Mock Start-MegaDeskProcess { throw 'tunnel preexistente nao deve iniciar outro processo' }
      Mock Save-MegaDeskState { throw 'tunnel preexistente nao deve alterar state' }
      Mock Write-MegaDeskLog { }

      (Start-MegaDeskTunnel) | Should Be $null
      $script:testState.cloudflared | Should Be $record
      Assert-MockCalled Start-MegaDeskProcess -Times 0 -Exactly -Scope It
      Assert-MockCalled Save-MegaDeskState -Times 0 -Exactly -Scope It
    }
  }

  It 'clears a stale absent Cloudflared record through state save before starting its replacement' {
    $stale = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow.AddMinutes(-1)).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }
    $replacement = [pscustomobject]@{ pid = 5353; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }
    $global:MegaDeskBootstrapStaleTunnelRecord = $stale
    $global:MegaDeskBootstrapTunnelRecord = $replacement
    InModuleScope $moduleName {
      $stale = $global:MegaDeskBootstrapStaleTunnelRecord
      $replacement = $global:MegaDeskBootstrapTunnelRecord
      $script:testState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $stale; activeRelease = $null; previousRelease = $null; operation = $null }
      $script:saveCount = 0
      $script:firstStaleRecordWasCleared = $false
      Mock Get-MegaDeskState { $script:testState }
      Mock Test-ManagedProcess { $false }
      Mock Save-MegaDeskState {
        param($State)
        $script:saveCount++
        if ($script:saveCount -eq 1) { $script:firstStaleRecordWasCleared = $null -eq $State.cloudflared }
        $script:testState = $State
      }
      Mock Get-Command { [pscustomobject]@{ Source = 'C:\runtime\cloudflared.exe' } }
      Mock Get-CimInstance { $null }
      Mock Start-MegaDeskProcess { [pscustomobject]@{ Id = 5353 } }
      Mock New-ManagedProcessRecord { $replacement }
      Mock Write-MegaDeskLog { }

      $result = Start-MegaDeskTunnel

      $result | Should Be $replacement
      $script:firstStaleRecordWasCleared | Should Be $true
      $script:testState.cloudflared | Should Be $replacement
      Assert-MockCalled Save-MegaDeskState -Times 2 -Exactly -Scope It
    }
  }

  It 'keeps a committed Bootstrap promotion ACTIVE when post-commit logging fails' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $baseline = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    $release = [pscustomobject]@{ sha = $candidate; path = 'C:\isolated\candidate' }
    $global:MegaDeskBootstrapCandidate = $candidate
    $global:MegaDeskBootstrapBaseline = $baseline
    $global:MegaDeskBootstrapRelease = $release
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapCandidate
      $baseline = $global:MegaDeskBootstrapBaseline
      $release = $global:MegaDeskBootstrapRelease
      $script:testState = [pscustomobject]@{
        schemaVersion = 2; node = [pscustomobject]@{ pid = 4242; releaseSha = $candidate }; cloudflared = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }; activeRelease = $null; previousRelease = $null
        operation = [pscustomobject]@{ kind = 'BOOTSTRAP_ZERO'; status = 'SWITCHING'; candidateSha = $candidate; baselineSha = $baseline }
      }
      Mock Get-MegaDeskState { $script:testState }
      Mock Save-MegaDeskState { param($State) $script:testState = $State }
      Mock Test-ManagedProcess { $true }
      Mock Write-MegaDeskLog { throw 'log indisponivel' }
      Mock Undo-MegaDeskInvocation { }
      { Complete-MegaDeskBootstrapZeroActivation -CandidateRelease $release -MigrationBaselineSha $baseline } | Should Not Throw
      $script:testState.activeRelease.sha | Should Be $candidate
      $script:testState.previousRelease | Should Be $null
      $script:testState.operation.status | Should Be 'ACTIVE'
      Assert-MockCalled Undo-MegaDeskInvocation -Times 0 -Exactly -Scope It
    }
  }

  It 'treats final activeRelease persistence failure as a real failure before commit' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $baseline = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    $release = [pscustomobject]@{ sha = $candidate; path = 'C:\isolated\candidate' }
    $global:MegaDeskBootstrapCandidate = $candidate
    $global:MegaDeskBootstrapBaseline = $baseline
    $global:MegaDeskBootstrapRelease = $release
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapCandidate
      $baseline = $global:MegaDeskBootstrapBaseline
      $release = $global:MegaDeskBootstrapRelease
      $script:testState = [pscustomobject]@{
        schemaVersion = 2; node = [pscustomobject]@{ pid = 4242; releaseSha = $candidate }; cloudflared = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }; activeRelease = $null; previousRelease = $null
        operation = [pscustomobject]@{ kind = 'BOOTSTRAP_ZERO'; status = 'SWITCHING'; candidateSha = $candidate; baselineSha = $baseline }
      }
      Mock Get-MegaDeskState { $script:testState }
      Mock Test-ManagedProcess { $true }
      Mock Save-MegaDeskState { throw 'state final write failed' }
      Mock Write-MegaDeskLog { }
      { Complete-MegaDeskBootstrapZeroActivation -CandidateRelease $release -MigrationBaselineSha $baseline } | Should Throw
      Assert-MockCalled Write-MegaDeskLog -Times 0 -Exactly -Scope It
    }
  }

  It 'keeps Bootstrap Zero ACTIVE when post-commit logging fails through the external flow' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $baseline = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    $release = [pscustomobject]@{ sha = $candidate; path = (Join-Path $script:runtimeRoot 'releases\candidate') }
    $record = [pscustomobject]@{ pid = 4242; releaseSha = $candidate; executablePath = 'C:\runtime\node.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); port = 32120 }
    $tunnelRecord = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }
    $global:MegaDeskBootstrapCandidate = $candidate
    $global:MegaDeskBootstrapBaseline = $baseline
    $global:MegaDeskBootstrapRelease = $release
    $global:MegaDeskBootstrapRecord = $record
    $global:MegaDeskBootstrapTunnelRecord = $tunnelRecord
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapCandidate
      $baseline = $global:MegaDeskBootstrapBaseline
      $release = $global:MegaDeskBootstrapRelease
      $record = $global:MegaDeskBootstrapRecord
      $tunnelRecord = $global:MegaDeskBootstrapTunnelRecord
      $script:testState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null }
      $script:finalStateSaved = $false
      $script:healthLocalPassed = $false
      $script:publicReadinessPassed = $false
      $script:capturedScriptPath = $null
      $script:postCommitLogFailed = $false
      $script:logMessages = @()
      $script:bootstrapStartSequence = @()

      Mock Assert-MegaDeskToolchain { }
      Mock Assert-CloudflaredConfig { }
      Mock Assert-MegaDeskGitPreflight { [pscustomobject]@{ sha = $global:MegaDeskBootstrapCandidate } }
      Mock Assert-MegaDeskBootstrapZeroInputs {
        param($CandidateSha, $MigrationBaselineSha, $CurrentHeadSha)
        if ($CandidateSha -cne $global:MegaDeskBootstrapCandidate -or $MigrationBaselineSha -cne $global:MegaDeskBootstrapBaseline -or $CurrentHeadSha -cne $global:MegaDeskBootstrapCandidate) { throw 'Bootstrap inputs inesperados.' }
        [pscustomobject]@{ candidateSha = $global:MegaDeskBootstrapCandidate; baselineSha = $global:MegaDeskBootstrapBaseline }
      }
      Mock Get-MegaDeskState { $script:testState }
      Mock Save-MegaDeskState {
        param($State)
        $script:testState = $State
        if ([string]$State.operation.status -eq 'ACTIVE') { $script:finalStateSaved = $true }
      }
      Mock Get-MegaDeskMigrationChanges { @() }
      Mock Test-MegaDeskDependencyDiff { $false }
      Mock Invoke-MegaDeskBootstrapQualityGates { }
      Mock Invoke-MegaDeskIsolatedBuild { $global:MegaDeskBootstrapRelease }
      Mock Assert-MegaDeskNoSourceMutation { }
      Mock Read-Host { 'INICIALIZAR' }
      Mock Get-MegaDeskRelease { $global:MegaDeskBootstrapRelease }
      Mock Assert-MegaDeskPortFree { }
      Mock Get-Command { [pscustomobject]@{ Source = 'C:\runtime\node.exe' } }
      Mock Test-Path { $true }
      Mock Start-MegaDeskProcess { $script:bootstrapStartSequence += 'NODE'; [pscustomobject]@{ Id = 4242 } }
      Mock New-ManagedProcessRecord {
        param($Process, $ExecutablePath, $Kind, $ConfigPath, $ScriptPath, $EnvironmentPath, $ReleaseSha, $Port)
        $script:capturedScriptPath = $ScriptPath
        $global:MegaDeskBootstrapRecord
      }
      Mock Test-ManagedProcess { $true }
      Mock Wait-MegaDeskLocal {
        param($ExpectedReleaseSha, $Port)
        if ($ExpectedReleaseSha -cne $candidate -or $Port -ne 32120) { throw 'Health local recebeu parametros inesperados.' }
        $script:healthLocalPassed = $true
        $script:bootstrapStartSequence += 'LOCAL_HEALTH'
      }
      Mock Start-MegaDeskTunnel {
        $script:testState.cloudflared = $global:MegaDeskBootstrapTunnelRecord
        $script:bootstrapStartSequence += 'TUNNEL'
        $global:MegaDeskBootstrapTunnelRecord
      }
      Mock Wait-MegaDeskPublicEndpoints {
        param($ExpectedReleaseSha, $Checks)
        if ($ExpectedReleaseSha -cne $candidate -or $Checks.Count -ne 1) { throw 'Readiness publico recebeu parametros inesperados.' }
        $script:publicReadinessPassed = $true
        $script:bootstrapStartSequence += 'PUBLIC_READINESS'
      }
      Mock Write-MegaDeskLog {
        param($Message)
        $script:logMessages += [string]$Message
        if ($script:finalStateSaved) {
          $script:postCommitLogFailed = $true
          throw 'falha de logging pos-commit'
        }
      }
      Mock Undo-MegaDeskInvocation { throw 'rollback inesperado apos commit' }
      Mock Stop-MegaDeskExactManagedProcess { throw 'compensacao inesperada apos commit' }
      Mock Stop-Process { throw 'Stop-Process inesperado apos commit' }

      $result = Invoke-MegaDeskBootstrapZero -ExpectedBranch 'release/updater-v2-bootstrap' -CandidateSha $candidate -MigrationBaselineSha $baseline -TestMode -PublicChecks @(@{ Url = 'http://127.0.0.1:32120/healthz'; Expected = 200; Label = 'health isolated' })

      $result.sha | Should Be $candidate
      $script:healthLocalPassed | Should Be $true
      $script:publicReadinessPassed | Should Be $true
      $script:finalStateSaved | Should Be $true
      $script:postCommitLogFailed | Should Be $true
      $script:capturedScriptPath | Should Be (Join-Path $release.path 'dist\index.js')
      $script:capturedScriptPath | Should Not Be (Join-Path $script:projectRoot 'dist\index.js')
      $script:testState.schemaVersion | Should Be 2
      $script:testState.activeRelease.sha | Should Be $candidate
      $script:testState.previousRelease | Should Be $null
      $script:testState.operation.kind | Should Be 'BOOTSTRAP_ZERO'
      $script:testState.operation.status | Should Be 'ACTIVE'
      $script:testState.operation.candidateSha | Should Be $candidate
      $script:testState.operation.baselineSha | Should Be $baseline
      $script:testState.cloudflared | Should Be $tunnelRecord
      $script:bootstrapStartSequence | Should Be @('NODE', 'LOCAL_HEALTH', 'TUNNEL', 'PUBLIC_READINESS')
      Assert-MockCalled Start-MegaDeskTunnel -Times 1 -Exactly -Scope It
      Assert-MockCalled Undo-MegaDeskInvocation -Times 0 -Exactly -Scope It
      Assert-MockCalled Stop-MegaDeskExactManagedProcess -Times 0 -Exactly -Scope It
      Assert-MockCalled Stop-Process -Times 0 -Exactly -Scope It
    }
  }

  It 'compensates the tunnel before the Node when public readiness returns HTTP 530' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $baseline = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    $release = [pscustomobject]@{ sha = $candidate; path = (Join-Path $script:runtimeRoot 'releases\candidate') }
    $nodeRecord = [pscustomobject]@{ pid = 4242; releaseSha = $candidate; executablePath = 'C:\runtime\node.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); port = 32120 }
    $tunnelRecord = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }
    $global:MegaDeskBootstrapCandidate = $candidate
    $global:MegaDeskBootstrapBaseline = $baseline
    $global:MegaDeskBootstrapRelease = $release
    $global:MegaDeskBootstrapRecord = $nodeRecord
    $global:MegaDeskBootstrapTunnelRecord = $tunnelRecord
    $global:MegaDeskBootstrapFailureState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null }
    $global:MegaDeskBootstrapCleanupPids = [System.Collections.ArrayList]::new()
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapCandidate
      $baseline = $global:MegaDeskBootstrapBaseline
      $release = $global:MegaDeskBootstrapRelease
      $nodeRecord = $global:MegaDeskBootstrapRecord
      $tunnelRecord = $global:MegaDeskBootstrapTunnelRecord
      Mock Assert-MegaDeskToolchain { }
      Mock Assert-CloudflaredConfig { }
      Mock Assert-MegaDeskGitPreflight { [pscustomobject]@{ sha = $global:MegaDeskBootstrapCandidate } }
      Mock Assert-MegaDeskBootstrapZeroInputs { [pscustomobject]@{ candidateSha = $global:MegaDeskBootstrapCandidate; baselineSha = $global:MegaDeskBootstrapBaseline } }
      Mock Get-MegaDeskState { $global:MegaDeskBootstrapFailureState }
      Mock Save-MegaDeskState { param($State) $global:MegaDeskBootstrapFailureState = $State }
      Mock Get-MegaDeskMigrationChanges { @() }
      Mock Test-MegaDeskDependencyDiff { $false }
      Mock Invoke-MegaDeskBootstrapQualityGates { }
      Mock Invoke-MegaDeskIsolatedBuild { $global:MegaDeskBootstrapRelease }
      Mock Assert-MegaDeskNoSourceMutation { }
      Mock Read-Host { 'INICIALIZAR' }
      Mock Get-MegaDeskRelease { $global:MegaDeskBootstrapRelease }
      Mock Assert-MegaDeskPortFree { }
      Mock Start-MegaDeskNode {
        [void]($global:MegaDeskBootstrapFailureState.node = $global:MegaDeskBootstrapRecord)
        return $global:MegaDeskBootstrapRecord
      }
      Mock Wait-MegaDeskLocal { }
      Mock Start-MegaDeskTunnel {
        [void]($global:MegaDeskBootstrapFailureState.cloudflared = $global:MegaDeskBootstrapTunnelRecord)
        return $global:MegaDeskBootstrapTunnelRecord
      }
      Mock Wait-MegaDeskPublicEndpoints { throw 'HTTP 530' }
      Mock Undo-MegaDeskInvocation {
        param($StartedNodeRecord, $StartedTunnelRecord)
        [void]$global:MegaDeskBootstrapCleanupPids.Add([int]$StartedTunnelRecord.pid)
        [void]$global:MegaDeskBootstrapCleanupPids.Add([int]$StartedNodeRecord.pid)
        [void]($global:MegaDeskBootstrapFailureState.cloudflared = $null)
        [void]($global:MegaDeskBootstrapFailureState.node = $null)
      }
      Mock Write-MegaDeskLog { }
      Mock Stop-Process { throw 'PID-only kill nao deve ocorrer' }

      { Invoke-MegaDeskBootstrapZero -ExpectedBranch 'release/updater-v2-bootstrap' -CandidateSha $candidate -MigrationBaselineSha $baseline -TestMode -PublicChecks @(@{ Url = 'http://127.0.0.1:32120/healthz'; Expected = 200; Label = 'health isolated' }) } | Should Throw

      $global:MegaDeskBootstrapFailureState.activeRelease | Should Be $null
      $global:MegaDeskBootstrapFailureState.previousRelease | Should Be $null
      $global:MegaDeskBootstrapFailureState.operation.status | Should Be 'FAILED'
      $global:MegaDeskBootstrapFailureState.cloudflared | Should Be $null
      $global:MegaDeskBootstrapFailureState.node | Should Be $null
      Assert-MockCalled Undo-MegaDeskInvocation -ParameterFilter { $StartedNodeRecord -eq $global:MegaDeskBootstrapRecord -and $StartedTunnelRecord -eq $global:MegaDeskBootstrapTunnelRecord } -Times 1 -Exactly -Scope It
      $global:MegaDeskBootstrapCleanupPids.ToArray() | Should Be @(5252, 4242)
      Assert-MockCalled Stop-Process -Times 0 -Exactly -Scope It
    }
  }

}

Describe 'MegaDesk selective rollback' {
  It 'cleans Cloudflared before Node through the real rollback implementation' {
    $nodeRecord = [pscustomobject]@{ pid = 4242; executablePath = 'C:\runtime\node.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); releaseSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; port = 32120 }
    $tunnelRecord = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }
    $global:MegaDeskRollbackState = [pscustomobject]@{ schemaVersion = 2; node = $nodeRecord; cloudflared = $tunnelRecord; activeRelease = $null; previousRelease = $null; operation = $null }
    $global:MegaDeskRollbackStopOrder = [System.Collections.ArrayList]::new()
    $global:MegaDeskRollbackSnapshotReads = @{}
    InModuleScope $moduleName {
      Mock Get-MegaDeskState { $global:MegaDeskRollbackState }
      Mock Test-SameManagedProcessRecord { $true }
      Mock Test-ManagedProcess { $true }
      Mock Get-ProcessSnapshot {
        param($ProcessId)
        if (-not $global:MegaDeskRollbackSnapshotReads.ContainsKey($ProcessId)) { $global:MegaDeskRollbackSnapshotReads[$ProcessId] = 0 }
        $global:MegaDeskRollbackSnapshotReads[$ProcessId]++
        if ($global:MegaDeskRollbackSnapshotReads[$ProcessId] -eq 1) { return [pscustomobject]@{ ProcessId = $ProcessId } }
        return $null
      }
      Mock Stop-Process { param($Id) [void]$global:MegaDeskRollbackStopOrder.Add([int](@($Id)[0])) }
      Mock Wait-Process { }
      Mock Save-MegaDeskState { param($State) $global:MegaDeskRollbackState = $State }
      Mock Write-MegaDeskLog { }

      Undo-MegaDeskInvocation -StartedNodeRecord $global:MegaDeskRollbackState.node -StartedTunnelRecord $global:MegaDeskRollbackState.cloudflared

      $global:MegaDeskRollbackStopOrder.ToArray() | Should Be @(5252, 4242)
      $global:MegaDeskRollbackState.cloudflared | Should Be $null
      $global:MegaDeskRollbackState.node | Should Be $null
      Assert-MockCalled Stop-Process -Times 2 -Exactly -Scope It
    }
  }

  It 'preserves the Cloudflared cleanup cause and still attempts Node cleanup' {
    $nodeRecord = [pscustomobject]@{ pid = 4242; executablePath = 'C:\runtime\node.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); releaseSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; port = 32120 }
    $tunnelRecord = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }
    $global:MegaDeskRollbackState = [pscustomobject]@{ schemaVersion = 2; node = $nodeRecord; cloudflared = $tunnelRecord; activeRelease = $null; previousRelease = $null; operation = $null }
    $global:MegaDeskRollbackStopOrder = [System.Collections.ArrayList]::new()
    $global:MegaDeskRollbackSnapshotReads = @{}
    InModuleScope $moduleName {
      Mock Get-MegaDeskState { $global:MegaDeskRollbackState }
      Mock Test-SameManagedProcessRecord { $true }
      Mock Test-ManagedProcess { $true }
      Mock Get-ProcessSnapshot {
        param($ProcessId)
        if (-not $global:MegaDeskRollbackSnapshotReads.ContainsKey($ProcessId)) { $global:MegaDeskRollbackSnapshotReads[$ProcessId] = 0 }
        $global:MegaDeskRollbackSnapshotReads[$ProcessId]++
        if ($global:MegaDeskRollbackSnapshotReads[$ProcessId] -eq 1) { return [pscustomobject]@{ ProcessId = $ProcessId } }
        return $null
      }
      Mock Stop-Process {
        param($Id)
        $processId = [int](@($Id)[0])
        [void]$global:MegaDeskRollbackStopOrder.Add($processId)
        if ($processId -eq 5252) { throw 'tunnel cleanup exploded' }
      }
      Mock Wait-Process { }
      Mock Save-MegaDeskState { param($State) $global:MegaDeskRollbackState = $State }
      Mock Write-MegaDeskLog { }

      $failure = $null
      try { Undo-MegaDeskInvocation -StartedNodeRecord $global:MegaDeskRollbackState.node -StartedTunnelRecord $global:MegaDeskRollbackState.cloudflared } catch { $failure = $_.Exception.Message }

      $failure | Should Match 'cloudflared: tunnel cleanup exploded'
      $global:MegaDeskRollbackStopOrder.ToArray() | Should Be @(5252, 4242)
      $global:MegaDeskRollbackState.cloudflared | Should Not Be $null
      $global:MegaDeskRollbackState.node | Should Be $null
    }
  }

  It 'preserves both cleanup causes when Cloudflared and Node cleanup fail' {
    $nodeRecord = [pscustomobject]@{ pid = 4242; executablePath = 'C:\runtime\node.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); releaseSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; port = 32120 }
    $tunnelRecord = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }
    $global:MegaDeskRollbackState = [pscustomobject]@{ schemaVersion = 2; node = $nodeRecord; cloudflared = $tunnelRecord; activeRelease = $null; previousRelease = $null; operation = $null }
    $global:MegaDeskRollbackStopOrder = [System.Collections.ArrayList]::new()
    InModuleScope $moduleName {
      Mock Get-MegaDeskState { $global:MegaDeskRollbackState }
      Mock Test-SameManagedProcessRecord { $true }
      Mock Test-ManagedProcess { $true }
      Mock Get-ProcessSnapshot { param($ProcessId) [pscustomobject]@{ ProcessId = $ProcessId } }
      Mock Stop-Process {
        param($Id)
        $processId = [int](@($Id)[0])
        [void]$global:MegaDeskRollbackStopOrder.Add($processId)
        if ($processId -eq 5252) { throw 'tunnel cleanup exploded' }
        throw 'node cleanup exploded'
      }
      Mock Wait-Process { }
      Mock Save-MegaDeskState { param($State) $global:MegaDeskRollbackState = $State }
      Mock Write-MegaDeskLog { }

      $failure = $null
      try { Undo-MegaDeskInvocation -StartedNodeRecord $global:MegaDeskRollbackState.node -StartedTunnelRecord $global:MegaDeskRollbackState.cloudflared } catch { $failure = $_.Exception.Message }

      $failure | Should Match 'cloudflared: tunnel cleanup exploded'
      $failure | Should Match 'node: node cleanup exploded'
      $global:MegaDeskRollbackStopOrder.ToArray() | Should Be @(5252, 4242)
    }
  }

  It 'refuses cleanup with invalid managed identity without PID-only termination' {
    $tunnelRecord = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }
    $global:MegaDeskRollbackState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $tunnelRecord; activeRelease = $null; previousRelease = $null; operation = $null }
    InModuleScope $moduleName {
      Mock Get-MegaDeskState { $global:MegaDeskRollbackState }
      Mock Test-SameManagedProcessRecord { $true }
      Mock Get-ProcessSnapshot { [pscustomobject]@{ ProcessId = 5252 } }
      Mock Test-ManagedProcess { $false }
      Mock Stop-Process { throw 'PID-only termination must not occur' }
      Mock Stop-MegaDeskExactManagedProcess { throw 'unexpected exact cleanup' }
      Mock Save-MegaDeskState { param($State) $global:MegaDeskRollbackState = $State }
      Mock Write-MegaDeskLog { }

      $failure = $null
      try { Undo-MegaDeskInvocation -StartedTunnelRecord $global:MegaDeskRollbackState.cloudflared } catch { $failure = $_.Exception.Message }

      $failure | Should Match 'cloudflared: cleanup recusado: identidade gerenciada do processo nao pode ser comprovada'
      $global:MegaDeskRollbackState.cloudflared | Should Not Be $null
      Assert-MockCalled Stop-Process -Times 0 -Exactly -Scope It
      Assert-MockCalled Stop-MegaDeskExactManagedProcess -Times 0 -Exactly -Scope It
    }
  }

  It 'reports state divergence as incomplete cleanup without touching a process' {
    $tunnelRecord = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }
    $global:MegaDeskRollbackDivergentTunnelRecord = $tunnelRecord
    $global:MegaDeskRollbackState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null }
    InModuleScope $moduleName {
      Mock Get-MegaDeskState { $global:MegaDeskRollbackState }
      Mock Get-ProcessSnapshot { throw 'snapshot must not be queried when state diverges' }
      Mock Stop-Process { throw 'state-divergent process must not be stopped' }
      Mock Save-MegaDeskState { throw 'state-divergent process must not be saved' }
      Mock Write-MegaDeskLog { }

      $failure = $null
      try { Undo-MegaDeskInvocation -StartedTunnelRecord $global:MegaDeskRollbackDivergentTunnelRecord } catch { $failure = $_.Exception.Message }

      $failure | Should Match 'cloudflared: cleanup recusado: o state nao pertence a esta invocacao'
      Assert-MockCalled Get-ProcessSnapshot -Times 0 -Exactly -Scope It
      Assert-MockCalled Stop-Process -Times 0 -Exactly -Scope It
      Assert-MockCalled Save-MegaDeskState -Times 0 -Exactly -Scope It
    }
  }

  It 'treats a proven absent managed process as idempotent cleanup' {
    $tunnelRecord = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }
    $global:MegaDeskRollbackState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $tunnelRecord; activeRelease = $null; previousRelease = $null; operation = $null }
    InModuleScope $moduleName {
      Mock Get-MegaDeskState { $global:MegaDeskRollbackState }
      Mock Test-SameManagedProcessRecord { $true }
      Mock Get-ProcessSnapshot { $null }
      Mock Test-ManagedProcess { throw 'identity must not be tested after confirmed absence' }
      Mock Stop-Process { throw 'process is absent and must not be stopped' }
      Mock Save-MegaDeskState { param($State) $global:MegaDeskRollbackState = $State }
      Mock Write-MegaDeskLog { }

      { Undo-MegaDeskInvocation -StartedTunnelRecord $global:MegaDeskRollbackState.cloudflared } | Should Not Throw

      $global:MegaDeskRollbackState.cloudflared | Should Be $null
      Assert-MockCalled Stop-Process -Times 0 -Exactly -Scope It
    }
  }
}

Describe 'MegaDesk Bootstrap Zero rollback hardening' {
  BeforeEach {
    $script:port = Get-IsolatedTestPort
    $script:runtimeRoot = Join-Path $TestDrive 'bootstrap-rollback-runtime'
    $script:projectRoot = Join-Path $TestDrive 'bootstrap-rollback-project'
    New-Item -ItemType Directory -Path $script:projectRoot -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $script:projectRoot '.env.local') -Value '' -NoNewline
    & (Get-Module $moduleName) { param($runtimeRoot, $projectRoot, $port) Set-MegaDeskAutomationPaths -RuntimeRoot $runtimeRoot -ProjectRoot $projectRoot -Port $port } $script:runtimeRoot $script:projectRoot $script:port
  }

  It 'uses the real Undo to compensate Node when tunnel start fails before it is recorded' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $baseline = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    $release = [pscustomobject]@{ sha = $candidate; path = (Join-Path $script:runtimeRoot 'releases\candidate') }
    $nodeRecord = [pscustomobject]@{ pid = 4242; executablePath = 'C:\runtime\node.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); releaseSha = $candidate; port = $script:port }
    $global:MegaDeskBootstrapRollbackCandidate = $candidate
    $global:MegaDeskBootstrapRollbackBaseline = $baseline
    $global:MegaDeskBootstrapRollbackRelease = $release
    $global:MegaDeskBootstrapRollbackNodeRecord = $nodeRecord
    $global:MegaDeskBootstrapRollbackState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null }
    $global:MegaDeskBootstrapRollbackStopOrder = [System.Collections.ArrayList]::new()
    $global:MegaDeskBootstrapRollbackSnapshotReads = @{}
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapRollbackCandidate
      $baseline = $global:MegaDeskBootstrapRollbackBaseline
      Mock Assert-MegaDeskToolchain { }
      Mock Assert-CloudflaredConfig { }
      Mock Assert-MegaDeskGitPreflight { [pscustomobject]@{ sha = $global:MegaDeskBootstrapRollbackCandidate } }
      Mock Assert-MegaDeskBootstrapZeroInputs { [pscustomobject]@{ candidateSha = $global:MegaDeskBootstrapRollbackCandidate; baselineSha = $global:MegaDeskBootstrapRollbackBaseline } }
      Mock Get-MegaDeskState { $global:MegaDeskBootstrapRollbackState }
      Mock Save-MegaDeskState { param($State) $global:MegaDeskBootstrapRollbackState = $State }
      Mock Get-MegaDeskMigrationChanges { @() }
      Mock Test-MegaDeskDependencyDiff { $false }
      Mock Invoke-MegaDeskBootstrapQualityGates { }
      Mock Invoke-MegaDeskIsolatedBuild { $global:MegaDeskBootstrapRollbackRelease }
      Mock Assert-MegaDeskNoSourceMutation { }
      Mock Read-Host { 'INICIALIZAR' }
      Mock Get-MegaDeskRelease { $global:MegaDeskBootstrapRollbackRelease }
      Mock Assert-MegaDeskPortFree { }
      Mock Start-MegaDeskNode {
        $global:MegaDeskBootstrapRollbackState.node = $global:MegaDeskBootstrapRollbackNodeRecord
        return $global:MegaDeskBootstrapRollbackNodeRecord
      }
      Mock Wait-MegaDeskLocal { }
      Mock Start-MegaDeskTunnel { throw 'tunnel start failed' }
      Mock Test-SameManagedProcessRecord { $true }
      Mock Test-ManagedProcess { $true }
      Mock Get-ProcessSnapshot {
        param($ProcessId)
        if (-not $global:MegaDeskBootstrapRollbackSnapshotReads.ContainsKey($ProcessId)) { $global:MegaDeskBootstrapRollbackSnapshotReads[$ProcessId] = 0 }
        $global:MegaDeskBootstrapRollbackSnapshotReads[$ProcessId]++
        if ($global:MegaDeskBootstrapRollbackSnapshotReads[$ProcessId] -eq 1) { return [pscustomobject]@{ ProcessId = $ProcessId } }
        return $null
      }
      Mock Stop-Process { param($Id) [void]$global:MegaDeskBootstrapRollbackStopOrder.Add([int](@($Id)[0])) }
      Mock Stop-MegaDeskExactManagedProcess { throw 'unexpected local compensation' }
      Mock Wait-Process { }
      Mock Write-MegaDeskLog { }

      $failure = $null
      try { Invoke-MegaDeskBootstrapZero -ExpectedBranch 'release/updater-v2-bootstrap' -CandidateSha $candidate -MigrationBaselineSha $baseline -TestMode -PublicChecks @(@{ Url = 'http://127.0.0.1:32120/healthz'; Expected = 200; Label = 'health isolated' }) } catch { $failure = $_.Exception.Message }

      $failure | Should Match 'tunnel start failed'
      $global:MegaDeskBootstrapRollbackState.activeRelease | Should Be $null
      $global:MegaDeskBootstrapRollbackState.previousRelease | Should Be $null
      $global:MegaDeskBootstrapRollbackState.operation.status | Should Be 'FAILED'
      $global:MegaDeskBootstrapRollbackState.node | Should Be $null
      $global:MegaDeskBootstrapRollbackState.cloudflared | Should Be $null
      $global:MegaDeskBootstrapRollbackStopOrder.ToArray() | Should Be @(4242)
      Assert-MockCalled Stop-MegaDeskExactManagedProcess -Times 0 -Exactly -Scope It
    }
  }

  It 'uses the real Undo to clean tunnel then Node when the ACTIVE save fails' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $baseline = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    $release = [pscustomobject]@{ sha = $candidate; path = (Join-Path $script:runtimeRoot 'releases\candidate') }
    $nodeRecord = [pscustomobject]@{ pid = 4242; executablePath = 'C:\runtime\node.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); releaseSha = $candidate; port = $script:port }
    $tunnelRecord = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }
    $global:MegaDeskBootstrapCommitCandidate = $candidate
    $global:MegaDeskBootstrapCommitBaseline = $baseline
    $global:MegaDeskBootstrapCommitRelease = $release
    $global:MegaDeskBootstrapCommitNodeRecord = $nodeRecord
    $global:MegaDeskBootstrapCommitTunnelRecord = $tunnelRecord
    $global:MegaDeskBootstrapCommitDurableState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null }
    $global:MegaDeskBootstrapCommitStopOrder = [System.Collections.ArrayList]::new()
    $global:MegaDeskBootstrapCommitSnapshotReads = @{}
    $global:MegaDeskBootstrapCommitActiveSaveAttempts = 0
    InModuleScope $moduleName {
      $candidate = $global:MegaDeskBootstrapCommitCandidate
      $baseline = $global:MegaDeskBootstrapCommitBaseline
      Mock Assert-MegaDeskToolchain { }
      Mock Assert-CloudflaredConfig { }
      Mock Assert-MegaDeskGitPreflight { [pscustomobject]@{ sha = $global:MegaDeskBootstrapCommitCandidate } }
      Mock Assert-MegaDeskBootstrapZeroInputs { [pscustomobject]@{ candidateSha = $global:MegaDeskBootstrapCommitCandidate; baselineSha = $global:MegaDeskBootstrapCommitBaseline } }
      Mock Get-MegaDeskState {
        $serialized = $global:MegaDeskBootstrapCommitDurableState | ConvertTo-Json -Depth 8
        return ($serialized | ConvertFrom-Json)
      }
      Mock Save-MegaDeskState {
        param($State)
        if ([string]$State.operation.status -eq 'ACTIVE') {
          $global:MegaDeskBootstrapCommitActiveSaveAttempts++
          throw 'active state write failed'
        }
        $serialized = $State | ConvertTo-Json -Depth 8
        $global:MegaDeskBootstrapCommitDurableState = $serialized | ConvertFrom-Json
      }
      Mock Get-MegaDeskMigrationChanges { @() }
      Mock Test-MegaDeskDependencyDiff { $false }
      Mock Invoke-MegaDeskBootstrapQualityGates { }
      Mock Invoke-MegaDeskIsolatedBuild { $global:MegaDeskBootstrapCommitRelease }
      Mock Assert-MegaDeskNoSourceMutation { }
      Mock Read-Host { 'INICIALIZAR' }
      Mock Get-MegaDeskRelease { $global:MegaDeskBootstrapCommitRelease }
      Mock Assert-MegaDeskPortFree { }
      Mock Start-MegaDeskNode {
        $serialized = $global:MegaDeskBootstrapCommitDurableState | ConvertTo-Json -Depth 8
        $next = $serialized | ConvertFrom-Json
        $next.node = $global:MegaDeskBootstrapCommitNodeRecord
        $global:MegaDeskBootstrapCommitDurableState = $next
        return $global:MegaDeskBootstrapCommitNodeRecord
      }
      Mock Wait-MegaDeskLocal { }
      Mock Start-MegaDeskTunnel {
        $serialized = $global:MegaDeskBootstrapCommitDurableState | ConvertTo-Json -Depth 8
        $next = $serialized | ConvertFrom-Json
        $next.cloudflared = $global:MegaDeskBootstrapCommitTunnelRecord
        $global:MegaDeskBootstrapCommitDurableState = $next
        return $global:MegaDeskBootstrapCommitTunnelRecord
      }
      Mock Wait-MegaDeskPublicEndpoints { }
      Mock Test-SameManagedProcessRecord { $true }
      Mock Test-ManagedProcess { $true }
      Mock Get-ProcessSnapshot {
        param($ProcessId)
        if (-not $global:MegaDeskBootstrapCommitSnapshotReads.ContainsKey($ProcessId)) { $global:MegaDeskBootstrapCommitSnapshotReads[$ProcessId] = 0 }
        $global:MegaDeskBootstrapCommitSnapshotReads[$ProcessId]++
        if ($global:MegaDeskBootstrapCommitSnapshotReads[$ProcessId] -eq 1) { return [pscustomobject]@{ ProcessId = $ProcessId } }
        return $null
      }
      Mock Stop-Process { param($Id) [void]$global:MegaDeskBootstrapCommitStopOrder.Add([int](@($Id)[0])) }
      Mock Stop-MegaDeskExactManagedProcess { throw 'unexpected local compensation' }
      Mock Wait-Process { }
      Mock Write-MegaDeskLog { }

      $failure = $null
      try { Invoke-MegaDeskBootstrapZero -ExpectedBranch 'release/updater-v2-bootstrap' -CandidateSha $candidate -MigrationBaselineSha $baseline -TestMode -PublicChecks @(@{ Url = 'http://127.0.0.1:32120/healthz'; Expected = 200; Label = 'health isolated' }) } catch { $failure = $_.Exception.Message }

      $failure | Should Match 'active state write failed'
      $global:MegaDeskBootstrapCommitActiveSaveAttempts | Should Be 1
      $global:MegaDeskBootstrapCommitStopOrder.ToArray() | Should Be @(5252, 4242)
      $global:MegaDeskBootstrapCommitDurableState.activeRelease | Should Be $null
      $global:MegaDeskBootstrapCommitDurableState.previousRelease | Should Be $null
      $global:MegaDeskBootstrapCommitDurableState.operation.status | Should Be 'FAILED'
      $global:MegaDeskBootstrapCommitDurableState.cloudflared | Should Be $null
      $global:MegaDeskBootstrapCommitDurableState.node | Should Be $null
      Assert-MockCalled Stop-MegaDeskExactManagedProcess -Times 0 -Exactly -Scope It
    }
  }
}

Describe 'MegaDesk Bootstrap Zero readiness and stale process safety' {
  BeforeEach {
    $script:port = Get-IsolatedTestPort
    $script:runtimeRoot = Join-Path $TestDrive 'bootstrap-readiness-runtime'
    $script:projectRoot = Join-Path $TestDrive 'bootstrap-readiness-project'
    New-Item -ItemType Directory -Path $script:projectRoot -Force | Out-Null
    & (Get-Module $moduleName) { param($runtimeRoot, $projectRoot, $port) Set-MegaDeskAutomationPaths -RuntimeRoot $runtimeRoot -ProjectRoot $projectRoot -Port $port } $script:runtimeRoot $script:projectRoot $script:port
  }

  It 'rejects a divergent public health SHA before Bootstrap promotion' {
    $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $now = [DateTime]::UtcNow
    $global:MegaDeskBootstrapReadinessTimes = [System.Collections.Generic.Queue[DateTime]]::new()
    foreach ($time in @($now, $now, $now, $now, $now.AddSeconds(1))) { $global:MegaDeskBootstrapReadinessTimes.Enqueue($time) }
    InModuleScope $moduleName {
      $candidate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      Mock Get-Date { $global:MegaDeskBootstrapReadinessTimes.Dequeue() }
      Mock Get-MegaDeskHealth { [pscustomobject]@{ status = 'healthy'; release = [pscustomobject]@{ sha = 'cccccccccccccccccccccccccccccccccccccccc' } } }
      Mock Get-HttpStatusCode { 404 }
      Mock Write-MegaDeskLog { }

      { Wait-MegaDeskPublicEndpoints -ExpectedReleaseSha $candidate -TestMode -TimeoutSeconds 1 -PollIntervalSeconds 0 } | Should Throw

      Assert-MockCalled Get-MegaDeskHealth -Times 2 -Exactly -Scope It
    }
  }

  It 'blocks a stale Cloudflared record with a present invalid process without adoption or termination' {
    $stale = [pscustomobject]@{ pid = 5252; executablePath = 'C:\runtime\cloudflared.exe'; startedAtUtc = ([DateTime]::UtcNow.AddMinutes(-1)).ToString('o'); configPath = 'C:\runtime\config.yml'; port = $null }
    $global:MegaDeskBootstrapStalePresentState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $stale; activeRelease = $null; previousRelease = $null; operation = $null }
    InModuleScope $moduleName {
      Mock Get-MegaDeskState { $global:MegaDeskBootstrapStalePresentState }
      Mock Test-ManagedProcess { $false }
      Mock Save-MegaDeskState { param($State) $global:MegaDeskBootstrapStalePresentState = $State }
      Mock Get-Command { [pscustomobject]@{ Source = 'C:\runtime\cloudflared.exe' } }
      Mock Get-CimInstance { param($ClassName, $Filter) [pscustomobject]@{ ProcessId = 5252 } }
      Mock Start-MegaDeskProcess { throw 'a second tunnel must not start' }
      Mock Stop-Process { throw 'an invalid process must not be terminated' }

      $failure = $null
      try { Start-MegaDeskTunnel } catch { $failure = $_.Exception.Message }

      $failure | Should Match 'cloudflared nao controlado'
      $global:MegaDeskBootstrapStalePresentState.cloudflared | Should Be $null
      Assert-MockCalled Start-MegaDeskProcess -Times 0 -Exactly -Scope It
      Assert-MockCalled Stop-Process -Times 0 -Exactly -Scope It
    }
  }
}

function New-DummyHealthServer {
  param([string]$Root, [int]$Port, [string]$Sha)
  $scriptPath = Join-Path $Root 'dummy-health.js'
  @"
const http = require('http');
http.createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: 'healthy', release: { sha: '$Sha' } }));
}).listen($Port, '127.0.0.1');
"@ | Set-Content -LiteralPath $scriptPath -Encoding UTF8
  return Start-Process -FilePath (Get-Command node).Source -ArgumentList ('"' + $scriptPath + '"') -WorkingDirectory $Root -PassThru
}

function New-ReleaseRuntimeFixture {
  param([string]$ReleaseRoot, [string]$Sha, [string[]]$Dependencies = @('dotenv', 'express', 'sharp'))
  $releasePath = Join-Path $ReleaseRoot $Sha
  New-Item -ItemType Directory -Path (Join-Path $releasePath 'dist\public') -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $releasePath 'dist\index.js') -Value 'export {}' -NoNewline
  $declared = [ordered]@{}
  foreach ($dependency in $Dependencies) {
    $declared[$dependency] = '1.0.0'
    New-Item -ItemType Directory -Path (Join-Path $releasePath ('node_modules\' + $dependency)) -Force | Out-Null
  }
  [ordered]@{ name = 'fixture-release'; dependencies = $declared } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $releasePath 'package.json') -Encoding UTF8 -NoNewline
  [ordered]@{
    sha = $Sha
    buildStatus = 'ready'
    runtime = [ordered]@{ strategy = 'pnpm-deploy-legacy-prod'; dependenciesPath = 'node_modules' }
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $releasePath 'release.json') -Encoding UTF8 -NoNewline
  return $releasePath
}

function New-LongPathFixtureFile {
  param([Parameter(Mandatory = $true)][string]$Root, [Parameter(Mandatory = $true)][string]$Name)
  $directory = $Root
  while ($directory.Length -le 270) {
    $directory = Join-Path $directory ('segment-' + ('a' * 24))
  }
  [IO.Directory]::CreateDirectory('\\?\' + $directory) | Out-Null
  $path = Join-Path $directory $Name
  [IO.File]::WriteAllText('\\?\' + $path, 'fixture')
  return $path
}

Describe 'MegaDesk updater v2 isolated lifecycle' {
  BeforeEach {
    $script:port = Get-IsolatedTestPort
    $script:runtimeRoot = Join-Path $TestDrive 'runtime'
    $script:projectRoot = Join-Path $TestDrive 'project'
    New-Item -ItemType Directory -Path $script:projectRoot -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $script:projectRoot '.env.local') -Value '' -NoNewline
    & (Get-Module $moduleName) { param($runtimeRoot, $projectRoot, $port) Set-MegaDeskAutomationPaths -RuntimeRoot $runtimeRoot -ProjectRoot $projectRoot -Port $port } $script:runtimeRoot $script:projectRoot $script:port
  }

  It 'rejects invalid operation transitions' {
    { InModuleScope $moduleName { Set-MegaDeskOperationState -Status READY } } | Should Throw
  }

  It 'uses only a temporary runtime root and a non-production port in test mode' {
    $layout = InModuleScope $moduleName { Get-MegaDeskRuntimeLayout }
    $layout.runtimeRoot | Should Be $script:runtimeRoot
    $layout.port | Should Be $script:port
    $layout.port | Should Not Be 3000
  }

  It 'persists valid operation transitions in the isolated state file' {
    InModuleScope $moduleName {
      Set-MegaDeskOperationState -Status PREPARING -CandidateSha 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' | Out-Null
      Set-MegaDeskOperationState -Status READY -CandidateSha 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' | Out-Null
      (Get-MegaDeskState).operation.status | Should Be 'READY'
    }
  }

  It 'accepts only schemaVersion 2 state files without normalizing incompatible versions' {
    $global:MegaDeskStateSchemaCases = @(
      @{ Name = '2'; Value = 2; ShouldAccept = $true },
      @{ Name = '1'; Value = 1; ShouldAccept = $false },
      @{ Name = 'future'; Value = 99; ShouldAccept = $false },
      @{ Name = 'missing'; Value = $null; ShouldAccept = $false },
      @{ Name = 'null'; Value = $null; ShouldAccept = $false },
      @{ Name = 'string'; Value = '2'; ShouldAccept = $false }
    )
    InModuleScope $moduleName {
      Initialize-MegaDeskRuntime
      foreach ($case in $global:MegaDeskStateSchemaCases) {
        $state = [ordered]@{ node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null }
        if ($case.Name -ne 'missing') { $state.schemaVersion = $case.Value }
        $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $script:StatePath -Encoding UTF8 -NoNewline
        if ($case.ShouldAccept) {
          (Get-MegaDeskState).schemaVersion | Should Be 2
        } else {
          { Get-MegaDeskState } | Should Throw
        }
      }
    }
  }

  It 'ignores a legacy state when the canonical V2 state is absent' {
    InModuleScope $moduleName {
      Initialize-MegaDeskRuntime
      $legacyStatePath = Join-Path $script:RuntimeRoot 'automation-state.json'
      if (Test-Path -LiteralPath $script:StatePath) { Remove-Item -LiteralPath $script:StatePath -Force }
      [ordered]@{ schemaVersion = 1; node = [ordered]@{ pid = 1111 }; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $legacyStatePath -Encoding UTF8 -NoNewline

      $state = Get-MegaDeskState
      $state.schemaVersion | Should Be 2
      $state.node | Should Be $null
    }
  }

  It 'ignores an apparently valid V2 legacy state' {
    InModuleScope $moduleName {
      Initialize-MegaDeskRuntime
      $legacyStatePath = Join-Path $script:RuntimeRoot 'automation-state.json'
      if (Test-Path -LiteralPath $script:StatePath) { Remove-Item -LiteralPath $script:StatePath -Force }
      [ordered]@{ schemaVersion = 2; node = [ordered]@{ pid = 1111 }; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $legacyStatePath -Encoding UTF8 -NoNewline

      (Get-MegaDeskState).node | Should Be $null
    }
  }

  It 'fails closed for an invalid V2 state without falling back to legacy state' {
    InModuleScope $moduleName {
      Initialize-MegaDeskRuntime
      $legacyStatePath = Join-Path $script:RuntimeRoot 'automation-state.json'
      [ordered]@{ schemaVersion = 2; node = [ordered]@{ pid = 1111 }; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $legacyStatePath -Encoding UTF8 -NoNewline
      [ordered]@{ schemaVersion = 1; node = $null; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $script:StatePath -Encoding UTF8 -NoNewline

      { Get-MegaDeskState } | Should Throw
    }
  }

  It 'uses a valid V2 state when a legacy state is also present' {
    InModuleScope $moduleName {
      Initialize-MegaDeskRuntime
      $legacyStatePath = Join-Path $script:RuntimeRoot 'automation-state.json'
      [ordered]@{ schemaVersion = 2; node = [ordered]@{ pid = 1111 }; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $legacyStatePath -Encoding UTF8 -NoNewline
      [ordered]@{ schemaVersion = 2; node = [ordered]@{ pid = 2222 }; cloudflared = $null; activeRelease = $null; previousRelease = $null; operation = $null } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $script:StatePath -Encoding UTF8 -NoNewline

      (Get-MegaDeskState).node.pid | Should Be 2222
    }
  }

  It 'returns the expected empty state when neither V2 nor legacy state exists' {
    InModuleScope $moduleName {
      Initialize-MegaDeskRuntime
      $legacyStatePath = Join-Path $script:RuntimeRoot 'automation-state.json'
      if (Test-Path -LiteralPath $script:StatePath) { Remove-Item -LiteralPath $script:StatePath -Force }
      if (Test-Path -LiteralPath $legacyStatePath) { Remove-Item -LiteralPath $legacyStatePath -Force }

      $state = Get-MegaDeskState
      $state.schemaVersion | Should Be 2
      $state.node | Should Be $null
      $state.cloudflared | Should Be $null
    }
  }

  It 'accepts only a clean Git repository synchronized with upstream' {
    $global:MegaDeskTestProjectRoot = $script:projectRoot
    InModuleScope $moduleName {
      Mock Invoke-MegaDeskGit {
        param($Arguments)
        switch ($Arguments -join ' ') {
          'rev-parse --show-toplevel' { return $global:MegaDeskTestProjectRoot }
          'fetch' { return }
          'branch --show-current' { return 'release/updater-v2-bootstrap' }
          'rev-parse @{u}' { return 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
          'rev-parse HEAD' { return 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
          'status --porcelain=v1' { return }
          'rev-list --left-right --count @{u}...HEAD' { return "0`t0" }
          default { throw "Git mock inesperado: $($Arguments -join ' ')" }
        }
      }
      $result = Assert-MegaDeskGitPreflight -ExpectedBranch 'release/updater-v2-bootstrap'
      $result.behind | Should Be 0
      $result.ahead | Should Be 0
    }
  }

  It 'rejects a branch different from the approved release branch' {
    $global:MegaDeskTestProjectRoot = $script:projectRoot
    InModuleScope $moduleName {
      Mock Invoke-MegaDeskGit {
        param($Arguments)
        switch ($Arguments -join ' ') {
          'rev-parse --show-toplevel' { return $global:MegaDeskTestProjectRoot }
          'fetch' { return }
          'branch --show-current' { return 'wip/conversations-0013-lifecycle' }
          default { throw "Git mock inesperado: $($Arguments -join ' ')" }
        }
      }
      { Assert-MegaDeskGitPreflight -ExpectedBranch 'release/updater-v2-bootstrap' } | Should Throw
    }
  }

  It 'blocks dirty, ahead, behind and diverged Git states' {
    $global:MegaDeskTestProjectRoot = $script:projectRoot
    foreach ($case in @(
      @{ status = ' M source.ts'; divergence = "0`t0" },
      @{ status = ''; divergence = "0`t1" },
      @{ status = ''; divergence = "1`t0" },
      @{ status = ''; divergence = "1`t1" }
    )) {
      $global:MegaDeskGitCase = $case
      InModuleScope $moduleName {
        Mock Invoke-MegaDeskGit {
          param($Arguments)
          switch ($Arguments -join ' ') {
            'rev-parse --show-toplevel' { return $global:MegaDeskTestProjectRoot }
            'fetch' { return }
            'branch --show-current' { return 'release/updater-v2-bootstrap' }
            'rev-parse @{u}' { return 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
            'rev-parse HEAD' { return 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
            'status --porcelain=v1' { if ($global:MegaDeskGitCase.status) { return $global:MegaDeskGitCase.status }; return }
            'rev-list --left-right --count @{u}...HEAD' { return $global:MegaDeskGitCase.divergence }
            default { throw "Git mock inesperado: $($Arguments -join ' ')" }
          }
        }
        { Assert-MegaDeskGitPreflight -ExpectedBranch 'release/updater-v2-bootstrap' } | Should Throw
      }
    }
  }

  It 'classifies tenant migration and tenant schema paths as migration-bearing' {
    foreach ($changedPath in @('drizzle/tenant-migrations/0001_test.sql', 'drizzle/tenant-schema.ts')) {
      $global:MegaDeskMigrationPath = $changedPath
      InModuleScope $moduleName {
        Mock Invoke-MegaDeskGit {
          param($Arguments)
          if ($Arguments[0] -ne 'diff' -or $Arguments -notcontains 'drizzle/tenant-migrations' -or $Arguments -notcontains 'drizzle/tenant-schema.ts') {
            throw 'Pathset de migration incompleto.'
          }
          return @($global:MegaDeskMigrationPath)
        }
        @(Get-MegaDeskMigrationChanges -FromSha 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' -ToSha 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') | Should Be @($global:MegaDeskMigrationPath)
      }
    }
  }

  It 'blocks a missing active release and non-local test checks' {
    InModuleScope $moduleName {
      { Assert-MegaDeskActiveRelease -State (Get-MegaDeskState) } | Should Throw
      { Assert-MegaDeskTestChecks -Checks @(@{ Url = 'https://app.megadesk.online/healthz' }) } | Should Throw
    }
  }

  It 'accepts a release with its own production runtime and not the worktree node_modules' {
    $sha = '1212121212121212121212121212121212121212'
    $releasePath = New-ReleaseRuntimeFixture -ReleaseRoot (Join-Path $script:runtimeRoot 'releases') -Sha $sha
    $global:MegaDeskTestReleasePath = $releasePath
    InModuleScope $moduleName {
      $release = Get-MegaDeskRelease -Sha '1212121212121212121212121212121212121212'
      $release.runtime.nodeModulesPath | Should Be (Join-Path $global:MegaDeskTestReleasePath 'node_modules')
      $release.runtime.nodeModulesPath | Should Not Be (Join-Path $script:ProjectRoot 'node_modules')
      $release.runtime.dependencyCount | Should Be 3
    }
  }

  It 'rejects a release without its own production dependencies or with an environment file' {
    $sha = '1313131313131313131313131313131313131313'
    $releasePath = New-ReleaseRuntimeFixture -ReleaseRoot (Join-Path $script:runtimeRoot 'releases') -Sha $sha -Dependencies @('dotenv')
    Remove-Item -LiteralPath (Join-Path $releasePath 'node_modules\dotenv') -Force
    InModuleScope $moduleName {
      { Get-MegaDeskRelease -Sha '1313131313131313131313131313131313131313' } | Should Throw
    }

    $envSha = '1414141414141414141414141414141414141414'
    $envReleasePath = New-ReleaseRuntimeFixture -ReleaseRoot (Join-Path $script:runtimeRoot 'releases') -Sha $envSha -Dependencies @('dotenv')
    Set-Content -LiteralPath (Join-Path $envReleasePath '.env.local') -Value 'must-not-copy' -NoNewline
    InModuleScope $moduleName {
      { Get-MegaDeskRelease -Sha '1414141414141414141414141414141414141414' } | Should Throw
    }

    $exampleSha = '1414141414141414141414141414141414141415'
    $exampleReleasePath = New-ReleaseRuntimeFixture -ReleaseRoot (Join-Path $script:runtimeRoot 'releases') -Sha $exampleSha -Dependencies @('dotenv')
    Set-Content -LiteralPath (Join-Path $exampleReleasePath '.env.example') -Value 'documentation-only' -NoNewline
    InModuleScope $moduleName {
      { Get-MegaDeskRelease -Sha '1414141414141414141414141414141414141415' } | Should Throw
    }
  }

  It 'removes environment files only from the validated staging runtime' {
    $sha = '1414141414141414141414141414141414141416'
    $stagePath = New-ReleaseRuntimeFixture -ReleaseRoot (Join-Path $script:runtimeRoot 'staging') -Sha $sha -Dependencies @('dotenv')
    try {
      Set-Content -LiteralPath (Join-Path $stagePath '.env.example') -Value 'documentation-only' -NoNewline
      Set-Content -LiteralPath (Join-Path $stagePath '.env.local.example') -Value 'documentation-only' -NoNewline
      Set-Content -LiteralPath (Join-Path $stagePath 'keep.txt') -Value 'keep' -NoNewline
      $global:MegaDeskTestStagingPath = $stagePath
      InModuleScope $moduleName {
        Remove-MegaDeskReleaseEnvironmentFiles -ReleasePath $global:MegaDeskTestStagingPath -AllowedRoot $script:StagingRoot
        @(Get-ChildItem -LiteralPath $global:MegaDeskTestStagingPath -Force -File -Filter '.env*').Count | Should Be 0
        Test-Path -LiteralPath (Join-Path $global:MegaDeskTestStagingPath 'keep.txt') | Should Be $true
      }
    } finally {
      if (Test-Path -LiteralPath $stagePath) { Remove-Item -LiteralPath $stagePath -Recurse -Force }
    }
  }

  It 'converts local and UNC paths to extended syntax without double-prefixing' {
    InModuleScope $moduleName {
      (ConvertTo-MegaDeskExtendedPath -Path 'C:\MegaDesk\runtime') | Should Be '\\?\C:\MegaDesk\runtime'
      (ConvertTo-MegaDeskExtendedPath -Path '\\server\share\runtime') | Should Be '\\?\UNC\server\share\runtime'
      (ConvertTo-MegaDeskExtendedPath -Path '\\?\C:\MegaDesk\runtime') | Should Be '\\?\C:\MegaDesk\runtime'
      (ConvertFrom-MegaDeskExtendedPath -Path '\\?\C:\MegaDesk\runtime') | Should Be 'C:\MegaDesk\runtime'
      (ConvertFrom-MegaDeskExtendedPath -Path '\\?\UNC\server\share\runtime') | Should Be '\\server\share\runtime'
    }
  }

  It 'traverses and removes a long staging tree without following its junction target' {
    $fixtureRoot = Join-Path $TestDrive 'long-path-fixture'
    $treeRoot = Join-Path $fixtureRoot 'staging-tree'
    $externalRoot = Join-Path $fixtureRoot 'external-target'
    New-Item -ItemType Directory -Path $treeRoot, $externalRoot -Force | Out-Null
    $longFile = New-LongPathFixtureFile -Root $treeRoot -Name 'supportsWebCrypto.d.ts'
    Set-Content -LiteralPath (Join-Path $externalRoot 'must-remain.txt') -Value 'external' -NoNewline
    $junctionPath = Join-Path $treeRoot 'external-junction'
    New-Item -ItemType Junction -Path $junctionPath -Target $externalRoot -ErrorAction Stop | Out-Null
    $global:MegaDeskLongPathFixtureRoot = $fixtureRoot
    $global:MegaDeskLongPathTreeRoot = $treeRoot
    $global:MegaDeskLongPathExternalRoot = $externalRoot
    $global:MegaDeskLongPathFixtureFile = $longFile
    $global:MegaDeskLongPathJunction = $junctionPath
    try {
      InModuleScope $moduleName {
        (Test-MegaDeskPhysicalPathExists -Path $global:MegaDeskLongPathFixtureFile) | Should Be $true
        (Get-MegaDeskCanonicalPhysicalPath -Path $global:MegaDeskLongPathFixtureFile).Length | Should BeGreaterThan 260
        $links = @(Get-MegaDeskReparsePointsNoFollow -Root $global:MegaDeskLongPathTreeRoot)
        ($links -contains $global:MegaDeskLongPathJunction) | Should Be $true
        Remove-MegaDeskTreeNoFollow -Path $global:MegaDeskLongPathTreeRoot -AllowedRoot $global:MegaDeskLongPathFixtureRoot -Label 'Fixture long-path'
      }
      (Test-Path -LiteralPath $treeRoot) | Should Be $false
      (Test-Path -LiteralPath (Join-Path $externalRoot 'must-remain.txt')) | Should Be $true
    } finally {
      if (Test-Path -LiteralPath $treeRoot) {
        InModuleScope $moduleName {
          Remove-MegaDeskTreeNoFollow -Path $global:MegaDeskLongPathTreeRoot -AllowedRoot $global:MegaDeskLongPathFixtureRoot -Label 'Fixture long-path cleanup'
        }
      }
      if (Test-Path -LiteralPath $externalRoot) {
        InModuleScope $moduleName {
          Remove-MegaDeskTreeNoFollow -Path $global:MegaDeskLongPathExternalRoot -AllowedRoot $global:MegaDeskLongPathFixtureRoot -Label 'Fixture external cleanup'
        }
      }
      if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Force -ErrorAction Stop }
    }
  }

  It 'fails closed when long-path cleanup cannot remove an item' {
    $fixtureRoot = Join-Path $TestDrive 'long-path-failure-fixture'
    $treeRoot = Join-Path $fixtureRoot 'staging-tree'
    New-Item -ItemType Directory -Path $treeRoot -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $treeRoot 'cannot-remove.txt') -Value 'fixture' -NoNewline
    $global:MegaDeskLongPathFailureFixtureRoot = $fixtureRoot
    $global:MegaDeskLongPathFailureTreeRoot = $treeRoot
    try {
      InModuleScope $moduleName {
        Mock Remove-MegaDeskLongPathItem { throw 'simulated removal failure' }
        { Remove-MegaDeskTreeNoFollow -Path $global:MegaDeskLongPathFailureTreeRoot -AllowedRoot $global:MegaDeskLongPathFailureFixtureRoot -Label 'Fixture forced failure' } | Should Throw
      }
      (Test-Path -LiteralPath $treeRoot) | Should Be $true
    } finally {
      if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction Stop }
    }
  }

  It 'keeps a complete previous release usable and removes a candidate when dependency preparation fails' {
    $previousSha = '1515151515151515151515151515151515151515'
    New-ReleaseRuntimeFixture -ReleaseRoot (Join-Path $script:runtimeRoot 'releases') -Sha $previousSha -Dependencies @('dotenv') | Out-Null
    $candidateSha = '1616161616161616161616161616161616161616'
    $global:MegaDeskTestCandidateSha = $candidateSha
    InModuleScope $moduleName {
      (Get-MegaDeskRelease -Sha '1515151515151515151515151515151515151515').sha | Should Be '1515151515151515151515151515151515151515'
      Mock Invoke-MegaDeskReleaseDependencyDeploy { throw 'dependencias indisponiveis' }
      { Invoke-MegaDeskIsolatedBuild -Sha $global:MegaDeskTestCandidateSha } | Should Throw
      Test-Path -LiteralPath (Join-Path $script:ReleaseRoot $global:MegaDeskTestCandidateSha) | Should Be $false
      @(Get-ChildItem -LiteralPath $script:StagingRoot -Force -ErrorAction SilentlyContinue).Count | Should Be 0
    }
  }

  It 'rejects dependency links that point to the worktree node_modules' {
    $sha = '1111111111111111111111111111111111111112'
    $releasePath = New-ReleaseRuntimeFixture -ReleaseRoot (Join-Path $script:runtimeRoot 'releases') -Sha $sha -Dependencies @('dotenv')
    $global:MegaDeskTestReleasePath = $releasePath
    $global:MegaDeskWorktreeNodeModules = Join-Path $script:projectRoot 'node_modules\dotenv'
    InModuleScope $moduleName {
      Mock Get-MegaDeskCanonicalPhysicalPath {
        param($Path)
        if ($Path -eq (Join-Path $global:MegaDeskTestReleasePath 'node_modules\dotenv')) {
          return $global:MegaDeskWorktreeNodeModules
        }
        return [System.IO.Path]::GetFullPath($Path)
      }
      Mock Get-MegaDeskReparsePointsNoFollow { @() }
      { Assert-MegaDeskReleaseRuntime -ReleasePath $global:MegaDeskTestReleasePath -AllowedRoot $script:ReleaseRoot } | Should Throw
    }
  }

  It 'accepts only reparse points canonically inside the release runtime' {
    $sha = '1111111111111111111111111111111111111113'
    $releasePath = New-ReleaseRuntimeFixture -ReleaseRoot (Join-Path $script:runtimeRoot 'releases') -Sha $sha -Dependencies @('dotenv')
    $global:MegaDeskTestReleasePath = $releasePath
    $global:MegaDeskTestRuntimeLink = Join-Path $releasePath 'node_modules\valid-link'
    InModuleScope $moduleName {
      Mock Get-MegaDeskCanonicalPhysicalPath { param($Path) [System.IO.Path]::GetFullPath($Path) }
      Mock Get-MegaDeskReparsePointsNoFollow { @($global:MegaDeskTestRuntimeLink) }
      (Assert-MegaDeskReleaseRuntime -ReleasePath $global:MegaDeskTestReleasePath -AllowedRoot $script:ReleaseRoot).linkCount | Should Be 1
    }
  }

  It 'blocks lexically internal reparse points with physical targets outside the release' {
    $sha = '1111111111111111111111111111111111111114'
    $releasePath = New-ReleaseRuntimeFixture -ReleaseRoot (Join-Path $script:runtimeRoot 'releases') -Sha $sha -Dependencies @('dotenv')
    $global:MegaDeskTestReleasePath = $releasePath
    $global:MegaDeskTestRuntimeLink = Join-Path $releasePath 'node_modules\internal-name'
    InModuleScope $moduleName {
      Mock Get-MegaDeskCanonicalPhysicalPath {
        param($Path)
        if ($Path -eq $global:MegaDeskTestRuntimeLink) { return 'C:\outside\runtime-link' }
        return [System.IO.Path]::GetFullPath($Path)
      }
      Mock Get-MegaDeskReparsePointsNoFollow { @($global:MegaDeskTestRuntimeLink) }
      { Assert-MegaDeskReleaseRuntime -ReleasePath $global:MegaDeskTestReleasePath -AllowedRoot $script:ReleaseRoot } | Should Throw
    }
  }

  It 'blocks explicit external reparse targets and canonicalization failures' {
    $sha = '1111111111111111111111111111111111111115'
    $releasePath = New-ReleaseRuntimeFixture -ReleaseRoot (Join-Path $script:runtimeRoot 'releases') -Sha $sha -Dependencies @('dotenv')
    $global:MegaDeskTestReleasePath = $releasePath
    $global:MegaDeskTestRuntimeLink = Join-Path $releasePath 'node_modules\external-link'
    InModuleScope $moduleName {
      Mock Get-MegaDeskCanonicalPhysicalPath {
        param($Path)
        if ($Path -eq $global:MegaDeskTestRuntimeLink) { return 'C:\outside\runtime-link' }
        return [System.IO.Path]::GetFullPath($Path)
      }
      Mock Get-MegaDeskReparsePointsNoFollow { @($global:MegaDeskTestRuntimeLink) }
      { Assert-MegaDeskReleaseRuntime -ReleasePath $global:MegaDeskTestReleasePath -AllowedRoot $script:ReleaseRoot } | Should Throw

      Mock Get-MegaDeskCanonicalPhysicalPath { throw 'canonicalizacao indisponivel' }
      Mock Get-MegaDeskReparsePointsNoFollow { @() }
      { Assert-MegaDeskReleaseRuntime -ReleasePath $global:MegaDeskTestReleasePath -AllowedRoot $script:ReleaseRoot } | Should Throw
    }
  }

  It 'recognizes only the canonical absolute Node launch identity' {
    $sha = '1212121212121212121212121212121212121213'
    $releasePath = New-ReleaseRuntimeFixture -ReleaseRoot (Join-Path $script:runtimeRoot 'releases') -Sha $sha -Dependencies @('dotenv')
    $global:MegaDeskIdentity = [pscustomobject]@{
      executablePath = 'C:\Program Files\nodejs\node.exe'
      environmentPath = Join-Path $script:projectRoot '.env.local'
      scriptPath = Join-Path $releasePath 'dist\index.js'
      releaseSha = $sha
      startedAtUtc = ([DateTime]::UtcNow).ToString('o')
      pid = 4242
      port = $script:port
    }
    InModuleScope $moduleName {
      $identity = $global:MegaDeskIdentity
      $launch = New-MegaDeskNodeLaunchSpec -ExecutablePath $identity.executablePath -EnvironmentPath $identity.environmentPath -ScriptPath $identity.scriptPath
      $global:MegaDeskIdentityProcess = [pscustomobject]@{
        ProcessId = $identity.pid
        ExecutablePath = $identity.executablePath
        CommandLine = ('"{0}" {1}' -f $launch.executablePath, $launch.arguments)
        CreationDate = $identity.startedAtUtc
      }
      Mock Get-ProcessSnapshot { $global:MegaDeskIdentityProcess }
      Mock Get-NetTCPConnection { [pscustomobject]@{ OwningProcess = $identity.pid } }

      (Test-ManagedProcess -Record $identity -Kind node) | Should Be $true

      $global:MegaDeskIdentityProcess.CommandLine = ('"{0}" --env-file=.env.local "{1}"' -f $launch.executablePath, $launch.scriptPath)
      (Test-ManagedProcess -Record $identity -Kind node) | Should Be $false

      $global:MegaDeskIdentityProcess.CommandLine = ('"{0}" --env-file="C:\other\.env.local" "{1}"' -f $launch.executablePath, $launch.scriptPath)
      (Test-ManagedProcess -Record $identity -Kind node) | Should Be $false

      $otherScript = Join-Path (Join-Path $script:ReleaseRoot 'abababababababababababababababababababab') 'dist\index.js'
      $global:MegaDeskIdentityProcess.CommandLine = ('"{0}" --env-file="{1}" "{2}"' -f $launch.executablePath, $launch.environmentPath, $otherScript)
      (Test-ManagedProcess -Record $identity -Kind node) | Should Be $false

      $global:MegaDeskIdentityProcess.CommandLine = ('"{0}" --inspect=127.0.0.1:9229 --env-file="{1}" "{2}"' -f $launch.executablePath, $launch.environmentPath, $launch.scriptPath)
      (Test-ManagedProcess -Record $identity -Kind node) | Should Be $false

      $global:MegaDeskIdentityProcess.CommandLine = ('"{0}" {1}' -f $launch.executablePath, $launch.arguments)
      $global:MegaDeskIdentityProcess.CreationDate = ([DateTime]::UtcNow.AddSeconds(1)).ToString('o')
      (Test-ManagedProcess -Record $identity -Kind node) | Should Be $false
    }
  }

  It 'recognizes only the structured cloudflared identity without Node port ownership' {
    $global:MegaDeskCloudflaredIdentity = [pscustomobject]@{
      executablePath = 'C:\Program Files\cloudflared\cloudflared.exe'
      configPath = Join-Path $script:projectRoot 'cloudflared-test.yml'
      startedAtUtc = ([DateTime]::UtcNow).ToString('o')
      pid = 5252
      port = $null
    }
    InModuleScope $moduleName {
      $identity = $global:MegaDeskCloudflaredIdentity
      $global:MegaDeskCloudflaredProcess = [pscustomobject]@{
        ProcessId = $identity.pid
        ExecutablePath = $identity.executablePath
        CommandLine = ('"{0}" tunnel --config "{1}" run megadesk' -f $identity.executablePath, $identity.configPath)
        CreationDate = $identity.startedAtUtc
      }
      Mock Get-ProcessSnapshot { $global:MegaDeskCloudflaredProcess }

      (Test-ManagedProcess -Record $identity -Kind cloudflared) | Should Be $true

      $global:MegaDeskCloudflaredProcess.ExecutablePath = 'C:\other\cloudflared.exe'
      (Test-ManagedProcess -Record $identity -Kind cloudflared) | Should Be $false

      $global:MegaDeskCloudflaredProcess.ExecutablePath = $identity.executablePath
      $global:MegaDeskCloudflaredProcess.CommandLine = ('"{0}" tunnel run megadesk --config "{1}"' -f $identity.executablePath, $identity.configPath)
      (Test-ManagedProcess -Record $identity -Kind cloudflared) | Should Be $false

      $global:MegaDeskCloudflaredProcess.CommandLine = ('"{0}" tunnel --config "{1}" run megadesk' -f $identity.executablePath, $identity.configPath)
      $global:MegaDeskCloudflaredProcess.CreationDate = ([DateTime]::UtcNow.AddSeconds(1)).ToString('o')
      (Test-ManagedProcess -Record $identity -Kind cloudflared) | Should Be $false

      $global:MegaDeskCloudflaredProcess.CreationDate = $identity.startedAtUtc
      (Test-ManagedProcess -Record $identity -Kind 'unknown') | Should Be $false
    }
  }

  It 'records no Node port for cloudflared' {
    $global:MegaDeskCloudflaredSnapshot = [pscustomobject]@{ CreationDate = ([DateTime]::UtcNow).ToString('o') }
    InModuleScope $moduleName {
      Mock Get-ProcessSnapshot { $global:MegaDeskCloudflaredSnapshot }
      $record = New-ManagedProcessRecord -Process ([pscustomobject]@{ Id = 5252 }) -ExecutablePath 'C:\Program Files\cloudflared\cloudflared.exe' -Kind cloudflared -ConfigPath (Join-Path $script:ProjectRoot 'cloudflared-test.yml')
      $record.port | Should Be $null
    }
  }

  It 'rejects a Node port supplied directly to cloudflared' {
    InModuleScope $moduleName {
      { New-ManagedProcessRecord -Process ([pscustomobject]@{ Id = 5252 }) -ExecutablePath 'C:\Program Files\cloudflared\cloudflared.exe' -Kind cloudflared -ConfigPath (Join-Path $script:ProjectRoot 'cloudflared-test.yml') -Port 3000 } | Should Throw
    }
  }

  It 'rejects a v2 state that records a Node port for cloudflared' {
    InModuleScope $moduleName {
      [ordered]@{
        schemaVersion = 2
        node = $null
        cloudflared = [ordered]@{
          pid = 5252
          executablePath = 'C:\Program Files\cloudflared\cloudflared.exe'
          configPath = (Join-Path $script:ProjectRoot 'cloudflared-test.yml')
          startedAtUtc = ([DateTime]::UtcNow).ToString('o')
          port = 3000
        }
        activeRelease = $null
        previousRelease = $null
        operation = $null
      } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $script:StatePath -Encoding UTF8 -NoNewline

      { Get-MegaDeskState } | Should Throw
    }
  }

  It 'requires the recorded port to be owned by the statically identified process' {
    $global:MegaDeskPortIdentityRecord = [pscustomobject]@{ pid = 4242; port = 32120 }
    InModuleScope $moduleName {
      $record = $global:MegaDeskPortIdentityRecord
      Mock Test-MegaDeskStaticProcessIdentity { $true }

      Mock Get-NetTCPConnection { @() }
      (Test-ManagedProcess -Record $record -Kind node) | Should Be $false

      Mock Get-NetTCPConnection { [pscustomobject]@{ OwningProcess = 9999 } }
      (Test-ManagedProcess -Record $record -Kind node) | Should Be $false

      Mock Get-NetTCPConnection { throw 'consulta negada' }
      (Test-ManagedProcess -Record $record -Kind node) | Should Be $false

      Mock Get-NetTCPConnection { [pscustomobject]@{ OwningProcess = 4242 } }
      (Test-ManagedProcess -Record $record -Kind node) | Should Be $true
    }
  }

  It 'classifies FREE, managed and external port ownership explicitly' {
    $global:MegaDeskPortProcess = [pscustomobject]@{ ProcessId = 4242; ExecutablePath = 'C:\runtime\node.exe'; CommandLine = '--env-file="C:\env\.env.local" "C:\release\dist\index.js"'; CreationDate = [DateTime]::UtcNow }
    InModuleScope $moduleName {
      Mock Get-NetTCPConnection { return @() }
      (Get-MegaDeskPortOwnership -Port 32120).status | Should Be 'FREE'

      Mock Get-NetTCPConnection { [pscustomobject]@{ OwningProcess = 4242 } }
      Mock Get-ProcessSnapshotStrict { $global:MegaDeskPortProcess }
      Mock Test-MegaDeskStaticProcessIdentity { $true }
      (Get-MegaDeskPortOwnership -Port 32120 -ManagedRecord ([pscustomobject]@{ pid = 4242; port = 32120 }) -ManagedKind node).status | Should Be 'OWNED_BY_MANAGED_PROCESS'

      Mock Test-MegaDeskStaticProcessIdentity { $false }
      (Get-MegaDeskPortOwnership -Port 32120 -ManagedRecord ([pscustomobject]@{ pid = 4242; port = 32120 }) -ManagedKind node).status | Should Be 'OWNED_BY_EXTERNAL_PROCESS'

      Mock Test-MegaDeskStaticProcessIdentity { $true }
      (Get-MegaDeskPortOwnership -Port 32120 -ManagedRecord ([pscustomobject]@{ pid = 9999; port = 32120 }) -ManagedKind node).status | Should Be 'OWNED_BY_EXTERNAL_PROCESS'
    }
  }

  It 'treats query failures and incomplete ownership as UNKNOWN and blocks before stopping anything' {
    $old = [pscustomobject]@{ sha = '1717171717171717171717171717171717171717'; path = 'C:\isolated\old' }
    $candidate = [pscustomobject]@{ sha = '1818181818181818181818181818181818181818'; path = 'C:\isolated\candidate' }
    $global:MegaDeskTestOld = $old
    $global:MegaDeskTestCandidate = $candidate
    InModuleScope $moduleName {
      Mock Get-NetTCPConnection { throw 'consulta negada' }
      (Get-MegaDeskPortOwnership -Port 32120).status | Should Be 'UNKNOWN'

      Mock Get-NetTCPConnection { [pscustomobject]@{ OwningProcess = 4242 } }
      Mock Get-ProcessSnapshotStrict { [pscustomobject]@{ ProcessId = 4242; ExecutablePath = ''; CommandLine = ''; CreationDate = $null } }
      (Get-MegaDeskPortOwnership -Port 32120).status | Should Be 'UNKNOWN'

      $old = $global:MegaDeskTestOld
      $candidate = $global:MegaDeskTestCandidate
      $script:testState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = [pscustomobject]@{ sha = $old.sha; path = $old.path; activatedAt = '2026-01-01T00:00:00.000Z' }; previousRelease = $null; operation = [pscustomobject]@{ status = 'READY' } }
      Mock Get-MegaDeskState { $script:testState }
      Mock Save-MegaDeskState { param($State) $script:testState = $State }
      Mock Set-MegaDeskOperationState { }
      Mock Get-MegaDeskPortOwnership { [pscustomobject]@{ status = 'UNKNOWN'; port = 32120; process = $null; reason = 'consulta negada' } }
      Mock Stop-MegaDeskManagedProcess { }
      Mock Start-MegaDeskNode { }
      { Invoke-MegaDeskReleaseSwitch -CandidateRelease $candidate -PreviousRelease $old -PublicChecks @(@{ Url = 'http://127.0.0.1:32120/healthz'; Expected = 200; Label = 'health isolated' }) -TestMode } | Should Throw
      Assert-MockCalled Stop-MegaDeskManagedProcess -Times 0 -Exactly
      Assert-MockCalled Start-MegaDeskNode -Times 0 -Exactly
    }
  }

  It 'blocks PID reuse before stopping the recorded runtime' {
    $old = [pscustomobject]@{ sha = '1919191919191919191919191919191919191919'; path = 'C:\isolated\old' }
    $candidate = [pscustomobject]@{ sha = '2020202020202020202020202020202020202020'; path = 'C:\isolated\candidate' }
    $global:MegaDeskTestOld = $old
    $global:MegaDeskTestCandidate = $candidate
    InModuleScope $moduleName {
      $old = $global:MegaDeskTestOld
      $candidate = $global:MegaDeskTestCandidate
      $script:testState = [pscustomobject]@{ schemaVersion = 2; node = [pscustomobject]@{ pid = 4242; releaseSha = $old.sha }; cloudflared = $null; activeRelease = [pscustomobject]@{ sha = $old.sha; path = $old.path; activatedAt = '2026-01-01T00:00:00.000Z' }; previousRelease = $null; operation = [pscustomobject]@{ status = 'READY' } }
      Mock Get-MegaDeskState { $script:testState }
      Mock Save-MegaDeskState { param($State) $script:testState = $State }
      Mock Set-MegaDeskOperationState { }
      Mock Test-ManagedProcess { $false }
      Mock Stop-MegaDeskManagedProcess { }
      { Invoke-MegaDeskReleaseSwitch -CandidateRelease $candidate -PreviousRelease $old -PublicChecks @(@{ Url = 'http://127.0.0.1:32120/healthz'; Expected = 200; Label = 'health isolated' }) -TestMode } | Should Throw
      Assert-MockCalled Stop-MegaDeskManagedProcess -Times 0 -Exactly
    }
  }

  It 'marks the candidate active only after the switch health calls succeed' {
    $old = [pscustomobject]@{ sha = '2222222222222222222222222222222222222222'; path = 'C:\isolated\old' }
    $candidate = [pscustomobject]@{ sha = '3333333333333333333333333333333333333333'; path = 'C:\isolated\candidate' }
    $global:MegaDeskTestOld = $old
    $global:MegaDeskTestCandidate = $candidate
    InModuleScope $moduleName {
      $old = $global:MegaDeskTestOld
      $candidate = $global:MegaDeskTestCandidate
      $script:testState = [pscustomobject]@{ schemaVersion = 2; node = [pscustomobject]@{ releaseSha = $old.sha }; cloudflared = $null; activeRelease = [pscustomobject]@{ sha = $old.sha; path = $old.path; activatedAt = '2026-01-01T00:00:00.000Z' }; previousRelease = $null; operation = [pscustomobject]@{ status = 'READY' } }
      Mock Get-MegaDeskState { $script:testState }
      Mock Save-MegaDeskState { param($State) $script:testState = $State }
      Mock Set-MegaDeskOperationState { }
      Mock Test-ManagedProcess { $true }
      Mock Stop-MegaDeskManagedProcess { }
      Mock Assert-MegaDeskPortFree { }
      Mock Start-MegaDeskNode { [pscustomobject]@{ releaseSha = $candidate.sha } }
      Mock Wait-MegaDeskLocal { }
      Mock Wait-MegaDeskPublicEndpoints { }
      Invoke-MegaDeskReleaseSwitch -CandidateRelease $candidate -PreviousRelease $old -PublicChecks @(@{ Url = 'http://127.0.0.1:32120/healthz'; Expected = 200; Label = 'health isolated' }) -TestMode
      $script:testState.activeRelease.sha | Should Be $candidate.sha
      $script:testState.previousRelease.sha | Should Be $old.sha
      Assert-MockCalled Wait-MegaDeskLocal -Times 1 -Exactly
      Assert-MockCalled Wait-MegaDeskPublicEndpoints -Times 1 -Exactly
    }
  }

  It 'invokes rollback when the candidate health check fails' {
    $old = [pscustomobject]@{ sha = '4444444444444444444444444444444444444444'; path = 'C:\isolated\old' }
    $candidate = [pscustomobject]@{ sha = '5555555555555555555555555555555555555555'; path = 'C:\isolated\candidate' }
    $global:MegaDeskTestOld = $old
    $global:MegaDeskTestCandidate = $candidate
    InModuleScope $moduleName {
      $old = $global:MegaDeskTestOld
      $candidate = $global:MegaDeskTestCandidate
      $script:testState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = [pscustomobject]@{ sha = $old.sha; path = $old.path; activatedAt = '2026-01-01T00:00:00.000Z' }; previousRelease = $null; operation = [pscustomobject]@{ status = 'READY' } }
      Mock Get-MegaDeskState { $script:testState }
      Mock Save-MegaDeskState { param($State) $script:testState = $State }
      Mock Set-MegaDeskOperationState { }
      Mock Assert-MegaDeskPortFree { }
      Mock Start-MegaDeskNode { [pscustomobject]@{ releaseSha = $candidate.sha } }
      Mock Wait-MegaDeskLocal { throw 'Health local retornou SHA diferente da release candidata.' }
      Mock Invoke-MegaDeskReleaseRollback { }
      { Invoke-MegaDeskReleaseSwitch -CandidateRelease $candidate -PreviousRelease $old -PublicChecks @(@{ Url = 'http://127.0.0.1:32120/healthz'; Expected = 200; Label = 'health isolated' }) -TestMode } | Should Throw
      Assert-MockCalled Invoke-MegaDeskReleaseRollback -Times 1 -Exactly
    }
  }
}

Describe 'MegaDesk updater v2 real process health' -Tags @('ProcessReal') {
  BeforeEach {
    $script:port = Get-IsolatedTestPort
  }

  It 'validates real dummy health on an isolated port' {
    $sha = '1111111111111111111111111111111111111111'
    $process = New-DummyHealthServer -Root $TestDrive -Port $script:port -Sha $sha
    try {
      $health = $null
      for ($attempt = 0; $attempt -lt 15 -and $null -eq $health; $attempt++) {
        try { $health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$script:port/healthz" -TimeoutSec 1 | Select-Object -ExpandProperty Content | ConvertFrom-Json } catch { Start-Sleep -Milliseconds 200 }
      }
      if ($null -eq $health) { throw 'Dummy health nao iniciou na porta temporaria.' }
      $health.status | Should Be 'healthy'
      $health.release.sha | Should Be $sha
    } finally {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
  }
}
