# Exports a clean, read-only working copy of a git ref for an external model (Codex, Antigravity) under -Dest.
# Only tracked files are exported (git archive), so untracked and ignored files never leave the repository. Secrets and
# protected material are then removed from the copy and the removal is verified: .env*, signing material (key.txt,
# keystore.properties, *.jks, *.keystore, *.p12, *.pfx) and the two MC-027 community-code directories.
# -Extra copies named files (for example untracked handoffs or reports) into <Dest>\ext-in\ under their leaf names (a second
# file with the same leaf is renamed <parent folder>-<leaf>); a file whose name matches the signing patterns is refused. Prints the destination path. The copy is disposable: never edit the repository from it.
param(
    [Parameter(Mandatory)][string]$Dest,
    [string]$Ref = 'HEAD',
    [string[]]$Extra = @(),
    [string]$RepoRoot
)
$ErrorActionPreference = 'Stop'
if (-not $RepoRoot) { $RepoRoot = (git rev-parse --show-toplevel).Trim() }
$Dest = [IO.Path]::GetFullPath($Dest)
# git prints forward slashes: normalise, and compare with a trailing separator so the root and any folder inside it are refused
# (and a sibling such as <root>-copy is not). The guard runs before anything is created.
$RepoRoot = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\')
if (($Dest.TrimEnd('\') + '\').StartsWith($RepoRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Destination must be outside the repository.' }
if (Test-Path -LiteralPath $Dest) {
    if ((Get-ChildItem -LiteralPath $Dest -Force | Measure-Object).Count -gt 0) { throw "Destination $Dest is not empty." }
} else {
    New-Item -ItemType Directory -Path $Dest | Out-Null
}

$archive = Join-Path $Dest '.export.tar'
git -C $RepoRoot archive --format=tar --output=$archive $Ref
if ($LASTEXITCODE -ne 0) { throw "git archive failed for $Ref" }
tar -x -f $archive -C $Dest
if ($LASTEXITCODE -ne 0) { throw 'tar extract failed' }
Remove-Item -LiteralPath $archive -Force

$secretFilter = @('.env*', 'key.txt', 'keystore.properties', '*.jks', '*.keystore', '*.p12', '*.pfx')
foreach ($pattern in $secretFilter) {
    Get-ChildItem -LiteralPath $Dest -Recurse -Force -File -Filter $pattern -ErrorAction SilentlyContinue | Remove-Item -Force
}
$protected = @(
    'Agents/Evidences of Investigations/Community plugins to solve common pain points',
    'Agents/Evidences of Investigations/Asset Cache/Community Mitigation_Webrowser Plugin'
)
foreach ($relative in $protected) {
    $path = Join-Path $Dest $relative
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}
$left = @()
foreach ($pattern in $secretFilter) {
    # Stop, not SilentlyContinue: an enumeration error must fail the export closed rather than pass the check.
    $left += Get-ChildItem -LiteralPath $Dest -Recurse -Force -File -Filter $pattern -ErrorAction Stop
}
foreach ($relative in $protected) {
    if (Test-Path -LiteralPath (Join-Path $Dest $relative)) { $left += Get-Item -LiteralPath (Join-Path $Dest $relative) }
}
if ($left.Count -gt 0) { throw "Sanitising left $($left.Count) forbidden item(s), first: $($left[0].FullName)" }

if ($Extra.Count -gt 0) {
    $inDir = Join-Path $Dest 'ext-in'
    New-Item -ItemType Directory -Path $inDir -Force | Out-Null
    foreach ($file in $Extra) {
        $leaf = [IO.Path]::GetFileName($file)
        foreach ($pattern in $secretFilter) { if ($leaf -like $pattern) { throw "Refusing to export $leaf (signing/env pattern)." } }
        if (Test-Path -LiteralPath (Join-Path $inDir $leaf)) {
            $leaf = (Split-Path -Leaf (Split-Path -Parent $file)) + '-' + $leaf
            if (Test-Path -LiteralPath (Join-Path $inDir $leaf)) { throw "Two extra files collide on the name $leaf." }
        }
        Copy-Item -LiteralPath $file -Destination (Join-Path $inDir $leaf)
    }
}
$count = (Get-ChildItem -LiteralPath $Dest -Recurse -File -Force | Measure-Object).Count
Write-Output "Exported $Ref to $Dest ($count files)"
