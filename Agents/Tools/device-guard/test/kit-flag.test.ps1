# Fake-adb cases for the adbg --kit flag (r21): a plain adb call marked --kit is refused before anything is sent on every serial outside
# the two Note 9 serials, changes nothing on them, and any other verb rejects the flag.
# Usage: pwsh -File kit-flag.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
# Quoted rows rely on one argument per array element reaching node unchanged.
$PSNativeCommandArgumentPassing = 'Standard'
# Scratch files (fake adb, call record, log, state) go to a fresh temp folder, never next to the tracked test.
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake-kit.mjs'
$calls = Join-Path $testDir 'calls.txt'
$log = Join-Path $testDir 'log.txt'
$state = Join-Path $testDir 'state.json'
# Records every call it receives, so "sent" is observable, and exits 0.
Set-Content $fake 'import { appendFileSync } from ''node:fs''; appendFileSync(process.env.FAKE_CALLS, JSON.stringify(process.argv.slice(2)) + ''\n''); process.exit(0)'
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_CALLS = $calls
$script:failures = 0
$app = 'io.github.yor42.risutanium'
$emu = 'emulator-5580'
$note9 = @('29f3cde9193f7ece', '2ac80128013f7ece')
$apk = Join-Path $testDir 'a.apk'
$pushSrc = Join-Path $testDir 'f.txt'

