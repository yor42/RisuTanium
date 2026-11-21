#requires -Version 7.0
param(
    [switch]$Check,
    [string]$Root = (Join-Path $PSScriptRoot '../..')
)

$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($Root)
$sourcePath = Join-Path $taskRoot 'Agents/Maintainer-Context.md'
$indexPath = Join-Path $taskRoot 'Agents/Decision-Index.md'
$pendingDir = Join-Path $taskRoot 'Agents/mc'
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Missing maintainer context: $sourcePath"
}

# Every MC heading in a scanned file must have the literal shape, so no decision escapes the index or the duplicate check.
function Get-McHeadings([string]$Path) {
    $text = [IO.File]::ReadAllText($Path)
    $headings = [regex]::Matches($text, '(?m)^### (MC-\d{3,}) — (.+)\r?$')
    $allIds = [regex]::Matches($text, '(?m)^#{1,6} MC-\d{3,}\b')
    if ($headings.Count -ne $allIds.Count -or $headings.Count -eq 0) {
        throw "No MC headings, or an unsupported heading shape in ${Path}. Expected: ### MC-NNN — literal title"
    }
    return $headings
}

$seen = [Collections.Generic.Dictionary[string, string]]::new([StringComparer]::Ordinal)
function Add-McId([string]$Id, [string]$Where) {
    if ($seen.ContainsKey($Id)) { throw "Duplicate MC ID: $Id ($($seen[$Id]) and $Where)" }
    $seen.Add($Id, $Where)
}

$lines = [Collections.Generic.List[string]]::new()
$lines.Add('# Decision index')
$lines.Add('')
$lines.Add('GENERATED NAVIGATION ONLY. Titles are literal MC headings, not summaries or supersession status.')
$lines.Add('Maintainer-Context.md remains authoritative. Do not edit this table by hand.')
$lines.Add('Entries merged but not yet folded live in `Agents/mc/*.md`; `-Check` lists them.')
$lines.Add('')
$lines.Add('Regenerate: `pwsh -NoProfile -File .claude/scripts/update-decision-index.ps1`')
$lines.Add('Check: `pwsh -NoProfile -File .claude/scripts/update-decision-index.ps1 -Check`')
$lines.Add('')
$lines.Add('| ID | Literal heading title |')
$lines.Add('|---|---|')
foreach ($heading in (Get-McHeadings $sourcePath)) {
    $id = $heading.Groups[1].Value
    $title = $heading.Groups[2].Value.TrimEnd("`r")
    Add-McId $id 'Maintainer-Context.md'
    # Markdown heading slugs retain letters, digits, hyphens and underscores.
    $anchor = "$id — $title".ToLowerInvariant()
    $anchor = [regex]::Replace($anchor, '[^\p{L}\p{N}\s_-]', '')
    $anchor = [regex]::Replace($anchor, '\s', '-')
    $cell = $title.Replace('|', '\|')
    $lines.Add("| [$id](Maintainer-Context.md#$anchor) | $cell |")
}
$foldedCount = $seen.Count

# Per-PR record files stay out of the generated table, so a ticket PR that adds one never edits the shared index.
$pending = [Collections.Generic.List[string]]::new()
if (Test-Path -LiteralPath $pendingDir -PathType Container) {
    foreach ($file in (Get-ChildItem -LiteralPath $pendingDir -Filter '*.md' -File | Sort-Object Name)) {
        if ($file.Name -ieq 'README.md') { continue }
        $headings = Get-McHeadings $file.FullName
        foreach ($heading in $headings) {
            $id = $heading.Groups[1].Value
            Add-McId $id "mc/$($file.Name)"
            $pending.Add("$id`tAgents/mc/$($file.Name)`t$($heading.Groups[2].Value.TrimEnd("`r"))")
        }
    }
}

$expected = [Text.UTF8Encoding]::new($false).GetBytes(($lines -join "`r`n") + "`r`n")
if ($Check) {
    if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) { throw 'Decision index is missing.' }
    $actual = [IO.File]::ReadAllBytes($indexPath)
    if ([Convert]::ToBase64String($actual) -cne [Convert]::ToBase64String($expected)) {
        throw 'Decision index is stale. Run update-decision-index.ps1 without -Check.'
    }
    Write-Output "Decision index is current ($foldedCount entries); $($pending.Count) pending in Agents/mc/."
    foreach ($row in $pending) { Write-Output "  pending $row" }
} else {
    [IO.File]::WriteAllBytes($indexPath, $expected)
    Write-Output "Generated Agents/Decision-Index.md ($foldedCount entries); $($pending.Count) pending in Agents/mc/."
}
