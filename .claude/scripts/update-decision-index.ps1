#requires -Version 7.0
param(
    [switch]$Check,
    [string]$Root = (Join-Path $PSScriptRoot '../..')
)

$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($Root)
$sourcePath = Join-Path $taskRoot 'Agents/Maintainer-Context.md'
$indexPath = Join-Path $taskRoot 'Agents/Decision-Index.md'
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Missing maintainer context: $sourcePath"
}
$source = [IO.File]::ReadAllText($sourcePath)
$headings = [regex]::Matches($source, '(?m)^### (MC-\d{3,}) — (.+)\r?$')
$allIds = [regex]::Matches($source, '(?m)^#{1,6} MC-\d{3,}\b')
if ($headings.Count -eq 0 -or $headings.Count -ne $allIds.Count) {
    throw 'No MC headings, or an unsupported heading shape. Expected: ### MC-NNN — literal title'
}
$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$lines = [Collections.Generic.List[string]]::new()
$lines.Add('# Decision index')
$lines.Add('')
$lines.Add('GENERATED NAVIGATION ONLY. Titles are literal MC headings, not summaries or supersession status.')
$lines.Add('Maintainer-Context.md remains authoritative. Do not edit this table by hand.')
$lines.Add('')
$lines.Add('Regenerate: `pwsh -NoProfile -File .claude/scripts/update-decision-index.ps1`')
$lines.Add('Check: `pwsh -NoProfile -File .claude/scripts/update-decision-index.ps1 -Check`')
$lines.Add('')
$lines.Add('| ID | Literal heading title |')
$lines.Add('|---|---|')
foreach ($heading in $headings) {
    $id = $heading.Groups[1].Value
    $title = $heading.Groups[2].Value.TrimEnd("`r")
    if (-not $seen.Add($id)) { throw "Duplicate MC ID: $id" }
    # Markdown heading slugs retain letters, digits, hyphens and underscores.
    $anchor = "$id — $title".ToLowerInvariant()
    $anchor = [regex]::Replace($anchor, '[^\p{L}\p{N}\s_-]', '')
    $anchor = [regex]::Replace($anchor, '\s', '-')
    $cell = $title.Replace('|', '\|')
    $lines.Add("| [$id](Maintainer-Context.md#$anchor) | $cell |")
}
$expected = [Text.UTF8Encoding]::new($false).GetBytes(($lines -join "`r`n") + "`r`n")
if ($Check) {
    if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) { throw 'Decision index is missing.' }
    $actual = [IO.File]::ReadAllBytes($indexPath)
    if ([Convert]::ToBase64String($actual) -cne [Convert]::ToBase64String($expected)) {
        throw 'Decision index is stale. Run update-decision-index.ps1 without -Check.'
    }
    Write-Output "Decision index is current ($($seen.Count) entries)."
} else {
    [IO.File]::WriteAllBytes($indexPath, $expected)
    Write-Output "Generated Agents/Decision-Index.md ($($seen.Count) entries)."
}
