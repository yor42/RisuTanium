# Fake-adb cases for adbg r19 Stage B: picker-visible gates on every restricted serial. On a restricted serial the guard runs one fixed,
# guard-internal device probe (documentsui pids and our own app's pid with their oom_score_adj). A screencap needs our app in front and no
# picker visible before and after the capture; every `input` and every plain `tap` needs no picker visible. An unreadable probe refuses (90).
# Usage: pwsh -File picker-gate.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake.mjs'
$calls = Join-Path $testDir 'calls.txt'
$probes = Join-Path $testDir 'probes.txt'
$flag = Join-Path $testDir 'flip.flag'
# The fake adb records every call as one JSON array and answers the guard's fixed probe the way the device shell's echo does: one
# `ADBG-PICKER <pid> <adj>` line per pid of com.android.documentsui, then of com.google.android.documentsui, one `ADBG-OWN <pid> <adj>` line per
# pid of the own package, then `ADBG-PROBE-END`; an empty adj keeps its trailing blank. FAKE_PIDS maps a package to its ordered pid list and
# FAKE_ADJ maps a pid to its adj text. After a served screencap with FAKE_FLIP_AFTER_SCREENCAP=1 the later probes read FAKE_ADJ_AFTER. Each probe
# also records whether the screencap output file exists yet (FAKE_OUT). FAKE_PROBE_MODE changes the answer: noend, badline, exit1 (a valid
# answer, then exit status 1), crlf, pid8own, pid8picker, afterend (a picker line after the end marker). FAKE_PROBE_MODE_AFTER replaces the
# mode for the probes that follow a served screencap (the post-check).
$fakeSource = @'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
const a = process.argv.slice(2)
appendFileSync(process.env.FAKE_CALLS, JSON.stringify(a) + "\n")
const j = a.slice(2)
const pids = JSON.parse(process.env.FAKE_PIDS ?? "{}")
const flipped = existsSync(process.env.FAKE_FLAG)
const adj = JSON.parse((flipped ? process.env.FAKE_ADJ_AFTER : process.env.FAKE_ADJ) ?? "{}")
const mode = (flipped && process.env.FAKE_PROBE_MODE_AFTER) ? process.env.FAKE_PROBE_MODE_AFTER : (process.env.FAKE_PROBE_MODE ?? "")
if (j[0] === "exec-out") {
  if (process.env.FAKE_FLIP_AFTER_SCREENCAP === "1") writeFileSync(process.env.FAKE_FLAG, "1")
  process.stdout.write(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))
  process.exit(0)
}
if (j[0] === "shell" && String(j[1]).includes("ADBG-PROBE-END")) {
  const n = existsSync(process.env.FAKE_PROBES) ? readFileSync(process.env.FAKE_PROBES, "utf8").split("\n").filter(Boolean).length : 0
  appendFileSync(process.env.FAKE_PROBES, JSON.stringify({ probe: n + 1, outExists: !!process.env.FAKE_OUT && existsSync(process.env.FAKE_OUT) }) + "\n")
  let lines = []
  if (mode === "pid8own") lines = ["ADBG-OWN 12345670"]
  else if (mode === "pid8picker") lines = ["ADBG-PICKER 12345678"]
  else {
    for (const pkg of ["com.android.documentsui", "com.google.android.documentsui"]) for (const p of pids[pkg] ?? []) lines.push("ADBG-PICKER " + p + " " + (adj[p] ?? ""))
    for (const p of pids["io.github.yor42.risutanium"] ?? []) lines.push("ADBG-OWN " + p + " " + (adj[p] ?? ""))
  }
  if (mode === "badline") lines.push("ADBG-JUNK")
  if (mode !== "noend") lines.push("ADBG-PROBE-END")
  if (mode === "afterend") lines.push("ADBG-PICKER 2001 0")
  const eol = mode === "crlf" ? "\r\n" : "\n"
  process.stdout.write(lines.join(eol) + eol)
  process.exit(mode === "exit1" ? 1 : 0)
}
process.exit(0)
'@
Set-Content $fake $fakeSource
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_CALLS = $calls
$env:FAKE_PROBES = $probes
$env:FAKE_FLAG = $flag
# Every guard spawn goes through the stand-in adb; never run a case where it is not in place.
if (-not $env:ADBG_FAKE_ADB_SCRIPT -or -not (Test-Path -LiteralPath $env:ADBG_FAKE_ADB_SCRIPT)) { throw 'ADBG_FAKE_ADB_SCRIPT is not set to an existing fake: refusing to run' }
$log = Join-Path $testDir 'log.txt'
$st = Join-Path $testDir 'state.json'
$out = Join-Path $testDir 'out.png'
$script:failures = 0
$ownPkg = 'io.github.yor42.risutanium'
$probeText = 'for p in $(pidof com.android.documentsui) $(pidof com.google.android.documentsui); do echo "ADBG-PICKER $p $(cat /proc/$p/oom_score_adj 2>/dev/null)"; done; for p in $(pidof io.github.yor42.risutanium); do echo "ADBG-OWN $p $(cat /proc/$p/oom_score_adj 2>/dev/null)"; done; echo ADBG-PROBE-END'
$restrictedSerial = 'R5CT1234ABC'
$tabSerial = 'R54WA00L3WH'
$aliasSerials = @('adb-R54WA00L3WH-ab12cd._adb-tls-connect._tcp', '192.168.0.5:37011', 'model:SM_X916B', 'usb:1-1')
$phone1 = '29f3cde9193f7ece'
$scopeDate = '2026-11-18'

