# Fake-adb cases for the adbg hard stop after a failed locate (MC-1539). Usage: pwsh -File failed-locate-lock.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake.mjs'
$calls = Join-Path $testDir 'calls.txt'
# The fake adb records every call; screencap prints a PNG signature, pidof a pid, oom_score_adj reads 0.
Set-Content $fake 'import { appendFileSync } from "node:fs"; const a = process.argv.slice(2); appendFileSync(process.env.FAKE_CALLS, a.join(" ") + "\n"); const j = a.join(" "); if (j.includes("screencap")) process.stdout.write(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0])); if (j.includes("pidof")) process.stdout.write("4242"); if (j.includes("oom_score_adj")) process.stdout.write("0"); process.exit(0)'
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_CALLS = $calls
$log = Join-Path $testDir 'log.txt'
$st = Join-Path $testDir 'state.json'
$shot = Join-Path $testDir 'shot.png'
$script:failures = 0
$phone = '29f3cde9193f7ece'
$phone2 = '2ac80128013f7ece'
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
function Set-LocateRecord([string]$loc = '29f3cde9193f7ece') {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $o = @{ picks = @(); pickErrors = 0; offset = $null; pickLocked = $false; locates = @(@{ id = 1; time = $now; label = 'css:#thing'; bounds = @{ l = 10; t = 10; r = 110; b = 60 }; used = $false; serial = $loc }) }
    ConvertTo-Json $o -Depth 5 | Set-Content $st
}
$c = @('--serial', $phone, '--log', $log, '--state', $st, '--own-package', $pkg, '--own-ports', '9465')
$c2 = @('--serial', $phone2, '--log', $log, '--state', $st, '--own-package', $pkg, '--own-ports', '9465')
# locate-css with no offset recorded exits 2 (any non-zero locate result locks); locate-shot without a screencap exits 99.
function Invoke-FailedLocate([string[]]$base) { & node $GuardPath locate-css @base --port 9465 --url-contains x --selector '#nothing' 2>$null | Out-Null; [string]$LASTEXITCODE }
function Invoke-GoodLocate([string[]]$base, [string]$serialName) {
    # A successful locate through locate-shot: screencap with --state, then a box inside the newest capture.
    & node $GuardPath @base --out $shot -- exec-out screencap -p 2>$null | Out-Null
    & node $GuardPath locate-shot @base --png $shot --label thing --box 10,10,110,60 2>$null | Out-Null
    [string]$LASTEXITCODE
}

# before any failure: input is allowed
Set-LocateRecord; Reset-Calls
Invoke-GuardCase 'BACK allowed with no failed locate' '0' ($c + @('--', 'shell', 'input keyevent KEYCODE_BACK'))

# a failed locate (exit 6 class: here the locate-css precondition failure, non-zero) locks the serial
Set-LocateRecord
$rc = Invoke-FailedLocate $c
Test-Result 'failed locate exits non-zero' ($rc -ne '0') ('-> ' + $rc)
Test-Result 'state holds the lock' ((Get-Content $st -Raw | ConvertFrom-Json).inputLock.$phone -ne $null) ''
Test-Result 'log holds INPUT-LOCK' ((Get-Content $log -Raw) -match "INPUT-LOCK serial=$phone ") ''

Set-LocateRecord; Reset-Calls
# Set-LocateRecord rewrote the state without the lock; the log copy keeps it for calls with or without --state.
foreach ($key in @('KEYCODE_BACK', 'KEYCODE_HOME', 'KEYCODE_PAGE_DOWN', 'KEYCODE_DPAD_DOWN', 'KEYCODE_ENTER', '4')) {
    Invoke-GuardCase ('keyevent ' + $key + ' refused after failed locate') '92' ($c + @('--', 'shell', ('input keyevent ' + $key)))
}
$c3 = @('--serial', $phone, '--log', $log)
Invoke-GuardCase 'BACK refused without --state too' '92' ($c3 + @('--', 'shell', 'input keyevent KEYCODE_BACK'))
Invoke-GuardCase 'input text refused' '92' ($c + @('--', 'shell', 'input text hello'))
Invoke-GuardCase 'tap refused' '92' (@('tap') + $c)
Invoke-GuardCase 'tap-home refused' '92' (@('tap-home') + $c + @('--delay-ms', '0'))
Invoke-GuardCase 'swipe refused' '92' (@('swipe') + $c + @('--dx', '1', '--dy', '1', '--duration-ms', '300'))
Invoke-GuardCase 'hold refused' '92' (@('hold') + $c + @('--duration-ms', '300'))
Test-Result 'refused: no adb call at all' ((Get-Calls).Count -eq 0) ('calls=' + (Get-Calls).Count)
Test-Result 'log names the refusal' ((Get-Content $log -Raw) -match 'refused: input after failed locate') ''

# read-only commands stay allowed
Invoke-GuardCase 'screencap allowed while locked' '0' ($c + @('--out', $shot, '--', 'exec-out', 'screencap', '-p'))
Invoke-GuardCase 'getprop allowed while locked' '0' ($c + @('--', 'shell', 'getprop ro.product.model'))
Test-Result 'read-only calls reached adb' ((Get-Calls).Count -eq 2) ('calls=' + (Get-Calls).Count)

