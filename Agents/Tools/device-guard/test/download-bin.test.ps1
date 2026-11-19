# Fake-adb cases for the adbg r14 forms (MC-2256): Chrome-saved .bin exports on the two playground Note 9s, whose names carry spaces.
# Usage: pwsh -File download-bin.test.ps1 -GuardPath <adbg.mjs>
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
$script:localSeq = 0
$pg = @('29f3cde9193f7ece', '2ac80128013f7ece')
$emu = 'emulator-5580'
$lf = [string][char]10
$cr = [string][char]13
$tab = [string][char]9
$nbsp = [string][char]0xA0
$dl = '/sdcard/Download/'
$P1 = '/sdcard/Download/local-20261117 - 2026-11-17T214332.323.bin'
$P2 = '/sdcard/Download/local-partial-20261117 - 2026-11-17T085123.456.bin'
$P3 = '/sdcard/Download/local-20261117.bin'
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
        elseif ($code -eq 8) { $null = $sb.Append('\b') }
        elseif ($code -eq 12) { $null = $sb.Append('\f') }
        elseif ($code -lt 32) { $null = $sb.Append('\u' + $code.ToString('x4')) }
        else { $null = $sb.Append($ch) }
    }
    $sb.ToString()
}
# The refusal line holds the path twice encoded: once inside the JSON array of the adb arguments, once as the log message.
function Get-ArrivalMarker([string]$path) { Get-JsEscaped ('"' + (Get-JsEscaped $path) + '"') }
function New-Local { $script:localSeq++; Join-Path $testDir ('got-' + $script:localSeq + '.bin') }
function Invoke-Guard([string]$ser, [string[]]$adbArgs) {
    Reset-Calls
    & node $GuardPath --serial $ser --log $log -- @adbArgs 2>$null | Out-Null
    [string]$LASTEXITCODE
}
# An allowed call exits 0 and sends exactly the wanted arguments after -s <serial>.
function Test-Sent([string]$label, [string]$ser, [string[]]$adbArgs, [string[]]$wantSent, [string]$wantLog = '') {
    Remove-Item $log -ErrorAction SilentlyContinue
    $rc = Invoke-Guard $ser $adbArgs
    $got = Get-Calls
    $want = (@('-s', $ser) + $wantSent) -join [char]0
    $logOk = ($wantLog -eq '') -or (Get-LogText).Contains($wantLog)
    $sent = if ($got.Count -ge 1) { Get-CallArgs $got[0] } else { '' }
    Test-Result $label ($rc -eq '0' -and $got.Count -eq 1 -and $sent -eq $want -and $logOk) ('-> ' + $rc + ' calls=' + $got.Count + ' sent=' + ($sent -replace [char]0, ' | '))
}
# A refused call exits with the wanted code and sends nothing to adb. With a path, the refusal line must hold it intact.
function Test-Refused([string]$label, [string]$ser, [string[]]$adbArgs, [string]$want, [string]$path = '') {
    Remove-Item $log -ErrorAction SilentlyContinue
    $rc = Invoke-Guard $ser $adbArgs
    $arrived = $true
    if ($path -ne '') { $arrived = (Get-LogText).Contains((Get-ArrivalMarker $path)) -and (Get-LogText).Contains('REFUSED/ERROR exit=' + $want) }
    Test-Result $label ($rc -eq $want -and (Get-Calls).Count -eq 0 -and $arrived) ('-> ' + $rc + ' (want ' + $want + ') calls=' + (Get-Calls).Count + ' arrived=' + $arrived)
}