function Assert-PickerRow([string]$label, [bool]$pass, [string]$detail = '') {
    if (-not $pass) { $script:failures++ }
    ($(if ($pass) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' ' + $detail
}
function Reset-GuardRun {
    foreach ($f in @($calls, $probes, $flag, $log, $st)) { Remove-Item $f -ErrorAction SilentlyContinue }
    foreach ($f in @(Get-ChildItem $testDir -Filter '*.png')) { Remove-Item $f.FullName }
    $env:FAKE_OUT = ''
}
function Get-CallLines { if (Test-Path $calls) { , @(Get-Content $calls) } else { , @() } }
function Get-CallCount([string]$pattern) { @(Get-CallLines | ForEach-Object { $_ } | Where-Object { $_ -match $pattern }).Count }
function Get-ProbeRecords { if (Test-Path $probes) { , @(Get-Content $probes | ForEach-Object { ConvertFrom-Json $_ }) } else { , @() } }
function Get-CallKinds {
    $kinds = @()
    foreach ($l in @(Get-CallLines | ForEach-Object { $_ })) {
        if ($l -match 'ADBG-PROBE-END') { $kinds += 'probe' }
        elseif ($l -match 'screencap') { $kinds += 'shot' }
        elseif ($l -match '"input","tap"') { $kinds += 'tap' }
        elseif ($l -match 'input text') { $kinds += 'text' }
        elseif ($l -match 'input keyevent') { $kinds += 'key' }
        else { $kinds += 'other' }
    }
    $kinds -join ','
}
function Get-LogText { if (Test-Path $log) { Get-Content $log -Raw } else { '' } }
function Get-StateObject { if (Test-Path $st) { Get-Content $st -Raw | ConvertFrom-Json } else { $null } }
function Test-LastShotNull { $s = Get-StateObject; [bool]($s -and $null -eq $s.lastShot) }
function Test-InputSent { (Get-CallCount '"input[ "]') -gt 0 }
# adj and pid maps: the pids of each package, and the adj text of each pid (an empty text is a pid whose adj the device could not read).
function Set-FakeDevice([int[]]$dui = @(2001), [int[]]$google = @(), [int[]]$own = @(3001), [hashtable]$adj = @{ '2001' = '900'; '3001' = '0' }, [hashtable]$adjAfter = @{}, [string]$mode = '', [bool]$flip = $false, [string]$modeAfter = '') {
    $pids = @{ 'com.android.documentsui' = @($dui); 'com.google.android.documentsui' = @($google); 'io.github.yor42.risutanium' = @($own) }
    $env:FAKE_PIDS = ConvertTo-Json -Compress -Depth 5 -InputObject $pids
    $env:FAKE_ADJ = ConvertTo-Json -Compress -Depth 5 -InputObject $adj
    $env:FAKE_ADJ_AFTER = ConvertTo-Json -Compress -Depth 5 -InputObject $adjAfter
    $env:FAKE_PROBE_MODE = $mode
    $env:FAKE_PROBE_MODE_AFTER = $modeAfter
    $env:FAKE_FLIP_AFTER_SCREENCAP = $(if ($flip) { '1' } else { '0' })
}
function New-ScopeFile([string]$scopeSerial, [string[]]$classes) {
    $path = Join-Path $testDir ('scope-' + [guid]::NewGuid().ToString('N') + '.json')
    $o = [ordered]@{ serial = $scopeSerial; approvedBy = 'maintainer'; date = $scopeDate; allow = @($classes) }
    ConvertTo-Json -Compress -InputObject $o | Set-Content $path
    $path
}
function Set-LocateRecord([string]$recordSerial) {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $o = @{ picks = @(); pickErrors = 0; offset = $null; pickLocked = $false; locates = @(@{ id = 1; time = $now; label = 'css:#field'; bounds = @{ l = 10; t = 10; r = 110; b = 60 }; used = $false; serial = $recordSerial }) }
    ConvertTo-Json $o -Depth 5 | Set-Content $st
}
function Get-CommonArgs([string]$ser, [string]$pkgId = $ownPkg) { @('--serial', $ser, '--log', $log, '--own-ports', '9465,9466', '--own-package', $pkgId) }
function Invoke-GuardRun([string[]]$guardArgs) { & node $GuardPath @guardArgs 2>$null | Out-Null; $LASTEXITCODE }
function Invoke-Screencap([string]$ser, [string]$outFile = $out, [string]$pkgId = $ownPkg) {
    $env:FAKE_OUT = $outFile
    Invoke-GuardRun ((Get-CommonArgs $ser $pkgId) + @('--state', $st, '--out', $outFile, '--', 'exec-out', 'screencap', '-p'))
}
function Invoke-Keyevent([string]$ser, [string]$scopePath, [string]$key) {
    Invoke-GuardRun ((Get-CommonArgs $ser) + @('--scope-file', $scopePath, '--', 'shell', ('input keyevent ' + $key)))
}
function Invoke-PlainTap([string]$ser, [string]$scopePath) {
    Invoke-GuardRun (@('tap') + (Get-CommonArgs $ser) + @('--scope-file', $scopePath, '--state', $st))
}

# ---- screencap: probe text, thresholds, post-check, write order ----
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '300'; '3001' = '0' }
$code = Invoke-Screencap $restrictedSerial
Assert-PickerRow 'PG-2 R screencap, picker adj 300, own front: 0, PNG, two probes' ($code -eq 0 -and (Test-Path $out) -and (Get-CallCount 'ADBG-PROBE-END') -eq 2) "-> $code"
$firstProbe = @(Get-CallLines | ForEach-Object { $_ } | Where-Object { $_ -match 'ADBG-PROBE-END' })[0]
$probeArgv = if ($firstProbe) { @(ConvertFrom-Json $firstProbe) } else { @() }
Assert-PickerRow 'PG-1 probe argv is exactly the constant text, on the guarded serial, with no agent token' ($probeArgv.Count -eq 4 -and $probeArgv[0] -ceq '-s' -and $probeArgv[1] -ceq $restrictedSerial -and $probeArgv[2] -ceq 'shell' -and $probeArgv[3] -ceq $probeText)
$records = @(Get-ProbeRecords | ForEach-Object { $_ })
Assert-PickerRow 'PG-6 PNG is written only after the post-probe (outExists false at both probes)' ($records.Count -eq 2 -and -not ($records | Where-Object { $_.outExists })) "records=$($records.Count)"
$logText = Get-LogText
$probeLines = @($logText -split "\r?\n" | Where-Object { $_ -match 'picker-probe' })
$lineShape = '^\S+ (intent: picker-probe serial=\S+ \(guard-internal, fixed command\)|exit=\d+: picker-probe picker=(none|visible|unknown) adj=[0-9,-]* own=(front|not-front|unknown))$'
$badLines = @($probeLines | Where-Object { $_ -notmatch $lineShape })
Assert-PickerRow 'PG-16 probe log lines carry only the fixed text, a verdict and adj numbers' ($probeLines.Count -eq 4 -and $badLines.Count -eq 0) "lines=$($probeLines.Count) bad=$($badLines.Count)"
Assert-PickerRow 'PG-16 the verdict lines of an idle picker read picker=none own=front' ($logText -match 'picker-probe picker=none adj=300 own=front')

Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '0'; '3001' = '0' }
$code = Invoke-Screencap $restrictedSerial
Assert-PickerRow 'PG-3 R screencap, picker adj 0 at the pre-check: 93, no capture call, no PNG, lastShot null' ($code -eq 93 -and (Get-CallCount 'screencap') -eq 0 -and -not (Test-Path $out) -and (Test-LastShotNull)) "-> $code"
Assert-PickerRow 'PG-16 a refusing verdict line reads picker=visible' ((Get-LogText) -match 'picker-probe picker=visible adj=0 own=front')

