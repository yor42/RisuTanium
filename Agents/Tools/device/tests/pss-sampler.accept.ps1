# Acceptance test of pss-sampler.ps1 on the PC, no device: the sampler runs as a child pwsh against a fake -AdbExe script that prints
# canned dumpsys, pgrep and pidof output and records every argument line. Plain asserts print PASS/FAIL; exit 0 only if all hold.
#   pwsh -NoProfile -File Agents/Tools/device/tests/pss-sampler.accept.ps1 [-SamplerPath <another copy, for mutant runs>] [-ScratchBase <dir>]
param(
    [string]$SamplerPath,
    [string]$ScratchBase
)
$ErrorActionPreference = 'Stop'
if (-not $SamplerPath) { $SamplerPath = (Join-Path $PSScriptRoot '..\pss-sampler.ps1') }
if (-not $ScratchBase) { $ScratchBase = Join-Path $env:TEMP 'risu-b715\devbatch33\pss-accept' }
$work = Join-Path $ScratchBase ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$samplerFile = (Resolve-Path -LiteralPath $SamplerPath).Path
$pwshExe = (Get-Process -Id $PID).Path
$testSerial = 'TESTSERIAL01'
$packageId = 'io.github.yor42.risutanium'

$script:failures = 0
function Assert-Check([bool]$Condition, [string]$Message) {
    if ($Condition) { Write-Output ('PASS ' + $Message) } else { Write-Output ('FAIL ' + $Message); $script:failures++ }
}

# Fake adb. Pids: app 1000; owned sandbox 2000 (190,187 KiB); another app's sandbox 1999 (190,500 KiB, within 5 percent); a later
# owned sandbox 2001 (177,000 KiB). The cycle number is the count of app-total calls recorded so far. FAKE_SCENARIO selects:
#   normal      pgrep 2000, listing owns 2000
#   otherfirst  pgrep 1999 2000, listing owns 2000
#   reresolve   from cycle 3 pgrep 1999 2000 (and 2001 from cycle 8); the listing owns 2000, from cycle 8 it owns 2001;
#               the sandbox total of cycle 5 is a 0 reading
#   ambiguous   pgrep 2000 2001, listing owns both
#   none        pgrep 2000, listing owns no sandbox pid
#   foreign     pgrep 2000, listing owns 2005 only
#   appinpgrep  pgrep 1000 2000 (the app's own non-sandbox header pid is also in the pgrep set), listing owns 2000
$fakeAdbSource = @'
$lineText = $args -join ' '
Add-Content -LiteralPath $env:FAKE_CALLS -Value $lineText
$scenario = $env:FAKE_SCENARIO
$callLines = @(Get-Content -LiteralPath $env:FAKE_CALLS)
$appTotals = @($callLines | Where-Object { $_ -like '*meminfo -s 1000' }).Count
$isTotal = ($args.Count -ge 7 -and $args[4] -eq 'meminfo' -and $args[5] -eq '-s')
$cycle = if ($isTotal) { $appTotals - 1 } else { $appTotals }
if ($args[3] -eq 'pidof') { '1000'; exit 0 }
if ($args[3] -eq 'pgrep') {
    switch ($scenario) {
        'normal' { '2000' }
        'otherfirst' { '1999 2000' }
        'reresolve' { if ($cycle -ge 8) { '1999 2000 2001' } elseif ($cycle -ge 3) { '1999 2000' } else { '2000' } }
        'ambiguous' { '2000 2001' }
        'appinpgrep' { '1000 2000' }
        default { '2000' }
    }
    exit 0
}
if ($isTotal) {
    $totals = @{ '1000' = '151,492'; '2000' = '190,187'; '1999' = '190,500'; '2001' = '177,000' }
    if ($args[6] -eq '2000' -and $scenario -eq 'reresolve' -and $cycle -eq 5) { 'Applications Memory Usage (in Kilobytes):'; exit 0 }
    'Applications Memory Usage (in Kilobytes):'
    ('           TOTAL:   ' + $totals[$args[6]] + '      TOTAL SWAP PSS:        0')
    exit 0
}
if ($args[4] -eq 'meminfo') {
    $ownedPids = switch ($scenario) {
        'reresolve' { if ($cycle -ge 8) { @('2001') } else { @('2000') } }
        'ambiguous' { @('2000', '2001') }
        'none' { @() }
        'foreign' { @('2005') }
        default { @('2000') }
    }
    if ($args[5] -ne '--package') {
        # Real Android 10 shape of the plain form: the app's own summary only, no sandbox lines.
        'Applications Memory Usage (in Kilobytes):'
        'Uptime: 1 Realtime: 1'
        ''
        '** MEMINFO in pid 1000 [io.github.yor42.risutanium] **'
        '  190,187K: io.github.yor42.risutanium (pid 1000 / activities 1)'
        exit 0
    }
    # Real shape of the --package form: one header per process; the sandbox pids are in the header brackets only.
    'Applications Memory Usage (in Kilobytes):'
    'Uptime: 1 Realtime: 1'
    ''
    foreach ($ownedPid in $ownedPids) {
        ('** MEMINFO in pid ' + $ownedPid + ' [com.google.android.webview:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:0] **')
        '                   Pss  Private  Private  SwapPss     Heap     Heap     Heap'
        '  TOTAL:   190187   100000'
        ''
    }
    '** MEMINFO in pid 1000 [io.github.yor42.risutanium] **'
    '                   Pss  Private  Private  SwapPss     Heap     Heap     Heap'
    '  TOTAL:   151492   100000'
    exit 0
}
'unexpected call'
exit 0
'@
$fakeAdb = Join-Path $work 'fake-adb.ps1'
Set-Content -LiteralPath $fakeAdb -Value $fakeAdbSource -Encoding ascii

