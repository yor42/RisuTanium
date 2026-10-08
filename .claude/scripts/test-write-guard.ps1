#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$fixture = Join-Path $env:TEMP ('risu-write-guard-' + [guid]::NewGuid().ToString('N'))
$repo = Join-Path $fixture 'repository'
$scripts = Join-Path $repo '.claude/scripts'
[IO.Directory]::CreateDirectory($scripts) | Out-Null
[IO.Directory]::CreateDirectory((Join-Path $repo '.git')) | Out-Null
foreach ($name in @('write-guard-common.ps1', 'guard-write.ps1', 'register-write-scope.ps1', 'subagent-identity.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $scripts $name)
}
. (Join-Path $scripts 'write-guard-common.ps1')
$pwshPath = (Get-Command pwsh).Source
$guard = Join-Path $scripts 'guard-write.ps1'
$register = Join-Path $scripts 'register-write-scope.ps1'
$session = 'fixture-session'; $agent = 'fixture-agent'; $role = 'sonnet-coder'
$target = Join-Path $repo 'src/example.ts'
[IO.Directory]::CreateDirectory((Split-Path $target)) | Out-Null
$sentinel = 'PRIVATE_CONTENT_SENTINEL_DO_NOT_EMIT'
$passed = 0; $skipped = 0
function Invoke-FixtureProcess([string]$Script, [string[]]$Arguments = @(), [string]$InputText = '') {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $pwshPath; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    foreach ($arg in @('-NoProfile', '-File', $Script) + $Arguments) { $start.ArgumentList.Add($arg) }
    $process = [Diagnostics.Process]::Start($start)
    $process.StandardInput.Write($InputText); $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEnd(); $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    $result = @{ ExitCode = $process.ExitCode; Stdout = $stdout; Stderr = $stderr }
    $process.Dispose()
    return $result
}
function New-FixturePayload([string]$Path = $target) {
    return @{ session_id = $session; hook_event_name = 'PreToolUse'; tool_name = 'Write'; agent_id = $agent; agent_type = $role; tool_input = @{ file_path = $Path; content = $sentinel } }
}
function New-FixtureMain([string]$Path = $target) {
    $payload = New-FixturePayload $Path
    $payload.Remove('agent_id'); $payload.Remove('agent_type')
    return $payload
}
function Test-FixtureHook([string]$Name, [object]$Payload, [int]$Expected = 2, [string]$Script = $guard) {
    $inputText = if ($Payload -is [string]) { $Payload } else { $Payload | ConvertTo-Json -Depth 10 -Compress }
    $result = Invoke-FixtureProcess $Script -InputText $inputText
    if ($result.ExitCode -ne $Expected) { throw "$Name expected exit $Expected, got $($result.ExitCode): $($result.Stderr)" }
    if ($result.Stdout -or ($Expected -eq 2 -and -not $result.Stderr) -or ($Expected -eq 0 -and $result.Stderr)) { throw "$Name produced an unexpected output shape." }
    if (($result.Stdout + $result.Stderr).Contains($sentinel)) { throw "$Name leaked tool content." }
    $script:passed++
}
function Register-Fixture([string]$Path = $target, [string]$Role = $role, [string]$AgentId = $agent, [switch]$Revoke) {
    $args = @('-SessionId', $session, '-AgentId', $AgentId, '-Role', $Role)
    if ($Revoke) { $args += '-Revoke' } else { $args += @('-Files', $Path) }
    $result = Invoke-FixtureProcess $register $args
    if ($result.ExitCode -ne 0) { throw "Fixture registration failed: $($result.Stderr)" }
}
function Test-FixtureRegistrationDenial([string]$Name, [string]$Path, [string]$Role = $role) {
    $result = Invoke-FixtureProcess $register @('-SessionId', $session, '-AgentId', $agent, '-Role', $Role, '-Files', $Path)
    if ($result.ExitCode -eq 0) { throw "$Name incorrectly registered a forbidden target." }
    $script:passed++
}
Register-Fixture
$manifestPath = Get-GuardManifestPath $session $agent $role
$originalManifest = [IO.File]::ReadAllBytes($manifestPath)
Test-FixtureHook 'exact Write' (New-FixturePayload) 0
$payload = New-FixturePayload; $payload.tool_name = 'Edit'; Test-FixtureHook 'exact Edit' $payload 0
Test-FixtureHook 'case and separators' (New-FixturePayload $target.ToUpperInvariant().Replace('\', '/')) 0
$payload = New-FixturePayload; $payload.agent_id = 'other-agent'; Test-FixtureHook 'same role wrong instance' $payload
$payload = New-FixturePayload; $payload.session_id = 'other-session'; Test-FixtureHook 'wrong session' $payload
Test-FixtureHook 'sibling target' (New-FixturePayload (Join-Path $repo 'src/sibling.ts'))
Test-FixtureHook 'prefix target' (New-FixturePayload ($target + '.extra'))
Test-FixtureHook 'directory target' (New-FixturePayload (Split-Path $target))
Register-Fixture -Revoke; Test-FixtureHook 'revoked instance' (New-FixturePayload)
$amended = Join-Path $repo 'src/amended.ts'; Register-Fixture $amended
Test-FixtureHook 'old target after amendment' (New-FixturePayload)
Test-FixtureHook 'resumed same instance amended target' (New-FixturePayload $amended) 0
Register-Fixture
$payload = New-FixturePayload; $payload.Remove('agent_id'); $payload.Remove('agent_type'); Test-FixtureHook 'ordinary main absent identities' $payload 0
foreach ($key in @('agent_id', 'agent_type')) {
    foreach ($invalid in @($null, '', 42, @('wrong-shape'))) {
        $payload = New-FixturePayload; $payload[$key] = $invalid; Test-FixtureHook "invalid $key" $payload
    }
}
$payload = New-FixturePayload; $payload.Remove('agent_type'); Test-FixtureHook 'agent ID without role' $payload
$payload = New-FixturePayload; $payload.Remove('agent_id'); Test-FixtureHook 'named main needs own grant' $payload
Register-Fixture -AgentId 'main'; Test-FixtureHook 'named main exact grant' $payload 0
$payload.agent_type = 'unknown-role'; Test-FixtureHook 'unknown named main' $payload
foreach ($key in @('session_id', 'hook_event_name', 'tool_name', 'tool_input')) {
    $payload = New-FixturePayload; $payload.Remove($key); Test-FixtureHook "missing $key" $payload
}
$payload = New-FixturePayload; $payload.Remove('agent_id'); $payload.Remove('agent_type'); $payload.tool_input.file_path = ''; Test-FixtureHook 'main malformed path still denied' $payload
Test-FixtureHook 'invalid JSON with content sentinel' ('{"tool_input":{"content":"' + $sentinel + '"},')
$registeredJson = (New-FixturePayload) | ConvertTo-Json -Depth 10 -Compress
$duplicatePayload = $registeredJson.Replace('"agent_id":"fixture-agent"', '"agent_id":"fixture-agent","agent_id":"fixture-agent"')
if ($duplicatePayload -ceq $registeredJson) { throw 'Duplicate-key fixture did not insert its intended defect.' }
Test-FixtureHook 'otherwise-valid registered duplicate identity JSON' $duplicatePayload
foreach ($key in @('hook_event_name', 'tool_name')) {
    $payload = New-FixtureMain
    $payload[$key] = @($payload[$key])
    Test-FixtureHook "main one-element array $key" $payload
}
foreach ($path in @((Join-Path $repo '../escape.ts'), ($target + ':stream'), (Join-Path $repo 'src/*.ts'),
    (Join-Path $repo 'src/CON.txt'), (Join-Path $repo 'src/COM1.ts'), (Join-Path $repo 'src/COM¹.ts'),
    (Join-Path $repo 'src/LPT².ts'), (Join-Path $repo 'src/LPT³.ts'), (Join-Path $repo 'src/CONIN$.txt'), (Join-Path $repo 'src/CONOUT$.txt'),
    (Join-Path $repo 'src/trailing.'), (Join-Path $repo 'src/trailing '), ('\\?\' + $target), ('\\.\' + $target),
    '\\server\share\file.ts', '\??\C:\file.ts')) { Test-FixtureHook 'main invalid path namespace or component' (New-FixtureMain $path) }
foreach ($path in @($manifestPath, (Join-Path $repo 'src/lang/en.ts'), (Join-Path $repo 'src/lang/index.ts'))) {
    $deniedRole = if ($path -eq $manifestPath) { $role } else { 'translator' }
    Test-FixtureRegistrationDenial 'target bounds at registration' $path $deniedRole
}
Test-FixtureRegistrationDenial 'document writer code scope' $target 'doc-writer'
foreach ($documentRole in @('doc-writer', 'record-clerk')) {
    Test-FixtureRegistrationDenial 'external Markdown-only writer scope' (Join-Path $fixture 'draft.txt') $documentRole
}
Test-FixtureRegistrationDenial 'clerk governance scope' (Join-Path $repo 'AGENTS.md') 'record-clerk'
Test-FixtureHook 'registry self grant' (New-FixturePayload $manifestPath)
Test-FixtureHook 'git metadata' (New-FixturePayload (Join-Path $repo '.git/config'))
Test-FixtureHook 'signing secret' (New-FixturePayload (Join-Path $repo 'src-tauri/key.txt'))
$readonly = New-FixturePayload; $readonly.agent_type = 'opus-reviewer'
$readonlyManifest = Get-GuardManifestPath $session $agent 'opus-reviewer'
$forged = @{ version=1; sessionId=$session; agentId=$agent; role='opus-reviewer'; repositoryRoot=$repo; files=@($target) }
[IO.File]::WriteAllText($readonlyManifest, ($forged | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
Test-FixtureHook 'read-only repository even with forged grant' $readonly
$scratch = Join-Path $fixture 'probe.txt'; Register-Fixture $scratch -Role 'opus-reviewer'
$readonly.tool_input.file_path = $scratch; Test-FixtureHook 'exact external temporary scratch' $readonly 0
$readonly.tool_input.file_path = Join-Path $env:USERPROFILE 'outside-temp.txt'; Test-FixtureHook 'external outside TEMP' $readonly
Test-FixtureRegistrationDenial 'external outside TEMP registration' $readonly.tool_input.file_path 'opus-reviewer'
$foreign = Join-Path $fixture 'foreign-repository'; [IO.Directory]::CreateDirectory((Join-Path $foreign '.git')) | Out-Null
Test-FixtureHook 'foreign checkout' (New-FixturePayload (Join-Path $foreign 'file.ts'))
Test-FixtureRegistrationDenial 'foreign checkout registration' (Join-Path $foreign 'file.ts')
foreach ($badManifest in @('{broken-json', '{}', '[]', '{"version":1,"version":1}')) {
    [IO.File]::WriteAllText($manifestPath, $badManifest, [Text.UTF8Encoding]::new($false)); Test-FixtureHook 'malformed manifest' (New-FixturePayload)
}
[IO.File]::WriteAllBytes($manifestPath, $originalManifest)
$manifestText = [Text.Encoding]::UTF8.GetString($originalManifest)
$duplicatedManifest = $manifestText.Replace('"version": 1', '"version": 1, "version": 1')
if ($duplicatedManifest -ceq $manifestText) { throw 'Duplicate manifest fixture did not insert its intended defect.' }
[IO.File]::WriteAllText($manifestPath, $duplicatedManifest, [Text.UTF8Encoding]::new($false))
Test-FixtureHook 'otherwise-valid duplicate manifest key' (New-FixturePayload)
foreach ($mutation in @(@{Key='version'; Value='1'}, @{Key='version'; Value=$true}, @{Key='sessionId'; Value=@($session)}, @{Key='agentId'; Value=@($agent)}, @{Key='role'; Value=@($role)})) {
    $wrongType = Read-GuardObject $manifestText
    $wrongType[$mutation.Key] = $mutation.Value
    [IO.File]::WriteAllText($manifestPath, ($wrongType | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    Test-FixtureHook "otherwise-valid wrong-type manifest $($mutation.Key)" (New-FixturePayload)
}
[IO.File]::WriteAllBytes($manifestPath, $originalManifest)
$wrong = Read-GuardObject ([IO.File]::ReadAllText($manifestPath)); $wrong.agentId = 'other-agent'
[IO.File]::WriteAllText($manifestPath, ($wrong | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false)); Test-FixtureHook 'manifest identity mismatch' (New-FixturePayload)
$wrong.agentId = $agent; $wrong.repositoryRoot = $foreign
[IO.File]::WriteAllText($manifestPath, ($wrong | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false)); Test-FixtureHook 'manifest root mismatch' (New-FixturePayload)
[IO.File]::Delete($manifestPath); Test-FixtureHook 'missing manifest' (New-FixturePayload)
[IO.File]::WriteAllBytes($manifestPath, $originalManifest)
$common = Join-Path $scripts 'write-guard-common.ps1'; $disabled = $common + '.disabled'
Move-Item -LiteralPath $common -Destination $disabled
try { Test-FixtureHook 'internal missing helper exception exits two' (New-FixturePayload) }
finally { Move-Item -LiteralPath $disabled -Destination $common }

# Junctions are created only inside this temporary fixture; remove the link itself, never recursively.
$junction = Join-Path $fixture 'checkout-alias'
try { New-Item -ItemType Junction -Path $junction -Target $repo -ErrorAction Stop | Out-Null }
catch { $skipped++; Write-Output 'SKIP junction cases: creation unavailable.' }
if (Test-Path -LiteralPath $junction) {
    try {
        Test-FixtureHook 'main junction target alias' (New-FixtureMain (Join-Path $junction 'src/example.ts'))
        Test-FixtureHook 'main junction checkout root' (New-FixtureMain (Join-Path $junction 'src/example.ts')) -Script (Join-Path $junction '.claude/scripts/guard-write.ps1')
    } finally {
        if (-not [IO.Path]::GetFullPath($junction).StartsWith([IO.Path]::GetFullPath($fixture) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture cleanup path.' }
        Remove-Item -LiteralPath $junction -Force
    }
}
$startPayload = @{ session_id=$session; agent_id=$agent; agent_type=$role; hook_event_name='SubagentStart' } | ConvertTo-Json -Compress
$identity = Invoke-FixtureProcess (Join-Path $scripts 'subagent-identity.ps1') -InputText $startPayload
if ($identity.ExitCode -ne 0 -or $identity.Stderr -or (Read-GuardObject $identity.Stdout).hookSpecificOutput.additionalContext -notmatch 'fixture-agent') { throw 'Subagent identity context failed.' }
$passed++
$readerPayload = @{ session_id=$session; agent_id='reader-instance'; agent_type='code-searcher'; hook_event_name='SubagentStart' } | ConvertTo-Json -Compress
$reader = Invoke-FixtureProcess (Join-Path $scripts 'subagent-identity.ps1') -InputText $readerPayload
$readerContext = (Read-GuardObject $reader.Stdout).hookSpecificOutput.additionalContext
if ($reader.ExitCode -ne 0 -or $readerContext -notmatch 'Proceed with authorized reads' -or $readerContext -notmatch 'no registration pause' -or $readerContext -match 'wait for the parent') { throw 'Read-only identity context imposed an unnecessary registration pause.' }
$passed++
$malformedStart = @{ session_id=$session; agent_id=$agent; agent_type=$role; hook_event_name=@('SubagentStart') } | ConvertTo-Json -Compress
$startFailure = Invoke-FixtureProcess (Join-Path $scripts 'subagent-identity.ps1') -InputText $malformedStart
if ($startFailure.ExitCode -ne 0 -or $startFailure.Stdout -or -not $startFailure.Stderr) { throw 'Wrong-type SubagentStart emitted misleading identity context.' }
$passed++
Write-Output "Synthetic guard checks passed: $passed; skipped groups: $skipped."
Write-Output "Retained outside-repository fixture: $fixture"
Write-Output 'Synthetic stdin/process checks do not establish native Claude hook execution or actual Haiku pilot outcomes.'