foreach ($adjText in @('100', '150', '250', '299', '')) {
    Reset-GuardRun
    Set-FakeDevice -adj @{ '2001' = $adjText; '3001' = '0' }
    $code = Invoke-Screencap $restrictedSerial
    Assert-PickerRow ('PG-4 R screencap, picker adj "' + $adjText + '" at the pre-check: 93, no capture call, no PNG') ($code -eq 93 -and (Get-CallCount 'screencap') -eq 0 -and -not (Test-Path $out)) "-> $code"
}
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '300'; '3001' = '0' }
$code = Invoke-Screencap $restrictedSerial
Assert-PickerRow 'PG-4 R screencap, picker adj 300: 0 and PNG' ($code -eq 0 -and (Test-Path $out)) "-> $code"

Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' } -adjAfter @{ '2001' = '150'; '3001' = '0' } -flip $true
$code = Invoke-Screencap $restrictedSerial
$records = @(Get-ProbeRecords | ForEach-Object { $_ })
Assert-PickerRow 'PG-5 picker appears during the capture (adj 900 then 150): 93, no PNG, lastShot null, the capture ran' ($code -eq 93 -and -not (Test-Path $out) -and (Test-LastShotNull) -and (Get-CallCount 'screencap') -eq 1) "-> $code"
Assert-PickerRow 'PG-6 both probes of the refused capture saw no output file' ($records.Count -eq 2 -and -not ($records | Where-Object { $_.outExists }))

