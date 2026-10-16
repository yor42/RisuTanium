# Server-side mutants: a patched COPY of server/node (under <OutDir>\servers\<name>) is pointed at the in-tree server tests through
# RISU_NODE_SERVER_SCRIPT (the fixture's own override); the real server.cjs is never touched. NODE_PATH lets the copy resolve express etc.
# The edit sites are CRLF text of server.cjs. Vitest runs with the repository root as its working directory.
#
#   pwsh -NoProfile -File server-mutants.ps1 [-Root <repo>] [-OutDir <dir>] [-Table <name>]
param(
    [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path,
    [string]$OutDir = (Join-Path ([System.IO.Path]::GetTempPath()) 'risu-replay-tools'),
    [string]$Table = 'mutant-table-server.md'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
New-Item -ItemType Directory -Force $OutDir | Out-Null
$node = (Get-Command node).Source
$vitest = Join-Path $Root 'node_modules\vitest\vitest.mjs'
$config = Join-Path $PSScriptRoot 'mutant.config.mjs'
$table = Join-Path $OutDir $Table
$tests = @('nodeGuardedRoutes', 'nodeHttpStore', 'nodeHttpStoreGuarded', 'nodeListPrefix', 'nodeRetire', 'nodeRevisionLog', 'nodeRoutesUnchanged', 'nodeServerRoutes', 'nodeLiveServer') | ForEach-Object { "src/ts/storage/tests/$_.test.ts" }

$mutants = [ordered]@{
    srvNone = @()
    srvRetireOutsidePrefix = @(, @("        if(store2KeyFromHex(key) === null){`r`n            return { refusal: { error: 'retire is limited to keys under the A-lite prefix' } };", "        if(false){`r`n            return { refusal: { error: 'retire is limited to keys under the A-lite prefix' } };"))
    srvUnsortedLocks = @(, @('const sortedKeys = [...new Set(keys)].sort();', 'const sortedKeys = [...new Set(keys)];'))
    srvReplayV1 = @(, @("    if(hasDelete){`r`n        return record.d === 1 ? { k: record.k, d: 1 } : null`r`n    }", "    if(hasDelete){`r`n        return null`r`n    }"))
}
$hashFiles = Get-ChildItem (Join-Path $Root 'server\node') -File | ForEach-Object { "$($_.Name) $((Get-FileHash $_.FullName -Algorithm SHA256).Hash)" }
$env:RISU_ROOT = $Root
$env:RISU_SCRATCH = $OutDir
Push-Location $Root
try {
    foreach ($name in $mutants.Keys) {
        $dir = Join-Path $OutDir "servers\$name"
        New-Item -ItemType Directory -Force $dir | Out-Null
        Get-ChildItem (Join-Path $Root 'server\node') -File | Copy-Item -Destination $dir -Force
        $script = Join-Path $dir 'server.cjs'
        $text = [System.IO.File]::ReadAllText($script)
        foreach ($edit in $mutants[$name]) {
            $count = ($text.Split([string[]]@($edit[0]), [System.StringSplitOptions]::None).Length - 1)
            if ($count -ne 1) { throw "${name}: patch site matches $count times" }
            $text = $text.Replace($edit[0], $edit[1])
        }
        [System.IO.File]::WriteAllText($script, $text)
        $log = Join-Path $OutDir "srv-$name.log"
        $env:RISU_NODE_SERVER_SCRIPT = $script
        $env:NODE_PATH = Join-Path $Root 'node_modules'
        $env:l7_MUTANT = 'none'
        $env:L7_TAG = "srv-$name"
        $env:RISU_LIVE_SECONDS = '10'
        $attempts = 0
        do {
            $attempts++
            & $node $vitest run @tests --config $config --maxWorkers=4 --reporter=verbose *> $log
            $exit = $LASTEXITCODE
        } while ($attempts -lt 3 -and ((Get-Content $log -Raw) -match 'ERR_MODULE_NOT_FOUND|Cannot find module'))
        Remove-Item Env:\RISU_NODE_SERVER_SCRIPT, Env:\NODE_PATH, Env:\l7_MUTANT, Env:\L7_TAG, Env:\RISU_LIVE_SECONDS
        $textLog = Get-Content $log -Raw
        $failed = New-Object System.Collections.Generic.List[string]
        foreach ($line in ($textLog -split "`n")) {
            if ($line -match '^\s*FAIL\s+(\S+\.test\.ts)\s+>\s+(.+?)\s*$') { $entry = "$($Matches[1] -replace '^src/ts/storage/tests/','') > $($Matches[2])"; if (-not $failed.Contains($entry)) { $failed.Add($entry) } }
        }
        $running = ([regex]::Matches($textLog, 'running the Node server from RISU_NODE_SERVER_SCRIPT')).Count
        $summary = ($textLog -split "`n" | Where-Object { $_ -match '^\s*Tests\s' } | Select-Object -Last 1)
        $after = Get-ChildItem (Join-Path $Root 'server\node') -File | ForEach-Object { "$($_.Name) $((Get-FileHash $_.FullName -Algorithm SHA256).Hash)" }
        $same = (($hashFiles -join '|') -eq ($after -join '|'))
        Add-Content $table ("### $name`n- exit $exit, fixture override announced $running times, attempts $attempts, real server dir unchanged: $same. $($summary.Trim())`n- failed ($($failed.Count)): $((@($failed | Select-Object -First 10)) -join ' ;; ')")
    }
} finally {
    Pop-Location
    Remove-Item Env:\RISU_ROOT, Env:\RISU_SCRATCH -ErrorAction SilentlyContinue
}
