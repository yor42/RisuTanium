# Fake-adb cases for the adbg kit forms (r21): forward --list, forward --no-rebind and reverse --no-rebind on the two Note 9 serials.
# Usage: pwsh -File kit-forms.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
# Quoted rows rely on one argument per array element reaching node unchanged.
$PSNativeCommandArgumentPassing = 'Standard'
# Scratch files (fake adb, call record, log) go to a fresh temp folder, never next to the tracked test.
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake-forms.mjs'
$calls = Join-Path $testDir 'calls.txt'
# Records every call it receives, so "sent" and the exact arguments are observable, and exits 0.
Set-Content $fake 'import { appendFileSync } from ''node:fs''; appendFileSync(process.env.FAKE_CALLS, JSON.stringify(process.argv.slice(2)) + ''\n''); process.exit(0)'
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_CALLS = $calls
# The reserved-port rule reads these two variables; a value inherited from the caller would change the rows below.
Remove-Item Env:ANDROID_ADB_SERVER_PORT -ErrorAction SilentlyContinue
Remove-Item Env:ADB_SERVER_SOCKET -ErrorAction SilentlyContinue
$log = Join-Path $testDir 'log.txt'
$script:failures = 0
$emu = 'emulator-5580'
$note9 = @('29f3cde9193f7ece', '2ac80128013f7ece')
$fwdRemote = 'localabstract:webview_devtools_remote_4242'