foreach ($mode in @('noend', 'badline', 'exit1', 'afterend')) {
    Reset-GuardRun
    Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' } -mode $mode
    $code = Invoke-Screencap $restrictedSerial
    Assert-PickerRow "PG-7 probe unknown ($mode) at the pre-check: 90, no capture call, no PNG" ($code -eq 90 -and (Get-CallCount 'screencap') -eq 0 -and -not (Test-Path $out)) "-> $code"
}

Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' } -adjAfter @{ '2001' = '900'; '3001' = '0' } -flip $true -modeAfter 'noend'
$code = Invoke-Screencap $restrictedSerial
Assert-PickerRow 'PG-7 probe unknown at the post-check: 90, no PNG, lastShot null, the capture ran' ($code -eq 90 -and -not (Test-Path $out) -and (Test-LastShotNull) -and (Get-CallCount 'screencap') -eq 1) "-> $code"

# ---- every restricted serial, aliases included ----
foreach ($ser in (@($tabSerial) + $aliasSerials)) {
    Reset-GuardRun
    Set-FakeDevice -adj @{ '2001' = '100'; '3001' = '0' }
    $code = Invoke-Screencap $ser
    Assert-PickerRow "PG-8 $ser screencap, picker adj 100: 93, no PNG" ($code -eq 93 -and -not (Test-Path $out)) "-> $code"
    Reset-GuardRun
    Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' }
    $code = Invoke-Screencap $ser
    Assert-PickerRow "PG-8 $ser screencap, no picker, own front: 0, PNG, two probes" ($code -eq 0 -and (Test-Path $out) -and (Get-CallCount 'ADBG-PROBE-END') -eq 2) "-> $code"
}