# ---- the real Chrome shape on both playground serials: composed single-quoted shell string, exact arguments ----
$p200 = $dl + 'local-' + ('a' * 200) + '.bin'
foreach ($s in $pg) {
    $pgLine = 'PLAYGROUND serial=' + $s + ' allow=extended'
    Test-Sent ($s + ' sha256sum of a spaced export') $s @('shell', 'sha256sum', $P1) @('shell', ('sha256sum ''' + $P1 + '''')) $pgLine
    Test-Sent ($s + ' rm -f of a spaced export') $s @('shell', 'rm', '-f', $P1) @('shell', ('rm -f ''' + $P1 + '''')) $pgLine
    $loc = New-Local
    Test-Sent ($s + ' pull of a spaced export') $s @('pull', $P1, $loc) @('pull', $P1, $loc) $pgLine
    Test-Sent ($s + ' sha256sum of a partial export') $s @('shell', 'sha256sum', $P2) @('shell', ('sha256sum ''' + $P2 + '''')) $pgLine
    Test-Sent ($s + ' rm -f of a space-free export') $s @('shell', 'rm', '-f', $P3) @('shell', ('rm -f ''' + $P3 + '''')) $pgLine
    # The length bound: 200 characters between local- and .bin pass; 201 are refused in the hostile list below.
    Test-Sent ($s + ' sha256sum of a name of 200 characters') $s @('shell', 'sha256sum', $p200) @('shell', ('sha256sum ''' + $p200 + '''')) $pgLine
}

# ---- the r13 forms are unchanged on the wire ----
$loc = New-Local
Test-Sent 'r13 rm -f of a space-free rtb on phone 2 is sent as given' $pg[1] @('shell', 'rm -f /sdcard/Download/c128-fail-0851.rtb') @('shell', 'rm -f /sdcard/Download/c128-fail-0851.rtb')
Test-Sent 'r13 sha256sum of a space-free path on the emulator is sent as given' $emu @('shell', ('sha256sum ' + $P3)) @('shell', ('sha256sum ' + $P3))
foreach ($s in @($pg[0], $pg[1], $emu)) {
    $loc = New-Local
    Test-Sent ($s + ' r13 pull of a space-free path is sent as given') $s @('pull', $P3, $loc) @('pull', $P3, $loc)
}

# ---- serial gate: the emulator refuses the new forms (97), restricted and near-miss serials refuse them (95) ----
$emuForms = @(
    @('shell', 'sha256sum', $P1), @('shell', 'rm', '-f', $P1), @('pull', $P1, (New-Local)),
    @('shell', 'sha256sum', $P2), @('shell', 'rm', '-f', $P3), @('shell', 'sha256sum', $P3))
foreach ($f in $emuForms) { Test-Refused ('emulator-5580 refuses ' + ($f -join ' | ')) $emu $f '97' }
foreach ($s in @('R58M12345AB', 'R5CT1234ABC', '2ac80128013f7ecf', '2AC80128013F7ECE', '29f3cde9193f7ece1')) {
    foreach ($f in @(@('shell', 'sha256sum', $P1), @('shell', 'rm', '-f', $P1), @('pull', $P1, (New-Local)))) { Test-Refused ($s + ' refuses ' + ($f -join ' | ')) $s $f '95' }
}

# ---- the 2-arg string forms with a spaced or quoted path stay refused on emulator-5580 ----
# On the playground serials the Note 9 profile (r3) passes them (full shell, FC-1); the rows below are retargeted to emulator-5580, which keeps
# the r11 allowlist and the r14 refusal of the split and out-of-shape forms (97, the path arrives intact in the refusal line).
foreach ($f in @(
        @('shell', ('sha256sum ' + $P1)), @('shell', ('sha256sum ''' + $P1 + '''')),
        @('shell', ('rm -f "' + $P1 + '"')), @('shell', ('ls -l "' + $P1 + '"')))) {
    Test-Refused ('2-arg string form refused: ' + $f[1]) $emu $f '97'
}

# ---- hostile and out-of-shape paths: refused in both shell forms, and in the pull form where r13 pull refuses them too ----
# PullOk marks the paths that the r13 pull rule (exactPath and an extension) already accepts; those pull forms are checked as
# unchanged r13 behaviour below, not as refusals.
$hostile = @(
    @{ P = ($dl + 'local-x.bin; rm -rf /sdcard'); PullOk = $false },
    @{ P = ($dl + 'local-x.bin''; rm -rf /sdcard; echo '''); PullOk = $false },
    @{ P = ($dl + 'local-$(id).bin'); PullOk = $false },
    @{ P = ($dl + 'local-`id`.bin'); PullOk = $false },
    @{ P = ($dl + 'local-"x".bin'); PullOk = $false },
    @{ P = ($dl + 'local-''x''.bin'); PullOk = $false },
    @{ P = ($dl + 'local-x\y.bin'); PullOk = $false },
    @{ P = ($dl + 'local-x.bin' + $lf + 'rm -rf /sdcard'); PullOk = $false },
    @{ P = ($dl + 'local-x.bin' + $lf); PullOk = $false },
    @{ P = ($dl + 'local-a' + $lf + 'b.bin'); PullOk = $false },
    @{ P = ($dl + 'local-x' + $cr + '.bin'); PullOk = $false },
    @{ P = ($dl + 'local-a' + $tab + 'b.bin'); PullOk = $false },
    @{ P = ($dl + 'local-a' + $nbsp + 'b.bin'); PullOk = $false },
    @{ P = ($dl + 'local-x/../../data/x.bin'); PullOk = $false },
    @{ P = ($dl + 'local-x..bin'); PullOk = $true },
    @{ P = ($dl + 'local-a..b.bin'); PullOk = $true },
    @{ P = '/sdcard/DCIM/local-x.bin'; PullOk = $false },
    @{ P = '/data/local/tmp/local-x.bin'; PullOk = $true },
    @{ P = '/data/local/tmp/sdcard/Download/local-x.bin'; PullOk = $false },
    @{ P = 'sdcard/Download/local-x.bin'; PullOk = $false },
    @{ P = 'sub/local-x.bin'; PullOk = $false },
    @{ P = ($dl + 'other - x.bin'); PullOk = $false },
    @{ P = ($dl + 'local-x.txt'); PullOk = $true },
    @{ P = ($dl + 'local-x.rtb'); PullOk = $true },
    @{ P = ($dl + 'local-x.BIN'); PullOk = $true },
    @{ P = '/SDCARD/Download/local-x.bin'; PullOk = $false },
    @{ P = ($dl + 'local-x.bin.sh'); PullOk = $true },
    @{ P = ($dl + 'local-x.bin '); PullOk = $false },
    @{ P = (' ' + $dl + 'local-x.bin'); PullOk = $false },
    @{ P = ($dl + 'local-.bin'); PullOk = $true },
    @{ P = ($dl + 'local-*.bin'); PullOk = $false },
    @{ P = ($dl + 'local-?.bin'); PullOk = $false },
    @{ P = ($dl + 'local-[0-9].bin'); PullOk = $false },
    @{ P = ($dl + 'local-' + ('a' * 201) + '.bin'); PullOk = $true },
    @{ P = ($P1 + ' /sdcard/Download/local-y.bin'); PullOk = $false })
