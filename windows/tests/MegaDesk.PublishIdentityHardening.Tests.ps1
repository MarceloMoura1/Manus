$modulePath = Join-Path $PSScriptRoot '..\MegaDesk.Automation.psm1'
Import-Module $modulePath -Force
$moduleName = 'MegaDesk.Automation'

Describe 'MegaDesk publish identity and deterministic recovery' {
  BeforeEach {
    $global:HardeningActiveSha = '1111111111111111111111111111111111111111'
    $global:HardeningCandidateSha = '2222222222222222222222222222222222222222'
  }

  It 'recovers FAILED with absent ACTIVE and a free port without promoting candidate' {
    InModuleScope $moduleName {
      $active = [pscustomobject]@{ sha = $global:HardeningActiveSha; path = 'C:\isolated\active'; activatedAt = '2026-01-01T00:00:00Z' }
      $script:hardeningState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $active; previousRelease = $null; operation = [pscustomobject]@{ kind = 'UPDATE'; status = 'FAILED'; candidateSha = $global:HardeningCandidateSha; switchAttempted = $true; operationId = ('a' * 32); phase = 'OLD_RUNTIME_STOPPED' } }
      Mock Invoke-WithMegaDeskLifecycleLock { param($ScriptBlock) & $ScriptBlock }
      Mock Get-MegaDeskState { $script:hardeningState }
      Mock Assert-MegaDeskActiveRelease { $active }
      Mock Get-MegaDeskManagedProcessStatus { 'ABSENT' }
      Mock Get-MegaDeskPortOwnership { [pscustomobject]@{ status = 'FREE' } }
      Mock Update-MegaDeskState { param($AllowedFields, $Mutation, $Precondition) & $Mutation $script:hardeningState; $script:hardeningState }
      Mock Write-MegaDeskLog { }
      Mock Stop-MegaDeskManagedProcess { throw 'candidate must not be stopped when absent' }

      $result = Resolve-MegaDeskActiveRuntimeRecovery

      $result.status | Should Be 'RECOVERED_ACTIVE_AUTHORITY'
      $result.nodeAction | Should Be 'ACTIVE_START_REQUIRED'
      $script:hardeningState.operation.status | Should Be 'ACTIVE'
      $script:hardeningState.operation.candidateSha | Should Be $global:HardeningActiveSha
      $script:hardeningState.activeRelease.sha | Should Be $global:HardeningActiveSha
      Assert-MockCalled Stop-MegaDeskManagedProcess -Times 0 -Exactly -Scope It
    }
  }

  It 'normalizes FAILED around an already healthy ACTIVE without restart or duplicate' {
    InModuleScope $moduleName {
      $active = [pscustomobject]@{ sha = $global:HardeningActiveSha; path = 'C:\isolated\active'; activatedAt = '2026-01-01T00:00:00Z' }
      $script:hardeningState = [pscustomobject]@{ schemaVersion = 2; node = [pscustomobject]@{ releaseSha = $active.sha }; cloudflared = [pscustomobject]@{ pid = 20 }; activeRelease = $active; previousRelease = $null; operation = [pscustomobject]@{ kind = 'UPDATE'; status = 'FAILED'; candidateSha = $global:HardeningCandidateSha; switchAttempted = $true; operationId = ('b' * 32); phase = 'ACTIVE_RUNTIME_CLASSIFIED' } }
      Mock Invoke-WithMegaDeskLifecycleLock { param($ScriptBlock) & $ScriptBlock }
      Mock Get-MegaDeskState { $script:hardeningState }
      Mock Assert-MegaDeskActiveRelease { $active }
      Mock Get-MegaDeskManagedProcessStatus { 'VALID' }
      Mock Update-MegaDeskState { param($AllowedFields, $Mutation, $Precondition) & $Mutation $script:hardeningState; $script:hardeningState }
      Mock Write-MegaDeskLog { }
      Mock Stop-MegaDeskManagedProcess { throw 'healthy ACTIVE must be preserved' }

      $result = Resolve-MegaDeskActiveRuntimeRecovery

      $result.nodeAction | Should Be 'PRESERVE_ACTIVE'
      $result.tunnelAction | Should Be 'PRESERVE_VALID'
      $script:hardeningState.operation.status | Should Be 'ACTIVE'
      Assert-MockCalled Stop-MegaDeskManagedProcess -Times 0 -Exactly -Scope It
    }
  }

  It 'stops only a strongly identified candidate and restores ACTIVE authority' {
    InModuleScope $moduleName {
      $active = [pscustomobject]@{ sha = $global:HardeningActiveSha; path = 'C:\isolated\active'; activatedAt = '2026-01-01T00:00:00Z' }
      $script:hardeningState = [pscustomobject]@{ schemaVersion = 2; node = [pscustomobject]@{ releaseSha = $global:HardeningCandidateSha }; cloudflared = $null; activeRelease = $active; previousRelease = $null; operation = [pscustomobject]@{ kind = 'UPDATE'; status = 'SWITCHING'; candidateSha = $global:HardeningCandidateSha; switchAttempted = $true; operationId = ('c' * 32); phase = 'CANDIDATE_HEALTH_PASSED' } }
      Mock Invoke-WithMegaDeskLifecycleLock { param($ScriptBlock) & $ScriptBlock }
      Mock Get-MegaDeskState { $script:hardeningState }
      Mock Assert-MegaDeskActiveRelease { $active }
      Mock Get-MegaDeskManagedProcessStatus { param($Record, $Kind) if ($Kind -eq 'node') { 'VALID' } else { 'ABSENT' } }
      Mock Stop-MegaDeskManagedProcess { param($Kind, $StopReason) $script:hardeningState.node = $null }
      Mock Get-MegaDeskPortOwnership { [pscustomobject]@{ status = 'FREE' } }
      Mock Update-MegaDeskState { param($AllowedFields, $Mutation, $Precondition) & $Mutation $script:hardeningState; $script:hardeningState }
      Mock Write-MegaDeskLog { }

      $result = Resolve-MegaDeskActiveRuntimeRecovery

      $result.nodeAction | Should Be 'STOP_PROVEN_CANDIDATE'
      $script:hardeningState.activeRelease.sha | Should Be $global:HardeningActiveSha
      $script:hardeningState.operation.status | Should Be 'ACTIVE'
      Assert-MockCalled Stop-MegaDeskManagedProcess -ParameterFilter { $Kind -eq 'node' -and $StopReason -eq 'RECOVERY_ABORT_CANDIDATE' } -Times 1 -Exactly -Scope It
    }
  }

  It 'fails closed when an unregistered runtime port has an unknown owner' {
    InModuleScope $moduleName {
      $active = [pscustomobject]@{ sha = $global:HardeningActiveSha; path = 'C:\isolated\active' }
      $script:hardeningState = [pscustomobject]@{ schemaVersion = 2; node = $null; cloudflared = $null; activeRelease = $active; previousRelease = $null; operation = [pscustomobject]@{ kind = 'UPDATE'; status = 'FAILED'; candidateSha = $global:HardeningCandidateSha; switchAttempted = $true } }
      Mock Invoke-WithMegaDeskLifecycleLock { param($ScriptBlock) & $ScriptBlock }
      Mock Get-MegaDeskState { $script:hardeningState }
      Mock Assert-MegaDeskActiveRelease { $active }
      Mock Get-MegaDeskManagedProcessStatus { 'ABSENT' }
      Mock Get-MegaDeskPortOwnership { [pscustomobject]@{ status = 'OWNED_BY_EXTERNAL_PROCESS' } }
      Mock Update-MegaDeskState { throw 'state must not change' }
      Mock Stop-MegaDeskManagedProcess { throw 'external process must not be stopped' }
      Mock Write-MegaDeskLog { }

      { Resolve-MegaDeskActiveRuntimeRecovery } | Should Throw
      Assert-MockCalled Update-MegaDeskState -Times 0 -Exactly -Scope It
      Assert-MockCalled Stop-MegaDeskManagedProcess -Times 0 -Exactly -Scope It
    }
  }
}