# ---- own app in front, own-package pin ----
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '100' }
$code = Invoke-Screencap $restrictedSerial
Assert-PickerRow 'PG-9 own app at adj 100 (launcher in front): 93, no capture call, no PNG' ($code -eq 93 -and (Get-CallCount 'screencap') -eq 0 -and -not (Test-Path $out)) "-> $code"
Reset-GuardRun
Set-FakeDevice -own @() -adj @{ '2001' = '900' }
$code = Invoke-Screencap $restrictedSerial
Assert-PickerRow 'PG-9 no own pid: 93, no capture call, no PNG' ($code -eq 93 -and (Get-CallCount 'screencap') -eq 0 -and -not (Test-Path $out)) "-> $code"
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' }
$code = Invoke-Screencap $restrictedSerial $out 'io.example.app'
Assert-PickerRow 'PG-9 --own-package io.example.app: 95, no adb call, no PNG' ($code -eq 95 -and (Get-CallLines).Count -eq 0 -and -not (Test-Path $out)) "-> $code"
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' } -adjAfter @{ '2001' = '900'; '3001' = '100' } -flip $true
$code = Invoke-Screencap $restrictedSerial
Assert-PickerRow 'PG-9 own app leaves the front during the capture: 93, no PNG, lastShot null' ($code -eq 93 -and -not (Test-Path $out) -and (Test-LastShotNull)) "-> $code"

# ---- input: keyevent ----
$scopeKey = New-ScopeFile $restrictedSerial @('keyevent')
foreach ($key in @('KEYCODE_BACK', '111', 'KEYCODE_HOME', 'KEYCODE_DPAD_DOWN')) {
    Reset-GuardRun
    Set-FakeDevice -adj @{ '2001' = '150'; '3001' = '0' }
    $code = Invoke-Keyevent $restrictedSerial $scopeKey $key
    Assert-PickerRow "PG-10 R keyevent $key with a picker visible (adj 150): 93, no input call" ($code -eq 93 -and -not (Test-InputSent)) "-> $code"
    Reset-GuardRun
    Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' }
    $code = Invoke-Keyevent $restrictedSerial $scopeKey $key
    Assert-PickerRow "PG-10 R keyevent $key with no picker (adj 900): 0, sent" ($code -eq 0 -and (Get-CallCount 'input keyevent') -eq 1) "-> $code"
    Reset-GuardRun
    Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' } -mode 'noend'
    $code = Invoke-Keyevent $restrictedSerial $scopeKey $key
    Assert-PickerRow "PG-10 R keyevent $key with an unreadable probe: 90, no input call" ($code -eq 90 -and -not (Test-InputSent)) "-> $code"
}
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '100' }
$code = Invoke-Keyevent $restrictedSerial $scopeKey 'KEYCODE_BACK'
Assert-PickerRow 'PG-10 R keyevent needs no own app in front, only no picker: 0, sent' ($code -eq 0 -and (Get-CallCount 'input keyevent') -eq 1) "-> $code"
# The restricted allowlist trims the shell text, so a leading-blank navigation key reaches the gate and must be gated like the bare form.
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '150'; '3001' = '0' }
$code = Invoke-GuardRun ((Get-CommonArgs $restrictedSerial) + @('--scope-file', $scopeKey, '--', 'shell', ' input keyevent KEYCODE_BACK'))
Assert-PickerRow 'PG-10 R leading-blank keyevent with a picker visible (adj 150): 93, no input call' ($code -eq 93 -and -not (Test-InputSent)) "-> $code"
# The probe text is the constant; the agent's --own-package value never enters it (a keyevent path has no own-package pin).
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' }
$code = Invoke-GuardRun ((Get-CommonArgs $restrictedSerial 'io.example.app') + @('--scope-file', $scopeKey, '--', 'shell', 'input keyevent KEYCODE_BACK'))
$ownProbe = @(Get-CallLines | ForEach-Object { $_ } | Where-Object { $_ -match 'ADBG-PROBE-END' })[0]
$ownProbeArgv = if ($ownProbe) { @(ConvertFrom-Json $ownProbe) } else { @() }
Assert-PickerRow 'PG-1 probe text stays the constant when the agent passes another --own-package' ($code -eq 0 -and $ownProbeArgv.Count -eq 4 -and $ownProbeArgv[3] -ceq $probeText -and -not ($ownProbe -match 'io\.example\.app')) "-> $code"