# another serial is not locked
Set-LocateRecord $phone2; Reset-Calls
Invoke-GuardCase 'BACK on another serial allowed' '0' ($c2 + @('--', 'shell', 'input keyevent KEYCODE_BACK'))
Invoke-GuardCase 'tap on another serial allowed' '0' (@('tap') + $c2)

# a successful locate clears the lock; state-only evidence was already rewritten, so check log and state both clear
Reset-Calls
$rc = Invoke-GoodLocate $c $phone
Test-Result 'successful locate exits 0' ($rc -eq '0') ('-> ' + $rc)
Test-Result 'log holds INPUT-UNLOCK' ((Get-Content $log -Raw) -match "INPUT-UNLOCK serial=$phone ") ''
Invoke-GuardCase 'BACK allowed after a successful locate' '0' ($c + @('--', 'shell', 'input keyevent KEYCODE_BACK'))
Invoke-GuardCase 'BACK allowed after unlock without --state' '0' ($c3 + @('--', 'shell', 'input keyevent KEYCODE_BACK'))

# the lock survives a successful locate on a different serial
Set-LocateRecord
$rc = Invoke-FailedLocate $c
$rc2 = Invoke-GoodLocate $c2 $phone2
Test-Result 'locate on the other serial succeeded' ($rc2 -eq '0') ('-> ' + $rc2)
Invoke-GuardCase 'first serial still locked after the other serial located' '92' ($c + @('--', 'shell', 'input keyevent KEYCODE_BACK'))
Invoke-GuardCase 'other serial unlocked' '0' ($c2 + @('--', 'shell', 'input keyevent KEYCODE_BACK'))

# a stale lock in the log is cleared by the successful locate even when the state file lost it
$rc = Invoke-GoodLocate $c $phone
Test-Result 'good locate for the locked serial' ($rc -eq '0') ('-> ' + $rc)
Invoke-GuardCase 'BACK allowed again' '0' ($c + @('--', 'shell', 'input keyevent KEYCODE_BACK'))

# a locate without --serial fails before any device action: it sets no lock and no "*" key
$log2 = Join-Path $testDir 'log2.txt'; $st2 = Join-Path $testDir 'state2.json'
Remove-Item $log2, $st2 -ErrorAction SilentlyContinue
Set-LocateRecord | Out-Null
Copy-Item $st $st2
$noSerial = @('--log', $log2, '--state', $st2, '--own-package', $pkg, '--own-ports', '9465')
& node $GuardPath locate-css @noSerial --port 9465 --url-contains x --selector '#nothing' 2>$null | Out-Null
Test-Result 'serial-less failed locate exits non-zero' ($LASTEXITCODE -ne 0) ('-> ' + $LASTEXITCODE)
Test-Result 'no star key in guard-state' (-not ((Get-Content $st2 -Raw) -match '"\*"')) ''
Test-Result 'no INPUT-LOCK serial=* in log' (-not ((Test-Path $log2) -and ((Get-Content $log2 -Raw) -match 'INPUT-LOCK serial=\*'))) ''
Test-Result 'no inputLock entry at all' ($null -eq (Get-Content $st2 -Raw | ConvertFrom-Json).inputLock) ''
$c4 = @('--serial', $phone, '--log', $log2, '--state', $st2, '--own-package', $pkg, '--own-ports', '9465')
& node $GuardPath @c4 -- shell 'input keyevent KEYCODE_BACK' 2>$null | Out-Null
Test-Result 'BACK after serial-less failed locate not refused for the lock' ($LASTEXITCODE -ne 92) ('-> ' + $LASTEXITCODE + ' (must not be 92)')
$c5 = @('--serial', $phone, '--log', $log2)
& node $GuardPath @c5 -- shell 'input keyevent KEYCODE_BACK' 2>$null | Out-Null
Test-Result 'BACK without --state after serial-less failed locate not 92' ($LASTEXITCODE -ne 92) ('-> ' + $LASTEXITCODE)
# serial A failed locate locks A only
Set-LocateRecord $phone2 | Out-Null
Remove-Item $log2 -ErrorAction SilentlyContinue
Copy-Item $st $st2
$rc = Invoke-FailedLocate $c4
Test-Result 'serial A failed locate exits non-zero' ($rc -ne '0') ('-> ' + $rc)
$sj = Get-Content $st2 -Raw | ConvertFrom-Json
Test-Result 'only serial A key in inputLock' ((@($sj.inputLock.PSObject.Properties.Name) -join ',') -eq $phone) ('keys=' + (@($sj.inputLock.PSObject.Properties.Name) -join ','))
$c6 = @('--serial', $phone2, '--log', $log2, '--state', $st2, '--own-package', $pkg, '--own-ports', '9465')
& node $GuardPath @c4 -- shell 'input keyevent KEYCODE_BACK' 2>$null | Out-Null
Test-Result 'serial A BACK refused 92' ($LASTEXITCODE -eq 92) ('-> ' + $LASTEXITCODE)
& node $GuardPath @c6 -- shell 'input keyevent KEYCODE_BACK' 2>$null | Out-Null
Test-Result 'serial B BACK not refused for the lock' ($LASTEXITCODE -ne 92) ('-> ' + $LASTEXITCODE)

Remove-Item Env:ADBG_FAKE_ADB_SCRIPT; Remove-Item Env:FAKE_CALLS
'failures=' + $script:failures
exit $script:failures
