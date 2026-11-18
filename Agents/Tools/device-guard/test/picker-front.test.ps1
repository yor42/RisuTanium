# Fake-adb cases for the adbg r15 picker-in-front rule (MC-2273): swipe and hold on the two playground Note 9s also pass
# when the system file picker holds the foreground. Usage: pwsh -File picker-front.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake.mjs'
$calls = Join-Path $testDir 'calls.txt'
# The fake adb records every call as one JSON array. FAKE_PIDS maps a package to its pid (a missing package makes pidof
# exit 1 with no output); FAKE_ADJ maps a pid to its oom_score_adj (a missing pid reads 900, a background app).
Set-Content $fake 'import { appendFileSync } from "node:fs"; const a = process.argv.slice(2); appendFileSync(process.env.FAKE_CALLS, JSON.stringify(a) + "\n"); const j = a.slice(2).join(" "); const pids = JSON.parse(process.env.FAKE_PIDS ?? "{}"); const adj = JSON.parse(process.env.FAKE_ADJ ?? "{}"); let m; if ((m = j.match(/^shell pidof (\S+)$/))) { if (pids[m[1]] === undefined) process.exit(1); process.stdout.write(String(pids[m[1]])) } else if ((m = j.match(/^shell cat \/proc\/(\d+)\/oom_score_adj$/))) { process.stdout.write(String(adj[m[1]] ?? 900)) } process.exit(0)'
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_CALLS = $calls
# Every guard spawn goes through the stand-in adb; never run a case where it is not in place.
if (-not $env:ADBG_FAKE_ADB_SCRIPT -or -not (Test-Path -LiteralPath $env:ADBG_FAKE_ADB_SCRIPT)) { throw 'ADBG_FAKE_ADB_SCRIPT is not set to an existing fake: refusing to run' }
$log = Join-Path $testDir 'log.txt'
$st = Join-Path $testDir 'state.json'
$script:failures = 0
$pg = @('29f3cde9193f7ece', '2ac80128013f7ece')
$pkg = 'io.github.yor42.risutanium'
$dui = 'com.android.documentsui'
$gdui = 'com.google.android.documentsui'
function Test-Result([string]$label, [bool]$ok, [string]$detail) {
    if (-not $ok) { $script:failures++ }
    ($(if ($ok) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' ' + $detail
}
# The leading comma keeps a single call an array, so indexing and Count behave the same for one call as for several.
function Get-Calls { if (Test-Path $calls) { , @(Get-Content $calls) } else { , @() } }
function Reset-Calls { if (Test-Path $calls) { Remove-Item $calls } }
function Get-LogText { if (Test-Path $log) { Get-Content $log -Raw } else { '' } }
# The locate is 100x50 at (10,10), so its centre is 60,35.
function Set-LocateRecord([string]$loc) {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $o = @{ picks = @(); pickErrors = 0; offset = $null; pickLocked = $false; locates = @(@{ id = 1; time = $now; label = 'css:#thing'; bounds = @{ l = 10; t = 10; r = 110; b = 60 }; used = $false; serial = $loc }) }
    ConvertTo-Json $o -Depth 5 | Set-Content $st
}
function Get-LocateUsed { [bool]((Get-Content $st -Raw | ConvertFrom-Json).locates[0].used) }
function ConvertTo-Json1($value) { ConvertTo-Json -Compress -InputObject $value }
# One gesture call with the given package-to-pid and pid-to-adj maps; returns the exit code.
function Invoke-Gesture([string]$ser, [string]$verb, [hashtable]$pids, [hashtable]$adjs) {
    Set-LocateRecord $ser
    Reset-Calls
    Remove-Item $log -ErrorAction SilentlyContinue
    $env:FAKE_PIDS = ConvertTo-Json1 $pids
    $env:FAKE_ADJ = ConvertTo-Json1 $adjs
    $c = @('--serial', $ser, '--log', $log, '--state', $st, '--own-package', $pkg, '--max-age', '10')
    if ($verb -eq 'hold') { & node $GuardPath hold @c --duration-ms 800 2>$null | Out-Null }
    else { & node $GuardPath swipe @c --dx 0 --dy -300 --duration-ms 400 2>$null | Out-Null }
    [string]$LASTEXITCODE
}
function Get-Gesture([string]$ser, [string]$verb) {
    if ($verb -eq 'hold') { '["-s","' + $ser + '","shell","input","swipe","60","35","60","35","800"]' }
    else { '["-s","' + $ser + '","shell","input","swipe","60","35","60","-265","400"]' }
}
function Get-Pidof([string]$ser, [string]$p) { '["-s","' + $ser + '","shell","pidof ' + $p + '"]' }
function Get-Adj([string]$ser, [string]$n) { '["-s","' + $ser + '","shell","cat /proc/' + $n + '/oom_score_adj"]' }
# A passing gesture: exit 0, exactly the wanted calls in order, the locate consumed, the front= line as wanted.
function Test-Passes([string]$label, [string]$ser, [string]$verb, [hashtable]$pids, [hashtable]$adjs, [string[]]$want, [string]$wantFront) {
    $rc = Invoke-Gesture $ser $verb $pids $adjs
    $got = Get-Calls
    $text = Get-LogText
    $frontOk = if ($wantFront -eq '') { -not $text.Contains(' front=') } else { $text.Contains('PLAYGROUND serial=' + $ser + ' front=' + $wantFront + ' (system file picker, MC-2273)') }
    Test-Result $label ($rc -eq '0' -and (($got -join '|') -eq ($want -join '|')) -and (Get-LocateUsed) -and $frontOk) ('-> ' + $rc + ' calls=' + ($got -join ' | '))
}
# A refused gesture: 93, no input call, the locate left unused, no front= line.
function Test-Front93([string]$label, [string]$ser, [string]$verb, [hashtable]$pids, [hashtable]$adjs) {
    $rc = Invoke-Gesture $ser $verb $pids $adjs
    $got = Get-Calls
    $noInput = -not (($got -join ' ').Contains('input swipe'))
    Test-Result $label ($rc -eq '93' -and $noInput -and -not (Get-LocateUsed) -and -not (Get-LogText).Contains(' front=')) ('-> ' + $rc + ' calls=' + ($got -join ' | '))
}

foreach ($s in $pg) {
    foreach ($verb in @('hold', 'swipe')) {
        # PK1: the documents UI in front, own package in the background.
        Test-Passes ($s + ' ' + $verb + ' PK1 documentsui in front') $s $verb @{ $pkg = 4242; $dui = 5151 } @{ '4242' = 100; '5151' = 0 } @((Get-Pidof $s $pkg), (Get-Adj $s '4242'), (Get-Pidof $s $dui), (Get-Adj $s '5151'), (Get-Gesture $s $verb)) $dui
        # PK2: the Google documents UI in front; the first picker has no process.
        Test-Passes ($s + ' ' + $verb + ' PK2 google documentsui in front') $s $verb @{ $pkg = 4242; $gdui = 6161 } @{ '4242' = 200; '6161' = 0 } @((Get-Pidof $s $pkg), (Get-Adj $s '4242'), (Get-Pidof $s $dui), (Get-Pidof $s $gdui), (Get-Adj $s '6161'), (Get-Gesture $s $verb)) $gdui
        # PK7 (accepted limit): the own package need not be running while a picker is in front.
        Test-Passes ($s + ' ' + $verb + ' PK7 picker in front, own package not running') $s $verb @{ $dui = 5151 } @{ '5151' = 0 } @((Get-Pidof $s $pkg), (Get-Pidof $s $dui), (Get-Adj $s '5151'), (Get-Gesture $s $verb)) $dui
    }
}
# PK4: the own package in front keeps exactly today's three calls and no picker probe, even with a picker also at 0.
foreach ($s in $pg) {
    foreach ($verb in @('hold', 'swipe')) {
        Test-Passes ($s + ' ' + $verb + ' PK4 own package in front') $s $verb @{ $pkg = 4242; $dui = 5151 } @{ '4242' = 0; '5151' = 0 } @((Get-Pidof $s $pkg), (Get-Adj $s '4242'), (Get-Gesture $s $verb)) ''
    }
}
# PK5: another app at 0 does not count, whatever its name.
foreach ($verb in @('hold', 'swipe')) {
    Test-Front93 ('PK5 ' + $verb + ' other apps in front') $pg[0] $verb @{ $pkg = 4242; 'com.sec.android.app.myfiles' = 7171; 'com.android.chrome' = 8181 } @{ '4242' = 100; '7171' = 0; '8181' = 0 }
}
# PK6: a picker that is not at adj 0 does not count (visible, then service-level adj).
foreach ($adjValue in @(100, 200)) {
    foreach ($verb in @('hold', 'swipe')) {
        Test-Front93 ('PK6 ' + $verb + ' pickers at adj ' + $adjValue) $pg[1] $verb @{ $pkg = 4242; $dui = 5151; $gdui = 6161 } @{ '4242' = 100; '5151' = $adjValue; '6161' = $adjValue }
    }
}
# PK8: the emulator never probes a picker.
foreach ($verb in @('hold', 'swipe')) {
    $rc = Invoke-Gesture 'emulator-5580' $verb @{ $pkg = 4242; $dui = 5151; $gdui = 6161 } @{ '4242' = 100; '5151' = 0; '6161' = 0 }
    $joined = (Get-Calls) -join ' '
    Test-Result ('PK8 emulator ' + $verb + ' with pickers at 0') ($rc -eq '93' -and -not $joined.Contains('documentsui') -and -not $joined.Contains('input swipe')) ('-> ' + $rc + ' calls=' + $joined)
}
# PK9: restricted and near-miss serials give 95 before any call.
foreach ($s in @('R58M12345AB', '2ac80128013f7ecf', '29F3CDE9193F7ECE')) {
    foreach ($verb in @('hold', 'swipe')) {
        $rc = Invoke-Gesture $s $verb @{ $pkg = 4242; $dui = 5151 } @{ '4242' = 100; '5151' = 0 }
        Test-Result ('PK9 ' + $s + ' ' + $verb) ($rc -eq '95' -and (Get-Calls).Count -eq 0) ('-> ' + $rc + ' calls=' + (Get-Calls).Count)
    }
}

Remove-Item Env:ADBG_FAKE_ADB_SCRIPT; Remove-Item Env:FAKE_CALLS; Remove-Item Env:FAKE_PIDS; Remove-Item Env:FAKE_ADJ
Remove-Item -LiteralPath $testDir -Recurse -Force -ErrorAction SilentlyContinue
'failures=' + $script:failures
exit $script:failures