# ---- the Tab's classes (keyevent, am-start, install) ----
$scopeTab = New-ScopeFile $tabSerial @('keyevent', 'am-start', 'install')
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '0'; '3001' = '100' }
$code = Invoke-Keyevent $tabSerial $scopeTab 'KEYCODE_BACK'
Assert-PickerRow 'PG-11 Tab keyevent BACK with a picker in front: 93, no input call' ($code -eq 93 -and -not (Test-InputSent)) "-> $code"
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '0'; '3001' = '100' }
$code = Invoke-GuardRun ((Get-CommonArgs $tabSerial) + @('--scope-file', $scopeTab, '--', 'shell', ('am start -n ' + $ownPkg + '/.MainActivity')))
Assert-PickerRow 'PG-11 Tab am start of the own component with a picker in front: 0, not gated, no probe call' ($code -eq 0 -and (Get-CallCount 'am start') -eq 1 -and (Get-CallCount 'ADBG-PROBE-END') -eq 0) "-> $code"
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' }
$code = Invoke-Keyevent $aliasSerials[0] $scopeTab 'KEYCODE_BACK'
Assert-PickerRow 'PG-11 alias with the Tab-only scope file: keyevent 95 (the scope names the Tab only)' ($code -eq 95 -and -not (Test-InputSent)) "-> $code"
foreach ($ser in $aliasSerials) {
    $scopeAlias = New-ScopeFile $ser @('keyevent')
    Reset-GuardRun
    Set-FakeDevice -adj @{ '2001' = '150'; '3001' = '0' }
    $code = Invoke-Keyevent $ser $scopeAlias 'KEYCODE_BACK'
    Assert-PickerRow "PG-11 $ser with its own keyevent scope and a picker visible: 93, no input call" ($code -eq 93 -and -not (Test-InputSent)) "-> $code"
}

# ---- typing chain stays intact: the probe never sits between the granting tap and the typing call ----
$scopeChain = New-ScopeFile $restrictedSerial @('tap', 'input-text', 'keyevent')
function Invoke-ChainTap { Set-LocateRecord $restrictedSerial; Invoke-GuardRun (@('tap') + (Get-CommonArgs $restrictedSerial) + @('--scope-file', $scopeChain, '--state', $st)) }
function Invoke-ChainText { Invoke-GuardRun ((Get-CommonArgs $restrictedSerial) + @('--scope-file', $scopeChain, '--state', $st, '--', 'shell', 'input text hi')) }
function Invoke-ChainEnter { Invoke-GuardRun ((Get-CommonArgs $restrictedSerial) + @('--scope-file', $scopeChain, '--state', $st, '--', 'shell', 'input keyevent KEYCODE_ENTER')) }
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' }
$c1 = Invoke-ChainTap
$c2 = Invoke-ChainText
$c3 = Invoke-ChainEnter
Assert-PickerRow 'PG-12 typing chain on R: tap, input text, KEYCODE_ENTER all pass' ($c1 -eq 0 -and $c2 -eq 0 -and $c3 -eq 0) "-> $c1 $c2 $c3"
Assert-PickerRow 'PG-12 each of the three calls probes once, ahead of its own input' ((Get-CallKinds) -ceq 'probe,tap,probe,text,probe,key') "kinds=$(Get-CallKinds)"

Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' }
$c1 = Invoke-ChainTap
Set-FakeDevice -adj @{ '2001' = '150'; '3001' = '0' }
$c2 = Invoke-ChainText
Assert-PickerRow 'PG-13 the picker appears after the tap: input text 93, no text call' ($c1 -eq 0 -and $c2 -eq 93 -and (Get-CallCount 'input text') -eq 0) "-> $c1 $c2"
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' }
$c1 = Invoke-ChainTap
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' } -mode 'noend'
$c2 = Invoke-ChainText
Assert-PickerRow 'PG-13 the probe is unreadable before the text: 90, no text call' ($c1 -eq 0 -and $c2 -eq 90 -and (Get-CallCount 'input text') -eq 0) "-> $c1 $c2"

