# Fake-adb cases for the adbg swipe and hold verbs (MC-1539). Usage: pwsh -File swipe-hold.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake.mjs'
$calls = Join-Path $testDir 'calls.txt'
# The fake adb records every call. `pidof` prints FAKE_PIDOF, a read of oom_score_adj prints FAKE_ADJ.
Set-Content $fake 'import { appendFileSync } from "node:fs"; const a = process.argv.slice(2); appendFileSync(process.env.FAKE_CALLS, a.join(" ") + "\n"); const j = a.join(" "); if (j.includes("pidof")) process.stdout.write(process.env.FAKE_PIDOF ?? "4242"); if (j.includes("oom_score_adj")) process.stdout.write(process.env.FAKE_ADJ ?? "0"); process.exit(0)'
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_CALLS = $calls
$log = Join-Path $testDir 'log.txt'
$st = Join-Path $testDir 'state.json'
$script:failures = 0
$phone = '29f3cde9193f7ece'
$pkg = 'io.example.app'
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
# The locate is 100x50 at (10,10), so its centre is 60,35. $screen adds a recorded screen size.
function Set-LocateRecord([string]$loc = '29f3cde9193f7ece', [int]$ageMs = 0, [bool]$used = $false, $screen = $null) {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $ageMs
    $rec = @{ id = 1; time = $now; label = 'css:#thing'; bounds = @{ l = 10; t = 10; r = 110; b = 60 }; used = $used; serial = $loc }
    if ($null -ne $screen) { $rec.screen = $screen }
    $o = @{ picks = @(); pickErrors = 0; offset = $null; pickLocked = $false; locates = @($rec) }
    ConvertTo-Json $o -Depth 5 | Set-Content $st
}
function Get-LocateUsed { [bool]((Get-Content $st -Raw | ConvertFrom-Json).locates[0].used) }
$c = @('--serial', $phone, '--log', $log, '--state', $st, '--own-package', $pkg)

# swipe, offset form: exact argument array, foreground check first, locate consumed
Set-LocateRecord; Reset-Calls
Invoke-GuardCase 'swipe dx/dy' '0' (@('swipe') + $c + @('--dx', '0', '--dy', '-300', '--duration-ms', '400'))
$got = @(Get-Calls)
Test-Result 'swipe calls: pidof, adj, swipe' ($got.Count -eq 3) ('count=' + $got.Count)
if ($got.Count -eq 3) {
    Test-Result 'foreground pidof' ($got[0] -eq ('-s ' + $phone + ' shell pidof ' + $pkg)) $got[0]
    Test-Result 'foreground adj read' ($got[1] -eq ('-s ' + $phone + ' shell cat /proc/4242/oom_score_adj')) $got[1]
    Test-Result 'exact swipe array' ($got[2] -eq ('-s ' + $phone + ' shell input swipe 60 35 60 -265 400')) $got[2]
}
Test-Result 'swipe consumed the locate' (Get-LocateUsed) ''
$logText = Get-Content $log -Raw
Test-Result 'log swipe uses locate line' ($logText -match 'swipe uses locate 1 .* from 60,35 to 60,-265 over 400 ms') ''
Reset-Calls
Invoke-GuardCase 'second swipe on consumed locate' '99' (@('swipe') + $c + @('--dx', '10', '--dy', '10', '--duration-ms', '400'))
Test-Result 'consumed: no adb call' ((Get-Calls).Count -eq 0) ''

# swipe, absolute end point
Set-LocateRecord; Reset-Calls
Invoke-GuardCase 'swipe to-x/to-y' '0' (@('swipe') + $c + @('--to-x', '500', '--to-y', '700', '--duration-ms', '50'))
$got = @(Get-Calls)
Test-Result 'exact swipe array (to)' (($got.Count -eq 3) -and ($got[2] -eq ('-s ' + $phone + ' shell input swipe 60 35 500 700 50'))) ($got -join ' | ')

