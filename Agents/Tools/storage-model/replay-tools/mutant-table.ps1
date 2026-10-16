# Mutant table driver. Per mutant: runs the store2 test directory through mutant.config.mjs (in-memory patch, no repository
# write), then records the vitest exit code, load count, the failed tests, and the checker properties the corpus reports violated.
# Appends one block per mutant to <OutDir>\<Table>. The hashes of the repository's store2/store/tests/server files are compared
# before and after each run. Vitest runs with the repository root as its working directory (the setup file `/vitest.setup.ts`
# is resolved against it).
#
#   pwsh -NoProfile -File mutant-table.ps1 -Mutants none,c4,markIgnoresPins [-Root <repo>] [-OutDir <dir>] [-Test <path>] [-Seconds 5] [-Filter <name>]
param(
    [string[]]$Mutants,
    [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path,
    [string]$OutDir = (Join-Path ([System.IO.Path]::GetTempPath()) 'risu-replay-tools'),
    [string]$Test = 'src/ts/storage/tests/store2',
    [string]$Table = 'mutant-table.md',
    [string]$Seconds = '',
    [string]$Filter = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Mutants = @($Mutants | ForEach-Object { $_ -split ',' } | Where-Object { $_ -ne '' })
New-Item -ItemType Directory -Force $OutDir | Out-Null
$config = Join-Path $PSScriptRoot 'mutant.config.mjs'
$tablePath = Join-Path $OutDir $Table
$node = (Get-Command node).Source
$vitest = Join-Path $Root 'node_modules\vitest\vitest.mjs'
$env:RISU_ROOT = $Root
$env:RISU_SCRATCH = $OutDir

function Get-Hashes {
    $map = @{}
    foreach ($sub in @('src\ts\storage\store2', 'src\ts\storage\store', 'src\ts\storage\tests', 'server\node')) {
        Get-ChildItem (Join-Path $Root $sub) -Recurse -File | ForEach-Object { $map[$_.FullName] = (Get-FileHash $_.FullName -Algorithm SHA256).Hash }
    }
    return $map
}

Push-Location $Root
try {
    foreach ($mutant in $Mutants) {
        $log = Join-Path $OutDir "mut-$mutant.log"
        $before = Get-Hashes
        $env:l7_MUTANT = $mutant
        $env:L7_TAG = "m-$mutant"
        $env:REPLAY_REPORT = '1'
        if ($Seconds -ne '') { $env:RISU_LIVE_SECONDS = $Seconds }
        $args2 = @($vitest, 'run', $Test, '--config', $config, '--maxWorkers=6', '--reporter=verbose')
        if ($Filter -ne '') { $args2 += @('-t', $Filter) }
        $attempts = 0
        do {
            $attempts++
            & $node @args2 *> $log
            $exit = $LASTEXITCODE
        } while ($attempts -lt 3 -and ((Get-Content $log -Raw) -match 'ERR_MODULE_NOT_FOUND|Cannot find module'))
        Remove-Item Env:\l7_MUTANT, Env:\L7_TAG, Env:\REPLAY_REPORT -ErrorAction SilentlyContinue
        Remove-Item Env:\RISU_LIVE_SECONDS -ErrorAction SilentlyContinue
        $after = Get-Hashes
        $changed = @($before.Keys | Where-Object { $before[$_] -ne $after[$_] }) + @($after.Keys | Where-Object { -not $before.ContainsKey($_) })
        $text = Get-Content $log -Raw
        $loads = ([regex]::Matches($text, "l7-LOAD $mutant ")).Count
        $notLoaded = $text -match 'l7-NOT-LOADED'
        $failed = New-Object System.Collections.Generic.List[string]
        foreach ($line in ($text -split "`n")) {
            if ($line -match '^\s*FAIL\s+(\S+\.test\.ts)\s+>\s+(.+?)\s*$') { $entry = "$($Matches[1] -replace '^src/ts/storage/tests/','') > $($Matches[2])"; if (-not $failed.Contains($entry)) { $failed.Add($entry) } }
        }
        $props = @{}
        foreach ($line in ($text -split "`n")) {
            if ($line -match 'REPLAY-REPORT (\{.*\})') {
                $r = $Matches[1] | ConvertFrom-Json
                foreach ($p in @($r.violations | ForEach-Object { $_.property } | Sort-Object -Unique)) { $k = "$($r.schedule):$p"; $props[$k] = 1 + [int]$props[$k] }
            }
        }
        $summary = ($text -split "`n" | Where-Object { $_ -match '^\s*Tests\s' } | Select-Object -Last 1)
        $block = @("### $mutant", "- vitest exit $exit, loads $loads$(if ($notLoaded) { ', NOT LOADED' }), attempts $attempts, repository files changed $($changed.Count). $($summary.Trim())", "- failed tests ($($failed.Count)): $((@($failed | Select-Object -First 8)) -join ' ;; ')", "- corpus violations (schedule:property, seeds): $((($props.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name) x$($_.Value)" }) -join ', '))")
        if ($changed.Count -gt 0) { $block += "- CHANGED: $($changed -join '; ')" }
        Add-Content -Path $tablePath -Value ($block -join "`n")
    }
} finally {
    Pop-Location
    Remove-Item Env:\RISU_ROOT, Env:\RISU_SCRATCH -ErrorAction SilentlyContinue
}
