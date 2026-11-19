# Fake-adb cases for the adbg r15 open-with/share intents (MC-2271, MC-2275) on the two playground Note 9s.
# Usage: pwsh -File intent-start.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
# Hostile arguments carry quotes and backslashes; pass them to node unchanged.
$PSNativeCommandArgumentPassing = 'Standard'
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake.mjs'
$calls = Join-Path $testDir 'calls.txt'
# The fake adb records every call as one JSON array.
Set-Content $fake 'import { appendFileSync } from "node:fs"; appendFileSync(process.env.FAKE_CALLS, JSON.stringify(process.argv.slice(2)) + "\n"); process.exit(0)'
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_CALLS = $calls
# Every guard spawn goes through the stand-in adb; never run a case where it is not in place.
if (-not $env:ADBG_FAKE_ADB_SCRIPT -or -not (Test-Path -LiteralPath $env:ADBG_FAKE_ADB_SCRIPT)) { throw 'ADBG_FAKE_ADB_SCRIPT is not set to an existing fake: refusing to run' }
$log = Join-Path $testDir 'log.txt'
$scope = Join-Path $testDir 'scope.json'
$script:failures = 0
$pg = @('29f3cde9193f7ece', '2ac80128013f7ece')
$emu = 'emulator-5580'
$pkg = 'io.github.yor42.risutanium'
$comp = $pkg + '/.MainActivity'
$grant = '--grant-read-uri-permission'
$actView = 'android.intent.action.VIEW'
$actSend = 'android.intent.action.SEND'
$keyStream = 'android.intent.extra.STREAM'
$tab = [string][char]9
$lf = [string][char]10
$nbsp = [string][char]0xA0
$me = 'content://media/external'
$dd = 'content://com.android.externalstorage.documents'
$U1 = $me + '/images/media/42'
$U2 = $dd + '/document/primary%3ADownload%2Fc471-card.png'
$U3 = $me + '/file/7'
$types = @('image/png', 'image/jpeg', 'application/json', 'application/octet-stream', 'application/zip', 'application/x-zip-compressed')
function Get-View([string]$u, [string]$m) { 'am start -a ' + $actView + ' -d ' + $u + ' -t ' + $m + ' ' + $grant + ' -n ' + $comp }
function Get-Send([string]$m, [string]$u) { 'am start -a ' + $actSend + ' -t ' + $m + ' --eu ' + $keyStream + ' ' + $u + ' ' + $grant + ' -n ' + $comp }
function Test-Result([string]$label, [bool]$ok, [string]$detail) {
    if (-not $ok) { $script:failures++ }
    ($(if ($ok) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' ' + $detail
}
# The leading comma keeps a single call an array, so indexing and Count behave the same for one call as for several.
function Get-Calls { if (Test-Path $calls) { , @(Get-Content $calls) } else { , @() } }
function Reset-Calls { if (Test-Path $calls) { Remove-Item $calls } }
function Get-LogText { if (Test-Path $log) { Get-Content $log -Raw } else { '' } }
function Get-CallArgs([string]$line) { ((ConvertFrom-Json -InputObject $line) -join [char]0) }
# JSON string escaping as JSON.stringify does it, without the outer quotes.
function Get-JsEscaped([string]$text) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $text.ToCharArray()) {
        $code = [int]$ch
        if ($ch -eq [char]'\') { $null = $sb.Append('\\') }
        elseif ($ch -eq [char]'"') { $null = $sb.Append('\"') }
        elseif ($code -eq 10) { $null = $sb.Append('\n') }
        elseif ($code -eq 13) { $null = $sb.Append('\r') }
        elseif ($code -eq 9) { $null = $sb.Append('\t') }
        elseif ($code -lt 32) { $null = $sb.Append('\u' + $code.ToString('x4')) }
        else { $null = $sb.Append($ch) }
    }
    $sb.ToString()
}
# The refusal line holds the command string twice encoded: inside the JSON array of the adb arguments, then as the log message.
function Get-ArrivalMarker([string]$text) { Get-JsEscaped ('"' + (Get-JsEscaped $text) + '"') }
function Invoke-Guard([string]$ser, [string[]]$adbArgs, [string[]]$extra = @()) {
    Reset-Calls
    & node $GuardPath --serial $ser --log $log --own-package $pkg @extra -- @adbArgs 2>$null | Out-Null
    [string]$LASTEXITCODE
}
# An allowed intent exits 0, sends exactly -s <serial> shell <string> and logs the extended playground class.
function Test-Sent([string]$label, [string]$ser, [string]$cmd) {
    Remove-Item $log -ErrorAction SilentlyContinue
    $rc = Invoke-Guard $ser @('shell', $cmd)
    $got = Get-Calls
    $want = @('-s', $ser, 'shell', $cmd) -join [char]0
    $sent = if ($got.Count -ge 1) { Get-CallArgs $got[0] } else { '' }
    $logOk = (Get-LogText).Contains('PLAYGROUND serial=' + $ser + ' allow=extended')
    Test-Result $label ($rc -eq '0' -and $got.Count -eq 1 -and $sent -eq $want -and $logOk) ('-> ' + $rc + ' calls=' + $got.Count + ' sent=' + ($sent -replace [char]0, ' | '))
}
# A refused call exits with the wanted code and sends nothing. With -Arrival the refusal line must hold the string intact.
function Test-Refused([string]$label, [string]$ser, [string[]]$adbArgs, [string]$want, [string[]]$extra = @(), [bool]$arrival = $false) {
    Remove-Item $log -ErrorAction SilentlyContinue
    $rc = Invoke-Guard $ser $adbArgs $extra
    $arrived = $true
    if ($arrival) { $arrived = (Get-LogText).Contains((Get-ArrivalMarker $adbArgs[1])) -and (Get-LogText).Contains('REFUSED/ERROR exit=' + $want) }
    Test-Result $label ($rc -eq $want -and (Get-Calls).Count -eq 0 -and $arrived) ('-> ' + $rc + ' (want ' + $want + ') calls=' + (Get-Calls).Count + ' arrived=' + $arrived)
}
function Test-Verbatim([string]$label, [string]$ser, [string]$cmd, [string]$want) {
    Remove-Item $log -ErrorAction SilentlyContinue
    $rc = Invoke-Guard $ser @('shell', $cmd)
    $got = Get-Calls
    if ($want -eq '0') {
        $sent = if ($got.Count -ge 1) { Get-CallArgs $got[0] } else { '' }
        Test-Result $label ($rc -eq '0' -and $got.Count -eq 1 -and $sent -eq (@('-s', $ser, 'shell', $cmd) -join [char]0)) ('-> ' + $rc)
    } else {
        Test-Result $label ($rc -eq $want -and $got.Count -eq 0) ('-> ' + $rc + ' (want ' + $want + ') calls=' + $got.Count)
    }
}

# IN1-IN3: VIEW and SEND with item URIs and every type, on both serials, exact argv.
foreach ($s in $pg) {
    Test-Sent ($s + ' IN1 view media item png') $s (Get-View $U1 'image/png')
    Test-Sent ($s + ' IN1 view document png') $s (Get-View $U2 'image/png')
    Test-Sent ($s + ' IN2 send media item png') $s (Get-Send 'image/png' $U1)
    Test-Sent ($s + ' IN2 send document json') $s (Get-Send 'application/json' $U2)
}
foreach ($m in $types) {
    Test-Sent ('2ac80128013f7ece IN3 view file item ' + $m) '2ac80128013f7ece' (Get-View $U3 $m)
    Test-Sent ('29f3cde9193f7ece IN3 send file item ' + $m) '29f3cde9193f7ece' (Get-Send $m $U3)
}

# IN4: the r11 am start rule is unchanged on emulator-5580 (compatibility guard). The Note 9 profile (r3) lifted the -d pin on the playground
# serials, so a plain https VIEW passes there (FC-5; DZ-9 refuses only the real-service words).
foreach ($s in ($pg + $emu)) {
    Test-Verbatim ($s + ' IN4 am start -n own component') $s ('am start -n ' + $pkg + '/.Main') '0'
}
Test-Verbatim ($emu + ' IN4 am start -d https stays refused') $emu ('am start -a ' + $actView + ' -d https://example.com') '97'
foreach ($s in $pg) { Test-Verbatim ($s + ' IN4 am start -d https passes on the Note 9 profile') $s ('am start -a ' + $actView + ' -d https://example.com') '0' }

# IN5: the emulator refuses the intent forms.
foreach ($cmd in @((Get-View $U1 'image/png'), (Get-View $U2 'image/png'), (Get-Send 'image/png' $U1), (Get-Send 'application/json' $U2))) {
    Test-Refused ($emu + ' IN5 ' + $cmd) $emu @('shell', $cmd) '97'
}

# IN6: restricted and near-miss serials give 95, even with an am-start scope file.
foreach ($s in @('R58M12345AB', 'R5CT1234ABC', '2ac80128013f7ecf', '2AC80128013F7ECE', '29f3cde9193f7ece1')) {
    Test-Refused ($s + ' IN6 view') $s @('shell', (Get-View $U1 'image/png')) '95'
    Test-Refused ($s + ' IN6 send') $s @('shell', (Get-Send 'image/png' $U1)) '95'
}
$scopeJson = '{"serial":"R58M12345AB","approvedBy":"maintainer","date":"2026-11-18","allow":["tap","input-text","keyevent","am-start","install"]}'
Set-Content -LiteralPath $scope $scopeJson
Test-Refused 'R58M12345AB IN6 view with a full scope file' 'R58M12345AB' @('shell', (Get-View $U1 'image/png')) '95' @('--scope-file', $scope)
Test-Refused 'R58M12345AB IN6 send with a full scope file' 'R58M12345AB' @('shell', (Get-Send 'image/png' $U1)) '95' @('--scope-file', $scope)

# IN7 to IN12: the template and URI class refusals (hostile URIs, other types, actions, components, flags, extra tokens, collections, odd ids).
# The Note 9 profile (r3) answers these on the playground serials with its denylist (allowed, or 89 for a DZ-1 provider), so the rows are
# retargeted to emulator-5580, where the same strings keep exit 97 and still arrive intact in the refusal line. Hostile data URIs and the
# providers DZ-1 names are pinned on the Note 9s right after IN7.
# IN7: hostile URIs get 97 with no call and arrive intact in the refusal line. The last two are VIEW only.
$hostile = @(
    'file:///sdcard/Download/c471-card.png', 'https://media/external/file/1', 'http://example.com/x', 'intent://media/external/file/1',
    'CONTENT://media/external/file/1', 'content://MEDIA/external/file/1', 'content://com.android.contacts/contacts/1', 'content://sms/inbox',
    'content://call_log/calls', 'content://io.github.yor42.risutanium.fileprovider/my_images/Download/c471-card.png',
    'content://com.android.providers.downloads.documents/document/12', 'content://media.evil/external/file/1', 'content://mediax/external/file/1',
    'content://com.android.externalstorage.documentsx/document/1', 'content://media', 'content://media/', 'content://media/external//file',
    ($me + '/file/1#frag'), ($me + '/file/~'), ($me + '/{a,b}'), ($me + '/file/1=2'), ($me + '/file/a+b'), ($me + '/file/a,b'), ($me + '/file/a!b'),
    'content://user@media/external/file/1', 'content://media:80/external/file/1', ($me + '/file/%2E%2E'), ($me + '/file/%20x'), ($me + '/file/%0A'),
    ($me + '/file/%27'), ($me + '/file/%3a'), ($dd + '/document/primary%3ADownload%2F..%2FAndroid%2Fdata%2Fx'), 'content://media/../external/file/1',
    ($me + '/file/1?x'), ($me + '/file/1;reboot'), ($me + '/file/$(id)'), ($me + '/file/`id`'), ($me + '/file/''x'''), ($me + '/file/"x"'),
    ($me + '/file/a\b'), ($me + '/file/a' + $tab + 'b'), ($me + '/file/a' + $lf + 'reboot'), ($me + '/file/a' + $nbsp + 'b'), ($me + '/file/a*'))
$hostileViewOnly = @('content:media/external/file/1', 'content:/media/external/file/1')
foreach ($u in ($hostile + $hostileViewOnly)) {
    Test-Refused ('emulator-5580 IN7 view ' + $u) $emu @('shell', (Get-View $u 'image/png')) '97' @() $true
}
foreach ($u in $hostile) {
    Test-Refused ('emulator-5580 IN7 send ' + $u) $emu @('shell', (Get-Send 'image/png' $u)) '97' @() $true
}
foreach ($s in $pg) {
    foreach ($u in @('content://com.android.contacts/contacts/1', 'content://sms/inbox', 'content://call_log/calls')) {
        Test-Refused ($s + ' IN7 view ' + $u + ' is DZ-1 on the Note 9 profile') $s @('shell', (Get-View $u 'image/png')) '89'
        Test-Refused ($s + ' IN7 send ' + $u + ' is DZ-1 on the Note 9 profile') $s @('shell', (Get-Send 'image/png' $u)) '89'
    }
}

# IN8: types, actions, components, flags and keys outside the templates.
$badTypes = @('text/html', 'text/plain', 'image/gif', 'image/webp', 'application/vnd.android.package-archive', 'IMAGE/PNG', 'image/png2', 'image/*', '*/*', 'image/png;x')
foreach ($m in $badTypes) {
    Test-Refused ('IN8 view type ' + $m) $emu @('shell', (Get-View $U1 $m)) '97'
    Test-Refused ('IN8 send type ' + $m) $emu @('shell', (Get-Send $m $U1)) '97'
}
foreach ($a in @('CALL', 'DIAL', 'EDIT', 'SEND_MULTIPLE', 'SENDTO', 'android.intent.action.view', 'SEND')) {
    $act = if ($a -like 'android.intent.action.*') { $a } else { 'android.intent.action.' + $a }
    Test-Refused ('IN8 view action ' + $act) $emu @('shell', ((Get-View $U1 'image/png').Replace($actView, $act))) '97'
}
foreach ($a in @('SEND_MULTIPLE', 'VIEW', 'EDIT')) {
    Test-Refused ('IN8 send action ' + $a) $emu @('shell', ((Get-Send 'image/png' $U1).Replace($actSend, 'android.intent.action.' + $a))) '97'
}
foreach ($c in @('com.android.chrome/.Main', ($pkg + '/.Other'), ($pkg + '/' + $pkg + '.MainActivity'), ($pkg + '.evil/.MainActivity'), ('com.evil/' + $pkg + '.MainActivity'))) {
    Test-Refused ('IN8 view component ' + $c) $emu @('shell', ((Get-View $U1 'image/png').Replace($comp, $c))) '97'
    Test-Refused ('IN8 send component ' + $c) $emu @('shell', ((Get-Send 'image/png' $U1).Replace($comp, $c))) '97'
}
foreach ($f in @('--grant-write-uri-permission', '--grant-persistable-uri-permission', '--grant-prefix-uri-permission')) {
    Test-Refused ('IN8 view flag ' + $f) $emu @('shell', ((Get-View $U1 'image/png').Replace($grant, $f))) '97'
    Test-Refused ('IN8 send flag ' + $f) $emu @('shell', ((Get-Send 'image/png' $U1).Replace($grant, $f))) '97'
}
foreach ($k in @('android.intent.extra.TEXT', 'android.intent.extra.STREAMS', 'android.intent.extra.HTML_TEXT')) {
    Test-Refused ('IN8 send key ' + $k) $emu @('shell', ((Get-Send 'image/png' $U1).Replace($keyStream, $k))) '97'
}

# IN9: extra, missing, reordered or repeated tokens; other verbs; the template split into adb arguments.
$V = Get-View $U1 'image/png'
$D = Get-Send 'image/png' $U1
$nine = @(
    ($V + ' --es k v'), ($V + ' -f 0x10000000'), ($V + ' --ez a true'), ($D + ' --eu ' + $keyStream + ' ' + $U3),
    $V.Replace('am start ', 'am start -W '), $V.Replace('am start ', 'am start --user 0 '), ($D + ' -d ' + $U1),
    ('am start -n ' + $comp + ' -a ' + $actView + ' -d ' + $U1 + ' -t image/png ' + $grant),
    $V.Replace(' ' + $grant, ''), $V.Replace($grant, $grant + ' ' + $grant), $V.Replace('-n ' + $comp, '-p ' + $pkg),
    $V.Replace(' -t image/png', ''), $D.Replace(' ' + $grant, ''), ($V + ' -c android.intent.category.BROWSABLE'),
    $V.Replace('am start ', 'am startservice '), $V.Replace('am start ', 'am start-activity '), $V.Replace('am start ', 'am broadcast '),
    ('shell ' + $V), ('shell ' + $D))
foreach ($cmd in $nine) { Test-Refused ('IN9 ' + $cmd) $emu @('shell', $cmd) '97' }
Test-Refused 'IN9 view split into separate adb arguments' $emu (@('shell') + $V.Split(' ')) '97'
Test-Refused 'IN9 send split into separate adb arguments' $emu (@('shell') + $D.Split(' ')) '97'

# IN11: collection, tree, root and empty-path URIs, both forms, both serials.
$collections = @(
    $me, ($me + '/file'), ($me + '/images/media'), ($me + '/video/media'), ($me + '/audio/media'), ($me + '/file/'), ($me + '/images/media/'),
    ($dd + '/tree/primary%3A'), ($dd + '/tree/primary%3ADownload'), ($dd + '/tree/primary%3ADownload/document/primary%3ADownload%2Fa.png'),
    ($dd + '/root/primary'), ($dd + '/document/primary%3A'))
foreach ($s in @($emu)) {
    foreach ($u in $collections) {
        Test-Refused ($s + ' IN11 view ' + $u) $s @('shell', (Get-View $u 'image/png')) '97'
        Test-Refused ($s + ' IN11 send ' + $u) $s @('shell', (Get-Send 'image/png' $u)) '97'
    }
}

# IN12: other volumes, thumbnails, malformed ids and path characters outside the class.
$odd = @(
    'content://media/internal/images/media/1', 'content://media/external_primary/images/media/1', ($me + '/images/thumbnails/1'), ($me + '/file/1a'),
    ($me + '/file/-1'), ($me + '/file/0x1f'), ($me + '/file/1/2'), ($me + '/downloads/1'))
foreach ($suffix in @('a#b', '~', '{a,b}', 'a=b', 'a+b', 'a,b', 'a!b', '%20x', '%0A', '%27', 'a%3Ab', 'Download%2F..%2Fx', '..', 'a%2fb', 'a/b')) { $odd += ($dd + '/document/primary%3A' + $suffix) }
$odd += ($dd + '/document/primary%3a'), ($dd + '/document/home%3Aa.png'), ($dd + '/document/1234-ABCD%3Aa.png')
foreach ($s in @($emu)) {
    foreach ($u in $odd) {
        Test-Refused ($s + ' IN12 view ' + $u) $s @('shell', (Get-View $u 'image/png')) '97'
        Test-Refused ($s + ' IN12 send ' + $u) $s @('shell', (Get-Send 'image/png' $u)) '97'
    }
}

# IN13: accepted item forms, both templates, both serials.
$items = @(($me + '/images/media/42'), ($me + '/video/media/7'), ($me + '/audio/media/9'), ($me + '/file/7'), ($dd + '/document/primary%3ADownload%2Fc471-card.png'), ($dd + '/document/primary%3Aa.b_c-d'), ($dd + '/document/primary%3ADownload%2F.hidden'))
foreach ($s in $pg) {
    foreach ($u in $items) {
        Test-Sent ($s + ' IN13 view ' + $u) $s (Get-View $u 'image/png')
        Test-Sent ($s + ' IN13 send ' + $u) $s (Get-Send 'image/png' $u)
    }
}

Remove-Item Env:ADBG_FAKE_ADB_SCRIPT; Remove-Item Env:FAKE_CALLS
Remove-Item -LiteralPath $testDir -Recurse -Force -ErrorAction SilentlyContinue
'failures=' + $script:failures
exit $script:failures