# swipe bounds: no recorded screen uses 3000; a recorded screen is the bound
foreach ($case in @(
    @{ name = 'dx 3001'; a = @('--dx', '3001', '--dy', '0') }, @{ name = 'dy -3001'; a = @('--dx', '0', '--dy', '-3001') },
    @{ name = 'to-x 3001'; a = @('--to-x', '3001', '--to-y', '10') }, @{ name = 'to-y negative'; a = @('--to-x', '10', '--to-y', '-1') },
    @{ name = 'dx only'; a = @('--dx', '5') }, @{ name = 'dx with to-x'; a = @('--dx', '5', '--dy', '5', '--to-x', '5', '--to-y', '5') },
    @{ name = 'no end'; a = @() }, @{ name = 'dx float'; a = @('--dx', '1.5', '--dy', '0') }, @{ name = 'dx text'; a = @('--dx', 'abc', '--dy', '0') },
    @{ name = 'swipe with --x'; a = @('--dx', '1', '--dy', '1', '--x', '20', '--y', '20') })) {
    Set-LocateRecord; Reset-Calls
    Invoke-GuardCase ('swipe reject ' + $case.name) '2' (@('swipe') + $c + $case.a + @('--duration-ms', '300'))
    Test-Result ('swipe reject ' + $case.name + ': no adb call, locate unused') (((Get-Calls).Count -eq 0) -and -not (Get-LocateUsed)) ''
}
Set-LocateRecord -screen @{ w = 1080; h = 2220 }; Reset-Calls
Invoke-GuardCase 'swipe dx beyond recorded screen' '2' (@('swipe') + $c + @('--dx', '1081', '--dy', '0', '--duration-ms', '300'))
Invoke-GuardCase 'swipe to-y beyond recorded screen' '2' (@('swipe') + $c + @('--to-x', '5', '--to-y', '2221', '--duration-ms', '300'))
Test-Result 'recorded screen: no adb call' ((Get-Calls).Count -eq 0) ''
Invoke-GuardCase 'swipe dx at recorded screen edge' '0' (@('swipe') + $c + @('--dx', '1080', '--dy', '0', '--duration-ms', '300'))

# duration validation (exit 2, no adb call, locate unused)
foreach ($bad in @('49', '5001', '1.5', 'abc', '', '-100', '0x64', '1e2')) {
    Set-LocateRecord; Reset-Calls
    Invoke-GuardCase ('swipe duration [' + $bad + ']') '2' (@('swipe') + $c + @('--dx', '1', '--dy', '1', '--duration-ms', $bad))
    Test-Result ('swipe duration [' + $bad + '] no adb call') (((Get-Calls).Count -eq 0) -and -not (Get-LocateUsed)) ''
}
Set-LocateRecord; Reset-Calls
Invoke-GuardCase 'swipe duration missing' '2' (@('swipe') + $c + @('--dx', '1', '--dy', '1'))
Invoke-GuardCase 'swipe duration 5000 ok' '0' (@('swipe') + $c + @('--dx', '1', '--dy', '1', '--duration-ms', '5000'))
Set-LocateRecord; Reset-Calls
Invoke-GuardCase 'swipe without own-package' '2' (@('swipe', '--serial', $phone, '--log', $log, '--state', $st, '--dx', '1', '--dy', '1', '--duration-ms', '300'))
Test-Result 'no own-package: no adb call' ((Get-Calls).Count -eq 0) ''

# stale / used / missing locate
Set-LocateRecord -ageMs 20000; Reset-Calls
Invoke-GuardCase 'swipe stale locate' '99' (@('swipe') + $c + @('--dx', '1', '--dy', '1', '--duration-ms', '300'))
Test-Result 'stale: no adb call' ((Get-Calls).Count -eq 0) ''
Set-LocateRecord -used $true; Reset-Calls
Invoke-GuardCase 'swipe used locate' '99' (@('swipe') + $c + @('--dx', '1', '--dy', '1', '--duration-ms', '300'))
Test-Result 'used: no adb call' ((Get-Calls).Count -eq 0) ''
Set-LocateRecord 'emulator-5580'; Reset-Calls
Invoke-GuardCase 'swipe locate from another serial' '99' (@('swipe') + $c + @('--dx', '1', '--dy', '1', '--duration-ms', '300'))
Test-Result 'other serial: no adb call' ((Get-Calls).Count -eq 0) ''
ConvertTo-Json @{ picks = @(); pickErrors = 0; offset = $null; pickLocked = $false; locates = @() } -Depth 5 | Set-Content $st
Reset-Calls
Invoke-GuardCase 'swipe missing locate' '99' (@('swipe') + $c + @('--dx', '1', '--dy', '1', '--duration-ms', '300'))
Test-Result 'missing: no adb call' ((Get-Calls).Count -eq 0) ''

# foreground refusal: another package in front (adj not 0) or no process; nothing is sent, locate stays unused
Set-LocateRecord; Reset-Calls; $env:FAKE_ADJ = '100'
Invoke-GuardCase 'swipe with another package in front' '93' (@('swipe') + $c + @('--dx', '1', '--dy', '1', '--duration-ms', '300'))
Test-Result 'foreground refusal: no swipe sent, locate unused' ((-not (@(Get-Calls) -match 'input swipe')) -and -not (Get-LocateUsed)) ''
Set-LocateRecord; Reset-Calls; $env:FAKE_ADJ = '0'; $env:FAKE_PIDOF = ''
Invoke-GuardCase 'swipe with own package not running' '93' (@('swipe') + $c + @('--dx', '1', '--dy', '1', '--duration-ms', '300'))
Test-Result 'not running: no swipe sent' (-not (@(Get-Calls) -match 'input swipe')) ''
Remove-Item Env:FAKE_PIDOF; Remove-Item Env:FAKE_ADJ