# ---- plain tap ----
$scopeTap = New-ScopeFile $restrictedSerial @('tap')
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '150'; '3001' = '0' }
Set-LocateRecord $restrictedSerial
$code = Invoke-PlainTap $restrictedSerial $scopeTap
$s = Get-StateObject
Assert-PickerRow 'PG-14 plain tap with a picker visible (adj 150): 93, locate unconsumed, no input tap' ($code -eq 93 -and $s.locates[0].used -eq $false -and -not (Test-InputSent)) "-> $code"
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' }
Set-LocateRecord $restrictedSerial
$code = Invoke-PlainTap $restrictedSerial $scopeTap
$s = Get-StateObject
Assert-PickerRow 'PG-14 plain tap with no picker (adj 900): 0, tapped, locate consumed' ($code -eq 0 -and (Get-CallCount '"input","tap"') -eq 1 -and $s.locates[0].used -eq $true) "-> $code"
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' } -mode 'noend'
Set-LocateRecord $restrictedSerial
$code = Invoke-PlainTap $restrictedSerial $scopeTap
$s = Get-StateObject
Assert-PickerRow 'PG-14 plain tap with an unreadable probe: 90, locate unconsumed, no input tap' ($code -eq 90 -and $s.locates[0].used -eq $false -and -not (Test-InputSent)) "-> $code"

# ---- the failed-locate input lock still answers first ----
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' }
$null = Invoke-GuardRun (@('locate-shot', '--serial', $restrictedSerial, '--log', $log, '--state', $st, '--png', (Join-Path $testDir 'nope.png'), '--label', 'ctl', '--box', '1,1,50,50'))
$code = Invoke-Keyevent $restrictedSerial $scopeKey 'KEYCODE_BACK'
Assert-PickerRow 'PG-15 input lock first: keyevent after a failed locate is 92 with no probe call' ($code -eq 92 -and (Get-CallCount 'ADBG-PROBE-END') -eq 0 -and -not (Test-InputSent)) "-> $code"

# ---- full-access and playground serials: no probe on any path ----
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '0'; '3001' = '0' }
$codes = @()
$codes += Invoke-GuardRun (@('--serial', $phone1, '--log', $log, '--own-package', $ownPkg, '--state', $st, '--out', $out, '--', 'exec-out', 'screencap', '-p'))
$codes += Invoke-GuardRun (@('--serial', $phone1, '--log', $log, '--own-package', $ownPkg, '--', 'shell', 'input keyevent KEYCODE_BACK'))
Set-LocateRecord $phone1
$codes += Invoke-GuardRun (@('tap', '--serial', $phone1, '--log', $log, '--own-package', $ownPkg, '--state', $st))
$codes += Invoke-GuardRun (@('--serial', 'emulator-5580', '--log', $log, '--own-package', $ownPkg, '--state', $st, '--out', (Join-Path $testDir 'emu.png'), '--', 'exec-out', 'screencap', '-p'))
$codes += Invoke-GuardRun (@('--serial', 'emulator-5580', '--log', $log, '--own-package', $ownPkg, '--', 'shell', 'input keyevent KEYCODE_BACK'))
Assert-PickerRow 'PG-17 full-access and playground serials with a picker at adj 0: screencap, keyevent, tap all 0, no probe call' (($codes -join ',') -ceq '0,0,0,0,0' -and (Get-CallCount 'ADBG-PROBE-END') -eq 0) "-> $($codes -join ',')"

