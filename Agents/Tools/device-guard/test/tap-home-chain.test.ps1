# Fake-adb cases for the adbg tap-home chained verb. Usage: pwsh -File tap-home-chain.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake.mjs'
$calls = Join-Path $testDir 'calls.txt'
# The fake adb records every call with an epoch-ms time; only `input tap` takes FAKE_TAP_EXIT as its exit code.
Set-Content $fake 'import { appendFileSync } from "node:fs"; const a = process.argv.slice(2); appendFileSync(process.env.FAKE_CALLS, Date.now() + " " + a.join(" ") + "\n"); process.exit(a.includes("tap") ? Number(process.env.FAKE_TAP_EXIT || 0) : 0)'
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_CALLS = $calls
$env:FAKE_TAP_EXIT = '0'
$log = Join-Path $testDir 'log.txt'
$st = Join-Path $testDir 'state.json'
$script:failures = 0
$phone = '29f3cde9193f7ece'
function Test-Result([string]$label, [bool]$ok, [string]$detail) {
    if (-not $ok) { $script:failures++ }
    ($(if ($ok) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' ' + $detail
}
function Invoke-GuardCase([string]$label, [string]$want, [string[]]$guardArgs) {
    & node $GuardPath @guardArgs 2>$null | Out-Null
    Test-Result $label ([string]$LASTEXITCODE -eq $want) ('-> ' + $LASTEXITCODE + ' (want ' + $want + ')')
}
function Get-Calls { if (Test-Path $calls) { @(Get-Content $calls) } else { @() } }
function Reset-Calls { if (Test-Path $calls) { Remove-Item $calls } }
function Set-LocateRecord([string]$loc = '29f3cde9193f7ece', [int]$ageMs = 0, [bool]$used = $false) {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $ageMs
    $o = @{ picks = @(); pickErrors = 0; offset = $null; pickLocked = $false; locates = @(@{ id = 1; time = $now; label = 'css:#home'; bounds = @{ l = 10; t = 10; r = 110; b = 60 }; used = $used; serial = $loc }) }
    ConvertTo-Json $o -Depth 5 | Set-Content $st
}
$c = @('--serial', $phone, '--log', $log, '--state', $st)

# happy path: tap then HOME in one call, order and delay recorded
Set-LocateRecord; Reset-Calls
Invoke-GuardCase 'happy' '0' (@('tap-home') + $c + @('--delay-ms', '200'))
$got = @(Get-Calls)
Test-Result 'two adb calls' ($got.Count -eq 2) ('count=' + $got.Count)
if ($got.Count -eq 2) {
    Test-Result 'tap first at locate centre' ($got[0] -match 'input tap 60 35$') $got[0]
    Test-Result 'HOME second' ($got[1] -match 'input keyevent KEYCODE_HOME$') $got[1]
    $gap = [int64]($got[1].Split(' ')[0]) - [int64]($got[0].Split(' ')[0])
    Test-Result 'gap at least delay' ($gap -ge 195) ('gap=' + $gap)
}
$logText = Get-Content $log -Raw
Test-Result 'log has timing line' ($logText -match 'tap-home timing: .*delay 200 ms') ''
$m = [regex]::Match($logText, 'tap-to-home gap (\d+) ms after tap end')
Test-Result 'logged gap at least delay' ($m.Success -and [int]$m.Groups[1].Value -ge 200) ('gap=' + $m.Groups[1].Value)
Test-Result 'log has tap and HOME intent lines' (($logText -match 'intent: adb -s \S+ \["shell","input","tap","60","35"\]') -and ($logText -match '"KEYCODE_HOME"\]')) ''

# a second tap-home on the consumed locate is refused, no calls
Reset-Calls
Invoke-GuardCase 'locate consumed' '99' (@('tap-home') + $c + @('--delay-ms', '0'))
Test-Result 'consumed: no adb call' ((Get-Calls).Count -eq 0) ''
Invoke-GuardCase 'plain tap on consumed locate' '99' (@('tap') + $c)

# stale locate
Set-LocateRecord -ageMs 20000; Reset-Calls
Invoke-GuardCase 'stale locate' '99' (@('tap-home') + $c + @('--delay-ms', '0'))
Test-Result 'stale: no adb call' ((Get-Calls).Count -eq 0) ''

# used locate
Set-LocateRecord -used $true; Reset-Calls
Invoke-GuardCase 'used locate' '99' (@('tap-home') + $c + @('--delay-ms', '0'))
Test-Result 'used: no adb call' ((Get-Calls).Count -eq 0) ''

# missing locate (state with no locates)
ConvertTo-Json @{ picks = @(); pickErrors = 0; offset = $null; pickLocked = $false; locates = @() } -Depth 5 | Set-Content $st
Reset-Calls
Invoke-GuardCase 'missing locate' '99' (@('tap-home') + $c + @('--delay-ms', '0'))
Test-Result 'missing: no adb call' ((Get-Calls).Count -eq 0) ''

# delay validation (exit 2, locate left unused, no adb call)
foreach ($bad in @('-1', '501', '1.5', 'abc', '', '0x10', '1e2')) {
    Set-LocateRecord; Reset-Calls
    Invoke-GuardCase ('delay [' + $bad + ']') '2' (@('tap-home') + $c + @('--delay-ms', $bad))
    Test-Result ('delay [' + $bad + '] no adb call') ((Get-Calls).Count -eq 0) ''
}
Set-LocateRecord; Reset-Calls
Invoke-GuardCase 'delay missing' '2' (@('tap-home') + $c)
Set-LocateRecord; Reset-Calls
Invoke-GuardCase 'delay 0 ok' '0' (@('tap-home') + $c + @('--delay-ms', '0'))
Set-LocateRecord; Reset-Calls
Invoke-GuardCase 'delay 500 ok' '0' (@('tap-home') + $c + @('--delay-ms', '500'))

# restricted serial, plain and with a tap scope file
$other = @('--serial', 'R5CT00000PERSONAL', '--log', $log, '--state', $st)
$scope = Join-Path $testDir 'scope.json'
Set-Content $scope '{"serial":"R5CT00000PERSONAL","approvedBy":"maintainer","date":"2026-11-11","allow":["tap","keyevent"]}'
Set-LocateRecord 'R5CT00000PERSONAL'; Reset-Calls
Invoke-GuardCase 'restricted' '95' (@('tap-home') + $other + @('--delay-ms', '0'))
Invoke-GuardCase 'restricted with tap scope' '95' (@('tap-home') + $other + @('--delay-ms', '0', '--scope-file', $scope))
Test-Result 'restricted: no adb call' ((Get-Calls).Count -eq 0) ''

# tap failure: no HOME
Set-LocateRecord; Reset-Calls; $env:FAKE_TAP_EXIT = '1'
Invoke-GuardCase 'tap fails' '1' (@('tap-home') + $c + @('--delay-ms', '0'))
$got = @(Get-Calls)
Test-Result 'tap failure: only the tap was sent' (($got.Count -eq 1) -and ($got[0] -match 'input tap')) ('count=' + $got.Count)
$env:FAKE_TAP_EXIT = '0'

# no typing chain after tap-home
Set-LocateRecord; Reset-Calls
Invoke-GuardCase 'tap-home for chain check' '0' (@('tap-home') + $c + @('--delay-ms', '0'))
Invoke-GuardCase 'input text after tap-home' '99' ($c + @('--', 'shell', 'input text hello'))
Invoke-GuardCase 'enter after tap-home' '99' ($c + @('--', 'shell', 'input keyevent KEYCODE_ENTER'))

Remove-Item Env:ADBG_FAKE_ADB_SCRIPT; Remove-Item Env:FAKE_CALLS; Remove-Item Env:FAKE_TAP_EXIT
'failures=' + $script:failures
exit $script:failures
