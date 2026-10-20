#requires -Version 7.0
param(
    [string]$Root = (Join-Path $PSScriptRoot '../..'),
    [string]$Base = 'HEAD'
)

# Read-only: scans added lines of the diff against Base and whole untracked new files in
# code and test files for history-style wording (the pattern from docs/workflow/gates.md).
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($Root)
# Assembled from parts so this script does not match its own pattern when scanned.
$pattern = @('round [0-9]', ('MAJ' + 'OR'), ('MIN' + 'OR'), ('mut' + 'ant'), ('bri' + 'ef'), ('first implemen' + 'tation'), ('previ' + 'ously'), ('no lon' + 'ger'), ('used' + ' to')) -join '|'
$codeExtensions = @('.ts', '.tsx', '.js', '.mjs', '.cjs', '.svelte', '.rs', '.ps1', '.sh')
function Test-CodeFile([string]$Path) { return [IO.Path]::GetExtension($Path).ToLowerInvariant() -in $codeExtensions }
$hits = [Collections.Generic.List[string]]::new()

$currentFile = $null; $lineNumber = 0
$diffLines = @(& git -C $taskRoot -c core.quotepath=false diff --no-color --unified=0 $Base --)
if ($LASTEXITCODE -ne 0) { throw "git diff failed against $Base" }
foreach ($line in $diffLines) {
    if ($line.StartsWith('+++ ')) {
        $currentFile = if ($line -eq '+++ /dev/null') { $null } else { $line.Substring(4) -replace '^b/', '' }
    } elseif ($line.StartsWith('@@')) {
        if ($line -match '\+(\d+)') { $lineNumber = [int]$Matches[1] }
    } elseif ($line.StartsWith('+') -and $currentFile -and (Test-CodeFile $currentFile)) {
        $text = $line.Substring(1)
        if ($text -cmatch $pattern) { $hits.Add("${currentFile}:${lineNumber}:$text") }
        $lineNumber++
    }
}

$previousEncoding = [Console]::OutputEncoding
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    $untrackedRaw = (@(& git -C $taskRoot -c core.quotepath=false ls-files --others --exclude-standard -z) -join [string][char]10)
    $listStatus = $LASTEXITCODE
} finally { [Console]::OutputEncoding = $previousEncoding }
if ($listStatus -ne 0) { throw 'git ls-files failed' }
$untracked = @($untrackedRaw.Split([char]0) | Where-Object { $_ })
foreach ($file in $untracked) {
    if (-not (Test-CodeFile $file)) { continue }
    $full = Join-Path $taskRoot $file
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
    $number = 0
    foreach ($text in [IO.File]::ReadAllLines($full)) {
        $number++
        if ($text -cmatch $pattern) { $hits.Add("${file}:${number}:$text") }
    }
}

$hits | ForEach-Object { Write-Output $_ }
if ($hits.Count) { Write-Output "$($hits.Count) history-style comment matches."; exit 1 }
Write-Output 'No history-style comment matches.'
exit 0
