# Fake-adb cases for the adbg server-state verbs (get-state, start-server) and the push-name rule (CHORE-833, MC-2217).
# Usage: pwsh -File server-state.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake.mjs'
$calls = Join-Path $testDir 'calls.txt'
# The fake adb records every call as one JSON array and exits with FAKE_EXIT (default 0).
Set-Content $fake 'import { appendFileSync } from "node:fs"; appendFileSync(process.env.FAKE_CALLS, JSON.stringify(process.argv.slice(2)) + "\n"); process.exit(Number(process.env.FAKE_EXIT ?? 0))'
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_CALLS = $calls
$env:FAKE_EXIT = '0'
# Every guard spawn goes through the stand-in adb; never run a case where it is not in place.
if (-not $env:ADBG_FAKE_ADB_SCRIPT -or -not (Test-Path -LiteralPath $env:ADBG_FAKE_ADB_SCRIPT)) { throw 'ADBG_FAKE_ADB_SCRIPT is not set to an existing fake: refusing to run' }
$log = Join-Path $testDir 'log.txt'
$script:failures = 0
$pg = @('29f3cde9193f7ece', '2ac80128013f7ece')
$emu = 'emulator-5580'
function Test-Result([string]$label, [bool]$ok, [string]$detail) {
    if (-not $ok) { $script:failures++ }
    ($(if ($ok) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' ' + $detail
}
# The leading comma keeps a single call an array, so indexing and Count behave the same for one call as for several.
function Get-Calls { if (Test-Path $calls) { , @(Get-Content $calls) } else { , @() } }
function Reset-Calls { if (Test-Path $calls) { Remove-Item $calls } }
function Get-LogText { if (Test-Path $log) { Get-Content $log -Raw } else { '' } }
# A recorded call as the arguments the fake received, joined by NUL so the comparison does not depend on JSON escaping.
function Get-CallArgs([string]$line) { ((ConvertFrom-Json -InputObject $line) -join [char]0) }
function Invoke-Guard([string]$ser, [string[]]$adbArgs) {
    Reset-Calls
    & node $GuardPath --serial $ser --log $log -- @adbArgs 2>$null | Out-Null
    [string]$LASTEXITCODE
}
# An allowed call exits with the fake's code and sends exactly -s <serial> <args>.
function Test-Allowed([string]$label, [string]$ser, [string[]]$adbArgs, [string]$wantExit = '0') {
    $rc = Invoke-Guard $ser $adbArgs
    $got = Get-Calls
    $want = (@('-s', $ser) + $adbArgs) -join [char]0
    Test-Result $label ($rc -eq $wantExit -and $got.Count -eq 1 -and (Get-CallArgs $got[0]) -eq $want) ('-> ' + $rc + ' calls=' + $got.Count)
}
# A refused call exits with the wanted code and sends nothing to adb.
function Test-Refused([string]$label, [string]$ser, [string[]]$adbArgs, [string]$want) {
    $rc = Invoke-Guard $ser $adbArgs
    Test-Result $label ($rc -eq $want -and (Get-Calls).Count -eq 0) ('-> ' + $rc + ' (want ' + $want + ') calls=' + (Get-Calls).Count)
}

# ---- get-state and start-server: exactly the bare verbs, on full-access serials ----
foreach ($s in @($emu) + $pg) {
    Test-Allowed ($s + ' get-state') $s @('get-state')
    Test-Allowed ($s + ' start-server') $s @('start-server')
    Test-Refused ($s + ' get-state with an argument') $s @('get-state', 'x') '97'
    Test-Refused ($s + ' start-server with an argument') $s @('start-server', 'x') '97'
    Test-Refused ($s + ' kill-server') $s @('kill-server') '97'
    Test-Refused ($s + ' wait-for-device') $s @('wait-for-device') '97'
    Test-Refused ($s + ' get-serialno') $s @('get-serialno') '97'
}
# A restricted serial keeps both verbs refused.
foreach ($s in @('R5CT1234ABC', 'R58M12345AB')) {
    Test-Refused ($s + ' get-state (restricted)') $s @('get-state') '95'
    Test-Refused ($s + ' start-server (restricted)') $s @('start-server') '95'
}
# A playground serial logs the verb as an r11 call.
Remove-Item $log -ErrorAction SilentlyContinue
$null = Invoke-Guard $pg[0] @('get-state')
Test-Result 'playground get-state is logged with its PLAYGROUND line' ((Get-LogText).Contains('PLAYGROUND serial=29f3cde9193f7ece allow=r11 adb ["get-state"]')) ''
# The intent line and the exit line both name the call.
Remove-Item $log -ErrorAction SilentlyContinue
$null = Invoke-Guard $emu @('get-state')
$logText = Get-LogText
Test-Result 'get-state writes an intent line and an exit=0 line' ($logText.Contains('intent: adb -s emulator-5580 ["get-state"]') -and $logText.Contains('exit=0: adb -s emulator-5580 ["get-state"]')) ''
# The exit code of adb itself passes through.
$env:FAKE_EXIT = '1'
Test-Allowed 'get-state passes the exit code of adb through' $emu @('get-state') '1'
$env:FAKE_EXIT = '0'

# ---- push: only /sdcard/Download/<name>, and the name never starts with a dot ----
Test-Refused 'push to /sdcard/Other is refused' $emu @('push', 'C:\a.txt', '/sdcard/Other/a.txt') '97'
Test-Refused 'push to /data/local/tmp is refused' $emu @('push', 'C:\a.txt', '/data/local/tmp/a.txt') '97'
Test-Refused 'push to /sdcard/Download/.. is refused' $emu @('push', 'C:\a.txt', '/sdcard/Download/..') '97'
Test-Refused 'push to /sdcard/Download/. is refused' $emu @('push', 'C:\a.txt', '/sdcard/Download/.') '97'
Test-Refused 'push to a hidden name is refused' $emu @('push', 'C:\a.txt', '/sdcard/Download/.hidden') '97'
Test-Refused 'push to a subfolder is refused' $emu @('push', 'C:\a.txt', '/sdcard/Download/sub/a.txt') '97'
Test-Allowed 'push to /sdcard/Download/fx.bin is allowed' $emu @('push', 'C:\a.txt', '/sdcard/Download/fx.bin')
Test-Allowed 'push of a name with dots inside is allowed' $emu @('push', 'C:\a.txt', '/sdcard/Download/fx-1.2.bin')
Test-Refused 'push on a restricted serial is refused' 'R5CT1234ABC' @('push', 'C:\a.txt', '/sdcard/Download/fx.bin') '95'

Remove-Item Env:ADBG_FAKE_ADB_SCRIPT; Remove-Item Env:FAKE_CALLS; Remove-Item Env:FAKE_EXIT
Remove-Item -LiteralPath $testDir -Recurse -Force -ErrorAction SilentlyContinue
'failures=' + $script:failures
exit $script:failures