Describe 'MegaDesk runtime nonce and exit telemetry contract' {
  It 'binds a new runtime record to a non-secret launch nonce' {
    InModuleScope $moduleName {
      $nonce = '0123456789abcdef0123456789abcdef'
      $launch = New-MegaDeskNodeLaunchSpec -ExecutablePath 'C:\node.exe' -EnvironmentPath 'C:\synthetic\.env.local' -ScriptPath 'C:\release\dist\index.js' -RuntimeInstanceId $nonce
      $launch.runtimeInstanceId | Should Be $nonce
      $launch.arguments | Should Match ([regex]::Escape('--megadesk-runtime-id=' + $nonce))
    }
  }

  It 'emits unexpected exit telemetry without environment or secrets' {
    InModuleScope $moduleName {
      $script:telemetryPayload = $null
      Mock Write-MegaDeskNodeDiagnosticJson { param($Path, $Payload) $script:telemetryPayload = $Payload }
      Write-MegaDeskNodeExitTelemetry -Path 'C:\isolated\exit.json' -Pid 42 -InvocationId ('a' * 32) -ReleaseSha ('1' * 40) -CreationTime '2026-01-01T00:00:00.0000000Z' -ObservedExitTime '2026-01-01T00:00:03.0000000Z' -ExitCode 7 -ExitCodeAvailable $true -Classification EXITED_WITH_CODE -OperationId ('b' * 32) -RuntimeInstanceId ('c' * 32)
      $script:telemetryPayload.event | Should Be 'NODE_EXITED'
      $script:telemetryPayload.expected | Should Be $false
      $script:telemetryPayload.reason | Should Be 'UNEXPECTED_EXIT'
      $script:telemetryPayload.uptimeSeconds | Should Be 3
      (($script:telemetryPayload | ConvertTo-Json -Depth 5) -match '(?i)environment|password|token|secret') | Should Be $false
    }
  }

  It 'confirms official stop telemetry only after terminating the validated Node handle' {
    InModuleScope $moduleName {
      $record = [pscustomobject]@{ pid = 42; releaseSha = ('1' * 40); operationId = ('b' * 32); runtimeInstanceId = ('c' * 32); stopIntentPath = 'C:\isolated\stop.json' }
      $script:stopOrder = @()
      Mock Get-MegaDeskDestructiveProcessTarget { [pscustomobject]@{ status = 'PRESENT'; processHandle = [pscustomobject]@{} } }
      Mock Write-MegaDeskNodeStopIntent { param($Record, $Reason) $script:stopOrder += ('intent-' + $Reason); $true }
      Mock Stop-MegaDeskValidatedProcessHandle { $script:stopOrder += 'stop' }
      Mock Write-MegaDeskNodeStopConfirmation { param($Record, $Reason) $script:stopOrder += ('confirmation-' + $Reason); $true }
      Stop-MegaDeskExactManagedProcess -Record $record -Kind node -AllowStaticIdentity -StopReason PUBLISH_SWITCH
      $script:stopOrder | Should Be @('intent-PUBLISH_SWITCH', 'stop', 'confirmation-PUBLISH_SWITCH')
    }
  }

  It 'does not confirm official stop telemetry when validated termination fails' {
    InModuleScope $moduleName {
      $record = [pscustomobject]@{ pid = 42; releaseSha = ('1' * 40); operationId = ('b' * 32); runtimeInstanceId = ('c' * 32); stopIntentPath = 'C:\isolated\stop.json' }
      Mock Get-MegaDeskDestructiveProcessTarget { [pscustomobject]@{ status = 'PRESENT'; processHandle = [pscustomobject]@{} } }
      Mock Write-MegaDeskNodeStopIntent { $true }
      Mock Stop-MegaDeskValidatedProcessHandle { throw 'synthetic stop failure' }
      Mock Write-MegaDeskNodeStopConfirmation { $true }

      { Stop-MegaDeskExactManagedProcess -Record $record -Kind node -AllowStaticIdentity -StopReason PUBLISH_SWITCH } | Should Throw
      Assert-MockCalled Write-MegaDeskNodeStopConfirmation -Times 0 -Exactly -Scope It
    }
  }

  It 'requires matching immutable confirmation before attributing an exit to official stop' {
    $global:HardeningTelemetryRoot = Join-Path $TestDrive ('telemetry-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $global:HardeningTelemetryRoot | Out-Null
    InModuleScope $moduleName {
      $intentPath = Join-Path $global:HardeningTelemetryRoot 'stop-intent.json'
      $request = [pscustomobject]@{ pid = 42; releaseSha = ('1' * 40); operationId = ('b' * 32); runtimeInstanceId = ('c' * 32); stopIntentPath = $intentPath }
      [ordered]@{ schemaVersion = 1; event = 'NODE_OFFICIAL_STOP_INTENT'; pid = 42; releaseSha = ('1' * 40); operationId = ('b' * 32); runtimeInstanceId = ('c' * 32); reason = 'PUBLISH_SWITCH'; requestedAt = '2026-01-01T00:00:00Z' } |
        ConvertTo-Json | Set-Content -LiteralPath $intentPath -Encoding UTF8

      $withoutConfirmation = Test-MegaDeskNodeStopEvidence -Request $request -DiagnosticsRoot $global:HardeningTelemetryRoot -ConfirmationWaitMilliseconds 0
      $withoutConfirmation.expected | Should Be $false
      $withoutConfirmation.reason | Should Be 'UNEXPECTED_EXIT'

      [ordered]@{ schemaVersion = 1; event = 'NODE_OFFICIAL_STOP_CONFIRMED'; pid = 42; releaseSha = ('1' * 40); operationId = ('b' * 32); runtimeInstanceId = ('c' * 32); reason = 'PUBLISH_SWITCH'; confirmedAt = '2026-01-01T00:00:01Z' } |
        ConvertTo-Json | Set-Content -LiteralPath ($intentPath + '.confirmed.json') -Encoding UTF8
      $withConfirmation = Test-MegaDeskNodeStopEvidence -Request $request -DiagnosticsRoot $global:HardeningTelemetryRoot -ConfirmationWaitMilliseconds 0
      $withConfirmation.expected | Should Be $true
      $withConfirmation.reason | Should Be 'PUBLISH_SWITCH'
    }
  }
}

Describe 'MegaDesk switch ordering and crash-safe state contract' {
  It 'classifies the ACTIVE runtime before persisting the destructive SWITCHING marker' {
    InModuleScope $moduleName {
      $source = Get-Content -LiteralPath (Get-Module 'MegaDesk.Automation').Path -Raw
      $body = [regex]::Match($source, 'function Invoke-MegaDeskReleaseSwitch \{.*?(?=function Resolve-MegaDeskCommitSha)', [Text.RegularExpressions.RegexOptions]::Singleline).Value
      $body.IndexOf('Resolve-MegaDeskReleaseSwitchNodeStatus') | Should BeLessThan $body.IndexOf("Set-MegaDeskOperationState -Status 'SWITCHING'")
      $body.IndexOf("Set-MegaDeskOperationPhase -Phase OLD_RUNTIME_STOPPED") | Should BeLessThan $body.IndexOf('Start-MegaDeskNode -AuthorizationMode UPDATE_CANDIDATE')
      $body.IndexOf("Set-MegaDeskOperationPhase -Phase CANDIDATE_HEALTH_PASSED") | Should BeLessThan $body.IndexOf("New-MegaDeskOperationRecord -Status 'ACTIVE'")
    }
  }

  It 'keeps atomic state replacement and lifecycle lock guards in the mutation path' {
    InModuleScope $moduleName {
      $source = Get-Content -LiteralPath (Get-Module 'MegaDesk.Automation').Path -Raw
      $save = [regex]::Match($source, 'function Save-MegaDeskState \{.*?(?=function ConvertTo-MegaDeskStateComparisonJson)', [Text.RegularExpressions.RegexOptions]::Singleline).Value
      $save | Should Match 'Flush\(\$true\)'
      $save | Should Match '\[System\.IO\.File\]::Replace'
      $source | Should Match 'Global\\MegaDesk\.UpdaterV2\.Lifecycle'
    }
  }
}
