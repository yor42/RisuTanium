# Fake-adb cases for the adbg restricted serials. Usage: pwsh -File restricted-serial.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
# Scratch files (fake adb, log, state, scope files) go to a fresh temp folder, never next to the tracked test.
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake-restricted.mjs'
# Prints a PNG signature for screencap so the guard accepts the capture; otherwise exits with FAKE_EXIT.
Set-Content $fake 'if (process.argv.includes(''screencap'')) process.stdout.write(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0])); process.exit(Number(process.env.FAKE_EXIT || 0))'
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_EXIT = '0'
$runId = [guid]::NewGuid().ToString('N')
$log = Join-Path $testDir ('log-' + $runId + '.txt')
$st = Join-Path $testDir ('state-' + $runId + '.json')
$shot = Join-Path $testDir ('shot-' + $runId + '.png')
$scopeTap = Join-Path $testDir ('scope-tap-' + $runId + '.json')
$scopeOther = Join-Path $testDir ('scope-other-' + $runId + '.json')
$scopeBad = Join-Path $testDir ('scope-bad-' + $runId + '.json')
$script:failures = 0
function Invoke-GuardCase([string]$label, [string]$want, [string[]]$guardArgs) {
    & node $GuardPath @guardArgs 2>$null | Out-Null
    $ok = ([string]$LASTEXITCODE -eq $want)
    if (-not $ok) { $script:failures++ }
    ($(if ($ok) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' -> ' + $LASTEXITCODE + ' (want ' + $want + ')'
}
function Set-LocateRecord([string]$recordSerial) {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $o = @{ picks = @(); pickErrors = 0; offset = $null; pickLocked = $false; locates = @(@{ id = 1; time = $now; label = 'css:#field'; bounds = @{ l = 10; t = 10; r = 110; b = 60 }; used = $false; serial = $recordSerial }) }
    ConvertTo-Json $o -Depth 5 | Set-Content $st
}
$personal = 'R5CT1234ABC'
$pkg = 'io.example.app'
$apk = '/data/app/~~abc123==/io.example.app-xyz789==/base.apk'
$c = @('--serial', $personal, '--log', $log, '--own-ports', '9465,9466', '--own-package', $pkg)
$full = @('--serial', 'emulator-5580', '--log', $log, '--own-ports', '9465,9466', '--own-package', $pkg)

# Restricted serial, allowed.
Invoke-GuardCase 'restricted reverse own port' '0' ($c + @('--', 'reverse', 'tcp:9465', 'tcp:9465'))
Invoke-GuardCase 'restricted reverse remove' '0' ($c + @('--', 'reverse', '--remove', 'tcp:9465'))
Invoke-GuardCase 'restricted reverse foreign port' '95' ($c + @('--', 'reverse', 'tcp:1234', 'tcp:1234'))
Invoke-GuardCase 'restricted reverse own device port to foreign host port' '95' ($c + @('--', 'reverse', 'tcp:9465', 'tcp:22'))
Invoke-GuardCase 'restricted forward devtools' '0' ($c + @('--', 'forward', 'tcp:9466', 'localabstract:webview_devtools_remote_1234'))
Invoke-GuardCase 'restricted forward remove' '0' ($c + @('--', 'forward', '--remove', 'tcp:9466'))
Invoke-GuardCase 'restricted forward other socket' '95' ($c + @('--', 'forward', 'tcp:9466', 'localabstract:other_socket'))
Invoke-GuardCase 'restricted forward tcp target' '95' ($c + @('--', 'forward', 'tcp:9466', 'tcp:9467'))
Invoke-GuardCase 'restricted screencap' '0' ($c + @('--state', $st, '--out', $shot, '--', 'exec-out', 'screencap', '-p'))
Invoke-GuardCase 'restricted pidof own' '0' ($c + @('--', 'shell', ('pidof ' + $pkg)))
Invoke-GuardCase 'restricted pidof other' '95' ($c + @('--', 'shell', 'pidof com.other.app'))
Invoke-GuardCase 'restricted pm path own' '0' ($c + @('--', 'shell', ('pm path ' + $pkg)))
Invoke-GuardCase 'restricted pm path other' '95' ($c + @('--', 'shell', 'pm path com.other.app'))
Invoke-GuardCase 'restricted sha256sum own apk' '0' ($c + @('--', 'shell', ('sha256sum ' + $apk)))
Invoke-GuardCase 'restricted sha256sum sdcard file' '95' ($c + @('--', 'shell', 'sha256sum /sdcard/Download/x.apk'))
Invoke-GuardCase 'restricted getprop model' '0' ($c + @('--', 'shell', 'getprop ro.product.model'))
Invoke-GuardCase 'restricted getprop all' '95' ($c + @('--', 'shell', 'getprop'))
Invoke-GuardCase 'restricted getprop serialno' '95' ($c + @('--', 'shell', 'getprop ro.serialno'))
Invoke-GuardCase 'restricted offset' '0' (@('offset', '--serial', $personal, '--log', $log, '--state', $st, '--x', '0', '--y', '0'))
Invoke-GuardCase 'restricted locate-shot is a pure image read' '0' (@('locate-shot', '--serial', $personal, '--log', $log, '--state', $st, '--png', $shot, '--label', 'ctl', '--box', '1,1,50,50'))

# Restricted serial, refused with exit 95.
Set-LocateRecord $personal
Invoke-GuardCase 'restricted tap subcommand' '95' (@('tap') + $c + @('--state', $st))
Invoke-GuardCase 'restricted pick' '95' (@('pick') + $c + @('--state', $st, '--name', 'Settings'))
Invoke-GuardCase 'restricted proc-tasks' '95' (@('proc-tasks') + $c + @('--pid', '123'))
Invoke-GuardCase 'restricted input text' '95' ($c + @('--state', $st, '--', 'shell', 'input text hello'))
Invoke-GuardCase 'restricted input tap' '95' ($c + @('--', 'shell', 'input tap 5 5'))
Invoke-GuardCase 'restricted keyevent BACK' '95' ($c + @('--', 'shell', 'input keyevent KEYCODE_BACK'))
Invoke-GuardCase 'restricted am start' '95' ($c + @('--', 'shell', ('am start -n ' + $pkg + '/.Main')))
Invoke-GuardCase 'restricted am force-stop' '95' ($c + @('--', 'shell', ('am force-stop ' + $pkg)))
Invoke-GuardCase 'restricted pm clear' '95' ($c + @('--', 'shell', ('pm clear ' + $pkg)))
Invoke-GuardCase 'restricted svc wifi disable' '95' ($c + @('--', 'shell', 'svc wifi disable'))
Invoke-GuardCase 'restricted settings put' '95' ($c + @('--', 'shell', 'settings put global x 1'))
Invoke-GuardCase 'restricted shell pm install' '95' ($c + @('--', 'shell', 'pm install /sdcard/Download/a.apk'))
Invoke-GuardCase 'restricted adb install' '95' ($c + @('--', 'install', '-r', 'C:\a.apk'))
Invoke-GuardCase 'restricted logcat' '95' ($c + @('--', 'logcat', '--pid', '123', '-d'))
Invoke-GuardCase 'restricted push' '95' ($c + @('--', 'push', 'C:\a.txt', '/sdcard/Download/a.txt'))
Invoke-GuardCase 'restricted pull' '95' ($c + @('--', 'pull', '/sdcard/Download/a.txt', (Join-Path $testDir 'a.txt')))
Invoke-GuardCase 'restricted rm' '95' ($c + @('--', 'shell', 'rm -f /sdcard/Download/a.txt'))
Invoke-GuardCase 'restricted unknown subcommand' '95' ($c + @('--', 'devices'))

# Scope files.
Set-Content $scopeTap ('{"serial": "' + $personal + '", "approvedBy": "maintainer", "date": "2026-11-11", "allow": ["tap", "input-text"]}')
Set-Content $scopeOther '{"serial": "OTHER999", "approvedBy": "maintainer", "date": "2026-11-11", "allow": ["tap", "input-text", "keyevent", "am-start", "install"]}'
Set-Content $scopeBad ('{"serial": "' + $personal + '", "approvedBy": "agent", "date": "2026-11-11", "allow": ["tap"]}')
$cs = $c + @('--scope-file', $scopeTap)
Set-LocateRecord $personal
Invoke-GuardCase 'scope tap: tap passes' '0' (@('tap') + $cs + @('--state', $st))
Invoke-GuardCase 'scope tap: input text after tap passes' '0' ($cs + @('--state', $st, '--', 'shell', 'input text hello'))
Invoke-GuardCase 'scope tap: keyevent BACK stays refused' '95' ($cs + @('--', 'shell', 'input keyevent KEYCODE_BACK'))
Invoke-GuardCase 'scope tap: am start stays refused' '95' ($cs + @('--', 'shell', ('am start -n ' + $pkg + '/.Main')))
Invoke-GuardCase 'scope tap: pick stays refused' '95' (@('pick') + $cs + @('--state', $st, '--name', 'Settings'))
Invoke-GuardCase 'scope tap: logcat stays refused' '95' ($cs + @('--', 'logcat', '--pid', '123'))
Invoke-GuardCase 'scope tap: install stays refused' '95' ($cs + @('--', 'install', 'C:\a.apk'))
Set-LocateRecord $personal
Invoke-GuardCase 'scope tap: typing chain still needs the tap' '99' ($cs + @('--state', $st, '--', 'shell', 'input text hello'))
$co = $c + @('--scope-file', $scopeOther)
Set-LocateRecord $personal
Invoke-GuardCase 'scope naming another serial: tap refused' '95' (@('tap') + $co + @('--state', $st))
Invoke-GuardCase 'scope naming another serial: input text refused' '95' ($co + @('--', 'shell', 'input text hi'))
Invoke-GuardCase 'scope naming another serial: install refused' '95' ($co + @('--', 'install', 'C:\a.apk'))
Invoke-GuardCase 'scope approvedBy agent is rejected' '2' (@('tap') + $c + @('--scope-file', $scopeBad, '--state', $st))
Invoke-GuardCase 'scope file missing is rejected' '2' (@('tap') + $c + @('--scope-file', (Join-Path $testDir 'nope.json'), '--state', $st))
$logText = Get-Content $log -Raw
$hash = (Get-FileHash $scopeTap -Algorithm SHA256).Hash.ToLower()
$logged = $logText.Contains('scope-file') -and $logText.Contains($hash)
if (-not $logged) { $script:failures++ }
($(if ($logged) { 'ok  ' } else { 'FAIL' })) + ' scope file path and sha256 are logged'
$scopeAm = Join-Path $testDir ('scope-am-' + $runId + '.json')
Set-Content $scopeAm ('{"serial": "' + $personal + '", "approvedBy": "maintainer", "date": "2026-11-11", "allow": ["am-start"]}')
$ca = $c + @('--scope-file', $scopeAm)
Invoke-GuardCase 'scope am-start: own component passes' '0' ($ca + @('--', 'shell', ('am start -n ' + $pkg + '/.MainActivity')))
Invoke-GuardCase 'scope am-start: -W own component passes' '0' ($ca + @('--', 'shell', ('am start -W -n ' + $pkg + '/.MainActivity')))
Invoke-GuardCase 'scope am-start: CALL intent refused' '95' ($ca + @('--', 'shell', 'am start -a android.intent.action.CALL tel:112'))
Invoke-GuardCase 'scope am-start: DIAL intent refused' '95' ($ca + @('--', 'shell', 'am start -a android.intent.action.DIAL'))
Invoke-GuardCase 'scope am-start: other package refused' '95' ($ca + @('--', 'shell', 'am start -n com.other.app/.Main'))
Invoke-GuardCase 'scope am-start: own component plus action refused' '95' ($ca + @('--', 'shell', ('am start -a android.intent.action.VIEW -n ' + $pkg + '/.MainActivity')))
Invoke-GuardCase 'scope am-start: own component plus extra refused' '95' ($ca + @('--', 'shell', ('am start -n ' + $pkg + '/.MainActivity --es k v')))
# A scope file for a full-access serial changes nothing and is not read.
Invoke-GuardCase 'full-access serial ignores scope: keyevent BACK still ok' '0' ($full + @('--scope-file', $scopeTap, '--', 'shell', 'input keyevent KEYCODE_BACK'))

# Full-access serials behave as before.
Invoke-GuardCase 'full am start' '0' ($full + @('--', 'shell', ('am start -n ' + $pkg + '/.Main')))
Invoke-GuardCase 'full pm clear own' '0' ($full + @('--', 'shell', ('pm clear ' + $pkg)))
Invoke-GuardCase 'full svc wifi disable' '0' ($full + @('--', 'shell', 'svc wifi disable'))
Invoke-GuardCase 'full logcat' '0' ($full + @('--', 'logcat', '--pid', '123', '-d'))
Invoke-GuardCase 'full keyevent BACK' '0' ($full + @('--', 'shell', 'input keyevent KEYCODE_BACK'))
Invoke-GuardCase 'full shell pm install still 97' '97' ($full + @('--', 'shell', 'pm install /sdcard/Download/a.apk'))
Invoke-GuardCase 'full install apk' '0' ($full + @('--', 'install', '-r', 'C:\a.apk'))
Invoke-GuardCase 'note 9 phone 2 pm clear own' '0' (@('--serial', '2ac80128013f7ece', '--log', $log, '--own-package', 'io.github.yor42.risutanium', '--', 'shell', 'pm clear io.github.yor42.risutanium'))
Invoke-GuardCase 'emulator-5580 logcat' '0' (@('--serial', 'emulator-5580', '--log', $log, '--', 'logcat', '--pid', '5', '-d'))
Invoke-GuardCase 'near-miss serial is restricted' '95' (@('--serial', 'emulator-5582', '--log', $log, '--', 'logcat', '--pid', '5', '-d'))
Remove-Item Env:ADBG_FAKE_ADB_SCRIPT; Remove-Item Env:FAKE_EXIT
'failures=' + $script:failures
exit $script:failures