# hold: zero-distance swipe, exact array, consumed, duration 100..5000
Set-LocateRecord; Reset-Calls
Invoke-GuardCase 'hold happy' '0' (@('hold') + $c + @('--duration-ms', '800'))
$got = @(Get-Calls)
Test-Result 'exact hold array' (($got.Count -eq 3) -and ($got[2] -eq ('-s ' + $phone + ' shell input swipe 60 35 60 35 800'))) ($got -join ' | ')
Test-Result 'hold consumed the locate' (Get-LocateUsed) ''
Test-Result 'log hold uses locate line' ((Get-Content $log -Raw) -match 'hold uses locate 1 .* at 60,35 for 800 ms') ''
Reset-Calls
Invoke-GuardCase 'second hold on consumed locate' '99' (@('hold') + $c + @('--duration-ms', '800'))
Test-Result 'hold consumed: no adb call' ((Get-Calls).Count -eq 0) ''
foreach ($bad in @('99', '5001', '1.5', 'abc', '', '-100')) {
    Set-LocateRecord; Reset-Calls
    Invoke-GuardCase ('hold duration [' + $bad + ']') '2' (@('hold') + $c + @('--duration-ms', $bad))
    Test-Result ('hold duration [' + $bad + '] no adb call') (((Get-Calls).Count -eq 0) -and -not (Get-LocateUsed)) ''
}
Set-LocateRecord; Reset-Calls
Invoke-GuardCase 'hold duration missing' '2' (@('hold') + $c)
Invoke-GuardCase 'hold duration 100 ok' '0' (@('hold') + $c + @('--duration-ms', '100'))
Set-LocateRecord; Reset-Calls
Invoke-GuardCase 'hold duration 5000 ok' '0' (@('hold') + $c + @('--duration-ms', '5000'))
Set-LocateRecord -ageMs 20000; Reset-Calls
Invoke-GuardCase 'hold stale locate' '99' (@('hold') + $c + @('--duration-ms', '300'))
Set-LocateRecord -used $true
Invoke-GuardCase 'hold used locate' '99' (@('hold') + $c + @('--duration-ms', '300'))
ConvertTo-Json @{ picks = @(); pickErrors = 0; offset = $null; pickLocked = $false; locates = @() } -Depth 5 | Set-Content $st
Invoke-GuardCase 'hold missing locate' '99' (@('hold') + $c + @('--duration-ms', '300'))
Test-Result 'hold stale/used/missing: no adb call' ((Get-Calls).Count -eq 0) ''
Set-LocateRecord; Reset-Calls; $env:FAKE_ADJ = '200'
Invoke-GuardCase 'hold with another package in front' '93' (@('hold') + $c + @('--duration-ms', '300'))
Test-Result 'hold foreground refusal: no swipe sent' (-not (@(Get-Calls) -match 'input swipe')) ''
Remove-Item Env:FAKE_ADJ

# restricted serial: always 95, with and without a tap scope, no adb call
$other = @('--serial', 'R5CT00000PERSONAL', '--log', $log, '--state', $st, '--own-package', $pkg)
$scope = Join-Path $testDir 'scope.json'
Set-Content $scope '{"serial":"R5CT00000PERSONAL","approvedBy":"maintainer","date":"2026-11-12","allow":["tap","keyevent","input-text"]}'
Set-LocateRecord 'R5CT00000PERSONAL'; Reset-Calls
Invoke-GuardCase 'restricted swipe' '95' (@('swipe') + $other + @('--dx', '1', '--dy', '1', '--duration-ms', '300'))
Invoke-GuardCase 'restricted swipe with scope' '95' (@('swipe') + $other + @('--dx', '1', '--dy', '1', '--duration-ms', '300', '--scope-file', $scope))
Invoke-GuardCase 'restricted hold' '95' (@('hold') + $other + @('--duration-ms', '300'))
Invoke-GuardCase 'restricted hold with scope' '95' (@('hold') + $other + @('--duration-ms', '300', '--scope-file', $scope))
Test-Result 'restricted: no adb call, locate unused' (((Get-Calls).Count -eq 0) -and -not (Get-LocateUsed)) ''

# no typing chain after swipe or hold
foreach ($verb in @('swipe', 'hold')) {
    Set-LocateRecord; Reset-Calls
    $extra = if ($verb -eq 'swipe') { @('--dx', '1', '--dy', '1', '--duration-ms', '300') } else { @('--duration-ms', '300') }
    Invoke-GuardCase ($verb + ' for chain check') '0' (@($verb) + $c + $extra)
    Invoke-GuardCase ('input text after ' + $verb) '99' ($c + @('--', 'shell', 'input text hello'))
    Invoke-GuardCase ('enter after ' + $verb) '99' ($c + @('--', 'shell', 'input keyevent KEYCODE_ENTER'))
}

Remove-Item Env:ADBG_FAKE_ADB_SCRIPT; Remove-Item Env:FAKE_CALLS
'failures=' + $script:failures
exit $script:failures
