#requires -Version 7.0
param(
    [Parameter(Mandatory)][string]$SessionId,
    [Parameter(Mandatory)][string]$AgentId,
    [Parameter(Mandatory)][string]$Role,
    [string[]]$Files,
    [switch]$Revoke
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'write-guard-common.ps1')
Assert-GuardRepository
$manifestPath = Get-GuardManifestPath $SessionId $AgentId $Role
if ($Revoke) {
    $null = Get-GuardPath $manifestPath
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) { Remove-Item -LiteralPath $manifestPath }
    Write-Output 'Exact instance grant revoked.'
    exit 0
}
if (-not $Files -or $Files.Count -eq 0) { throw 'Supply exact named files already authorized by the parent.' }
$targets = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($file in $Files) {
    $target = Get-GuardPath $file
    Assert-GuardTarget $Role $target
    if (-not $targets.Add($target)) { throw 'Duplicate target.' }
}
[IO.Directory]::CreateDirectory($GuardRegistryRoot) | Out-Null
Assert-GuardRepository
$manifest = @{ version = 1; sessionId = $SessionId; agentId = $AgentId; role = $Role; repositoryRoot = $GuardRepositoryRoot; files = @($targets) }
$temporary = Join-Path $GuardRegistryRoot ([guid]::NewGuid().ToString('N') + '.tmp')
try {
    [IO.File]::WriteAllText($temporary, ($manifest | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    $null = Get-GuardPath $manifestPath
    [IO.File]::Move($temporary, $manifestPath, $true)
} finally { if (Test-Path -LiteralPath $temporary -PathType Leaf) { Remove-Item -LiteralPath $temporary } }
Write-Output 'Exact instance grant registered; resume the same agent. Registration replaces the previous scope.'
