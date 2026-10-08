#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$role = '?'; $session = '?'; $agent = '?'; $requested = '?'
try {
    . (Join-Path $PSScriptRoot 'write-guard-common.ps1')
    Assert-GuardRepository
    $payload = Read-GuardObject (Read-GuardStdin)
    $session = $payload.session_id
    Assert-GuardId $session
    if ($payload.hook_event_name -isnot [string] -or $payload.hook_event_name -cne 'PreToolUse' -or $payload.tool_name -isnot [string] -or $payload.tool_name -cnotin @('Write', 'Edit') -or $payload.tool_input -isnot [Collections.IDictionary]) { throw 'Unsupported hook event or tool shape.' }
    $requested = $payload.tool_input.file_path
    $path = Get-GuardPath $requested
    $hasAgent = $payload.Contains('agent_id'); $hasRole = $payload.Contains('agent_type')
    if (-not $hasAgent -and -not $hasRole) { exit 0 }
    if (-not $hasRole) { throw 'Agent role is required.' }
    $role = $payload.agent_type
    Assert-GuardRole $role
    if ($hasAgent) { $agent = $payload.agent_id; Assert-GuardId $agent } else { $agent = 'main' }
    Assert-GuardTarget $role $path
    # Assert-GuardTarget already confined external targets to writer/scratch roles under TEMP outside every repository.
    if (-not (Test-GuardWithin $path $GuardRepositoryRoot)) { exit 0 }
    $targets = Read-GuardManifest $session $agent $role
    if (-not $targets.Contains($path)) { throw 'Requested file is outside the exact instance grant.' }
    exit 0
} catch {
    function Safe-Label([object]$Value) { return ([string]$Value -replace '[\x00-\x1f\x7f]', '?').Substring(0, [Math]::Min(200, ([string]$Value -replace '[\x00-\x1f\x7f]', '?').Length)) }
    # Do not echo input content or parser exception excerpts.
    $diagnostic = 'Write/Edit denied: invalid or ungranted request; role={0}; session={1}; agent={2}; path={3}' -f @((Safe-Label $role), (Safe-Label $session), (Safe-Label $agent), (Safe-Label $requested))
    [Console]::Error.WriteLine($diagnostic)
    exit 2
}
