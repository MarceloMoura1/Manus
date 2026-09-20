$modulePath = Join-Path $PSScriptRoot '..\MegaDesk.Automation.psm1'
Import-Module $modulePath -Force
$moduleName = 'MegaDesk.Automation'

function global:New-BootstrapReleaseRuntimeFixture {
  param([string]$ReleaseRoot, [string]$Sha)
  $releasePath = Join-Path $ReleaseRoot $Sha
  New-Item -ItemType Directory -Path (Join-Path $releasePath 'dist\public') -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $releasePath 'dist\index.js') -Value 'export {}' -NoNewline
  New-Item -ItemType Directory -Path (Join-Path $releasePath 'node_modules\dotenv') -Force | Out-Null
  [ordered]@{ name = 'bootstrap-fixture'; dependencies = [ordered]@{ dotenv = '1.0.0' } } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $releasePath 'package.json') -Encoding UTF8 -NoNewline
  [ordered]@{ sha = $Sha; buildStatus = 'ready'; runtime = [ordered]@{ strategy = 'pnpm-deploy-legacy-prod'; dependenciesPath = 'node_modules' } } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $releasePath 'release.json') -Encoding UTF8 -NoNewline
  return $releasePath
}

Describe 'MegaDesk isolated worktree runtime configuration and publisher launch safety' {
  $testRoot = Join-Path $TestDrive 'isolated-publish-tests'
  $runtimeRoot = Join-Path $testRoot 'runtime'
  $isolatedWorktree = Join-Path $testRoot 'isolated-worktree'
  $canonicalConfigRoot = Join-Path $testRoot 'canonical-config'
  $port = 32177

  $global:MegaDeskTestRuntimeRoot = $runtimeRoot
  $global:MegaDeskTestWorktree = $isolatedWorktree
  $global:MegaDeskTestConfigRoot = $canonicalConfigRoot
  $global:MegaDeskTestPort = $port
  $global:MegaDeskTestChecks = @(@{ Url = 'http://127.0.0.1:32177/healthz'; Expected = 200; Label = 'isolated test' })

  BeforeEach {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $isolatedWorktree -Force | Out-Null
    New-Item -ItemType Directory -Path $canonicalConfigRoot -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $canonicalConfigRoot '.env.local') -Value 'SYNTHETIC_TEST_SECRET=1' -Encoding UTF8
    $env:MEGADESK_RUNTIME_CONFIG_ROOT = $null
  }

  It 'Caso A: isolated worktree without .env.local passes launch preflight when canonical runtime config root has .env.local' {
    InModuleScope $moduleName {
      $runtime = $global:MegaDeskTestRuntimeRoot
      $worktree = $global:MegaDeskTestWorktree
      $configRoot = $global:MegaDeskTestConfigRoot
      $testPort = $global:MegaDeskTestPort

      Set-MegaDeskAutomationPaths -RuntimeRoot $runtime -ProjectRoot $worktree -Port $testPort -RuntimeConfigRoot $configRoot
      $candidateSha = '1111111111111111111111111111111111111111'
      $candidatePath = New-BootstrapReleaseRuntimeFixture -ReleaseRoot $script:ReleaseRoot -Sha $candidateSha
      $candidate = [pscustomobject]@{ sha = $candidateSha; path = $candidatePath }

      $preflight = Assert-MegaDeskCandidateLaunchReadiness -CandidateRelease $candidate -Port $testPort
      $preflight.status | Should Be 'READY'
      $preflight.runtimeConfigRoot | Should Be (ConvertTo-MegaDeskCanonicalPath $configRoot)
      $preflight.environmentPath | Should Be (ConvertTo-MegaDeskCanonicalPath (Join-Path $configRoot '.env.local'))
    }
  }

  It 'Caso B: fails launch readiness and publisher switch before Stop-MegaDeskNode when runtime config root has no .env.local' {
    InModuleScope $moduleName {
      $runtime = $global:MegaDeskTestRuntimeRoot
      $worktree = $global:MegaDeskTestWorktree
      $testPort = $global:MegaDeskTestPort
      $checks = $global:MegaDeskTestChecks

      $emptyConfigRoot = Join-Path $runtime 'empty-config'
      New-Item -ItemType Directory -Path $emptyConfigRoot -Force | Out-Null
      Set-MegaDeskAutomationPaths -RuntimeRoot $runtime -ProjectRoot $worktree -Port $testPort -RuntimeConfigRoot $emptyConfigRoot

      $activeSha = '2222222222222222222222222222222222222222'
      $candidateSha = '3333333333333333333333333333333333333333'
      $candidatePath = New-BootstrapReleaseRuntimeFixture -ReleaseRoot $script:ReleaseRoot -Sha $candidateSha
      $candidate = [pscustomobject]@{ sha = $candidateSha; path = $candidatePath }
      $active = [pscustomobject]@{ sha = $activeSha; path = (Join-Path $script:ReleaseRoot $activeSha) }

      $activeNode = [pscustomobject]@{ pid = 99999; releaseSha = $activeSha }
      $script:testState = [pscustomobject]@{
        schemaVersion = 2
        node = $activeNode
        cloudflared = $null
        activeRelease = [pscustomobject]@{ sha = $activeSha; path = $active.path; activatedAt = '2026-01-01T00:00:00.000Z' }
        previousRelease = $null
        operation = [pscustomobject]@{ status = 'READY'; kind = 'UPDATE'; candidateSha = $candidateSha; switchAttempted = $false }
      }
      Mock Get-MegaDeskState { $script:testState }
      Mock Save-MegaDeskState { param($State) $script:testState = $State }
      Mock Set-MegaDeskOperationState { }
      Mock Stop-MegaDeskManagedProcess { throw 'CRITICO: Stop-MegaDeskManagedProcess nao pode ser chamado se launch preflight falhar' }
      Mock Start-MegaDeskNode { throw 'Start-MegaDeskNode nao deve ser alcancado' }

      { Invoke-MegaDeskReleaseSwitch -CandidateRelease $candidate -PreviousRelease $active -PublicChecks $checks -TestMode } | Should Throw 'Preflight de launch da candidate recusado'
      Assert-MockCalled Stop-MegaDeskManagedProcess -Times 0 -Exactly -Scope It
      Assert-MockCalled Start-MegaDeskNode -Times 0 -Exactly -Scope It
    }
  }

  It 'Caso C: Git preflight rejects operations on dirty worktrees' {
    InModuleScope $moduleName {
      $worktree = $global:MegaDeskTestWorktree

      Mock Invoke-MegaDeskGit {
        param($Arguments)
        if ($Arguments -contains '--show-toplevel') { return @($worktree) }
        if ($Arguments -contains 'fetch') { return @() }
        if ($Arguments -contains '--show-current') { return @('release/updater-v2-bootstrap') }
        if ($Arguments -contains '@{u}') { return @('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') }
        if ($Arguments -contains 'HEAD') { return @('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') }
        if ($Arguments -contains '--porcelain=v1') { return @(' M dirty_file.ts') }
        if ($Arguments -contains 'rev-list') { return @('0 0') }
        return @()
      }
      { Assert-MegaDeskGitPreflight -ExpectedBranch 'release/updater-v2-bootstrap' } | Should Throw 'Worktree, staging ou arquivos untracked detectados; atualizacao recusada.'
    }
  }

  It 'Caso D: rejects incomplete candidate release before stopping active runtime' {
    InModuleScope $moduleName {
      $runtime = $global:MegaDeskTestRuntimeRoot
      $worktree = $global:MegaDeskTestWorktree
      $configRoot = $global:MegaDeskTestConfigRoot
      $testPort = $global:MegaDeskTestPort
      $checks = $global:MegaDeskTestChecks

      Set-MegaDeskAutomationPaths -RuntimeRoot $runtime -ProjectRoot $worktree -Port $testPort -RuntimeConfigRoot $configRoot
      $activeSha = '4444444444444444444444444444444444444444'
      $candidateSha = '5555555555555555555555555555555555555555'
      $brokenCandidatePath = Join-Path $script:ReleaseRoot $candidateSha
      New-Item -ItemType Directory -Path $brokenCandidatePath -Force | Out-Null
      $candidate = [pscustomobject]@{ sha = $candidateSha; path = $brokenCandidatePath }
      $active = [pscustomobject]@{ sha = $activeSha; path = (Join-Path $script:ReleaseRoot $activeSha) }

      Mock Get-MegaDeskState {
        [pscustomobject]@{
          schemaVersion = 2
          node = [pscustomobject]@{ pid = 88888; releaseSha = $activeSha }
          cloudflared = $null
          activeRelease = [pscustomobject]@{ sha = $activeSha; path = $active.path; activatedAt = '2026-01-01T00:00:00.000Z' }
          previousRelease = $null
          operation = [pscustomobject]@{ status = 'READY'; kind = 'UPDATE'; candidateSha = $candidateSha; switchAttempted = $false }
        }
      }
      Mock Stop-MegaDeskManagedProcess { throw 'CRITICO: Stop-MegaDeskManagedProcess chamado para candidate incompleta' }

      { Invoke-MegaDeskReleaseSwitch -CandidateRelease $candidate -PreviousRelease $active -PublicChecks $checks -TestMode } | Should Throw 'Preflight de launch da candidate recusado'
      Assert-MockCalled Stop-MegaDeskManagedProcess -Times 0 -Exactly -Scope It
    }
  }

  It 'Caso E: rollback resolves canonical runtime config without depending on calling worktree' {
    InModuleScope $moduleName {
      $runtime = $global:MegaDeskTestRuntimeRoot
      $worktree = $global:MegaDeskTestWorktree
      $configRoot = $global:MegaDeskTestConfigRoot
      $testPort = $global:MegaDeskTestPort

      Set-MegaDeskAutomationPaths -RuntimeRoot $runtime -ProjectRoot $worktree -Port $testPort -RuntimeConfigRoot $configRoot
      $prevSha = '6666666666666666666666666666666666666666'
      $prevPath = New-BootstrapReleaseRuntimeFixture -ReleaseRoot $script:ReleaseRoot -Sha $prevSha
      $prevRelease = [pscustomobject]@{ sha = $prevSha; path = $prevPath }

      $resolved = Resolve-MegaDeskRuntimeConfigRoot -RequireEnvFile
      $resolved | Should Be (ConvertTo-MegaDeskCanonicalPath $configRoot)
      (Test-Path -LiteralPath (Join-Path $resolved '.env.local') -PathType Leaf) | Should Be $true
      (Test-Path -LiteralPath (Join-Path $worktree '.env.local')) | Should Be $false
    }
  }

  It 'Adversarial 1 & 2: primary worktree (relative .git) and secondary worktree (absolute path) resolve to same canonical config' {
    InModuleScope $moduleName {
      $runtime = $global:MegaDeskTestRuntimeRoot
      $configRoot = $global:MegaDeskTestConfigRoot
      $secWorktree = Join-Path $global:MegaDeskTestRuntimeRoot 'sec-worktree'
      New-Item -ItemType Directory -Path $secWorktree -Force | Out-Null

      $primaryGitDir = Join-Path $configRoot '.git'
      New-Item -ItemType Directory -Path $primaryGitDir -Force | Out-Null

      # Primary worktree test:
      Set-MegaDeskAutomationPaths -RuntimeRoot $runtime -ProjectRoot $configRoot -Port 32178 -RuntimeConfigRoot ''
      $script:RuntimeConfigRoot = $null
      Mock Invoke-MegaDeskGit {
        param($Arguments)
        if ($Arguments -contains '--git-common-dir') { return @('.git') }
        return @()
      }
      $resPrimary = Resolve-MegaDeskRuntimeConfigRoot -RequireEnvFile
      $resPrimary | Should Be (ConvertTo-MegaDeskCanonicalPath $configRoot)

      # Secondary worktree test:
      Set-MegaDeskAutomationPaths -RuntimeRoot $runtime -ProjectRoot $secWorktree -Port 32178 -RuntimeConfigRoot ''
      $script:RuntimeConfigRoot = $null
      Mock Invoke-MegaDeskGit {
        param($Arguments)
        if ($Arguments -contains '--git-common-dir') { return @($primaryGitDir) }
        return @()
      }
      $resSecondary = Resolve-MegaDeskRuntimeConfigRoot -RequireEnvFile
      $resSecondary | Should Be (ConvertTo-MegaDeskCanonicalPath $configRoot)
    }
  }

  It 'Adversarial 3: legacy state without environmentPath or projectRoot safely falls through' {
    InModuleScope $moduleName {
      $runtime = $global:MegaDeskTestRuntimeRoot
      $worktree = $global:MegaDeskTestWorktree
      $configRoot = $global:MegaDeskTestConfigRoot

      Set-MegaDeskAutomationPaths -RuntimeRoot $runtime -ProjectRoot $configRoot -Port 32179 -RuntimeConfigRoot ''
      $script:RuntimeConfigRoot = $null

      # Legacy state with only PID and executablePath
      Mock Get-MegaDeskState {
        [pscustomobject]@{
          schemaVersion = 1
          node = [pscustomobject]@{ pid = 12345; executablePath = 'C:\node.exe' }
          cloudflared = $null
          activeRelease = $null
        }
      }
      Mock Invoke-MegaDeskGit { return @() }

      $res = Resolve-MegaDeskRuntimeConfigRoot -RequireEnvFile
      $res | Should Be (ConvertTo-MegaDeskCanonicalPath $configRoot)
    }
  }

  It 'Adversarial 4 & 5: non-existent or invalid runtime-config.json safely ignored' {
    InModuleScope $moduleName {
      $runtime = $global:MegaDeskTestRuntimeRoot
      $configRoot = $global:MegaDeskTestConfigRoot
      Set-MegaDeskAutomationPaths -RuntimeRoot $runtime -ProjectRoot $configRoot -Port 32180 -RuntimeConfigRoot ''
      $script:RuntimeConfigRoot = $null

      # 4: Non-existent runtime-config.json
      $cfgFile = Get-MegaDeskRuntimeConfigFile
      if (Test-Path -LiteralPath $cfgFile) { Remove-Item -LiteralPath $cfgFile -Force }
      Mock Invoke-MegaDeskGit { return @() }
      Mock Get-MegaDeskState { [pscustomobject]@{ node = $null } }
      $res4 = Resolve-MegaDeskRuntimeConfigRoot -RequireEnvFile
      $res4 | Should Be (ConvertTo-MegaDeskCanonicalPath $configRoot)

      # 5: Invalid/corrupt runtime-config.json
      Set-Content -LiteralPath $cfgFile -Value 'CORRUPT_NOT_JSON{{{' -Encoding UTF8
      $res5 = Resolve-MegaDeskRuntimeConfigRoot -RequireEnvFile
      $res5 | Should Be (ConvertTo-MegaDeskCanonicalPath $configRoot)
    }
  }

  It 'Adversarial 6: invalid MEGADESK_RUNTIME_CONFIG_ROOT environment variable safely ignored' {
    InModuleScope $moduleName {
      $runtime = $global:MegaDeskTestRuntimeRoot
      $configRoot = $global:MegaDeskTestConfigRoot
      Set-MegaDeskAutomationPaths -RuntimeRoot $runtime -ProjectRoot $configRoot -Port 32181 -RuntimeConfigRoot ''
      $script:RuntimeConfigRoot = $null
      Mock Invoke-MegaDeskGit { return @() }
      Mock Get-MegaDeskState { [pscustomobject]@{ node = $null } }

      $env:MEGADESK_RUNTIME_CONFIG_ROOT = Join-Path $runtime 'non-existent-folder-xyz'
      $res = Resolve-MegaDeskRuntimeConfigRoot -RequireEnvFile
      $res | Should Be (ConvertTo-MegaDeskCanonicalPath $configRoot)
      $env:MEGADESK_RUNTIME_CONFIG_ROOT = $null
    }
  }

  It 'Adversarial 7 & 8: unreadable or missing .env.local fails launch preflight safely' {
    InModuleScope $moduleName {
      $runtime = $global:MegaDeskTestRuntimeRoot
      $candidateSha = '7777777777777777777777777777777777777777'
      $candidatePath = New-BootstrapReleaseRuntimeFixture -ReleaseRoot $script:ReleaseRoot -Sha $candidateSha
      $candidate = [pscustomobject]@{ sha = $candidateSha; path = $candidatePath }

      # Missing .env.local
      $missingDir = Join-Path $runtime 'missing-env'
      New-Item -ItemType Directory -Path $missingDir -Force | Out-Null
      Set-MegaDeskAutomationPaths -RuntimeRoot $runtime -ProjectRoot $missingDir -Port 32182 -RuntimeConfigRoot $missingDir
      { Assert-MegaDeskCandidateLaunchReadiness -CandidateRelease $candidate -Port 32182 } | Should Throw 'Preflight de launch da candidate recusado'
    }
  }

  It 'Adversarial 9, 10, 11: candidate missing release.json, dist/index.js, or node_modules fails preflight' {
    InModuleScope $moduleName {
      $runtime = $global:MegaDeskTestRuntimeRoot
      $configRoot = $global:MegaDeskTestConfigRoot
      Set-MegaDeskAutomationPaths -RuntimeRoot $runtime -ProjectRoot $configRoot -Port 32183 -RuntimeConfigRoot $configRoot

      # 9: missing release.json
      $sha9 = '8888888888888888888888888888888888888888'
      $p9 = New-BootstrapReleaseRuntimeFixture -ReleaseRoot $script:ReleaseRoot -Sha $sha9
      Remove-Item -LiteralPath (Join-Path $p9 'release.json') -Force
      { Assert-MegaDeskCandidateLaunchReadiness -CandidateRelease ([pscustomobject]@{ sha = $sha9; path = $p9 }) -Port 32183 } | Should Throw 'release.json ausente'

      # 10: missing dist/index.js
      $sha10 = '9999999999999999999999999999999999999999'
      $p10 = New-BootstrapReleaseRuntimeFixture -ReleaseRoot $script:ReleaseRoot -Sha $sha10
      Remove-Item -LiteralPath (Join-Path $p10 'dist\index.js') -Force
      { Assert-MegaDeskCandidateLaunchReadiness -CandidateRelease ([pscustomobject]@{ sha = $sha10; path = $p10 }) -Port 32183 } | Should Throw 'dist\index.js ausente'

      # 11: missing node_modules
      $sha11 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      $p11 = New-BootstrapReleaseRuntimeFixture -ReleaseRoot $script:ReleaseRoot -Sha $sha11
      Remove-Item -LiteralPath (Join-Path $p11 'node_modules') -Recurse -Force
      { Assert-MegaDeskCandidateLaunchReadiness -CandidateRelease ([pscustomobject]@{ sha = $sha11; path = $p11 }) -Port 32183 } | Should Throw 'node_modules ausentes'
    }
  }

  It 'Adversarial 12: launch preflight failures never terminate running node process' {
    InModuleScope $moduleName {
      $runtime = $global:MegaDeskTestRuntimeRoot
      $configRoot = $global:MegaDeskTestConfigRoot
      Set-MegaDeskAutomationPaths -RuntimeRoot $runtime -ProjectRoot $configRoot -Port 32184 -RuntimeConfigRoot $configRoot

      $activeSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      $active = [pscustomobject]@{ sha = $activeSha; path = (Join-Path $script:ReleaseRoot $activeSha) }
      $brokenCandidate = [pscustomobject]@{ sha = 'cccccccccccccccccccccccccccccccccccccccc'; path = 'C:\invalid\path' }

      Mock Get-MegaDeskState {
        [pscustomobject]@{
          schemaVersion = 2
          node = [pscustomobject]@{ pid = 77777; releaseSha = $activeSha }
          cloudflared = $null
          activeRelease = [pscustomobject]@{ sha = $activeSha; path = $active.path; activatedAt = '2026-01-01T00:00:00.000Z' }
          previousRelease = $null
          operation = [pscustomobject]@{ status = 'READY'; kind = 'UPDATE'; candidateSha = 'cccccccccccccccccccccccccccccccccccccccc'; switchAttempted = $false }
        }
      }
      Mock Stop-MegaDeskManagedProcess { throw 'FATAL: Stop-MegaDeskManagedProcess invoked on candidate failure!' }
      Mock Set-MegaDeskOperationState { param($Status) if ($Status -eq 'SWITCHING') { throw 'FATAL: switched state prematurely!' } }

      { Invoke-MegaDeskReleaseSwitch -CandidateRelease $brokenCandidate -PreviousRelease $active -PublicChecks @() -TestMode } | Should Throw
      Assert-MockCalled Stop-MegaDeskManagedProcess -Times 0 -Exactly -Scope It
    }
  }

  It 'Adversarial 13: rollback uses canonical runtime config root and preserves active configuration' {
    InModuleScope $moduleName {
      $runtime = $global:MegaDeskTestRuntimeRoot
      $worktree = $global:MegaDeskTestWorktree
      $configRoot = $global:MegaDeskTestConfigRoot
      Set-MegaDeskAutomationPaths -RuntimeRoot $runtime -ProjectRoot $worktree -Port 32185 -RuntimeConfigRoot $configRoot

      $prevSha = 'dddddddddddddddddddddddddddddddddddddddd'
      $prevPath = New-BootstrapReleaseRuntimeFixture -ReleaseRoot $script:ReleaseRoot -Sha $prevSha
      $prevRelease = [pscustomobject]@{ sha = $prevSha; path = $prevPath }

      $res = Resolve-MegaDeskRuntimeConfigRoot -RequireEnvFile
      $res | Should Be (ConvertTo-MegaDeskCanonicalPath $configRoot)
      $envFile = Join-Path $res '.env.local'
      (Test-Path -LiteralPath $envFile -PathType Leaf) | Should Be $true
      # Ensure worktree does not have .env.local
      (Test-Path -LiteralPath (Join-Path $worktree '.env.local')) | Should Be $false
    }
  }

  It 'Adversarial 14: resolution and preflight validate access without reading or leaking secret content' {
    InModuleScope $moduleName {
      $runtime = $global:MegaDeskTestRuntimeRoot
      $configRoot = $global:MegaDeskTestConfigRoot
      Set-MegaDeskAutomationPaths -RuntimeRoot $runtime -ProjectRoot $configRoot -Port 32186 -RuntimeConfigRoot $configRoot

      $candidateSha = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
      $candidatePath = New-BootstrapReleaseRuntimeFixture -ReleaseRoot $script:ReleaseRoot -Sha $candidateSha
      $candidate = [pscustomobject]@{ sha = $candidateSha; path = $candidatePath }

      # Set synthetic secret
      $secretToken = 'SUPER_SECRET_TOKEN_DO_NOT_LEAK_98765'
      Set-Content -LiteralPath (Join-Path $configRoot '.env.local') -Value ("APP_SECRET={0}" -f $secretToken) -Encoding UTF8

      $preflight = Assert-MegaDeskCandidateLaunchReadiness -CandidateRelease $candidate -Port 32186
      # Validate that the secret string was never captured in the returned object or any property
      $objStr = $preflight | Out-String
      $objStr.Contains($secretToken) | Should Be $false
      # Also test JSON serialization of returned object
      $jsonStr = $preflight | ConvertTo-Json -Depth 5
      $jsonStr.Contains($secretToken) | Should Be $false
    }
  }
}