# Runs one guard call with a fresh log and checks the exit code, how many calls reached the fake (0 or 1), for a pass the exact
# arguments the fake received and the PLAYGROUND log line, and for a refusal the text on stderr.
function Invoke-FormCase([string]$label, [string]$serial, [string]$want, [string[]]$adbArgs, [string]$ports = '6330,6250', [string]$zone = '') {
    if (Test-Path $calls) { Remove-Item $calls }
    if (Test-Path $log) { Remove-Item $log }
    $g = @('--serial', $serial, '--log', $log, '--own-ports', $ports, '--') + $adbArgs
    $out = (& node $GuardPath @g 2>&1 | Out-String)
    $rc = [string]$LASTEXITCODE
    $recorded = @(if (Test-Path $calls) { Get-Content $calls })
    $logText = if (Test-Path $log) { Get-Content $log -Raw } else { '' }
    $wantSent = if ($want -eq '0') { 1 } else { 0 }
    $ok = ($rc -eq $want) -and ($recorded.Count -eq $wantSent) -and ($zone -eq '' -or $out.Contains($zone))
    if ($want -eq '0') {
        $expected = ConvertTo-Json -Compress -InputObject @(@('-s', $serial) + $adbArgs)
        $ok = $ok -and ($recorded[0] -eq $expected) -and $logText.Contains('PLAYGROUND serial=' + $serial)
    } else {
        $ok = $ok -and -not $logText.Contains('PLAYGROUND')
    }
    if (-not $ok) { $script:failures++ }
    ($(if ($ok) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' [' + $serial + '] ' + ($adbArgs -join ' ') + ' -> ' + $rc + ' sent=' + $recorded.Count + ' (want ' + $want + $(if ($zone -ne '') { ' ' + $zone } else { '' }) + ')'
}

# KF-1: both Note 9s accept the three forms with own ports; the fake receives them verbatim.
foreach ($serial in $note9) {
    Invoke-FormCase 'KF-1 forward --list' $serial '0' @('forward', '--list')
    Invoke-FormCase 'KF-1 forward --no-rebind' $serial '0' @('forward', '--no-rebind', 'tcp:6330', $fwdRemote)
    Invoke-FormCase 'KF-1 forward --no-rebind, one digit' $serial '0' @('forward', '--no-rebind', 'tcp:6330', 'localabstract:webview_devtools_remote_1')
    Invoke-FormCase 'KF-1 forward --no-rebind, seven digits' $serial '0' @('forward', '--no-rebind', 'tcp:6330', 'localabstract:webview_devtools_remote_1234567')
    Invoke-FormCase 'KF-1 reverse --no-rebind' $serial '0' @('reverse', '--no-rebind', 'tcp:6250', 'tcp:6250')
    Invoke-FormCase 'KF-1 reverse --no-rebind, two own ports' $serial '0' @('reverse', '--no-rebind', 'tcp:6330', 'tcp:6250')
}

# KF-2: near misses of the three forms are 97 and nothing is sent.
$nearMiss = @(
    @('forward', '--list', 'x'), @('forward', '--list', '--no-rebind'), @('forward', '--no-rebind', '--list'), @('forward', '--lists'),
    @('forward', '--no-rebind'), @('forward', '--no-rebind', 'tcp:6330'),
    @('forward', '--no-rebind', 'tcp:6330', 'localabstract:webview_devtools_remote_abc'),
    @('forward', '--no-rebind', 'tcp:6330', 'localabstract:webview_devtools_remote_12345678'),
    @('forward', '--no-rebind', 'tcp:6330', 'localabstract:webview_devtools_remote_'),
    @('forward', '--no-rebind', 'tcp:6330', 'localabstract:other_4242'),
    @('forward', '--no-rebind', 'tcp:6330', 'tcp:7000'),
    @('forward', '--no-rebind', 'tcp:7000', $fwdRemote),
    @('forward', '--no-rebind', 'tcp:06330', $fwdRemote),
    @('forward', '--no-rebind', 'tcp:6330', $fwdRemote, 'x'),
    @('forward', '--no-rebind', $fwdRemote, 'tcp:6330'),
    @('forward', 'tcp:6330', $fwdRemote, '--no-rebind'),
    @('forward', '--no-rebind', '--remove', 'tcp:6330'),
    @('forward', '--NO-REBIND', 'tcp:6330', $fwdRemote),
    @('forward', '--no-rebind', 'tcp:6330', 'localabstract:webview_devtools_remote_-1'),
    @('forward', '--no-rebind', 'tcp:6330', 'localabstract:Webview_devtools_remote_4242'),
    @('forward', '--no-rebind', 'tcp:6330', 'localfilesystem:/data/x'),
    @('forward', '--no-rebind', 'tcp:6330', 'jdwp:123'),
    @('forward', '--no-rebind', 'tcp:6330', 'dev:/dev/null'),
    @('forward', '--no-rebind', 'tcp:abc', $fwdRemote),
    @('forward', '--no-rebind', 'tcp:', $fwdRemote),
    @('forward', '--no-rebind', 'tcp:6330', 'localabstract:webview_devtools_remote_4242;x'),
    @('forward', '--no-rebind', 'tcp:6330', 'localabstract:webview_devtools_remote_42 42'),
    @('forward', '--no-rebind', 'tcp:6250', 'tcp:6330'),
    @('forward', '--no-rebind', '--no-rebind', 'tcp:6330', $fwdRemote),
    @('reverse', '--list', 'x'), @('reverse', '--no-rebind'), @('reverse', '--no-rebind', 'tcp:6250'),
    @('reverse', '--no-rebind', 'tcp:6250', 'localabstract:x'),
    @('reverse', '--no-rebind', 'tcp:6250', 'tcp:7000'),
    @('reverse', '--no-rebind', 'tcp:7000', 'tcp:6250'),
    @('reverse', '--no-rebind', 'tcp:6250', 'tcp:6250', 'x'),
    @('reverse', '--no-rebind', '--list'),
    @('reverse', '--no-rebind', '--remove', 'tcp:6250'),
    @('reverse', 'tcp:6250', 'tcp:6250', '--no-rebind'),
    @('reverse', '--no-rebind', 'tcp:06250', 'tcp:06250'),
    @('reverse', '--no-rebind', 'tcp:6250', 'tcp:'),
    @('reverse', '--no-rebind', 'tcp:6250', 'tcp:abc'),
    @('reverse', '--no-rebind', 'localabstract:x', 'tcp:6250'),
    @('reverse', '--NO-REBIND', 'tcp:6250', 'tcp:6250'),
    @('reverse', '--no-rebind', 'tcp:7000', 'tcp:7001'),
    @('reverse', '--remove-all'))
foreach ($serial in $note9) {
    foreach ($a in $nearMiss) { Invoke-FormCase 'KF-2 near miss' $serial '97' $a '6330,6250' 'not accepted on the Note 9 profile' }
}

# KF-3: a reverse whose host end is the host adb server or an emulator port is 89 DZ-10, before the own-port check, even when the run lists it.
foreach ($serial in $note9) {
    Invoke-FormCase 'KF-3 host adb server port' $serial '89' @('reverse', '--no-rebind', 'tcp:5037', 'tcp:5037') '5037,5555,5554,6250' 'DZ-10'
    Invoke-FormCase 'KF-3 emulator console port' $serial '89' @('reverse', '--no-rebind', 'tcp:5555', 'tcp:5555') '5037,5555,5554,6250' 'DZ-10'
    Invoke-FormCase 'KF-3 emulator port 5554' $serial '89' @('reverse', '--no-rebind', 'tcp:5554', 'tcp:5554') '5037,5555,5554,6250' 'DZ-10'
    Invoke-FormCase 'KF-3 own device end, reserved host end' $serial '89' @('reverse', '--no-rebind', 'tcp:6250', 'tcp:5037') '5037,5555,5554,6250' 'DZ-10'
    Invoke-FormCase 'KF-3 reserved host end, not own port' $serial '89' @('reverse', '--no-rebind', 'tcp:6250', 'tcp:5037') '6250' 'DZ-10'
    Invoke-FormCase 'KF-3 the same call with a free host port passes' $serial '0' @('reverse', '--no-rebind', 'tcp:6250', 'tcp:6250') '5037,5555,5554,6250'
    $env:ANDROID_ADB_SERVER_PORT = '6250'
    Invoke-FormCase 'KF-3 ANDROID_ADB_SERVER_PORT as host end' $serial '89' @('reverse', '--no-rebind', 'tcp:6250', 'tcp:6250') '6250' 'DZ-10'
    Remove-Item Env:ANDROID_ADB_SERVER_PORT
    $env:ADB_SERVER_SOCKET = 'tcp:127.0.0.1:6251'
    Invoke-FormCase 'KF-3 ADB_SERVER_SOCKET as host end' $serial '89' @('reverse', '--no-rebind', 'tcp:6251', 'tcp:6251') '6251' 'DZ-10'
    Remove-Item Env:ADB_SERVER_SOCKET
    Invoke-FormCase 'KF-3 without the variables the same call passes' $serial '0' @('reverse', '--no-rebind', 'tcp:6250', 'tcp:6250') '6250'
}

# KF-4: emulator-5580 does not get the forms.
foreach ($a in @(@('forward', '--list'), @('forward', '--no-rebind', 'tcp:6330', $fwdRemote), @('reverse', '--no-rebind', 'tcp:6250', 'tcp:6250'))) {
    Invoke-FormCase 'KF-4 emulator' $emu '97' $a
}

# KF-5: restricted and near-miss serials do not get the forms (95).
foreach ($serial in @('R5CWTABTEST1', '2ac80128013f7ecf', '2AC80128013F7ECE', '29f3cde9193f7ece1')) {
    foreach ($a in @(@('forward', '--list'), @('forward', '--no-rebind', 'tcp:6330', $fwdRemote), @('reverse', '--no-rebind', 'tcp:6250', 'tcp:6250'))) {
        Invoke-FormCase 'KF-5 restricted' $serial '95' $a
    }
}

# KF-6: the forms that already passed on the Note 9s still pass.
foreach ($serial in $note9) {
    foreach ($a in @(@('forward', 'tcp:6330', $fwdRemote), @('forward', '--remove', 'tcp:6330'), @('reverse', '--list'), @('reverse', 'tcp:6250', 'tcp:6250'), @('reverse', '--remove', 'tcp:6250'))) {
        Invoke-FormCase 'KF-6 existing form' $serial '0' $a
    }
}

Remove-Item Env:ADBG_FAKE_ADB_SCRIPT; Remove-Item Env:FAKE_CALLS
'failures=' + $script:failures
exit $script:failures