function Invoke-SamplerRun([string]$Scenario, [string[]]$SamplerArguments, [string]$Name) {
    $callsFile = Join-Path $work ($Name + '.calls')
    $logFile = Join-Path $work ($Name + '.log')
    Remove-Item -LiteralPath $callsFile, $logFile -Force -ErrorAction SilentlyContinue
    $env:FAKE_CALLS = $callsFile
    $env:FAKE_SCENARIO = $Scenario
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $output = @(& $pwshExe -NoProfile -File $samplerFile @SamplerArguments -LogPath $logFile -AdbExe $fakeAdb 2>&1)
    $code = $LASTEXITCODE
    $watch.Stop()
    $rows = @()
    if (Test-Path -LiteralPath $logFile) { $rows = @(Get-Content -LiteralPath $logFile | ForEach-Object { , ($_ -split "`t") }) }
    $calls = @()
    if (Test-Path -LiteralPath $callsFile) { $calls = @(Get-Content -LiteralPath $callsFile) }
    return [pscustomobject]@{ Code = $code; Output = ($output -join "`n"); Rows = $rows; Calls = $calls; Ms = $watch.ElapsedMilliseconds; LogFile = $logFile }
}
$commonArguments = @('-Serial', $testSerial, '-SleepMs', '0')

# 1 refused serials: no adb call at all
foreach ($badSerial in @('', '   ')) {
    $run = Invoke-SamplerRun 'normal' @('-Serial', $badSerial, '-SleepMs', '0', '-MaxCycles', '2') 'empty'
    Assert-Check ($run.Code -eq 2 -and $run.Calls.Count -eq 0) ("1 serial '" + $badSerial + "' exits 2 and the fake adb log is empty (exit " + $run.Code + ', calls ' + $run.Calls.Count + ')')
}
$run = Invoke-SamplerRun 'normal' @('-Serial', 'OTHER', '-AllowedSerials', 'A,B', '-SleepMs', '0', '-MaxCycles', '2') 'allowed'
Assert-Check ($run.Code -eq 2 -and $run.Calls.Count -eq 0) '1 a serial outside -AllowedSerials exits 2 without an adb call'

# 2 and 3 normal run: every call has -s <serial> first; the totals are parsed from the right column
$run = Invoke-SamplerRun 'normal' ($commonArguments + @('-MaxCycles', '3')) 'normal'
Assert-Check ($run.Code -eq 0 -and $run.Rows.Count -eq 3) ('normal run ends after 3 cycles with exit 0 (exit ' + $run.Code + ', rows ' + $run.Rows.Count + ')')
Assert-Check ($run.Calls.Count -gt 0 -and @($run.Calls | Where-Object { -not $_.StartsWith('-s ' + $testSerial + ' ') }).Count -eq 0) '2 every recorded adb call has -s <serial> first'
Assert-Check ($run.Rows.Count -gt 0 -and @($run.Rows | Where-Object { $_[1] -eq '151492' -and $_[2] -eq '190187' -and $_.Count -eq 3 }).Count -eq $run.Rows.Count) '3 TOTAL 151,492 (app) and 190,187 (sandbox) are logged as plain KiB in the right columns'

# 4 start ownership: another app's sandbox pid comes first in pgrep and has a similar total
$run = Invoke-SamplerRun 'otherfirst' ($commonArguments + @('-MaxCycles', '3')) 'otherfirst'
Assert-Check ($run.Rows.Count -eq 3 -and @($run.Rows | Where-Object { $_[2] -eq '190187' }).Count -eq 3 -and $run.Output -notmatch '190500') '4 the owned sandbox pid is sampled, not the first pgrep pid'
Assert-Check (@($run.Rows | Where-Object { $_[2] -eq '190500' }).Count -eq 0) '4 the other app total never appears in the log'