# Runs the guard with the given arguments and a fresh log; returns the exit code, the calls the fake received, stderr/stdout text and the log text.
function Invoke-KitGuard([string[]]$g) {
    foreach ($f in @($calls, $log, $state)) { if (Test-Path $f) { Remove-Item $f } }
    $out = (& node $GuardPath @g 2>&1 | Out-String)
    $rc = [string]$LASTEXITCODE
    [pscustomobject]@{
        Rc = $rc
        Sent = @(if (Test-Path $calls) { Get-Content $calls }).Count
        Out = $out
        Log = $(if (Test-Path $log) { Get-Content $log -Raw } else { '' })
        State = (Test-Path $state)
    }
}
# One plain adb call; $kit puts --kit first, before --serial, where the kit's builders put it.
function Get-PlainArgs([string]$serial, [bool]$kit, [string[]]$adbArgs, [string]$own = '') {
    $g = @()
    if ($kit) { $g += '--kit' }
    $g += @('--serial', $serial, '--log', $log)
    if ($own -ne '') { $g += @('--own-package', $own) }
    $g + @('--') + $adbArgs
}
function Write-KitResult([string]$label, [bool]$ok, [string]$detail) {
    if (-not $ok) { $script:failures++ }
    ($(if ($ok) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' ' + $detail
}
# A refused kit call: wanted exit code, nothing sent, the guard's kit text on stderr and a REFUSED line (and no intent line) in the log.
function Test-KitRefused([string]$label, [string]$serial, [string]$want, [string[]]$adbArgs, [string]$own = '') {
    $r = Invoke-KitGuard (Get-PlainArgs $serial $true $adbArgs $own)
    $ok = ($r.Rc -eq $want) -and ($r.Sent -eq 0) -and $r.Out.Contains('adbg: kit call refused') -and $r.Out.Contains($serial) `
        -and $r.Log.Contains('REFUSED/ERROR exit=' + $want + ': "kit call refused') -and -not $r.Log.Contains('intent:')
    Write-KitResult $label $ok ('[' + $serial + '] ' + ($adbArgs -join ' ') + ' -> ' + $r.Rc + ' sent=' + $r.Sent + ' (want ' + $want + ' sent=0)')
}

# KT-1: emulator-5580 refuses every kit call (97), including the calls a plain run would accept.
$emuCalls = @(
    @('start-server'), @('get-state'), @('shell', 'getprop ro.product.model'), @('shell', 'settings put global stay_on_while_plugged_in 7'),
    @('install', '-r', $apk), @('push', $pushSrc, '/sdcard/Download/f.txt'),
    @('shell', "am start -n $app/.MainActivity"), @('shell', "am force-stop $app"), @('shell', "pm clear $app"))
foreach ($a in $emuCalls) { Test-KitRefused 'KT-1 emulator kit call' $emu '97' $a $app }

# KT-1c: the same first four calls without --kit are accepted: only the flag makes the difference.
foreach ($a in $emuCalls[0..3]) {
    $r = Invoke-KitGuard (Get-PlainArgs $emu $false $a $app)
    Write-KitResult 'KT-1c emulator call without --kit' (($r.Rc -eq '0') -and ($r.Sent -eq 1)) ('[' + $emu + '] ' + ($a -join ' ') + ' -> ' + $r.Rc + ' sent=' + $r.Sent + ' (want 0 sent=1)')
}

# KT-2: restricted and near-miss serials refuse every kit call (95), also the two calls their rules would accept.
foreach ($serial in @('R5CWTABTEST1', '2AC80128013F7ECE', '2ac80128013f7ecf', '29f3cde9193f7ece1', 'emulator-5554')) {
    Test-KitRefused 'KT-2 restricted kit pidof' $serial '95' @('shell', "pidof $app") $app
    Test-KitRefused 'KT-2 restricted kit getprop' $serial '95' @('shell', 'getprop ro.product.model') $app
    Test-KitRefused 'KT-2 restricted kit start-server' $serial '95' @('start-server') $app
}

# KT-3: on the Note 9 serials --kit changes nothing: exit code, calls sent and danger zone are the same with and without it.
$pairCalls = @(
    @{ A = @('start-server'); Want = '0'; Zone = '' }, @{ A = @('get-state'); Want = '0'; Zone = '' },
    @{ A = @('shell', 'getprop ro.product.model'); Want = '0'; Zone = '' },
    @{ A = @('shell', 'settings put global stay_on_while_plugged_in 7'); Want = '0'; Zone = '' },
    @{ A = @('shell', 'am start tel:112'); Want = '89'; Zone = 'DZ-2' },
    @{ A = @('shell', 'content query --uri content://c%61ll_log/calls'); Want = '89'; Zone = 'DZ-1' },
    @{ A = @('forward', '--list'); Want = '0'; Zone = '' },
    @{ A = @('shell', "pm clear $app"); Want = '0'; Zone = '' },
    @{ A = @('shell', 'pm clear com.android.chrome'); Want = '89'; Zone = 'DZ-6' },
    @{ A = @('exec-out', 'screencap', '-p'); Want = '2'; Zone = '' },
    @{ A = @('shell', 'reboot'); Want = '89'; Zone = 'DZ-5' })
foreach ($serial in $note9) {
    foreach ($row in $pairCalls) {
        $plain = Invoke-KitGuard (Get-PlainArgs $serial $false $row.A)
        $kit = Invoke-KitGuard (Get-PlainArgs $serial $true $row.A)
        $zonePlain = [regex]::Match($plain.Out, 'DZ-\d+').Value
        $zoneKit = [regex]::Match($kit.Out, 'DZ-\d+').Value
        $same = ($plain.Rc -eq $kit.Rc) -and ($plain.Sent -eq $kit.Sent) -and ($zonePlain -eq $zoneKit) -and -not $kit.Out.Contains('kit call refused')
        $wanted = ($kit.Rc -eq $row.Want) -and ($row.Zone -eq '' -or $zoneKit -eq $row.Zone)
        Write-KitResult 'KT-3 note9 same with and without --kit' ($same -and $wanted) ('[' + $serial + '] ' + ($row.A -join ' ') + ' -> kit ' + $kit.Rc + ' sent=' + $kit.Sent + ' ' + $zoneKit + ' / plain ' + $plain.Rc + ' sent=' + $plain.Sent + ' ' + $zonePlain)
    }
}

# KT-4: every other verb rejects --kit with exit 2: nothing sent, no state written, no input lock recorded.
$r = Invoke-KitGuard @('offset', '--kit', '--serial', '2ac80128013f7ece', '--state', $state, '--log', $log, '--x', '1', '--y', '1')
Write-KitResult 'KT-4 offset' (($r.Rc -eq '2') -and ($r.Sent -eq 0) -and -not $r.State -and $r.Out.Contains('--kit belongs to plain adb calls')) ('-> ' + $r.Rc + ' sent=' + $r.Sent + ' state=' + $r.State + ' (want 2 sent=0 state=False)')
$r = Invoke-KitGuard @('net-status', '--kit', '--serial', '2ac80128013f7ece', '--log', $log)
Write-KitResult 'KT-4 net-status' (($r.Rc -eq '2') -and ($r.Sent -eq 0) -and $r.Out.Contains('--kit belongs to plain adb calls')) ('-> ' + $r.Rc + ' sent=' + $r.Sent + ' (want 2 sent=0)')
$r = Invoke-KitGuard @('pick', '--kit', '--serial', $emu, '--state', $state, '--log', $log, '--name', 'x.txt')
Write-KitResult 'KT-4 pick' (($r.Rc -eq '2') -and ($r.Sent -eq 0) -and -not $r.Log.Contains('INPUT-LOCK') -and $r.Out.Contains('--kit belongs to plain adb calls')) ('-> ' + $r.Rc + ' sent=' + $r.Sent + ' (want 2 sent=0, no INPUT-LOCK)')

# KT-5: only a --kit before -- counts; the same text after -- is part of the adb arguments and the call is judged as before.
$r = Invoke-KitGuard @('--serial', $emu, '--log', $log, '--', 'get-state', '--kit')
Write-KitResult 'KT-5 --kit after --' (($r.Rc -eq '97') -and ($r.Sent -eq 0) -and $r.Out.Contains('not on the allowlist') -and -not $r.Out.Contains('kit call refused')) ('-> ' + $r.Rc + ' sent=' + $r.Sent + ' (want 97 from the allowlist)')

Remove-Item Env:ADBG_FAKE_ADB_SCRIPT; Remove-Item Env:FAKE_CALLS
'failures=' + $script:failures
exit $script:failures
