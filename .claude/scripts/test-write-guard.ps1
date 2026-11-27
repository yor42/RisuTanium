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
function Invoke-FixtureProcess([string]$Script, [string[]]$Arguments = @(), [string]$InputText = '', [hashtable]$Environment = @{}) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $pwshPath; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    $start.StandardInputEncoding = [Text.UTF8Encoding]::new($false)
    foreach ($name in $Environment.Keys) { $start.Environment[$name] = [string]$Environment[$name] }
    foreach ($arg in @('-NoProfile', '-File', $Script) + $Arguments) { $start.ArgumentList.Add($arg) }
    $process = [Diagnostics.Process]::Start($start)
    $process.StandardInput.Write($InputText); $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEnd(); $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    $result = @{ ExitCode = $process.ExitCode; Stdout = $stdout; Stderr = $stderr }
    $process.Dispose()
    return $result
}
function Invoke-FixtureSettingsHook([string]$EventName, [string]$InputText) {
    # Runs the hook exactly as project settings declare it, so the exit code seen here is the one Claude Code receives.
    $settings = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../settings.json')) | ConvertFrom-Json -AsHashtable
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $pwshPath; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    $start.StandardInputEncoding = [Text.UTF8Encoding]::new($false)
    $start.Environment['CLAUDE_PROJECT_DIR'] = $repo
    foreach ($arg in @('-NoProfile', '-Command', $settings.hooks[$EventName][0].hooks[0].command)) { $start.ArgumentList.Add($arg) }
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
function Test-FixtureHook([string]$Name, [object]$Payload, [int]$Expected = 2, [string]$Script = $guard, [hashtable]$Environment = @{}) {
    $inputText = if ($Payload -is [string]) { $Payload } else { $Payload | ConvertTo-Json -Depth 10 -Compress }
    $result = Invoke-FixtureProcess $Script -InputText $inputText -Environment $Environment
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
$korean = Join-Path $repo 'src/한글.md'; Register-Fixture $korean
Test-FixtureHook 'non-ASCII granted target' (New-FixturePayload $korean) 0
Test-FixtureHook 'non-ASCII sibling of a granted target' (New-FixturePayload (Join-Path $repo 'src/한국.md'))
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
function New-RolePayload([string]$Path, [string]$Role, [string]$AgentId, [string]$Tool = 'Write') {
    $rolePayload = New-FixturePayload $Path
    $rolePayload.agent_id = $AgentId; $rolePayload.agent_type = $Role; $rolePayload.tool_name = $Tool
    return $rolePayload
}
# Documentation roles: Markdown-only inside the repository, any extension for external TEMP scratch outside every repository.
$docAgent = 'doc-agent'; $clerkAgent = 'clerk-agent'
Register-Fixture (Join-Path $repo 'docs/granted.md') -Role 'doc-writer' -AgentId $docAgent
Register-Fixture (Join-Path $repo 'Agents/granted.md') -Role 'record-clerk' -AgentId $clerkAgent
$externalNotes = Join-Path $fixture 'notes.txt'
Test-FixtureHook 'granted doc-writer external non-Markdown Write' (New-RolePayload $externalNotes 'doc-writer' $docAgent) 0
Test-FixtureHook 'granted doc-writer external non-Markdown Edit' (New-RolePayload $externalNotes 'doc-writer' $docAgent 'Edit') 0
Test-FixtureHook 'granted record-clerk external non-Markdown Write' (New-RolePayload (Join-Path $fixture 'commit-msg.txt') 'record-clerk' $clerkAgent) 0
Test-FixtureHook 'granted record-clerk external non-Markdown Edit' (New-RolePayload (Join-Path $fixture 'commit-msg.txt') 'record-clerk' $clerkAgent 'Edit') 0
Test-FixtureHook 'ungranted doc-writer external non-Markdown' (New-RolePayload (Join-Path $fixture 'work-1.txt') 'doc-writer' 'ungranted-doc-agent') 0
Test-FixtureHook 'ungranted record-clerk external non-Markdown' (New-RolePayload (Join-Path $fixture 'work-1.txt') 'record-clerk' 'ungranted-clerk-agent') 0
Test-FixtureHook 'doc-writer external extensionless' (New-RolePayload (Join-Path $fixture 'commit-msg') 'doc-writer' $docAgent) 0
Test-FixtureHook 'doc-writer non-repository nested directory under TEMP' (New-RolePayload (Join-Path $fixture 'sub/dir/notes.json') 'doc-writer' $docAgent) 0
Test-FixtureHook 'doc-writer external lower-cased TEMP path' (New-RolePayload $externalNotes.ToLowerInvariant() 'doc-writer' $docAgent) 0
Test-FixtureHook 'doc-writer external Markdown' (New-RolePayload (Join-Path $fixture 'result.md') 'doc-writer' $docAgent) 0
foreach ($documentRole in @('doc-writer', 'record-clerk')) {
    Register-Fixture (Join-Path $fixture 'draft.txt') -Role $documentRole -AgentId "register-$documentRole"
    $passed++
}
Test-FixtureHook 'doc-writer repository non-Markdown beside a granted file' (New-RolePayload (Join-Path $repo 'docs/granted.txt') 'doc-writer' $docAgent)
Test-FixtureHook 'doc-writer repository non-Markdown ungranted' (New-RolePayload (Join-Path $repo 'docs/notes.txt') 'doc-writer' $docAgent)
Test-FixtureHook 'record-clerk repository non-Markdown' (New-RolePayload (Join-Path $repo 'Agents/notes.txt') 'record-clerk' $clerkAgent)
$forgedDocs = @(@{ Role='doc-writer'; Agent='forged-doc'; File=(Join-Path $repo 'src/example.ts') }, @{ Role='record-clerk'; Agent='forged-clerk'; File=(Join-Path $repo 'Agents/notes.txt') })
foreach ($forgedDoc in $forgedDocs) {
    $forgedManifest = @{ version=1; sessionId=$session; agentId=$forgedDoc.Agent; role=$forgedDoc.Role; repositoryRoot=$repo; files=@($forgedDoc.File) }
    [IO.File]::WriteAllText((Get-GuardManifestPath $session $forgedDoc.Agent $forgedDoc.Role), ($forgedManifest | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    Test-FixtureHook "forged $($forgedDoc.Role) repository non-Markdown manifest" (New-RolePayload $forgedDoc.File $forgedDoc.Role $forgedDoc.Agent)
}
Test-FixtureRegistrationDenial 'record-clerk repository non-Markdown registration' (Join-Path $repo 'Agents/notes.txt') 'record-clerk'
Test-FixtureRegistrationDenial 'case-variant repository non-Markdown registration' (Join-Path $fixture 'REPOSITORY/DOCS/NOTES.TXT') 'doc-writer'
Test-FixtureRegistrationDenial 'ignored scratch directory in the repository registration' (Join-Path $repo '.claude/scratch/notes.txt') 'doc-writer'
Test-FixtureRegistrationDenial 'directory named like Markdown registration' (Join-Path $repo 'docs/x.md/notes.txt') 'doc-writer'
Test-FixtureRegistrationDenial 'record-clerk per-PR MC record file registration' (Join-Path $repo 'Agents/mc/481.md') 'record-clerk'
Test-FixtureRegistrationDenial 'double extension ending outside Markdown registration' (Join-Path $repo 'Agents/notes.md.txt') 'record-clerk'
Register-Fixture (Join-Path $repo 'docs/NOTES.MD') -Role 'doc-writer' -AgentId 'upper-md-doc'
$passed++
Test-FixtureRegistrationDenial 'outside TEMP non-Markdown registration' (Join-Path $env:USERPROFILE 'outside-temp.txt') 'doc-writer'
$docForeign = Join-Path $fixture 'doc-foreign-repository'; [IO.Directory]::CreateDirectory((Join-Path $docForeign '.git')) | Out-Null
Test-FixtureRegistrationDenial 'foreign repository non-Markdown registration' (Join-Path $docForeign 'notes.txt') 'record-clerk'
Test-FixtureHook 'ungranted doc-writer ignored repository scratch' (New-RolePayload (Join-Path $repo '.claude/scratch/notes.txt') 'doc-writer' 'ungranted-doc-agent')
Test-FixtureHook 'granted doc-writer ungranted ignored repository Markdown scratch' (New-RolePayload (Join-Path $repo '.claude/scratch/notes.md') 'doc-writer' $docAgent)
Test-FixtureHook 'doc-writer outside TEMP' (New-RolePayload (Join-Path $env:USERPROFILE 'outside-temp.txt') 'doc-writer' $docAgent)
Test-FixtureHook 'record-clerk outside TEMP' (New-RolePayload (Join-Path $env:USERPROFILE 'outside-temp.txt') 'record-clerk' $clerkAgent)
Test-FixtureHook 'doc-writer job-like directory outside TEMP' (New-RolePayload (Join-Path $env:USERPROFILE '.claude/jobs/fixture/notes.txt') 'doc-writer' $docAgent)
Test-FixtureHook 'doc-writer foreign repository under TEMP' (New-RolePayload (Join-Path $docForeign 'notes.txt') 'doc-writer' $docAgent)
Test-FixtureHook 'record-clerk foreign repository under TEMP' (New-RolePayload (Join-Path $docForeign 'notes.txt') 'record-clerk' $clerkAgent)
Test-FixtureHook 'doc-writer traversal into the repository' (New-RolePayload ($fixture + '\x\..\repository\src\notes.txt') 'doc-writer' $docAgent)
Test-FixtureHook 'doc-writer traversal out of TEMP' (New-RolePayload ($env:TEMP + '\..\escape-notes.txt') 'doc-writer' $docAgent)
Test-FixtureHook 'doc-writer case-variant repository path' (New-RolePayload (Join-Path $fixture 'REPOSITORY/DOCS/NOTES.TXT') 'doc-writer' $docAgent)
Test-FixtureHook 'doc-writer alternate stream' (New-RolePayload ($fixture + '\notes.md:s.txt') 'doc-writer' $docAgent)
Test-FixtureHook 'doc-writer ungranted directory named like Markdown' (New-RolePayload (Join-Path $repo 'docs/x.md') 'doc-writer' $docAgent)
Test-FixtureHook 'doc-writer secret-pattern key name' (New-RolePayload (Join-Path $fixture 'notes.key') 'doc-writer' $docAgent)
Test-FixtureHook 'doc-writer secret-pattern env name' (New-RolePayload (Join-Path $fixture '.env') 'doc-writer' $docAgent)
Test-FixtureHook 'record-clerk secret-pattern key name' (New-RolePayload (Join-Path $fixture 'notes.key') 'record-clerk' $clerkAgent)
# Junction cases: the links live inside this fixture and only the link itself is removed.
$srcAlias = Join-Path $fixture 'src-alias'
try { New-Item -ItemType Junction -Path $srcAlias -Target (Join-Path $repo 'src') -ErrorAction Stop | Out-Null }
catch { $skipped++; Write-Output 'SKIP documentation-role junction cases: creation unavailable.' }
if (Test-Path -LiteralPath $srcAlias) {
    try {
        Test-FixtureHook 'doc-writer junction to a repository subdirectory' (New-RolePayload (Join-Path $srcAlias 'notes.txt') 'doc-writer' $docAgent)
        Test-FixtureHook 'record-clerk junction to a repository subdirectory' (New-RolePayload (Join-Path $srcAlias 'notes.txt') 'record-clerk' $clerkAgent)
    } finally {
        if (-not [IO.Path]::GetFullPath($srcAlias).StartsWith([IO.Path]::GetFullPath($fixture) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture cleanup path.' }
        Remove-Item -LiteralPath $srcAlias -Force
    }
}
$tempRootOverride = Join-Path $fixture 'temp-root'; $outsideDir = Join-Path $fixture 'outside-dir'
[IO.Directory]::CreateDirectory($tempRootOverride) | Out-Null; [IO.Directory]::CreateDirectory($outsideDir) | Out-Null
$escapeAlias = Join-Path $tempRootOverride 'outside-alias'
try { New-Item -ItemType Junction -Path $escapeAlias -Target $outsideDir -ErrorAction Stop | Out-Null }
catch { $skipped++; Write-Output 'SKIP TEMP-escape junction case: creation unavailable.' }
if (Test-Path -LiteralPath $escapeAlias) {
    try {
        Test-FixtureHook 'doc-writer junction escaping TEMP' (New-RolePayload (Join-Path $escapeAlias 'notes.txt') 'doc-writer' $docAgent) -Environment @{ TEMP = $tempRootOverride }
    } finally {
        if (-not [IO.Path]::GetFullPath($escapeAlias).StartsWith([IO.Path]::GetFullPath($fixture) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture cleanup path.' }
        Remove-Item -LiteralPath $escapeAlias -Force
    }
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
$unregistered = New-FixturePayload (Join-Path $fixture 'ad-hoc-probe.txt'); $unregistered.agent_id = 'unregistered-agent'; $unregistered.agent_type = 'opus-reviewer'
Test-FixtureHook 'ungranted external temporary scratch for a scratch role' $unregistered 0
$unregistered.agent_type = 'sonnet-coder'; Test-FixtureHook 'ungranted external temporary scratch for a writer role' $unregistered 0
$unregistered.agent_type = 'code-reader'; Test-FixtureHook 'read-only role external scratch' $unregistered
$unregistered.agent_type = 'opus-reviewer'; $unregistered.tool_input.file_path = Join-Path $repo 'src/unregistered.ts'; Test-FixtureHook 'ungranted repository target for a scratch role' $unregistered
foreach ($scratchOnlyRole in @('designer', 'code-searcher', 'haiku-triager', 'doc-verifier', 'senior-advisor')) {
    $probe = New-FixturePayload (Join-Path $fixture 'scratch-only-probe.md'); $probe.agent_id = 'scratch-only-agent'; $probe.agent_type = $scratchOnlyRole
    Test-FixtureHook "scratch-only role $scratchOnlyRole external temporary scratch" $probe 0
    $probe.tool_input.file_path = Join-Path $repo 'src/scratch-only.ts'; Test-FixtureHook "scratch-only role $scratchOnlyRole repository target" $probe
    $probe.tool_input.file_path = Join-Path $env:USERPROFILE 'outside-temp.md'; Test-FixtureHook "scratch-only role $scratchOnlyRole outside TEMP" $probe
    Test-FixtureRegistrationDenial "scratch-only role $scratchOnlyRole repository registration" (Join-Path $repo 'src/scratch-only.ts') $scratchOnlyRole
}
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
# Linked worktrees nested under the repository, as Claude Code creates them (MC-2750). The per-worktree git
# directory holds commondir; the forged ones lack it or point nowhere.
function New-FixtureWorktree([string]$Name, [switch]$NoCommondir, [switch]$Dangling, [switch]$NoBackLink) {
    $root = Join-Path $repo ".claude/worktrees/$Name"; $gitDir = Join-Path $repo ".git/worktrees/$Name"
    [IO.Directory]::CreateDirectory($root) | Out-Null
    if (-not $Dangling) { [IO.Directory]::CreateDirectory($gitDir) | Out-Null }
    if (-not $NoCommondir -and -not $Dangling) { [IO.File]::WriteAllText((Join-Path $gitDir 'commondir'), "../..`n") }
    if (-not $NoBackLink -and -not $Dangling) { [IO.File]::WriteAllText((Join-Path $gitDir 'gitdir'), ((Join-Path $root '.git').Replace('\', '/') + "`n")) }
    [IO.File]::WriteAllText((Join-Path $root '.git'), "gitdir: $gitDir`n")
    return $root
}
function New-WorktreePayload([string]$Path, [string]$Role = 'sonnet-coder', [object]$Cwd = $null, [string]$AgentId = 'worktree-agent', [string]$Tool = 'Write') {
    $worktreePayload = New-RolePayload $Path $Role $AgentId $Tool
    if ($null -ne $Cwd) { $worktreePayload.cwd = $Cwd }
    return $worktreePayload
}
$wt = New-FixtureWorktree 'wt'; $wt2 = New-FixtureWorktree 'wt2'
$noCommon = New-FixtureWorktree 'no-common' -NoCommondir; $dangling = New-FixtureWorktree 'dangling' -Dangling; $noBack = New-FixtureWorktree 'no-back' -NoBackLink
Test-FixtureHook 'own worktree Write without a grant' (New-WorktreePayload (Join-Path $wt 'src/a.ts') -Cwd $wt) 0
Test-FixtureHook 'own worktree Edit without a grant' (New-WorktreePayload (Join-Path $wt 'src/a.ts') -Cwd $wt -Tool 'Edit') 0
Test-FixtureHook 'own worktree new nested directory' (New-WorktreePayload (Join-Path $wt 'src/new/dir/b.ts') -Cwd $wt) 0
Test-FixtureHook 'own worktree from a subdirectory cwd' (New-WorktreePayload (Join-Path $wt 'src/a.ts') -Cwd (Join-Path $wt 'src')) 0
Test-FixtureHook 'own worktree with forward-slash cwd' (New-WorktreePayload (Join-Path $wt 'src/a.ts') -Cwd $wt.Replace('\', '/')) 0
Test-FixtureHook 'own worktree haiku-editor' (New-WorktreePayload (Join-Path $wt 'src/a.test.ts') 'haiku-editor' $wt) 0
# test-warrior also runs as a review route, so it keeps exact grants only.
Test-FixtureHook 'own worktree test-warrior needs an exact grant' (New-WorktreePayload (Join-Path $wt 'src/a.test.ts') 'test-warrior' $wt)
Test-FixtureHook 'main checkout file from a worktree session' (New-WorktreePayload (Join-Path $repo 'src/main-only.ts') -Cwd $wt)
Test-FixtureHook 'another worktree from a worktree session' (New-WorktreePayload (Join-Path $wt2 'src/a.ts') -Cwd $wt)
Test-FixtureHook 'worktree file from a main checkout session' (New-WorktreePayload (Join-Path $wt 'src/a.ts') -Cwd $repo)
# A denial names the payload cwd and the worktree it resolves to, so a main-checkout cwd is visible at once.
foreach ($cwdCase in @(
    @{ Name = 'main-checkout cwd'; Payload = (New-WorktreePayload (Join-Path $wt 'src/a.ts') -Cwd $repo); Cwd = "cwd=$repo;"; Worktree = 'worktree=none' },
    @{ Name = 'missing cwd'; Payload = (New-WorktreePayload (Join-Path $wt 'src/a.ts')); Cwd = 'cwd=(missing);'; Worktree = 'worktree=none' },
    @{ Name = 'worktree cwd, target elsewhere'; Payload = (New-WorktreePayload (Join-Path $repo 'src/main-only.ts') -Cwd $wt); Cwd = "cwd=$wt;"; Worktree = "worktree=$wt" }
)) {
    $cwdDenial = Invoke-FixtureProcess $guard -InputText ($cwdCase.Payload | ConvertTo-Json -Depth 10 -Compress)
    if ($cwdDenial.ExitCode -ne 2 -or -not $cwdDenial.Stderr.Contains($cwdCase.Cwd) -or -not $cwdDenial.Stderr.Contains($cwdCase.Worktree)) { throw "Denial for $($cwdCase.Name) must name the cwd and worktree: $($cwdDenial.Stderr)" }
    $passed++
}
foreach ($badCwd in @('', 42, @($wt), 'relative\wt', ($wt + '\..\wt2'), ($wt + ':stream'))) {
    Test-FixtureHook 'malformed cwd falls back to exact grants' (New-WorktreePayload (Join-Path $wt 'src/a.ts') -Cwd $badCwd)
}
Test-FixtureHook 'missing cwd falls back to exact grants' (New-WorktreePayload (Join-Path $wt 'src/a.ts'))
Test-FixtureHook 'worktree without commondir' (New-WorktreePayload (Join-Path $noCommon 'src/a.ts') -Cwd $noCommon)
Test-FixtureHook 'worktree with a dangling gitdir' (New-WorktreePayload (Join-Path $dangling 'src/a.ts') -Cwd $dangling)
Test-FixtureHook 'worktree without a back-link' (New-WorktreePayload (Join-Path $noBack 'src/a.ts') -Cwd $noBack)
# A .git file planted in the main checkout naming a real worktree's git directory is not that worktree.
$planted = Join-Path $repo '.claude/agents'; [IO.Directory]::CreateDirectory($planted) | Out-Null
[IO.File]::WriteAllText((Join-Path $planted '.git'), "gitdir: $(Join-Path $repo '.git/worktrees/wt')`n")
Test-FixtureRegistrationDenial 'planted pointer keeps main governance' (Join-Path $planted 'x.md') 'record-clerk'
Test-FixtureHook 'planted pointer gives no grant' (New-WorktreePayload (Join-Path $planted 'x.md') -Cwd $planted)
[IO.File]::Delete((Join-Path $planted '.git'))
foreach ($scratchRole in @('adversarial-reviewer', 'opus-reviewer', 'designer')) { Test-FixtureHook "own worktree for scratch role $scratchRole" (New-WorktreePayload (Join-Path $wt 'src/a.ts') $scratchRole $wt) }
Test-FixtureHook 'own worktree for read-only code-reader' (New-WorktreePayload (Join-Path $wt 'src/a.ts') 'code-reader' $wt)
foreach ($secret in @('.env', '.git', '.git/config', 'certs/server.pem', 'src-tauri/key.txt', '.claude/settings.local.json', '.claude/scratch/write-scopes/forged.json',
    'Agents/Evidences of Investigations/Community plugins to solve common pain points/a.md')) {
    Test-FixtureHook "own worktree protected target $secret" (New-WorktreePayload (Join-Path $wt $secret) -Cwd $wt)
}
# Guard, governance and maintainer-protected paths are never covered by the automatic grant (exact grants still work).
$excludedTargets = @('.claude/scripts/guard-write.ps1', '.claude/scripts/write-guard-common.ps1', '.claude/settings.json', '.claude/workflow-policy.json', '.claude/launch.json',
    '.claude/agents/sonnet-coder.md', '.github/workflows/ci.yml', '.gemini/GEMINI.md', 'docs/workflow/gates.md', 'docs/branding/logo.svg', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md',
    'Agents/Workflow-State.json', 'Agents/Maintainer-Context.md', 'Agents/README.md', 'Agents/Decision-Index.md', 'Agents/mc/384.md', 'docs/Terms-of-Services.md', 'docs/Privacy-Policy.md', 'src/lib/Others/Legal.svelte')
foreach ($excluded in $excludedTargets) { Test-FixtureHook "own worktree excluded $excluded" (New-WorktreePayload (Join-Path $wt $excluded) -Cwd $wt) }
foreach ($excluded in @('AGENTS.md', 'docs/workflow/gates.md', 'docs/Terms-of-Services.md', '.claude/agents/x.md')) { Test-FixtureHook "own worktree doc-writer excluded $excluded" (New-WorktreePayload (Join-Path $wt $excluded) 'doc-writer' $wt) }
foreach ($instruction in @('src/CLAUDE.md', 'src/deep/AGENTS.md', 'docs/GEMINI.md', 'CLAUDE.local.md', 'src/claude.md', 'src/.claude/agents/x.md', 'src/.claude/settings.json', '.mcp.json')) {
    Test-FixtureHook "own worktree agent instruction $instruction" (New-WorktreePayload (Join-Path $wt $instruction) -Cwd $wt)
}
Test-FixtureHook 'own worktree ordinary Markdown near an instruction name' (New-WorktreePayload (Join-Path $wt 'src/CLAUDE-notes.md') -Cwd $wt) 0
# Git's structure: a per-worktree directory outside <common>\worktrees, or a commondir naming nothing, is not a worktree.
$offTree = Join-Path $repo '.claude/worktrees/off-tree'; $offGit = Join-Path $repo '.git/elsewhere/off-tree'
[IO.Directory]::CreateDirectory($offTree) | Out-Null; [IO.Directory]::CreateDirectory($offGit) | Out-Null
[IO.File]::WriteAllText((Join-Path $offGit 'commondir'), "../..`n"); [IO.File]::WriteAllText((Join-Path $offGit 'gitdir'), ((Join-Path $offTree '.git').Replace('\', '/') + "`n"))
[IO.File]::WriteAllText((Join-Path $offTree '.git'), "gitdir: $offGit`n")
Test-FixtureHook 'per-worktree directory outside common worktrees' (New-WorktreePayload (Join-Path $offTree 'src/a.ts') -Cwd $offTree)
$lost = New-FixtureWorktree 'lost-common'; [IO.File]::WriteAllText((Join-Path $repo '.git/worktrees/lost-common/commondir'), "../../missing-common`n")
Test-FixtureHook 'commondir naming a missing directory' (New-WorktreePayload (Join-Path $lost 'src/a.ts') -Cwd $lost)
Test-FixtureHook 'own worktree near-miss name is ordinary' (New-WorktreePayload (Join-Path $wt 'src/AGENTS.md.ts') -Cwd $wt) 0
$wtGuard = Join-Path $wt '.claude/scripts/guard-write.ps1'; Register-Fixture $wtGuard -AgentId 'wt-guard-coder'
Test-FixtureHook 'own worktree excluded path with an exact grant' (New-WorktreePayload $wtGuard 'sonnet-coder' $wt 'wt-guard-coder') 0
Test-FixtureHook 'own worktree record-clerk record' (New-WorktreePayload (Join-Path $wt 'Agents/Roadmap.md') 'record-clerk' $wt) 0
foreach ($governance in @('.claude/agents/x.md', 'Agents/mc/384.md', 'AGENTS.md', 'CLAUDE.md', 'docs/workflow/x.md', '.github/x.md', 'Agents/Maintainer-Context.md', 'Agents/notes.txt')) {
    Test-FixtureHook "own worktree record-clerk refused $governance" (New-WorktreePayload (Join-Path $wt $governance) 'record-clerk' $wt)
}
foreach ($locale in @('ja', 'ko', 'cn', 'zh-Hant', 'vi', 'de', 'es')) { Test-FixtureHook "own worktree translator $locale" (New-WorktreePayload (Join-Path $wt "src/lang/$locale.ts") 'translator' $wt) 0 }
foreach ($outside in @('src/lang/en.ts', 'src/lang/index.ts', 'src/lang/sub/ja.ts', 'src/ja.ts')) { Test-FixtureHook "own worktree translator refused $outside" (New-WorktreePayload (Join-Path $wt $outside) 'translator' $wt) }
Test-FixtureHook 'own worktree doc-writer Markdown' (New-WorktreePayload (Join-Path $wt 'docs/a.md') 'doc-writer' $wt) 0
Test-FixtureHook 'own worktree doc-writer code' (New-WorktreePayload (Join-Path $wt 'src/a.ts') 'doc-writer' $wt)
# Exact grants for worktree targets now use the worktree's own governance and locale paths.
$jaMain = Join-Path $repo 'src/lang/ja.ts'; Register-Fixture $jaMain -Role 'translator' -AgentId 'ja-agent'
Test-FixtureHook 'main checkout translator ja exact grant' (New-RolePayload $jaMain 'translator' 'ja-agent') 0
$wtRoadmap = Join-Path $wt 'Agents/Roadmap.md'; Register-Fixture $wtRoadmap -Role 'record-clerk' -AgentId 'wt-clerk'
Test-FixtureHook 'worktree record-clerk exact grant without cwd' (New-RolePayload $wtRoadmap 'record-clerk' 'wt-clerk') 0
$wtLocale = Join-Path $wt2 'src/lang/de.ts'; Register-Fixture $wtLocale -Role 'translator' -AgentId 'wt-translator'
Test-FixtureHook 'worktree translator exact grant without cwd' (New-RolePayload $wtLocale 'translator' 'wt-translator') 0
Test-FixtureRegistrationDenial 'worktree record-clerk governance registration' (Join-Path $wt '.claude/agents/x.md') 'record-clerk'
Test-FixtureRegistrationDenial 'non-worktree directory under .claude keeps main governance' (Join-Path $repo '.claude/worktrees/plain/Agents/Roadmap.md') 'record-clerk'
Test-FixtureRegistrationDenial 'worktree registry directory registration' (Join-Path $wt '.claude/scratch/write-scopes/forged.json')
# Layout B: the hooks run the worktree's own copy of the scripts, so the guard root is the worktree itself.
$wtScripts = Join-Path $wt '.claude/scripts'; [IO.Directory]::CreateDirectory($wtScripts) | Out-Null
foreach ($name in @('write-guard-common.ps1', 'guard-write.ps1', 'register-write-scope.ps1', 'subagent-identity.ps1')) { Copy-Item -LiteralPath (Join-Path $scripts $name) -Destination (Join-Path $wtScripts $name) }
$guardB = Join-Path $wtScripts 'guard-write.ps1'
Test-FixtureHook 'layout B own worktree' (New-WorktreePayload (Join-Path $wt 'src/a.ts') -Cwd $wt) 0 -Script $guardB
Test-FixtureHook 'layout B translator ja' (New-WorktreePayload (Join-Path $wt 'src/lang/ja.ts') 'translator' $wt) 0 -Script $guardB
Test-FixtureHook 'layout B main checkout target' (New-WorktreePayload (Join-Path $repo 'src/a.ts') -Cwd $wt) -Script $guardB
Test-FixtureHook 'layout B missing cwd' (New-WorktreePayload (Join-Path $wt 'src/a.ts')) -Script $guardB
Test-FixtureHook 'layout B scratch role' (New-WorktreePayload (Join-Path $wt 'src/a.ts') 'adversarial-reviewer' $wt) -Script $guardB
foreach ($excluded in @('.claude/scripts/guard-write.ps1', '.claude/scripts/write-guard-common.ps1', '.claude/settings.json', '.claude/workflow-policy.json', 'Agents/Workflow-State.json', '.claude/scratch/write-scopes/x.json', 'docs/branding/logo.svg', 'src/CLAUDE.md', 'CLAUDE.local.md', 'src/.claude/agents/x.md', '.mcp.json')) {
    Test-FixtureHook "layout B excluded $excluded" (New-WorktreePayload (Join-Path $wt $excluded) -Cwd $wt) -Script $guardB
}
foreach ($identityCase in @(@{ Role='sonnet-coder'; Cwd=$wt; Auto=$true }, @{ Role='sonnet-coder'; Cwd=$repo; Auto=$false }, @{ Role='opus-reviewer'; Cwd=$wt; Auto=$false })) {
    $identityPayload = @{ session_id=$session; agent_id='wt-identity'; agent_type=$identityCase.Role; hook_event_name='SubagentStart'; cwd=$identityCase.Cwd } | ConvertTo-Json -Compress
    $identityResult = Invoke-FixtureProcess (Join-Path $scripts 'subagent-identity.ps1') -InputText $identityPayload
    $identityContext = (Read-GuardObject $identityResult.Stdout).hookSpecificOutput.additionalContext
    if ($identityResult.ExitCode -ne 0 -or $identityResult.Stderr -or (($identityContext -match 'granted automatically') -ne $identityCase.Auto)) { throw "Worktree identity context wrong for $($identityCase.Role) in $($identityCase.Cwd)." }
    $passed++
}
$denied = Invoke-FixtureSettingsHook 'PreToolUse' ((New-FixturePayload (Join-Path $repo 'src/sibling.ts')) | ConvertTo-Json -Depth 10 -Compress)
if ($denied.ExitCode -ne 2 -or -not $denied.Stderr) { throw "Settings-form denial must exit 2, got $($denied.ExitCode)." }
$passed++
$allowed = Invoke-FixtureSettingsHook 'PreToolUse' ((New-FixturePayload) | ConvertTo-Json -Depth 10 -Compress)
if ($allowed.ExitCode -ne 0 -or $allowed.Stderr) { throw "Settings-form exact grant must exit 0, got $($allowed.ExitCode): $($allowed.Stderr)" }
$passed++
$startPayload = @{ session_id=$session; agent_id=$agent; agent_type=$role; hook_event_name='SubagentStart' } | ConvertTo-Json -Compress
$settingsStart = Invoke-FixtureSettingsHook 'SubagentStart' $startPayload
if ($settingsStart.ExitCode -ne 0 -or (Read-GuardObject $settingsStart.Stdout).hookSpecificOutput.additionalContext -notmatch 'fixture-agent') { throw 'Settings-form identity context failed.' }
$passed++
$identity = Invoke-FixtureProcess (Join-Path $scripts 'subagent-identity.ps1') -InputText $startPayload
if ($identity.ExitCode -ne 0 -or $identity.Stderr -or (Read-GuardObject $identity.Stdout).hookSpecificOutput.additionalContext -notmatch 'fixture-agent') { throw 'Subagent identity context failed.' }
$passed++
$readerPayload = @{ session_id=$session; agent_id='reader-instance'; agent_type='code-reader'; hook_event_name='SubagentStart' } | ConvertTo-Json -Compress
$reader = Invoke-FixtureProcess (Join-Path $scripts 'subagent-identity.ps1') -InputText $readerPayload
$readerContext = (Read-GuardObject $reader.Stdout).hookSpecificOutput.additionalContext
if ($reader.ExitCode -ne 0 -or $readerContext -notmatch 'Proceed with authorized reads' -or $readerContext -notmatch 'no registration pause' -or $readerContext -match 'wait for the parent') { throw 'Read-only identity context imposed an unnecessary registration pause.' }
$passed++
foreach ($identityRole in @('designer', 'opus-reviewer', 'sonnet-coder')) {
    $identityPayload = @{ session_id=$session; agent_id="identity-$identityRole"; agent_type=$identityRole; hook_event_name='SubagentStart' } | ConvertTo-Json -Compress
    $identityResult = Invoke-FixtureProcess (Join-Path $scripts 'subagent-identity.ps1') -InputText $identityPayload
    if ($identityResult.ExitCode -ne 0 -or $identityResult.Stderr) { throw "Identity context failed for $identityRole." }
    $identityContext = (Read-GuardObject $identityResult.Stdout).hookSpecificOutput.additionalContext
    if ($identityRole -eq 'sonnet-coder') {
        if ($identityContext -notmatch 'wait for the parent' -or $identityContext -match 'never receives a repository grant') { throw 'Writer identity context lost its registration pause or gained the scratch-only sentence.' }
    } elseif ($identityContext -notmatch 'Scratch files under %TEMP%' -or $identityContext -notmatch 'never receives a repository grant' -or $identityContext -match 'no Write/Edit authorization' -or $identityContext -match 'wait for the parent') {
        throw "Scratch-only identity context is wrong for $identityRole."
    }
    $passed++
}
$malformedStart = @{ session_id=$session; agent_id=$agent; agent_type=$role; hook_event_name=@('SubagentStart') } | ConvertTo-Json -Compress
$startFailure = Invoke-FixtureProcess (Join-Path $scripts 'subagent-identity.ps1') -InputText $malformedStart
if ($startFailure.ExitCode -ne 0 -or $startFailure.Stdout -or -not $startFailure.Stderr) { throw 'Wrong-type SubagentStart emitted misleading identity context.' }
$passed++
Write-Output "Synthetic guard checks passed: $passed; skipped groups: $skipped."
Write-Output "Retained outside-repository fixture: $fixture"
Write-Output 'Synthetic stdin/process checks do not establish native Claude hook execution or actual Haiku pilot outcomes.'