# 4b a non-sandbox header whose pid is also in the pgrep set is not owned: the sandbox pid is still the single candidate
$run = Invoke-SamplerRun 'appinpgrep' ($commonArguments + @('-MaxCycles', '3')) 'appinpgrep'
Assert-Check ($run.Rows.Count -eq 3 -and @($run.Rows | Where-Object { $_.Count -eq 3 -and $_[1] -eq '151492' -and $_[2] -eq '190187' }).Count -eq 3) '4b a non-sandbox header pid in the pgrep set is not treated as owned'

# 5 re-resolve: 12 cycles, other pid first from cycle 3, a 0 reading at cycle 5, the owned pid changes at cycle 8
$run = Invoke-SamplerRun 'reresolve' ($commonArguments + @('-MaxCycles', '12')) 'reresolve'
$sandboxColumn = @($run.Rows | ForEach-Object { $_[2] })
Assert-Check ($run.Rows.Count -eq 12 -and -not ($sandboxColumn -contains '190500')) ('5 the other app total never appears over 12 cycles (' + ($sandboxColumn -join ',') + ')')
Assert-Check ($sandboxColumn.Count -eq 12 -and $sandboxColumn[5] -eq '0') '5 the 0 reading at cycle 5 is logged as 0'
Assert-Check ($sandboxColumn.Count -eq 12 -and $sandboxColumn[6] -eq '190187' -and $sandboxColumn[7] -eq '190187') '5 the 0 reading forces a full ownership resolve that selects the owned pid, not the first pgrep pid'
Assert-Check ($sandboxColumn.Count -eq 12 -and $sandboxColumn[10] -eq '177000' -and $sandboxColumn[11] -eq '177000') '5 the periodic resolve at cycle 10 reads the listing again and follows the changed owned pid'
$listingCalls = @($run.Calls | Where-Object { $_ -like ('*meminfo --package ' + $packageId) }).Count
Assert-Check ($listingCalls -eq 3) ('5 the --package listing is fetched on every resolve (3 resolves: start, after the 0 reading, cycle 10; got ' + $listingCalls + ')')
Assert-Check (@($run.Calls | Where-Object { $_ -like ('*meminfo ' + $packageId) }).Count -eq 0) '5 the plain meminfo form, which prints no sandbox lines, is never used for ownership'

# 6 ambiguity and absence: a dropped cycle, never a pick, and the third consecutive drop exits 3 (7)
foreach ($scenarioName in @('ambiguous', 'none', 'foreign')) {
    $run = Invoke-SamplerRun $scenarioName ($commonArguments + @('-MaxSeconds', '8')) $scenarioName
    $dropRows = @($run.Rows | Where-Object { $_.Count -eq 4 -and $_[1] -eq '0' -and $_[2] -eq '0' -and $_[3] -eq 'DROP-owner' })
    Assert-Check ($run.Rows.Count -eq 3 -and $dropRows.Count -eq 3) ("6 scenario '" + $scenarioName + "' logs three DROP-owner lines and no sampled value (rows " + $run.Rows.Count + ')')
    Assert-Check ($run.Code -eq 3 -and $run.Ms -lt 7000) ("7 scenario '" + $scenarioName + "' exits 3 after three consecutive drops (exit " + $run.Code + ', ' + $run.Ms + ' ms)')
    Assert-Check (@($run.Calls | Where-Object { $_ -like '*meminfo -s *' }).Count -eq 0) ("6 scenario '" + $scenarioName + "' samples no pid")
}

# 8 no package or process name in the log or the output
$run = Invoke-SamplerRun 'normal' ($commonArguments + @('-MaxCycles', '2')) 'names'
$logText = (Get-Content -LiteralPath $run.LogFile -Raw)
Assert-Check ($logText -notmatch 'risutanium|sandboxed|webview|yor42' -and $run.Output -notmatch 'risutanium|sandboxed|webview|yor42') '8 neither the log nor the output holds a package or process name'

# 9 deadline
$run = Invoke-SamplerRun 'normal' @('-Serial', $testSerial, '-MaxSeconds', '1', '-MaxCycles', '20') 'deadline'
Assert-Check ($run.Code -eq 0 -and $run.Ms -lt 3000 -and $run.Rows.Count -ge 1) ('9 -MaxSeconds 1 ends within 3 s (' + $run.Ms + ' ms, ' + $run.Rows.Count + ' rows)')

Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
Write-Output ($(if ($script:failures -eq 0) { 'ALL PASSED' } else { 'FAILED: ' + $script:failures }))
exit ([int]($script:failures -ne 0))
