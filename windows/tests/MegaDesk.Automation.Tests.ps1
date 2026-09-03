$modulePath = Join-Path $PSScriptRoot '..\MegaDesk.Automation.psm1'
Import-Module $modulePath -Force
$moduleName = 'MegaDesk.Automation'

function Get-IsolatedTestPort {
  foreach ($port in 32120..32180) {
    if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { return $port }
  }
  throw 'Nenhuma porta temporaria livre para o teste do updater.'
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
          'branch --show-current' { return 'wip/conversations-0013-lifecycle' }
          'rev-parse @{u}' { return 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
          'rev-parse HEAD' { return 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
          'status --porcelain=v1' { return }
          'rev-list --left-right --count @{u}...HEAD' { return "0`t0" }
          default { throw "Git mock inesperado: $($Arguments -join ' ')" }
        }
      }
      $result = Assert-MegaDeskGitPreflight -ExpectedBranch 'wip/conversations-0013-lifecycle'
      $result.behind | Should Be 0
      $result.ahead | Should Be 0
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
            'branch --show-current' { return 'wip/conversations-0013-lifecycle' }
            'rev-parse @{u}' { return 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
            'rev-parse HEAD' { return 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
            'status --porcelain=v1' { if ($global:MegaDeskGitCase.status) { return $global:MegaDeskGitCase.status }; return }
            'rev-list --left-right --count @{u}...HEAD' { return $global:MegaDeskGitCase.divergence }
            default { throw "Git mock inesperado: $($Arguments -join ' ')" }
          }
        }
        { Assert-MegaDeskGitPreflight -ExpectedBranch 'wip/conversations-0013-lifecycle' } | Should Throw
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