# ---- lastShot after a refused capture ----
$shotA = Join-Path $testDir 'a.png'
function Invoke-LocateShot([string]$png) { Invoke-GuardRun (@('locate-shot', '--serial', $restrictedSerial, '--log', $log, '--state', $st, '--png', $png, '--label', 'ctl', '--box', '1,1,50,50')) }
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' }
$null = Invoke-Screencap $restrictedSerial $shotA
$code = Invoke-LocateShot $shotA
Assert-PickerRow 'PG-18 control: after a good capture, locate-shot on it passes' ($code -eq 0) "-> $code"
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' }
$null = Invoke-Screencap $restrictedSerial $shotA
Set-FakeDevice -adj @{ '2001' = '0'; '3001' = '0' }
$shotB = Join-Path $testDir 'b.png'
$c1 = Invoke-Screencap $restrictedSerial $shotB
$c2 = Invoke-LocateShot $shotA
Assert-PickerRow 'PG-18 (i) a refused capture (93) leaves no usable previous capture: locate-shot on the earlier PNG is 99' ($c1 -eq 93 -and $c2 -eq 99 -and -not (Test-Path $shotB)) "-> $c1 $c2"
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' }
$null = Invoke-Screencap $restrictedSerial $shotA
$shotB2 = Join-Path $testDir 'b2.png'
$c1 = Invoke-Screencap $restrictedSerial $shotB2 'io.example.app'
$c2 = Invoke-LocateShot $shotA
Assert-PickerRow 'PG-18 (ii) a refused capture (95) leaves no usable previous capture: locate-shot on the earlier PNG is 99' ($c1 -eq 95 -and $c2 -eq 99) "-> $c1 $c2"

# ---- probe grammar ----
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '900'; '3001' = '0' } -mode 'crlf'
$code = Invoke-Screencap $restrictedSerial
Assert-PickerRow 'PG-19 (a) CRLF probe output parses: 0 and PNG' ($code -eq 0 -and (Test-Path $out)) "-> $code"
Reset-GuardRun
Set-FakeDevice -mode 'pid8own'
$code = Invoke-Screencap $restrictedSerial
Assert-PickerRow 'PG-19 (b) an 8-digit own pid is not a pid: 90, no capture' ($code -eq 90 -and (Get-CallCount 'screencap') -eq 0) "-> $code"
Reset-GuardRun
Set-FakeDevice -mode 'pid8picker'
$code = Invoke-Screencap $restrictedSerial
Assert-PickerRow 'PG-19 (c) an 8-digit picker pid is not a pid: 90, no capture' ($code -eq 90 -and (Get-CallCount 'screencap') -eq 0) "-> $code"

# ---- package and pid pins: every picker pid counts, whichever package or position ----
Reset-GuardRun
Set-FakeDevice -dui @(2001) -google @(2002) -adj @{ '2001' = '900'; '2002' = '100'; '3001' = '0' }
$code = Invoke-Screencap $restrictedSerial
Assert-PickerRow 'PG-20 (a) the google package visible beside a cached AOSP pid: 93, no capture' ($code -eq 93 -and (Get-CallCount 'screencap') -eq 0) "-> $code"
Reset-GuardRun
Set-FakeDevice -dui @(2001, 2003) -adj @{ '2001' = '900'; '2003' = '150'; '3001' = '0' }
$code = Invoke-Screencap $restrictedSerial
Assert-PickerRow 'PG-20 (b) two pids, the first cached and the second visible: 93, no capture' ($code -eq 93 -and (Get-CallCount 'screencap') -eq 0) "-> $code"
Reset-GuardRun
Set-FakeDevice -adj @{ '2001' = '0'; '3001' = '0' }
$code = Invoke-Screencap $restrictedSerial
Assert-PickerRow 'PG-20 (c) own app and picker both at adj 0: 93, no capture' ($code -eq 93 -and (Get-CallCount 'screencap') -eq 0) "-> $code"

Remove-Item Env:ADBG_FAKE_ADB_SCRIPT, Env:FAKE_CALLS, Env:FAKE_PROBES, Env:FAKE_FLAG, Env:FAKE_OUT, Env:FAKE_PIDS, Env:FAKE_ADJ, Env:FAKE_ADJ_AFTER, Env:FAKE_PROBE_MODE, Env:FAKE_PROBE_MODE_AFTER, Env:FAKE_FLIP_AFTER_SCREENCAP
'failures=' + $script:failures
exit $script:failures
