# Fake-adb cases for the adbg link forms (r20): the emulator-5580 am start pin and the Note 9 percent-decoded pass with the DZ-2 additions.
# Usage: pwsh -File link-forms.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
# Quoted rows rely on one argument per array element reaching node unchanged.
$PSNativeCommandArgumentPassing = 'Standard'
# Scratch files (fake adb, call record, log, scope file) go to a fresh temp folder, never next to the tracked test.
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake-links.mjs'
$calls = Join-Path $testDir 'calls.txt'
# Records every call it receives, so "sent" is observable, and exits 0.
Set-Content $fake 'import { appendFileSync } from ''node:fs''; appendFileSync(process.env.FAKE_CALLS, JSON.stringify(process.argv.slice(2)) + ''\n''); process.exit(0)'
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_CALLS = $calls
$log = Join-Path $testDir 'log.txt'
$scopeAm = Join-Path $testDir 'scope-am.json'
$script:failures = 0
$app = 'io.github.yor42.risutanium'
$emu = 'emulator-5580'
$note9 = @('29f3cde9193f7ece', '2ac80128013f7ece')

# Runs one guard call and checks the exit code, how many calls reached the fake (0 or 1) and, for a refusal, the text on stderr.
function Invoke-LinkCase([string]$label, [string]$serial, [string]$want, [string[]]$adbArgs, [string]$own = '', [string]$zone = '', [string[]]$extra = @()) {
    if (Test-Path $calls) { Remove-Item $calls }
    $g = @('--serial', $serial, '--log', $log) + $extra
    if ($own -ne '') { $g += @('--own-package', $own) }
    $g += @('--') + $adbArgs
    $out = (& node $GuardPath @g 2>&1 | Out-String)
    $rc = [string]$LASTEXITCODE
    $sent = if (Test-Path $calls) { @(Get-Content $calls).Count } else { 0 }
    $wantSent = if ($want -eq '0') { 1 } else { 0 }
    $ok = ($rc -eq $want) -and ($sent -eq $wantSent) -and ($zone -eq '' -or $out.Contains($zone))
    if (-not $ok) { $script:failures++ }
    ($(if ($ok) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' [' + $serial + '] -> ' + $rc + ' sent=' + $sent + ' (want ' + $want + ' sent=' + $wantSent + $(if ($zone -ne '') { ' ' + $zone } else { '' }) + ')'
}
function Invoke-EmuStart([string]$label, [string]$want, [string]$line, [string]$own = $app) {
    Invoke-LinkCase $label $emu $want @('shell', $line) $own
}

# LF-1: emulator-5580 refuses every link form that opens another app.
foreach ($line in @(
    'am start tel:112', 'am start -a android.intent.action.CALL tel:112', 'am start TEL:112',
    'am start -a android.intent.action.SENDTO mailto:a@b.c', 'am start sms:123', 'am start smsto:123', 'am start mmsto:123',
    'am start content:media/external/file/1', 'am start file:/sdcard/Download/x.html', 'am start http:example.com',
    'am start https:/example.com', 'am start geo:37.5', 'am start market:details',
    "am start -a android.intent.action.VIEW --eu android.intent.extra.STREAM content:x -n $app/.Main",
    "am start -n $app/.Main --es k a:b")) {
    Invoke-EmuStart ('emulator link form refused: ' + $line) '97' $line
}

# LF-2: the app's own explicit start passes verbatim; the own-package rule still binds it.
Invoke-EmuStart 'emulator own start' '0' "am start -n $app/.MainActivity"
Invoke-EmuStart 'emulator own start -W' '0' "am start -W -n $app/.MainActivity"
Invoke-EmuStart 'emulator own start, extra blanks' '0' "am   start  -W  -n   $app/.MainActivity"
Invoke-EmuStart 'emulator own start, qualified class' '0' "am start -n $app/io.github.yor42.risutanium.MainActivity"
Invoke-EmuStart 'emulator force-stop unchanged' '0' "am force-stop $app"
Invoke-LinkCase 'emulator own start needs --own-package' $emu '97' @('shell', "am start -n $app/.MainActivity")
Invoke-LinkCase 'emulator own start with another --own-package' $emu '97' @('shell', "am start -n $app/.MainActivity") 'com.android.chrome'

# LF-3: forms outside the pin or outside am start stay refused.
Invoke-EmuStart 'emulator -d tel' '97' 'am start -d tel:112'
Invoke-EmuStart 'emulator -d https' '97' 'am start -d https://example.com'
Invoke-EmuStart 'emulator am broadcast' '97' 'am broadcast -a android.intent.action.BOOT_COMPLETED'
Invoke-EmuStart 'emulator cmd activity start-activity' '97' 'cmd activity start-activity tel:112'
Invoke-EmuStart 'emulator content query' '97' 'content query --uri content://media/external/file'
Invoke-EmuStart 'emulator monkey' '97' 'monkey 1'
Invoke-EmuStart 'emulator quoted tel' '97' "am start 'tel:112'"
Invoke-LinkCase 'emulator split-argument start' $emu '97' @('shell', 'am', 'start', '-n', "$app/.Main") $app
Invoke-EmuStart 'emulator package prefix' '97' "am start -n ${app}x/.Main"
Invoke-EmuStart 'emulator quoted component' '97' "am start -n '$app/.Main'"
Invoke-EmuStart 'emulator package only' '97' "am start -n $app"
Invoke-EmuStart 'emulator component then command' '97' "am start -n $app/.Main;reboot"

# LF-4: restricted serials keep their own rules (95); the pin does not reach them.
Set-Content $scopeAm ('{"serial": "R5CWTABTEST1", "approvedBy": "maintainer", "date": "2026-11-11", "allow": ["am-start"]}')
Invoke-LinkCase 'restricted scope: other own app passes (restricted scope unchanged)' 'R5CWTABTEST1' '0' @('shell', 'am start -n io.example.app/.MainActivity') 'io.example.app' '' @('--scope-file', $scopeAm)
Invoke-LinkCase 'restricted scope: app id passes' 'R5CWTABTEST1' '0' @('shell', "am start -n $app/.MainActivity") $app '' @('--scope-file', $scopeAm)
Invoke-LinkCase 'restricted scope: chrome as own package passes (named residual)' 'R5CWTABTEST1' '0' @('shell', 'am start -n com.android.chrome/.Main') 'com.android.chrome' '' @('--scope-file', $scopeAm)
Invoke-LinkCase 'restricted scope: tel refused' 'R5CWTABTEST1' '95' @('shell', 'am start tel:112') $app '' @('--scope-file', $scopeAm)
Invoke-LinkCase 'restricted scope: extra refused' 'R5CWTABTEST1' '95' @('shell', "am start -n $app/.MainActivity --es k tel:1") $app '' @('--scope-file', $scopeAm)
foreach ($s in @('R5CWTABTEST1', '2ac80128013f7ecf')) {
    Invoke-LinkCase 'restricted am start without scope' $s '95' @('shell', "am start -n $app/.MainActivity") $app
    Invoke-LinkCase 'restricted tel without scope' $s '95' @('shell', 'am start tel:112') $app
}

# LF-5: the pin admits nothing beyond the one form.
foreach ($line in @(
    'am start -a android.intent.action.DIAL', 'am start -a android.intent.action.SEND --eu android.intent.extra.EMAIL a@b.c',
    'am start -a android.intent.action.WEB_SEARCH', 'am start -a android.intent.action.MAIN -c android.intent.category.APP_BROWSER',
    'am start com.android.chrome', "am start -n $app/.Main -a android.intent.action.VIEW", "am start -a android.intent.action.VIEW -n $app/.Main",
    "am start -n $app/.Main --es k v", "am start -n $app/.Main -W", 'am start -n com.other.app/.Main', "am start -n $app/../x",
    "am start -n $app/", "am start -p $app", "am start $app/.Main")) {
    Invoke-EmuStart ('emulator pin refuses: ' + $line) '97' $line
}
foreach ($other in @('com.android.chrome', 'com.google.android.dialer', 'io.example.app', 'io.github.yor42.tbdriver')) {
    Invoke-EmuStart ('emulator pin ignores --own-package ' + $other) '97' "am start -n $other/.Main" $other
}
Invoke-EmuStart 'emulator upper-case app id with matching --own-package' '97' 'am start -n IO.GITHUB.YOR42.RISUTANIUM/.Main' 'IO.GITHUB.YOR42.RISUTANIUM'
Invoke-EmuStart 'emulator upper-case app id' '97' 'am start -n IO.GITHUB.YOR42.RISUTANIUM/.Main'

# LF-6: both Note 9s refuse percent-encoded and added link forms (89), in shell, split shell, exec-out and pull sources.
$shellLines = @(
    @('content query --uri content://c%61ll_log/calls', 'DZ-1'), @('content query --uri content://c%41ll_log/calls', 'DZ-1'),
    @('content query --uri content://s%6ds/inbox', 'DZ-1'), @('content query --uri content://s%6Ds/inbox', 'DZ-1'),
    @('content query --uri content://c%6fntacts/contacts', 'DZ-1'), @('content query --uri content://c%6Fntacts/contacts', 'DZ-1'),
    @('content query --uri content://%43ontacts/contacts', 'DZ-1'),
    @('am start -d content://com.android.c%6Fntacts/data/1', 'DZ-1'),
    @('am start -a android.intent.action.VIEW -d mmsto:123', 'DZ-2'), @('am start -a android.intent.action.VIEW -d sip:123', 'DZ-2'),
    @('am start -a android.intent.action.VIEW -d sips:123', 'DZ-2'), @('am start -a android.intent.action.VIEW -d SIP:123', 'DZ-2'),
    @('am start -a android.intent.action.VIEW -d callto:123', 'DZ-2'),
    @('am start intent://x#Intent;scheme=tel;end', 'DZ-2'), @('am start intent://x#Intent;scheme=t%65l;end', 'DZ-2'),
    @('am start intent://x#Intent;scheme=TEL;end', 'DZ-2'), @('am start intent://x#Intent;scheme=sips;end', 'DZ-2'),
    @('am start intent://x#Intent;scheme=callto;end', 'DZ-2'),
    @('am broadcast -a android.intent.action.%44IAL', 'DZ-2'),
    @('ls /sdcard/Download/a%20call.txt', 'DZ-2'))
foreach ($serial in $note9) {
    foreach ($row in $shellLines) {
        Invoke-LinkCase ('note9 shell refused: ' + $row[0]) $serial '89' @('shell', $row[0]) '' $row[1]
        Invoke-LinkCase ('note9 split shell refused: ' + $row[0]) $serial '89' (@('shell') + ($row[0] -split ' ')) '' $row[1]
        Invoke-LinkCase ('note9 exec-out refused: ' + $row[0]) $serial '89' @('exec-out', $row[0]) '' $row[1]
    }
    Invoke-LinkCase 'note9 pull source refused' $serial '89' @('pull', '/sdcard/Download/%63all.txt', (Join-Path $testDir 'pulled-a.txt')) '' 'DZ-2'
    Invoke-LinkCase 'note9 pull source refused (contacts)' $serial '89' @('pull', '/sdcard/Download/%63ontacts.db', (Join-Path $testDir 'pulled-b.txt')) '' 'DZ-1'
    Invoke-LinkCase 'note9 push destination refused' $serial '89' @('push', $GuardPath, '/sdcard/Download/%63all.txt') '' 'DZ-2'
}

# LF-6p: the raw pass still refuses what it refused before; the decoded pass adds to it.
foreach ($serial in $note9) {
    foreach ($v in @('%3A0', '%3a0')) {
        Invoke-LinkCase ('note9 http_proxy with encoded value ' + $v) $serial '89' @('shell', "settings put global http_proxy $v") '' 'DZ-8'
    }
}

# LF-7: harmless percent and plus text, and the lane B templates, still pass on both Note 9s.
$okLines = @(
    "date '+%m-%d %H:%M:%S.000'", "run-as $app stat -c '%s %n' /data/local/tmp/x", "logcat -d -T '10-21 12:00:00.000'",
    'ls /sdcard/Download/a%ZZ.txt', 'ls /sdcard/Download/a%E0%A4.txt', 'echo 100%', 'echo a%',
    'ls /sdcard/Download/gossip.txt', 'echo gossip:x', 'ls /sdcard/Download/hotel.txt', 'ls /sdcard/Download/a%20b.txt',
    'input+keyevent+5', "dumpsys deviceidle whitelist +$app", "dumpsys deviceidle whitelist -$app",
    'settings get global wifi_on', 'settings put global http_proxy :0', 'content query --uri content://c%2561ll_log/calls',
    'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/S2bC2.charx',
    "am start -a android.intent.action.SEND -t application/octet-stream --eu android.intent.extra.STREAM content://media/external/file/6018 --grant-read-uri-permission -n $app/.MainActivity",
    "am start -a android.intent.action.VIEW -d content://com.android.externalstorage.documents/document/primary%3ADownload%2FS2bM1.risum -t application/octet-stream --grant-read-uri-permission -n $app/.MainActivity",
    "am start -a android.intent.action.VIEW -d content://media/external/file/6016 -t application/octet-stream --grant-read-uri-permission -n $app/.MainActivity",
    "content query --uri content://media/external/file --projection _id:_display_name --where _display_name='S2bC2.charx'",
    'am start -a android.intent.action.VIEW -d https://example.com',
    "am start -n $app/.MainActivity", "am start -W -n $app/.MainActivity",
    'am start -a android.intent.action.VIEW -d geo:37.5,127.0',
    "am start -a android.intent.action.VIEW -d market://details?id=$app")
foreach ($serial in $note9) {
    foreach ($line in $okLines) { Invoke-LinkCase ('note9 passes: ' + $line) $serial '0' @('shell', $line) }
}

# LF-8: the existing zones keep their own words.
foreach ($serial in $note9) {
    Invoke-LinkCase 'note9 am start tel' $serial '89' @('shell', 'am start tel:112') '' 'DZ-2'
    Invoke-LinkCase 'note9 contacts provider' $serial '89' @('shell', 'content query --uri content://com.android.contacts/contacts') '' 'DZ-1'
}

Remove-Item Env:ADBG_FAKE_ADB_SCRIPT; Remove-Item Env:FAKE_CALLS
'failures=' + $script:failures
exit $script:failures
