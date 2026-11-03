# Exports current tracked working files and explicitly named untracked inputs.
param(
    [Parameter(Mandatory)][string]$Dest,
    [string]$Ref = 'HEAD',
    [string[]]$Extra = @(),
    [string]$RepoRoot,
    [string]$ManifestFile
)
$ErrorActionPreference = 'Stop'
if ($Ref -ne 'HEAD') { throw 'Only the current snapshot is supported. Use a separate checkout for another revision.' }
if (-not $RepoRoot) { $RepoRoot = (git rev-parse --show-toplevel).Trim() }
$arguments = @((Join-Path $PSScriptRoot 'workspace.mjs'), 'export', '--repo', $RepoRoot, '--dest', $Dest)
if ($ManifestFile) { $arguments += @('--manifest', $ManifestFile) }
foreach ($file in $Extra) { $arguments += @('--extra', $file) }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw 'Snapshot export failed.' }
