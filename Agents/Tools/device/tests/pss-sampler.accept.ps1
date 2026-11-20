# Acceptance test of pss-sampler.ps1 on the PC, no device: the sampler runs as a child pwsh through the real device guard, whose
# stand-in adb (ADBG_FAKE_ADB_SCRIPT, a node script) prints canned dumpsys, pgrep and pidof output and records every argument line.
# A recording adb sentinel is first on PATH and must stay unused. Plain asserts print PASS/FAIL; exit 0 only if all hold.
#   pwsh -NoProfile -File Agents/Tools/device/tests/pss-sampler.accept.ps1 [-SamplerPath <another copy, for mutant runs>] [-ScratchBase <dir>]
# A -SamplerPath copy must sit in the tool layout: lib.ps1 beside it and ..\device-guard\adbg.mjs.
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
# One of the two spare Note 9 serials: the guard refuses a --kit call on any other serial.
$testSerial = '2ac80128013f7ece'
$packageId = 'io.github.yor42.risutanium'

# A bare "adb" must resolve only to a recording sentinel: no run of this test can start a real adb.
$sentinelDir = Join-Path $work 'no-adb'
$sentinelLog = Join-Path $sentinelDir 'sentinel.log'
New-Item -ItemType Directory -Force -Path $sentinelDir | Out-Null
Set-Content -LiteralPath (Join-Path $sentinelDir 'adb.cmd') -Encoding ascii -Value @('@echo off', ('>>"' + $sentinelLog + '" echo(%*'), 'exit /b 1')
$keptPath = @()
foreach ($dir in ($env:PATH -split ';')) {
    if (-not $dir) { continue }
    $holdsAdb = $false
    try { foreach ($ext in @('.exe', '.cmd', '.bat', '.com', '')) { if (Test-Path -LiteralPath (Join-Path $dir ('adb' + $ext)) -PathType Leaf) { $holdsAdb = $true } } } catch { $holdsAdb = $true }
    if (-not $holdsAdb) { $keptPath += $dir }
}
$env:PATH = (@($sentinelDir) + $keptPath) -join ';'
$resolvedAdb = @(Get-Command adb -CommandType Application -All -ErrorAction SilentlyContinue)
if ($resolvedAdb.Count -ne 1 -or $resolvedAdb[0].Source -ne (Join-Path $sentinelDir 'adb.cmd')) {
    Write-Output 'REFUSED a real adb is resolvable; this test never runs where a real adb can be started'
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    exit 2
}

