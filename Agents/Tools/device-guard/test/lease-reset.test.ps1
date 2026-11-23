# Fake-adb cases for the adbg r23 helper uninstall (#647, MC-3773, MC-3774): on the two Note 9 serials `uninstall <dev.risu.* package>` passes,
# and every other shape keeps its refusal; plus the pinned device-brief forms (the template's allowed and forbidden calls).
# Usage: pwsh -File lease-reset.test.ps1 -GuardPath <adbg.mjs>
# Row ids (T20-xx, T21-xx) name the plan rows; a mutant run reads them from the FAIL lines.
param([Parameter(Mandatory = $true)][string]$GuardPath)
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake.mjs'
$calls = Join-Path $testDir 'calls.txt'
$errFile = Join-Path $testDir 'stderr.txt'
$connFile = Join-Path $testDir 'conn.txt'
# The fake adb records every call as one JSON array, exits 0 (never a guard code), prints a PNG signature for screencap and answers the two
# net-status reads (wifi_on and the connectivity dump) from FAKE_WIFI_ON and FAKE_CONN_FILE.
Set-Content $fake 'import { appendFileSync, readFileSync } from "node:fs"; const a = process.argv.slice(2); appendFileSync(process.env.FAKE_CALLS, JSON.stringify(a) + "\n"); const j = a.slice(2).join(" "); if (j === "shell settings get global wifi_on") { process.stdout.write(process.env.FAKE_WIFI_ON ?? ""); process.exit(0) } if (j === "shell dumpsys connectivity") { process.stdout.write(readFileSync(process.env.FAKE_CONN_FILE, "utf8")); process.exit(0) } if (a.includes("screencap")) process.stdout.write(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])); process.exit(0)'
$envNames = @('ADBG_FAKE_ADB_SCRIPT', 'FAKE_CALLS', 'FAKE_WIFI_ON', 'FAKE_CONN_FILE', 'ANDROID_ADB_SERVER_PORT', 'ADB_SERVER_SOCKET', 'ADBG_PROFILE', 'ADBG_PLAYGROUND', 'ADBG_PLAYGROUND_SERIALS', 'ADBG_FULL_ACCESS_SERIALS', 'ADBG_NOTE9', 'ANDROID_SERIAL')
$savedEnv = @{}
foreach ($n in $envNames) { $savedEnv[$n] = [Environment]::GetEnvironmentVariable($n) }
foreach ($n in $envNames) { [Environment]::SetEnvironmentVariable($n, $null) }
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_CALLS = $calls
$env:FAKE_CONN_FILE = $connFile
# Every guard spawn goes through the stand-in adb; never run a case where it is not in place.
if (-not $env:ADBG_FAKE_ADB_SCRIPT -or -not (Test-Path -LiteralPath $env:ADBG_FAKE_ADB_SCRIPT)) { throw 'ADBG_FAKE_ADB_SCRIPT is not set to an existing fake: refusing to run' }
$log = Join-Path $testDir 'log.txt'
$script:failures = 0
$script:rows = 0
$script:lastOut = ''
$pg = @('29f3cde9193f7ece', '2ac80128013f7ece')
$p1 = $pg[0]
$tab = 'R54WA00L3WH'
$emu = 'emulator-5580'
$app = 'io.github.yor42.risutanium'
$own = @('--own-ports', '6271,6272')
function Test-LeaseResult([string]$label, [bool]$ok, [string]$detail) {
    $script:rows++
    if (-not $ok) { $script:failures++ }
    ($(if ($ok) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' ' + $detail
}
# The leading comma keeps a single call an array, so indexing and Count behave the same for one call as for several.
function Get-LeaseCalls { if (Test-Path $calls) { , @(Get-Content $calls) } else { , @() } }
function Reset-LeaseCalls { if (Test-Path $calls) { Remove-Item $calls } }
function Get-LeaseLog { if (Test-Path $log) { [string](Get-Content $log -Raw) } else { '' } }
function Get-LeaseCallArgs([string]$line) { ((ConvertFrom-Json -InputObject $line) -join [char]0) }
function Invoke-LeaseGuard([string]$ser, [string[]]$adbArgs, [string[]]$extra = $own) {
    Reset-LeaseCalls
    Remove-Item $log -ErrorAction SilentlyContinue
    $script:lastOut = & node $GuardPath --serial $ser --log $log @extra -- @adbArgs 2>&1 | Out-String
    [string]$LASTEXITCODE
}
# An allowed form exits 0 and sends exactly one call: -s <serial> <the agent's args>, with a PLAYGROUND line.
function Test-LeaseAllowed([string]$label, [string]$ser, [string[]]$adbArgs, [string[]]$extra = $own) {
    $rc = Invoke-LeaseGuard $ser $adbArgs $extra
    $got = Get-LeaseCalls
    $one = if ($got.Count -eq 1) { Get-LeaseCallArgs $got[0] } else { '' }
    $ok = ($rc -eq '0') -and ($got.Count -eq 1) -and ($one -eq ((@('-s', $ser) + $adbArgs) -join [char]0)) -and (Get-LeaseLog).Contains('PLAYGROUND serial=' + $ser)
    Test-LeaseResult ($label + ' ' + $ser + ' allowed [' + ($adbArgs -join ' ') + ']') $ok ('-> ' + $rc + ' calls=' + $got.Count)
}
# A refused form exits with the wanted code, sends nothing, logs the refusal, never logs an intent or PLAYGROUND line, and (89) names the serial and DZ-6.
function Test-LeaseRefused([string]$label, [string]$ser, [string[]]$adbArgs, [string]$want, [string]$logPart = '') {
    $rc = Invoke-LeaseGuard $ser $adbArgs
    $text = Get-LeaseLog
    $ok = ($rc -eq $want) -and ((Get-LeaseCalls).Count -eq 0) -and $text.Contains('REFUSED/ERROR exit=' + $want) -and (-not $text.Contains('intent:')) -and (-not $text.Contains('PLAYGROUND'))
    if ($ok -and $want -eq '89') { $ok = $text.Contains($ser) -and $text.Contains('danger zone') }
    if ($ok -and $logPart -ne '') { $ok = $text.Contains($logPart) -or $script:lastOut.Contains($logPart) }
    Test-LeaseResult ($label + ' ' + $ser + ' refused ' + $want + ' [' + ($adbArgs -join ' ') + ']') $ok ('-> ' + $rc + ' (want ' + $want + ') calls=' + (Get-LeaseCalls).Count)
}

# ---- T20: the helper uninstall rule ----
$helperOk = @('dev.risu.dv603', 'dev.risu.a_b.c2')
foreach ($s in $pg) { foreach ($h in $helperOk) { Test-LeaseAllowed 'T20-A' $s @('uninstall', $h) } }
# The test app keeps its own allowed uninstall (no regression of the existing path).
foreach ($s in $pg) { Test-LeaseAllowed 'T20-A' $s @('uninstall', $app) }

# Namespace look-alikes and the other forms stay DZ-6 on both Note 9 serials.
$hazardPackages = @('dev.risu.', 'dev.risu..x', 'dev.risu.x.', 'dev.risu', 'dev.risuai.x', 'com.dev.risu.x', 'DEV.RISU.X', 'dev.risu.X', 'dev.risu.1x', 'io.github.yor42.tbdriver')
foreach ($s in $pg) {
    foreach ($h in $hazardPackages) { Test-LeaseRefused 'T20-B' $s @('uninstall', $h) '89' 'DZ-6' }
    Test-LeaseRefused 'T20-B' $s @('uninstall', '-k', 'dev.risu.x') '89' 'DZ-6'
    foreach ($c in @('pm uninstall dev.risu.x', 'pm uninstall DEV.RISU.X', 'pm clear dev.risu.x', 'pm uninstall --user 0 dev.risu.x', 'pm uninstall -k dev.risu.x')) {
        Test-LeaseRefused 'T20-B' $s @('shell', $c) '89' 'DZ-6'
    }
    # Shape refusals: two positionals and a blank-bearing name are 97, not helpers.
    Test-LeaseRefused 'T20-C' $s @('uninstall', 'dev.risu.x', '-k') '97'
    Test-LeaseRefused 'T20-C' $s @('uninstall', 'dev.risu.x y') '97'
}
# No other serial is widened: the emulator keeps the r11 allowlist (97), near-miss and personal serials are restricted (95), no serial is exit 2.
Test-LeaseRefused 'T20-D' $emu @('uninstall', 'dev.risu.dv603') '97'
Test-LeaseRefused 'T20-D' '29f3cde9193f7ecf' @('uninstall', 'dev.risu.dv603') '95'
Test-LeaseRefused 'T20-D' $tab @('uninstall', 'dev.risu.dv603') '95'
Reset-LeaseCalls
Remove-Item $log -ErrorAction SilentlyContinue
$null = & node $GuardPath --log $log @own -- uninstall dev.risu.dv603 2>&1 | Out-String
Test-LeaseResult 'T20-D no --serial exits 2, no call' (([string]$LASTEXITCODE -eq '2') -and ((Get-LeaseCalls).Count -eq 0)) ('-> ' + $LASTEXITCODE)

# ---- T21: the forms a device brief allows and forbids (a compatibility guard; pins BRIEF-TEMPLATE) ----
$apk = Join-Path $testDir 'a.apk'
[IO.File]::WriteAllText($apk, 'dummy')
foreach ($s in $pg) {
    Test-LeaseAllowed 'T21-A' $s @('reverse', '--list')
    Test-LeaseAllowed 'T21-A' $s @('reverse', 'tcp:6271', 'tcp:6271')
    Test-LeaseAllowed 'T21-A' $s @('reverse', '--remove', 'tcp:6271')
    Test-LeaseAllowed 'T21-A' $s @('shell', 'pm list packages -3')
    Test-LeaseAllowed 'T21-A' $s @('shell', ('pm clear ' + $app))
    Test-LeaseAllowed 'T21-A' $s @('install', '-r', $apk)
    Test-LeaseAllowed 'T21-A' $s @('exec-out', 'screencap', '-p') ($own + @('--out', (Join-Path $testDir ('shot-' + $s + '.png'))))
    Test-LeaseRefused 'T21-B' $s @('shell', 'dumpsys wifi') '89' 'DZ-11'
    Test-LeaseRefused 'T21-B' $s @('shell', 'cmd wifi status') '89' 'DZ-8'
    Test-LeaseRefused 'T21-B' $s @('shell', ('pm clear ' + $app + ' && pm uninstall dev.risu.x')) '89' 'DZ-6'
    Test-LeaseRefused 'T21-B' $s @('shell', ('pm clear ' + $app + '; pm list packages -3')) '89' 'DZ-6'
}
# net-status: the two constant reads, exit 0, the Wi-Fi-off line.
$connDump = "Active default network: 100`n`nCurrent Networks:`n`nNetwork Requests:`n  NetworkRequest [ REQUEST id=1, [ Capabilities: INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VPN] ]`n"
foreach ($s in $pg) {
    [IO.File]::WriteAllText($connFile, $connDump)
    $env:FAKE_WIFI_ON = '0'
    Reset-LeaseCalls
    Remove-Item $log, $errFile -ErrorAction SilentlyContinue
    $out = ((& node $GuardPath net-status --serial $s --log $log 2>$errFile) -join "`n")
    $rc = [string]$LASTEXITCODE
    Test-LeaseResult ('T21-A ' + $s + ' net-status reads Wi-Fi off') (($rc -eq '0') -and ($out -eq 'wifi_enabled=off associated=no validated=no') -and ((Get-LeaseCalls).Count -eq 2)) ('-> ' + $rc + ' out=[' + $out + '] calls=' + (Get-LeaseCalls).Count)
}

# Clean up: env vars are restored.
foreach ($n in $envNames) { [Environment]::SetEnvironmentVariable($n, $savedEnv[$n]) }
Remove-Item -LiteralPath $testDir -Recurse -Force -ErrorAction SilentlyContinue
'rows=' + $script:rows + ' failures=' + $script:failures
exit $script:failures
