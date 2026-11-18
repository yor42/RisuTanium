# Fake-adb cases for the adbg r15 net-status verb (MC-2274) on the two playground Note 9s.
# Usage: pwsh -File net-status.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake.mjs'
$calls = Join-Path $testDir 'calls.txt'
$errFile = Join-Path $testDir 'stderr.txt'
$connFile = Join-Path $testDir 'conn.txt'
# The fake adb records every call as one JSON array. `settings get global wifi_on` prints FAKE_WIFI_ON and exits
# FAKE_WIFI_EXIT; `dumpsys connectivity` prints the file FAKE_CONN_FILE, writes an SSID line to stderr and exits FAKE_CONN_EXIT.
Set-Content $fake 'import { appendFileSync, readFileSync } from "node:fs"; const a = process.argv.slice(2); appendFileSync(process.env.FAKE_CALLS, JSON.stringify(a) + "\n"); const j = a.slice(2).join(" "); if (j === "shell settings get global wifi_on") { process.stdout.write(process.env.FAKE_WIFI_ON ?? ""); process.exit(+(process.env.FAKE_WIFI_EXIT ?? 0)) } if (j === "shell dumpsys connectivity") { process.stdout.write(readFileSync(process.env.FAKE_CONN_FILE, "utf8")); process.stderr.write("SSID SECRET-SSID-7Q\n"); process.exit(+(process.env.FAKE_CONN_EXIT ?? 0)) } process.exit(0)'
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_CALLS = $calls
$env:FAKE_CONN_FILE = $connFile
# Every guard spawn goes through the stand-in adb; never run a case where it is not in place.
if (-not $env:ADBG_FAKE_ADB_SCRIPT -or -not (Test-Path -LiteralPath $env:ADBG_FAKE_ADB_SCRIPT)) { throw 'ADBG_FAKE_ADB_SCRIPT is not set to an existing fake: refusing to run' }
$log = Join-Path $testDir 'log.txt'
$script:failures = 0
$pg = @('29f3cde9193f7ece', '2ac80128013f7ece')
$emu = 'emulator-5580'
$nl = [string][char]10
$markers = @('SECRET-SSID-7Q', 'aa:bb:cc:dd:ee:ff', '192.168.77.7', '192.168.77.1', '02:11:22:33:44:55', 'fe80::1234:56ff:fe78:9abc')
function Test-Result([string]$label, [bool]$ok, [string]$detail) {
    if (-not $ok) { $script:failures++ }
    ($(if ($ok) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' ' + $detail
}
# The leading comma keeps a single call an array, so indexing and Count behave the same for one call as for several.
function Get-Calls { if (Test-Path $calls) { , @(Get-Content $calls) } else { , @() } }
function Reset-Calls { if (Test-Path $calls) { Remove-Item $calls } }
function Get-LogText { if (Test-Path $log) { Get-Content $log -Raw } else { '' } }
function Set-FakeEnv([string]$name, $value) { if ($null -eq $value) { Remove-Item -LiteralPath ('Env:' + $name) -ErrorAction SilentlyContinue } else { Set-Item -LiteralPath ('Env:' + $name) -Value ([string]$value) } }
# One NetworkAgentInfo line as Android 10's NetworkAgentInfo.toString prints it: one line per network under Current Networks:.
function New-Entry([string]$type, [string]$state, [string]$transports, [string]$caps, [string]$validated) {
    ('  NetworkAgentInfo{ ni{[type: ' + $type + '[], state: ' + $state + ', reason: (unspecified), extra: "SECRET-SSID-7Q", failover: false, available: true, roaming: false, metered: false]}  network{100}  nethandle{123456789}  ' +
    'lp{{InterfaceName: wlan0 LinkAddresses: [ fe80::1234:56ff:fe78:9abc/64,192.168.77.7/24,] Routes: [ 192.168.77.0/24 -> 0.0.0.0 wlan0,0.0.0.0/0 -> 192.168.77.1 wlan0,] DnsAddresses: [ 192.168.77.1,] Domains: null MTU: 0 TcpBufferSizes: }}  ' +
    'nc{[ Transports: ' + $transports + ' Capabilities: ' + $caps + ' LinkUpBandwidth>=12000Kbps LinkDnBandwidth>=12000Kbps SignalStrength: -50 SSID: "SECRET-SSID-7Q" BSSID: aa:bb:cc:dd:ee:ff MAC: 02:11:22:33:44:55]}  ' +
    'Score{60}  ' + $validated + '  created{false} lingering{false} explicitlySelected{false} acceptUnvalidated{false} everCaptivePortalDetected{false} lastCaptivePortalDetected{false}}')
}
$capsOk = 'NOT_METERED&INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VPN&VALIDATED&NOT_ROAMING&FOREGROUND&NOT_CONGESTED&NOT_SUSPENDED'
$capsNoVal = 'NOT_METERED&INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VPN&NOT_ROAMING&FOREGROUND&NOT_CONGESTED&NOT_SUSPENDED'
function New-Dump([string[]]$entries, [bool]$header = $true) {
    $lines = @('Active default network: 100', '')
    if ($header) { $lines += 'Current Networks:' }
    $lines += $entries
    $lines += @('', 'Network Requests:', '  NetworkRequest [ REQUEST id=1, [ Capabilities: INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VPN] ]', '')
    ($lines -join $nl) + $nl
}
$f1Entry = New-Entry 'WIFI' 'CONNECTED/CONNECTED' 'WIFI' $capsOk 'everValidated{true}  lastValidated{true}'
$f2Entry = New-Entry 'WIFI' 'CONNECTED/CONNECTED' 'WIFI' $capsNoVal 'everValidated{true}  lastValidated{false}'
$f3Entry = New-Entry 'MOBILE' 'CONNECTED/CONNECTED' 'CELLULAR' $capsOk 'everValidated{true}  lastValidated{true}'
$f4Entry = New-Entry 'WIFI' 'CONNECTING/CONNECTING' 'WIFI' $capsNoVal 'everValidated{false}  lastValidated{false}'
$fixtures = @{
    F1 = New-Dump @($f1Entry)
    F2 = New-Dump @($f2Entry)
    F3 = New-Dump @($f3Entry)
    F4 = New-Dump @($f4Entry)
    F5 = New-Dump @($f1Entry) $false
    F6 = New-Dump @()
    F7 = New-Dump @($f3Entry, $f2Entry)
    F8a = New-Dump @($f1Entry.Replace(' Transports: WIFI', ' Transport: WIFI'))
    F8b = New-Dump @($f1Entry.Replace('state: CONNECTED/CONNECTED', 'state: CONNECTED'))
    F8c = New-Dump @($f1Entry.Replace(' state: ', ' State: '))
    F8d = New-Dump @($f1Entry, '  NetworkAgentInfo [WIFI () - 101]')
    F8e = New-Dump @($f1Entry, $f1Entry.Replace(' Transports: WIFI', ' Transport: WIFI'))
}
# One net-status call. Returns the exit code; stdout, stderr, the calls and the log are read back by the caller.
function Invoke-Net([string]$ser, [string]$fixture, $wifiOn, $wifiExit = $null, $connExit = $null) {
    Reset-Calls
    Remove-Item $log, $errFile -ErrorAction SilentlyContinue
    [IO.File]::WriteAllText($connFile, $fixtures[$fixture])
    Set-FakeEnv 'FAKE_WIFI_ON' $wifiOn
    Set-FakeEnv 'FAKE_WIFI_EXIT' $wifiExit
    Set-FakeEnv 'FAKE_CONN_EXIT' $connExit
    $script:lastOut = (& node $GuardPath net-status --serial $ser --log $log 2>$errFile) -join $nl
    [string]$LASTEXITCODE
}
# The line, the exit code, exactly the two constant reads in order, the log line, and none of the six identifiers anywhere.
function Test-Net([string]$label, [string]$ser, [string]$fixture, $wifiOn, [string]$wantLine, [string]$wantExit, $wifiExit = $null, $connExit = $null) {
    $rc = Invoke-Net $ser $fixture $wifiOn $wifiExit $connExit
    $got = Get-Calls
    $wantCalls = @(('["-s","' + $ser + '","shell","settings get global wifi_on"]'), ('["-s","' + $ser + '","shell","dumpsys connectivity"]')) -join '|'
    $errText = if (Test-Path $errFile) { Get-Content $errFile -Raw } else { '' }
    $all = $script:lastOut + $nl + $errText + $nl + (Get-LogText)
    $leak = @($markers | Where-Object { $all.Contains($_) })
    $okLine = $script:lastOut -eq $wantLine
    $okLog = (Get-LogText).Contains('net-status ' + $wantLine)
    Test-Result $label ($rc -eq $wantExit -and $okLine -and (($got -join '|') -eq $wantCalls) -and $okLog -and $leak.Count -eq 0) ('-> ' + $rc + ' out=[' + $script:lastOut + '] calls=' + $got.Count + ' leak=' + $leak.Count)
}
function Test-NetRefused([string]$label, [string]$ser, [string[]]$tail, [string]$want) {
    Reset-Calls
    Remove-Item $log -ErrorAction SilentlyContinue
    $null = & node $GuardPath net-status --serial $ser --log $log @tail 2>$null
    Test-Result $label ([string]$LASTEXITCODE -eq $want -and (Get-Calls).Count -eq 0) ('-> ' + $LASTEXITCODE + ' (want ' + $want + ') calls=' + (Get-Calls).Count)
}

foreach ($s in $pg) { Test-Net ($s + ' NS1 validated Wi-Fi') $s 'F1' '1' 'wifi_enabled=on associated=yes validated=yes' '0' }
Test-Net '2ac80128013f7ece NS2 joined, not validated' '2ac80128013f7ece' 'F2' '1' 'wifi_enabled=on associated=yes validated=no' '0'
Test-Net '29f3cde9193f7ece NS3 cellular only' '29f3cde9193f7ece' 'F3' '1' 'wifi_enabled=on associated=no validated=no' '0'
Test-Net '29f3cde9193f7ece NS3 cellular validated, Wi-Fi joined but not' '29f3cde9193f7ece' 'F7' '1' 'wifi_enabled=on associated=yes validated=no' '0'
Test-Net '29f3cde9193f7ece NS4 connecting' '29f3cde9193f7ece' 'F4' '1' 'wifi_enabled=on associated=no validated=no' '0'
Test-Net '29f3cde9193f7ece NS4 no networks, Wi-Fi off' '29f3cde9193f7ece' 'F6' '0' 'wifi_enabled=off associated=no validated=no' '0'
Test-Net '29f3cde9193f7ece NS5 wifi_on 2' '29f3cde9193f7ece' 'F6' '2' 'wifi_enabled=on associated=no validated=no' '0'
Test-Net '29f3cde9193f7ece NS5 wifi_on 3' '29f3cde9193f7ece' 'F6' '3' 'wifi_enabled=off associated=no validated=no' '0'
Test-Net '29f3cde9193f7ece NS5 wifi_on null' '29f3cde9193f7ece' 'F6' 'null' 'wifi_enabled=unknown associated=no validated=no' '4'
Test-Net '29f3cde9193f7ece NS5 wifi_on constructor' '29f3cde9193f7ece' 'F6' 'constructor' 'wifi_enabled=unknown associated=no validated=no' '4'
Test-Net '29f3cde9193f7ece NS5 wifi_on __proto__' '29f3cde9193f7ece' 'F6' '__proto__' 'wifi_enabled=unknown associated=no validated=no' '4'
Test-Net '29f3cde9193f7ece NS5 wifi_on toString' '29f3cde9193f7ece' 'F6' 'toString' 'wifi_enabled=unknown associated=no validated=no' '4'
Test-Net '29f3cde9193f7ece NS5 wifi_on hasOwnProperty' '29f3cde9193f7ece' 'F6' 'hasOwnProperty' 'wifi_enabled=unknown associated=no validated=no' '4'
Test-Net '29f3cde9193f7ece NS5 wifi_on valueOf' '29f3cde9193f7ece' 'F6' 'valueOf' 'wifi_enabled=unknown associated=no validated=no' '4'
Test-Net '29f3cde9193f7ece NS6 no Current Networks header' '29f3cde9193f7ece' 'F5' '1' 'wifi_enabled=on associated=unknown validated=unknown' '4'
Test-Net '29f3cde9193f7ece NS6 dumpsys read fails' '29f3cde9193f7ece' 'F1' '1' 'wifi_enabled=on associated=unknown validated=unknown' '4' $null '1'
Test-Net '29f3cde9193f7ece NS6 settings read fails' '29f3cde9193f7ece' 'F1' '1' 'wifi_enabled=unknown associated=yes validated=yes' '4' '1' $null

# NS7-NS9: refusals make no adb call.
Test-NetRefused 'NS7 emulator' $emu @() '97'
foreach ($s in @('R58M12345AB', 'R5CT1234ABC', '2ac80128013f7ecf', '2AC80128013F7ECE', '29f3cde9193f7ece1')) { Test-NetRefused ('NS8 ' + $s) $s @() '95' }
Test-NetRefused 'NS9 -- shell reboot' $pg[0] @('--', 'shell', 'reboot') '2'
Test-NetRefused 'NS9 bare --' $pg[0] @('--') '2'
Test-NetRefused 'NS9 -- shell with one string' $pg[0] @('--', 'shell', 'dumpsys wifi') '2'

# NS10: an entry the guard cannot parse gives unknown and exit 4, never no.
foreach ($v in @('F8a', 'F8b', 'F8c', 'F8d', 'F8e')) {
    Test-Net ('29f3cde9193f7ece NS10 ' + $v) '29f3cde9193f7ece' $v '1' 'wifi_enabled=on associated=unknown validated=unknown' '4'
}

foreach ($n in @('ADBG_FAKE_ADB_SCRIPT', 'FAKE_CALLS', 'FAKE_CONN_FILE', 'FAKE_WIFI_ON', 'FAKE_WIFI_EXIT', 'FAKE_CONN_EXIT')) { Remove-Item -LiteralPath ('Env:' + $n) -ErrorAction SilentlyContinue }
Remove-Item -LiteralPath $testDir -Recurse -Force -ErrorAction SilentlyContinue
'failures=' + $script:failures
exit $script:failures