# Decoy tree in the repository layout. Its lib appends to DECOY_MARKER when dot-sourced, so a sampler that took its lib from
# CHATSHELL_REPO_ROOT or CHATSHELL_CDP_DIR instead of from beside itself leaves the marker behind.
$decoyRoot = Join-Path $work 'decoy'
$decoyLib = Join-Path $decoyRoot 'Agents\Tools\device\lib.ps1'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $decoyLib) | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $decoyRoot 'Agents\Tools\chatshell-cdp') | Out-Null
$env:DECOY_MARKER = Join-Path $work 'decoy-marker.txt'
Set-Content -LiteralPath $decoyLib -Encoding ascii -Value @(
    'Add-Content -LiteralPath $env:DECOY_MARKER -Value (''decoy lib loaded: '' + $PSCommandPath)',
    'function Disable-StdHandleInherit { }',
    'function Initialize-AdbGuard { $true }',
    'function Get-AdbInitReason { '''' }',
    'function Test-AdbGuardRefusal { $false }',
    'function Invoke-Adb { throw ''decoy Invoke-Adb'' }')
$decoyAdb = Join-Path $work 'decoy-adb.cmd'
Set-Content -LiteralPath $decoyAdb -Encoding ascii -Value @('@echo off', ('>>"' + $env:DECOY_MARKER + '" echo decoy adb ran'), 'exit /b 0')

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
const fs = require('fs')
const a = process.argv.slice(2)
fs.appendFileSync(process.env.FAKE_CALLS, a.join(' ') + '\n')
const scenario = process.env.FAKE_SCENARIO
const out = (s) => process.stdout.write(s + '\n')
if (a[2] === 'start-server') process.exit(0)
const callLines = fs.readFileSync(process.env.FAKE_CALLS, 'utf8').split(/\r?\n/).filter((l) => l !== '')
const appTotals = callLines.filter((l) => l.endsWith('meminfo -s 1000')).length
const isTotal = a.length >= 7 && a[4] === 'meminfo' && a[5] === '-s'
const cycle = isTotal ? appTotals - 1 : appTotals
if (a[3] === 'pidof') { out('1000'); process.exit(0) }
if (a[3] === 'pgrep') {
  if (scenario === 'reresolve') out(cycle >= 8 ? '1999 2000 2001' : cycle >= 3 ? '1999 2000' : '2000')
  else out({ otherfirst: '1999 2000', ambiguous: '2000 2001', appinpgrep: '1000 2000' }[scenario] || '2000')
  process.exit(0)
}
if (isTotal) {
  const totals = { '1000': '151,492', '2000': '190,187', '1999': '190,500', '2001': '177,000' }
  out('Applications Memory Usage (in Kilobytes):')
  if (!(a[6] === '2000' && scenario === 'reresolve' && cycle === 5)) out('           TOTAL:   ' + totals[a[6]] + '      TOTAL SWAP PSS:        0')
  process.exit(0)
}
if (a[4] === 'meminfo') {
  let owned = ['2000']
  if (scenario === 'reresolve') owned = cycle >= 8 ? ['2001'] : ['2000']
  else if (scenario === 'ambiguous') owned = ['2000', '2001']
  else if (scenario === 'none') owned = []
  else if (scenario === 'foreign') owned = ['2005']
  if (a[5] !== '--package') {
    // Real Android 10 shape of the plain form: the app's own summary only, no sandbox lines.
    out('Applications Memory Usage (in Kilobytes):')
    out('Uptime: 1 Realtime: 1')
    out('')
    out('** MEMINFO in pid 1000 [io.github.yor42.risutanium] **')
    out('  190,187K: io.github.yor42.risutanium (pid 1000 / activities 1)')
    process.exit(0)
  }
  // Real shape of the --package form: one header per process; the sandbox pids are in the header brackets only.
  out('Applications Memory Usage (in Kilobytes):')
  out('Uptime: 1 Realtime: 1')
  out('')
  for (const p of owned) {
    out('** MEMINFO in pid ' + p + ' [com.google.android.webview:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:0] **')
    out('                   Pss  Private  Private  SwapPss     Heap     Heap     Heap')
    out('  TOTAL:   190187   100000')
    out('')
  }
  out('** MEMINFO in pid 1000 [io.github.yor42.risutanium] **')
  out('                   Pss  Private  Private  SwapPss     Heap     Heap     Heap')
  out('  TOTAL:   151492   100000')
  process.exit(0)
}
out('unexpected call')
process.exit(0)
'@
$fakeAdb = Join-Path $work 'fake-adb.cjs'
Set-Content -LiteralPath $fakeAdb -Value $fakeAdbSource -Encoding ascii
# The guard starts this node script in place of adb; it is the only adb stand-in of the test.
$env:ADBG_FAKE_ADB_SCRIPT = $fakeAdb

# $SamplerArguments are the sampler's own arguments; the log, the guard log and (unless -NoGuardLog) the guard log argument are added here.
function Invoke-SamplerRun([string]$Scenario, [string[]]$SamplerArguments, [string]$Name, [switch]$NoGuardLog, [string[]]$ExtraArguments = @(), [hashtable]$Environment = @{}) {
    $callsFile = Join-Path $work ($Name + '.calls')
    $logFile = Join-Path $work ($Name + '.log')
    $guardLogFile = Join-Path $work ($Name + '-guard\adb-commands.log')
    Remove-Item -LiteralPath $callsFile, $logFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Split-Path -Parent $guardLogFile) -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $env:DECOY_MARKER -Force -ErrorAction SilentlyContinue
    $env:FAKE_CALLS = $callsFile
    $env:FAKE_SCENARIO = $Scenario
    $guardArguments = if ($NoGuardLog) { @() } else { @('-GuardLog', $guardLogFile) }
    $saved = @{}
    foreach ($key in $Environment.Keys) { $saved[$key] = [Environment]::GetEnvironmentVariable($key); [Environment]::SetEnvironmentVariable($key, [string]$Environment[$key]) }
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try { $output = @(& $pwshExe -NoProfile -File $samplerFile @SamplerArguments -LogPath $logFile @guardArguments @ExtraArguments 2>&1) }
    finally { foreach ($key in $Environment.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key]) } }
    $code = $LASTEXITCODE
    $watch.Stop()
    $rows = @()
    if (Test-Path -LiteralPath $logFile) { $rows = @(Get-Content -LiteralPath $logFile | ForEach-Object { , ($_ -split "`t") }) }
    $calls = @()
    if (Test-Path -LiteralPath $callsFile) { $calls = @(Get-Content -LiteralPath $callsFile) }
    $guardText = ''
    if (Test-Path -LiteralPath $guardLogFile) { $guardText = [IO.File]::ReadAllText($guardLogFile) }
    return [pscustomobject]@{ Code = $code; Output = ($output -join "`n"); Rows = $rows; Calls = $calls; Ms = $watch.ElapsedMilliseconds; LogFile = $logFile; GuardLogFile = $guardLogFile; GuardText = $guardText }
}
# Calls the fake received that are not the guard's start-server of the run's start.
function Get-SamplerCalls($Run) { return @($Run.Calls | Where-Object { $_ -notlike '* start-server' }) }
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

# 10 -GuardLog is required: exit 2 before any adb call or guard start
$run = Invoke-SamplerRun 'normal' ($commonArguments + @('-MaxCycles', '2')) 'noguardlog' -NoGuardLog
Assert-Check ($run.Code -eq 2 -and $run.Calls.Count -eq 0 -and $run.Output -match '-GuardLog is required') ('10 no -GuardLog exits 2 with no adb call (exit ' + $run.Code + ', calls ' + $run.Calls.Count + ')')

# 11 every call runs through the guard: each fake call has an intent line and nothing is refused; the start-server files sit in adb-<pid> beside the guard log
$run = Invoke-SamplerRun 'normal' ($commonArguments + @('-MaxCycles', '3')) 'guarded'
$intentCount = @([regex]::Matches($run.GuardText, '(?m)^\S+ intent: adb -s ' + $testSerial + ' ')).Count
Assert-Check ($run.Code -eq 0 -and $run.Calls.Count -gt 1 -and $intentCount -eq $run.Calls.Count -and $run.GuardText -notmatch 'REFUSED') ('11 every adb call the stand-in received has an intent line in the guard log and none is refused (calls ' + $run.Calls.Count + ', intents ' + $intentCount + ')')
Assert-Check (@($run.Calls | Where-Object { $_ -like '* start-server' }).Count -eq 1) '11 the guard start sends exactly one start-server'
$startDirs = @(Get-ChildItem -LiteralPath (Split-Path -Parent $run.GuardLogFile) -Directory -Filter 'adb-*' -ErrorAction SilentlyContinue)
Assert-Check ($startDirs.Count -eq 1 -and (Test-Path -LiteralPath (Join-Path $startDirs[0].FullName 'adb-start-server.out'))) '11 the start-server output files sit in one adb-<pid> folder beside the guard log'

# 12 a refusal never reads as "app not running": a danger-zone pidof ends the run with exit 4, no DROP line and no further call
$run = Invoke-SamplerRun 'normal' @('-Serial', $testSerial, '-SleepMs', '0', '-MaxCycles', '3', '-Package', 'call') 'refused'
Assert-Check ($run.Code -eq 4 -and $run.Output -match 'guard refused' -and $run.Output -match 'exit 89' -and $run.Output.Contains($run.GuardLogFile)) ('12 the refused pidof exits 4 and names the guard exit 89 and the guard log (exit ' + $run.Code + ')')
Assert-Check ($run.Rows.Count -eq 0 -and $run.Output -notmatch 'DROP' -and (Get-SamplerCalls $run).Count -eq 0 -and $run.GuardText -match 'exit=89') '12 no DROP line is written and no call follows the refusal'

# 13 a serial the guard refuses for kit calls ends the run at the start with the guard's reason; nothing reaches the stand-in adb and no decoy lib is loaded
foreach ($refusedSerial in @(@('emulator-5580', 'two spare Note 9s', 97), @('R5CT1234ABC', 'adbg exit 95', 95))) {
    $decoyEnvironment = @{ CHATSHELL_REPO_ROOT = $decoyRoot; CHATSHELL_CDP_DIR = (Join-Path $decoyRoot 'Agents\Tools\chatshell-cdp') }
    $run = Invoke-SamplerRun 'normal' @('-Serial', $refusedSerial[0], '-SleepMs', '0', '-MaxCycles', '2') ('serial-' + $refusedSerial[2]) -Environment $decoyEnvironment
    Assert-Check ($run.Code -eq 4 -and $run.Output -match $refusedSerial[1] -and $run.Calls.Count -eq 0 -and $run.Rows.Count -eq 0 -and $run.Output -notmatch 'DROP') ('13 ' + $refusedSerial[0] + ' exits 4 with the guard reason, no call and no DROP line (exit ' + $run.Code + ')')
    Assert-Check ($run.GuardText -match ('REFUSED/ERROR exit=' + $refusedSerial[2]) -and $run.GuardText -notmatch '(?m)^\S+ intent:' -and -not (Test-Path -LiteralPath $env:DECOY_MARKER)) ('13 ' + $refusedSerial[0] + ': the guard log holds the refusal and no intent, and the decoy lib is never loaded')
}

# 14 no alternate adb or guard: -AdbExe, HARNESS_ADB, TB_GUARD, ADBG_PATH and the decoy tree are never used, and the run still goes through the guard
$noOverride = @{ HARNESS_ADB = $decoyAdb; TB_GUARD = $decoyAdb; ADBG_PATH = $decoyAdb; CHATSHELL_REPO_ROOT = $decoyRoot; CHATSHELL_CDP_DIR = (Join-Path $decoyRoot 'Agents\Tools\chatshell-cdp') }
$run = Invoke-SamplerRun 'normal' ($commonArguments + @('-MaxCycles', '2')) 'nooverride' -ExtraArguments @('-AdbExe', $decoyAdb) -Environment $noOverride
Assert-Check ($run.Code -eq 0 -and $run.Rows.Count -eq 2 -and -not (Test-Path -LiteralPath $env:DECOY_MARKER) -and $run.GuardText -match '(?m)^\S+ intent: ') '14 no override runs a decoy, no decoy lib is loaded, and the calls are in the guard log'

$sentinelText = ''
if (Test-Path -LiteralPath $sentinelLog) { $sentinelText = [IO.File]::ReadAllText($sentinelLog) }
Assert-Check ($sentinelText -eq '') ('15 no run started adb bare (the PATH sentinel log is empty: "' + $sentinelText.Trim() + '")')

Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
Write-Output ($(if ($script:failures -eq 0) { 'ALL PASSED' } else { 'FAILED: ' + $script:failures }))
exit ([int]($script:failures -ne 0))
