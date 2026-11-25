# Fake-adb cases for #668: guard-only flags after `--` are refused (exit 2) with the placement named, the forward/reverse range form and a
# --own-ports range are refused naming the one-port and comma-list forms, and `apk-readback` reads the installed base.apk hash of the pinned package.
# Usage: pwsh -File arg-forms.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
$PSNativeCommandArgumentPassing = 'Standard'
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake-adb.mjs'
$calls = Join-Path $testDir 'calls.txt'
$log = Join-Path $testDir 'log.txt'
# Records every call; answers `pm path` and `sha256sum` from the environment so the read-back has something to parse.
Set-Content $fake @'
import { appendFileSync } from 'node:fs'
const a = process.argv.slice(2)
appendFileSync(process.env.FAKE_CALLS, JSON.stringify(a) + '\n')
const cmd = a[3] ?? ''
if (cmd.startsWith('pm path')) process.stdout.write(process.env.FAKE_PM_OUT ?? '')
if (cmd.startsWith('sha256sum')) process.stdout.write((process.env.FAKE_HASH ?? '') + '  ' + cmd.slice(10) + '\n')
process.exit(0)
'@
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_CALLS = $calls
$script:failures = 0
$app = 'io.github.yor42.risutanium'
$emu = 'emulator-5580'
$note9 = '2ac80128013f7ece'
$restrictedSerial = 'R5CWTABTEST1'
$hash = ('ab' * 32)
$apkLine = "package:/data/app/~~Xy12/$app-AbC==/base.apk"

