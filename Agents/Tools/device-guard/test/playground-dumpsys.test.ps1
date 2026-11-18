# Fake-adb cases for the adbg r15 playground dumpsys allow list (MC-2281, MC-2287): thirteen allowed forms, everything
# else refused with 97. Usage: pwsh -File playground-dumpsys.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
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
$script:failures = 0
$pg = @('29f3cde9193f7ece', '2ac80128013f7ece')
$emu = 'emulator-5580'
$pkg = 'io.github.yor42.risutanium'
$tab = [string][char]9
$lf = [string][char]10
function Test-Result([string]$label, [bool]$ok, [string]$detail) {
    if (-not $ok) { $script:failures++ }
    ($(if ($ok) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' ' + $detail
}
# The leading comma keeps a single call an array, so indexing and Count behave the same for one call as for several.
function Get-Calls { if (Test-Path $calls) { , @(Get-Content $calls) } else { , @() } }
function Reset-Calls { if (Test-Path $calls) { Remove-Item $calls } }
function Get-LogText { if (Test-Path $log) { Get-Content $log -Raw } else { '' } }
function Get-CallArgs([string]$line) { ((ConvertFrom-Json -InputObject $line) -join [char]0) }
function Invoke-Guard([string]$ser, [string[]]$adbArgs, [string[]]$extra = @('--own-package', $pkg)) {
    Reset-Calls
    Remove-Item $log -ErrorAction SilentlyContinue
    & node $GuardPath --serial $ser --log $log @extra -- @adbArgs 2>$null | Out-Null
    [string]$LASTEXITCODE
}
# An allowed form exits 0 and sends exactly one call: -s <serial> shell <the agent's string, unchanged>.
function Test-Allowed([string]$ser, [string]$cmd) {
    $rc = Invoke-Guard $ser @('shell', $cmd)
    $got = Get-Calls
    $sent = if ($got.Count -ge 1) { Get-CallArgs $got[0] } else { '' }
    Test-Result ($ser + ' allowed [' + $cmd + ']') ($rc -eq '0' -and $got.Count -eq 1 -and $sent -eq (@('-s', $ser, 'shell', $cmd) -join [char]0)) ('-> ' + $rc + ' calls=' + $got.Count)
}
# A refused form exits with the wanted code, sends nothing and logs the refusal.
function Test-Refused([string]$label, [string]$ser, [string[]]$adbArgs, [string]$want = '97', [string[]]$extra = @('--own-package', $pkg)) {
    $rc = Invoke-Guard $ser $adbArgs $extra
    Test-Result ($ser + ' refused ' + $label) ($rc -eq $want -and (Get-Calls).Count -eq 0 -and (Get-LogText).Contains('REFUSED/ERROR exit=' + $want)) ('-> ' + $rc + ' (want ' + $want + ') calls=' + (Get-Calls).Count)
}
# Each string, one adb argument, on both playground serials.
function Test-RefusedStrings([string[]]$cmds) {
    foreach ($s in $pg) { foreach ($c in $cmds) { Test-Refused ('[' + $c + ']') $s @('shell', $c) } }
}
function Test-AllowedStrings([string[]]$cmds) {
    foreach ($s in $pg) { foreach ($c in $cmds) { Test-Allowed $s $c } }
}
function Join-Dumpsys([string]$prefix, [string[]]$words) {
    $head = if ($prefix -eq '') { 'dumpsys ' } else { 'dumpsys ' + $prefix + ' ' }
    $words | ForEach-Object { ($head + $_).Trim() }
}

# DG1: the eight network and location services, upper case, with arguments, padded.
$eight = @('wifi', 'wifiscanner', 'connectivity', 'netstats', 'location', 'wifip2p', 'network_management', 'telephony.registry')
Test-RefusedStrings (@($eight | ForEach-Object { 'dumpsys ' + $_ }) + @($eight | ForEach-Object { 'dumpsys ' + $_.ToUpper() }) + @('dumpsys wifi -a', 'dumpsys connectivity --short', '  dumpsys   wifi  ', 'dumpsys location -a', 'dumpsys telephony.registry'))
# DG2: bare dumpsys.
Test-RefusedStrings @('dumpsys', ' dumpsys ')
# DG3: option-first forms.
Test-RefusedStrings (Join-Dumpsys '' @('-a', '--all', '-l', '-t 5 wifi', '-T 5000 connectivity', '--skip activity', '--priority NORMAL', '--priority HIGH', '--pid', '--thread', '--proto wifi', '--help', '--', '- wifi', '-- wifi', '-t 5 battery', '--skip wifi'))
# DG4: activity routes other than the two exact sub-arguments.
Test-RefusedStrings (Join-Dumpsys 'activity' @('broadcasts', '-a', 'service location', 'service NetworkStack', 'services', 'service', 'provider', 'intents', 'a', 'p', 'b', '', 'activities -a', ('processes ' + $pkg), ('-p ' + $pkg + ' activities'), 'Activities', 'PROCESSES', 'lastanr', 'starter'))
# DG5: other services, near names, MC-2287 sibling shapes, case variants of listed names.
Test-RefusedStrings (Join-Dumpsys '' @('deviceidle', 'bluetooth_manager', 'wificond', 'network_stack', 'netpolicy', 'wifiaware', 'wifirtt', 'dnsresolver', 'netd', 'netd_listener', 'connmetrics', 'settings', 'usagestats', 'alarm', 'batterystats', 'cpuinfo', 'procstats', 'activity_task', 'package_native', 'wifi:', '.wifi', 'wifix',
    'notification', 'notification --noredact extra', 'thermalservice x', 'diskstats -a', 'input_method x',
    'Battery', 'BATTERY', 'surfaceflinger', 'SURFACEFLINGER', 'Window', 'MEMINFO 1', 'ACTIVITY activities', ('Package ' + $pkg), 'WebViewUpdate', 'Power', ('GFXINFO ' + $pkg)))
# DG6: tool and lane B forms and the four MC-2287 forms, plain and padded: allowed and sent byte-identical.
Test-AllowedStrings @('dumpsys activity processes', 'dumpsys activity activities', 'dumpsys meminfo 4242', ('dumpsys meminfo ' + $pkg), 'dumpsys meminfo -s 4242', ('dumpsys meminfo --package ' + $pkg),
    'dumpsys power', ('dumpsys package ' + $pkg), 'dumpsys webviewupdate', 'dumpsys battery', ('dumpsys gfxinfo ' + $pkg + ' reset'), ('dumpsys gfxinfo ' + $pkg), ('dumpsys gfxinfo ' + $pkg + ' framestats'),
    'dumpsys window', 'dumpsys window windows', 'dumpsys SurfaceFlinger', 'dumpsys SurfaceFlinger --latency', 'dumpsys meminfo', 'dumpsys package', '  dumpsys   battery  ',
    'dumpsys window displays', 'dumpsys package com.samsung.android.honeyboard',
    'dumpsys thermalservice', 'dumpsys diskstats', 'dumpsys input_method', 'dumpsys notification --noredact', '  dumpsys   notification    --noredact ', ' dumpsys thermalservice ')
# DG7: the split spelling (separate adb arguments) stays refused for every service.
foreach ($s in $pg) {
    foreach ($w in $eight) { Test-Refused ('split dumpsys ' + $w) $s @('shell', 'dumpsys', $w) }
    Test-Refused 'split dumpsys battery' $s @('shell', 'dumpsys', 'battery')
    Test-Refused 'split dumpsys activity processes' $s @('shell', 'dumpsys', 'activity', 'processes')
    Test-Refused 'split dumpsys meminfo --package' $s @('shell', 'dumpsys', 'meminfo', '--package', $pkg)
    Test-Refused 'split dumpsys thermalservice' $s @('shell', 'dumpsys', 'thermalservice')
    Test-Refused 'split dumpsys notification --noredact' $s @('shell', 'dumpsys', 'notification', '--noredact')
}
# DG8: quoting, globbing, escaping, piping, control characters, other shell routes, state-changing words, length.
Test-RefusedStrings @(('dumpsys' + $tab + 'wifi'), ('dumpsys wifi' + $tab), 'dumpsys {wifi,x}', 'dumpsys wif[i]', 'dumpsys w%69fi', 'dumpsys ./wifi', '/system/bin/dumpsys wifi', 'cmd -w wifi', 'dumpsys --skip=activity',
    'dumpsys ''wifi''', 'dumpsys wif?', 'dumpsys wi*', 'dumpsys w\ifi', 'dumpsys wifi;id', 'dumpsys wifi | grep SSID', 'cmd wifi status', 'cmd connectivity', 'cmd wifi list-networks',
    'dumpsys battery; dumpsys wifi', ('dumpsys battery' + $lf + 'dumpsys wifi'), 'dumpsys activity broadcasts | grep x', 'dumpsys activity $(echo broadcasts)',
    'dumpsys battery set level 5', 'dumpsys battery reset', 'dumpsys battery unplug', 'dumpsys gfxinfo io.example.app reset', ('dumpsys SurfaceFlinger ' + $pkg + ' reset'), ('dumpsys gfxinfo ' + $pkg + ' RESET'),
    'dumpsys power a b c d e f g h')
# DG9: the emulator keeps refusing every dumpsys (97) and restricted or near-miss serials 95, whatever the form.
$sixForms = @('dumpsys battery', 'dumpsys wifi', 'dumpsys', 'dumpsys activity processes', 'dumpsys thermalservice', 'dumpsys notification --noredact')
foreach ($c in $sixForms) { Test-Refused ('[' + $c + ']') $emu @('shell', $c) }
foreach ($s in @('R58M12345AB', '2ac80128013f7ecf', '29F3CDE9193F7ECE')) { foreach ($c in $sixForms) { Test-Refused ('[' + $c + ']') $s @('shell', $c) '95' } }
# DG10: the gfxinfo reset pin needs --own-package to be the app id.
foreach ($s in $pg) {
    Test-Refused 'gfxinfo reset with another --own-package' $s @('shell', ('dumpsys gfxinfo ' + $pkg + ' reset')) '97' @('--own-package', 'io.example.app')
    Test-Refused 'gfxinfo reset without --own-package' $s @('shell', ('dumpsys gfxinfo ' + $pkg + ' reset')) '97' @()
}
# DG11: case and extra-argument shapes of the four MC-2287 forms.
Test-RefusedStrings (Join-Dumpsys '' @('THERMALSERVICE', 'Thermalservice', 'DISKSTATS', 'Input_method', 'Notification --noredact', 'NOTIFICATION --noredact', 'notification --NOREDACT', 'notification --noredact --proto', 'notification --noredact --noredact'))
# DG12: SurfaceFlinger state-changing arguments.
Test-RefusedStrings (Join-Dumpsys 'SurfaceFlinger' @('--latency-clear', '--enable-layer-stats', '--disable-layer-stats', '--clear-layer-stats', '--timestats -enable', '--timestats -disable', '--timestats -clear'))

Remove-Item Env:ADBG_FAKE_ADB_SCRIPT; Remove-Item Env:FAKE_CALLS
Remove-Item -LiteralPath $testDir -Recurse -Force -ErrorAction SilentlyContinue
'failures=' + $script:failures
exit $script:failures
