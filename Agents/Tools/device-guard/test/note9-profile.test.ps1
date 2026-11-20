# Fake-adb cases for the adbg r3 Note 9 profile: a denylist of danger zones (exit 89) plus shape refusals (exit 97) on the two
# Note 9 serials, and the proof that no other serial is widened. Usage: pwsh -File note9-profile.test.ps1 -GuardPath <adbg.mjs>
# Row ids (NP-xx) name the plan rows; a mutant run reads them from the FAIL lines.
param([Parameter(Mandatory = $true)][string]$GuardPath)
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake.mjs'
$calls = Join-Path $testDir 'calls.txt'
# The fake adb records every call as one JSON array, exits 0 (never a guard code) and prints a PNG signature for screencap.
Set-Content $fake 'import { appendFileSync } from "node:fs"; appendFileSync(process.env.FAKE_CALLS, JSON.stringify(process.argv.slice(2)) + "\n"); if (process.argv.includes("screencap")) process.stdout.write(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])); process.exit(0)'
$envNames = @('ADBG_FAKE_ADB_SCRIPT', 'FAKE_CALLS', 'ANDROID_ADB_SERVER_PORT', 'ADB_SERVER_SOCKET', 'ADBG_PROFILE', 'ADBG_PLAYGROUND', 'ADBG_PLAYGROUND_SERIALS', 'ADBG_FULL_ACCESS_SERIALS', 'ADBG_NOTE9', 'ANDROID_SERIAL')
$savedEnv = @{}
foreach ($n in $envNames) { $savedEnv[$n] = [Environment]::GetEnvironmentVariable($n) }
foreach ($n in $envNames) { [Environment]::SetEnvironmentVariable($n, $null) }
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_CALLS = $calls
# Every guard spawn goes through the stand-in adb; never run a case where it is not in place.
if (-not $env:ADBG_FAKE_ADB_SCRIPT -or -not (Test-Path -LiteralPath $env:ADBG_FAKE_ADB_SCRIPT)) { throw 'ADBG_FAKE_ADB_SCRIPT is not set to an existing fake: refusing to run' }
$log = Join-Path $testDir 'log.txt'
$script:failures = 0
$script:rows = 0
$script:lastOut = ''
$pg = @('29f3cde9193f7ece', '2ac80128013f7ece')
$p1 = $pg[0]
$p2 = $pg[1]
$tab = 'R54WA00L3WH'
$emu = 'emulator-5580'
$app = 'io.github.yor42.risutanium'
$tabChar = [string][char]9
$own = @('--own-ports', '9465,9466')
function Test-NoteResult([string]$label, [bool]$ok, [string]$detail) {
    $script:rows++
    if (-not $ok) { $script:failures++ }
    ($(if ($ok) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' ' + $detail
}
# The leading comma keeps a single call an array, so indexing and Count behave the same for one call as for several.
function Get-NoteCalls { if (Test-Path $calls) { , @(Get-Content $calls) } else { , @() } }
function Reset-NoteCalls { if (Test-Path $calls) { Remove-Item $calls } }
function Get-NoteLog { if (Test-Path $log) { [string](Get-Content $log -Raw) } else { '' } }
function Get-NoteCallArgs([string]$line) { ((ConvertFrom-Json -InputObject $line) -join [char]0) }
function Invoke-NoteProfileGuard([string]$ser, [string[]]$adbArgs, [string[]]$extra = $own) {
    Reset-NoteCalls
    Remove-Item $log -ErrorAction SilentlyContinue
    $script:lastOut = & node $GuardPath --serial $ser --log $log @extra -- @adbArgs 2>&1 | Out-String
    [string]$LASTEXITCODE
}
# A subcommand call (pick, net-status ...): no `--` section.
function Invoke-NoteProfileSub([string[]]$all) {
    Reset-NoteCalls
    Remove-Item $log -ErrorAction SilentlyContinue
    $script:lastOut = & node $GuardPath @all 2>&1 | Out-String
    [string]$LASTEXITCODE
}
# An allowed form exits 0 and sends exactly one call: -s <serial> <the agent's args, or the composed form>, with a PLAYGROUND line.
function Test-NoteProfileAllowed([string]$label, [string]$ser, [string[]]$adbArgs, [string[]]$sent = $null, [string[]]$extra = $own) {
    $rc = Invoke-NoteProfileGuard $ser $adbArgs $extra
    $got = Get-NoteCalls
    $want = if ($null -ne $sent) { $sent } else { $adbArgs }
    $one = if ($got.Count -eq 1) { Get-NoteCallArgs $got[0] } else { '' }
    $ok = ($rc -eq '0') -and ($got.Count -eq 1) -and ($one -eq ((@('-s', $ser) + $want) -join [char]0)) -and (Get-NoteLog).Contains('PLAYGROUND serial=' + $ser)
    Test-NoteResult ($label + ' ' + $ser + ' allowed [' + ($adbArgs -join ' ') + ']') $ok ('-> ' + $rc + ' calls=' + $got.Count)
}
# A refused form exits with the wanted code, sends nothing, logs the refusal, never logs an intent or PLAYGROUND line, and (89) names the serial.
function Test-NoteProfileRefused([string]$label, [string]$ser, [string[]]$adbArgs, [string]$want, [string]$logPart = '', [string[]]$extra = $own) {
    $rc = Invoke-NoteProfileGuard $ser $adbArgs $extra
    $text = Get-NoteLog
    $ok = ($rc -eq $want) -and ((Get-NoteCalls).Count -eq 0) -and $text.Contains('REFUSED/ERROR exit=' + $want) -and (-not $text.Contains('intent:')) -and (-not $text.Contains('PLAYGROUND'))
    if ($ok -and $want -eq '89') { $ok = $text.Contains($ser) -and $text.Contains('danger zone') }
    if ($ok -and $logPart -ne '') { $ok = $text.Contains($logPart) -or $script:lastOut.Contains($logPart) }
    Test-NoteResult ($label + ' ' + $ser + ' refused ' + $want + ' [' + ($adbArgs -join ' ') + ']') $ok ('-> ' + $rc + ' (want ' + $want + ') calls=' + (Get-NoteCalls).Count)
}
# Each shell string, one adb argument, on both Note 9 serials.
function Test-NoteShellRefused([string]$label, [string[]]$cmds, [string]$want = '89', [string]$logPart = '') {
    foreach ($s in $pg) { foreach ($c in $cmds) { Test-NoteProfileRefused $label $s @('shell', $c) $want $logPart } }
}
function Test-NoteShellAllowed([string]$label, [string[]]$cmds) {
    foreach ($s in $pg) { foreach ($c in $cmds) { Test-NoteProfileAllowed $label $s @('shell', $c) } }
}
function New-NoteFile([string]$path, [string]$text = 'dummy') { New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null; [IO.File]::WriteAllText($path, $text) }

# Fixtures: dummy local files. The key-named ones hold dummy text and are never real secrets.
$src = Join-Path $testDir 'src'
foreach ($f in @('x.bin', 'x.txt', 'a.apk', 'b.apk', 'k.txt', 'key.txt', 'release.jks', 'keystore.properties', 'adbkey', 'adbkey.pub', 'upload.p12', 'u.keystore')) { New-NoteFile (Join-Path $src $f) }
New-NoteFile (Join-Path $src 'clean\sub\a.png')
New-NoteFile (Join-Path $src 'dirty\deep\deeper\upload.keystore')
New-NoteFile (Join-Path $src 'dirty\a.png')
New-NoteFile (Join-Path $src 'withkey\key.txt')
$bigDir = Join-Path $src 'big'
New-Item -ItemType Directory -Force -Path $bigDir | Out-Null
for ($i = 0; $i -lt 10001; $i++) { [IO.File]::WriteAllBytes((Join-Path $bigDir ('f' + $i + '.dat')), [byte[]]@()) }
$junction = Join-Path $src 'link'
New-Item -ItemType Junction -Path $junction -Target (Join-Path $src 'withkey') | Out-Null
$existing = Join-Path $testDir 'existing.txt'
New-NoteFile $existing
$scopeFile = Join-Path $testDir 'scope.json'
# The maintainer's scope file format (README): install, am-start and keyevent classes for the Tab.
Set-Content $scopeFile '{"serial":"R54WA00L3WH","approvedBy":"maintainer","date":"2026-11-18","allow":["install","am-start","keyevent"],"mc":"maintainer 2026-11-18 via Lane A"}'

# ---- NP-A: what the profile allows ----
# Real agent calls: playground.test.ps1 forms, r14 and r15 strings, the CHORE-375 D1 line, input, settings, svc ... each passes the scan.
$allowedShell = @(
    'input tap 100 200', 'input swipe 10 20 30 40', 'input swipe 10 20 10 20 800', 'input keyevent KEYCODE_ENTER', 'input keyevent --longpress KEYCODE_A', 'input text hello%sworld',
    'dumpsys activity activities', ('dumpsys meminfo ' + $app), 'dumpsys battery', ('dumpsys gfxinfo ' + $app + ' reset'), 'dumpsys SurfaceFlinger --latency', 'dumpsys thermalservice', 'dumpsys diskstats', 'dumpsys input_method', 'dumpsys notification --noredact', 'dumpsys package com.sec.android.app.myfiles', 'dumpsys window', 'dumpsys webviewupdate', 'dumpsys power',
    'uiautomator dump /data/local/tmp/w.xml', 'ls -la /sdcard/Download', 'cat /sdcard/notes.txt', 'ls /data/local/tmp', 'ls /data',
    ('pm clear ' + $app), ('pm uninstall ' + $app), ('pm uninstall -k ' + $app), ('pm path ' + $app), 'pm list packages', ('pm grant ' + $app + ' android.permission.CAMERA'),
    'getprop ro.product.model', 'getprop ro.build.type', 'settings get global wifi_on', 'settings put system screen_off_timeout 600000', 'settings put global stay_on_while_plugged_in 3', 'svc wifi disable', 'svc data disable', 'cmd statusbar expand-notifications', 'wm size', 'wm density 420', 'wm dismiss-keyguard',
    ('am start -n ' + $app + '/.MainActivity'), ('am force-stop ' + $app), 'am start -n com.sec.android.app.myfiles/.external.ui.MainActivity', 'am start -a android.intent.action.MAIN -c android.intent.category.APP_FILES',
    ('am start -a android.intent.action.VIEW -d content://com.android.externalstorage.documents/document/primary%3ADownload%2Fc471-card.png -t image/png --grant-read-uri-permission -n ' + $app + '/.MainActivity'),
    ('am start -a android.intent.action.SEND -t image/png --eu android.intent.extra.STREAM content://media/external/images/media/12 --grant-read-uri-permission -n ' + $app + '/.MainActivity'),
    'chmod 755 /data/local/tmp/alib-d9e5c87b888a6c31', 'sha256sum /data/local/tmp/alib-d9e5c87b888a6c31',
    'cd /data/local/tmp && timeout -s KILL 300 ./alib-d9e5c87b888a6c31 avatar_preview::gap_tests::diagnostic_scan_time_and_watchdog_latency_at_the_pixel_cap --ignored --nocapture --test-threads=1; echo EXIT=$?',
    'rm -f /data/local/tmp/alib-d9e5c87b888a6c31', 'rm -rf /sdcard/Download/c128-old', 'sync', 'ps -A | grep risutanium', 'top -n 1 -b', 'df -h', 'cat /proc/meminfo', ('run-as ' + $app + ' ls files'),
    'screencap -p /sdcard/Download/s.png', 'screenrecord --time-limit 10 /sdcard/Download/r.mp4', 'logcat -d -s chromium', ('pidof ' + $app), 'cat /proc/123/oom_score_adj', 'sha256sum ''/sdcard/Download/local-20261117 - 2026-11-17T214332.323.bin''',
    'settings put global http_proxy :0', 'settings get global http_proxy', 'settings get global private_dns_mode', 'settings get secure always_on_vpn_app', 'cat /sdcard/Download/proxy-notes.txt',
    'input keyevent KEYCODE_WAKEUP', 'input keyevent KEYCODE_SLEEP', 'echo hi > /sdcard/Download/x.txt', 'mkdir -p /sdcard/Download/RisuTanium-test', ('dumpsys gfxinfo ' + $app + ' framestats'))
Test-NoteShellAllowed 'NP-A1' $allowedShell

$pullLocal = Join-Path $testDir 'c128dir'
$pullLocalA = Join-Path $testDir 'c128dir-a'
foreach ($s in $pg) {
    Test-NoteProfileAllowed 'NP-A2' $s @('push', (Join-Path $src 'x.bin'), '/data/local/tmp/x.bin')
    Test-NoteProfileAllowed 'NP-A2' $s @('push', (Join-Path $src 'x.txt'), '/sdcard/DCIM/x.txt')
    Test-NoteProfileAllowed 'NP-A2' $s @('push', '--sync', (Join-Path $src 'x.bin'), '/data/local/tmp/x.bin')
    Test-NoteProfileAllowed 'NP-A2' $s @('pull', '/sdcard/Download/c128-dir', $pullLocal)
    Test-NoteProfileAllowed 'NP-A2' $s @('pull', '-a', '/sdcard/Download/c128-dir', $pullLocalA)
    Test-NoteProfileAllowed 'NP-A2' $s @('install', '-g', (Join-Path $src 'a.apk'))
    Test-NoteProfileAllowed 'NP-A2' $s @('install', '-r', '-d', '-t', (Join-Path $src 'a.apk'))
    Test-NoteProfileAllowed 'NP-A2' $s @('install-multiple', (Join-Path $src 'a.apk'), (Join-Path $src 'b.apk'))
    Test-NoteProfileAllowed 'NP-A2' $s @('uninstall', $app)
    Test-NoteProfileAllowed 'NP-A2' $s @('uninstall', '-k', $app)
    Test-NoteProfileAllowed 'NP-A2' $s @('logcat')
    Test-NoteProfileAllowed 'NP-A2' $s @('logcat', '-c')
    Test-NoteProfileAllowed 'NP-A2' $s @('exec-out', 'ls', '/data/local/tmp')
    Test-NoteProfileAllowed 'NP-A2' $s @('wait-for-device')
    Test-NoteProfileAllowed 'NP-A2' $s @('reboot')
    Test-NoteProfileAllowed 'NP-A2' $s @('get-state')
    Test-NoteProfileAllowed 'NP-A2' $s @('start-server')
    Test-NoteProfileAllowed 'NP-A2' $s @('forward', 'tcp:9465', 'localabstract:webview_devtools_remote_123')
}
# NP-A3: the CHORE-375 D1 recipe, five allowed calls in order, each sent exactly.
$alib = 'alib-d9e5c87b888a6c31'
foreach ($s in $pg) {
    Test-NoteProfileAllowed 'NP-A3' $s @('push', (Join-Path $src 'x.bin'), ('/data/local/tmp/' + $alib))
    Test-NoteProfileAllowed 'NP-A3' $s @('shell', ('chmod 755 /data/local/tmp/' + $alib))
    Test-NoteProfileAllowed 'NP-A3' $s @('shell', ('sha256sum /data/local/tmp/' + $alib))
    Test-NoteProfileAllowed 'NP-A3' $s @('shell', ('cd /data/local/tmp && timeout -s KILL 300 ./' + $alib + ' avatar_preview::gap_tests::diagnostic_scan_time_and_watchdog_latency_at_the_pixel_cap --ignored --nocapture --test-threads=1; echo ADBG-EXIT=$?'))
    Test-NoteProfileAllowed 'NP-A3' $s @('shell', ('rm -f /data/local/tmp/' + $alib))
    Test-NoteProfileAllowed 'NP-A3' $s @('shell', ('ls /data/local/tmp/' + $alib))
}
# NP-A4: split shell arguments are sent as given.
foreach ($s in $pg) { Test-NoteProfileAllowed 'NP-A4' $s @('shell', 'ls', '-la', '/data') }
# NP-A5: the r14 form (three arguments, path with blanks) is sent composed, with the path in single quotes.
$r14 = '/sdcard/Download/local-20261117 - 2026-11-17T214332.323.bin'
foreach ($s in $pg) { Test-NoteProfileAllowed 'NP-A5' $s @('shell', 'sha256sum', $r14) @('shell', ('sha256sum ''' + $r14 + '''')) }
# NP-A6: the exact screencap form keeps the PNG path: the file is written and the state records it for locate-shot.
foreach ($s in $pg) {
    $png = Join-Path $testDir ('shot-' + $s + '.png')
    $st = Join-Path $testDir ('state-' + $s + '.json')
    $rc = Invoke-NoteProfileGuard $s @('exec-out', 'screencap', '-p') @('--own-ports', '9465,9466', '--out', $png, '--state', $st)
    $isPng = (Test-Path $png) -and ([IO.File]::ReadAllBytes($png)[1] -eq 0x50)
    $recorded = (Test-Path $st) -and ((Get-Content $st -Raw) -like ('*' + $png.Replace('\', '\\') + '*'))
    Test-NoteResult ('NP-A6 ' + $s + ' screencap PNG written and noted') (($rc -eq '0') -and $isPng -and $recorded) ('-> ' + $rc)
}
# NP-A7: pm clear of the test app needs no --own-package.
foreach ($s in $pg) {
    Test-NoteProfileAllowed 'NP-A7' $s @('shell', ('pm clear ' + $app)) $null @()
    Test-NoteProfileAllowed 'NP-A7' $s @('shell', ('pm clear ' + $app)) $null @('--own-package', 'io.example.other')
}
# NP-A8: the r17 My Files pin and the am character rule do not apply on this profile.
Test-NoteProfileAllowed 'NP-A8' $p2 @('shell', 'am start -n com.sec.android.app.myfiles/.external.ui.MainActivity')
Test-NoteProfileAllowed 'NP-A8' $p1 @('shell', ('am start -n ' + $app + '/.MainActivity --es k ''a b'''))
# NP-A9: false-positive guard: ordinary commands whose text only resembles a danger word.
Test-NoteShellAllowed 'NP-A9' @('input swipe 10 20 30 40', 'sync', 'wm dismiss-keyguard', 'logcat -d -s FirebaseMessaging', 'ls /sdcard/Download/callback.bin', 'dumpsys notification --noredact', ('cd /data/local/tmp && timeout -s KILL 300 ./' + $alib + ' --ignored --nocapture --test-threads=1; echo EXIT=$?'))

# ---- NP-B: danger zones ----
# NP-B1: every confirmed zone, 89, with the zone id and the serial in the log and no adb call. Forms base allowed (svc wifi enable ...) are among them.
$zones = [ordered]@{
    'DZ-1' = @('content query --uri content://com.android.contacts/contacts', 'content query --uri content://call_log/calls', 'content query --uri content://sms/inbox', 'content delete --uri content://mms-sms/conversations', 'am start -n com.samsung.android.contacts/.Main', 'am start -n com.samsung.android.dialer/.DialtactsActivity', 'am start -n com.samsung.android.messaging/.ui.Main', 'content query --uri content://com.android.calendar/events', 'content query --uri content://icc/adn', 'dumpsys telephony.registry', 'am start -a android.intent.action.MAIN -c android.intent.category.APP_CONTACTS', 'am start -a android.intent.action.MAIN -c android.intent.category.APP_MESSAGING')
    'DZ-2' = @('am start -a android.intent.action.CALL -d tel:112', 'am start -a android.intent.action.DIAL', 'service call phone 2 s16 112', 'am start -a android.intent.action.SENDTO -d smsto:123', 'am start -a android.intent.action.VIEW -d mailto:a@b.c', 'service call isms 5')
    'DZ-3' = @('dumpsys account', 'am start -a android.settings.ADD_ACCOUNT_SETTINGS', 'cmd account list', 'settings put global auto_sync 0', 'am start -a android.settings.SYNC_SETTINGS', 'am start -n com.osp.app.signin/.Main')
    'DZ-4' = @('dpm set-device-owner x/.R', 'locksettings set-pin 1234', 'cmd lock_settings clear --old 1234', 'am start -a android.app.action.ADD_DEVICE_ADMIN', 'settings put global adb_enabled 0', 'svc usb setFunctions mtp', 'setprop persist.sys.usb.config none', 'settings put global development_settings_enabled 0', 'setprop service.adb.tcp.port 5555')
    'DZ-5' = @('reboot', 'reboot recovery', 'svc power reboot', 'svc power shutdown', 'am broadcast -a android.intent.action.MASTER_CLEAR', 'am broadcast -a android.intent.action.FACTORY_RESET', 'recovery --wipe_data', 'echo --wipe_data > /cache/recovery/command', 'sm partition disk:179,64 public', 'setprop sys.powerctl reboot')
    'DZ-6' = @('pm uninstall com.android.chrome', 'pm uninstall -k --user 0 com.samsung.android.bixby.agent', 'pm disable-user com.android.systemui', 'cmd package uninstall com.google.android.gms', 'pm clear com.google.android.gms', 'pm hide com.android.settings', 'pm suspend com.android.vending', 'pm remove-user 10', ('pm uninstall ' + $app + '; pm uninstall com.android.chrome'))
    'DZ-7' = @('su', 'su -c id', 'magisk --version', 'setenforce 0', 'dd if=/dev/zero of=/dev/block/mmcblk0')
    'DZ-8' = @('svc wifi enable', 'svc data enable', 'cmd wifi status', 'cmd wifi set-wifi-enabled enabled', 'cmd connectivity airplane-mode disable', 'settings put global airplane_mode_on 0', 'settings put global wifi_on 1', 'ifconfig wlan0 up', 'ip link set wlan0 up', 'am start -a android.settings.WIFI_SETTINGS', 'am start -a android.settings.panel.action.INTERNET_CONNECTIVITY')
    'DZ-9' = @('am start -a android.intent.action.VIEW -d https://realm.risuai.net', 'am start -a android.intent.action.VIEW -d https://discord.com/invite/x', 'ping risuai.xyz')
    'DZ-11' = @('dumpsys wifi', 'dumpsys connectivity', 'dumpsys location', 'cat /data/misc/wifi/WifiConfigStore.xml')
}
foreach ($z in $zones.Keys) { Test-NoteShellRefused 'NP-B1' $zones[$z] '89' $z }
# NP-B2: danger verbs and reboot targets, 89 with no call.
foreach ($s in $pg) {
    foreach ($v in @(@('root'), @('unroot'), @('remount'), @('disable-verity'), @('enable-verity'), @('sideload', 'x.zip'), @('tcpip', '5555'), @('usb'), @('connect', 'h:5555'), @('disconnect'), @('pair', 'h:1', '123456'), @('reconnect'), @('kill-server'), @('backup', '-all'), @('restore', 'x.ab'), @('bugreport', (Join-Path $testDir 'b.zip')), @('sync'), @('emu', 'kill'), @('reboot', 'bootloader'), @('reboot', 'recovery'), @('reboot', 'sideload'), @('reboot', 'fastboot'), @('reboot', 'download'))) {
        Test-NoteProfileRefused 'NP-B2' $s $v '89'
    }
}
# NP-B3: DZ-6 on the adb verb.
foreach ($s in $pg) { Test-NoteProfileRefused 'NP-B3' $s @('uninstall', 'com.android.chrome') '89' 'DZ-6' }
# NP-B4: path text is scanned for push, pull and exec-out.
foreach ($s in $pg) {
    Test-NoteProfileRefused 'NP-B4' $s @('push', (Join-Path $src 'x.txt'), '/sdcard/Android/data/com.samsung.android.contacts/x') '89' 'DZ-1'
    Test-NoteProfileRefused 'NP-B4' $s @('pull', '/data/data/com.android.providers.contacts/databases/contacts2.db', (Join-Path $testDir 'c.db')) '89' 'DZ-1'
    Test-NoteProfileRefused 'NP-B4' $s @('exec-out', 'content', 'query', '--uri', 'content://sms/inbox') '89' 'DZ-1'
}
# NP-B5: quoting and case do not hide a word.
Test-NoteShellRefused 'NP-B5' @('c''o''ntent query --uri content://com.android.c\ontacts/contacts') '89' 'DZ-1'
# Only the quote and backslash removal turns this into the provider name: without it the text holds no DZ-1 word.
Test-NoteShellRefused 'NP-B5' @('content query --uri content://com.android.c\ontacts/c"o"ntacts') '89' 'DZ-1'
Test-NoteShellRefused 'NP-B5' @('REBOOT') '89' 'DZ-5'
Test-NoteShellRefused 'NP-B5' @('Su -c id') '89' 'DZ-7'
Test-NoteShellRefused 'NP-B5' @('"svc" wifi enable') '89' 'DZ-8'
# NP-B6: DZ-12 for the basic key names; a renamed copy passes (documented residual).
foreach ($s in $pg) {
    foreach ($k in @('key.txt', 'release.jks', 'keystore.properties')) { Test-NoteProfileRefused 'NP-B6' $s @('push', (Join-Path $src $k), '/data/local/tmp/k') '89' 'DZ-12' }
    Test-NoteProfileAllowed 'NP-B6' $s @('push', (Join-Path $src 'k.txt'), '/data/local/tmp/k')
}

# ---- NP-C: no other serial is widened ----
$tabForms = @(
    @('shell', 'ls /data'), @('shell', 'input tap 1 2'), @('shell', 'dumpsys battery'), @('shell', 'chmod 755 /data/local/tmp/x'), @('shell', 'svc wifi disable'), @('shell', ('pm clear ' + $app)), @('shell', 'sha256sum /data/local/tmp/x'),
    @('shell', ('am start -a android.intent.action.VIEW -d content://media/external/images/media/1 -t image/png --grant-read-uri-permission -n ' + $app + '/.MainActivity')),
    @('push', (Join-Path $src 'x.bin'), '/data/local/tmp/x.bin'), @('push', (Join-Path $src 'x.txt'), '/sdcard/Download/x.txt'), @('pull', '/sdcard/Download/a.txt', (Join-Path $testDir 'a.txt')), @('uninstall', $app), @('logcat', '-d'), @('exec-out', 'ls', '/data'), @('reboot'), @('wait-for-device'))
# NP-C1: the Tab, with the maintainer's scope file and without it: 95 and no call; with the scope, a letter key reaches the r11 allowlist and gets 97.
foreach ($a in $tabForms) {
    Test-NoteProfileRefused 'NP-C1' $tab $a '95'
    Test-NoteProfileRefused 'NP-C1' $tab $a '95' '' @('--own-ports', '9465,9466', '--own-package', $app, '--scope-file', $scopeFile)
}
Test-NoteProfileRefused 'NP-C1' $tab @('shell', 'input keyevent KEYCODE_A') '97' '' @('--own-ports', '9465,9466', '--own-package', $app, '--scope-file', $scopeFile)
# NP-C2: the scope's own forms still pass on the Tab.
$rc = Invoke-NoteProfileGuard $tab @('install', (Join-Path $src 'a.apk')) @('--own-ports', '9465,9466', '--scope-file', $scopeFile)
Test-NoteResult 'NP-C2 Tab scope install sent once' (($rc -eq '0') -and ((Get-NoteCalls).Count -eq 1)) ('-> ' + $rc)
$rc = Invoke-NoteProfileGuard $tab @('shell', ('am start -n ' + $app + '/.MainActivity')) @('--own-package', $app, '--scope-file', $scopeFile)
Test-NoteResult 'NP-C2 Tab scope am start own package sent once' (($rc -eq '0') -and ((Get-NoteCalls).Count -eq 1)) ('-> ' + $rc)
# NP-C3: subcommands on the Tab.
foreach ($sub in @(@('net-status'), @('pick', '--state', (Join-Path $testDir 'st.json'), '--id', 'com.android.documentsui:id/x'), @('swipe', '--own-package', $app, '--state', (Join-Path $testDir 'st.json'), '--duration-ms', '100', '--dx', '1', '--dy', '1'), @('hold', '--own-package', $app, '--state', (Join-Path $testDir 'st.json'), '--duration-ms', '100'), @('tap-home', '--state', (Join-Path $testDir 'st.json'), '--delay-ms', '10'), @('proc-tasks', '--own-package', $app, '--pid', '1'))) {
    $rest = if ($sub.Count -gt 1) { $sub[1..($sub.Count - 1)] } else { @() }
    $rc = Invoke-NoteProfileSub (@($sub[0], '--serial', $tab, '--log', $log) + $rest)
    Test-NoteResult ('NP-C3 Tab ' + $sub[0] + ' refused 95, no call') (($rc -eq '95') -and ((Get-NoteCalls).Count -eq 0)) ('-> ' + $rc)
}
# NP-C4: mDNS and IP aliases of the Tab and of a Note 9, unknown serials: restricted.
foreach ($ser in @('R58M12345AB', 'R5CT1234ABC', 'emulator-5582', '192.168.0.23:37123', 'adb-R54WA00L3WH-AbCdEf._adb-tls-connect._tcp', 'adb-29f3cde9193f7ece-AbCdEf._adb-tls-connect._tcp')) {
    foreach ($a in @(@('shell', 'ls /data'), @('push', (Join-Path $src 'x.bin'), '/data/local/tmp/x.bin'), @('shell', 'input tap 1 2'))) { Test-NoteProfileRefused 'NP-C4' $ser $a '95' }
}
# NP-C5: near-miss serials stay restricted; a serial with a blank or a semicolon is no serial (2).
foreach ($ser in @('29f3cde9193f7ecf', '29F3CDE9193F7ECE', '29f3cde9193f7ece1', '129f3cde9193f7ece', '29f3cde9193f7ec', 'x2ac80128013f7ece', '2AC80128013F7ECE', 'emulator-558', 'emulator-55800')) {
    Test-NoteProfileRefused 'NP-C5' $ser @('shell', 'ls /data') '95'
    Test-NoteProfileRefused 'NP-C5' $ser @('push', (Join-Path $src 'x.bin'), '/data/local/tmp/x.bin') '95'
}
foreach ($ser in @(' 29f3cde9193f7ece', '29f3cde9193f7ece;x')) {
    $rc = Invoke-NoteProfileGuard $ser @('shell', 'ls /data')
    Test-NoteResult ('NP-C5 odd serial [' + $ser + '] exits 2, no call') (($rc -eq '2') -and ((Get-NoteCalls).Count -eq 0)) ('-> ' + $rc)
}
# NP-C6: environment variables select nothing.
foreach ($n in @('ADBG_PROFILE', 'ADBG_PLAYGROUND', 'ADBG_NOTE9')) { [Environment]::SetEnvironmentVariable($n, 'note9') }
foreach ($n in @('ADBG_PLAYGROUND_SERIALS', 'ADBG_FULL_ACCESS_SERIALS')) { [Environment]::SetEnvironmentVariable($n, $tab) }
[Environment]::SetEnvironmentVariable('ANDROID_SERIAL', $p1)
Test-NoteProfileRefused 'NP-C6' $tab @('shell', 'ls /data') '95'
Test-NoteProfileRefused 'NP-C6' 'R58M12345AB' @('shell', 'ls /data') '95'
Test-NoteProfileRefused 'NP-C6' $emu @('shell', 'ls /data') '97'
Test-NoteProfileAllowed 'NP-C6' $p2 @('shell', 'ls /data')
foreach ($n in @('ADBG_PROFILE', 'ADBG_PLAYGROUND', 'ADBG_NOTE9', 'ADBG_PLAYGROUND_SERIALS', 'ADBG_FULL_ACCESS_SERIALS', 'ANDROID_SERIAL')) { [Environment]::SetEnvironmentVariable($n, $null) }
# NP-C7: no option selects a profile.
foreach ($flag in @(@('--profile', 'note9'), @('--profile', 'full'), @('--note9'), @('--full-control'), @('--playground'), @('--mode', 'full'))) {
    Test-NoteProfileRefused 'NP-C7' $tab @('shell', 'ls /data') '95' '' ($own + $flag)
    Test-NoteProfileRefused 'NP-C7' 'R58M12345AB' @('shell', 'ls /data') '95' '' ($own + $flag)
    Test-NoteProfileRefused 'NP-C7' $emu @('shell', 'ls /data') '97' '' ($own + $flag)
}
# NP-C8: a scope file never grants the Note 9 profile.
foreach ($cls in @('note9', 'full', 'playground', 'shell')) {
    $bad = Join-Path $testDir ('scope-' + $cls + '.json')
    Set-Content $bad ('{"serial":"R54WA00L3WH","approvedBy":"maintainer","date":"2026-11-18","allow":["' + $cls + '"]}')
    Test-NoteProfileRefused 'NP-C8' $tab @('shell', 'ls /data') '2' '' ($own + @('--scope-file', $bad))
}
$other = Join-Path $testDir 'scope-note9.json'
Set-Content $other ('{"serial":"' + $p1 + '","approvedBy":"maintainer","date":"2026-11-18","allow":["tap","install"]}')
Test-NoteProfileRefused 'NP-C8' $tab @('shell', 'ls /data') '95' '' ($own + @('--scope-file', $other))
# NP-C9: state and log claims select nothing.
$claimState = Join-Path $testDir 'claim-state.json'
Set-Content $claimState '{"profile":"note9-full","playgroundSerials":["R54WA00L3WH"]}'
Test-NoteProfileRefused 'NP-C9' $tab @('shell', 'ls /data') '95' '' ($own + @('--state', $claimState))
Reset-NoteCalls
Set-Content $log ('2026-11-19T00:00:00.000Z PLAYGROUND serial=' + $tab + ' allow=extended adb ["shell","ls /data"]')
& node $GuardPath --serial $tab --log $log @own -- shell 'ls /data' 2>&1 | Out-Null
$rc = [string]$LASTEXITCODE
Test-NoteResult 'NP-C9 Tab with a forged PLAYGROUND log line stays restricted (95, no call)' (($rc -eq '95') -and ((Get-NoteCalls).Count -eq 0)) ('-> ' + $rc)
# NP-C10: the first --serial decides both the profile and the target.
Test-NoteProfileRefused 'NP-C10' $tab @('shell', 'ls /data') '95' '' ($own + @('--serial', $p1))
Test-NoteProfileAllowed 'NP-C10' $p1 @('shell', 'ls /data') $null ($own + @('--serial', $tab))
# NP-C11: no global option can retarget a Note 9 call.
foreach ($s in $pg) {
    foreach ($a in @(@('-s', $tab, 'shell', 'ls'), @('-t', '1', 'shell', 'ls'), @('-d', 'shell', 'ls'), @('-e', 'shell', 'ls'), @('-H', '127.0.0.1', 'shell', 'ls'), @('-P', '5038', 'shell', 'ls'), @('-L', 'tcp:5038', 'shell', 'ls'), @('--one-device', $tab, 'shell', 'ls'))) { Test-NoteProfileRefused 'NP-C11' $s $a '97' }
}
# NP-C12: emulator-5580 keeps the r11 allowlist.
Test-NoteProfileRefused 'NP-C12' $emu @('shell', 'ls /data') '97'
Test-NoteProfileRefused 'NP-C12' $emu @('push', (Join-Path $src 'x.bin'), '/data/local/tmp/x.bin') '97'
Test-NoteProfileRefused 'NP-C12' $emu @('uninstall', $app) '97'
Test-NoteProfileRefused 'NP-C12' $emu @('shell', 'reboot') '97'
$rc = Invoke-NoteProfileGuard $emu @('shell', 'svc wifi enable')
Test-NoteResult 'NP-C12 emulator svc wifi enable stays allowed (r11 parity, pinned so a change is deliberate)' (($rc -eq '0') -and ((Get-NoteCalls).Count -eq 1)) ('-> ' + $rc)

# ---- NP-D1: shape refusals, 97, nothing sent ----
foreach ($s in $pg) {
    $d1 = @(
        @('shell'), @('shell', '-t', 'ls'), @('shell', ''), @('shell', ('ls' + $tabChar + '/data')), @('shell', 'input text 가'), @('exec-out'),
        @('push', (Join-Path $src 'x.txt'), 'rel/x'), @('push', '--bogus', (Join-Path $src 'x.txt'), '/sdcard/x'), @('push', (Join-Path $src 'x.txt')), @('pull', '/sdcard/a'),
        @('pull', '/sdcard/a', (Join-Path $testDir '..\x')), @('pull', '/sdcard/a', $existing), @('pull', '/sdcard/a', $log), @('pull', '/sdcard/a', (Join-Path $testDir 'con.txt')), @('pull', '/sdcard/a', 'rel.txt'), @('pull', '/a', '/b', (Join-Path $testDir 'x')),
        @('install', 'x.zip'), @('install', '-s', 'x.apk'), @('uninstall', 'a', 'b'), @('uninstall'), @('devices'), @('jdwp'), @('get-serialno'), @('wait-for-usb-device'),
        @('forward', 'tcp:9999', 'tcp:1234'), @('reverse', '--remove-all'))
    foreach ($a in $d1) { Test-NoteProfileRefused 'NP-D1' $s $a '97' }
}

# ---- NP-E1: the audit log ----
foreach ($s in $pg) {
    $rc = Invoke-NoteProfileGuard $s @('shell', 'ls /data')
    $t = Get-NoteLog
    Test-NoteResult ('NP-E1 ' + $s + ' allowed call logs intent, exit and PLAYGROUND') (($rc -eq '0') -and $t.Contains('intent: adb -s ' + $s) -and $t.Contains('exit=0: adb -s ' + $s) -and $t.Contains('PLAYGROUND serial=' + $s + ' allow=extended')) ('-> ' + $rc)
    $rc = Invoke-NoteProfileGuard $s @('shell', 'svc wifi enable')
    $t = Get-NoteLog
    Test-NoteResult ('NP-E1 ' + $s + ' 89 logs the zone and no PLAYGROUND line') (($rc -eq '89') -and $t.Contains('REFUSED/ERROR exit=89') -and $t.Contains('DZ-8') -and -not $t.Contains('PLAYGROUND')) ('-> ' + $rc)
}
foreach ($ser in @($tab, 'R58M12345AB', $emu)) {
    $rc = Invoke-NoteProfileGuard $ser @('shell', 'ls /data')
    Test-NoteResult ('NP-E1 ' + $ser + ' never logs PLAYGROUND') (-not (Get-NoteLog).Contains('PLAYGROUND')) ('-> ' + $rc)
}

# ---- NP-F: the network under r3 (reverse-only) ----
Test-NoteShellRefused 'NP-F1' @('settings put global http_proxy 127.0.0.1:8888', 'settings put global http_proxy 192.168.0.10:8888', 'settings put global global_http_proxy_host 127.0.0.1', 'settings put global global_http_proxy_port 9466', 'settings put global global_proxy_pac_url http://x.invalid/p.pac', 'settings delete global http_proxy', 'settings put global private_dns_mode hostname', 'settings put global private_dns_specifier dns.example.invalid', 'settings put secure always_on_vpn_app com.x', 'settings put secure always_on_vpn_lockdown 1', 'settings put global tether_dun_required 0', 'content insert --uri content://settings/global --bind name:s:http_proxy --bind value:s:127.0.0.1:8888', 'am start -a android.settings.VPN_SETTINGS', 'am start -a android.net.vpn.SETTINGS', 'settings put global http_proxy :0; settings put global http_proxy 1.2.3.4:80', 'settings  put global HTTP_PROXY 127.0.0.1:9467') '89' 'DZ-8'
Test-NoteShellAllowed 'NP-F2' @('settings put global http_proxy :0', 'settings get global http_proxy', 'settings get global private_dns_mode', 'settings get secure always_on_vpn_app')
foreach ($s in $pg) {
    Test-NoteProfileAllowed 'NP-F3' $s @('reverse', 'tcp:9466', 'tcp:9466')
    Test-NoteProfileAllowed 'NP-F3' $s @('reverse', 'tcp:9465', 'tcp:9466')
    Test-NoteProfileAllowed 'NP-F3' $s @('reverse', '--remove', 'tcp:9466')
    Test-NoteProfileRefused 'NP-F3' $s @('reverse', 'tcp:9466', 'tcp:8888') '97'
    Test-NoteProfileRefused 'NP-F3' $s @('reverse', 'tcp:9466', 'localabstract:x') '97'
    Test-NoteProfileRefused 'NP-F3' $s @('reverse', '--remove-all') '97'
    Test-NoteProfileRefused 'NP-F3' $s @('reverse', 'tcp:8888', 'tcp:9466') '97'
}
$rc = Invoke-NoteProfileGuard $emu @('reverse', 'tcp:9466', 'tcp:8888')
Test-NoteResult 'NP-F3 emulator reverse to a host port that is not own stays allowed (r11)' (($rc -eq '0') -and ((Get-NoteCalls).Count -eq 1)) ('-> ' + $rc)

# ---- NP-H: the r3s and gate r4 rows ----
# NP-H1: DZ-11 is an allowlist by shape plus a deny family: bare, option-first, built and dump forms are 89 on both Note 9s.
$h1 = @('dumpsys', 'dumpsys > /sdcard/Download/all.txt', 'dumpsys -t 60 wifi', 'dumpsys -T 20000 connectivity', 'dumpsys --proto location', 'dumpsys --priority CRITICAL', 'dumpsys --skip activity', 'bugreportz', 'bugreportz -p', 'dumpstate', 'dumpsys netpolicy', 'cmd netpolicy list wifi-networks', 'dumpsys wifip2p', 'dumpsys content',
    '/system/bin/dumpsys -t 60 wifi', 'dumpsys | grep -i ssid', '$(dumpsys)', 'dumpsys $s', 'dumpsys $(echo wifi)', 'dumpsys wi?i', 'dumpsys w*', 'dumpsys {wifi,x}', 'dumpsys activity service location', 'dumpsys activity service NetworkStack', 'dumpsys dnsresolver', 'dumpsys semwifi', 'dumpsys isub', 'cmd -w wifi', 'cmd', 'cmd netd', 'cmd location set-location-enabled true', 'am bug-report', 'setprop ctl.start dumpstate', 'incident -p EXPLICIT', 'dumpsys battery; dumpsys wifi', 'dumpsys -l; dumpsys wifi',
    'setprop ctl.start dumpstatez', 'cp /data/user_de/0/com.android.shell/files/bugreports/* /sdcard/Download/', 'dumpsys activity service com.android.networkstack', 'dumpsys activity service com.google.android.gms/.location.internal.GoogleLocationManagerService', 'dumpsys -l wifi', 'cmd -l wifi')
Test-NoteShellRefused 'NP-H1' $h1 '89' 'DZ-11'
foreach ($s in $pg) {
    Test-NoteProfileRefused 'NP-H1' $s @('bugreport', (Join-Path $testDir 'b.zip')) '89' 'DZ-11'
    Test-NoteProfileRefused 'NP-H1' $s @('shell', 'dumpsys', 'wifi') '89' 'DZ-11'
}
# NP-H2: everyday dumpsys and cmd forms pass, and file names that merely contain the tool name are not calls.
Test-NoteShellAllowed 'NP-H2' @('dumpsys meminfo', ('dumpsys meminfo ' + $app), ('dumpsys meminfo -a ' + $app), ('dumpsys gfxinfo ' + $app + ' framestats'), ('dumpsys gfxinfo ' + $app + ' reset'), 'dumpsys window windows | grep mCurrentFocus', 'dumpsys activity', 'dumpsys activity top', 'dumpsys activity broadcasts | grep x', 'dumpsys batterystats', ('dumpsys batterystats --charged ' + $app), 'dumpsys cpuinfo', 'dumpsys webviewupdate', ('dumpsys package ' + $app), 'dumpsys accessibility', 'dumpsys settings', 'dumpsys battery set level 5', 'dumpsys -l', 'cmd -l', 'cmd statusbar expand-notifications', ('cat /proc/meminfo; dumpsys meminfo ' + $app), 'ls /sdcard/Download/dumpsys-out.txt', 'cat /sdcard/Download/my_dumpsys_notes.txt', 'ls /sdcard/Download/dumpsys/',
    ('dumpsys activity service ' + $app), 'dumpsys meminfo com.sec.android.app.launcher', 'dumpsys -l | grep -c a')
foreach ($s in $pg) { Test-NoteProfileAllowed 'NP-H2' $s @('shell', 'dumpsys', 'battery') }
# NP-H3: user restrictions and user switching are danger zone DZ-4.
Test-NoteShellRefused 'NP-H3' @('pm set-user-restriction no_debugging_features 1', 'cmd user set-user-restriction no_debugging_features 1', 'am switch-user 10', 'am stop-user 10') '89' 'DZ-4'
# NP-H4: reverse --list and forward --list (r21 kit form) are exactly that; --remove-all stays refused; the Tab and the emulator do not get reverse --list.
foreach ($s in $pg) {
    Test-NoteProfileAllowed 'NP-H4' $s @('reverse', '--list')
    Test-NoteProfileRefused 'NP-H4' $s @('reverse', '--list', 'x') '97'
    Test-NoteProfileAllowed 'NP-H4' $s @('forward', '--list')
    Test-NoteProfileRefused 'NP-H4' $s @('reverse', '--remove-all') '97'
}
Test-NoteProfileRefused 'NP-H4' $tab @('reverse', '--list') '95'
Test-NoteProfileRefused 'NP-H4' $emu @('reverse', '--list') '97'
# NP-H5: DZ-12 on every push source, a bounded directory walk, links refused.
$h5 = '/data/local/tmp/'
Test-NoteProfileRefused 'NP-H5' $p1 @('push', (Join-Path $src 'x.bin'), (Join-Path $src 'key.txt'), $h5) '89' 'DZ-12'
Test-NoteProfileRefused 'NP-H5' $p1 @('push', '--sync', (Join-Path $src 'x.bin'), (Join-Path $src 'release.jks'), $h5) '89' 'DZ-12'
Test-NoteProfileRefused 'NP-H5' $p1 @('push', (Join-Path $src 'adbkey'), '/data/local/tmp/a') '89' 'DZ-12'
Test-NoteProfileRefused 'NP-H5' $p1 @('push', (Join-Path $src 'Key.TXT'), '/data/local/tmp/a') '89' 'DZ-12'
# Win32 opens `key.txt.` as `key.txt`, so trailing dots do not hide the name.
Test-NoteProfileRefused 'NP-H5' $p1 @('push', ((Join-Path $src 'key.txt') + '.'), '/data/local/tmp/a') '89' 'DZ-12'
Test-NoteProfileRefused 'NP-H5' $p1 @('push', (Join-Path $src 'upload.p12'), '/data/local/tmp/a') '89' 'DZ-12'
Test-NoteProfileRefused 'NP-H5' $p1 @('push', (Join-Path $src 'u.keystore'), '/data/local/tmp/a') '89' 'DZ-12'
Test-NoteProfileRefused 'NP-H5' $p1 @('push', (Join-Path $src 'dirty'), '/sdcard/Download/d') '89' 'DZ-12'
Test-NoteProfileAllowed 'NP-H5' $p1 @('push', (Join-Path $src 'clean'), '/data/local/tmp/d')
Test-NoteProfileAllowed 'NP-H5' $p1 @('push', (Join-Path $src 'adbkey.pub'), '/data/local/tmp/a')
Test-NoteProfileAllowed 'NP-H5' $p1 @('push', (Join-Path $src 'k.txt'), '/data/local/tmp/k')
Test-NoteProfileRefused 'NP-H5' $p1 @('push', (Join-Path $src 'big'), '/sdcard/Download/b') '97'
Test-NoteProfileRefused 'NP-H5' $p1 @('push', $junction, '/sdcard/Download/l') '97'
Test-NoteProfileRefused 'NP-H5' $p1 @('push', (Join-Path $src 'nope.bin'), '/data/local/tmp/k') '97'
# NP-H6: ${IFS} is read as a blank; a command NAME built by a glob is 97 (spell it out); globs and brace groups elsewhere pass.
Test-NoteShellRefused 'NP-H6' @('svc${IFS}wifi${IFS}enable') '89' 'DZ-8'
Test-NoteShellRefused 'NP-H6' @('dumpsys${IFS}wifi') '89' 'DZ-11'
Test-NoteShellRefused 'NP-H6' @('/system/bin/rebo?t', 'sv[c] wifi enable', '/system/bin/dumps* wifi', 'true && /sys*/bin/dumpsys wifi') '97' 'command name built by a glob'
Test-NoteShellAllowed 'NP-H6' @('[ -e /sdcard/Download/x.txt ] && echo yes', 'for f in /sdcard/Download/*.png; do ls -la $f; done', 'ls /sdcard/Download/*.bin', 'logcat -d | grep -E "(chromium|RisuTanium).*error"', '{ ls /sdcard/Download; }')
# NP-H7: DZ-6 shape, both option orders; a chained pm clear stays 89 (send it as its own call); danger words in fixture names are 89.
Test-NoteShellAllowed 'NP-H7' @(('pm uninstall -k --user 0 ' + $app), ('pm uninstall --user 0 -k ' + $app), ('cmd package uninstall ' + $app), ('pm clear --user 0 ' + $app))
Test-NoteShellRefused 'NP-H7' @(('pm clear ' + $app + ' && am start -n ' + $app + '/.MainActivity')) '89' 'DZ-6'
Test-NoteShellRefused 'NP-H7' @('ls /sdcard/Download/c128-phonebook-test.json') '89' 'DZ-1'
# NP-H8: the radio keys are judged anywhere; only whole-command reads pass.
Test-NoteShellRefused 'NP-H8' @('content insert --uri content://settings/global --bind name:s:wifi_on --bind value:i:1', 'content update --uri content://settings/global --bind value:s:0 --where name=''airplane_mode_on''', 'settings get global wifi_on && settings put global wifi_on 1') '89' 'DZ-8'
Test-NoteShellAllowed 'NP-H8' @('settings get global wifi_on', 'settings get global airplane_mode_on', 'settings get global bluetooth_on')
# NP-H9 (gate r4 B1): a reverse host end that is the host adb server or an emulator port is 89, even when the agent lists it in --own-ports.
Test-NoteProfileRefused 'NP-H9' $p1 @('reverse', 'tcp:9466', 'tcp:5037') '89' 'DZ-10' @('--own-ports', '5037,9466')
Test-NoteProfileRefused 'NP-H9' $p1 @('reverse', 'tcp:5037', 'tcp:5037') '89' 'DZ-10' @('--own-ports', '5037,9466')
Test-NoteProfileRefused 'NP-H9' $p1 @('reverse', 'tcp:9466', 'tcp:5580') '89' 'DZ-10' @('--own-ports', '5580,9466')
Test-NoteProfileRefused 'NP-H9' $p2 @('reverse', 'tcp:9466', 'tcp:5554') '89' 'DZ-10' @('--own-ports', '5554,9466')
Test-NoteProfileRefused 'NP-H9' $p2 @('reverse', 'tcp:9466', 'tcp:5585') '89' 'DZ-10' @('--own-ports', '5585,9466')
[Environment]::SetEnvironmentVariable('ANDROID_ADB_SERVER_PORT', '5099')
Test-NoteProfileRefused 'NP-H9' $p1 @('reverse', 'tcp:9466', 'tcp:5099') '89' 'DZ-10' @('--own-ports', '5099,9466')
[Environment]::SetEnvironmentVariable('ANDROID_ADB_SERVER_PORT', $null)
[Environment]::SetEnvironmentVariable('ADB_SERVER_SOCKET', 'tcp:localhost:5098')
Test-NoteProfileRefused 'NP-H9' $p1 @('reverse', 'tcp:9466', 'tcp:5098') '89' 'DZ-10' @('--own-ports', '5098,9466')
[Environment]::SetEnvironmentVariable('ADB_SERVER_SOCKET', $null)
Test-NoteProfileAllowed 'NP-H9' $p1 @('reverse', 'tcp:9466', 'tcp:9466')
Test-NoteProfileAllowed 'NP-H9' $p1 @('reverse', 'tcp:9466', 'tcp:5553') $null @('--own-ports', '5553,9466')
Test-NoteProfileAllowed 'NP-H9' $p1 @('reverse', 'tcp:9466', 'tcp:5586') $null @('--own-ports', '5586,9466')
# The env vars only narrow: they never open a profile.
[Environment]::SetEnvironmentVariable('ANDROID_ADB_SERVER_PORT', '9466')
Test-NoteProfileRefused 'NP-H9' $tab @('reverse', 'tcp:9466', 'tcp:8888') '95'
[Environment]::SetEnvironmentVariable('ANDROID_ADB_SERVER_PORT', $null)
# NP-H9 (gate 2 r3 E3): blanks around ANDROID_ADB_SERVER_PORT are trimmed, so the reserved port is still read.
[Environment]::SetEnvironmentVariable('ANDROID_ADB_SERVER_PORT', ' 5099 ')
Test-NoteProfileRefused 'NP-H9' $p1 @('reverse', 'tcp:9466', 'tcp:5099') '89' 'DZ-10' @('--own-ports', '5099,9466')
[Environment]::SetEnvironmentVariable('ANDROID_ADB_SERVER_PORT', $null)

# ---- NP-J: gate 2 r3 remediation ----
# NP-J1 (E1): monkey is DZ-13 as a command word; a file name that only contains the word passes.
Test-NoteShellRefused 'NP-J1' @('monkey 100', 'monkey -p com.android.settings 500', ('monkey -p ' + $app + ' -c android.intent.category.LAUNCHER 1'), '/system/bin/monkey 10', 'echo x; monkey 5', 'MONKEY 7') '89' 'DZ-13'
Test-NoteShellAllowed 'NP-J1' @('ls /sdcard/Download/monkey.txt', 'cat /sdcard/monkey/notes.txt')
# NP-J2: numeric key codes of CALL (5), ENDCALL (6), CONTACTS (207) and CALENDAR (208) are DZ-2 like their names; the everyday keys pass.
Test-NoteShellRefused 'NP-J2' @('input keyevent 5', 'input keyevent 6', 'input keyevent 207', 'input keyevent 208', 'input keyevent 005', 'input keyevent +5', 'input keyevent --longpress 5', 'input touchscreen keyevent 5', 'input keyevent KEYCODE_HOME 5', 'echo x; input keyevent 5', 'input keyevent KEYCODE_ENDCALL', 'input keyevent ENDCALL', 'input keyevent --longpress ENDCALL') '89' 'DZ-2'
Test-NoteShellAllowed 'NP-J2' @('input keyevent 3', 'input keyevent 4', 'input keyevent 66', 'input keyevent 82', 'input keyevent 26', 'input keyevent 224', 'input keyevent 223', 'input keyevent 20', 'input keyevent 50', 'input keyevent 56', 'input keyevent 3 && sleep 5', 'input keyevent KEYCODE_BACK', 'input keyevent KEYCODE_HOME', 'input keyevent KEYCODE_MENU', 'input keyevent KEYCODE_DPAD_DOWN', 'input text hello5', 'input tap 5 6', 'input swipe 5 6 7 8')
# NP-J3: adb over TCP by property is DZ-8 (service.adb.tcp.port is DZ-4 in NP-B1); getprop of the everyday keys passes.
Test-NoteShellRefused 'NP-J3' @('setprop persist.adb.tcp.port 5555', 'setprop persist.adb.tcp.port 0', 'setprop Persist.ADB.tcp.port 5555') '89' 'DZ-8'
Test-NoteShellAllowed 'NP-J3' @('getprop ro.product.model', 'getprop ro.build.version.sdk', 'getprop persist.sys.timezone')
# NP-J4: the Bluetooth adapter intents are DZ-8.
Test-NoteShellRefused 'NP-J4' @('am start -a android.bluetooth.adapter.action.REQUEST_ENABLE', 'am start -a android.bluetooth.adapter.action.REQUEST_DISCOVERABLE', 'am broadcast -a android.bluetooth.adapter.action.STATE_CHANGED') '89' 'DZ-8'
# NP-J5: a com.android.settings/ component naming wifi, network, account, security or reset is refused; the everyday starts pass.
Test-NoteShellRefused 'NP-J5' @('am start -n com.android.settings/.wifi.WifiSettings', 'am start -n com.android.settings/.Settings\$WifiSettingsActivity', 'am start -n com.android.settings/.network.NetworkDashboardFragment', 'am start -n com.android.settings/.SecuritySettings', 'am start -n com.android.settings/.ResetSettings', 'am start -n com.android.settings/com.android.settings.Settings$SecuritySettingsActivity', 'am start -n com.android.settings/.network.telephony.MobileNetworkActivity', 'am start com.android.settings/.wifi.WifiSettings') '89'
Test-NoteShellRefused 'NP-J5' @('am start -n com.android.settings/.wifi.WifiSettings', 'am start -n com.android.settings/.SecuritySettings', 'am start -n com.android.settings/.ResetSettings') '89' 'DZ-8'
Test-NoteShellAllowed 'NP-J5' @('am start -a android.settings.SETTINGS', ('am start -n ' + $app + '/.MainActivity'), 'am start -n com.android.settings/.Settings', 'am start -n com.android.settings/.DisplaySettings', 'am start -n com.android.settings/.Settings && ls /sdcard/Download/c128-reset.json', 'settings get global stay_on_while_plugged_in')
# NP-J7 (gate 2 r3b F1): $IFS next to a quote still reads as a blank, so the quoted words are scanned as written.
Test-NoteShellRefused 'NP-J7' @('svc$IFS''wifi''$IFS''enable''', 'svc$IFS"wifi"$IFS"enable"') '89' 'DZ-8'
Test-NoteShellRefused 'NP-J7' @('input$IFS''keyevent''$IFS''5''') '89' 'DZ-2'
# NP-J6 (E2): a push source whose own name holds a colon (stream suffix) or ~<digit> (8.3 short name) is 97; plain names pass.
New-NoteFile (Join-Path $src 'a~b.txt')
foreach ($s in $pg) {
    Test-NoteProfileRefused 'NP-J6' $s @('push', ((Join-Path $src 'key.txt') + '::$DATA'), '/data/local/tmp/k') '97' 'spell the long name'
    Test-NoteProfileRefused 'NP-J6' $s @('push', ((Join-Path $src 'x.txt') + ':evil'), '/data/local/tmp/k') '97' 'spell the long name'
    Test-NoteProfileRefused 'NP-J6' $s @('push', (Join-Path $src 'KEYSTO~1.PRO'), '/data/local/tmp/k') '97' 'spell the long name'
    Test-NoteProfileAllowed 'NP-J6' $s @('push', (Join-Path $src 'a~b.txt'), '/data/local/tmp/k')
}

# Clean up: the junction goes first so the recursive delete never follows it; env vars are restored.
[IO.Directory]::Delete($junction)
foreach ($n in $envNames) { [Environment]::SetEnvironmentVariable($n, $savedEnv[$n]) }
Remove-Item -LiteralPath $testDir -Recurse -Force -ErrorAction SilentlyContinue
'rows=' + $script:rows + ' failures=' + $script:failures
exit $script:failures