function Invoke-Guard([string[]]$g) {
    foreach ($f in @($calls, $log)) { if (Test-Path $f) { Remove-Item $f } }
    $out = (& node $GuardPath @g 2>&1 | Out-String)
    $rc = [string]$LASTEXITCODE
    [pscustomobject]@{
        Rc = $rc
        Calls = @(if (Test-Path $calls) { Get-Content $calls })
        Out = $out
    }
}
function Write-Result([string]$label, [bool]$ok, [string]$detail) {
    if (-not $ok) { $script:failures++ }
    ($(if ($ok) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' ' + $detail
}

# AF-1: every guard-only flag after -- is refused with exit 2, names `before --`, and nothing is sent; on a full-access, Note 9 and restricted serial.
foreach ($serial in @($emu, $note9, $restrictedSerial)) {
    foreach ($flag in @('--out', '--state', '--log', '--own-package', '--own-ports', '--kit', '--serial', '--scope-file')) {
        $r = Invoke-Guard @('--serial', $serial, '--log', $log, '--', 'get-state', $flag, 'x')
        Write-Result 'AF-1 guard flag after --' (($r.Rc -eq '2') -and ($r.Calls.Count -eq 0) -and $r.Out.Contains("$flag is an adbg option and goes before --")) "[$serial] $flag -> $($r.Rc) sent=$($r.Calls.Count) (want 2 sent=0)"
    }
    $r = Invoke-Guard @('--serial', $serial, '--log', $log, '--', 'get-state', '--own-ports=9465')
    Write-Result 'AF-1 --flag=value after --' (($r.Rc -eq '2') -and ($r.Calls.Count -eq 0) -and $r.Out.Contains('--own-ports is an adbg option')) "[$serial] -> $($r.Rc) sent=$($r.Calls.Count)"
}
# AF-1b: the same flags before -- still work: the exec-out capture takes --out before --, and a plain call with --own-ports is judged as before.
$r = Invoke-Guard @('--serial', $emu, '--log', $log, '--own-ports', '9465,9466', '--', 'forward', 'tcp:9465', 'localabstract:webview_devtools_remote_1')
Write-Result 'AF-1b own-ports before --' (($r.Rc -eq '0') -and ($r.Calls.Count -eq 1)) "-> $($r.Rc) sent=$($r.Calls.Count) (want 0 sent=1)"

# AF-2: the range and list forms of forward/reverse --remove are refused with exit 2 naming one port per call and the comma list; the single form passes.
foreach ($verb in @('forward', 'reverse')) {
    foreach ($spec in @('tcp:9465-9467', 'tcp:9465,9466')) {
        $r = Invoke-Guard @('--serial', $emu, '--log', $log, '--own-ports', '9465,9466,9467', '--', $verb, '--remove', $spec)
        Write-Result 'AF-2 remove range' (($r.Rc -eq '2') -and ($r.Calls.Count -eq 0) -and $r.Out.Contains('one tcp:<port> per call') -and $r.Out.Contains('comma list')) "$verb --remove $spec -> $($r.Rc) sent=$($r.Calls.Count) (want 2 sent=0)"
    }
    $r = Invoke-Guard @('--serial', $emu, '--log', $log, '--own-ports', '9465,9466,9467', '--', $verb, '--remove', 'tcp:9466')
    Write-Result 'AF-2 single remove' (($r.Rc -eq '0') -and ($r.Calls.Count -eq 1)) "$verb --remove tcp:9466 -> $($r.Rc) sent=$($r.Calls.Count) (want 0 sent=1)"
}
# AF-2b: an --own-ports range is refused (exit 2) instead of silently leaving no own port.
foreach ($ports in @('9465-9467', '9465,,9466', '9465,x')) {
    $r = Invoke-Guard @('--serial', $emu, '--log', $log, '--own-ports', $ports, '--', 'get-state')
    Write-Result 'AF-2b own-ports range' (($r.Rc -eq '2') -and ($r.Calls.Count -eq 0) -and $r.Out.Contains('comma list')) "$ports -> $($r.Rc) sent=$($r.Calls.Count) (want 2 sent=0)"
}

# AF-3: apk-readback sends exactly `pm path <pinned package>` and `sha256sum <that base.apk>`, prints the hash, and works on every serial class.
$env:FAKE_PM_OUT = "$apkLine`n"
$env:FAKE_HASH = $hash
foreach ($serial in @($emu, $note9, $restrictedSerial)) {
    $r = Invoke-Guard @('apk-readback', '--serial', $serial, '--log', $log)
    $want0 = '["-s","' + $serial + '","shell","pm path ' + $app + '"]'
    $want1 = '["-s","' + $serial + '","shell","sha256sum /data/app/~~Xy12/' + $app + '-AbC==/base.apk"]'
    Write-Result 'AF-3 readback' (($r.Rc -eq '0') -and ($r.Calls.Count -eq 2) -and ($r.Calls[0] -eq $want0) -and ($r.Calls[1] -eq $want1) -and $r.Out.Contains("package=$app base_apk_sha256=$hash")) "[$serial] -> $($r.Rc) calls=$($r.Calls.Count)"
}
$r = Invoke-Guard @('apk-readback', '--serial', $emu, '--log', $log, '--expect-sha256', $hash.ToUpper())
Write-Result 'AF-3 expect match' (($r.Rc -eq '0') -and $r.Out.Contains('match=yes')) "-> $($r.Rc)"
$r = Invoke-Guard @('apk-readback', '--serial', $emu, '--log', $log, '--expect-sha256', ('cd' * 32))
Write-Result 'AF-3 expect mismatch' (($r.Rc -eq '4') -and $r.Out.Contains('match=no')) "-> $($r.Rc) (want 4)"
$r = Invoke-Guard @('apk-readback', '--serial', $emu, '--log', $log, '--expect-sha256', 'zz')
Write-Result 'AF-3 expect malformed' (($r.Rc -eq '2') -and ($r.Calls.Count -eq 0)) "-> $($r.Rc) sent=$($r.Calls.Count) (want 2 sent=0)"
# Pinned: other package ids and adb arguments are refused with nothing sent; --kit belongs to plain calls only.
$r = Invoke-Guard @('apk-readback', '--serial', $emu, '--log', $log, '--own-package', 'com.example.other')
Write-Result 'AF-3 other package' (($r.Rc -eq '2') -and ($r.Calls.Count -eq 0)) "-> $($r.Rc) sent=$($r.Calls.Count) (want 2 sent=0)"
$r = Invoke-Guard @('apk-readback', '--serial', $emu, '--log', $log, '--', 'shell', 'id')
Write-Result 'AF-3 adb args' (($r.Rc -eq '2') -and ($r.Calls.Count -eq 0)) "-> $($r.Rc) sent=$($r.Calls.Count) (want 2 sent=0)"
$r = Invoke-Guard @('apk-readback', '--kit', '--serial', $emu, '--log', $log)
Write-Result 'AF-3 kit' (($r.Rc -eq '2') -and ($r.Calls.Count -eq 0)) "-> $($r.Rc) sent=$($r.Calls.Count) (want 2 sent=0)"
# A path of another package or outside /data/app, and a missing package, exit 4 without a sha256sum call.
foreach ($bad in @("package:/data/app/~~Xy12/com.example.other-AbC==/base.apk", 'package:/sdcard/base.apk', "package:/data/app/~~Xy12/$app-AbC==/split_config.apk", '')) {
    $env:FAKE_PM_OUT = "$bad`n"
    $r = Invoke-Guard @('apk-readback', '--serial', $emu, '--log', $log)
    Write-Result 'AF-3 bad path' (($r.Rc -eq '4') -and ($r.Calls.Count -eq 1)) "'$bad' -> $($r.Rc) calls=$($r.Calls.Count) (want 4 calls=1)"
}
$env:FAKE_PM_OUT = "$apkLine`n"
$env:FAKE_HASH = 'nothex'
$r = Invoke-Guard @('apk-readback', '--serial', $emu, '--log', $log)
Write-Result 'AF-3 bad hash' ($r.Rc -eq '4') "-> $($r.Rc) (want 4)"

Remove-Item Env:ADBG_FAKE_ADB_SCRIPT; Remove-Item Env:FAKE_CALLS; Remove-Item Env:FAKE_PM_OUT; Remove-Item Env:FAKE_HASH
'failures=' + $script:failures
exit $script:failures
