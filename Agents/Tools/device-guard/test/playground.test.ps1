# Fake-adb cases for the adbg playground mode of the two spare Note 9s (MC-1666). Usage: pwsh -File playground.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake.mjs'
$calls = Join-Path $testDir 'calls.txt'
# The fake adb records every call as one JSON array; screencap prints a PNG signature.
Set-Content $fake 'import { appendFileSync } from "node:fs"; const a = process.argv.slice(2); appendFileSync(process.env.FAKE_CALLS, JSON.stringify(a) + "\n"); if (a.join(" ").includes("screencap")) process.stdout.write(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0])); process.exit(0)'
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_CALLS = $calls
$log = Join-Path $testDir 'log.txt'
$st = Join-Path $testDir 'state.json'
$shot = Join-Path $testDir 'shot.png'
$script:failures = 0
$pg = @('29f3cde9193f7ece', '2ac80128013f7ece')
$pkg = 'io.github.yor42.risutanium'
function Test-Result([string]$label, [bool]$ok, [string]$detail) {
    if (-not $ok) { $script:failures++ }
    ($(if ($ok) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' ' + $detail
}
# The leading comma keeps a single call an array, so indexing and Count behave the same for one call as for several.
function Get-Calls { if (Test-Path $calls) { , @(Get-Content $calls) } else { , @() } }
function Reset-Calls { if (Test-Path $calls) { Remove-Item $calls } }
function Get-LogText { if (Test-Path $log) { Get-Content $log -Raw } else { '' } }
function ConvertTo-CompactJson($value) { ConvertTo-Json -Compress -InputObject @($value) }
# One guard call. The result is the exit code; the calls file shows what reached adb.
function Invoke-Guard([string]$ser, [string[]]$adbArgs, [string[]]$extra = @()) {
    Reset-Calls
    & node $GuardPath --serial $ser --log $log --own-package $pkg --own-ports '9465' @extra -- @adbArgs 2>$null | Out-Null
    [string]$LASTEXITCODE
}
# An allowed call exits 0 and sends exactly -s <serial> <args>.
function Test-Allowed([string]$label, [string]$ser, [string[]]$adbArgs, [string[]]$extra = @()) {
    $rc = Invoke-Guard $ser $adbArgs $extra
    $want = ConvertTo-CompactJson (@('-s', $ser) + $adbArgs)
    $got = Get-Calls
    Test-Result $label ($rc -eq '0' -and $got.Count -eq 1 -and $got[0] -eq $want) ('-> ' + $rc + ' sent=' + ($got -join ' | ') + ' want=' + $want)
}
# A refused call exits with the wanted code and sends nothing to adb.
function Test-Refused([string]$label, [string]$ser, [string[]]$adbArgs, [string]$want, [string[]]$extra = @()) {
    $rc = Invoke-Guard $ser $adbArgs $extra
    Test-Result $label ($rc -eq $want -and (Get-Calls).Count -eq 0) ('-> ' + $rc + ' (want ' + $want + ') calls=' + (Get-Calls).Count)
}
function Set-LocateRecord([string]$loc) {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $o = @{ picks = @(); pickErrors = 0; offset = $null; pickLocked = $false; locates = @(@{ id = 1; time = $now; label = 'css:#thing'; bounds = @{ l = 10; t = 10; r = 110; b = 60 }; used = $false; serial = $loc }) }
    ConvertTo-Json $o -Depth 5 | Set-Content $st
}

# ---- newly allowed verbs, on both playground serials, with exact arg arrays and no locate or typing grant ----
$allowedShell = @(
    'input tap 100 200', 'input swipe 10 20 30 40', 'input swipe 10 20 10 20 800',
    'input keyevent KEYCODE_ENTER', 'input keyevent KEYCODE_A', 'input keyevent KEYCODE_SPACE', 'input keyevent 29', 'input keyevent --longpress KEYCODE_A', 'input keyevent KEYCODE_DEL KEYCODE_DEL',
    'input text hello', 'input text hello%sworld',
    'dumpsys', 'dumpsys activity activities', ('dumpsys meminfo ' + $pkg), 'dumpsys battery', ('dumpsys gfxinfo ' + $pkg + ' reset'),
    'uiautomator dump', 'uiautomator dump /dev/tty', 'uiautomator dump /sdcard/w.xml', 'uiautomator dump --compressed /sdcard/Download/w.xml', 'uiautomator dump /data/local/tmp/w.xml',
    'ls /sdcard', 'ls -la /sdcard/Download', 'ls /sdcard/Download/', 'cat /sdcard/Download/a.txt', 'cat /sdcard/notes.txt',
    ('pm clear ' + $pkg)
)
foreach ($s in $pg) {
    foreach ($cmd in $allowedShell) { Test-Allowed ($s + ' shell ' + $cmd) $s @('shell', $cmd) }
    foreach ($lc in @(@('-d'), @('-v', 'threadtime', '-d'), @('-b', 'all', '-d'), @('-s', 'Tag', '-d'), @('-d', '-t', '500'), @('--pid', '5', '-d'), @('*:W', '-d'), @('-T', '100'), @('-t', '50', 'Tag:V', '*:S'))) {
        Test-Allowed ($s + ' logcat ' + ($lc -join ' ')) $s (@('logcat') + $lc)
    }
    foreach ($lc in @(@(), @('Tag:V', '*:S'), @('-v', 'threadtime'), @('--pid', '5'), @('-s', 'Tag'), @('-b', 'all'))) {
        Test-Refused ($s + ' logcat without -d/-t/-T refused: ' + ($lc -join ' ')) $s (@('logcat') + $lc) '97'
    }
    # pm clear is pinned to the hard-coded id, whatever --own-package says
    Reset-Calls; & node $GuardPath --serial $s --log $log --own-package io.example.other -- shell 'pm clear io.example.other' 2>$null | Out-Null
    Test-Result ($s + ' pm clear of a --own-package other than the pinned id') ($LASTEXITCODE -eq 97 -and (Get-Calls).Count -eq 0) ('-> ' + $LASTEXITCODE)
    Reset-Calls; & node $GuardPath --serial $s --log $log --own-package io.example.other -- shell ('pm clear ' + $pkg) 2>$null | Out-Null
    Test-Result ($s + ' pm clear pinned id with a different --own-package') ($LASTEXITCODE -eq 97 -and (Get-Calls).Count -eq 0) ('-> ' + $LASTEXITCODE)
    Reset-Calls; & node $GuardPath --serial $s --log $log -- shell ('pm clear ' + $pkg) 2>$null | Out-Null
    Test-Result ($s + ' pm clear pinned id with no --own-package') ($LASTEXITCODE -eq 97 -and (Get-Calls).Count -eq 0) ('-> ' + $LASTEXITCODE)
    Test-Refused ($s + ' pm clear pinned id with no --own-package override: other package') $s @('shell', 'pm clear io.github.yor42.risutanium.dev') '97'
    $rc = Invoke-Guard $s @('exec-out', 'screencap', '-p') @('--out', $shot)
    $got = Get-Calls
    Test-Result ($s + ' full-frame screencap, no crop') ($rc -eq '0' -and $got.Count -eq 1 -and $got[0] -eq (ConvertTo-CompactJson @('-s', $s, 'exec-out', 'screencap', '-p'))) ('-> ' + $rc)
    # r11 verbs keep working
    Test-Allowed ($s + ' r11 getprop') $s @('shell', 'getprop ro.product.model')
    Test-Allowed ($s + ' r11 own port forward') $s @('forward', 'tcp:9465', 'localabstract:webview_devtools_remote_1')
}

# ---- the same commands on non-playground serials keep r11's exit codes ----
# A personal-device serial is restricted (95); emulator-5580 is full access, where the extra verbs are not on the allowlist (97).
$restrictedSerials = @('R58M12345AB', 'emulator-5582')
$emuRefused = @(
    @('shell', 'input tap 100 200'), @('shell', 'input swipe 10 20 30 40'), @('shell', 'input swipe 10 20 10 20 800'),
    @('shell', 'input keyevent KEYCODE_A'), @('shell', 'input keyevent 29'), @('shell', 'input keyevent --longpress KEYCODE_A'),
    @('shell', 'dumpsys'), @('shell', 'dumpsys activity activities'),
    @('shell', 'uiautomator dump /dev/tty'), @('shell', 'uiautomator dump'),
    @('shell', 'ls /sdcard'), @('shell', 'ls -la /sdcard/Download'), @('shell', 'cat /sdcard/Download/a.txt'),
    @('logcat', '-d'), @('logcat'), @('logcat', '-b', 'all', '-d')
)
foreach ($a in $emuRefused) {
    Test-Refused ('emulator-5580 refuses ' + ($a -join ' | ')) 'emulator-5580' $a '97'
    foreach ($s in $restrictedSerials) { Test-Refused ($s + ' refuses ' + ($a -join ' | ')) $s $a '95' }
}
Test-Refused 'emulator-5580 input text without a grant stays 99' 'emulator-5580' @('shell', 'input text hi') '99' @('--state', $st)
foreach ($s in $restrictedSerials) { Test-Refused ($s + ' pm clear own stays 95') $s @('shell', ('pm clear ' + $pkg)) '95' }
Test-Refused 'emulator-5580 other-package pm clear stays 97' 'emulator-5580' @('shell', 'pm clear io.example.other') '97'

# ---- near-miss serials are not playground ----
foreach ($near in @('29f3cde9193f7ecf', '29F3CDE9193F7ECE', '29f3cde9193f7ece1', '129f3cde9193f7ece', '29f3cde9193f7ec', 'cde9193f7ece', '2ac80128013f7ecf', '2AC80128013F7ECE', '2ac80128013f7ece0', 'x2ac80128013f7ece')) {
    Test-Refused ('near-miss ' + $near + ' input tap refused 95') $near @('shell', 'input tap 1 2') '95'
    Test-Refused ('near-miss ' + $near + ' dumpsys refused 95') $near @('shell', 'dumpsys') '95'
}
# Whitespace and other characters fail the serial check itself (exit 2), so no playground behaviour and no adb call.
foreach ($near in @(' 29f3cde9193f7ece', '29f3cde9193f7ece ', "29f3cde9193f7ece`n", '29f3cde9193f7ece,2ac80128013f7ece', '29f3cde9193f7ece;x')) {
    Test-Refused ('whitespace/odd serial [' + ($near -replace "`n", '\n') + '] refused 2') $near @('shell', 'input tap 1 2') '2'
}
# The first --serial wins, in both orders; either way the adb target is the --serial the guard validated.
Reset-Calls
& node $GuardPath --serial 'emulator-5580' --serial $pg[0] --log $log -- shell 'input tap 1 2' 2>$null | Out-Null
Test-Result 'non-playground first --serial, playground second: refused, nothing sent' ($LASTEXITCODE -eq 97 -and (Get-Calls).Count -eq 0) ('-> ' + $LASTEXITCODE)
Reset-Calls
& node $GuardPath --serial $pg[0] --serial 'emulator-5580' --log $log -- shell 'input tap 1 2' 2>$null | Out-Null
Test-Result 'playground first --serial: sent to that serial only' ($LASTEXITCODE -eq 0 -and (Get-Calls).Count -eq 1 -and (Get-Calls)[0] -eq (ConvertTo-CompactJson @('-s', $pg[0], 'shell', 'input tap 1 2'))) ('-> ' + $LASTEXITCODE)

# ---- nothing but the constant turns playground on ----
$saved = @{}
foreach ($name in @('ADBG_PLAYGROUND', 'ADBG_PLAYGROUND_SERIALS', 'PLAYGROUND', 'ADBG_SERIALS', 'ADBG_FULL_ACCESS_SERIALS')) { $saved[$name] = [Environment]::GetEnvironmentVariable($name); [Environment]::SetEnvironmentVariable($name, 'R58M12345AB,emulator-5580,1') }
Test-Refused 'env vars cannot enable playground on a restricted serial' 'R58M12345AB' @('shell', 'input tap 1 2') '95'
Test-Refused 'env vars cannot enable playground on emulator-5580' 'emulator-5580' @('shell', 'input tap 1 2') '97'
Test-Refused 'env vars cannot enable dumpsys on emulator-5580' 'emulator-5580' @('shell', 'dumpsys') '97'
foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
$scopeFile = Join-Path $testDir 'scope.json'
Set-Content $scopeFile '{"serial": "R58M12345AB", "approvedBy": "maintainer", "date": "2026-11-13", "allow": ["playground"]}'
Test-Refused 'scope file with a playground class is invalid (2)' 'R58M12345AB' @('shell', 'input tap 1 2') '2' @('--scope-file', $scopeFile)
Set-Content $scopeFile '{"serial": "R58M12345AB", "approvedBy": "maintainer", "date": "2026-11-13", "allow": ["tap", "input-text", "keyevent"]}'
Test-Refused 'a full scope on a restricted serial still refuses input tap and dumpsys' 'R58M12345AB' @('shell', 'input tap 1 2') '95' @('--scope-file', $scopeFile)
Test-Refused 'a full scope on a restricted serial still refuses dumpsys' 'R58M12345AB' @('shell', 'dumpsys') '95' @('--scope-file', $scopeFile)
foreach ($flags in @(@('--playground'), @('--playground', '1'), @('--playground-serial', 'R58M12345AB'), @('--playground-serials', 'R58M12345AB,emulator-5580'), @('--mode', 'playground'))) {
    Test-Refused ('extra flags ' + ($flags -join ' ') + ' cannot enable it (restricted)') 'R58M12345AB' @('shell', 'input tap 1 2') '95' $flags
    Test-Refused ('extra flags ' + ($flags -join ' ') + ' cannot enable it (emulator-5580)') 'emulator-5580' @('shell', 'input tap 1 2') '97' $flags
}
# A state file or log that claims playground changes nothing.
Set-Content $st '{"playground": true, "playgroundSerials": ["R58M12345AB", "emulator-5580"], "picks": [], "locates": []}'
Set-Content $log ('2026-11-13T00:00:00.000Z PLAYGROUND serial=emulator-5580 allow=extended adb ["shell","input tap 1 2"]' + "`n")
Test-Refused 'state file and log claiming playground change nothing (emulator-5580)' 'emulator-5580' @('shell', 'input tap 1 2') '97' @('--state', $st)
Test-Refused 'state file and log claiming playground change nothing (restricted)' 'R58M12345AB' @('shell', 'input tap 1 2') '95' @('--state', $st)
Remove-Item $log, $st -ErrorAction SilentlyContinue

# ---- still refused on playground serials ----
$stillRefused = @(
    @('uninstall', 'io.example.app'), @('shell', 'pm uninstall io.example.app'), @('shell', 'pm uninstall -k io.example.app'),
    @('shell', 'pm clear io.example.other'), @('shell', 'pm clear com.android.chrome'), @('shell', 'pm clear'), @('shell', ('pm clear ' + $pkg + ' extra')),
    @('shell', 'pm install -r /sdcard/x.apk'), @('shell', 'pm disable-user io.example.app'), @('shell', 'pm grant io.example.app android.permission.CAMERA'),
    @('reboot'), @('reboot', 'bootloader'), @('shell', 'reboot'), @('root'), @('unroot'), @('remount'), @('disable-verity'), @('enable-verity'),
    @('shell', 'su'), @('shell', 'su -c id'), @('shell', 'rm -rf /sdcard/Download'), @('shell', 'rm -f /sdcard/DCIM/x.jpg'), @('shell', 'rm -f /data/data/io.example.app/x'), @('shell', ('rm -rf /data/data/' + $pkg)),
    @('shell', 'cmd wifi status'), @('shell', 'cmd wifi set-wifi-enabled enabled'), @('shell', 'settings put global'),
    @('forward', 'tcp:9999', 'tcp:1234'), @('reverse', 'tcp:9999', 'tcp:1234'), @('forward', '--list'), @('forward', '--remove', 'tcp:9999'),
    @('push', 'x.txt', '/sdcard/DCIM/x.txt'), @('push', 'x.txt', '/data/local/tmp/x.txt'), @('push', 'x.txt', '/sdcard/Download/sub/x.txt'),
    @('shell', 'dumpsys battery set level 5'), @('shell', 'dumpsys battery reset'), @('shell', 'dumpsys battery unplug'), @('shell', 'dumpsys deviceidle force-idle'), @('shell', 'dumpsys deviceidle whitelist +io.example.app'), @('shell', 'dumpsys activity set-debug-app x'),
    @('shell', 'dumpsys | grep x'), @('shell', 'dumpsys meminfo; reboot'),
    @('shell', 'dumpsys gfxinfo io.example.app reset'), @('shell', 'dumpsys gfxinfo reset'), @('shell', ('dumpsys gfxinfo ' + $pkg + ' reset extra')), @('shell', ('dumpsys gfxinfo ' + $pkg + ' framestats reset')), @('shell', ('dumpsys SurfaceFlinger ' + $pkg + ' reset')), @('shell', ('dumpsys gfxinfo ' + $pkg + ' RESET')),
    @('logcat', '-c'), @('logcat', '-d', '-c'), @('logcat', '-dc'), @('logcat', '--clear'), @('logcat', '-G', '16M'), @('logcat', '-P', 'x'), @('logcat', '-f', '/sdcard/x.log'), @('logcat', '-r', '100', '-n', '3'), @('logcat', '--file=/sdcard/x'), @('logcat', '--bogus'), @('logcat', 'Tag;reboot'),
    @('shell', 'ls /data'), @('shell', 'ls /sdcard/../data'), @('shell', 'ls /data/data/io.example.app'), @('shell', 'ls /sdcard /data'), @('shell', 'ls'), @('shell', 'ls /sdcard/*'),
    @('shell', 'cat /data/data/io.example.app/x'), @('shell', 'cat /sdcard/../data/x'), @('shell', 'cat /sdcard'), @('shell', 'cat /sdcard/a /sdcard/b'), @('shell', 'cat /sdcard/*'), @('shell', 'cat /sdcard/.hidden'),
    @('shell', 'uiautomator dump /data/x.xml'), @('shell', 'uiautomator dump /sdcard/../x.xml'), @('shell', 'uiautomator runtest x'), @('shell', 'uiautomator dump /sdcard/a.xml /sdcard/b.xml'),
    @('shell', 'input tap 1'), @('shell', 'input tap a b'), @('shell', 'input tap 1 2; reboot'), @('shell', 'input swipe 1 2 3'), @('shell', 'input swipe 1 2 3 4 5 6'), @('shell', 'input keyevent KEYCODE_a'), @('shell', 'input keyevent'), @('shell', 'input keyevent --help'), @('shell', 'input text a;reboot'), @('shell', 'input text $(reboot)'), @('shell', 'input roll 1 1'), @('shell', "input tap 1 2`nreboot"),
    @('-s', 'emulator-5580', 'shell', 'input tap 1 2'), @('-s', '2ac80128013f7ece', 'shell', 'input tap 1 2'), @('-P', '5038', 'shell', 'input tap 1 2'), @('shell', 'input tap 1 2', 'extra'),
    @('shell', 'getprop', 'ro.x'), @('tcpip', '5555'), @('connect', 'x:5555'), @('sideload', 'x.zip'), @('shell', 'am start -a android.intent.action.VIEW -d https://example.com'), @('shell', 'wm size 1x1 extra')
)
foreach ($s in $pg) {
    foreach ($a in $stillRefused) { Test-Refused ($s + ' still refuses ' + ($a -join ' | ')) $s $a '97' }
}
# install and the r11 verbs are unchanged: install of a local .apk is r11 behaviour, install of anything else is refused.
Test-Refused 'install of a non-apk stays refused' $pg[0] @('install', 'x.zip') '97'
# r11 itself allows `svc wifi|data enable|disable` and `settings get|put|delete` on full-access serials; playground adds nothing to them
# (open question for the parent: refuse svc/settings on playground serials too?). Pinned here so a change is deliberate.
foreach ($s in $pg) {
    Test-Allowed ($s + ' svc wifi enable is unchanged r11 behaviour') $s @('shell', 'svc wifi enable')
    Test-Allowed ($s + ' settings put global is unchanged r11 behaviour') $s @('shell', 'settings put global airplane_mode_on 0')
}

# ---- no failed-locate input lock, no typing grant ----
foreach ($s in $pg) {
    Remove-Item $log, $st -ErrorAction SilentlyContinue
    Set-LocateRecord $s
    # locate-css with no offset recorded exits non-zero: on another serial that locks input.
    $base = @('--serial', $s, '--log', $log, '--state', $st, '--own-package', $pkg, '--own-ports', '9465')
    & node $GuardPath locate-css @base --port 9465 --url-contains x --selector '#nothing' 2>$null | Out-Null
    Test-Result ($s + ' failed locate exits non-zero') ($LASTEXITCODE -ne 0) ('-> ' + $LASTEXITCODE)
    Test-Result ($s + ' failed locate records no lock in state') ($null -eq (Get-Content $st -Raw | ConvertFrom-Json).inputLock) ''
    Test-Result ($s + ' failed locate writes no INPUT-LOCK line') (-not ((Get-LogText) -match 'INPUT-LOCK')) ''
    foreach ($cmd in @('input keyevent KEYCODE_BACK', 'input keyevent KEYCODE_HOME', 'input keyevent KEYCODE_ENTER', 'input text hello', 'input tap 5 5', 'input swipe 5 5 50 50 300')) {
        Reset-Calls
        & node $GuardPath @base -- shell $cmd 2>$null | Out-Null
        Test-Result ($s + ' after failed locate: ' + $cmd) ($LASTEXITCODE -eq 0 -and (Get-Calls).Count -eq 1) ('-> ' + $LASTEXITCODE)
    }
    # even with a stale INPUT-LOCK line already in the log
    Add-Content $log ('2026-11-13T00:00:00.000Z INPUT-LOCK serial=' + $s + ' verb=pick exit=3')
    Reset-Calls
    & node $GuardPath @base -- shell 'input keyevent KEYCODE_BACK' 2>$null | Out-Null
    Test-Result ($s + ' ignores an INPUT-LOCK line in the log') ($LASTEXITCODE -eq 0 -and (Get-Calls).Count -eq 1) ('-> ' + $LASTEXITCODE)
    # the tap verb is not locked either, and still consumes its locate
    Set-LocateRecord $s; Reset-Calls
    & node $GuardPath tap @base 2>$null | Out-Null
    Test-Result ($s + ' tap verb after failed locate') ($LASTEXITCODE -eq 0 -and (Get-Calls).Count -eq 1 -and (Get-Calls)[0] -eq (ConvertTo-CompactJson @('-s', $s, 'shell', 'input', 'tap', '60', '35'))) ('-> ' + $LASTEXITCODE)
    # input text twice in a row with no tap in between (the r11 typing chain would refuse the second)
    Reset-Calls
    & node $GuardPath @base -- shell 'input text one' 2>$null | Out-Null; $r1 = $LASTEXITCODE
    & node $GuardPath @base -- shell 'input text two' 2>$null | Out-Null; $r2 = $LASTEXITCODE
    Test-Result ($s + ' two input text calls, no tap, no grant') ($r1 -eq 0 -and $r2 -eq 0 -and (Get-Calls).Count -eq 2) ('-> ' + $r1 + ',' + $r2)
}

# ---- the PLAYGROUND tag in the log ----
foreach ($s in $pg) {
    Remove-Item $log -ErrorAction SilentlyContinue
    Invoke-Guard $s @('shell', 'input tap 1 2') | Out-Null
    Invoke-Guard $s @('shell', 'input keyevent KEYCODE_BACK') | Out-Null
    Invoke-Guard $s @('shell', 'dumpsys') | Out-Null
    $text = Get-LogText
    Test-Result ($s + ' log tags an extended call') ($text -match ('PLAYGROUND serial=' + $s + ' allow=extended adb \["shell","input tap 1 2"\]')) ''
    Test-Result ($s + ' log tags an r11 call') ($text -match ('PLAYGROUND serial=' + $s + ' allow=r11 adb \["shell","input keyevent KEYCODE_BACK"\]')) ''
    Test-Result ($s + ' log still holds intent and exit lines') (($text -match 'intent: adb -s ' + $s) -and ($text -match 'exit=0: adb -s ' + $s)) ''
    Remove-Item $log
    Invoke-Guard $s @('shell', 'pm clear io.example.other') | Out-Null
    Test-Result ($s + ' a refused call is logged REFUSED, with no PLAYGROUND allow line') (((Get-LogText) -match 'REFUSED/ERROR exit=97') -and -not ((Get-LogText) -match 'PLAYGROUND')) ''
}
Remove-Item $log -ErrorAction SilentlyContinue
foreach ($s in @('emulator-5580', 'R58M12345AB')) {
    Invoke-Guard $s @('shell', 'getprop ro.product.model') | Out-Null
    Invoke-Guard $s @('shell', 'input tap 1 2') | Out-Null
}
Test-Result 'non-playground serials never log PLAYGROUND' (-not ((Get-LogText) -match 'PLAYGROUND')) ''

# ---- gfxinfo reset (r13): only the own package, only on playground serials ----
Test-Refused 'emulator-5580 refuses gfxinfo reset' 'emulator-5580' @('shell', ('dumpsys gfxinfo ' + $pkg + ' reset')) '97'
Test-Refused 'a restricted serial refuses gfxinfo reset' 'R58M12345AB' @('shell', ('dumpsys gfxinfo ' + $pkg + ' reset')) '95'
foreach ($s in $pg) {
    Reset-Calls
    & node $GuardPath --serial $s --log $log --own-package 'io.example.app' --own-ports '9465' -- shell ('dumpsys gfxinfo ' + $pkg + ' reset') 2>$null | Out-Null
    $rcOther = [string]$LASTEXITCODE
    Test-Result ($s + ' gfxinfo reset refused when --own-package is another app') ($rcOther -eq '97' -and (Get-Calls).Count -eq 0) ('-> ' + $rcOther)
    Reset-Calls
    & node $GuardPath --serial $s --log $log --own-ports '9465' -- shell ('dumpsys gfxinfo ' + $pkg + ' reset') 2>$null | Out-Null
    $rcNone = [string]$LASTEXITCODE
    Test-Result ($s + ' gfxinfo reset refused without --own-package') ($rcNone -eq '97' -and (Get-Calls).Count -eq 0) ('-> ' + $rcNone)
    # The package is pinned to RisuTanium: a matching --own-package for another app does not open the reset.
    Reset-Calls
    & node $GuardPath --serial $s --log $log --own-package 'io.example.app' --own-ports '9465' -- shell 'dumpsys gfxinfo io.example.app reset' 2>$null | Out-Null
    $rcPin = [string]$LASTEXITCODE
    Test-Result ($s + ' gfxinfo reset refused for another app even when --own-package matches it') ($rcPin -eq '97' -and (Get-Calls).Count -eq 0) ('-> ' + $rcPin)
}

Remove-Item Env:ADBG_FAKE_ADB_SCRIPT; Remove-Item Env:FAKE_CALLS
'failures=' + $script:failures
exit $script:failures