foreach ($h in $hostile) {
    $p = $h.P
    $short = ($p -replace '[^\x20-\x7e]', '?')
    if ($short.Length -gt 60) { $short = $short.Substring(0, 60) + '...' }
    Test-Refused ('sha256sum refused: ' + $short) $emu @('shell', 'sha256sum', $p) '97' $p
    Test-Refused ('rm -f refused: ' + $short) $emu @('shell', 'rm', '-f', $p) '97' $p
    if (-not $h.PullOk) { Test-Refused ('pull refused: ' + $short) $emu @('pull', $p, (New-Local)) '97' $p }
}
# The pull form of the paths r13 pull already accepts is unchanged: sent as given.
foreach ($h in @($hostile | Where-Object { $_.PullOk })) {
    $short = ($h.P -replace '[^\x20-\x7e]', '?')
    if ($short.Length -gt 60) { $short = $short.Substring(0, 60) + '...' }
    foreach ($s in $pg) {
        $loc = New-Local
        Test-Sent ($s + ' r13 pull unchanged for ' + $short) $s @('pull', $h.P, $loc) @('pull', $h.P, $loc)
    }
}

# ---- arity, flags, local side ----
$existing = Join-Path $testDir 'existing.bin'
Set-Content $existing 'x'
$elsewhere = Join-Path (Join-Path ([IO.Path]::GetTempPath()) 'adbg-elsewhere') 'x.bin'
$locOk = New-Local
$shapes = @(
    @('shell', 'sha256sum', $P1, $P3), @('shell', 'sha256sum'), @('shell', 'sha256sum', '-b', $P1),
    @('shell', 'rm', '-f', $P1, $P3), @('shell', 'rm', '-rf', $P1), @('shell', 'rm', $P1), @('shell', 'rm', '-r', $P1),
    @('shell', 'rm -f', $P1), @('shell', 'sha256sum', $P1, 'extra'),
    @('pull', $P1), @('pull', $P1, $locOk, 'extra'), @('pull', $P1, $elsewhere), @('pull', $P1, $existing), @('pull', $P1, 'x.bin'),
    @('pull', $P1, (Join-Path $testDir 'a b.bin')))
foreach ($f in $shapes) { Test-Refused ('refused shape: ' + (($f -join ' | ') -replace [regex]::Escape($testDir), '<run>')) $emu $f '97' }
# The pull shapes that break the local-side rule are refused on the Note 9 profile too (shape refusal 97).
foreach ($f in @(@('pull', $P1), @('pull', $P1, $locOk, 'extra'), @('pull', $P1, $elsewhere), @('pull', $P1, $existing), @('pull', $P1, 'x.bin'), @('pull', $P1, (Join-Path $testDir 'a b.bin')))) {
    Test-Refused ('Note 9 refused pull shape: ' + (($f -join ' | ') -replace [regex]::Escape($testDir), '<run>')) $pg[0] $f '97'
}

Remove-Item Env:ADBG_FAKE_ADB_SCRIPT; Remove-Item Env:FAKE_CALLS
Remove-Item -LiteralPath $testDir -Recurse -Force -ErrorAction SilentlyContinue
'failures=' + $script:failures
exit $script:failures
